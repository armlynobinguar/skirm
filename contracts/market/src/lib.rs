//! skirm market contract (market.playskirm.testnet).
//!
//! * List: the seller calls `skills.nft_approve(token_id, "market.playskirm.testnet", msg)` with
//!   `msg = {"price":"<yoctoNEAR>"}`; the skills contract calls `nft_on_approve` here.
//! * Delist / reprice: the seller, with 1 yoctoNEAR.
//! * Buy: the buyer attaches at least the price. The market calls the skills contract's NEP-199
//!   `nft_transfer_payout(balance = price)`, then pays from the returned payout: the platform fee
//!   `floor(P · fee_bps / 10^4)` (default 500 bps) is taken from the seller's share, so with the
//!   creator royalty computed by the skills contract the three parts are exactly Formulas §6:
//!   fee + royalty + seller = P. Excess deposit is refunded to the buyer.
//! * A failed transfer refunds the buyer in full and drops the (stale) listing.
//! * Fee split: `season_share_bps` of the fee (default 30%) goes to the seasons contract through
//!   `fund(None)`; the rest goes to the treasury. If `fund` fails (no open season), the callback
//!   forwards the share to the treasury. Without a season pool the whole fee goes to the treasury.
//! * Fee governance: the owner or `governance_id` proposes a fee, which applies after
//!   `FEE_DELAY_MS` (24 h). Every setter emits a NEP-297 event.
//! * Rent: agent rentals (agents live offchain, so nothing is transferred). The renter attaches at
//!   least `price` to `rent(rental_id, owner_id, price)`; the same platform fee comes out of it
//!   with the same season/treasury split as a sale, the owner gets the rest, any excess is
//!   refunded, and a `rental` event records it. The backend checks the event against its own
//!   offer (owner, price) before it grants the match. No state is kept.

use std::collections::HashMap;

use near_sdk::json_types::{U128, U64};
use near_sdk::serde_json::{self, json};
use near_sdk::store::{IterableMap, LookupMap, LookupSet};
use near_sdk::{
    assert_one_yocto, env, ext_contract, near, require, AccountId, BorshStorageKey, Gas, NearToken,
    PanicOnDefault, Promise, PromiseError, PromiseOrValue,
};

pub type TokenId = String;

pub const BPS_DENOMINATOR: u128 = 10_000;
/// Formulas §6: platform fee, proposed 500 bps (5%).
pub const DEFAULT_FEE_BPS: u16 = 500;
/// Upper bound the owner can set. With the 1,000 bps royalty cap the seller's share of the
/// payout always covers the fee.
pub const MAX_FEE_BPS: u16 = 1_000;
/// Most payout entries accepted from the NFT contract.
pub const MAX_LEN_PAYOUT: u32 = 10;
pub const EVENT_STANDARD: &str = "skirm_market";
/// Share of each fee sent to the season prize pool, in bps of the fee.
pub const DEFAULT_SEASON_SHARE_BPS: u16 = 3_000;
/// Delay between `propose_fee` and the earliest `apply_fee`.
pub const FEE_DELAY_MS: u64 = 24 * 60 * 60 * 1000;

pub const GAS_FOR_NFT_TRANSFER_PAYOUT: Gas = Gas::from_tgas(30);
pub const GAS_FOR_SEASON_FUND: Gas = Gas::from_tgas(15);
pub const GAS_FOR_ON_SEASON_FUNDED: Gas = Gas::from_tgas(10);
/// `resolve_purchase` itself plus the `fund` call and the callback it may schedule.
pub const GAS_FOR_RESOLVE_PURCHASE: Gas = Gas::from_tgas(70);
/// Prepaid gas `buy` requires: both calls above plus its own execution.
pub const GAS_FOR_BUY: Gas = Gas::from_tgas(120);
/// Largest payout JSON read back from the NFT contract.
const MAX_PAYOUT_RESULT_LEN: usize = 4096;
/// Longest `rental_id` accepted (the backend's offer id and a nonce).
pub const MAX_RENTAL_ID_LEN: usize = 96;

