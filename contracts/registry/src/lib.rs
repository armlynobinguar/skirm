//! skirm registry contract (registry.playskirm.testnet).
//!
//! v2 match results with log hashes, Elo per player and points per season. Writes come only from
//! the platform signer `ops.playskirm.testnet` (function-call key, no deposit), so this contract pays
//! its storage from its own balance (arch.md, Secrets and keys; Open questions: storage).
//!
//! * `record_match` stores a v2 match (`MatchRecordV2`). For a ranked match with a result it
//!   applies the Elo change per player computed by the backend (Formulas §7: start 1,200, K 48
//!   placement, 32, then 16, clamped by the backend to ±32, floor 100) and, when the match
//!   belongs to a season, the season points (win 25, draw 12, loss 5) in the same write. The
//!   contract enforces the floor, `|delta| ≤ 32`, and that winners do not lose and losers do not
//!   gain rating. Unranked and void matches carry no Elo.
//! * The write is idempotent: re-sending the same record (the worker retries the write as its own
//!   job) returns the stored record; a different record under the same id is rejected.

use near_sdk::json_types::U64;
use near_sdk::serde_json::json;
use near_sdk::store::{LookupMap, Vector};
use near_sdk::{assert_one_yocto, env, near, require, AccountId, BorshStorageKey, PanicOnDefault};

/// Formulas §7 defaults.
pub const ELO_START: u32 = 1_200;
pub const ELO_FLOOR: u32 = 100;
/// Largest K, so the largest possible change of one match.
pub const ELO_MAX_DELTA: i32 = 32;
/// Season points per ranked result.
pub const POINTS_WIN: u32 = 25;
pub const POINTS_DRAW: u32 = 12;
pub const POINTS_LOSS: u32 = 5;
/// Crew cap (Spec §8).
pub const MAX_CREW: usize = 3;
pub const MAX_ID_LEN: usize = 64;
pub const EVENT_STANDARD: &str = "skirm_registry";
pub const EVENT_VERSION: &str = "2.0.0";

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[near(serializers = [borsh, json])]
pub enum MatchResult {
    /// Side A won.
    A,
    /// Side B won.
    B,
    #[serde(rename = "draw")]
    Draw,
    /// Match voided (platform error): stored, no Elo change.
    #[serde(rename = "void")]
    Void,
}

/// What decided a match (engine v2 `MatchResult.decidedBy`).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[near(serializers = [borsh, json])]
#[serde(rename_all = "snake_case")]
pub enum DecidedBy {
    /// A crew delivered the goal, or the other crew was eliminated.
    Goal,
    /// Time-out: more delivered.
    Score,
    /// Time-out, same score: fewer agents fielded.
    FewerAgents,
    /// Time-out, same score and crew size: reached its score first.
    Earlier,
    Draw,
}

/// One crew as it played.
#[derive(Clone, Debug, PartialEq, Eq)]
#[near(serializers = [borsh, json])]
pub struct SideV2 {
    /// Player account id (NEAR account or platform account id).
    pub player: String,
    /// Agent ids of the crew, in crew order (1 to 3, unique).
    pub agents: Vec<String>,
    /// Talk tier each agent locked in, in crew order.
    pub tiers: Vec<String>,
    /// Items the crew delivered (its score).
    pub delivered: u32,
}

/// Elo change for one player as sent by the backend.
#[derive(Clone, Debug, PartialEq, Eq)]
#[near(serializers = [borsh, json])]
pub struct EloChange {
    pub player: String,
    pub delta: i32,
}

/// Elo change as applied: `after = max(floor, before + delta)`.
#[derive(Clone, Debug, PartialEq, Eq)]
#[near(serializers = [borsh, json])]
pub struct PlayerElo {
    pub player: String,
    pub before: u32,
    pub delta: i32,
    pub after: u32,
}

