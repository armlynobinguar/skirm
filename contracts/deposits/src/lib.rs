//! skirm deposits contract (deposits.playskirm.testnet).
//!
//! A player tops up credits by calling `deposit()` with NEAR attached from their own wallet.
//! The contract logs a NEP-297 event `{player, amount, receipt}`; the backend reads the
//! transaction through RPC, checks receiver and amount, and adds credits once per receipt
//! (arch.md, Money and ownership: "Top up"). Credits themselves live offchain.
//!
//! The owner moves collected NEAR to the platform treasury with `withdraw`.

use near_sdk::json_types::{U128, U64};
use near_sdk::store::LookupMap;
use near_sdk::{
    assert_one_yocto, env, near, require, AccountId, BorshStorageKey, NearToken, PanicOnDefault,
    Promise,
};

/// Default smallest top-up: 0.01 NEAR (10 credits at the testnet rate of 1,000 credits per
/// NEAR). It also covers the storage of the deposit record many times over.
pub const DEFAULT_MIN_DEPOSIT: NearToken = NearToken::from_millinear(10);
/// Balance always left on the contract on top of its storage cost, so it never drops below
/// what it needs to keep existing.
pub const WITHDRAW_RESERVE: NearToken = NearToken::from_millinear(100);

pub const EVENT_STANDARD: &str = "skirm_deposits";

#[derive(BorshStorageKey)]
#[near]
enum StorageKey {
    Receipts,
    Totals,
}

/// One top-up as stored onchain. `receipt` is the contract-assigned sequence number the
/// backend uses as the idempotency key ("once per receipt").
#[derive(Clone, Debug, PartialEq, Eq)]
#[near(serializers = [borsh, json])]
pub struct DepositRecord {
    pub receipt: U64,
    pub player: AccountId,
    pub amount: U128,
    pub block_height: U64,
    pub timestamp_ms: U64,
}

#[derive(Clone, Debug, PartialEq, Eq)]
#[near(serializers = [json])]
pub struct Config {
    pub owner_id: AccountId,
    pub treasury_id: AccountId,
    pub min_deposit: U128,
    pub deposit_count: U64,
    pub total_deposited: U128,
    pub total_withdrawn: U128,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Contract {
    owner_id: AccountId,
    treasury_id: AccountId,
    min_deposit: NearToken,
    next_receipt: u64,
    total_deposited: NearToken,
    total_withdrawn: NearToken,
    receipts: LookupMap<u64, DepositRecord>,
    totals: LookupMap<AccountId, NearToken>,
}

fn emit_event(event: &str, data: near_sdk::serde_json::Value) {
    let json = near_sdk::serde_json::json!({
        "standard": EVENT_STANDARD,
        "version": "1.0.0",
        "event": event,
        "data": [data],
    });
    env::log_str(&format!("EVENT_JSON:{}", json));
}

#[near]
impl Contract {
    #[init]
    pub fn new(owner_id: AccountId, treasury_id: AccountId, min_deposit: Option<U128>) -> Self {
        Self {
            owner_id,
            treasury_id,
            min_deposit: min_deposit
                .map(|v| NearToken::from_yoctonear(v.0))
                .unwrap_or(DEFAULT_MIN_DEPOSIT),
            next_receipt: 1,
            total_deposited: NearToken::from_yoctonear(0),
            total_withdrawn: NearToken::from_yoctonear(0),
            receipts: LookupMap::new(StorageKey::Receipts),
            totals: LookupMap::new(StorageKey::Totals),
        }
    }

