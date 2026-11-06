//! skirm cosmetics contract (cosmetics.playskirm.testnet, not deployed yet).
//!
//! Cosmetic items (agent skins, trails, nameplate styles) as NEP-245 multi-tokens: one token id
//! per item type (`skin_ember`, `trail_spark`, ...), any number of copies per account.
//!
//! * Item types are created by the owner or the platform signer (`mt_create`) with NEP-245 token
//!   metadata; `metadata.extra` carries the item's look as JSON (`skirm.cosmetic/v0`).
//! * Copies are minted by the owner or the platform signer (`mt_mint`). A `mint_id` makes a mint
//!   idempotent: the backend sends `<platform account>:<item>`, so a resend after a lost answer
//!   mints nothing.
//! * NEP-245 core: `mt_transfer`, `mt_batch_transfer`, `mt_transfer_call`,
//!   `mt_batch_transfer_call` (1 yocto each), `mt_token`, `mt_balance_of`, `mt_batch_balance_of`,
//!   `mt_supply`, `mt_batch_supply`; the private resolver `mt_resolve_transfer`; enumeration
//!   (`mt_tokens`, `mt_tokens_for_owner`); metadata (`mt_metadata_contract`,
//!   `mt_metadata_token_by_token_id`). Approvals are not supported: an `approval` argument panics.
//! * Events: NEP-297 logs, standard `nep245` version `1.0.0`: `mt_mint`, `mt_transfer`, `mt_burn`.
//! * Storage is charged to the caller. Every call that grows state takes the cost from the
//!   attached deposit first (the excess is refunded) and then from the caller's storage balance
//!   (`storage_deposit`, NEP-145 style). A call that frees state credits the caller's storage
//!   balance, when they have one. Transfers attach exactly 1 yocto, so a sender pays a new
//!   receiver's balance entry from their storage balance. Refunds made by `mt_resolve_transfer`
//!   are absorbed by the contract.

use near_sdk::json_types::U128;
use near_sdk::serde_json::{self, json};
use near_sdk::store::{IterableMap, LookupMap, LookupSet};
use near_sdk::{
    assert_one_yocto, env, ext_contract, near, require, AccountId, BorshStorageKey, Gas, NearToken,
    PanicOnDefault, Promise, PromiseOrValue,
};

pub type TokenId = String;

pub const MT_METADATA_SPEC: &str = "mt-1.0.0";
pub const EVENT_STANDARD: &str = "nep245";
pub const EVENT_VERSION: &str = "1.0.0";
pub const COSMETIC_SCHEMA: &str = "skirm.cosmetic/v0";

pub const MAX_TOKEN_ID: usize = 64;
pub const MAX_BATCH: usize = 16;
pub const MAX_TITLE: usize = 64;
pub const MAX_DESCRIPTION: usize = 280;
pub const MAX_FIELD: usize = 512;
pub const MAX_EXTRA: usize = 1024;
pub const MAX_MINT_ID: usize = 128;
pub const MAX_MEMO: usize = 256;
pub const MAX_PAGE: u32 = 100;
/// Longest `mt_on_transfer` answer read back (16 amounts as JSON strings fit easily).
pub const MAX_RESULT_LEN: usize = 2048;

pub const GAS_FOR_MT_ON_TRANSFER: Gas = Gas::from_tgas(30);
pub const GAS_FOR_RESOLVE_TRANSFER: Gas = Gas::from_tgas(20);
/// Least gas a `*_transfer_call` needs: the transfer, the receiver call and the resolver.
pub const GAS_FOR_TRANSFER_CALL: Gas = Gas::from_tgas(70);

/// NEP-245 contract metadata.
#[derive(Clone, Debug, PartialEq, Eq)]
#[near(serializers = [borsh, json])]
pub struct MtContractMetadata {
    pub spec: String,
    pub name: String,
    pub symbol: Option<String>,
    pub icon: Option<String>,
    pub base_uri: Option<String>,
    pub reference: Option<String>,
    pub reference_hash: Option<String>,
}