#[derive(Clone, Debug, PartialEq, Eq)]
#[near(serializers = [borsh, json])]
pub struct MatchRecordV2 {
    pub match_id: String,
    pub season_id: Option<u32>,
    pub map_id: String,
    pub ranked: bool,
    pub side_a: SideV2,
    pub side_b: SideV2,
    pub result: MatchResult,
    /// None only for a void match.
    pub decided_by: Option<DecidedBy>,
    /// Start hold of the smaller crew (5 ticks per agent of difference).
    pub head_start_ticks: u32,
    pub ticks: u32,
    /// Final hash of the match log, 64 lowercase hex chars.
    pub log_sha256: String,
    pub elo: Vec<PlayerElo>,
    pub recorded_at_ms: U64,
    pub block_height: U64,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[near(serializers = [borsh, json])]
pub struct PlayerRating {
    pub rating: u32,
    /// Ranked matches with a result.
    pub matches: u32,
    pub wins: u32,
    pub losses: u32,
    pub draws: u32,
}

impl Default for PlayerRating {
    fn default() -> Self {
        Self {
            rating: ELO_START,
            matches: 0,
            wins: 0,
            losses: 0,
            draws: 0,
        }
    }
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
#[near(serializers = [borsh, json])]
pub struct SeasonStanding {
    pub points: u32,
    pub wins: u32,
    pub losses: u32,
    pub draws: u32,
}

#[derive(Clone, Debug, PartialEq, Eq)]
#[near(serializers = [json])]
pub struct Config {
    pub owner_id: AccountId,
    pub ops_id: AccountId,
    pub elo_start: u32,
    pub elo_floor: u32,
}

#[derive(BorshStorageKey)]
#[near]
enum StorageKey {
    Matches,
    MatchIds,
    Ratings,
    SeasonStandings,
    SeasonMatches,
    SeasonMatchCount,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Contract {
    owner_id: AccountId,
    ops_id: AccountId,
    matches: LookupMap<String, MatchRecordV2>,
    match_ids: Vector<String>,
    ratings: LookupMap<String, PlayerRating>,
    season_standings: LookupMap<(u32, String), SeasonStanding>,
    /// (season, n) -> match id of the season's n-th recorded match.
    season_matches: LookupMap<(u32, u32), String>,
    season_match_count: LookupMap<u32, u32>,
}

fn emit_event(event: &str, data: near_sdk::serde_json::Value) {
    let ev = json!({ "standard": EVENT_STANDARD, "version": EVENT_VERSION, "event": event, "data": [data] });
    env::log_str(&format!("EVENT_JSON:{ev}"));
}

fn is_hex64(s: &str) -> bool {
    s.len() == 64
        && s.chars()
            .all(|c| c.is_ascii_digit() || ('a'..='f').contains(&c))
}

fn require_id(value: &str, field: &str) {
    require!(
        !value.is_empty()
            && value.len() <= MAX_ID_LEN
            && value.chars().all(|c| c.is_ascii_graphic()),
        format!("{field} must be 1-64 printable characters without spaces")
    );
}

fn require_crew(agents: &[String], field: &str) {
    require!(
        (1..=MAX_CREW).contains(&agents.len()),
        format!("{field} must list 1 to 3 agents")
    );
    for (i, a) in agents.iter().enumerate() {
        require_id(a, field);
        require!(
            !agents[..i].contains(a),
            format!("{field}: duplicate agent {a}")
        );
    }
}

fn require_side(side: &SideV2, field: &str) {
    require_id(&side.player, &format!("{field}.player"));
    require_crew(&side.agents, &format!("{field}.agents"));
    require!(
        side.tiers.len() == side.agents.len(),
        format!("{field}.tiers must give one tier per agent")
    );
    for t in &side.tiers {
        require_id(t, &format!("{field}.tiers"));
    }
}

fn paginate<T: Clone>(
    ids: &Vector<String>,
    from: Option<u32>,
    limit: Option<u32>,
    get: impl Fn(&String) -> Option<T>,
) -> Vec<T> {
    let from = from.unwrap_or(0);
    let end = from.saturating_add(limit.unwrap_or(50)).min(ids.len());
    (from..end)
        .filter_map(|i| ids.get(i).and_then(&get))
        .collect()
}

#[near]
impl Contract {
    #[init]
    pub fn new(owner_id: AccountId, ops_id: AccountId) -> Self {
        Self {
            owner_id,
            ops_id,
            matches: LookupMap::new(StorageKey::Matches),
            match_ids: Vector::new(StorageKey::MatchIds),
            ratings: LookupMap::new(StorageKey::Ratings),
            season_standings: LookupMap::new(StorageKey::SeasonStandings),
            season_matches: LookupMap::new(StorageKey::SeasonMatches),
            season_match_count: LookupMap::new(StorageKey::SeasonMatchCount),
        }
    }

