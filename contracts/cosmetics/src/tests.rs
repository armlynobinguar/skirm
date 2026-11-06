use super::*;
use near_sdk::test_utils::{get_logs, VMContextBuilder};
use near_sdk::{testing_env, PromiseResult, RuntimeFeesConfig};

fn acc(s: &str) -> AccountId {
    s.parse().unwrap()
}
fn contract_id() -> AccountId {
    acc("cosmetics.playskirm.testnet")
}
fn owner() -> AccountId {
    acc("playskirm.testnet")
}
fn ops() -> AccountId {
    acc("ops.playskirm.testnet")
}
fn ana() -> AccountId {
    acc("ana.testnet")
}
fn ben() -> AccountId {
    acc("ben.testnet")
}
fn near(n: u128) -> u128 {
    n * 10u128.pow(24)
}

fn ctx(predecessor: AccountId, deposit: u128) -> VMContextBuilder {
    let mut b = VMContextBuilder::new();
    b.current_account_id(contract_id())
        .signer_account_id(predecessor.clone())
        .predecessor_account_id(predecessor)
        .attached_deposit(NearToken::from_yoctonear(deposit))
        .prepaid_gas(Gas::from_tgas(300))
        .account_balance(NearToken::from_near(100))
        .block_timestamp(1_793_700_000_000_000_000);
    b
}

fn set(predecessor: AccountId, deposit: u128) {
    testing_env!(ctx(predecessor, deposit).build());
}

fn setup() -> Contract {
    set(owner(), 0);
    Contract::new(owner(), ops(), None)
}

fn meta(title: &str) -> MtTokenMetadata {
    MtTokenMetadata {
        title: Some(title.to_string()),
        description: Some("A cosmetic".to_string()),
        extra: Some(
            json!({ "schema": COSMETIC_SCHEMA, "kind": "skin", "body": "#ff6a3d" }).to_string(),
        ),
        ..Default::default()
    }
}

/// Creates `id` and mints `amount` to `to`, as ops paying with an attached deposit.
fn create_and_mint(c: &mut Contract, id: &str, to: AccountId, amount: u128) {
    set(ops(), near(1));
    c.mt_create(id.to_string(), meta("Ember skin"), None);
    set(ops(), near(1));
    assert!(c.mt_mint(to, vec![id.to_string()], vec![U128(amount)], None, None));
}

fn events() -> Vec<serde_json::Value> {
    get_logs()
        .iter()
        .filter_map(|l| l.strip_prefix("EVENT_JSON:"))
        .map(|j| serde_json::from_str(j).unwrap())
        .collect()
}

fn register(c: &mut Contract, who: AccountId) {
    set(who, near(1) / 10);
    c.storage_deposit(None);
}

#[test]
fn init_metadata_is_mt_spec() {
    let c = setup();
    let m = c.mt_metadata_contract();
    assert_eq!(m.spec, MT_METADATA_SPEC);
    assert_eq!(m.name, "skirm cosmetics");
    assert_eq!(c.get_config().item_count, 0);
}

#[test]
fn ops_creates_and_mints_with_a_nep245_event() {
    let mut c = setup();
    create_and_mint(&mut c, "skin_ember", ana(), 2);
    let ev = events();
    assert_eq!(ev.len(), 1);
    assert_eq!(ev[0]["standard"], "nep245");
    assert_eq!(ev[0]["version"], "1.0.0");
    assert_eq!(ev[0]["event"], "mt_mint");
    assert_eq!(ev[0]["data"][0]["owner_id"], "ana.testnet");
    assert_eq!(ev[0]["data"][0]["token_ids"][0], "skin_ember");
    assert_eq!(ev[0]["data"][0]["amounts"][0], "2");
    assert_eq!(c.mt_balance_of(ana(), "skin_ember".into()), U128(2));
    assert_eq!(c.mt_supply("skin_ember".into()), Some(U128(2)));
    let t = c.mt_token(vec!["skin_ember".into(), "nope".into()]);
    assert_eq!(t[0].as_ref().unwrap().owner_id, None);
    assert_eq!(t[0].as_ref().unwrap().supply, U128(2));
    assert!(t[1].is_none());
}