/// NEP-245 token metadata of one item type.
#[derive(Clone, Debug, PartialEq, Eq, Default)]
#[near(serializers = [borsh, json])]
pub struct MtTokenMetadata {
    pub title: Option<String>,
    pub description: Option<String>,
    pub media: Option<String>,
    pub media_hash: Option<String>,
    pub copies: Option<u64>,
    pub issued_at: Option<String>,
    pub expires_at: Option<String>,
    pub starts_at: Option<String>,
    pub updated_at: Option<String>,
    /// JSON: `{"schema":"skirm.cosmetic/v0","kind":"skin"|"trail"|"nameplate", ...look}`.
    pub extra: Option<String>,
    pub reference: Option<String>,
    pub reference_hash: Option<String>,
}

/// One item type as stored.
#[derive(Clone, Debug, PartialEq, Eq)]
#[near(serializers = [borsh, json])]
pub struct Item {
    pub metadata: MtTokenMetadata,
    /// Copies in circulation (minted minus burned).
    pub supply: U128,
    /// Most copies that may ever circulate; none: unlimited.
    pub max_supply: Option<U128>,
    pub created_at_ms: u64,
}

/// NEP-245 `Token`. Items have many owners, so `owner_id` is always null; `supply` and `metadata`
/// are extensions.
#[derive(Clone, Debug, PartialEq, Eq)]
#[near(serializers = [json])]
pub struct Token {
    pub token_id: TokenId,
    pub owner_id: Option<AccountId>,
    pub supply: U128,
    pub max_supply: Option<U128>,
    pub metadata: Option<MtTokenMetadata>,
}

/// NEP-145-style storage balance: everything deposited is available to pay for storage.
#[derive(Clone, Debug, PartialEq, Eq)]
#[near(serializers = [json])]
pub struct StorageBalance {
    pub total: U128,
    pub available: U128,
}

#[derive(Clone, Debug, PartialEq, Eq)]
#[near(serializers = [json])]
pub struct Config {
    pub owner_id: AccountId,
    pub ops_id: AccountId,
    pub item_count: u32,
}

/// The receiver side of `mt_transfer_call` (NEP-245): returns the unused amount per token.
#[ext_contract(ext_mt_receiver)]
pub trait MultiTokenReceiver {
    fn mt_on_transfer(
        &mut self,
        sender_id: AccountId,
        previous_owner_ids: Vec<AccountId>,
        token_ids: Vec<TokenId>,
        amounts: Vec<U128>,
        msg: String,
    ) -> PromiseOrValue<Vec<U128>>;
}

#[derive(BorshStorageKey)]
#[near]
enum StorageKey {
    Items,
    Balances,
    OwnerTokens,
    Storage,
    MintIds,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Contract {
    owner_id: AccountId,
    ops_id: AccountId,
    metadata: MtContractMetadata,
    items: IterableMap<TokenId, Item>,
    balances: LookupMap<(TokenId, AccountId), u128>,
    /// Item types each account holds a copy of, in first-received order.
    owner_tokens: LookupMap<AccountId, Vec<TokenId>>,
    /// Storage balances (yoctoNEAR) from `storage_deposit`.
    storage: LookupMap<AccountId, u128>,
    /// `mint_id`s already minted (resends are no-ops).
    mint_ids: LookupSet<String>,
}

/// A NEP-297 `nep245` event with the given data entries.
fn emit(event: &str, data: Vec<serde_json::Value>) {
    let ev = json!({ "standard": EVENT_STANDARD, "version": EVENT_VERSION, "event": event, "data": data });
    env::log_str(&format!("EVENT_JSON:{ev}"));
}

fn strings(amounts: &[u128]) -> Vec<String> {
    amounts.iter().map(|a| a.to_string()).collect()
}

/// Sends `amount` yoctoNEAR to `to` (nothing when it is 0).
fn pay(to: &AccountId, amount: u128) {
    if amount > 0 {
        Promise::new(to.clone())
            .transfer(NearToken::from_yoctonear(amount))
            .detach();
    }
}

pub fn validate_token_id(id: &str) {
    require!(
        (1..=MAX_TOKEN_ID).contains(&id.len())
            && id
                .chars()
                .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '_'),
        "token_id must be 1-64 chars of a-z, 0-9 and _"
    );
}

