use super::*;
use near_sdk::mock::MockAction;
use near_sdk::test_utils::{get_created_receipts, get_logs, VMContextBuilder};
use near_sdk::{testing_env, PromiseResult, RuntimeFeesConfig};
use std::collections::HashMap;

/// 2025-11-01T12:26:40Z in ms; season 1 runs 14 days from here.
const T0: u64 = 1_762_000_000_000;
const DAY: u64 = 86_400_000;
const END: u64 = T0 + 14 * DAY;

fn acc(s: &str) -> AccountId {
    s.parse().unwrap()
}
fn owner() -> AccountId {
    acc("playskirm.testnet")
}
fn ops() -> AccountId {
    acc("ops.playskirm.testnet")
}
fn market() -> AccountId {
    acc("market.playskirm.testnet")
}
fn stranger() -> AccountId {
    acc("mallory.testnet")
}
fn near(n: u128) -> u128 {
    NearToken::from_near(n).as_yoctonear()
}

fn set_at(predecessor: AccountId, deposit: u128, now_ms: u64) {
    let mut b = VMContextBuilder::new();
    b.current_account_id(acc("seasons.playskirm.testnet"))
        .signer_account_id(predecessor.clone())
        .predecessor_account_id(predecessor)
        .attached_deposit(NearToken::from_yoctonear(deposit))
        .account_balance(NearToken::from_near(50))
        .block_timestamp(now_ms * 1_000_000);
    testing_env!(b.build());
}

fn set(predecessor: AccountId, deposit: u128) {
    set_at(predecessor, deposit, T0);
}

fn setup() -> Contract {
    set(owner(), 0);
    Contract::new(owner(), ops())
}

/// A contract with season 1 open (by ops), funded with `pool` yocto.
fn open_funded(pool: u128) -> Contract {
    let mut c = setup();
    set(ops(), 0);
    c.open_season(1, "Season 1".into(), T0, END);
    if pool > 0 {
        set(market(), pool);
        c.fund(None);
    }
    c
}

/// Season 1 funded with `pool` and locked at its end.
fn locked(pool: u128) -> Contract {
    let mut c = open_funded(pool);
    set_at(ops(), 0, END);
    c.lock_season(1);
    c
}

fn row(player: &str, near: Option<&str>, points: u32) -> StandingInput {
    StandingInput {
        player: player.into(),
        near: near.map(acc),
        points,
    }
}

/// Ten rows, all with NEAR accounts, points descending.
fn ten_rows() -> Vec<StandingInput> {
    (0..10)
        .map(|i| {
            let name = format!("p{i}");
            StandingInput {
                player: format!("acc_{name}"),
                near: Some(acc(&format!("{name}.testnet"))),
                points: 300 - i * 10,
            }
        })
        .collect()
}

/// All NEAR transfers created in this call, summed per receiver.
fn transfers() -> HashMap<AccountId, u128> {
    let mut out = HashMap::new();
    for r in get_created_receipts() {
        for a in &r.actions {
            if let MockAction::Transfer { deposit, .. } = a {
                *out.entry(r.receiver_id.clone()).or_insert(0) += deposit.as_yoctonear();
            }
        }
    }
    out
}

fn events(name: &str) -> Vec<serde_json::Value> {
    get_logs()
        .into_iter()
        .filter(|l| l.contains(&format!("\"event\":\"{name}\"")))
        .map(|l| {
            let v: serde_json::Value =
                serde_json::from_str(l.strip_prefix("EVENT_JSON:").unwrap()).unwrap();
            assert_eq!(v["standard"], EVENT_STANDARD);
            assert_eq!(v["version"], "1.0.0");
            v["data"][0].clone()
        })
        .collect()
}

fn event(name: &str) -> serde_json::Value {
    events(name)
        .into_iter()
        .next()
        .unwrap_or_else(|| panic!("no {name} event"))
}

fn seasons_id() -> AccountId {
    acc("seasons.playskirm.testnet")
}