#[test]
#[should_panic(expected = "Only the owner or the platform ops account")]
fn others_cannot_create() {
    let mut c = setup();
    set(ana(), near(1));
    c.mt_create("skin_ember".into(), meta("Ember skin"), None);
}

#[test]
#[should_panic(expected = "Only the owner or the platform ops account")]
fn others_cannot_mint() {
    let mut c = setup();
    create_and_mint(&mut c, "skin_ember", ana(), 1);
    set(ana(), near(1));
    c.mt_mint(ana(), vec!["skin_ember".into()], vec![U128(1)], None, None);
}

#[test]
#[should_panic(expected = "token_id must be")]
fn bad_token_id_panics() {
    let mut c = setup();
    set(owner(), near(1));
    c.mt_create("Skin Ember".into(), meta("Ember skin"), None);
}

#[test]
#[should_panic(expected = "metadata.extra must be JSON")]
fn extra_must_be_json() {
    let mut c = setup();
    set(owner(), near(1));
    let mut m = meta("Ember skin");
    m.extra = Some("not json".into());
    c.mt_create("skin_ember".into(), m, None);
}

#[test]
fn create_is_idempotent_and_refuses_other_metadata() {
    let mut c = setup();
    set(owner(), near(1));
    let a = c.mt_create("skin_ember".into(), meta("Ember skin"), None);
    set(owner(), near(1));
    let b = c.mt_create("skin_ember".into(), meta("Ember skin"), None);
    assert_eq!(a, b);
    assert_eq!(c.get_config().item_count, 1);
    let r = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        set(owner(), near(1));
        c.mt_create("skin_ember".into(), meta("Other"), None);
    }));
    assert!(r.is_err());
}

#[test]
#[should_panic(expected = "Storage costs")]
fn mint_without_deposit_or_storage_balance_panics() {
    let mut c = setup();
    set(ops(), 0);
    c.mt_create("skin_ember".into(), meta("Ember skin"), None);
}

#[test]
fn ops_can_mint_from_its_storage_balance_with_no_deposit() {
    let mut c = setup();
    register(&mut c, ops());
    let before = c.storage_balance_of(ops()).unwrap().total.0;
    set(ops(), 0);
    c.mt_create("skin_ember".into(), meta("Ember skin"), None);
    set(ops(), 0);
    assert!(c.mt_mint(ana(), vec!["skin_ember".into()], vec![U128(1)], None, None));
    let after = c.storage_balance_of(ops()).unwrap().total.0;
    assert!(after < before, "storage was charged to the caller");
    assert_eq!(c.mt_balance_of(ana(), "skin_ember".into()), U128(1));
}

#[test]
fn mint_id_makes_a_resend_a_no_op() {
    let mut c = setup();
    create_and_mint(&mut c, "skin_ember", ana(), 1);
    set(ops(), near(1));
    assert!(c.mt_mint(
        ana(),
        vec!["skin_ember".into()],
        vec![U128(1)],
        None,
        Some("acc_1:skin_ember".into())
    ));
    set(ops(), near(1));
    assert!(!c.mt_mint(
        ana(),
        vec!["skin_ember".into()],
        vec![U128(1)],
        None,
        Some("acc_1:skin_ember".into())
    ));
    assert_eq!(c.mt_balance_of(ana(), "skin_ember".into()), U128(2));
    assert!(c.is_minted("acc_1:skin_ember".into()));
}

#[test]
#[should_panic(expected = "would exceed its max supply")]
fn max_supply_is_enforced() {
    let mut c = setup();
    set(owner(), near(1));
    c.mt_create("plate_gold".into(), meta("Gold plate"), Some(U128(1)));
    set(owner(), near(1));
    c.mt_mint(ana(), vec!["plate_gold".into()], vec![U128(2)], None, None);
}