/// `floor(amount · bps / 10^4)` without overflowing u128.
pub fn bps_of(amount: u128, bps: u16) -> u128 {
    let bps = bps as u128;
    (amount / BPS_DENOMINATOR) * bps + (amount % BPS_DENOMINATOR) * bps / BPS_DENOMINATOR
}

/// `(season, treasury)` parts of `fee`: the season gets `floor(fee · share_bps / 10^4)`, the
/// treasury the rest, so the two always sum to `fee`.
pub fn split_fee(fee: u128, season_share_bps: u16) -> (u128, u128) {
    let season = bps_of(fee, season_share_bps);
    (season, fee - season)
}

/// NEP-199 payout object.
#[derive(Clone, Debug, PartialEq, Eq)]
#[near(serializers = [json])]
pub struct Payout {
    pub payout: HashMap<AccountId, U128>,
}

/// The seasons contract's funding method: adds the deposit to the given (or current open)
/// season's pool; panics when no season is open.
#[ext_contract(ext_seasons)]
pub trait Seasons {
    fn fund(&mut self, season_id: Option<u32>) -> U128;
}

#[ext_contract(ext_skills)]
pub trait SkillsNft {
    fn nft_transfer_payout(
        &mut self,
        receiver_id: AccountId,
        token_id: TokenId,
        approval_id: Option<u64>,
        memo: Option<String>,
        balance: U128,
        max_len_payout: Option<u32>,
    ) -> Payout;
}

#[derive(Clone, Debug, PartialEq, Eq)]
#[near(serializers = [borsh, json])]
pub struct Listing {
    pub token_id: TokenId,
    pub seller: AccountId,
    pub approval_id: u64,
    pub price: U128,
    pub listed_at_ms: U64,
}

/// `msg` of `nft_approve` when listing.
#[derive(Clone, Debug)]
#[near(serializers = [json])]
pub struct ListingMsg {
    pub price: U128,
}

/// How a sale of `price` is paid out.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Settlement {
    pub fee: u128,
    /// Payout entries other than the seller (creator royalty), sorted by account.
    pub royalties: Vec<(AccountId, u128)>,
    pub seller_proceeds: u128,
    /// True when the NFT contract's payout was unusable and the seller got `price - fee`.
    pub fallback: bool,
}

/// Formulas §6 split. `payout` is what `nft_transfer_payout(balance = price)` returned; the fee
/// comes out of the seller's entry. An invalid payout (wrong sum, too long, seller share below
/// the fee) falls back to paying the seller `price - fee`, so the parts always sum to `price`.
pub fn settle(
    price: u128,
    fee_bps: u16,
    payout: Option<&HashMap<AccountId, U128>>,
    seller: &AccountId,
) -> Settlement {
    let fee = bps_of(price, fee_bps);
    if let Some(payout) = payout {
        let sum = payout
            .values()
            .try_fold(0u128, |acc, v| acc.checked_add(v.0));
        let seller_entry = payout.get(seller).map(|v| v.0).unwrap_or(0);
        if payout.len() as u32 <= MAX_LEN_PAYOUT && sum == Some(price) && seller_entry >= fee {
            let mut royalties: Vec<(AccountId, u128)> = payout
                .iter()
                .filter(|(a, v)| *a != seller && v.0 > 0)
                .map(|(a, v)| (a.clone(), v.0))
                .collect();
            royalties.sort();
            return Settlement {
                fee,
                royalties,
                seller_proceeds: seller_entry - fee,
                fallback: false,
            };
        }
    }
    Settlement {
        fee,
        royalties: vec![],
        seller_proceeds: price - fee,
        fallback: true,
    }
}

/// A fee change waiting for its delay.
#[derive(Clone, Debug, PartialEq, Eq)]
#[near(serializers = [borsh, json])]
pub struct PendingFee {
    pub bps: u16,
    pub effective_at_ms: U64,
}

