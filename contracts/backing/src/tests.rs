use super::*;
use near_sdk::mock::MockAction;
use near_sdk::test_utils::{get_created_receipts, get_logs, VMContextBuilder};
use near_sdk::{testing_env, NearToken};

fn owner() -> AccountId {
    "playskirm.testnet".parse().unwrap()
}
fn writer() -> AccountId {
    "writer.testnet".parse().unwrap()
}
fn alice() -> AccountId {
    "alice.testnet".parse().unwrap()
}
fn bob() -> AccountId {
    "bob.testnet".parse().unwrap()
}
fn contract_id() -> AccountId {
    "backing.playskirm.testnet".parse().unwrap()
}

const STORAGE: NearToken = NearToken::from_millinear(10);

fn ctx(predecessor: AccountId, deposit: NearToken) -> VMContextBuilder {
    let mut b = VMContextBuilder::new();
    b.current_account_id(contract_id())
        .signer_account_id(predecessor.clone())
        .predecessor_account_id(predecessor)
        .attached_deposit(deposit)
        .account_balance(NearToken::from_near(100))
        .block_timestamp(1_762_000_000_000_000_000);
    b
}

fn near(n: u128) -> u128 {
    NearToken::from_near(n).as_yoctonear()
}

fn setup() -> Contract {
    testing_env!(ctx(owner(), NearToken::from_yoctonear(0)).build());
    Contract::new(owner(), None)
}

/// Opens round 1: 20% to backers until 2× the stakes, raise up to 10 NEAR.
fn open(c: &mut Contract) -> Round {
    testing_env!(ctx(writer(), STORAGE).build());
    c.open_round(None, 2_000, 20_000, U128(near(10)))
}

fn back(c: &mut Contract, who: AccountId, amount: NearToken) -> BackingView {
    testing_env!(ctx(who, amount).build());
    c.back(U64(1))
}

/// Backing storage that `back` keeps from a new backer's attachment.
fn storage_kept(attached: NearToken, view: &BackingView) -> u128 {
    attached.as_yoctonear() - view.stake.0
}

fn events() -> Vec<near_sdk::serde_json::Value> {
    get_logs()
        .iter()
        .filter_map(|l| l.strip_prefix("EVENT_JSON:"))
        .map(|j| near_sdk::serde_json::from_str(j).unwrap())
        .collect()
}

/// Transfers in the receipts created by the last call: (receiver, yocto).
fn transfers() -> Vec<(String, u128)> {
    get_created_receipts()
        .iter()
        .flat_map(|r| {
            r.actions.iter().filter_map(move |a| match a {
                MockAction::Transfer { deposit, .. } => {
                    Some((r.receiver_id.to_string(), deposit.as_yoctonear()))
                }
                _ => None,
            })
        })
        .collect()
}

#[test]
fn mul_div_handles_wide_products() {
    assert_eq!(mul_div(6, 7, 3), 14);
    assert_eq!(mul_div(10, 10, 3), 33);
    let big = near(1_000_000);
    // 10^30 · 10^31 / 10^30 overflows u128 in the product but not in the result.
    assert_eq!(mul_div(big, big * 10, big), big * 10);
    assert_eq!(mul_div(u128::MAX, u128::MAX, u128::MAX), u128::MAX);
    assert_eq!(mul_div(u128::MAX, 2, 4), u128::MAX / 2);
}

#[test]
fn open_round_stores_terms_and_logs_event() {
    let mut c = setup();
    let r = open(&mut c);
    assert_eq!(r.id, U64(1));
    assert_eq!(r.writer, writer());
    assert_eq!(r.status, RoundStatus::Open);
    assert_eq!(r.share_bps, 2_000);
    assert_eq!(r.cap(), 0);
    let ev = events();
    assert_eq!(ev.len(), 1);
    assert_eq!(ev[0]["standard"], "skirm_backing");
    assert_eq!(ev[0]["event"], "round_opened");
    assert_eq!(ev[0]["data"][0]["writer"], "writer.testnet");
    assert_eq!(ev[0]["data"][0]["max_raise"], near(10).to_string());
    // The storage excess goes back to the writer.
    let t = transfers();
    assert_eq!(t.len(), 1);
    assert_eq!(t[0].0, "writer.testnet");
    assert!(t[0].1 > 0 && t[0].1 < STORAGE.as_yoctonear());
    assert_eq!(c.get_round(U64(1)).unwrap(), r);
    assert_eq!(c.get_config().round_count, U64(1));
}

