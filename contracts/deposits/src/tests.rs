use super::*;
use near_sdk::mock::MockAction;
use near_sdk::test_utils::{get_created_receipts, get_logs, VMContextBuilder};
use near_sdk::{testing_env, NearToken};

fn owner() -> AccountId {
    "playskirm.testnet".parse().unwrap()
}
fn treasury() -> AccountId {
    "treasury.playskirm.testnet".parse().unwrap()
}
fn player() -> AccountId {
    "tyron.testnet".parse().unwrap()
}
fn contract_id() -> AccountId {
    "deposits.playskirm.testnet".parse().unwrap()
}

fn ctx(predecessor: AccountId, deposit: NearToken) -> VMContextBuilder {
    let mut b = VMContextBuilder::new();
    b.current_account_id(contract_id())
        .signer_account_id(predecessor.clone())
        .predecessor_account_id(predecessor)
        .attached_deposit(deposit)
        .account_balance(NearToken::from_near(10))
        .block_height(1234)
        .block_timestamp(1_762_000_000_000_000_000);
    b
}

fn setup() -> Contract {
    testing_env!(ctx(owner(), NearToken::from_yoctonear(0)).build());
    Contract::new(owner(), treasury(), None)
}

#[test]
fn deposit_logs_nep297_event_and_stores_record() {
    let mut c = setup();
    testing_env!(ctx(player(), NearToken::from_near(2)).build());
    let receipt = c.deposit();
    assert_eq!(receipt, U64(1));

    let logs = get_logs();
    assert_eq!(logs.len(), 1);
    let log = &logs[0];
    assert!(log.starts_with("EVENT_JSON:"), "{log}");
    let v: near_sdk::serde_json::Value =
        near_sdk::serde_json::from_str(&log["EVENT_JSON:".len()..]).unwrap();
    assert_eq!(v["standard"], "skirm_deposits");
    assert_eq!(v["version"], "1.0.0");
    assert_eq!(v["event"], "deposit");
    let d = &v["data"][0];
    assert_eq!(d["player"], "tyron.testnet");
    assert_eq!(d["amount"], "2000000000000000000000000");
    assert_eq!(d["receipt"], "1");
    assert_eq!(d["block_height"], "1234");

    let rec = c.get_deposit(U64(1)).unwrap();
    assert_eq!(rec.player, player());
    assert_eq!(rec.amount, U128(NearToken::from_near(2).as_yoctonear()));
    assert_eq!(
        c.total_deposited_by(player()),
        U128(NearToken::from_near(2).as_yoctonear())
    );
    assert!(c.get_deposit(U64(2)).is_none());
}

#[test]
fn receipts_are_sequential_and_totals_accumulate() {
    let mut c = setup();
    testing_env!(ctx(player(), NearToken::from_near(1)).build());
    assert_eq!(c.deposit(), U64(1));
    testing_env!(ctx(player(), NearToken::from_millinear(500)).build());
    assert_eq!(c.deposit(), U64(2));
    let other: AccountId = "jev.testnet".parse().unwrap();
    testing_env!(ctx(other.clone(), NearToken::from_near(3)).build());
    assert_eq!(c.deposit(), U64(3));

    assert_eq!(
        c.total_deposited_by(player()),
        U128(NearToken::from_millinear(1500).as_yoctonear())
    );
    assert_eq!(
        c.total_deposited_by(other),
        U128(NearToken::from_near(3).as_yoctonear())
    );
    let cfg = c.get_config();
    assert_eq!(cfg.deposit_count, U64(3));
    assert_eq!(
        cfg.total_deposited,
        U128(NearToken::from_millinear(4500).as_yoctonear())
    );
}

#[test]
#[should_panic(expected = "Deposit must be at least")]
fn deposit_below_minimum_rejected() {
    let mut c = setup();
    testing_env!(ctx(player(), NearToken::from_millinear(9)).build());
    c.deposit();
}

#[test]
#[should_panic(expected = "Deposit must be at least")]
fn zero_deposit_rejected_even_with_zero_minimum() {
    testing_env!(ctx(owner(), NearToken::from_yoctonear(0)).build());
    let mut c = Contract::new(owner(), treasury(), Some(U128(0)));
    testing_env!(ctx(player(), NearToken::from_yoctonear(0)).build());
    c.deposit();
}