    /// Record a v2 match; a ranked result moves both players' Elo and, with a season, their
    /// season standing. Ops only. `elo_changes` names both players exactly once for a ranked match
    /// with a result, and is empty for an unranked or void match.
    #[allow(clippy::too_many_arguments)]
    pub fn record_match(
        &mut self,
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
    ) -> MatchRecordV2 {
        self.assert_ops();
        require_id(&match_id, "match_id");
        require_id(&map_id, "map_id");
        require!(
            is_hex64(&log_sha256),
            "log_sha256 must be 64 lowercase hex characters"
        );
        require_side(&side_a, "side_a");
        require_side(&side_b, "side_b");
        require!(
            side_a.player != side_b.player,
            "A player cannot play themselves"
        );
        for a in &side_a.agents {
            require!(
                !side_b.agents.contains(a),
                format!("Agent {a} is on both sides")
            );
        }
        let decided_ok = match (result, decided_by) {
            (MatchResult::Void, d) => d.is_none(),
            (MatchResult::Draw, d) => d == Some(DecidedBy::Draw),
            (_, d) => d.is_some() && d != Some(DecidedBy::Draw),
        };
        require!(decided_ok, "decided_by does not match the result");

        if let Some(existing) = self.matches.get(&match_id) {
            let same = existing.season_id == season_id
                && existing.map_id == map_id
                && existing.ranked == ranked
                && existing.side_a == side_a
                && existing.side_b == side_b
                && existing.result == result
                && existing.decided_by == decided_by
                && existing.head_start_ticks == head_start_ticks
                && existing.ticks == ticks
                && existing.log_sha256 == log_sha256
                && existing.elo.len() == elo_changes.len()
                && existing
                    .elo
                    .iter()
                    .zip(&elo_changes)
                    .all(|(e, c)| e.player == c.player && e.delta == c.delta);
            require!(same, "Match already recorded with different data");
            return existing.clone();
        }

        let rated = ranked && result != MatchResult::Void;
        if !rated {
            require!(
                elo_changes.is_empty(),
                "An unranked or void match has no Elo changes"
            );
        } else {
            require!(
                elo_changes.len() == 2,
                "elo_changes must name both players exactly once"
            );
            for (i, c) in elo_changes.iter().enumerate() {
                require!(
                    c.player == side_a.player || c.player == side_b.player,
                    format!("elo_changes: player {} is not in the match", c.player)
                );
                require!(
                    !elo_changes[..i].iter().any(|p| p.player == c.player),
                    format!("elo_changes: duplicate player {}", c.player)
                );
                require!(
                    c.delta.abs() <= ELO_MAX_DELTA,
                    format!("elo_changes: |delta| must be at most {ELO_MAX_DELTA}")
                );
                let on_a = c.player == side_a.player;
                let ok = match result {
                    MatchResult::A if on_a => c.delta >= 0,
                    MatchResult::A => c.delta <= 0,
                    MatchResult::B if on_a => c.delta <= 0,
                    MatchResult::B => c.delta >= 0,
                    _ => true,
                };
                require!(
                    ok,
                    format!("elo_changes: delta for {} contradicts the result", c.player)
                );
            }
        }

        let mut elo = Vec::with_capacity(elo_changes.len());
        for c in elo_changes {
            let on_a = c.player == side_a.player;
            let (won, lost) = match result {
                MatchResult::A => (on_a, !on_a),
                MatchResult::B => (!on_a, on_a),
                _ => (false, false),
            };
            let mut r = self.ratings.get(&c.player).copied().unwrap_or_default();
            let before = r.rating;
            let after = (before as i64 + c.delta as i64).max(ELO_FLOOR as i64) as u32;
            r.rating = after;
            r.matches += 1;
            r.wins += won as u32;
            r.losses += lost as u32;
            r.draws += (!won && !lost) as u32;
            self.ratings.insert(c.player.clone(), r);
            if let Some(season) = season_id {
                let key = (season, c.player.clone());
                let mut st = self.season_standings.get(&key).copied().unwrap_or_default();
                st.points += if won {
                    POINTS_WIN
                } else if lost {
                    POINTS_LOSS
                } else {
                    POINTS_DRAW
                };
                st.wins += won as u32;
                st.losses += lost as u32;
                st.draws += (!won && !lost) as u32;
                self.season_standings.insert(key, st);
            }
            elo.push(PlayerElo {
                player: c.player,
                before,
                delta: c.delta,
                after,
            });
        }

        let record = MatchRecordV2 {
            match_id: match_id.clone(),
            season_id,
            map_id,
            ranked,
            side_a,
            side_b,
            result,
            decided_by,
            head_start_ticks,
            ticks,
            log_sha256,
            elo,
            recorded_at_ms: U64(env::block_timestamp_ms()),
            block_height: U64(env::block_height()),
        };
        self.matches.insert(match_id.clone(), record.clone());
        if let Some(season) = season_id {
            let n = self.season_match_count.get(&season).copied().unwrap_or(0);
            self.season_matches.insert((season, n), match_id.clone());
            self.season_match_count.insert(season, n + 1);
        }
        self.match_ids.push(match_id);
        emit_event(
            "match_recorded",
            near_sdk::serde_json::to_value(&record).unwrap(),
        );
        record
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

    // ---------- views ----------

    pub fn get_config(&self) -> Config {
        Config {
            owner_id: self.owner_id.clone(),
            ops_id: self.ops_id.clone(),
            elo_start: ELO_START,
            elo_floor: ELO_FLOOR,
        }
    }

    pub fn get_match(&self, match_id: String) -> Option<MatchRecordV2> {
        self.matches.get(&match_id).cloned()
    }

    /// Matches in recording order.
    pub fn get_matches(&self, from_index: Option<u32>, limit: Option<u32>) -> Vec<MatchRecordV2> {
        paginate(&self.match_ids, from_index, limit, |id| {
            self.matches.get(id).cloned()
        })
    }

    pub fn match_count(&self) -> u32 {
        self.match_ids.len()
    }

    /// A season's matches in recording order.
    pub fn get_matches_by_season(
        &self,
        season_id: u32,
        from_index: Option<u32>,
        limit: Option<u32>,
    ) -> Vec<MatchRecordV2> {
        let count = self.season_match_count(season_id);
        let from = from_index.unwrap_or(0);
        let end = from.saturating_add(limit.unwrap_or(50)).min(count);
        (from..end)
            .filter_map(|n| self.season_matches.get(&(season_id, n)))
            .filter_map(|id| self.matches.get(id).cloned())
            .collect()
    }

    pub fn season_match_count(&self, season_id: u32) -> u32 {
        self.season_match_count
            .get(&season_id)
            .copied()
            .unwrap_or(0)
    }

    /// Rating of a player; 1,200 with 0 matches if they never played ranked.
    pub fn get_rating(&self, player: String) -> PlayerRating {
        self.ratings.get(&player).copied().unwrap_or_default()
    }

    pub fn get_ratings(&self, players: Vec<String>) -> Vec<(String, PlayerRating)> {
        players
            .into_iter()
            .map(|p| {
                let r = self.ratings.get(&p).copied().unwrap_or_default();
                (p, r)
            })
            .collect()
    }

    /// A player's standing in a season; all zero if they played no ranked match in it.
    pub fn get_season_standing(&self, season_id: u32, player: String) -> SeasonStanding {
        self.season_standings
            .get(&(season_id, player))
            .copied()
            .unwrap_or_default()
    }
}

impl Contract {
    fn assert_owner(&self) {
        require!(
            env::predecessor_account_id() == self.owner_id,
            "Only the owner can call this method"
        );
    }

    fn assert_ops(&self) {
        require!(
            env::predecessor_account_id() == self.ops_id,
            "Only the platform ops account can record results"
        );
    }
}

#[cfg(test)]
mod tests;
