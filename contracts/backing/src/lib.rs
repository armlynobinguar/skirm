//! skirm backing contract (backing.playskirm.testnet, not deployed yet).
//!
//! Players back a skill writer (or one of the writer's skills) with NEAR up front; in return they
//! receive a capped share of the writer's future royalties.
//!
//! * `open_round` (the writer): terms are fixed for the round's life: `share_bps` of every royalty
//!   routed to the round goes to the backers (up to `MAX_SHARE_BPS`), until the backers together
//!   have received `cap_multiple_bps / 10^4` times what they staked; after that every royalty goes
//!   to the writer. `max_raise` bounds the stakes. The writer attaches the round's storage cost
//!   (the excess is refunded).
//! * `back` (payable, anyone but the writer): stakes the attached NEAR (minus the storage of a new
//!   backer's record). A stake above what is left of `max_raise` is cut to fit and the rest
//!   refunded.
//! * `close_round` (the writer): stops backing and sends the raised NEAR to the writer. From then
//!   on the stakes are fixed and royalties can be routed.
//! * `cancel_round` (the writer, while open): nobody is paid; each backer pulls their stake back
//!   with `refund`.
//! * `distribute` (payable, anyone): routes the attached NEAR as royalty income of a closed round.
//!   The backers' part is `min(floor(amount · share_bps / 10^4), cap - backers_earned)`; the rest
//!   goes straight to the writer.
//! * `claim` (a backer): pulls `floor(stake · backers_earned / raised) - claimed`. Every backer's
//!   entitlement is the same fraction of their stake, so all backers reach the cap together.
//!
//! Royalty routing: the skills contract pays NEP-199 royalties to a skill's creator account, which
//! is fixed at mint (and also receives the token), so this contract cannot be put in the payout
//! map without changing the skills contract. Royalties reach a round through `distribute`: the
//! writer (or the platform's ops flow acting for the writer) forwards the round's royalties as
//! they arrive. The platform mirrors sales offchain and shows the writer what each round is owed.
//!
//! Events are NEP-297 with standard `skirm_backing`.

use near_sdk::json_types::{U128, U64};
use near_sdk::serde_json::{self, json};
use near_sdk::store::LookupMap;
use near_sdk::{
    assert_one_yocto, env, near, require, AccountId, BorshStorageKey, NearToken, PanicOnDefault,
    Promise,
};

pub const BPS_DENOMINATOR: u128 = 10_000;
/// Backers get at most half of each royalty routed to a round.
pub const MAX_SHARE_BPS: u16 = 5_000;
/// The backers' cap is between 1× and 10× what they staked.
pub const MIN_CAP_MULTIPLE_BPS: u32 = 10_000;
pub const MAX_CAP_MULTIPLE_BPS: u32 = 100_000;
/// Largest `max_raise`: 1,000,000 NEAR (keeps every product below 2^256 in `mul_div`).
pub const MAX_RAISE_LIMIT: NearToken = NearToken::from_near(1_000_000);
/// Default smallest stake: 0.1 NEAR.
pub const DEFAULT_MIN_STAKE: NearToken = NearToken::from_millinear(100);
/// Most backers in one round.
pub const MAX_BACKERS: u32 = 500;
pub const MAX_SKILL_ID_LEN: usize = 64;
pub const EVENT_STANDARD: &str = "skirm_backing";

/// `floor(amount · bps / 10^4)` without overflowing u128 (same as the market contract).
pub fn bps_of(amount: u128, bps: u32) -> u128 {
    let bps = bps as u128;
    (amount / BPS_DENOMINATOR) * bps + (amount % BPS_DENOMINATOR) * bps / BPS_DENOMINATOR
}