#[derive(Clone, Debug, PartialEq, Eq)]
#[near(serializers = [json])]
pub struct Config {
    pub owner_id: AccountId,
    pub governance_id: AccountId,
    pub nft_contract_id: AccountId,
    pub treasury_id: AccountId,
    pub season_pool_id: Option<AccountId>,
    pub season_share_bps: u16,
    pub fee_bps: u16,
    pub max_fee_bps: u16,
    pub pending_fee: Option<PendingFee>,
    pub fee_delay_ms: U64,
}

#[derive(BorshStorageKey)]
#[near]
enum StorageKey {
    Listings,
    BySeller,
    Pending,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Contract {
    owner_id: AccountId,
    /// May propose and apply fee changes and set the governance account and season pool.
    governance_id: AccountId,
    nft_contract_id: AccountId,
    treasury_id: AccountId,
    /// Seasons contract that receives `season_share_bps` of each fee.
    season_pool_id: Option<AccountId>,
    season_share_bps: u16,
    fee_bps: u16,
    pending_fee: Option<PendingFee>,
    listings: IterableMap<TokenId, Listing>,
    by_seller: LookupMap<AccountId, Vec<TokenId>>,
    /// Tokens with a purchase in flight; they cannot be bought or relisted until it resolves.
    pending: LookupSet<TokenId>,
}

fn emit_event(event: &str, data: serde_json::Value) {
    let ev =
        json!({ "standard": EVENT_STANDARD, "version": "1.0.0", "event": event, "data": [data] });
    env::log_str(&format!("EVENT_JSON:{ev}"));
}

/// Sends `amount` yoctoNEAR to `to` (nothing when it is 0).
fn pay(to: &AccountId, amount: u128) {
    if amount > 0 {
        Promise::new(to.clone())
            .transfer(NearToken::from_yoctonear(amount))
            .detach();
    }
}

/// `<what>_updated {old, new, by}` for a setter.
fn emit_updated(event: &str, old: serde_json::Value, new: serde_json::Value) {
    emit_event(
        event,
        json!({ "old": old, "new": new, "by": env::predecessor_account_id() }),
    );
}

#[near]
impl Contract {
    #[init]
    #[allow(clippy::too_many_arguments)]
    pub fn new(
        owner_id: AccountId,
        nft_contract_id: AccountId,
        treasury_id: AccountId,
        fee_bps: Option<u16>,
        governance_id: Option<AccountId>,
        season_pool_id: Option<AccountId>,
        season_share_bps: Option<u16>,
    ) -> Self {
        let fee_bps = fee_bps.unwrap_or(DEFAULT_FEE_BPS);
        require!(fee_bps <= MAX_FEE_BPS, "fee_bps must be at most 1000");
        let season_share_bps = season_share_bps.unwrap_or(DEFAULT_SEASON_SHARE_BPS);
        require!(
            season_share_bps as u128 <= BPS_DENOMINATOR,
            "season_share_bps must be at most 10000"
        );
        Self {
            governance_id: governance_id.unwrap_or_else(|| owner_id.clone()),
            owner_id,
            nft_contract_id,
            treasury_id,
            season_pool_id,
            season_share_bps,
            fee_bps,
            pending_fee: None,
            listings: IterableMap::new(StorageKey::Listings),
            by_seller: LookupMap::new(StorageKey::BySeller),
            pending: LookupSet::new(StorageKey::Pending),
        }
    }