pub fn validate_metadata(m: &MtTokenMetadata) {
    let title = m.title.as_deref().unwrap_or("");
    require!(
        (1..=MAX_TITLE).contains(&title.chars().count()) && title.trim() == title,
        "metadata.title must be 1-64 chars without outer spaces"
    );
    require!(
        m.description
            .as_deref()
            .map_or(true, |d| d.chars().count() <= MAX_DESCRIPTION),
        "metadata.description must be at most 280 chars"
    );
    for f in [
        &m.media,
        &m.media_hash,
        &m.issued_at,
        &m.expires_at,
        &m.starts_at,
        &m.updated_at,
        &m.reference,
        &m.reference_hash,
    ] {
        require!(
            f.as_deref().map_or(true, |v| v.len() <= MAX_FIELD),
            "metadata fields must be at most 512 bytes"
        );
    }
    if let Some(extra) = &m.extra {
        require!(extra.len() <= MAX_EXTRA, "metadata.extra must be at most 1024 bytes");
        require!(
            serde_json::from_str::<serde_json::Value>(extra).is_ok(),
            "metadata.extra must be JSON"
        );
    }
}

fn validate_memo(memo: &Option<String>) {
    require!(
        memo.as_deref().map_or(true, |m| m.len() <= MAX_MEMO),
        "memo must be at most 256 bytes"
    );
}

#[near]
impl Contract {
    #[init]
    pub fn new(owner_id: AccountId, ops_id: AccountId, metadata: Option<MtContractMetadata>) -> Self {
        let metadata = metadata.unwrap_or_else(|| MtContractMetadata {
            spec: MT_METADATA_SPEC.to_string(),
            name: "skirm cosmetics".to_string(),
            symbol: Some("SKIRMCOS".to_string()),
            icon: None,
            base_uri: None,
            reference: None,
            reference_hash: None,
        });
        require!(metadata.spec == MT_METADATA_SPEC, "metadata.spec must be mt-1.0.0");
        Self {
            owner_id,
            ops_id,
            metadata,
            items: IterableMap::new(StorageKey::Items),
            balances: LookupMap::new(StorageKey::Balances),
            owner_tokens: LookupMap::new(StorageKey::OwnerTokens),
            storage: LookupMap::new(StorageKey::Storage),
            mint_ids: LookupSet::new(StorageKey::MintIds),
        }
    }

    // ---------- item types and minting (owner or ops) ----------

    /// Creates an item type. Owner or ops; storage from the deposit, then the caller's storage
    /// balance. The same id with the same metadata and max supply again returns the existing
    /// item; with different ones it panics.
    #[payable]
    pub fn mt_create(
        &mut self,
        token_id: TokenId,
        metadata: MtTokenMetadata,
        max_supply: Option<U128>,
    ) -> Token {
        self.assert_minter();
        validate_token_id(&token_id);
        validate_metadata(&metadata);
        let caller = env::predecessor_account_id();
        let attached = env::attached_deposit().as_yoctonear();
        if let Some(existing) = self.items.get(&token_id) {
            require!(
                existing.metadata == metadata && existing.max_supply == max_supply,
                "This item type already exists with other metadata"
            );
            pay(&caller, attached);
            return self.token(&token_id).unwrap();
        }
        let before = env::storage_usage();
        self.items.insert(
            token_id.clone(),
            Item {
                metadata,
                supply: U128(0),
                max_supply,
                created_at_ms: env::block_timestamp_ms(),
            },
        );
        let left = self.settle_storage(&caller, before, attached);
        pay(&caller, left);
        self.token(&token_id).unwrap()
    }