/// `floor(a · b / c)` with a 256-bit intermediate product. Panics when `c` is 0 or the result
/// does not fit in u128.
pub fn mul_div(a: u128, b: u128, c: u128) -> u128 {
    require!(c > 0, "Division by zero");
    const MASK: u128 = u64::MAX as u128;
    let (a1, a0) = (a >> 64, a & MASK);
    let (b1, b0) = (b >> 64, b & MASK);
    let p00 = a0 * b0;
    let p01 = a0 * b1;
    let p10 = a1 * b0;
    let p11 = a1 * b1;
    let mid = (p00 >> 64) + (p01 & MASK) + (p10 & MASK);
    let lo = (p00 & MASK) | ((mid & MASK) << 64);
    let hi = p11 + (p01 >> 64) + (p10 >> 64) + (mid >> 64);
    require!(hi < c, "Overflow");
    // Long division of (hi, lo) by c, one bit at a time; `rem` stays below c.
    let mut rem = hi;
    let mut q: u128 = 0;
    for i in (0..128).rev() {
        let carry = rem >> 127;
        rem = (rem << 1) | ((lo >> i) & 1);
        q <<= 1;
        if carry == 1 || rem >= c {
            rem = rem.wrapping_sub(c);
            q |= 1;
        }
    }
    q
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[near(serializers = [borsh, json])]
#[serde(rename_all = "snake_case")]
pub enum RoundStatus {
    /// Accepting stakes.
    Open,
    /// Stakes fixed and paid to the writer; royalties are routed with `distribute`.
    Closed,
    /// Called off while open: backers pull their stakes back with `refund`.
    Cancelled,
}

#[derive(Clone, Debug, PartialEq, Eq)]
#[near(serializers = [borsh, json])]
pub struct Round {
    pub id: U64,
    pub writer: AccountId,
    /// `None`: every skill the writer sells; otherwise one skill id (`skl_` + ULID).
    pub skill_id: Option<String>,
    pub share_bps: u16,
    pub cap_multiple_bps: u32,
    pub max_raise: U128,
    pub raised: U128,
    pub backers: u32,
    pub status: RoundStatus,
    pub opened_at_ms: U64,
    pub closed_at_ms: Option<U64>,
    /// All royalty income routed to the round.
    pub royalties_in: U128,
    /// Of that, what the backers earned (at most `raised · cap_multiple_bps / 10^4`).
    pub backers_earned: U128,
    /// What backers have pulled with `claim`.
    pub claimed_total: U128,
}

impl Round {
    /// The most the backers together can ever earn.
    pub fn cap(&self) -> u128 {
        bps_of(self.raised.0, self.cap_multiple_bps)
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
#[near(serializers = [borsh, json])]
pub struct Backing {
    pub stake: U128,
    pub claimed: U128,
    pub refunded: bool,
}

#[derive(Clone, Debug, PartialEq, Eq)]
#[near(serializers = [json])]
pub struct BackingView {
    pub round_id: U64,
    pub account_id: AccountId,
    pub stake: U128,
    pub claimed: U128,
    /// What `claim` would pay now (or the stake `refund` returns on a cancelled round).
    pub claimable: U128,
    pub refunded: bool,
}

#[derive(Clone, Debug, PartialEq, Eq)]
#[near(serializers = [json])]
pub struct Config {
    pub owner_id: AccountId,
    pub min_stake: U128,
    pub max_share_bps: u16,
    pub min_cap_multiple_bps: u32,
    pub max_cap_multiple_bps: u32,
    pub max_backers: u32,
    pub round_count: U64,
}

#[derive(BorshStorageKey)]
#[near]
enum StorageKey {
    Rounds,
    Backings,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Contract {
    owner_id: AccountId,
    min_stake: NearToken,
    next_round_id: u64,
    rounds: LookupMap<u64, Round>,
    backings: LookupMap<(u64, AccountId), Backing>,
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

fn storage_cost(before: u64) -> u128 {
    let after = env::storage_usage();
    env::storage_byte_cost()
        .as_yoctonear()
        .saturating_mul(after.saturating_sub(before) as u128)
}

#[near]
impl Contract {
    #[init]
    pub fn new(owner_id: AccountId, min_stake: Option<U128>) -> Self {
        Self {
            owner_id,
            min_stake: min_stake
                .map(|v| NearToken::from_yoctonear(v.0))
                .unwrap_or(DEFAULT_MIN_STAKE),
            next_round_id: 1,
            rounds: LookupMap::new(StorageKey::Rounds),
            backings: LookupMap::new(StorageKey::Backings),
        }
    }

    /// The caller (the writer) opens a backing round. Attach the storage cost (about 0.005 NEAR);
    /// the excess is refunded. Returns the round.
    #[payable]
    pub fn open_round(
        &mut self,
        skill_id: Option<String>,
        share_bps: u16,
        cap_multiple_bps: u32,
        max_raise: U128,
    ) -> Round {
        require!(
            share_bps > 0 && share_bps <= MAX_SHARE_BPS,
            format!("share_bps must be between 1 and {MAX_SHARE_BPS}")
        );
        require!(
            (MIN_CAP_MULTIPLE_BPS..=MAX_CAP_MULTIPLE_BPS).contains(&cap_multiple_bps),
            format!(
                "cap_multiple_bps must be between {MIN_CAP_MULTIPLE_BPS} and {MAX_CAP_MULTIPLE_BPS}"
            )
        );
        require!(
            max_raise.0 >= self.min_stake.as_yoctonear()
                && max_raise.0 <= MAX_RAISE_LIMIT.as_yoctonear(),
            "max_raise must be between the minimum stake and 1,000,000 NEAR"
        );
        if let Some(id) = &skill_id {
            require!(
                !id.is_empty()
                    && id.len() <= MAX_SKILL_ID_LEN
                    && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '_'),
                "skill_id must be 1-64 letters, digits or underscores"
            );
        }
        let writer = env::predecessor_account_id();
        let before = env::storage_usage();
        let id = self.next_round_id;
        self.next_round_id += 1;
        let round = Round {
            id: U64(id),
            writer: writer.clone(),
            skill_id,
            share_bps,
            cap_multiple_bps,
            max_raise,
            raised: U128(0),
            backers: 0,
            status: RoundStatus::Open,
            opened_at_ms: U64(env::block_timestamp_ms()),
            closed_at_ms: None,
            royalties_in: U128(0),
            backers_earned: U128(0),
            claimed_total: U128(0),
        };
        self.rounds.insert(id, round.clone());
        self.rounds.flush();
        let cost = storage_cost(before);
        let attached = env::attached_deposit().as_yoctonear();
        require!(
            attached >= cost,
            format!("Attach at least {cost} yoctoNEAR for storage")
        );
        pay(&writer, attached - cost);
        emit_event("round_opened", serde_json::to_value(&round).unwrap());
        round
    }

    /// Back an open round with the attached NEAR. A new backer's record storage comes out of the
    /// attachment; the stake must still reach the minimum. Above what is left of `max_raise`
    /// the stake is cut and the rest refunded. Returns the caller's backing.
    #[payable]
    pub fn back(&mut self, round_id: U64) -> BackingView {
        let mut round = self.expect_round(round_id.0);
        require!(round.status == RoundStatus::Open, "Round is not open");
        let backer = env::predecessor_account_id();
        require!(backer != round.writer, "The writer cannot back their own round");
        let left = round.max_raise.0 - round.raised.0;
        require!(left > 0, "Round is full");

        let key = (round_id.0, backer.clone());
        let existing = self.backings.get(&key).cloned();
        let attached = env::attached_deposit().as_yoctonear();
        let mut backing = existing.clone().unwrap_or(Backing {
            stake: U128(0),
            claimed: U128(0),
            refunded: false,
        });
        let storage = if existing.is_none() {
            require!(round.backers < MAX_BACKERS, "Round has too many backers");
            let before = env::storage_usage();
            self.backings.insert(key.clone(), backing.clone());
            self.backings.flush();
            storage_cost(before)
        } else {
            0
        };
        require!(attached > storage, "Attach the stake plus storage");
        let offered = attached - storage;
        let stake = offered.min(left);
        require!(
            stake >= self.min_stake.as_yoctonear() || stake == left,
            format!(
                "Stake must be at least {} yoctoNEAR",
                self.min_stake.as_yoctonear()
            )
        );
        backing.stake = U128(backing.stake.0 + stake);
        if existing.is_none() {
            round.backers += 1;
        }
        round.raised = U128(round.raised.0 + stake);
        self.backings.insert(key, backing.clone());
        self.rounds.insert(round_id.0, round.clone());
        pay(&backer, offered - stake);
        emit_event(
            "backed",
            json!({
                "round_id": round_id,
                "backer": backer,
                "amount": U128(stake),
                "stake": backing.stake,
                "raised": round.raised,
            }),
        );
        self.view_of(&round, &backer, &backing)
    }

    /// The writer stops backing and receives the raised NEAR.
    pub fn close_round(&mut self, round_id: U64) -> Round {
        let mut round = self.expect_round(round_id.0);
        require!(
            env::predecessor_account_id() == round.writer,
            "Only the writer can close the round"
        );
        require!(round.status == RoundStatus::Open, "Round is not open");
        round.status = RoundStatus::Closed;
        round.closed_at_ms = Some(U64(env::block_timestamp_ms()));
        self.rounds.insert(round_id.0, round.clone());
        pay(&round.writer, round.raised.0);
        emit_event(
            "round_closed",
            json!({ "round_id": round_id, "writer": round.writer, "raised": round.raised, "backers": round.backers }),
        );
        round
    }

    /// The writer calls off an open round; backers pull their stakes back with `refund`.
    pub fn cancel_round(&mut self, round_id: U64) -> Round {
        let mut round = self.expect_round(round_id.0);
        require!(
            env::predecessor_account_id() == round.writer,
            "Only the writer can cancel the round"
        );
        require!(round.status == RoundStatus::Open, "Round is not open");
        round.status = RoundStatus::Cancelled;
        round.closed_at_ms = Some(U64(env::block_timestamp_ms()));
        self.rounds.insert(round_id.0, round.clone());
        emit_event(
            "round_cancelled",
            json!({ "round_id": round_id, "writer": round.writer, "raised": round.raised }),
        );
        round
    }

    /// Routes the attached NEAR as royalty income of a closed round: the backers' part stays here
    /// for `claim`, the rest goes to the writer. Returns the backers' part.
    #[payable]
    pub fn distribute(&mut self, round_id: U64) -> U128 {
        let mut round = self.expect_round(round_id.0);
        require!(
            round.status == RoundStatus::Closed,
            "Royalties are routed to closed rounds only"
        );
        let amount = env::attached_deposit().as_yoctonear();
        require!(amount > 0, "Attach the royalty to distribute");
        let room = round.cap().saturating_sub(round.backers_earned.0);
        let to_backers = bps_of(amount, round.share_bps as u32).min(room);
        let to_writer = amount - to_backers;
        round.royalties_in = U128(round.royalties_in.0 + amount);
        round.backers_earned = U128(round.backers_earned.0 + to_backers);
        self.rounds.insert(round_id.0, round.clone());
        pay(&round.writer, to_writer);
        emit_event(
            "royalty_distributed",
            json!({
                "round_id": round_id,
                "from": env::predecessor_account_id(),
                "amount": U128(amount),
                "to_backers": U128(to_backers),
                "to_writer": U128(to_writer),
                "backers_earned": round.backers_earned,
                "capped": round.backers_earned.0 >= round.cap(),
            }),
        );
        U128(to_backers)
    }

    /// The caller pulls what their stake has earned so far. Returns the amount sent.
    pub fn claim(&mut self, round_id: U64) -> U128 {
        let mut round = self.expect_round(round_id.0);
        require!(round.status == RoundStatus::Closed, "Round is not closed");
        let backer = env::predecessor_account_id();
        let key = (round_id.0, backer.clone());
        let mut backing = self
            .backings
            .get(&key)
            .cloned()
            .unwrap_or_else(|| env::panic_str("No backing for this account"));
        let amount = Self::claimable_of(&round, &backing);
        require!(amount > 0, "Nothing to claim");
        backing.claimed = U128(backing.claimed.0 + amount);
        round.claimed_total = U128(round.claimed_total.0 + amount);
        self.backings.insert(key, backing.clone());
        self.rounds.insert(round_id.0, round);
        pay(&backer, amount);
        emit_event(
            "claimed",
            json!({ "round_id": round_id, "backer": backer, "amount": U128(amount), "claimed": backing.claimed }),
        );
        U128(amount)
    }

    /// A backer of a cancelled round pulls their stake back. Returns the amount sent.
    pub fn refund(&mut self, round_id: U64) -> U128 {
        let round = self.expect_round(round_id.0);
        require!(
            round.status == RoundStatus::Cancelled,
            "Only a cancelled round refunds"
        );
        let backer = env::predecessor_account_id();
        let key = (round_id.0, backer.clone());
        let mut backing = self
            .backings
            .get(&key)
            .cloned()
            .unwrap_or_else(|| env::panic_str("No backing for this account"));
        require!(!backing.refunded, "Already refunded");
        backing.refunded = true;
        let amount = backing.stake.0;
        self.backings.insert(key, backing);
        pay(&backer, amount);
        emit_event(
            "refunded",
            json!({ "round_id": round_id, "backer": backer, "amount": U128(amount) }),
        );
        U128(amount)
    }

    // ---------- admin ----------

    #[payable]
    pub fn set_min_stake(&mut self, min_stake: U128) {
        assert_one_yocto();
        self.assert_owner();
        require!(min_stake.0 > 0, "min_stake must be above 0");
        self.min_stake = NearToken::from_yoctonear(min_stake.0);
    }

    #[payable]
    pub fn set_owner(&mut self, owner_id: AccountId) {
        assert_one_yocto();
        self.assert_owner();
        self.owner_id = owner_id;
    }

    // ---------- views ----------

    pub fn get_round(&self, round_id: U64) -> Option<Round> {
        self.rounds.get(&round_id.0).cloned()
    }

    /// Rounds by id from `from_id` (default 1), at most `limit` (default 50, max 100).
    pub fn get_rounds(&self, from_id: Option<U64>, limit: Option<u32>) -> Vec<Round> {
        let from = from_id.map(|v| v.0).unwrap_or(1).max(1);
        let limit = limit.unwrap_or(50).min(100) as u64;
        (from..self.next_round_id)
            .take(limit as usize)
            .filter_map(|id| self.rounds.get(&id).cloned())
            .collect()
    }

    pub fn get_backing(&self, round_id: U64, account_id: AccountId) -> Option<BackingView> {
        let round = self.rounds.get(&round_id.0)?;
        let backing = self.backings.get(&(round_id.0, account_id.clone()))?;
        Some(self.view_of(round, &account_id, backing))
    }

    pub fn claimable(&self, round_id: U64, account_id: AccountId) -> U128 {
        self.get_backing(round_id, account_id)
            .map(|b| b.claimable)
            .unwrap_or(U128(0))
    }

    pub fn get_config(&self) -> Config {
        Config {
            owner_id: self.owner_id.clone(),
            min_stake: U128(self.min_stake.as_yoctonear()),
            max_share_bps: MAX_SHARE_BPS,
            min_cap_multiple_bps: MIN_CAP_MULTIPLE_BPS,
            max_cap_multiple_bps: MAX_CAP_MULTIPLE_BPS,
            max_backers: MAX_BACKERS,
            round_count: U64(self.next_round_id - 1),
        }
    }
}

impl Contract {
    fn expect_round(&self, id: u64) -> Round {
        self.rounds
            .get(&id)
            .cloned()
            .unwrap_or_else(|| env::panic_str("Round not found"))
    }

    fn assert_owner(&self) {
        require!(
            env::predecessor_account_id() == self.owner_id,
            "Only the owner can call this method"
        );
    }

    /// `floor(stake · backers_earned / raised) - claimed` on a closed round.
    fn claimable_of(round: &Round, backing: &Backing) -> u128 {
        if round.status != RoundStatus::Closed || round.raised.0 == 0 {
            return 0;
        }
        mul_div(backing.stake.0, round.backers_earned.0, round.raised.0)
            .saturating_sub(backing.claimed.0)
    }

    fn view_of(&self, round: &Round, account_id: &AccountId, backing: &Backing) -> BackingView {
        let claimable = match round.status {
            RoundStatus::Cancelled if !backing.refunded => backing.stake.0,
            _ => Self::claimable_of(round, backing),
        };
        BackingView {
            round_id: round.id,
            account_id: account_id.clone(),
            stake: backing.stake,
            claimed: backing.claimed,
            claimable: U128(claimable),
            refunded: backing.refunded,
        }
    }
}

#[cfg(test)]
mod tests;