/// Simulates `on_prize_transferred` with the given result of the prize transfer.
fn prize_transferred(
    c: &mut Contract,
    result: PromiseResult,
    rank: u32,
    near_account: &str,
    amount: u128,
) -> U128 {
    let mut b = VMContextBuilder::new();
    b.current_account_id(seasons_id())
        .signer_account_id(acc(near_account))
        .predecessor_account_id(seasons_id())
        .account_balance(NearToken::from_near(50))
        .block_timestamp(END * 1_000_000);
    testing_env!(
        b.build(),
        near_sdk::test_vm_config(),
        RuntimeFeesConfig::test(),
        Default::default(),
        vec![result],
    );
    c.on_prize_transferred(1, rank, acc(near_account), U128(amount))
}

/// Asserts that this call scheduled a function call `method` back on the seasons contract.
fn assert_callback_scheduled(method: &str) {
    let found = get_created_receipts().iter().any(|r| {
        r.receiver_id == seasons_id()
            && r.actions.iter().any(|a| {
                matches!(a, MockAction::FunctionCallWeight { method_name, .. }
                    if method_name.as_slice() == method.as_bytes())
            })
    });
    assert!(found, "no {method} callback scheduled");
}

fn shares(s: &Season) -> u128 {
    s.standings.iter().map(|r| r.share.0).sum()
}

// ---------- split arithmetic ----------

#[test]
fn split_bps_sum_to_the_whole_pool() {
    assert_eq!(SPLIT_BPS.iter().map(|b| *b as u32).sum::<u32>(), 10_000);
    assert_eq!(bps_of(19, 3000), 5); // 5.7 -> 5
    assert_eq!(bps_of(u128::MAX, 500), u128::MAX / 20);
}

#[test]
fn split_sums_to_pool_with_odd_yocto_amounts() {
    let pools = [
        1u128,
        7,
        9_999,
        10_001,
        333_333_333_333_333,
        near(3) + 7,
        near(1_000) + 12_345,
    ];
    for (n, &pool) in pools.iter().enumerate() {
        // A fresh contract each round; mocked storage persists, so each uses its own season id.
        let id = n as u32 + 1;
        let mut c = setup();
        set(ops(), 0);
        c.open_season(id, format!("Season {id}"), T0, END);
        set(market(), pool);
        c.fund(None);
        set_at(ops(), 0, END);
        c.lock_season(id);
        set(ops(), 0);
        let s = c.post_standings(id, ten_rows());
        for (i, r) in s.standings.iter().enumerate() {
            assert_eq!(r.rank, i as u32 + 1);
            assert_eq!(r.share.0, bps_of(pool, SPLIT_BPS[i]));
        }
        // Floor shares never exceed the pool; the dust is the carry.
        assert!(shares(&s) <= pool);
        assert_eq!(shares(&s) + c.get_carry().0, pool, "pool {pool}");
        assert_eq!(
            event("standings_posted")["to_carry"],
            json!(U128(c.get_carry().0))
        );
    }
}

#[test]
fn ten_near_pool_pays_3_2_1_5_then_half_near() {
    let mut c = locked(near(10));
    set(ops(), 0);
    let s = c.post_standings(1, ten_rows());
    let got: Vec<u128> = s.standings.iter().map(|r| r.share.0).collect();
    let half = near(1) / 2;
    assert_eq!(
        got,
        vec![
            near(3),
            near(2),
            near(1) + half,
            half,
            half,
            half,
            half,
            half,
            half,
            half
        ]
    );
    assert_eq!(c.get_carry().0, 0);
}

// ---------- open / fund ----------

#[test]
fn ops_opens_a_season_and_anyone_funds_it() {
    let mut c = setup();
    set(ops(), 0);
    let s = c.open_season(1, "Season 1".into(), T0, END);
    assert_eq!(s.status, SeasonStatus::Open);
    assert_eq!(s.pool.0, 0);
    let ev = event("season_opened");
    assert_eq!(ev["season_id"], 1);
    assert_eq!(ev["ends_at_ms"], END);
    assert!(events("carry_rolled").is_empty());

    set(market(), 777);
    assert_eq!(c.fund(None).0, 777);
    let ev = event("season_funded");
    assert_eq!(ev["from"], "market.playskirm.testnet");
    assert_eq!(ev["amount"], "777");
    set(stranger(), 1_000);
    assert_eq!(c.fund(Some(1)).0, 1_777);
    assert_eq!(c.current_season().unwrap().pool.0, 1_777);
    assert_eq!(c.get_config().current_season_id, Some(1));
}