    /// Mints copies of existing item types to `receiver_id`. Owner or ops; storage from the
    /// deposit, then the caller's storage balance. Returns false (and mints nothing) when
    /// `mint_id` was already minted.
    #[payable]
    pub fn mt_mint(
        &mut self,
        receiver_id: AccountId,
        token_ids: Vec<TokenId>,
        amounts: Vec<U128>,
        memo: Option<String>,
        mint_id: Option<String>,
    ) -> bool {
        self.assert_minter();
        validate_memo(&memo);
        require!(
            !token_ids.is_empty() && token_ids.len() <= MAX_BATCH,
            "Mint 1-16 token ids at a time"
        );
        require!(token_ids.len() == amounts.len(), "token_ids and amounts differ in length");
        let caller = env::predecessor_account_id();
        let attached = env::attached_deposit().as_yoctonear();
        if let Some(id) = &mint_id {
            require!(
                (1..=MAX_MINT_ID).contains(&id.len()),
                "mint_id must be 1-128 bytes"
            );
            if self.mint_ids.contains(id) {
                pay(&caller, attached);
                return false;
            }
        }
        let before = env::storage_usage();
        for (token_id, amount) in token_ids.iter().zip(&amounts) {
            require!(amount.0 > 0, "amounts must be positive");
            let mut item = self.expect_item(token_id);
            let supply = item
                .supply
                .0
                .checked_add(amount.0)
                .unwrap_or_else(|| env::panic_str("supply overflow"));
            if let Some(max) = item.max_supply {
                require!(supply <= max.0, format!("{token_id} would exceed its max supply"));
            }
            item.supply = U128(supply);
            self.items.insert(token_id.clone(), item);
            let bal = self.balance(token_id, &receiver_id);
            self.set_balance(token_id, &receiver_id, bal + amount.0);
        }
        if let Some(id) = mint_id {
            self.mint_ids.insert(id);
        }
        let left = self.settle_storage(&caller, before, attached);
        pay(&caller, left);
        emit(
            "mt_mint",
            vec![json!({
                "owner_id": receiver_id,
                "token_ids": token_ids,
                "amounts": strings(&amounts.iter().map(|a| a.0).collect::<Vec<_>>()),
                "memo": memo,
            })],
        );
        true
    }

    /// Burns the caller's own copies. 1 yocto; the freed storage goes to their storage balance.
    #[payable]
    pub fn mt_burn(&mut self, token_ids: Vec<TokenId>, amounts: Vec<U128>, memo: Option<String>) {
        assert_one_yocto();
        validate_memo(&memo);
        require!(
            !token_ids.is_empty() && token_ids.len() <= MAX_BATCH,
            "Burn 1-16 token ids at a time"
        );
        require!(token_ids.len() == amounts.len(), "token_ids and amounts differ in length");
        let owner = env::predecessor_account_id();
        let before = env::storage_usage();
        for (token_id, amount) in token_ids.iter().zip(&amounts) {
            require!(amount.0 > 0, "amounts must be positive");
            let mut item = self.expect_item(token_id);
            let bal = self.balance(token_id, &owner);
            require!(bal >= amount.0, format!("Not enough {token_id} to burn"));
            self.set_balance(token_id, &owner, bal - amount.0);
            item.supply = U128(item.supply.0 - amount.0);
            self.items.insert(token_id.clone(), item);
        }
        self.settle_storage(&owner, before, 0);
        emit(
            "mt_burn",
            vec![json!({
                "owner_id": owner,
                "token_ids": token_ids,
                "amounts": strings(&amounts.iter().map(|a| a.0).collect::<Vec<_>>()),
                "memo": memo,
            })],
        );
    }

    // ---------- NEP-245 core ----------

    #[payable]
    pub fn mt_transfer(
        &mut self,
        receiver_id: AccountId,
        token_id: TokenId,
        amount: U128,
        approval: Option<(AccountId, u64)>,
        memo: Option<String>,
    ) {
        assert_one_yocto();
        let sender = env::predecessor_account_id();
        self.transfer_batch(
            &sender,
            &receiver_id,
            &[token_id],
            &[amount],
            approval.map(|a| vec![Some(a)]),
            memo,
        );
    }