#[test]
fn owner_withdraws_everything_withdrawable_to_treasury() {
    let mut c = setup();
    testing_env!(ctx(player(), NearToken::from_near(2)).build());
    c.deposit();

    testing_env!(ctx(owner(), NearToken::from_yoctonear(1)).build());
    let expected = c.withdrawable();
    assert!(expected.0 > 0);
    let _ = c.withdraw(None);
    let receipts = get_created_receipts();
    assert_eq!(receipts.len(), 1);
    assert_eq!(receipts[0].receiver_id, treasury());
    match &receipts[0].actions[0] {
        MockAction::Transfer { deposit, .. } => assert_eq!(deposit.as_yoctonear(), expected.0),
        a => panic!("unexpected action {a:?}"),
    }
    assert_eq!(c.get_config().total_withdrawn, expected);
}

#[test]
fn owner_withdraws_partial_amount() {
    let mut c = setup();
    testing_env!(ctx(owner(), NearToken::from_yoctonear(1)).build());
    let _ = c.withdraw(Some(U128(NearToken::from_near(1).as_yoctonear())));
    let receipts = get_created_receipts();
    match &receipts[0].actions[0] {
        MockAction::Transfer { deposit, .. } => assert_eq!(*deposit, NearToken::from_near(1)),
        a => panic!("unexpected action {a:?}"),
    }
}

#[test]
fn withdrawable_keeps_storage_and_reserve() {
    let c = setup();
    let mut b = ctx(owner(), NearToken::from_yoctonear(0));
    b.account_balance(NearToken::from_near(1))
        .storage_usage(10_000);
    testing_env!(b.build());
    let storage = env::storage_byte_cost().saturating_mul(10_000);
    let expected = NearToken::from_near(1)
        .saturating_sub(storage)
        .saturating_sub(WITHDRAW_RESERVE);
    assert_eq!(c.withdrawable(), U128(expected.as_yoctonear()));
}

#[test]
#[should_panic(expected = "Amount exceeds the withdrawable balance")]
fn withdraw_more_than_available_rejected() {
    let mut c = setup();
    testing_env!(ctx(owner(), NearToken::from_yoctonear(1)).build());
    let _ = c.withdraw(Some(U128(NearToken::from_near(10).as_yoctonear())));
}

#[test]
#[should_panic(expected = "Only the owner can call this method")]
fn non_owner_cannot_withdraw() {
    let mut c = setup();
    testing_env!(ctx(player(), NearToken::from_yoctonear(1)).build());
    let _ = c.withdraw(None);
}

#[test]
#[should_panic(expected = "Requires attached deposit of exactly 1 yoctoNEAR")]
fn withdraw_requires_one_yocto() {
    let mut c = setup();
    testing_env!(ctx(owner(), NearToken::from_yoctonear(0)).build());
    let _ = c.withdraw(None);
}

#[test]
fn owner_updates_config() {
    let mut c = setup();
    testing_env!(ctx(owner(), NearToken::from_yoctonear(1)).build());
    let new_treasury: AccountId = "vault.playskirm.testnet".parse().unwrap();
    c.set_treasury(new_treasury.clone());
    c.set_min_deposit(U128(5));
    let new_owner: AccountId = "admin.playskirm.testnet".parse().unwrap();
    c.set_owner(new_owner.clone());
    let cfg = c.get_config();
    assert_eq!(cfg.treasury_id, new_treasury);
    assert_eq!(cfg.min_deposit, U128(5));
    assert_eq!(cfg.owner_id, new_owner);
}

#[test]
#[should_panic(expected = "Only the owner can call this method")]
fn non_owner_cannot_set_treasury() {
    let mut c = setup();
    testing_env!(ctx(player(), NearToken::from_yoctonear(1)).build());
    c.set_treasury(player());
}

#[test]
#[should_panic(expected = "Only the owner can call this method")]
fn non_owner_cannot_set_min_deposit() {
    let mut c = setup();
    testing_env!(ctx(player(), NearToken::from_yoctonear(1)).build());
    c.set_min_deposit(U128(0));
}

#[test]
#[should_panic(expected = "Only the owner can call this method")]
fn non_owner_cannot_set_owner() {
    let mut c = setup();
    testing_env!(ctx(player(), NearToken::from_yoctonear(1)).build());
    c.set_owner(player());
}