#[test]
fn owner_can_open_a_season() {
    let mut c = setup();
    set(owner(), 0);
    c.open_season(4, "Season 4".into(), T0, END);
    assert_eq!(c.get_season(4).unwrap().status, SeasonStatus::Open);
}

#[test]
#[should_panic(expected = "Only the owner or ops can call this method")]
fn stranger_cannot_open_a_season() {
    let mut c = setup();
    set(stranger(), 0);
    c.open_season(1, "Season 1".into(), T0, END);
}

#[test]
#[should_panic(expected = "ends_at_ms must be after starts_at_ms")]
fn open_rejects_an_empty_window() {
    let mut c = setup();
    set(ops(), 0);
    c.open_season(1, "Season 1".into(), END, END);
}

#[test]
#[should_panic(expected = "The previous season must be paid out first")]
fn next_season_waits_for_the_previous_to_be_paid() {
    let mut c = locked(near(1));
    set(ops(), 0);
    c.open_season(2, "Season 2".into(), END, END + 14 * DAY);
}

#[test]
#[should_panic(expected = "No season is open")]
fn fund_with_no_open_season_panics() {
    let mut c = setup();
    set(market(), 100);
    c.fund(None);
}

#[test]
#[should_panic(expected = "No season is open")]
fn fund_of_a_locked_season_panics() {
    let mut c = locked(near(1));
    set(market(), 100);
    c.fund(None);
}

#[test]
#[should_panic(expected = "No season is open")]
fn fund_of_an_unknown_season_panics() {
    let mut c = open_funded(0);
    set(market(), 100);
    c.fund(Some(9));
}

#[test]
#[should_panic(expected = "Attach NEAR to fund a season")]
fn fund_needs_a_deposit() {
    let mut c = open_funded(0);
    set(market(), 0);
    c.fund(None);
}

// ---------- lock ----------

#[test]
#[should_panic(expected = "Season has not ended yet")]
fn lock_before_the_end_panics() {
    let mut c = open_funded(near(1));
    set_at(ops(), 0, END - 1);
    c.lock_season(1);
}

#[test]
#[should_panic(expected = "Only the owner or ops can call this method")]
fn stranger_cannot_lock() {
    let mut c = open_funded(near(1));
    set_at(stranger(), 0, END);
    c.lock_season(1);
}

// ---------- standings ----------

#[test]
#[should_panic(expected = "Season is not locked")]
fn standings_need_a_locked_season() {
    let mut c = open_funded(near(1));
    set(ops(), 0);
    c.post_standings(1, ten_rows());
}

#[test]
#[should_panic(expected = "Only the owner or ops can call this method")]
fn stranger_cannot_post_standings() {
    let mut c = locked(near(1));
    set(stranger(), 0);
    c.post_standings(1, ten_rows());
}

#[test]
#[should_panic(expected = "At most 10 standings")]
fn more_than_ten_standings_panic() {
    let mut c = locked(near(1));
    let mut rows = ten_rows();
    rows.push(row("acc_extra", Some("extra.testnet"), 0));
    set(ops(), 0);
    c.post_standings(1, rows);
}

#[test]
#[should_panic(expected = "Duplicate NEAR account in standings")]
fn duplicate_near_accounts_panic() {
    let mut c = locked(near(1));
    set(ops(), 0);
    c.post_standings(
        1,
        vec![
            row("acc_a", Some("ana.testnet"), 50),
            row("acc_b", Some("ana.testnet"), 40),
        ],
    );
}

#[test]
#[should_panic(expected = "Standings must be ordered by points, best first")]
fn unordered_standings_panic() {
    let mut c = locked(near(1));
    set(ops(), 0);
    c.post_standings(
        1,
        vec![
            row("acc_a", Some("ana.testnet"), 10),
            row("acc_b", Some("jev.testnet"), 40),
        ],
    );
}

#[test]
fn fewer_rows_and_missing_near_accounts_roll_into_the_carry() {
    let mut c = locked(near(10));
    set(ops(), 0);
    let s = c.post_standings(
        1,
        vec![
            row("acc_ana", Some("ana.testnet"), 75),
            row("acc_guest", None, 50),
            row("acc_jev", Some("jev.testnet"), 50),
        ],
    );
    assert_eq!(s.standings[0].share.0, near(3));
    assert_eq!(s.standings[1].share.0, 0); // no NEAR account: its 2 NEAR go to the carry
    assert_eq!(s.standings[2].share.0, near(15) / 10);
    // 2 (guest) + 3.5 (places 4-10 empty).
    assert_eq!(c.get_carry().0, near(55) / 10);
    assert_eq!(shares(&s) + c.get_carry().0, near(10));
}