    #[payable]
    pub fn mt_batch_transfer(
        &mut self,
        receiver_id: AccountId,
        token_ids: Vec<TokenId>,
        amounts: Vec<U128>,
        approvals: Option<Vec<Option<(AccountId, u64)>>>,
        memo: Option<String>,
    ) {
        assert_one_yocto();
        let sender = env::predecessor_account_id();
        self.transfer_batch(&sender, &receiver_id, &token_ids, &amounts, approvals, memo);
    }

    #[payable]
    pub fn mt_transfer_call(
        &mut self,
        receiver_id: AccountId,
        token_id: TokenId,
        amount: U128,
        approval: Option<(AccountId, u64)>,
        memo: Option<String>,
        msg: String,
    ) -> PromiseOrValue<Vec<U128>> {
        self.transfer_call(
            receiver_id,
            vec![token_id],
            vec![amount],
            approval.map(|a| vec![Some(a)]),
            memo,
            msg,
        )
    }

    #[payable]
    pub fn mt_batch_transfer_call(
        &mut self,
        receiver_id: AccountId,
        token_ids: Vec<TokenId>,
        amounts: Vec<U128>,
        approvals: Option<Vec<Option<(AccountId, u64)>>>,
        memo: Option<String>,
        msg: String,
    ) -> PromiseOrValue<Vec<U128>> {
        self.transfer_call(receiver_id, token_ids, amounts, approvals, memo, msg)
    }

    /// Callback of `mt_transfer_call` / `mt_batch_transfer_call`: moves the amounts the receiver
    /// did not use back to the previous owners (as far as the receiver still holds them) and
    /// returns the amounts the receiver kept, per token. A failed or unreadable `mt_on_transfer`
    /// returns everything.
    #[private]
    pub fn mt_resolve_transfer(
        &mut self,
        previous_owner_ids: Vec<AccountId>,
        receiver_id: AccountId,
        token_ids: Vec<TokenId>,
        amounts: Vec<U128>,
        approvals: Option<Vec<Option<Vec<(AccountId, u64, U128)>>>>,
    ) -> Vec<U128> {
        // Same check as #[private]; repeated in the body so unit tests exercise it.
        require!(
            env::predecessor_account_id() == env::current_account_id(),
            "Method mt_resolve_transfer is private"
        );
        let _ = approvals;
        let n = token_ids.len();
        require!(
            amounts.len() == n && previous_owner_ids.len() == n,
            "Argument lengths differ"
        );
        let all: Vec<u128> = amounts.iter().map(|a| a.0).collect();
        let unused: Vec<u128> = match env::promise_result_checked(0, MAX_RESULT_LEN) {
            Ok(bytes) => match serde_json::from_slice::<Vec<U128>>(&bytes) {
                Ok(v) if v.len() == n => v.iter().zip(&all).map(|(u, a)| u.0.min(*a)).collect(),
                _ => all.clone(),
            },
            Err(_) => all.clone(),
        };
        let mut kept = Vec::with_capacity(n);
        let mut refunds = Vec::new();
        for i in 0..n {
            let token_id = &token_ids[i];
            let held = self.balance(token_id, &receiver_id);
            let refund = unused[i].min(held);
            if refund > 0 {
                let prev = &previous_owner_ids[i];
                self.set_balance(token_id, &receiver_id, held - refund);
                let pb = self.balance(token_id, prev);
                self.set_balance(token_id, prev, pb + refund);
                refunds.push(json!({
                    "old_owner_id": receiver_id,
                    "new_owner_id": prev,
                    "token_ids": [token_id],
                    "amounts": [refund.to_string()],
                    "memo": "refund",
                }));
            }
            kept.push(U128(all[i] - refund));
        }
        if !refunds.is_empty() {
            emit("mt_transfer", refunds);
        }
        kept
    }