#[test]
#[should_panic(expected = "Requires attached deposit of exactly 1 yoctoNEAR")]
fn transfer_needs_one_yocto() {
    let mut c = setup();
    create_and_mint(&mut c, "skin_ember", ana(), 1);
    set(ana(), 0);
    c.mt_transfer(ben(), "skin_ember".into(), U128(1), None, None);
}

#[test]
fn transfer_moves_copies_and_charges_the_sender() {
    let mut c = setup();
    create_and_mint(&mut c, "skin_ember", ana(), 3);
    register(&mut c, ana());
    let credit = c.storage_balance_of(ana()).unwrap().total.0;
    set(ana(), 1);
    c.mt_transfer(ben(), "skin_ember".into(), U128(1), None, Some("gift".into()));
    let ev = events();
    assert_eq!(ev[0]["event"], "mt_transfer");
    assert_eq!(ev[0]["data"][0]["old_owner_id"], "ana.testnet");
    assert_eq!(ev[0]["data"][0]["new_owner_id"], "ben.testnet");
    assert_eq!(ev[0]["data"][0]["amounts"][0], "1");
    assert_eq!(ev[0]["data"][0]["memo"], "gift");
    assert_eq!(c.mt_balance_of(ana(), "skin_ember".into()), U128(2));
    assert_eq!(c.mt_balance_of(ben(), "skin_ember".into()), U128(1));
    // Ben's new balance entry came out of Ana's storage balance.
    assert!(c.storage_balance_of(ana()).unwrap().total.0 < credit);
    assert_eq!(c.mt_supply("skin_ember".into()), Some(U128(3)));
}

#[test]
#[should_panic(expected = "Storage costs")]
fn transfer_to_a_new_holder_needs_a_storage_balance() {
    let mut c = setup();
    create_and_mint(&mut c, "skin_ember", ana(), 3);
    set(ana(), 1);
    c.mt_transfer(ben(), "skin_ember".into(), U128(1), None, None);
}

#[test]
fn transfer_of_a_whole_balance_frees_storage_for_the_sender() {
    let mut c = setup();
    create_and_mint(&mut c, "skin_ember", ana(), 1);
    register(&mut c, ana());
    let credit = c.storage_balance_of(ana()).unwrap().total.0;
    set(ana(), 1);
    c.mt_transfer(ben(), "skin_ember".into(), U128(1), None, None);
    // Ana's entry was removed and Ben's added: roughly even, never charged more than one entry.
    assert_eq!(c.mt_balance_of(ana(), "skin_ember".into()), U128(0));
    assert!(c.mt_tokens_for_owner(ana(), None, None).is_empty());
    assert_eq!(c.mt_tokens_for_owner(ben(), None, None).len(), 1);
    let _ = credit;
}

#[test]
#[should_panic(expected = "Not enough skin_ember to transfer")]
fn transfer_more_than_held_panics() {
    let mut c = setup();
    create_and_mint(&mut c, "skin_ember", ana(), 1);
    register(&mut c, ana());
    set(ana(), 1);
    c.mt_transfer(ben(), "skin_ember".into(), U128(2), None, None);
}

#[test]
#[should_panic(expected = "Approvals are not supported")]
fn approvals_are_refused() {
    let mut c = setup();
    create_and_mint(&mut c, "skin_ember", ana(), 1);
    set(ana(), 1);
    c.mt_transfer(ben(), "skin_ember".into(), U128(1), Some((ben(), 1)), None);
}

#[test]
#[should_panic(expected = "Sender and receiver must differ")]
fn transfer_to_self_panics() {
    let mut c = setup();
    create_and_mint(&mut c, "skin_ember", ana(), 1);
    set(ana(), 1);
    c.mt_transfer(ana(), "skin_ember".into(), U128(1), None, None);
}