#[test]
fn empty_standings_send_the_whole_pool_to_the_carry() {
    let mut c = locked(near(2));
    set(ops(), 0);
    let s = c.post_standings(1, vec![]);
    assert!(s.standings_posted);
    assert_eq!(c.get_carry().0, near(2));
}

#[test]
fn identical_retry_of_post_standings_is_a_noop() {
    let mut c = locked(near(10) + 3);
    set(ops(), 0);
    let first = c.post_standings(1, ten_rows());
    let carry = c.get_carry();
    set(ops(), 0);
    let again = c.post_standings(1, ten_rows());
    assert_eq!(first, again);
    assert_eq!(c.get_carry(), carry);
    assert!(events("standings_posted").is_empty());
}

#[test]
#[should_panic(expected = "Standings already posted with different data")]
fn different_retry_of_post_standings_panics() {
    let mut c = locked(near(10));
    set(ops(), 0);
    c.post_standings(1, ten_rows());
    let mut rows = ten_rows();
    rows[0].points += 1;
    set(ops(), 0);
    c.post_standings(1, rows);
}

// ---------- claim ----------

#[test]
fn winner_claims_its_share_by_pull() {
    let mut c = locked(near(10));
    set(ops(), 0);
    c.post_standings(1, ten_rows());
    set(acc("p0.testnet"), 0);
    let _ = c.claim(1);
    assert_eq!(transfers(), HashMap::from([(acc("p0.testnet"), near(3))]));
    assert_callback_scheduled("on_prize_transferred");
    // Marked claimed while the transfer is in flight.
    let s = c.get_season(1).unwrap();
    assert!(s.standings[0].claimed);
    assert_eq!(s.paid_total.0, near(3));

    let ok = PromiseResult::Successful(vec![]);
    let out = prize_transferred(&mut c, ok, 1, "p0.testnet", near(3));
    assert_eq!(out.0, near(3));
    let ev = event("prize_claimed");
    assert_eq!(ev["rank"], 1);
    assert_eq!(ev["player"], "acc_p0");
    assert_eq!(ev["amount"], near(3).to_string());
    let s = c.get_season(1).unwrap();
    assert!(s.standings[0].claimed);
    assert_eq!(s.paid_total.0, near(3));
    assert_eq!(c.get_carry().0, 0);
}

#[test]
fn failed_prize_transfer_reopens_the_claim() {
    let mut c = locked(near(10));
    set(ops(), 0);
    c.post_standings(1, ten_rows());
    set(acc("p1.testnet"), 0);
    let _ = c.claim(1);
    assert!(get_logs().iter().all(|l| !l.contains("prize_claimed")));

    let out = prize_transferred(&mut c, PromiseResult::Failed, 2, "p1.testnet", near(2));
    assert_eq!(out.0, 0);
    let ev = event("prize_transfer_failed");
    assert_eq!(ev["rank"], 2);
    assert_eq!(ev["amount"], near(2).to_string());
    assert_eq!(ev["to_carry"], false);
    assert!(events("prize_claimed").is_empty());
    let s = c.get_season(1).unwrap();
    assert!(!s.standings[1].claimed);
    assert_eq!(s.paid_total.0, 0);
    assert_eq!(c.get_carry().0, 0);

    // The winner can claim again.
    set(acc("p1.testnet"), 0);
    let _ = c.claim(1);
    assert_eq!(transfers(), HashMap::from([(acc("p1.testnet"), near(2))]));
    assert!(c.get_season(1).unwrap().standings[1].claimed);
}