    /// NEP-178 receiver: called by the skills contract after `nft_approve`. Creates or replaces
    /// the listing for `token_id`. Listing storage is paid by this contract.
    pub fn nft_on_approve(
        &mut self,
        token_id: TokenId,
        owner_id: AccountId,
        approval_id: u64,
        msg: String,
    ) -> PromiseOrValue<String> {
        require!(
            env::predecessor_account_id() == self.nft_contract_id,
            "Only the skills contract can list tokens"
        );
        let ListingMsg { price } = serde_json::from_str(&msg)
            .unwrap_or_else(|_| env::panic_str("msg must be {\"price\":\"<yoctoNEAR>\"}"));
        require!(price.0 > 0, "Price must be greater than 0");
        require!(
            !self.pending.contains(&token_id),
            "A purchase of this token is in progress"
        );

        if let Some(old) = self.listings.get(&token_id).cloned() {
            self.unindex(&old.seller, &token_id);
        }
        let listing = Listing {
            token_id: token_id.clone(),
            seller: owner_id.clone(),
            approval_id,
            price,
            listed_at_ms: U64(env::block_timestamp_ms()),
        };
        self.listings.insert(token_id.clone(), listing.clone());
        self.by_seller.entry(owner_id).or_default().push(token_id);
        emit_event("list", serde_json::to_value(&listing).unwrap());
        PromiseOrValue::Value("listed".to_string())
    }

    /// Seller removes their listing. Requires 1 yoctoNEAR. (The NFT approval stays until the
    /// seller calls `nft_revoke` on the skills contract; without a listing it cannot be used.)
    #[payable]
    pub fn delist(&mut self, token_id: TokenId) {
        assert_one_yocto();
        let listing = self.expect_listing(&token_id);
        require!(
            env::predecessor_account_id() == listing.seller,
            "Only the seller can delist"
        );
        self.remove_listing(&token_id);
        emit_event(
            "delist",
            json!({ "token_id": token_id, "seller": listing.seller }),
        );
    }

    /// Seller changes the price. Requires 1 yoctoNEAR.
    #[payable]
    pub fn update_price(&mut self, token_id: TokenId, price: U128) {
        assert_one_yocto();
        require!(price.0 > 0, "Price must be greater than 0");
        let mut listing = self.expect_listing(&token_id);
        require!(
            env::predecessor_account_id() == listing.seller,
            "Only the seller can change the price"
        );
        listing.price = price;
        self.listings.insert(token_id, listing.clone());
        emit_event("update_price", serde_json::to_value(&listing).unwrap());
    }

    /// Buy a listed token with at least `price` attached. Attach 120 Tgas or more.
    #[payable]
    pub fn buy(&mut self, token_id: TokenId) -> Promise {
        let listing = self.expect_listing(&token_id);
        let buyer = env::predecessor_account_id();
        let deposit = env::attached_deposit();
        require!(
            buyer != listing.seller,
            "The seller cannot buy their own listing"
        );
        require!(
            deposit.as_yoctonear() >= listing.price.0,
            format!("Attach at least the price: {} yoctoNEAR", listing.price.0)
        );
        require!(
            env::prepaid_gas() >= GAS_FOR_BUY,
            "Attach at least 120 Tgas"
        );

        // Lock: the listing leaves the book now; a failed transfer refunds and does not restore it.
        self.remove_listing(&token_id);
        self.pending.insert(token_id.clone());

        ext_skills::ext(self.nft_contract_id.clone())
            .with_attached_deposit(NearToken::from_yoctonear(1))
            .with_static_gas(GAS_FOR_NFT_TRANSFER_PAYOUT)
            .nft_transfer_payout(
                buyer.clone(),
                token_id,
                Some(listing.approval_id),
                Some("skirm market sale".to_string()),
                listing.price,
                Some(MAX_LEN_PAYOUT),
            )
            .then(
                Self::ext(env::current_account_id())
                    .with_static_gas(GAS_FOR_RESOLVE_PURCHASE)
                    .resolve_purchase(buyer, listing, U128(deposit.as_yoctonear())),
            )
    }