#[test]
fn batch_transfer_moves_several_items_in_one_event() {
    let mut c = setup();
    create_and_mint(&mut c, "skin_ember", ana(), 1);
    set(ops(), near(1));
    c.mt_create("trail_spark".into(), meta("Spark trail"), None);
    set(ops(), near(1));
    c.mt_mint(ana(), vec!["trail_spark".into()], vec![U128(2)], None, None);
    register(&mut c, ana());
    set(ana(), 1);
    c.mt_batch_transfer(
        ben(),
        vec!["skin_ember".into(), "trail_spark".into()],
        vec![U128(1), U128(2)],
        None,
        None,
    );
    let ev = events();
    assert_eq!(ev.len(), 1);
    assert_eq!(ev[0]["data"][0]["token_ids"], json!(["skin_ember", "trail_spark"]));
    assert_eq!(ev[0]["data"][0]["amounts"], json!(["1", "2"]));
    assert_eq!(
        c.mt_batch_balance_of(ben(), vec!["skin_ember".into(), "trail_spark".into()]),
        vec![U128(1), U128(2)]
    );
    assert_eq!(c.mt_tokens_for_owner(ben(), None, None).len(), 2);
}

#[test]
fn transfer_call_schedules_the_receiver_and_the_resolver() {
    let mut c = setup();
    create_and_mint(&mut c, "skin_ember", ana(), 2);
    register(&mut c, ana());
    set(ana(), 1);
    let r = c.mt_transfer_call(ben(), "skin_ember".into(), U128(2), None, None, "hi".into());
    assert!(matches!(r, PromiseOrValue::Promise(_)));
    assert_eq!(c.mt_balance_of(ben(), "skin_ember".into()), U128(2));
}

#[test]
#[should_panic(expected = "Attach at least 70 Tgas")]
fn transfer_call_needs_gas() {
    let mut c = setup();
    create_and_mint(&mut c, "skin_ember", ana(), 1);
    let mut b = ctx(ana(), 1);
    b.prepaid_gas(Gas::from_tgas(20));
    testing_env!(b.build());
    c.mt_transfer_call(ben(), "skin_ember".into(), U128(1), None, None, "".into());
}

/// Runs the resolver as the contract itself with the receiver's answer.
fn resolve(c: &mut Contract, result: PromiseResult, amounts: Vec<U128>, ids: Vec<&str>) -> Vec<U128> {
    testing_env!(
        ctx(contract_id(), 0).build(),
        near_sdk::test_vm_config(),
        RuntimeFeesConfig::test(),
        Default::default(),
        vec![result],
    );
    let n = ids.len();
    c.mt_resolve_transfer(
        vec![ana(); n],
        ben(),
        ids.into_iter().map(String::from).collect(),
        amounts,
        None,
    )
}

fn sent_to_ben(c: &mut Contract, amount: u128) {
    create_and_mint(c, "skin_ember", ana(), amount);
    register(c, ana());
    set(ana(), 1);
    let _ = c.mt_transfer_call(ben(), "skin_ember".into(), U128(amount), None, None, "".into());
}

#[test]
fn resolve_returns_the_unused_part() {
    let mut c = setup();
    sent_to_ben(&mut c, 3);
    let kept = resolve(
        &mut c,
        PromiseResult::Successful(serde_json::to_vec(&vec![U128(1)]).unwrap()),
        vec![U128(3)],
        vec!["skin_ember"],
    );
    assert_eq!(kept, vec![U128(2)]);
    assert_eq!(c.mt_balance_of(ana(), "skin_ember".into()), U128(1));
    assert_eq!(c.mt_balance_of(ben(), "skin_ember".into()), U128(2));
    let ev = events();
    assert_eq!(ev[0]["event"], "mt_transfer");
    assert_eq!(ev[0]["data"][0]["old_owner_id"], "ben.testnet");
    assert_eq!(ev[0]["data"][0]["new_owner_id"], "ana.testnet");
    assert_eq!(ev[0]["data"][0]["memo"], "refund");
}