#[test]
fn failed_prize_transfer_after_close_goes_to_the_carry() {
    let mut c = locked(near(10));
    set(ops(), 0);
    c.post_standings(1, ten_rows());
    set(acc("p0.testnet"), 0);
    let _ = c.claim(1);
    // The season closes before the callback runs; close counts p0's share as claimed.
    set(ops(), 0);
    c.close_season(1);
    assert_eq!(c.get_carry().0, near(7));

    let out = prize_transferred(&mut c, PromiseResult::Failed, 1, "p0.testnet", near(3));
    assert_eq!(out.0, 0);
    assert_eq!(event("prize_transfer_failed")["to_carry"], true);
    let s = c.get_season(1).unwrap();
    assert_eq!(s.status, SeasonStatus::Paid);
    assert!(!s.standings[0].claimed);
    assert_eq!(s.paid_total.0, 0);
    // Nothing is stranded: the whole pool is in the carry for the next season.
    assert_eq!(c.get_carry().0, near(10));
    set(ops(), 0);
    let next = c.open_season(2, "Season 2".into(), END, END + 14 * DAY);
    assert_eq!(next.pool.0, near(10));
}

#[test]
#[should_panic(expected = "Method on_prize_transferred is private")]
fn prize_callback_is_private() {
    let mut c = locked(near(10));
    set(ops(), 0);
    c.post_standings(1, ten_rows());
    set(acc("p0.testnet"), 0);
    let _ = c.claim(1);
    set(acc("p0.testnet"), 0);
    c.on_prize_transferred(1, 1, acc("p0.testnet"), U128(near(3)));
}

#[test]
#[should_panic(expected = "Standing not found")]
fn prize_callback_rejects_a_mismatched_standing() {
    let mut c = locked(near(10));
    set(ops(), 0);
    c.post_standings(1, ten_rows());
    prize_transferred(&mut c, PromiseResult::Failed, 1, "p1.testnet", near(3));
}

#[test]
#[should_panic(expected = "Prize already claimed")]
fn double_claim_is_rejected() {
    let mut c = locked(near(10));
    set(ops(), 0);
    c.post_standings(1, ten_rows());
    set(acc("p1.testnet"), 0);
    let _ = c.claim(1);
    set(acc("p1.testnet"), 0);
    let _ = c.claim(1);
}

#[test]
#[should_panic(expected = "No prize for this account")]
fn non_winner_cannot_claim() {
    let mut c = locked(near(10));
    set(ops(), 0);
    c.post_standings(1, ten_rows());
    set(stranger(), 0);
    let _ = c.claim(1);
}

#[test]
#[should_panic(expected = "Prizes of this season are not claimable")]
fn claim_before_standings_panics() {
    let mut c = locked(near(10));
    set(acc("p0.testnet"), 0);
    let _ = c.claim(1);
}

// ---------- close and rollover ----------

#[test]
#[should_panic(expected = "Post standings before closing")]
fn close_needs_standings() {
    let mut c = locked(near(1));
    set(ops(), 0);
    c.close_season(1);
}

#[test]
#[should_panic(expected = "Prizes of this season are not claimable")]
fn claim_after_close_panics() {
    let mut c = locked(near(10));
    set(ops(), 0);
    c.post_standings(1, ten_rows());
    set(ops(), 0);
    c.close_season(1);
    set(acc("p0.testnet"), 0);
    let _ = c.claim(1);
}

#[test]
fn full_cycle_rolls_unclaimed_and_unallocated_prizes_into_the_next_season() {
    let pool = near(10) + 9; // 9 yocto of rounding dust
    let mut c = open_funded(pool);
    assert_eq!(c.get_season(1).unwrap().status, SeasonStatus::Open);

    set_at(ops(), 0, END);
    assert_eq!(c.lock_season(1).status, SeasonStatus::Locked);
    assert_eq!(event("season_locked")["pool"], pool.to_string());

    let mut rows = ten_rows();
    rows.truncate(2);
    set(ops(), 0);
    c.post_standings(1, rows);
    let dust_and_empty = c.get_carry().0;
    assert_eq!(
        dust_and_empty,
        pool - bps_of(pool, 3000) - bps_of(pool, 2000)
    );

    set(acc("p0.testnet"), 0);
    let _ = c.claim(1);
    // p1 never claims.
    set(ops(), 0);
    let s = c.close_season(1);
    assert_eq!(s.status, SeasonStatus::Paid);
    let ev = event("season_closed");
    assert_eq!(ev["unclaimed"], bps_of(pool, 2000).to_string());
    let carry = dust_and_empty + bps_of(pool, 2000);
    assert_eq!(c.get_carry().0, carry);
    assert_eq!(s.paid_total.0 + carry, pool);

    set(ops(), 0);
    let next = c.open_season(2, "Season 2".into(), END, END + 14 * DAY);
    assert_eq!(next.pool.0, carry);
    assert_eq!(c.get_carry().0, 0);
    assert_eq!(event("carry_rolled")["amount"], carry.to_string());
    assert_eq!(c.current_season().unwrap().id, 2);
    assert_eq!(c.get_season(1).unwrap().status, SeasonStatus::Paid);
}

