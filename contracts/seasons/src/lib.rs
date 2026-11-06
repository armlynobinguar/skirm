//! skirm seasons contract (seasons.playskirm.testnet).
//!
//! One prize pool per 14-day season. The platform signer `ops.playskirm.testnet` (or the owner)
//! opens, locks, posts the top-10 standings for and closes each season; anyone can fund the open
//! season, and the market sends 30% of every sale fee here through `fund(None)`.
//!
//! * `open_season`: the previous season must be paid (or absent); the carry rolls into the new
//!   pool.
//! * `fund`: adds the attached NEAR to the open season. Panics when no season is open, so the
//!   market's callback forwards its share to the treasury instead.
//! * `lock_season`: once block time reaches `ends_at_ms`; funding stops.
//! * `post_standings`: up to 10 rows; rank = index + 1; place i gets
//!   `floor(pool · SPLIT_BPS[i] / 10^4)`. Shares of places without a NEAR account, empty places
//!   and the rounding dust go to the carry. An identical retry is a no-op.
//! * `claim`: pull payout. The winner's NEAR account claims its share once. If the transfer
//!   fails, `on_prize_transferred` marks the share unclaimed again (or adds it to the carry when
//!   the season was closed meanwhile), so a failed transfer never strands NEAR.
//! * `close_season`: unclaimed shares go to the carry and the season is paid.
//!
//! The ops writes are idempotent so the worker can retry a write whose response was lost:
//! re-opening the current season with the same args, locking a season that is already locked or
//! paid, re-posting the same standings and closing a paid season each return the season without
//! changing state or emitting an event. Different data panics.

use near_sdk::json_types::U128;
use near_sdk::serde_json::{self, json};
use near_sdk::store::LookupMap;
use near_sdk::{
    assert_one_yocto, env, near, require, AccountId, BorshStorageKey, Gas, NearToken,
    PanicOnDefault, Promise, PromiseError,
};

pub const BPS_DENOMINATOR: u128 = 10_000;
/// Season payout split by rank, in bps: 30/20/15 then 5 × 7. Mirrors @skirm/shared.
pub const SPLIT_BPS: [u16; 10] = [3000, 2000, 1500, 500, 500, 500, 500, 500, 500, 500];
pub const MAX_STANDINGS: usize = SPLIT_BPS.len();
pub const MAX_NAME_LEN: usize = 64;
pub const MAX_ID_LEN: usize = 64;
pub const EVENT_STANDARD: &str = "skirm_seasons";
/// Gas reserved for `on_prize_transferred`, the callback of a prize transfer.
pub const GAS_FOR_ON_PRIZE_TRANSFERRED: Gas = Gas::from_tgas(10);