    pub fn mt_token(&self, token_ids: Vec<TokenId>) -> Vec<Option<Token>> {
        token_ids.iter().map(|id| self.token(id)).collect()
    }

    pub fn mt_balance_of(&self, account_id: AccountId, token_id: TokenId) -> U128 {
        U128(self.balance(&token_id, &account_id))
    }

    pub fn mt_batch_balance_of(&self, account_id: AccountId, token_ids: Vec<TokenId>) -> Vec<U128> {
        token_ids
            .iter()
            .map(|id| U128(self.balance(id, &account_id)))
            .collect()
    }

    pub fn mt_supply(&self, token_id: TokenId) -> Option<U128> {
        self.items.get(&token_id).map(|i| i.supply)
    }

    pub fn mt_batch_supply(&self, token_ids: Vec<TokenId>) -> Vec<Option<U128>> {
        token_ids
            .iter()
            .map(|id| self.items.get(id).map(|i| i.supply))
            .collect()
    }

    // ---------- enumeration ----------

    /// Item types in creation order.
    pub fn mt_tokens(&self, from_index: Option<U128>, limit: Option<u32>) -> Vec<Token> {
        let from = from_index.map_or(0, |v| v.0 as usize);
        let limit = limit.unwrap_or(MAX_PAGE).min(MAX_PAGE) as usize;
        self.items
            .iter()
            .skip(from)
            .take(limit)
            .map(|(id, item)| token_of(id, item))
            .collect()
    }

    /// Item types `account_id` holds at least one copy of.
    pub fn mt_tokens_for_owner(
        &self,
        account_id: AccountId,
        from_index: Option<U128>,
        limit: Option<u32>,
    ) -> Vec<Token> {
        let from = from_index.map_or(0, |v| v.0 as usize);
        let limit = limit.unwrap_or(MAX_PAGE).min(MAX_PAGE) as usize;
        self.owner_tokens
            .get(&account_id)
            .map(|ids| {
                ids.iter()
                    .skip(from)
                    .take(limit)
                    .filter_map(|id| self.token(id))
                    .collect()
            })
            .unwrap_or_default()
    }

    // ---------- metadata ----------

    pub fn mt_metadata_contract(&self) -> MtContractMetadata {
        self.metadata.clone()
    }

    pub fn mt_metadata_token_by_token_id(&self, token_ids: Vec<TokenId>) -> Vec<Option<MtTokenMetadata>> {
        token_ids
            .iter()
            .map(|id| self.items.get(id).map(|i| i.metadata.clone()))
            .collect()
    }

    // ---------- storage (NEP-145 style) ----------

    /// Adds the deposit to `account_id`'s (default: the caller's) storage balance. A new balance
    /// entry's own storage comes out of the deposit.
    #[payable]
    pub fn storage_deposit(&mut self, account_id: Option<AccountId>) -> StorageBalance {
        let account = account_id.unwrap_or_else(env::predecessor_account_id);
        let attached = env::attached_deposit().as_yoctonear();
        let credit = match self.storage.get(&account).copied() {
            Some(c) => c + attached,
            None => {
                let before = env::storage_usage();
                self.storage.insert(account.clone(), 0);
                self.storage.flush();
                let cost = env::storage_byte_cost()
                    .as_yoctonear()
                    .saturating_mul(env::storage_usage().saturating_sub(before) as u128);
                require!(
                    attached >= cost,
                    format!("Attach at least {cost} yoctoNEAR to register")
                );
                attached - cost
            }
        };
        self.storage.insert(account, credit);
        StorageBalance {
            total: U128(credit),
            available: U128(credit),
        }
    }

