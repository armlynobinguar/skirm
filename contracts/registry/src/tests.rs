use super::*;
use near_sdk::test_utils::{get_logs, VMContextBuilder};
use near_sdk::{serde_json, testing_env, NearToken};

const HASH: &str = "41ab0e6b4a1d3c5e7f9a0b2c4d6e8f1a3b5c7d9e0f2a4b6c8d0e1f3a5b7c9d0e";

fn acc(s: &str) -> AccountId {
    s.parse().unwrap()
}
fn owner() -> AccountId {
    acc("playskirm.testnet")
}
fn ops() -> AccountId {
    acc("ops.playskirm.testnet")
}

fn set(predecessor: AccountId, deposit: u128) {
    let mut b = VMContextBuilder::new();
    b.current_account_id(acc("registry.playskirm.testnet"))
        .signer_account_id(predecessor.clone())
        .predecessor_account_id(predecessor)
        .attached_deposit(NearToken::from_yoctonear(deposit))
        .account_balance(NearToken::from_near(20))
        .block_height(777)
        .block_timestamp(1_762_000_000_000_000_000);
    testing_env!(b.build());
}

fn setup() -> Contract {
    set(owner(), 0);
    let c = Contract::new(owner(), ops());
    set(ops(), 0);
    c
}

fn s(v: &str) -> String {
    v.to_string()
}

fn side(player: &str, agents: &[&str]) -> SideV2 {
    SideV2 {
        player: s(player),
        agents: agents.iter().map(|a| s(a)).collect(),
        tiers: agents.iter().map(|_| s("standard")).collect(),
        delivered: 0,
    }
}

fn ch(player: &str, delta: i32) -> EloChange {
    EloChange {
        player: s(player),
        delta,
    }
}

/// record_match args; defaults to a ranked 1v1 that p1 wins on the goal, outside any season.
#[derive(Clone)]
struct M {
    match_id: String,
    season_id: Option<u32>,
    map_id: String,
    ranked: bool,
    side_a: SideV2,
    side_b: SideV2,
    result: MatchResult,
    decided_by: Option<DecidedBy>,
    head_start_ticks: u32,
    ticks: u32,
    log_sha256: String,
    elo_changes: Vec<EloChange>,
}

fn m(id: &str) -> M {
    M {
        match_id: s(id),
        season_id: None,
        map_id: s("copper-hollow"),
        ranked: true,
        side_a: side("p1", &["a"]),
        side_b: side("p2", &["b"]),
        result: MatchResult::A,
        decided_by: Some(DecidedBy::Goal),
        head_start_ticks: 0,
        ticks: 90,
        log_sha256: s(HASH),
        elo_changes: vec![ch("p1", 16), ch("p2", -16)],
    }
}

impl M {
    fn void(mut self) -> Self {
        self.result = MatchResult::Void;
        self.decided_by = None;
        self.elo_changes = vec![];
        self
    }
    fn casual(mut self) -> Self {
        self.ranked = false;
        self.elo_changes = vec![];
        self
    }
    fn result(mut self, result: MatchResult, decided_by: DecidedBy, elo: Vec<EloChange>) -> Self {
        self.result = result;
        self.decided_by = Some(decided_by);
        self.elo_changes = elo;
        self
    }
    fn season(mut self, season_id: u32) -> Self {
        self.season_id = Some(season_id);
        self
    }
    fn record(self, c: &mut Contract) -> MatchRecordV2 {
        c.record_match(
            self.match_id,
            self.season_id,
            self.map_id,
            self.ranked,
            self.side_a,
            self.side_b,
            self.result,
            self.decided_by,
            self.head_start_ticks,
            self.ticks,
            self.log_sha256,
            self.elo_changes,
        )
    }
}

fn rating(rating: u32, matches: u32, wins: u32, losses: u32, draws: u32) -> PlayerRating {
    PlayerRating {
        rating,
        matches,
        wins,
        losses,
        draws,
    }
}

// ---------- record_match and Elo ----------

#[test]
fn unrated_player_starts_at_1200() {
    let c = setup();
    assert_eq!(c.get_rating(s("p_new")), rating(1200, 0, 0, 0, 0));
}

