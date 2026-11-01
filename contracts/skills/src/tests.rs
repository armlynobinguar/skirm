use super::*;
use near_sdk::mock::MockAction;
use near_sdk::test_utils::{get_created_receipts, get_logs, VMContextBuilder};
use near_sdk::{testing_env, NearToken};

const SKILL_ID: &str = "skl_01JB7Z3K9QX4M2T8V6N5R1C0DE";
const SHA: &str = "9f2c0e6b4a1d3c5e7f9a0b2c4d6e8f1a3b5c7d9e0f2a4b6c8d0e1f3a5b7c9d0e";

fn acc(s: &str) -> AccountId {
    s.parse().unwrap()
}
fn owner() -> AccountId {
    acc("playskirm.testnet")
}
fn ops() -> AccountId {
    acc("ops.playskirm.testnet")
}
fn creator() -> AccountId {
    acc("tyron.testnet")
}
fn buyer() -> AccountId {
    acc("jev.testnet")
}
fn market() -> AccountId {
    acc("market.playskirm.testnet")
}
fn near(n: u128) -> u128 {
    NearToken::from_near(n).as_yoctonear()
}

fn ctx(predecessor: AccountId, deposit: NearToken) -> VMContextBuilder {
    let mut b = VMContextBuilder::new();
    b.current_account_id(acc("skills.playskirm.testnet"))
        .signer_account_id(predecessor.clone())
        .predecessor_account_id(predecessor)
        .attached_deposit(deposit)
        .account_balance(NearToken::from_near(100));
    b
}

fn set(predecessor: AccountId, deposit: NearToken) {
    testing_env!(ctx(predecessor, deposit).build());
}

fn setup() -> Contract {
    set(owner(), NearToken::from_yoctonear(0));
    Contract::new(owner(), ops(), None, None)
}

fn skill() -> SkillMint {
    SkillMint {
        id: SKILL_ID.to_string(),
        version: 1,
        name: "Flood Warden's Heir".to_string(),
        summary: Some("Seals the leak before it spreads, then does the job.".to_string()),
        creator: creator(),
        royalty_bps: None,
        requires_actions: vec!["place_block".to_string()],
        handles_tags: vec!["spreads".to_string(), "liquid".to_string()],
        prompt_sha256: SHA.to_string(),
        created_at: "2026-11-03T08:15:00Z".to_string(),
    }
}

fn mint(c: &mut Contract, s: SkillMint) -> Token {
    set(ops(), NearToken::from_yoctonear(0));
    c.nft_mint(s)
}

// ---------- mint ----------

#[test]
fn ops_mints_skill_version_to_creator_with_metadata() {
    let mut c = setup();
    let token = mint(&mut c, skill());
    assert_eq!(token.token_id, format!("{SKILL_ID}:1"));
    assert_eq!(token.owner_id, creator());

    let logs = get_logs();
    assert_eq!(logs.len(), 1);
    assert!(logs[0].starts_with("EVENT_JSON:"));
    assert!(logs[0].contains("\"standard\":\"nep171\""));
    assert!(logs[0].contains("\"event\":\"nft_mint\""));

    let t = c.nft_token(token.token_id.clone()).unwrap();
    let md = t.metadata.unwrap();
    assert_eq!(md.title.as_deref(), Some("Flood Warden's Heir"));
    assert_eq!(md.copies, Some(1));
    assert_eq!(md.issued_at.as_deref(), Some("2026-11-03T08:15:00Z"));
    let extra: near_sdk::serde_json::Value =
        near_sdk::serde_json::from_str(md.extra.as_deref().unwrap()).unwrap();
    assert_eq!(extra["schema"], "skirm.skill/v0");
    assert_eq!(extra["id"], SKILL_ID);
    assert_eq!(extra["version"], 1);
    assert_eq!(extra["creator"], "tyron.testnet");
    assert_eq!(extra["royalty_bps"], 500);
    assert_eq!(extra["prompt_sha256"], SHA);
    assert_eq!(
        extra["requires_actions"],
        near_sdk::serde_json::json!(["place_block"])
    );
    assert_eq!(
        extra["handles_tags"],
        near_sdk::serde_json::json!(["spreads", "liquid"])
    );

    let info = c.skill_info(token.token_id.clone()).unwrap();
    assert_eq!(info.royalty_bps, DEFAULT_ROYALTY_BPS);
    assert_eq!(info.creator, creator());
    assert_eq!(
        c.skill_token(SKILL_ID.to_string(), 1).unwrap().token_id,
        token.token_id
    );
    assert!(c.skill_token(SKILL_ID.to_string(), 2).is_none());

    assert_eq!(c.nft_total_supply(), U128(1));
    assert_eq!(c.nft_supply_for_owner(creator()), U128(1));
    assert_eq!(c.nft_tokens_for_owner(creator(), None, None).len(), 1);
    assert_eq!(c.nft_tokens(None, None).len(), 1);
}