    /// Sends up to `amount` (default: all) of the caller's storage balance back. 1 yocto.
    #[payable]
    pub fn storage_withdraw(&mut self, amount: Option<U128>) -> StorageBalance {
        assert_one_yocto();
        let account = env::predecessor_account_id();
        let credit = self
            .storage
            .get(&account)
            .copied()
            .unwrap_or_else(|| env::panic_str("No storage balance"));
        let amount = amount.map_or(credit, |a| a.0);
        require!(amount <= credit, "Amount exceeds the storage balance");
        self.storage.insert(account.clone(), credit - amount);
        pay(&account, amount);
        StorageBalance {
            total: U128(credit - amount),
            available: U128(credit - amount),
        }
    }

    pub fn storage_balance_of(&self, account_id: AccountId) -> Option<StorageBalance> {
        self.storage.get(&account_id).map(|c| StorageBalance {
            total: U128(*c),
            available: U128(*c),
        })
    }

    // ---------- admin ----------

    #[payable]
    pub fn set_ops(&mut self, ops_id: AccountId) {
        assert_one_yocto();
        self.assert_owner();
        self.ops_id = ops_id;
    }

    #[payable]
    pub fn set_owner(&mut self, owner_id: AccountId) {
        assert_one_yocto();
        self.assert_owner();
        self.owner_id = owner_id;
    }

    pub fn get_config(&self) -> Config {
        Config {
            owner_id: self.owner_id.clone(),
            ops_id: self.ops_id.clone(),
            item_count: self.items.len(),
        }
    }

    /// Whether a `mint_id` was already minted.
    pub fn is_minted(&self, mint_id: String) -> bool {
        self.mint_ids.contains(&mint_id)
    }
}

fn token_of(id: &TokenId, item: &Item) -> Token {
    Token {
        token_id: id.clone(),
        owner_id: None,
        supply: item.supply,
        max_supply: item.max_supply,
        metadata: Some(item.metadata.clone()),
    }
}

impl Contract {
    fn assert_owner(&self) {
        require!(
            env::predecessor_account_id() == self.owner_id,
            "Only the owner can call this method"
        );
    }

    fn assert_minter(&self) {
        let p = env::predecessor_account_id();
        require!(
            p == self.owner_id || p == self.ops_id,
            "Only the owner or the platform ops account can call this method"
        );
    }

    fn expect_item(&self, token_id: &TokenId) -> Item {
        self.items
            .get(token_id)
            .cloned()
            .unwrap_or_else(|| env::panic_str(&format!("Unknown token_id {token_id}")))
    }

    fn token(&self, token_id: &TokenId) -> Option<Token> {
        self.items.get(token_id).map(|item| token_of(token_id, item))
    }

    fn balance(&self, token_id: &TokenId, account: &AccountId) -> u128 {
        self.balances
            .get(&(token_id.clone(), account.clone()))
            .copied()
            .unwrap_or(0)
    }

    /// Writes a balance; a zero balance removes the entry (and the owner's index entry).
    fn set_balance(&mut self, token_id: &TokenId, account: &AccountId, value: u128) {
        let key = (token_id.clone(), account.clone());
        if value == 0 {
            if self.balances.remove(&key).is_some() {
                let mut ids = self.owner_tokens.get(account).cloned().unwrap_or_default();
                ids.retain(|id| id != token_id);
                if ids.is_empty() {
                    self.owner_tokens.remove(account);
                } else {
                    self.owner_tokens.insert(account.clone(), ids);
                }
            }
        } else if self.balances.insert(key, value).is_none() {
            let mut ids = self.owner_tokens.get(account).cloned().unwrap_or_default();
            ids.push(token_id.clone());
            self.owner_tokens.insert(account.clone(), ids);
        }
    }

    fn flush(&mut self) {
        self.items.flush();
        self.balances.flush();
        self.owner_tokens.flush();
        self.storage.flush();
        // mint_ids is a LookupSet: it writes straight to storage, nothing to flush.
    }