#[test]
#[should_panic(expected = "Season ids must increase")]
fn season_ids_must_increase() {
    let mut c = locked(near(1));
    set(ops(), 0);
    c.post_standings(1, vec![]);
    set(ops(), 0);
    c.close_season(1);
    set(ops(), 0);
    c.open_season(0, "Season 0".into(), END, END + DAY);
}

// ---------- retries (the worker resends a write whose response was lost) ----------

#[test]
fn retry_of_open_season_is_a_noop() {
    let mut c = open_funded(near(1));
    set(ops(), 0);
    let again = c.open_season(1, "Season 1".into(), T0, END);
    assert_eq!(again.status, SeasonStatus::Open);
    assert_eq!(again.pool.0, near(1)); // the funds stay
    assert!(events("season_opened").is_empty());
    assert_eq!(c.get_config().current_season_id, Some(1));
}

#[test]
#[should_panic(expected = "Season already exists")]
fn reopening_the_current_season_with_other_args_panics() {
    let mut c = open_funded(0);
    set(ops(), 0);
    c.open_season(1, "Season 1".into(), T0, END + DAY);
}

#[test]
fn retry_of_lock_season_is_a_noop() {
    let mut c = locked(near(1));
    set_at(ops(), 0, END + 1);
    let again = c.lock_season(1);
    assert_eq!(again.status, SeasonStatus::Locked);
    assert!(events("season_locked").is_empty());

    set(ops(), 0);
    c.post_standings(1, vec![]);
    c.close_season(1);
    set(ops(), 0);
    assert_eq!(c.lock_season(1).status, SeasonStatus::Paid);
    assert!(events("season_locked").is_empty());
}

#[test]
fn retry_of_close_season_is_a_noop() {
    let mut c = locked(near(10));
    set(ops(), 0);
    c.post_standings(1, ten_rows());
    c.close_season(1);
    let carry = c.get_carry();
    assert_eq!(carry.0, near(10)); // nobody claimed
    set(ops(), 0);
    let again = c.close_season(1);
    assert_eq!(again.status, SeasonStatus::Paid);
    assert_eq!(c.get_carry(), carry); // unclaimed shares are not counted twice
    assert!(events("season_closed").is_empty());
}

#[test]
#[should_panic(expected = "Season is not locked")]
fn close_of_an_open_season_panics() {
    let mut c = open_funded(near(1));
    set(ops(), 0);
    c.close_season(1);
}

// ---------- admin ----------

#[test]
fn owner_rotates_ops_and_owner_with_one_yocto() {
    let mut c = setup();
    set(owner(), 1);
    c.set_ops(acc("ops2.playskirm.testnet"));
    let ev = event("ops_updated");
    assert_eq!(ev["old"], "ops.playskirm.testnet");
    assert_eq!(ev["new"], "ops2.playskirm.testnet");
    set(owner(), 1);
    c.set_owner(acc("dao.playskirm.testnet"));
    assert_eq!(event("owner_updated")["new"], "dao.playskirm.testnet");
    let cfg = c.get_config();
    assert_eq!(cfg.owner_id, acc("dao.playskirm.testnet"));
    assert_eq!(cfg.ops_id, acc("ops2.playskirm.testnet"));
    assert_eq!(cfg.split_bps, SPLIT_BPS.to_vec());

    // The old ops account lost access.
    set(ops(), 0);
    let r = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        c.open_season(1, "Season 1".into(), T0, END)
    }));
    assert!(r.is_err());
}

#[test]
#[should_panic(expected = "Requires attached deposit of exactly 1 yoctoNEAR")]
fn set_ops_requires_one_yocto() {
    let mut c = setup();
    set(owner(), 0);
    c.set_ops(stranger());
}

#[test]
#[should_panic(expected = "Only the owner can call this method")]
fn ops_cannot_change_the_owner() {
    let mut c = setup();
    set(ops(), 1);
    c.set_owner(ops());
}