#[test]
#[should_panic(expected = "share_bps must be between 1 and 5000")]
fn open_round_rejects_large_share() {
    let mut c = setup();
    testing_env!(ctx(writer(), STORAGE).build());
    c.open_round(None, 5_001, 20_000, U128(near(10)));
}

#[test]
#[should_panic(expected = "cap_multiple_bps must be between")]
fn open_round_rejects_cap_below_one() {
    let mut c = setup();
    testing_env!(ctx(writer(), STORAGE).build());
    c.open_round(None, 2_000, 9_999, U128(near(10)));
}

#[test]
#[should_panic(expected = "skill_id must be")]
fn open_round_rejects_bad_skill_id() {
    let mut c = setup();
    testing_env!(ctx(writer(), STORAGE).build());
    c.open_round(Some("no spaces".into()), 2_000, 20_000, U128(near(10)));
}

#[test]
#[should_panic(expected = "for storage")]
fn open_round_needs_storage() {
    let mut c = setup();
    testing_env!(ctx(writer(), NearToken::from_yoctonear(0)).build());
    c.open_round(None, 2_000, 20_000, U128(near(10)));
}

#[test]
fn back_stakes_attachment_minus_storage_and_caps_at_max_raise() {
    let mut c = setup();
    open(&mut c);
    let v = back(&mut c, alice(), NearToken::from_near(4));
    let kept = storage_kept(NearToken::from_near(4), &v);
    assert!(kept > 0 && kept < STORAGE.as_yoctonear(), "{kept}");
    assert_eq!(c.get_round(U64(1)).unwrap().backers, 1);
    let ev = events();
    assert_eq!(ev[0]["event"], "backed");
    assert_eq!(ev[0]["data"][0]["backer"], "alice.testnet");

    // A second stake from the same backer has no storage cost.
    let v2 = back(&mut c, alice(), NearToken::from_near(1));
    assert_eq!(v2.stake.0, v.stake.0 + near(1));
    assert_eq!(c.get_round(U64(1)).unwrap().backers, 1);

    // Bob offers 9 NEAR but only what is left of the 10 NEAR raise is staked.
    let left = near(10) - v2.stake.0;
    let vb = back(&mut c, bob(), NearToken::from_near(9));
    assert_eq!(vb.stake.0, left);
    let r = c.get_round(U64(1)).unwrap();
    assert_eq!(r.raised.0, near(10));
    assert_eq!(r.backers, 2);
    let t = transfers();
    assert_eq!(t.len(), 1);
    assert_eq!(t[0].0, "bob.testnet");
}

#[test]
#[should_panic(expected = "Round is full")]
fn back_rejects_full_round() {
    let mut c = setup();
    open(&mut c);
    back(&mut c, alice(), NearToken::from_near(11));
    back(&mut c, bob(), NearToken::from_near(1));
}

#[test]
#[should_panic(expected = "cannot back their own round")]
fn writer_cannot_back() {
    let mut c = setup();
    open(&mut c);
    back(&mut c, writer(), NearToken::from_near(1));
}

#[test]
#[should_panic(expected = "Stake must be at least")]
fn back_rejects_dust() {
    let mut c = setup();
    open(&mut c);
    back(&mut c, alice(), NearToken::from_millinear(50));
}