#[test]
fn mint_needs_no_deposit_and_creates_no_refund() {
    let mut c = setup();
    mint(&mut c, skill());
    assert!(get_created_receipts().is_empty());
}

#[test]
fn each_version_is_its_own_token() {
    let mut c = setup();
    mint(&mut c, skill());
    let mut v2 = skill();
    v2.version = 2;
    v2.royalty_bps = Some(250);
    let t2 = mint(&mut c, v2);
    assert_eq!(t2.token_id, format!("{SKILL_ID}:2"));
    assert_eq!(c.nft_total_supply(), U128(2));
    assert_eq!(c.skill_info(t2.token_id).unwrap().royalty_bps, 250);
}

#[test]
#[should_panic(expected = "Only the platform ops account can mint")]
fn non_ops_cannot_mint() {
    let mut c = setup();
    set(creator(), NearToken::from_yoctonear(0));
    c.nft_mint(skill());
}

#[test]
#[should_panic(expected = "Only the platform ops account can mint")]
fn owner_cannot_mint() {
    let mut c = setup();
    set(owner(), NearToken::from_yoctonear(0));
    c.nft_mint(skill());
}

#[test]
#[should_panic(expected = "token_id must be unique")]
fn same_version_cannot_be_minted_twice() {
    let mut c = setup();
    mint(&mut c, skill());
    mint(&mut c, skill());
}

#[test]
#[should_panic(expected = "Creator is fixed by the skill's first version")]
fn creator_is_fixed_across_versions() {
    let mut c = setup();
    mint(&mut c, skill());
    let mut v2 = skill();
    v2.version = 2;
    v2.creator = buyer();
    mint(&mut c, v2);
}

#[test]
fn royalty_bounds_zero_and_max_accepted() {
    let mut c = setup();
    let mut s = skill();
    s.royalty_bps = Some(0);
    let t = mint(&mut c, s);
    assert_eq!(c.skill_info(t.token_id).unwrap().royalty_bps, 0);
    let mut s = skill();
    s.version = 2;
    s.royalty_bps = Some(1000);
    let t = mint(&mut c, s);
    assert_eq!(c.skill_info(t.token_id).unwrap().royalty_bps, 1000);
}

#[test]
#[should_panic(expected = "royalty_bps must be between 0 and 1000")]
fn royalty_above_1000_rejected() {
    let mut c = setup();
    let mut s = skill();
    s.royalty_bps = Some(1001);
    mint(&mut c, s);
}

#[test]
#[should_panic(expected = "This skill is account-bound and is never minted")]
fn account_bound_starter_skill_never_minted() {
    set(owner(), NearToken::from_yoctonear(0));
    let mut c = Contract::new(owner(), ops(), None, Some(vec![SKILL_ID.to_string()]));
    mint(&mut c, skill());
}

#[test]
fn owner_marks_and_unmarks_account_bound() {
    let mut c = setup();
    set(owner(), NearToken::from_yoctonear(1));
    c.set_account_bound(SKILL_ID.to_string(), true);
    assert!(c.is_account_bound(SKILL_ID.to_string()));
    c.set_account_bound(SKILL_ID.to_string(), false);
    assert!(!c.is_account_bound(SKILL_ID.to_string()));
    mint(&mut c, skill());
}

#[test]
#[should_panic(expected = "Only the owner can call this method")]
fn non_owner_cannot_mark_account_bound() {
    let mut c = setup();
    set(ops(), NearToken::from_yoctonear(1));
    c.set_account_bound(SKILL_ID.to_string(), true);
}

#[test]
fn tags_and_actions_stored_in_canonical_order() {
    let mut c = setup();
    let mut s = skill();
    s.handles_tags = vec!["goal".into(), "spreads".into(), "flammable".into()];
    s.requires_actions = vec!["extinguish".into(), "place_block".into()];
    let t = mint(&mut c, s);
    let info = c.skill_info(t.token_id).unwrap();
    assert_eq!(info.handles_tags, vec!["spreads", "flammable", "goal"]);
    assert_eq!(info.requires_actions, vec!["place_block", "extinguish"]);
}