#[test]
fn enums_serialize_as_spec_strings() {
    assert_eq!(serde_json::to_value(MatchResult::A).unwrap(), "A");
    assert_eq!(serde_json::to_value(MatchResult::B).unwrap(), "B");
    assert_eq!(serde_json::to_value(MatchResult::Draw).unwrap(), "draw");
    assert_eq!(serde_json::to_value(MatchResult::Void).unwrap(), "void");
    let all = [
        (DecidedBy::Goal, "goal"),
        (DecidedBy::Score, "score"),
        (DecidedBy::FewerAgents, "fewer_agents"),
        (DecidedBy::Earlier, "earlier"),
        (DecidedBy::Draw, "draw"),
    ];
    for (d, text) in all {
        assert_eq!(serde_json::to_value(d).unwrap(), text);
        let back: DecidedBy = serde_json::from_value(serde_json::json!(text)).unwrap();
        assert_eq!(back, d);
    }
}

#[test]
fn record_match_applies_formulas_worked_example() {
    // Formulas §7: a new player (1,200) beats a 1,300 player with K = 32: +21 -> 1,221.
    let mut c = setup();
    c.ratings
        .insert(s("jev.testnet"), rating(1300, 25, 15, 10, 0));
    let mut args = m("m_1");
    args.side_a = SideV2 {
        player: s("tyron.testnet"),
        agents: vec![s("agt_A1"), s("agt_A2")],
        tiers: vec![s("quiet"), s("open")],
        delivered: 3,
    };
    args.side_b = SideV2 {
        player: s("jev.testnet"),
        agents: vec![s("agt_B")],
        tiers: vec![s("standard")],
        delivered: 1,
    };
    args.head_start_ticks = 5;
    args.elo_changes = vec![ch("tyron.testnet", 21), ch("jev.testnet", -10)];
    let rec = args.record(&mut c);
    assert_eq!(
        rec.elo,
        vec![
            PlayerElo {
                player: s("tyron.testnet"),
                before: 1200,
                delta: 21,
                after: 1221
            },
            PlayerElo {
                player: s("jev.testnet"),
                before: 1300,
                delta: -10,
                after: 1290
            },
        ]
    );
    assert_eq!(rec.block_height, U64(777));
    assert_eq!(rec.recorded_at_ms, U64(1_762_000_000_000));
    assert_eq!(c.get_rating(s("tyron.testnet")), rating(1221, 1, 1, 0, 0));
    assert_eq!(c.get_rating(s("jev.testnet")), rating(1290, 26, 15, 11, 0));
    assert_eq!(c.get_match(s("m_1")), Some(rec));
    assert_eq!(c.match_count(), 1);
    let ratings = c.get_ratings(vec![s("tyron.testnet"), s("p_new")]);
    assert_eq!(ratings[0].1.rating, 1221);
    assert_eq!(ratings[1].1.rating, 1200);

    let log = get_logs()
        .into_iter()
        .find(|l| l.contains("match_recorded"))
        .unwrap();
    let v: serde_json::Value =
        serde_json::from_str(log.strip_prefix("EVENT_JSON:").unwrap()).unwrap();
    assert_eq!(v["standard"], "skirm_registry");
    assert_eq!(v["version"], "2.0.0");
    let d = &v["data"][0];
    assert_eq!(d["result"], "A");
    assert_eq!(d["decided_by"], "goal");
    assert_eq!(d["ranked"], true);
    assert_eq!(d["season_id"], serde_json::Value::Null);
    assert_eq!(d["head_start_ticks"], 5);
    assert_eq!(d["ticks"], 90);
    assert_eq!(d["log_sha256"], HASH);
    assert_eq!(d["side_a"]["tiers"], serde_json::json!(["quiet", "open"]));
    assert_eq!(d["side_a"]["delivered"], 3);
    assert_eq!(d["elo"][0]["player"], "tyron.testnet");
    assert_eq!(d["elo"][0]["after"], 1221);
}

#[test]
fn draw_allows_any_sign_and_counts_a_draw() {
    let mut c = setup();
    let mut args = m("m_1").result(
        MatchResult::Draw,
        DecidedBy::Draw,
        vec![ch("p1", 3), ch("p2", -3)],
    );
    args.side_a = side("p1", &["a1", "a2"]);
    args.side_b = side("p2", &["b1", "b2"]);
    args.record(&mut c);
    assert_eq!(c.get_rating(s("p1")), rating(1203, 1, 0, 0, 1));
    assert_eq!(c.get_rating(s("p2")), rating(1197, 1, 0, 0, 1));
}

#[test]
fn b_win_counts_win_and_loss() {
    let mut c = setup();
    m("m_1")
        .result(
            MatchResult::B,
            DecidedBy::FewerAgents,
            vec![ch("p2", 16), ch("p1", -16)],
        )
        .record(&mut c);
    assert_eq!(c.get_rating(s("p1")), rating(1184, 1, 0, 1, 0));
    assert_eq!(c.get_rating(s("p2")), rating(1216, 1, 1, 0, 0));
}