    /// Callback of `buy`. Returns true when the sale went through.
    #[private]
    pub fn resolve_purchase(&mut self, buyer: AccountId, listing: Listing, deposit: U128) -> bool {
        // Same check as #[private]; repeated in the body so unit tests exercise it.
        require!(
            env::predecessor_account_id() == env::current_account_id(),
            "Method resolve_purchase is private"
        );
        let token_id = listing.token_id.clone();
        self.pending.remove(&token_id);
        let price = listing.price.0;

        let bytes = match env::promise_result_checked(0, MAX_PAYOUT_RESULT_LEN) {
            Ok(bytes) => Some(bytes),
            // The transfer succeeded but the payout is oversized: still a sale (fallback split).
            Err(PromiseError::TooLong(_)) => None,
            Err(_) => {
                // Transfer failed (approval revoked, token moved, ...): nothing changed hands.
                Promise::new(buyer.clone())
                    .transfer(NearToken::from_yoctonear(deposit.0))
                    .detach();
                emit_event(
                    "purchase_failed",
                    json!({ "token_id": token_id, "seller": listing.seller, "buyer": buyer, "refund": deposit }),
                );
                return false;
            }
        };

        // The token has moved to the buyer; pay out.
        let payout: Option<Payout> = bytes.and_then(|b| serde_json::from_slice(&b).ok());
        let s = settle(
            price,
            self.fee_bps,
            payout.as_ref().map(|p| &p.payout),
            &listing.seller,
        );

        let (season_share, treasury_share) = self.pay_fee(s.fee);
        for (account, amount) in &s.royalties {
            pay(account, *amount);
        }
        pay(&listing.seller, s.seller_proceeds);
        let refund = deposit.0.saturating_sub(price);
        pay(&buyer, refund);

        let royalties: serde_json::Map<String, serde_json::Value> = s
            .royalties
            .iter()
            .map(|(a, v)| (a.to_string(), json!(U128(*v))))
            .collect();
        emit_event(
            "sale",
            json!({
                "token_id": token_id,
                "seller": listing.seller,
                "buyer": buyer,
                "price": listing.price,
                "fee": U128(s.fee),
                "fee_bps": self.fee_bps,
                "season_share": U128(season_share),
                "treasury_share": U128(treasury_share),
                "royalties": royalties,
                "seller_proceeds": U128(s.seller_proceeds),
                "refund": U128(refund),
                "payout_fallback": s.fallback,
            }),
        );
        true
    }

    /// Rent an offchain agent for one match: attach at least `price`. The platform fee is taken
    /// and split as for a sale, `owner_id` gets the rest and any excess comes back. `rental_id`
    /// is the backend's offer id plus a nonce; the backend matches the `rental` event to its offer.
    #[payable]
    pub fn rent(&mut self, rental_id: String, owner_id: AccountId, price: U128) {
        let renter = env::predecessor_account_id();
        let deposit = env::attached_deposit().as_yoctonear();
        require!(
            !rental_id.is_empty() && rental_id.len() <= MAX_RENTAL_ID_LEN,
            "rental_id must be 1 to 96 bytes"
        );
        require!(price.0 > 0, "Price must be greater than 0");
        require!(renter != owner_id, "The owner cannot rent their own agent");
        require!(
            deposit >= price.0,
            format!("Attach at least the price: {} yoctoNEAR", price.0)
        );

        let fee = bps_of(price.0, self.fee_bps);
        let owner_proceeds = price.0 - fee;
        let (season_share, treasury_share) = self.pay_fee(fee);
        pay(&owner_id, owner_proceeds);
        let refund = deposit - price.0;
        pay(&renter, refund);
        emit_event(
            "rental",
            json!({
                "rental_id": rental_id,
                "owner": owner_id,
                "renter": renter,
                "price": price,
                "fee": U128(fee),
                "fee_bps": self.fee_bps,
                "season_share": U128(season_share),
                "treasury_share": U128(treasury_share),
                "owner_proceeds": U128(owner_proceeds),
                "refund": U128(refund),
            }),
        );
    }