    /// Settles what a call did to storage since `before`. Growth is paid by `payer`: from
    /// `attached` first, then from their storage balance (panics when both fall short). A shrink
    /// is credited to their storage balance when they have one. Returns the unused attachment.
    fn settle_storage(&mut self, payer: &AccountId, before: u64, attached: u128) -> u128 {
        self.flush();
        let after = env::storage_usage();
        let price = env::storage_byte_cost().as_yoctonear();
        if after > before {
            let cost = price.saturating_mul((after - before) as u128);
            if attached >= cost {
                return attached - cost;
            }
            let short = cost - attached;
            let credit = self.storage.get(payer).copied().unwrap_or(0);
            require!(
                credit >= short,
                format!(
                    "Storage costs {cost} yoctoNEAR: attach it or add {short} with storage_deposit"
                )
            );
            self.storage.insert(payer.clone(), credit - short);
            self.storage.flush();
            0
        } else {
            let freed = price.saturating_mul((before - after) as u128);
            if freed > 0 {
                if let Some(c) = self.storage.get(payer).copied() {
                    self.storage.insert(payer.clone(), c + freed);
                    self.storage.flush();
                }
            }
            attached
        }
    }

    /// Moves `amounts` of `token_ids` from `sender` to `receiver`, charges the storage change to
    /// the sender and logs one `mt_transfer` event.
    fn transfer_batch(
        &mut self,
        sender: &AccountId,
        receiver: &AccountId,
        token_ids: &[TokenId],
        amounts: &[U128],
        approvals: Option<Vec<Option<(AccountId, u64)>>>,
        memo: Option<String>,
    ) {
        require!(
            approvals.map_or(true, |a| a.iter().all(|x| x.is_none())),
            "Approvals are not supported"
        );
        validate_memo(&memo);
        require!(sender != receiver, "Sender and receiver must differ");
        require!(
            !token_ids.is_empty() && token_ids.len() <= MAX_BATCH,
            "Transfer 1-16 token ids at a time"
        );
        require!(token_ids.len() == amounts.len(), "token_ids and amounts differ in length");
        let before = env::storage_usage();
        for (token_id, amount) in token_ids.iter().zip(amounts) {
            require!(amount.0 > 0, "amounts must be positive");
            require!(self.items.get(token_id).is_some(), format!("Unknown token_id {token_id}"));
            let bal = self.balance(token_id, sender);
            require!(bal >= amount.0, format!("Not enough {token_id} to transfer"));
            self.set_balance(token_id, sender, bal - amount.0);
            let rb = self.balance(token_id, receiver);
            self.set_balance(token_id, receiver, rb + amount.0);
        }
        self.settle_storage(sender, before, 0);
        emit(
            "mt_transfer",
            vec![json!({
                "old_owner_id": sender,
                "new_owner_id": receiver,
                "token_ids": token_ids,
                "amounts": strings(&amounts.iter().map(|a| a.0).collect::<Vec<_>>()),
                "memo": memo,
            })],
        );
    }

    fn transfer_call(
        &mut self,
        receiver_id: AccountId,
        token_ids: Vec<TokenId>,
        amounts: Vec<U128>,
        approvals: Option<Vec<Option<(AccountId, u64)>>>,
        memo: Option<String>,
        msg: String,
    ) -> PromiseOrValue<Vec<U128>> {
        assert_one_yocto();
        require!(
            env::prepaid_gas() >= GAS_FOR_TRANSFER_CALL,
            "Attach at least 70 Tgas"
        );
        let sender = env::predecessor_account_id();
        self.transfer_batch(&sender, &receiver_id, &token_ids, &amounts, approvals, memo);
        let previous = vec![sender.clone(); token_ids.len()];
        ext_mt_receiver::ext(receiver_id.clone())
            .with_static_gas(GAS_FOR_MT_ON_TRANSFER)
            .mt_on_transfer(
                sender,
                previous.clone(),
                token_ids.clone(),
                amounts.clone(),
                msg,
            )
            .then(
                Self::ext(env::current_account_id())
                    .with_static_gas(GAS_FOR_RESOLVE_TRANSFER)
                    .with_unused_gas_weight(0)
                    .mt_resolve_transfer(previous, receiver_id, token_ids, amounts, None),
            )
            .into()
    }
}

#[cfg(test)]
mod tests;