#[test]
fn empty_requires_actions_and_all_ten_tags_accepted() {
    let mut c = setup();
    let mut s = skill();
    s.requires_actions = vec![];
    s.handles_tags = TAGS.iter().map(|t| t.to_string()).collect();
    s.summary = None;
    let t = mint(&mut c, s);
    assert_eq!(c.skill_info(t.token_id).unwrap().handles_tags.len(), 10);
}

fn expect_invalid(f: impl FnOnce(&mut SkillMint)) {
    let mut c = setup();
    let mut s = skill();
    f(&mut s);
    mint(&mut c, s);
}

#[test]
#[should_panic(expected = "Skill id must be skl_")]
fn bad_skill_id_rejected() {
    expect_invalid(|s| s.id = "skill_1".into());
}

#[test]
#[should_panic(expected = "Skill id must be skl_")]
fn skill_id_with_non_crockford_char_rejected() {
    expect_invalid(|s| s.id = "skl_01JB7Z3K9QX4M2T8V6N5R1C0DU".into());
}

#[test]
#[should_panic(expected = "Skill version must be at least 1")]
fn version_zero_rejected() {
    expect_invalid(|s| s.version = 0);
}

#[test]
#[should_panic(expected = "Skill name must be 3-32")]
fn short_name_rejected() {
    expect_invalid(|s| s.name = "ab".into());
}

#[test]
#[should_panic(expected = "Skill name must be 3-32")]
fn name_with_bad_char_rejected() {
    expect_invalid(|s| s.name = "Flood!".into());
}

#[test]
#[should_panic(expected = "Skill summary must be at most 140 characters")]
fn long_summary_rejected() {
    expect_invalid(|s| s.summary = Some("x".repeat(141)));
}

#[test]
#[should_panic(expected = "handles_tags: unknown value fire")]
fn unknown_tag_rejected() {
    expect_invalid(|s| s.handles_tags = vec!["fire".into()]);
}

#[test]
#[should_panic(expected = "handles_tags: duplicate value liquid")]
fn duplicate_tag_rejected() {
    expect_invalid(|s| s.handles_tags = vec!["liquid".into(), "liquid".into()]);
}

#[test]
#[should_panic(expected = "handles_tags takes 1 to 10 tags")]
fn empty_tags_rejected() {
    expect_invalid(|s| s.handles_tags = vec![]);
}

#[test]
#[should_panic(expected = "requires_actions: unknown value move")]
fn ungated_action_rejected() {
    expect_invalid(|s| s.requires_actions = vec!["move".into()]);
}

#[test]
#[should_panic(expected = "requires_actions takes at most 3 values")]
fn too_many_actions_rejected() {
    expect_invalid(|s| {
        s.requires_actions = vec![
            "place_block".into(),
            "dig".into(),
            "extinguish".into(),
            "dig".into(),
        ]
    });
}

#[test]
#[should_panic(expected = "prompt_sha256 must be 64 lowercase hex characters")]
fn bad_sha_rejected() {
    expect_invalid(|s| s.prompt_sha256 = SHA.to_uppercase());
}

#[test]
#[should_panic(expected = "created_at must be an ISO 8601 UTC timestamp")]
fn bad_created_at_rejected() {
    expect_invalid(|s| s.created_at = "3 Nov 2026".into());
}

// ---------- NEP-199 payout arithmetic (Formulas §6) ----------

#[test]
fn bps_math_is_floor_and_overflow_safe() {
    assert_eq!(bps_of(near(5), 500), near(5) / 20);
    assert_eq!(bps_of(9_999, 500), 499); // floor(499.95)
    assert_eq!(bps_of(u128::MAX, 1000), u128::MAX / 10);
    assert_eq!(bps_of(u128::MAX, 10_000), u128::MAX);
    assert_eq!(bps_of(12_345, 0), 0);
}

#[test]
fn resale_payout_5_near_gives_creator_025_and_owner_475() {
    let p = compute_payout(&buyer(), &creator(), 500, near(5));
    assert_eq!(p.payout.len(), 2);
    assert_eq!(p.payout[&creator()], U128(near(5) / 20)); // 0.25 NEAR
    assert_eq!(p.payout[&buyer()], U128(near(5) - near(5) / 20)); // 4.75 NEAR
}

#[test]
fn primary_sale_payout_has_no_royalty() {
    let p = compute_payout(&creator(), &creator(), 500, near(5));
    assert_eq!(p.payout.len(), 1);
    assert_eq!(p.payout[&creator()], U128(near(5)));
}