    /// Callback of the season share's `fund`. Returns true when the seasons contract took the
    /// share. Otherwise the failed call refunds it to this contract and it goes to the treasury.
    #[private]
    pub fn on_season_funded(&mut self, amount: U128) -> bool {
        // Same check as #[private]; repeated in the body so unit tests exercise it.
        require!(
            env::predecessor_account_id() == env::current_account_id(),
            "Method on_season_funded is private"
        );
        // Only a failed call refunds the share. A result longer than expected still means
        // `fund` took it, so forwarding it as well would pay the share twice.
        match env::promise_result_checked(0, 64) {
            Ok(_) | Err(PromiseError::TooLong(_)) => return true,
            Err(_) => {}
        }
        Promise::new(self.treasury_id.clone())
            .transfer(NearToken::from_yoctonear(amount.0))
            .detach();
        emit_event(
            "season_share_forwarded",
            json!({ "amount": amount, "treasury_id": self.treasury_id, "season_pool_id": self.season_pool_id }),
        );
        false
    }

    // ---------- admin ----------

    /// Owner only; applies at once, without the delay.
    #[payable]
    pub fn set_fee_bps(&mut self, fee_bps: u16) {
        assert_one_yocto();
        self.assert_owner();
        require!(fee_bps <= MAX_FEE_BPS, "fee_bps must be at most 1000");
        self.update_fee(fee_bps);
    }

    /// Owner or governance: schedule a fee change that `apply_fee` makes after `FEE_DELAY_MS`.
    /// A new proposal replaces a pending one.
    #[payable]
    pub fn propose_fee(&mut self, bps: u16) -> PendingFee {
        assert_one_yocto();
        self.assert_owner_or_governance();
        require!(bps <= MAX_FEE_BPS, "fee_bps must be at most 1000");
        let pending = PendingFee {
            bps,
            effective_at_ms: U64(env::block_timestamp_ms() + FEE_DELAY_MS),
        };
        self.pending_fee = Some(pending.clone());
        emit_event(
            "fee_proposed",
            json!({
                "old_bps": self.fee_bps,
                "new_bps": bps,
                "effective_at_ms": pending.effective_at_ms,
                "by": env::predecessor_account_id(),
            }),
        );
        pending
    }

    /// Owner or governance: apply the pending fee once its delay has passed. Returns the new fee.
    #[payable]
    pub fn apply_fee(&mut self) -> u16 {
        assert_one_yocto();
        self.assert_owner_or_governance();
        let pending = self
            .pending_fee
            .clone()
            .unwrap_or_else(|| env::panic_str("No fee change is pending"));
        require!(
            env::block_timestamp_ms() >= pending.effective_at_ms.0,
            "The fee change is not effective yet"
        );
        self.pending_fee = None;
        self.update_fee(pending.bps);
        pending.bps
    }

    #[payable]
    pub fn set_treasury(&mut self, treasury_id: AccountId) {
        assert_one_yocto();
        self.assert_owner();
        emit_updated(
            "treasury_updated",
            json!(self.treasury_id),
            json!(treasury_id),
        );
        self.treasury_id = treasury_id;
    }

    #[payable]
    pub fn set_owner(&mut self, owner_id: AccountId) {
        assert_one_yocto();
        self.assert_owner();
        emit_updated("owner_updated", json!(self.owner_id), json!(owner_id));
        self.owner_id = owner_id;
    }

    /// Owner or governance.
    #[payable]
    pub fn set_governance(&mut self, governance_id: AccountId) {
        assert_one_yocto();
        self.assert_owner_or_governance();
        emit_updated(
            "governance_updated",
            json!(self.governance_id),
            json!(governance_id),
        );
        self.governance_id = governance_id;
    }

    /// Owner or governance. `None` sends the whole fee to the treasury.
    #[payable]
    pub fn set_season_pool(&mut self, season_pool_id: Option<AccountId>) {
        assert_one_yocto();
        self.assert_owner_or_governance();
        emit_updated(
            "season_pool_updated",
            json!(self.season_pool_id),
            json!(season_pool_id),
        );
        self.season_pool_id = season_pool_id;
    }

    // ---------- views ----------