#[test]
fn rating_never_drops_below_floor() {
    let mut c = setup();
    c.ratings.insert(s("p2"), rating(110, 40, 0, 40, 0));
    let mut args = m("m_1");
    args.elo_changes = vec![ch("p1", 1), ch("p2", -16)];
    let rec = args.record(&mut c);
    assert_eq!(rec.elo[1].after, 100);
    assert_eq!(c.get_rating(s("p2")).rating, 100);
}

#[test]
fn void_match_stored_without_elo() {
    let mut c = setup();
    let rec = m("m_v").void().record(&mut c);
    assert!(rec.elo.is_empty());
    assert_eq!(rec.decided_by, None);
    assert_eq!(c.get_rating(s("p1")), rating(1200, 0, 0, 0, 0));
}

#[test]
fn unranked_match_stored_without_elo_or_standing() {
    let mut c = setup();
    let rec = m("m_c").casual().season(3).record(&mut c);
    assert!(rec.elo.is_empty());
    assert_eq!(c.get_rating(s("p1")).matches, 0);
    assert_eq!(c.get_season_standing(3, s("p1")), SeasonStanding::default());
}

#[test]
#[should_panic(expected = "An unranked or void match has no Elo changes")]
fn void_match_with_elo_rejected() {
    let mut c = setup();
    let mut args = m("m_v").void();
    args.elo_changes = vec![ch("p1", 1), ch("p2", -1)];
    args.record(&mut c);
}

#[test]
#[should_panic(expected = "An unranked or void match has no Elo changes")]
fn unranked_match_with_elo_rejected() {
    let mut c = setup();
    let mut args = m("m_c");
    args.ranked = false;
    args.record(&mut c);
}

#[test]
fn identical_match_retry_does_not_apply_elo_twice() {
    let mut c = setup();
    let first = m("m_1").season(1).record(&mut c);
    let again = m("m_1").season(1).record(&mut c);
    assert_eq!(first, again);
    assert_eq!(c.get_rating(s("p1")), rating(1216, 1, 1, 0, 0));
    assert_eq!(c.get_season_standing(1, s("p1")).points, 25);
    assert_eq!(c.match_count(), 1);
    assert_eq!(c.season_match_count(1), 1);
}

#[test]
#[should_panic(expected = "Match already recorded with different data")]
fn conflicting_match_rewrite_rejected() {
    let mut c = setup();
    m("m_1").record(&mut c);
    m("m_1")
        .result(
            MatchResult::B,
            DecidedBy::Goal,
            vec![ch("p1", -16), ch("p2", 16)],
        )
        .record(&mut c);
}

#[test]
#[should_panic(expected = "Match already recorded with different data")]
fn conflicting_log_hash_rejected() {
    let mut c = setup();
    m("m_1").record(&mut c);
    let mut args = m("m_1");
    args.log_sha256 = "f".repeat(64);
    args.record(&mut c);
}

#[test]
#[should_panic(expected = "Match already recorded with different data")]
fn conflicting_season_rejected() {
    let mut c = setup();
    m("m_1").season(1).record(&mut c);
    m("m_1").season(2).record(&mut c);
}

#[test]
#[should_panic(expected = "elo_changes must name both players exactly once")]
fn missing_elo_change_rejected() {
    let mut c = setup();
    let mut args = m("m");
    args.elo_changes = vec![ch("p1", 16)];
    args.record(&mut c);
}

#[test]
#[should_panic(expected = "elo_changes: player x is not in the match")]
fn foreign_player_in_elo_rejected() {
    let mut c = setup();
    let mut args = m("m");
    args.elo_changes = vec![ch("p1", 16), ch("x", -16)];
    args.record(&mut c);
}

#[test]
#[should_panic(expected = "elo_changes: duplicate player p1")]
fn duplicate_elo_change_rejected() {
    let mut c = setup();
    let mut args = m("m");
    args.elo_changes = vec![ch("p1", 16), ch("p1", 16)];
    args.record(&mut c);
}

#[test]
#[should_panic(expected = "elo_changes: |delta| must be at most 32")]
fn oversized_delta_rejected() {
    let mut c = setup();
    let mut args = m("m");
    args.elo_changes = vec![ch("p1", 33), ch("p2", -33)];
    args.record(&mut c);
}

#[test]
#[should_panic(expected = "elo_changes: delta for p1 contradicts the result")]
fn winner_losing_rating_rejected() {
    let mut c = setup();
    let mut args = m("m");
    args.elo_changes = vec![ch("p1", -5), ch("p2", 5)];
    args.record(&mut c);
}