#[test]
fn zero_royalty_payout_goes_entirely_to_owner() {
    let p = compute_payout(&buyer(), &creator(), 0, near(5));
    assert_eq!(p.payout.len(), 1);
    assert_eq!(p.payout[&buyer()], U128(near(5)));
}

#[test]
fn payout_parts_always_sum_to_balance() {
    let prices = [
        1u128,
        7,
        9_999,
        10_001,
        123_456_789,
        near(5) + 3,
        near(1_000_000) + 9_999,
    ];
    for &price in &prices {
        for bps in [0u16, 1, 333, 500, 999, 1000] {
            let p = compute_payout(&buyer(), &creator(), bps, price);
            let sum: u128 = p.payout.values().map(|v| v.0).sum();
            assert_eq!(sum, price, "price {price} bps {bps}");
        }
    }
}

#[test]
fn nft_payout_view_uses_current_owner() {
    let mut c = setup();
    let t = mint(&mut c, skill());
    // Creator still owns it: primary sale, no royalty.
    let p = c.nft_payout(t.token_id.clone(), U128(near(5)), Some(10));
    assert_eq!(p.payout.len(), 1);
    assert_eq!(p.payout[&creator()], U128(near(5)));

    set(creator(), NearToken::from_yoctonear(1));
    c.nft_transfer(buyer(), t.token_id.clone(), None, None);
    let p = c.nft_payout(t.token_id, U128(near(5)), Some(10));
    assert_eq!(p.payout[&creator()], U128(near(5) / 20));
    assert_eq!(p.payout[&buyer()], U128(near(5) - near(5) / 20));
}

#[test]
#[should_panic(expected = "Payout exceeds max_len_payout")]
fn payout_respects_max_len() {
    let mut c = setup();
    let t = mint(&mut c, skill());
    set(creator(), NearToken::from_yoctonear(1));
    c.nft_transfer(buyer(), t.token_id.clone(), None, None);
    c.nft_payout(t.token_id, U128(near(5)), Some(1));
}

#[test]
#[should_panic(expected = "Token not found")]
fn payout_for_unknown_token_panics() {
    let c = setup();
    c.nft_payout("skl_x:1".into(), U128(1), None);
}

// ---------- approvals and transfer_payout ----------

fn approve_market(c: &mut Contract, token_id: &str, msg: Option<String>) {
    set(creator(), NearToken::from_millinear(10));
    let _ = c.nft_approve(token_id.to_string(), market(), msg);
}

#[test]
fn approve_with_msg_calls_market_nft_on_approve() {
    let mut c = setup();
    let t = mint(&mut c, skill());
    approve_market(&mut c, &t.token_id, Some("{\"price\":\"5\"}".into()));
    assert!(c.nft_is_approved(t.token_id.clone(), market(), Some(1)));
    let receipts = get_created_receipts();
    let call = receipts
        .iter()
        .find(|r| r.receiver_id == market())
        .expect("call to market");
    match &call.actions[0] {
        MockAction::FunctionCallWeight {
            method_name, args, ..
        } => {
            assert_eq!(method_name, b"nft_on_approve");
            let a: near_sdk::serde_json::Value = near_sdk::serde_json::from_slice(args).unwrap();
            assert_eq!(a["owner_id"], "tyron.testnet");
            assert_eq!(a["approval_id"], 1);
            assert_eq!(a["msg"], "{\"price\":\"5\"}");
        }
        a => panic!("unexpected {a:?}"),
    }
}

#[test]
fn approved_market_transfers_with_payout_primary_sale() {
    let mut c = setup();
    let t = mint(&mut c, skill());
    approve_market(&mut c, &t.token_id, None);

    set(market(), NearToken::from_yoctonear(1));
    let p = c.nft_transfer_payout(
        buyer(),
        t.token_id.clone(),
        Some(1),
        None,
        U128(near(5)),
        Some(10),
    );
    assert_eq!(p.payout.len(), 1);
    assert_eq!(p.payout[&creator()], U128(near(5)));
    assert_eq!(c.nft_token(t.token_id.clone()).unwrap().owner_id, buyer());
    assert!(!c.nft_is_approved(t.token_id, market(), None));
    assert_eq!(c.nft_supply_for_owner(creator()), U128(0));
    assert_eq!(c.nft_supply_for_owner(buyer()), U128(1));
    // Approval storage refunded to the previous owner.
    let receipts = get_created_receipts();
    assert!(
        receipts
            .iter()
            .any(|r| r.receiver_id == creator()
                && matches!(r.actions[0], MockAction::Transfer { .. }))
    );
}