    pub fn get_config(&self) -> Config {
        Config {
            owner_id: self.owner_id.clone(),
            governance_id: self.governance_id.clone(),
            nft_contract_id: self.nft_contract_id.clone(),
            treasury_id: self.treasury_id.clone(),
            season_pool_id: self.season_pool_id.clone(),
            season_share_bps: self.season_share_bps,
            fee_bps: self.fee_bps,
            max_fee_bps: MAX_FEE_BPS,
            pending_fee: self.pending_fee.clone(),
            fee_delay_ms: U64(FEE_DELAY_MS),
        }
    }

    pub fn get_listing(&self, token_id: TokenId) -> Option<Listing> {
        self.listings.get(&token_id).cloned()
    }

    pub fn get_listings(&self, from_index: Option<u32>, limit: Option<u32>) -> Vec<Listing> {
        self.listings
            .values()
            .skip(from_index.unwrap_or(0) as usize)
            .take(limit.unwrap_or(50) as usize)
            .cloned()
            .collect()
    }

    pub fn get_listings_by_seller(&self, seller: AccountId) -> Vec<Listing> {
        self.by_seller
            .get(&seller)
            .map(|ids| {
                ids.iter()
                    .filter_map(|id| self.listings.get(id).cloned())
                    .collect()
            })
            .unwrap_or_default()
    }

    pub fn listing_count(&self) -> u32 {
        self.listings.len()
    }

    pub fn is_purchase_pending(&self, token_id: TokenId) -> bool {
        self.pending.contains(&token_id)
    }

    /// The platform fee on a sale at `price` (the creator royalty comes from
    /// `skills.nft_payout`).
    pub fn fee_for(&self, price: U128) -> U128 {
        U128(bps_of(price.0, self.fee_bps))
    }
}

impl Contract {
    /// Pays out a platform fee: the season pool's share through `fund` (forwarded to the treasury
    /// if that fails), the rest to the treasury. Returns `(season_share, treasury_share)`.
    fn pay_fee(&self, fee: u128) -> (u128, u128) {
        let (season_share, treasury_share) = match &self.season_pool_id {
            Some(_) => split_fee(fee, self.season_share_bps),
            None => (0, fee),
        };
        if let (Some(pool), true) = (&self.season_pool_id, season_share > 0) {
            ext_seasons::ext(pool.clone())
                .with_attached_deposit(NearToken::from_yoctonear(season_share))
                .with_static_gas(GAS_FOR_SEASON_FUND)
                .fund(None)
                .then(
                    Self::ext(env::current_account_id())
                        .with_static_gas(GAS_FOR_ON_SEASON_FUNDED)
                        .on_season_funded(U128(season_share)),
                )
                .detach();
        }
        pay(&self.treasury_id, treasury_share);
        (season_share, treasury_share)
    }

    fn assert_owner(&self) {
        require!(
            env::predecessor_account_id() == self.owner_id,
            "Only the owner can call this method"
        );
    }

    fn assert_owner_or_governance(&self) {
        let caller = env::predecessor_account_id();
        require!(
            caller == self.owner_id || caller == self.governance_id,
            "Only the owner or governance can call this method"
        );
    }

    fn update_fee(&mut self, fee_bps: u16) {
        emit_event(
            "fee_updated",
            json!({ "old_bps": self.fee_bps, "new_bps": fee_bps, "by": env::predecessor_account_id() }),
        );
        self.fee_bps = fee_bps;
    }

    fn expect_listing(&self, token_id: &TokenId) -> Listing {
        self.listings
            .get(token_id)
            .cloned()
            .unwrap_or_else(|| env::panic_str("Token is not listed"))
    }

    fn remove_listing(&mut self, token_id: &TokenId) {
        if let Some(listing) = self.listings.remove(token_id) {
            self.unindex(&listing.seller, token_id);
        }
    }

    fn unindex(&mut self, seller: &AccountId, token_id: &TokenId) {
        if let Some(ids) = self.by_seller.get_mut(seller) {
            ids.retain(|id| id != token_id);
            if ids.is_empty() {
                self.by_seller.remove(seller);
            }
        }
    }
}

#[cfg(test)]
mod tests;