#[test]
#[should_panic(expected = "elo_changes: delta for p2 contradicts the result")]
fn loser_gaining_rating_rejected() {
    let mut c = setup();
    m("m")
        .result(
            MatchResult::B,
            DecidedBy::Score,
            vec![ch("p1", -5), ch("p2", -1)],
        )
        .record(&mut c);
}

#[test]
#[should_panic(expected = "decided_by does not match the result")]
fn draw_needs_decided_by_draw() {
    let mut c = setup();
    m("m")
        .result(
            MatchResult::Draw,
            DecidedBy::Score,
            vec![ch("p1", 0), ch("p2", 0)],
        )
        .record(&mut c);
}

#[test]
#[should_panic(expected = "decided_by does not match the result")]
fn win_cannot_be_decided_by_draw() {
    let mut c = setup();
    let mut args = m("m");
    args.decided_by = Some(DecidedBy::Draw);
    args.record(&mut c);
}

#[test]
#[should_panic(expected = "decided_by does not match the result")]
fn win_needs_decided_by() {
    let mut c = setup();
    let mut args = m("m");
    args.decided_by = None;
    args.record(&mut c);
}

#[test]
#[should_panic(expected = "decided_by does not match the result")]
fn void_has_no_decided_by() {
    let mut c = setup();
    let mut args = m("m").void();
    args.decided_by = Some(DecidedBy::Goal);
    args.record(&mut c);
}

#[test]
#[should_panic(expected = "Agent a is on both sides")]
fn agent_on_both_sides_rejected() {
    let mut c = setup();
    let mut args = m("m").void();
    args.side_b = side("p2", &["a"]);
    args.record(&mut c);
}

#[test]
#[should_panic(expected = "A player cannot play themselves")]
fn same_player_on_both_sides_rejected() {
    let mut c = setup();
    let mut args = m("m").void();
    args.side_b = side("p1", &["b"]);
    args.record(&mut c);
}

#[test]
#[should_panic(expected = "side_a.agents must list 1 to 3 agents")]
fn empty_crew_rejected() {
    let mut c = setup();
    let mut args = m("m").void();
    args.side_a = side("p1", &[]);
    args.record(&mut c);
}

#[test]
#[should_panic(expected = "side_b.agents must list 1 to 3 agents")]
fn crew_of_four_rejected() {
    let mut c = setup();
    let mut args = m("m").void();
    args.side_b = side("p2", &["b1", "b2", "b3", "b4"]);
    args.record(&mut c);
}

#[test]
#[should_panic(expected = "side_a.agents: duplicate agent a")]
fn duplicate_agent_rejected() {
    let mut c = setup();
    let mut args = m("m").void();
    args.side_a = side("p1", &["a", "a"]);
    args.record(&mut c);
}

#[test]
#[should_panic(expected = "side_a.tiers must give one tier per agent")]
fn tier_per_agent_required() {
    let mut c = setup();
    let mut args = m("m").void();
    args.side_a.tiers = vec![];
    args.record(&mut c);
}

#[test]
#[should_panic(expected = "match_id must be 1-64 printable characters")]
fn empty_match_id_rejected() {
    let mut c = setup();
    m("").void().record(&mut c);
}

#[test]
#[should_panic(expected = "Only the platform ops account can record results")]
fn non_ops_cannot_record_match() {
    let mut c = setup();
    set(acc("tyron.testnet"), 0);
    m("m").void().record(&mut c);
}

#[test]
#[should_panic(expected = "Only the platform ops account can record results")]
fn owner_cannot_record_match() {
    let mut c = setup();
    set(owner(), 0);
    m("m").void().record(&mut c);
}

#[test]
#[should_panic(expected = "log_sha256 must be 64 lowercase hex characters")]
fn bad_log_hash_rejected() {
    let mut c = setup();
    let mut args = m("m").void();
    args.log_sha256 = s("xyz");
    args.record(&mut c);
}

#[test]
fn matches_paginate() {
    let mut c = setup();
    for i in 0..3 {
        m(&format!("m_{i}")).void().record(&mut c);
    }
    let ids: Vec<String> = c
        .get_matches(Some(1), Some(5))
        .into_iter()
        .map(|m| m.match_id)
        .collect();
    assert_eq!(ids, vec!["m_1", "m_2"]);
    assert!(c.get_matches(Some(9), None).is_empty());
}

// ---------- seasons ----------