    /// Top up: attach NEAR. Emits
    /// `EVENT_JSON:{"standard":"skirm_deposits","version":"1.0.0","event":"deposit","data":[{"player","amount","receipt",...}]}`
    /// and returns the receipt number.
    #[payable]
    pub fn deposit(&mut self) -> U64 {
        let amount = env::attached_deposit();
        require!(
            amount >= self.min_deposit && !amount.is_zero(),
            format!(
                "Deposit must be at least {} yoctoNEAR",
                self.min_deposit.as_yoctonear()
            )
        );
        let player = env::predecessor_account_id();
        let receipt = self.next_receipt;
        self.next_receipt += 1;

        let record = DepositRecord {
            receipt: U64(receipt),
            player: player.clone(),
            amount: U128(amount.as_yoctonear()),
            block_height: U64(env::block_height()),
            timestamp_ms: U64(env::block_timestamp_ms()),
        };
        self.receipts.insert(receipt, record.clone());
        let prev = self
            .totals
            .get(&player)
            .copied()
            .unwrap_or(NearToken::from_yoctonear(0));
        self.totals.insert(player, prev.saturating_add(amount));
        self.total_deposited = self.total_deposited.saturating_add(amount);

        emit_event("deposit", near_sdk::serde_json::to_value(&record).unwrap());
        U64(receipt)
    }

    /// Owner only: send `amount` (default: everything withdrawable) to the treasury.
    /// Requires 1 yoctoNEAR so a function-call key cannot trigger it.
    #[payable]
    pub fn withdraw(&mut self, amount: Option<U128>) -> Promise {
        assert_one_yocto();
        self.assert_owner();
        let available = Self::available_balance();
        let amount = amount
            .map(|a| NearToken::from_yoctonear(a.0))
            .unwrap_or(available);
        require!(!amount.is_zero(), "Nothing to withdraw");
        require!(
            amount <= available,
            "Amount exceeds the withdrawable balance"
        );
        self.total_withdrawn = self.total_withdrawn.saturating_add(amount);
        emit_event(
            "withdraw",
            near_sdk::serde_json::json!({
                "treasury": self.treasury_id,
                "amount": U128(amount.as_yoctonear()),
            }),
        );
        Promise::new(self.treasury_id.clone()).transfer(amount)
    }

    #[payable]
    pub fn set_treasury(&mut self, treasury_id: AccountId) {
        assert_one_yocto();
        self.assert_owner();
        self.treasury_id = treasury_id;
    }

    #[payable]
    pub fn set_min_deposit(&mut self, min_deposit: U128) {
        assert_one_yocto();
        self.assert_owner();
        self.min_deposit = NearToken::from_yoctonear(min_deposit.0);
    }

    #[payable]
    pub fn set_owner(&mut self, owner_id: AccountId) {
        assert_one_yocto();
        self.assert_owner();
        self.owner_id = owner_id;
    }

    // ---------- views ----------

    pub fn get_deposit(&self, receipt: U64) -> Option<DepositRecord> {
        self.receipts.get(&receipt.0).cloned()
    }

    pub fn total_deposited_by(&self, account_id: AccountId) -> U128 {
        U128(
            self.totals
                .get(&account_id)
                .map(|t| t.as_yoctonear())
                .unwrap_or(0),
        )
    }

    pub fn get_config(&self) -> Config {
        Config {
            owner_id: self.owner_id.clone(),
            treasury_id: self.treasury_id.clone(),
            min_deposit: U128(self.min_deposit.as_yoctonear()),
            deposit_count: U64(self.next_receipt - 1),
            total_deposited: U128(self.total_deposited.as_yoctonear()),
            total_withdrawn: U128(self.total_withdrawn.as_yoctonear()),
        }
    }

    /// Balance the owner can withdraw now: balance minus storage cost minus the reserve.
    pub fn withdrawable(&self) -> U128 {
        U128(Self::available_balance().as_yoctonear())
    }
}

impl Contract {
    fn available_balance() -> NearToken {
        let storage = env::storage_byte_cost().saturating_mul(env::storage_usage() as u128);
        env::account_balance()
            .saturating_sub(storage)
            .saturating_sub(WITHDRAW_RESERVE)
    }

    fn assert_owner(&self) {
        require!(
            env::predecessor_account_id() == self.owner_id,
            "Only the owner can call this method"
        );
    }
}

#[cfg(test)]
mod tests;