/// `floor(amount · bps / 10^4)` without overflowing u128 (same as the market contract).
pub fn bps_of(amount: u128, bps: u16) -> u128 {
    let bps = bps as u128;
    (amount / BPS_DENOMINATOR) * bps + (amount % BPS_DENOMINATOR) * bps / BPS_DENOMINATOR
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[near(serializers = [borsh, json])]
#[serde(rename_all = "snake_case")]
pub enum SeasonStatus {
    /// Accepting funds; matches count towards the standings offchain.
    Open,
    /// Ended: no more funds; standings can be posted and prizes claimed.
    Locked,
    /// Closed: unclaimed prizes went to the carry.
    Paid,
}

#[derive(Clone, Debug, PartialEq, Eq)]
#[near(serializers = [borsh, json])]
pub struct Standing {
    pub rank: u32,
    /// Platform account id or handle of the player.
    pub player: String,
    /// The player's NEAR account; without one the place's share goes to the carry.
    pub near: Option<AccountId>,
    pub points: u32,
    /// Claimable amount in yoctoNEAR (0 when `near` is None).
    pub share: U128,
    pub claimed: bool,
}

/// One row of `post_standings`, best first.
#[derive(Clone, Debug, PartialEq, Eq)]
#[near(serializers = [json])]
pub struct StandingInput {
    pub player: String,
    pub near: Option<AccountId>,
    pub points: u32,
}

#[derive(Clone, Debug, PartialEq, Eq)]
#[near(serializers = [borsh, json])]
pub struct Season {
    pub id: u32,
    pub name: String,
    pub starts_at_ms: u64,
    pub ends_at_ms: u64,
    pub status: SeasonStatus,
    /// Carry rolled in at open plus everything funded while open, in yoctoNEAR.
    pub pool: U128,
    pub standings: Vec<Standing>,
    /// True once `post_standings` ran (the standings may be empty).
    pub standings_posted: bool,
    /// Sum of claimed shares.
    pub paid_total: U128,
}

#[derive(Clone, Debug, PartialEq, Eq)]
#[near(serializers = [json])]
pub struct Config {
    pub owner_id: AccountId,
    pub ops_id: AccountId,
    pub current_season_id: Option<u32>,
    pub split_bps: Vec<u16>,
    pub carry: U128,
}

#[derive(BorshStorageKey)]
#[near]
enum StorageKey {
    Seasons,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Contract {
    owner_id: AccountId,
    ops_id: AccountId,
    seasons: LookupMap<u32, Season>,
    /// The latest season opened.
    current: Option<u32>,
    /// Unallocated prize money waiting for the next season, in yoctoNEAR.
    carry: u128,
}

fn emit_event(event: &str, data: serde_json::Value) {
    let ev =
        json!({ "standard": EVENT_STANDARD, "version": "1.0.0", "event": event, "data": [data] });
    env::log_str(&format!("EVENT_JSON:{ev}"));
}

fn same_rows(posted: &[Standing], input: &[StandingInput]) -> bool {
    posted.len() == input.len()
        && posted
            .iter()
            .zip(input)
            .all(|(s, i)| s.player == i.player && s.near == i.near && s.points == i.points)
}

#[near]
impl Contract {
    #[init]
    pub fn new(owner_id: AccountId, ops_id: AccountId) -> Self {
        Self {
            owner_id,
            ops_id,
            seasons: LookupMap::new(StorageKey::Seasons),
            current: None,
            carry: 0,
        }
    }

    /// Open season `id`. Owner or ops. The previous season must be paid; the carry becomes the
    /// new season's starting pool.
    pub fn open_season(
        &mut self,
        id: u32,
        name: String,
        starts_at_ms: u64,
        ends_at_ms: u64,
    ) -> Season {
        self.assert_owner_or_ops();
        if let Some(cur) = self.current.filter(|cur| *cur == id) {
            let season = self.expect_season(cur);
            require!(
                season.name == name
                    && season.starts_at_ms == starts_at_ms
                    && season.ends_at_ms == ends_at_ms,
                "Season already exists"
            );
            return season;
        }
        require!(
            !name.is_empty() && name.len() <= MAX_NAME_LEN,
            "name must be 1-64 bytes"
        );
        require!(
            ends_at_ms > starts_at_ms,
            "ends_at_ms must be after starts_at_ms"
        );
        if let Some(cur) = self.current {
            require!(id > cur, "Season ids must increase");
            require!(
                self.expect_season(cur).status == SeasonStatus::Paid,
                "The previous season must be paid out first"
            );
        }
        require!(!self.seasons.contains_key(&id), "Season already exists");

        let pool = std::mem::take(&mut self.carry);
        let season = Season {
            id,
            name,
            starts_at_ms,
            ends_at_ms,
            status: SeasonStatus::Open,
            pool: U128(pool),
            standings: vec![],
            standings_posted: false,
            paid_total: U128(0),
        };
        self.seasons.insert(id, season.clone());
        self.current = Some(id);
        emit_event(
            "season_opened",
            json!({
                "season_id": id,
                "name": season.name,
                "starts_at_ms": starts_at_ms,
                "ends_at_ms": ends_at_ms,
                "pool": season.pool,
            }),
        );
        if pool > 0 {
            emit_event(
                "carry_rolled",
                json!({ "season_id": id, "amount": U128(pool) }),
            );
        }
        season
    }

    /// Add the attached NEAR to season `season_id` (default: the current one). Anyone. Panics
    /// when that season is not open. Returns the new pool.
    #[payable]
    pub fn fund(&mut self, season_id: Option<u32>) -> U128 {
        let amount = env::attached_deposit().as_yoctonear();
        require!(amount > 0, "Attach NEAR to fund a season");
        let id = season_id
            .or(self.current)
            .unwrap_or_else(|| env::panic_str("No season is open"));
        let mut season = self
            .seasons
            .get(&id)
            .cloned()
            .unwrap_or_else(|| env::panic_str("No season is open"));
        require!(season.status == SeasonStatus::Open, "No season is open");
        season.pool = U128(season.pool.0 + amount);
        let pool = season.pool;
        self.seasons.insert(id, season);
        emit_event(
            "season_funded",
            json!({
                "season_id": id,
                "from": env::predecessor_account_id(),
                "amount": U128(amount),
                "pool": pool,
            }),
        );
        pool
    }

    /// Stop funding once the season has ended. Owner or ops. A season that is already locked or
    /// paid is returned unchanged.
    pub fn lock_season(&mut self, id: u32) -> Season {
        self.assert_owner_or_ops();
        let mut season = self.expect_season(id);
        if season.status != SeasonStatus::Open {
            return season;
        }
        require!(
            env::block_timestamp_ms() >= season.ends_at_ms,
            "Season has not ended yet"
        );
        season.status = SeasonStatus::Locked;
        self.seasons.insert(id, season.clone());
        emit_event(
            "season_locked",
            json!({ "season_id": id, "pool": season.pool }),
        );
        season
    }

    /// Post the final top 10 of a locked season, best first. Owner or ops. Posting the same rows
    /// again is a no-op; different rows panic.
    pub fn post_standings(&mut self, id: u32, standings: Vec<StandingInput>) -> Season {
        self.assert_owner_or_ops();
        let mut season = self.expect_season(id);
        if season.standings_posted {
            require!(
                same_rows(&season.standings, &standings),
                "Standings already posted with different data"
            );
            return season;
        }
        require!(
            season.status == SeasonStatus::Locked,
            "Season is not locked"
        );
        require!(standings.len() <= MAX_STANDINGS, "At most 10 standings");
        for (i, row) in standings.iter().enumerate() {
            require!(
                !row.player.is_empty() && row.player.len() <= MAX_ID_LEN,
                "player must be 1-64 bytes"
            );
            if i > 0 {
                require!(
                    row.points <= standings[i - 1].points,
                    "Standings must be ordered by points, best first"
                );
            }
            for other in &standings[..i] {
                require!(other.player != row.player, "Duplicate player in standings");
                require!(
                    row.near.is_none() || other.near != row.near,
                    "Duplicate NEAR account in standings"
                );
            }
        }

        let pool = season.pool.0;
        let mut allocated = 0u128;
        season.standings = standings
            .into_iter()
            .enumerate()
            .map(|(i, row)| {
                let share = if row.near.is_some() {
                    bps_of(pool, SPLIT_BPS[i])
                } else {
                    0
                };
                allocated += share;
                Standing {
                    rank: i as u32 + 1,
                    player: row.player,
                    near: row.near,
                    points: row.points,
                    share: U128(share),
                    claimed: false,
                }
            })
            .collect();
        let to_carry = pool - allocated;
        self.carry += to_carry;
        season.standings_posted = true;
        self.seasons.insert(id, season.clone());
        emit_event(
            "standings_posted",
            json!({
                "season_id": id,
                "pool": season.pool,
                "standings": season.standings,
                "to_carry": U128(to_carry),
            }),
        );
        season
    }

    /// The caller's NEAR account claims its prize of a locked season, once. The share is marked
    /// claimed before the transfer so it cannot be claimed twice while the transfer is in flight;
    /// `on_prize_transferred` undoes that if the transfer fails. The transaction's result is the
    /// callback's: the amount sent, or 0 when the transfer failed.
    pub fn claim(&mut self, id: u32) -> Promise {
        let mut season = self.expect_season(id);
        require!(
            season.status == SeasonStatus::Locked && season.standings_posted,
            "Prizes of this season are not claimable"
        );
        let who = env::predecessor_account_id();
        let i = season
            .standings
            .iter()
            .position(|s| s.near.as_ref() == Some(&who))
            .unwrap_or_else(|| env::panic_str("No prize for this account"));
        let standing = &mut season.standings[i];
        require!(!standing.claimed, "Prize already claimed");
        let amount = standing.share.0;
        require!(amount > 0, "Nothing to claim");
        standing.claimed = true;
        let rank = standing.rank;
        season.paid_total = U128(season.paid_total.0 + amount);
        self.seasons.insert(id, season);

        Promise::new(who.clone())
            .transfer(NearToken::from_yoctonear(amount))
            .then(
                Self::ext(env::current_account_id())
                    .with_static_gas(GAS_FOR_ON_PRIZE_TRANSFERRED)
                    .on_prize_transferred(id, rank, who, U128(amount)),
            )
    }

    /// Callback of the prize transfer started by `claim`. On success emits `prize_claimed` and
    /// returns the amount. A failed transfer refunds the NEAR to this contract: the share is
    /// marked unclaimed again so the winner can retry, or, when the season was closed in the
    /// meantime (`close_season` counted the share as claimed), it goes to the carry. Emits
    /// `prize_transfer_failed` and returns 0 then.
    #[private]
    pub fn on_prize_transferred(
        &mut self,
        id: u32,
        rank: u32,
        near: AccountId,
        amount: U128,
    ) -> U128 {
        // Same check as #[private]; repeated in the body so unit tests exercise it.
        require!(
            env::predecessor_account_id() == env::current_account_id(),
            "Method on_prize_transferred is private"
        );
        let mut season = self.expect_season(id);
        // rank = index + 1 (see post_standings).
        let i = (rank as usize).saturating_sub(1);
        require!(
            rank >= 1 && season.standings.get(i).and_then(|s| s.near.as_ref()) == Some(&near),
            "Standing not found"
        );
        // A transfer returns no data; only a failed transfer is an error.
        let failed = matches!(
            env::promise_result_checked(0, 0),
            Err(PromiseError::Failed)
        );
        let player = season.standings[i].player.clone();
        if !failed {
            emit_event(
                "prize_claimed",
                json!({
                    "season_id": id,
                    "rank": rank,
                    "player": player,
                    "near": near,
                    "amount": amount,
                }),
            );
            return amount;
        }
        let to_carry = season.status == SeasonStatus::Paid;
        if to_carry {
            self.carry += amount.0;
        }
        season.standings[i].claimed = false;
        season.paid_total = U128(season.paid_total.0.saturating_sub(amount.0));
        self.seasons.insert(id, season);
        emit_event(
            "prize_transfer_failed",
            json!({
                "season_id": id,
                "rank": rank,
                "player": player,
                "near": near,
                "amount": amount,
                "to_carry": to_carry,
                "carry": U128(self.carry),
            }),
        );
        U128(0)
    }

    /// Close a locked season with posted standings. Owner or ops. Unclaimed shares go to the
    /// carry. A paid season is returned unchanged.
    pub fn close_season(&mut self, id: u32) -> Season {
        self.assert_owner_or_ops();
        let mut season = self.expect_season(id);
        if season.status == SeasonStatus::Paid {
            return season;
        }
        require!(
            season.status == SeasonStatus::Locked,
            "Season is not locked"
        );
        require!(season.standings_posted, "Post standings before closing");
        let unclaimed: u128 = season
            .standings
            .iter()
            .filter(|s| !s.claimed)
            .map(|s| s.share.0)
            .sum();
        self.carry += unclaimed;
        season.status = SeasonStatus::Paid;
        self.seasons.insert(id, season.clone());
        emit_event(
            "season_closed",
            json!({
                "season_id": id,
                "pool": season.pool,
                "paid_total": season.paid_total,
                "unclaimed": U128(unclaimed),
                "carry": U128(self.carry),
            }),
        );
        season
    }

    // ---------- admin ----------

    #[payable]
    pub fn set_ops(&mut self, ops_id: AccountId) {
        assert_one_yocto();
        self.assert_owner();
        let old = std::mem::replace(&mut self.ops_id, ops_id);
        emit_event("ops_updated", json!({ "old": old, "new": self.ops_id }));
    }

    #[payable]
    pub fn set_owner(&mut self, owner_id: AccountId) {
        assert_one_yocto();
        self.assert_owner();
        let old = std::mem::replace(&mut self.owner_id, owner_id);
        emit_event("owner_updated", json!({ "old": old, "new": self.owner_id }));
    }

    // ---------- views ----------

    pub fn get_season(&self, id: u32) -> Option<Season> {
        self.seasons.get(&id).cloned()
    }

    pub fn current_season(&self) -> Option<Season> {
        self.current.and_then(|id| self.seasons.get(&id).cloned())
    }

    pub fn get_config(&self) -> Config {
        Config {
            owner_id: self.owner_id.clone(),
            ops_id: self.ops_id.clone(),
            current_season_id: self.current,
            split_bps: SPLIT_BPS.to_vec(),
            carry: U128(self.carry),
        }
    }

    pub fn get_carry(&self) -> U128 {
        U128(self.carry)
    }
}

impl Contract {
    fn assert_owner(&self) {
        require!(
            env::predecessor_account_id() == self.owner_id,
            "Only the owner can call this method"
        );
    }

    fn assert_owner_or_ops(&self) {
        let p = env::predecessor_account_id();
        require!(
            p == self.owner_id || p == self.ops_id,
            "Only the owner or ops can call this method"
        );
    }

    fn expect_season(&self, id: u32) -> Season {
        self.seasons
            .get(&id)
            .cloned()
            .unwrap_or_else(|| env::panic_str("Season not found"))
    }
}

#[cfg(test)]
mod tests;