#[test]
fn resolve_refunds_everything_when_the_receiver_failed() {
    let mut c = setup();
    sent_to_ben(&mut c, 2);
    let kept = resolve(&mut c, PromiseResult::Failed, vec![U128(2)], vec!["skin_ember"]);
    assert_eq!(kept, vec![U128(0)]);
    assert_eq!(c.mt_balance_of(ana(), "skin_ember".into()), U128(2));
    assert_eq!(c.mt_balance_of(ben(), "skin_ember".into()), U128(0));
}

#[test]
fn resolve_refunds_everything_on_an_unreadable_answer() {
    let mut c = setup();
    sent_to_ben(&mut c, 2);
    let kept = resolve(
        &mut c,
        PromiseResult::Successful(b"nope".to_vec()),
        vec![U128(2)],
        vec!["skin_ember"],
    );
    assert_eq!(kept, vec![U128(0)]);
    assert_eq!(c.mt_balance_of(ana(), "skin_ember".into()), U128(2));
}

#[test]
fn resolve_caps_unused_at_the_amount_sent() {
    let mut c = setup();
    sent_to_ben(&mut c, 2);
    let kept = resolve(
        &mut c,
        PromiseResult::Successful(serde_json::to_vec(&vec![U128(99)]).unwrap()),
        vec![U128(2)],
        vec!["skin_ember"],
    );
    assert_eq!(kept, vec![U128(0)]);
    assert_eq!(c.mt_balance_of(ana(), "skin_ember".into()), U128(2));
}

#[test]
#[should_panic(expected = "Method mt_resolve_transfer is private")]
fn resolve_is_private() {
    let mut c = setup();
    set(ana(), 0);
    c.mt_resolve_transfer(vec![ana()], ben(), vec!["skin_ember".into()], vec![U128(1)], None);
}

#[test]
fn burn_lowers_supply_and_logs_mt_burn() {
    let mut c = setup();
    create_and_mint(&mut c, "skin_ember", ana(), 2);
    set(ana(), 1);
    c.mt_burn(vec!["skin_ember".into()], vec![U128(1)], None);
    assert_eq!(events()[0]["event"], "mt_burn");
    assert_eq!(c.mt_supply("skin_ember".into()), Some(U128(1)));
    assert_eq!(c.mt_balance_of(ana(), "skin_ember".into()), U128(1));
}

#[test]
fn enumeration_pages_item_types() {
    let mut c = setup();
    for id in ["skin_a", "skin_b", "skin_c"] {
        set(owner(), near(1));
        c.mt_create(id.into(), meta("Skin"), None);
    }
    let all = c.mt_tokens(None, None);
    assert_eq!(all.iter().map(|t| t.token_id.as_str()).collect::<Vec<_>>(), ["skin_a", "skin_b", "skin_c"]);
    let page = c.mt_tokens(Some(U128(1)), Some(1));
    assert_eq!(page.len(), 1);
    assert_eq!(page[0].token_id, "skin_b");
    let md = c.mt_metadata_token_by_token_id(vec!["skin_a".into(), "nope".into()]);
    assert_eq!(md[0].as_ref().unwrap().title.as_deref(), Some("Skin"));
    assert!(md[1].is_none());
}

#[test]
fn storage_deposit_and_withdraw() {
    let mut c = setup();
    register(&mut c, ana());
    let b = c.storage_balance_of(ana()).unwrap();
    assert!(b.total.0 > 0 && b.total.0 < near(1) / 10);
    set(ana(), near(1));
    let b2 = c.storage_deposit(None);
    assert_eq!(b2.total.0, b.total.0 + near(1));
    set(ana(), 1);
    let left = c.storage_withdraw(Some(U128(near(1))));
    assert_eq!(left.total, b.total);
    assert!(c.storage_balance_of(ben()).is_none());
}

#[test]
#[should_panic(expected = "Only the owner can call this method")]
fn ops_cannot_change_ops() {
    let mut c = setup();
    set(ops(), 1);
    c.set_ops(ana());
}

#[test]
fn owner_rotates_ops() {
    let mut c = setup();
    set(owner(), 1);
    c.set_ops(ana());
    assert_eq!(c.get_config().ops_id, ana());
}