#[test]
fn close_pays_writer_the_raise() {
    let mut c = setup();
    open(&mut c);
    back(&mut c, alice(), NearToken::from_near(3));
    let raised = c.get_round(U64(1)).unwrap().raised.0;
    testing_env!(ctx(writer(), NearToken::from_yoctonear(0)).build());
    let r = c.close_round(U64(1));
    assert_eq!(r.status, RoundStatus::Closed);
    assert!(r.closed_at_ms.is_some());
    assert_eq!(transfers(), vec![("writer.testnet".to_string(), raised)]);
    assert_eq!(events()[0]["event"], "round_closed");
}

#[test]
#[should_panic(expected = "Only the writer can close")]
fn only_writer_closes() {
    let mut c = setup();
    open(&mut c);
    testing_env!(ctx(alice(), NearToken::from_yoctonear(0)).build());
    c.close_round(U64(1));
}

#[test]
#[should_panic(expected = "Round is not open")]
fn cannot_back_closed_round() {
    let mut c = setup();
    open(&mut c);
    testing_env!(ctx(writer(), NearToken::from_yoctonear(0)).build());
    c.close_round(U64(1));
    back(&mut c, alice(), NearToken::from_near(1));
}

#[test]
#[should_panic(expected = "closed rounds only")]
fn distribute_needs_closed_round() {
    let mut c = setup();
    open(&mut c);
    testing_env!(ctx(writer(), NearToken::from_near(1)).build());
    c.distribute(U64(1));
}

/// Alice stakes 3 NEAR and Bob 1 NEAR (net of storage), then the round closes.
fn closed_round() -> (Contract, u128, u128) {
    let mut c = setup();
    open(&mut c);
    let a = back(&mut c, alice(), NearToken::from_near(3)).stake.0;
    let b = back(&mut c, bob(), NearToken::from_near(1)).stake.0;
    testing_env!(ctx(writer(), NearToken::from_yoctonear(0)).build());
    c.close_round(U64(1));
    (c, a, b)
}

#[test]
fn distribute_splits_share_to_backers_and_rest_to_writer() {
    let (mut c, a, b) = closed_round();
    testing_env!(ctx(writer(), NearToken::from_near(5)).build());
    let to_backers = c.distribute(U64(1));
    assert_eq!(to_backers.0, near(1)); // 20% of 5
    assert_eq!(transfers(), vec![("writer.testnet".to_string(), near(4))]);
    let ev = events();
    assert_eq!(ev[0]["event"], "royalty_distributed");
    assert_eq!(ev[0]["data"][0]["to_writer"], near(4).to_string());
    assert_eq!(ev[0]["data"][0]["capped"], false);

    // Pro rata: Alice gets a/(a+b) of 1 NEAR.
    let ca = c.claimable(U64(1), alice()).0;
    let cb = c.claimable(U64(1), bob()).0;
    assert_eq!(ca, mul_div(a, near(1), a + b));
    assert_eq!(cb, mul_div(b, near(1), a + b));
    assert!(ca + cb <= near(1));

    testing_env!(ctx(alice(), NearToken::from_yoctonear(0)).build());
    assert_eq!(c.claim(U64(1)).0, ca);
    assert_eq!(transfers(), vec![("alice.testnet".to_string(), ca)]);
    assert_eq!(c.claimable(U64(1), alice()).0, 0);
    let view = c.get_backing(U64(1), alice()).unwrap();
    assert_eq!(view.claimed.0, ca);
    assert_eq!(c.get_round(U64(1)).unwrap().claimed_total.0, ca);
}

#[test]
fn backers_stop_earning_at_the_cap() {
    let (mut c, a, b) = closed_round();
    let raised = a + b;
    let cap = raised * 2;
    // 20% of 100 NEAR = 20 NEAR > cap (~8 NEAR): the backers get exactly the cap.
    testing_env!(ctx(writer(), NearToken::from_near(100)).build());
    let to_backers = c.distribute(U64(1)).0;
    assert_eq!(to_backers, cap);
    assert_eq!(
        transfers(),
        vec![("writer.testnet".to_string(), near(100) - cap)]
    );
    assert_eq!(events()[0]["data"][0]["capped"], true);

    // Later royalties go entirely to the writer.
    testing_env!(ctx(writer(), NearToken::from_near(10)).build());
    assert_eq!(c.distribute(U64(1)).0, 0);
    assert_eq!(transfers(), vec![("writer.testnet".to_string(), near(10))]);

    // Each backer can pull at most 2× their stake.
    assert_eq!(c.claimable(U64(1), alice()).0, a * 2);
    assert_eq!(c.claimable(U64(1), bob()).0, b * 2);
}