#[test]
fn ranked_results_add_season_points() {
    let mut c = setup();
    // Season 1: p1 wins, then draws; p2 loses, then draws.
    m("m_1").season(1).record(&mut c);
    m("m_2")
        .season(1)
        .result(
            MatchResult::Draw,
            DecidedBy::Draw,
            vec![ch("p1", -1), ch("p2", 1)],
        )
        .record(&mut c);
    // Season 2: p2 wins. Outside a season: p1 wins, ratings move but no standing does.
    m("m_3")
        .season(2)
        .result(
            MatchResult::B,
            DecidedBy::Earlier,
            vec![ch("p1", -16), ch("p2", 16)],
        )
        .record(&mut c);
    m("m_4").record(&mut c);

    assert_eq!(
        c.get_season_standing(1, s("p1")),
        SeasonStanding {
            points: 25 + 12,
            wins: 1,
            losses: 0,
            draws: 1
        }
    );
    assert_eq!(
        c.get_season_standing(1, s("p2")),
        SeasonStanding {
            points: 5 + 12,
            wins: 0,
            losses: 1,
            draws: 1
        }
    );
    assert_eq!(
        c.get_season_standing(2, s("p2")),
        SeasonStanding {
            points: 25,
            wins: 1,
            losses: 0,
            draws: 0
        }
    );
    assert_eq!(c.get_season_standing(2, s("p1")).points, 5);
    assert_eq!(c.get_season_standing(3, s("p1")), SeasonStanding::default());
    assert_eq!(c.get_rating(s("p1")), rating(1215, 4, 2, 1, 1));
}

#[test]
fn matches_by_season_paginate() {
    let mut c = setup();
    m("m_0").season(1).record(&mut c);
    m("m_x").season(2).record(&mut c);
    m("m_1").season(1).void().record(&mut c);
    m("m_y").record(&mut c);
    m("m_2").season(1).casual().record(&mut c);
    let ids = |from, limit| -> Vec<String> {
        c.get_matches_by_season(1, from, limit)
            .into_iter()
            .map(|m| m.match_id)
            .collect()
    };
    assert_eq!(ids(None, None), vec!["m_0", "m_1", "m_2"]);
    assert_eq!(ids(Some(1), Some(1)), vec!["m_1"]);
    assert!(ids(Some(5), None).is_empty());
    assert_eq!(c.season_match_count(1), 3);
    assert_eq!(c.season_match_count(2), 1);
    assert!(c.get_matches_by_season(9, None, None).is_empty());
}

#[test]
fn record_match_accepts_json_without_optional_fields() {
    // The backend may omit season_id; a void match has no decided_by.
    let rec: MatchRecordV2 = serde_json::from_value(serde_json::json!({
        "match_id": "m", "map_id": "copper-hollow", "ranked": true,
        "side_a": { "player": "p1", "agents": ["a"], "tiers": ["standard"], "delivered": 0 },
        "side_b": { "player": "p2", "agents": ["b"], "tiers": ["open"], "delivered": 2 },
        "result": "void", "head_start_ticks": 0, "ticks": 0, "log_sha256": HASH,
        "elo": [], "recorded_at_ms": "0", "block_height": "0",
    }))
    .unwrap();
    assert_eq!(rec.season_id, None);
    assert_eq!(rec.decided_by, None);
    assert_eq!(rec.side_b.delivered, 2);
}

// ---------- admin ----------

#[test]
fn owner_rotates_ops() {
    let mut c = setup();
    set(owner(), 1);
    c.set_ops(acc("ops2.playskirm.testnet"));
    assert_eq!(c.get_config().ops_id, acc("ops2.playskirm.testnet"));
    set(acc("ops2.playskirm.testnet"), 0);
    m("m_1").void().record(&mut c);
}

#[test]
#[should_panic(expected = "Only the owner can call this method")]
fn ops_cannot_rotate_ops() {
    let mut c = setup();
    set(ops(), 1);
    c.set_ops(acc("evil.testnet"));
}

#[test]
#[should_panic(expected = "Requires attached deposit of exactly 1 yoctoNEAR")]
fn set_ops_requires_one_yocto() {
    let mut c = setup();
    set(owner(), 0);
    c.set_ops(acc("ops2.playskirm.testnet"));
}

#[test]
fn owner_hands_over_ownership() {
    let mut c = setup();
    set(owner(), 1);
    c.set_owner(acc("admin.playskirm.testnet"));
    assert_eq!(c.get_config().owner_id, acc("admin.playskirm.testnet"));
}

#[test]
#[should_panic(expected = "Only the owner can call this method")]
fn non_owner_cannot_set_owner() {
    let mut c = setup();
    set(acc("x.testnet"), 1);
    c.set_owner(acc("x.testnet"));
}