#[test]
fn resale_transfer_payout_pays_royalty_to_creator() {
    let mut c = setup();
    let t = mint(&mut c, skill());
    set(creator(), NearToken::from_yoctonear(1));
    c.nft_transfer(buyer(), t.token_id.clone(), None, None);

    set(buyer(), NearToken::from_millinear(10));
    let _ = c.nft_approve(t.token_id.clone(), market(), None);
    set(market(), NearToken::from_yoctonear(1));
    let next_owner = acc("third.testnet");
    let p = c.nft_transfer_payout(
        next_owner.clone(),
        t.token_id.clone(),
        Some(1),
        None,
        U128(near(5)),
        None,
    );
    assert_eq!(p.payout[&creator()], U128(near(5) / 20));
    assert_eq!(p.payout[&buyer()], U128(near(5) - near(5) / 20));
    assert_eq!(c.nft_token(t.token_id).unwrap().owner_id, next_owner);
}

#[test]
#[should_panic(expected = "Sender not approved")]
fn unapproved_account_cannot_transfer_payout() {
    let mut c = setup();
    let t = mint(&mut c, skill());
    set(market(), NearToken::from_yoctonear(1));
    c.nft_transfer_payout(buyer(), t.token_id, None, None, U128(near(5)), None);
}

#[test]
#[should_panic(expected = "The actual approval_id")]
fn stale_approval_id_rejected() {
    let mut c = setup();
    let t = mint(&mut c, skill());
    approve_market(&mut c, &t.token_id, None);
    set(market(), NearToken::from_yoctonear(1));
    c.nft_transfer_payout(buyer(), t.token_id, Some(7), None, U128(near(5)), None);
}

#[test]
#[should_panic(expected = "Requires attached deposit of exactly 1 yoctoNEAR")]
fn transfer_payout_requires_one_yocto() {
    let mut c = setup();
    let t = mint(&mut c, skill());
    approve_market(&mut c, &t.token_id, None);
    set(market(), NearToken::from_yoctonear(0));
    c.nft_transfer_payout(buyer(), t.token_id, Some(1), None, U128(near(5)), None);
}

#[test]
fn revoke_removes_market_approval() {
    let mut c = setup();
    let t = mint(&mut c, skill());
    approve_market(&mut c, &t.token_id, None);
    set(creator(), NearToken::from_yoctonear(1));
    c.nft_revoke(t.token_id.clone(), market());
    assert!(!c.nft_is_approved(t.token_id, market(), None));
}

#[test]
#[should_panic(expected = "Predecessor must be token owner")]
fn only_owner_can_approve() {
    let mut c = setup();
    let t = mint(&mut c, skill());
    set(buyer(), NearToken::from_millinear(10));
    let _ = c.nft_approve(t.token_id, market(), None);
}

#[test]
#[should_panic(expected = "Sender not approved")]
fn non_owner_cannot_transfer() {
    let mut c = setup();
    let t = mint(&mut c, skill());
    set(buyer(), NearToken::from_yoctonear(1));
    c.nft_transfer(buyer(), t.token_id, None, None);
}

// ---------- admin and metadata ----------

#[test]
fn contract_metadata_defaults() {
    let c = setup();
    let m = c.nft_metadata();
    assert_eq!(m.spec, NFT_METADATA_SPEC);
    assert_eq!(m.symbol, "SKIRM");
}

#[test]
fn owner_rotates_ops_and_new_ops_can_mint() {
    let mut c = setup();
    let new_ops = acc("ops2.playskirm.testnet");
    set(owner(), NearToken::from_yoctonear(1));
    c.set_ops(new_ops.clone());
    assert_eq!(c.get_config().ops_id, new_ops);
    set(new_ops, NearToken::from_yoctonear(0));
    c.nft_mint(skill());
}

#[test]
#[should_panic(expected = "Only the owner can call this method")]
fn ops_cannot_rotate_itself() {
    let mut c = setup();
    set(ops(), NearToken::from_yoctonear(1));
    c.set_ops(buyer());
}

#[test]
#[should_panic(expected = "Only the owner can call this method")]
fn non_owner_cannot_set_owner() {
    let mut c = setup();
    set(buyer(), NearToken::from_yoctonear(1));
    c.set_owner(buyer());
}

#[test]
fn owner_hands_over_ownership() {
    let mut c = setup();
    set(owner(), NearToken::from_yoctonear(1));
    c.set_owner(buyer());
    assert_eq!(c.get_config().owner_id, buyer());
}