#[test]
#[should_panic(expected = "Nothing to claim")]
fn claim_twice_fails() {
    let (mut c, _, _) = closed_round();
    testing_env!(ctx(writer(), NearToken::from_near(1)).build());
    c.distribute(U64(1));
    testing_env!(ctx(alice(), NearToken::from_yoctonear(0)).build());
    c.claim(U64(1));
    c.claim(U64(1));
}

#[test]
#[should_panic(expected = "No backing for this account")]
fn stranger_cannot_claim() {
    let (mut c, _, _) = closed_round();
    testing_env!(ctx(writer(), NearToken::from_near(1)).build());
    c.distribute(U64(1));
    testing_env!(ctx(owner(), NearToken::from_yoctonear(0)).build());
    c.claim(U64(1));
}

#[test]
fn cancelled_round_refunds_stakes_once() {
    let mut c = setup();
    open(&mut c);
    let a = back(&mut c, alice(), NearToken::from_near(2)).stake.0;
    testing_env!(ctx(writer(), NearToken::from_yoctonear(0)).build());
    assert_eq!(c.cancel_round(U64(1)).status, RoundStatus::Cancelled);
    assert!(transfers().is_empty());
    assert_eq!(c.claimable(U64(1), alice()).0, a);
    testing_env!(ctx(alice(), NearToken::from_yoctonear(0)).build());
    assert_eq!(c.refund(U64(1)).0, a);
    assert_eq!(transfers(), vec![("alice.testnet".to_string(), a)]);
    assert!(c.get_backing(U64(1), alice()).unwrap().refunded);
    assert_eq!(c.claimable(U64(1), alice()).0, 0);
}

#[test]
#[should_panic(expected = "Already refunded")]
fn refund_twice_fails() {
    let mut c = setup();
    open(&mut c);
    back(&mut c, alice(), NearToken::from_near(2));
    testing_env!(ctx(writer(), NearToken::from_yoctonear(0)).build());
    c.cancel_round(U64(1));
    testing_env!(ctx(alice(), NearToken::from_yoctonear(0)).build());
    c.refund(U64(1));
    c.refund(U64(1));
}

#[test]
#[should_panic(expected = "Only a cancelled round refunds")]
fn closed_round_does_not_refund() {
    let (mut c, _, _) = closed_round();
    testing_env!(ctx(alice(), NearToken::from_yoctonear(0)).build());
    c.refund(U64(1));
}

#[test]
fn get_rounds_pages_by_id() {
    let mut c = setup();
    open(&mut c);
    testing_env!(ctx(alice(), STORAGE).build());
    c.open_round(Some("skl_01HZX".into()), 1_000, 30_000, U128(near(5)));
    let all = c.get_rounds(None, None);
    assert_eq!(all.len(), 2);
    assert_eq!(all[1].skill_id.as_deref(), Some("skl_01HZX"));
    assert_eq!(c.get_rounds(Some(U64(2)), Some(10)).len(), 1);
    assert_eq!(c.get_rounds(None, Some(1)).len(), 1);
}

#[test]
fn owner_sets_min_stake() {
    let mut c = setup();
    testing_env!(ctx(owner(), NearToken::from_yoctonear(1)).build());
    c.set_min_stake(U128(near(1)));
    assert_eq!(c.get_config().min_stake.0, near(1));
}

#[test]
#[should_panic(expected = "Only the owner")]
fn stranger_cannot_set_min_stake() {
    let mut c = setup();
    testing_env!(ctx(alice(), NearToken::from_yoctonear(1)).build());
    c.set_min_stake(U128(near(1)));
}
