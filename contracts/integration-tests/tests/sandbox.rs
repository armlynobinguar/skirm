//! End-to-end flows on a local near-sandbox node (near-workspaces).
//!
//! Build the wasm first, then run:
//!   cargo test -p skirm-integration-tests --features sandbox
#![cfg(feature = "sandbox")]

use near_workspaces::network::Sandbox;
use near_workspaces::result::ExecutionFinalResult;
use near_workspaces::types::{Gas, NearToken};
use near_workspaces::{Account, Contract, Worker};
use serde_json::{json, Value};

const SKILL_ID: &str = "skl_01JB7Z3K9QX4M2T8V6N5R1C0DE";
const SHA: &str = "9f2c0e6b4a1d3c5e7f9a0b2c4d6e8f1a3b5c7d9e0f2a4b6c8d0e1f3a5b7c9d0e";

fn wasm(name: &str) -> anyhow::Result<Vec<u8>> {
    let path = format!(
        "{}/../target/wasm32-unknown-unknown/release/{name}.wasm",
        env!("CARGO_MANIFEST_DIR")
    );
    std::fs::read(&path).map_err(|e| anyhow::anyhow!("{path}: {e} (build the wasm first)"))
}

fn near(n: u128) -> u128 {
    NearToken::from_near(n).as_yoctonear()
}
fn milli(n: u128) -> u128 {
    NearToken::from_millinear(n).as_yoctonear()
}

struct Env {
    worker: Worker<Sandbox>,
    owner: Account,
    ops: Account,
    treasury: Account,
    creator: Account,
    buyer: Account,
    reseller: Account,
    skills: Contract,
    market: Contract,
    registry: Contract,
    deposits: Contract,
}

async fn account(root: &Account, name: &str, balance: u128) -> anyhow::Result<Account> {
    Ok(root
        .create_subaccount(name)
        .initial_balance(NearToken::from_near(balance))
        .transact()
        .await?
        .into_result()?)
}

async fn deploy(root: &Account, name: &str, file: &str) -> anyhow::Result<Contract> {
    let acc = account(root, name, 30).await?;
    Ok(acc.deploy(&wasm(file)?).await?.into_result()?)
}

async fn setup() -> anyhow::Result<Env> {
    let worker = near_workspaces::sandbox().await?;
    let root = worker.root_account()?;
    let owner = account(&root, "owner", 50).await?;
    let ops = account(&root, "ops", 20).await?;
    let treasury = account(&root, "treasury", 5).await?;
    let creator = account(&root, "creator", 20).await?;
    let buyer = account(&root, "buyer", 50).await?;
    let reseller = account(&root, "reseller", 50).await?;

    let skills = deploy(&root, "skills", "skirm_skills").await?;
    let market = deploy(&root, "market", "skirm_market").await?;
    let registry = deploy(&root, "registry", "skirm_registry").await?;
    let deposits = deploy(&root, "deposits", "skirm_deposits").await?;

    skills
        .call("new")
        .args_json(json!({ "owner_id": owner.id(), "ops_id": ops.id() }))
        .transact()
        .await?
        .into_result()?;
    market
        .call("new")
        .args_json(json!({ "owner_id": owner.id(), "nft_contract_id": skills.id(), "treasury_id": treasury.id() }))
        .transact()
        .await?
        .into_result()?;
    registry
        .call("new")
        .args_json(json!({ "owner_id": owner.id(), "ops_id": ops.id() }))
        .transact()
        .await?
        .into_result()?;
    deposits
        .call("new")
        .args_json(json!({ "owner_id": owner.id(), "treasury_id": treasury.id() }))
        .transact()
        .await?
        .into_result()?;

    Ok(Env {
        worker,
        owner,
        ops,
        treasury,
        creator,
        buyer,
        reseller,
        skills,
        market,
        registry,
        deposits,
    })
}

async fn balance(a: &Account) -> anyhow::Result<u128> {
    Ok(a.view_account().await?.balance.as_yoctonear())
}

fn token_id(version: u32) -> String {
    format!("{SKILL_ID}:{version}")
}

async fn mint(env: &Env, version: u32) -> anyhow::Result<ExecutionFinalResult> {
    Ok(env
        .ops
        .call(env.skills.id(), "nft_mint")
        .args_json(json!({ "skill": {
            "id": SKILL_ID,
            "version": version,
            "name": "Flood Warden Plus",
            "summary": "Seals the leak first.",
            "creator": env.creator.id(),
            "requires_actions": ["place_block"],
            "handles_tags": ["spreads", "liquid"],
            "prompt_sha256": SHA,
            "created_at": "2026-11-03T08:15:00Z",
        }}))
        .max_gas()
        .transact()
        .await?)
}

async fn list(env: &Env, seller: &Account, version: u32, price: u128) -> anyhow::Result<()> {
    seller
        .call(env.skills.id(), "nft_approve")
        .args_json(json!({
            "token_id": token_id(version),
            "account_id": env.market.id(),
            "msg": json!({ "price": price.to_string() }).to_string(),
        }))
        .deposit(NearToken::from_millinear(10))
        .gas(Gas::from_tgas(100))
        .transact()
        .await?
        .into_result()?;
    settle(env).await
}

/// Lets late gas-refund receipts land so balance snapshots only see the next transaction.
async fn settle(env: &Env) -> anyhow::Result<()> {
    env.worker.fast_forward(5).await?;
    Ok(())
}

async fn buy(
    env: &Env,
    buyer: &Account,
    version: u32,
    deposit: u128,
) -> anyhow::Result<ExecutionFinalResult> {
    Ok(buyer
        .call(env.market.id(), "buy")
        .args_json(json!({ "token_id": token_id(version) }))
        .deposit(NearToken::from_yoctonear(deposit))
        .gas(Gas::from_tgas(150))
        .transact()
        .await?)
}

async fn owner_of(env: &Env, version: u32) -> anyhow::Result<String> {
    let t: Value = env
        .skills
        .view("nft_token")
        .args_json(json!({ "token_id": token_id(version) }))
        .await?
        .json()?;
    Ok(t["owner_id"].as_str().unwrap_or_default().to_string())
}

/// Storage refund the skills contract sends the previous owner for one cleared approval.
fn approval_refund(market: &Contract) -> u128 {
    (market.id().as_str().len() as u128 + 4 + 8) * 10u128.pow(19)
}

#[tokio::test]
async fn mint_list_buy_resell_pays_fee_and_royalty() -> anyhow::Result<()> {
    let env = setup().await?;

    // Only ops can mint.
    let denied = env
        .creator
        .call(env.skills.id(), "nft_mint")
        .args_json(json!({ "skill": { "id": SKILL_ID, "version": 1, "name": "Nope", "creator": env.creator.id(),
            "requires_actions": [], "handles_tags": ["goal"], "prompt_sha256": SHA, "created_at": "2026-11-03T08:15:00Z" }}))
        .max_gas()
        .transact()
        .await?;
    assert!(denied.is_failure());

    let minted = mint(&env, 1).await?;
    assert!(minted.is_success(), "{minted:?}");
    assert_eq!(owner_of(&env, 1).await?, env.creator.id().to_string());
    let t: Value = env
        .skills
        .view("nft_token")
        .args_json(json!({ "token_id": token_id(1) }))
        .await?
        .json()?;
    let extra: Value = serde_json::from_str(t["metadata"]["extra"].as_str().unwrap())?;
    assert_eq!(extra["royalty_bps"], 500);
    assert_eq!(extra["prompt_sha256"], SHA);

    // Primary sale at 5 NEAR: fee 0.25 to treasury, creator 4.75.
    list(&env, &env.creator, 1, near(5)).await?;
    let listing: Value = env
        .market
        .view("get_listing")
        .args_json(json!({ "token_id": token_id(1) }))
        .await?
        .json()?;
    assert_eq!(listing["price"], near(5).to_string());

    let treasury0 = balance(&env.treasury).await?;
    let creator0 = balance(&env.creator).await?;
    let sale = buy(&env, &env.buyer, 1, near(6)).await?;
    assert!(sale.is_success(), "{sale:?}");
    assert_eq!(sale.json::<bool>()?, true);
    assert_eq!(owner_of(&env, 1).await?, env.buyer.id().to_string());
    assert_eq!(balance(&env.treasury).await? - treasury0, milli(250));
    assert_eq!(
        balance(&env.creator).await? - creator0,
        milli(4750) + approval_refund(&env.market)
    );

    // Resale at 5 NEAR: fee 0.25, royalty 0.25 to the creator, seller 4.5.
    list(&env, &env.buyer, 1, near(5)).await?;
    let treasury1 = balance(&env.treasury).await?;
    let creator1 = balance(&env.creator).await?;
    let seller1 = balance(&env.buyer).await?;
    let resale = buy(&env, &env.reseller, 1, near(5)).await?;
    assert!(resale.is_success(), "{resale:?}");
    assert_eq!(owner_of(&env, 1).await?, env.reseller.id().to_string());
    assert_eq!(balance(&env.treasury).await? - treasury1, milli(250));
    assert_eq!(balance(&env.creator).await? - creator1, milli(250));
    assert_eq!(
        balance(&env.buyer).await? - seller1,
        milli(4500) + approval_refund(&env.market)
    );
    Ok(())
}

#[tokio::test]
async fn failed_transfer_refunds_buyer() -> anyhow::Result<()> {
    let env = setup().await?;
    assert!(mint(&env, 1).await?.is_success());
    list(&env, &env.creator, 1, near(5)).await?;
    // Seller revokes the market's approval after listing: the sale must fail safely.
    env.creator
        .call(env.skills.id(), "nft_revoke")
        .args_json(json!({ "token_id": token_id(1), "account_id": env.market.id() }))
        .deposit(NearToken::from_yoctonear(1))
        .max_gas()
        .transact()
        .await?
        .into_result()?;

    let buyer0 = balance(&env.buyer).await?;
    let out = buy(&env, &env.buyer, 1, near(5)).await?;
    assert!(out.is_success(), "{out:?}");
    assert_eq!(out.json::<bool>()?, false);
    assert_eq!(owner_of(&env, 1).await?, env.creator.id().to_string());
    // Only gas was spent.
    let spent = buyer0 - balance(&env.buyer).await?;
    assert!(spent < milli(50), "buyer lost {spent} yocto");
    let listing: Option<Value> = env
        .market
        .view("get_listing")
        .args_json(json!({ "token_id": token_id(1) }))
        .await?
        .json()?;
    assert!(listing.is_none());
    let pending: bool = env
        .market
        .view("is_purchase_pending")
        .args_json(json!({ "token_id": token_id(1) }))
        .await?
        .json()?;
    assert!(!pending);
    Ok(())
}

#[tokio::test]
async fn registry_records_matches_ratings_and_standings() -> anyhow::Result<()> {
    let env = setup().await?;
    let args = json!({
        "match_id": "m_1", "season_id": 1, "map_id": "copper-hollow", "ranked": true,
        "side_a": { "player": "p1", "agents": ["agt_A"], "tiers": ["standard"], "delivered": 3 },
        "side_b": { "player": "p2", "agents": ["agt_B"], "tiers": ["open"], "delivered": 1 },
        "result": "A", "decided_by": "goal", "head_start_ticks": 0, "ticks": 90,
        "log_sha256": SHA,
        "elo_changes": [{ "player": "p1", "delta": 21 }, { "player": "p2", "delta": -21 }],
    });
    let denied = env
        .creator
        .call(env.registry.id(), "record_match")
        .args_json(args.clone())
        .transact()
        .await?;
    assert!(denied.is_failure());
    env.ops
        .call(env.registry.id(), "record_match")
        .args_json(args)
        .transact()
        .await?
        .into_result()?;
    let m: Value = env
        .registry
        .view("get_match")
        .args_json(json!({ "match_id": "m_1" }))
        .await?
        .json()?;
    assert_eq!(m["log_sha256"], SHA);
    assert_eq!(m["elo"][0]["after"], 1221);
    let r: Value = env
        .registry
        .view("get_rating")
        .args_json(json!({ "player": "p1" }))
        .await?
        .json()?;
    assert_eq!(r["rating"], 1221);
    assert_eq!(r["wins"], 1);
    let st: Value = env
        .registry
        .view("get_season_standing")
        .args_json(json!({ "season_id": 1, "player": "p2" }))
        .await?
        .json()?;
    assert_eq!(st["points"], 5);
    let season: Vec<Value> = env
        .registry
        .view("get_matches_by_season")
        .args_json(json!({ "season_id": 1 }))
        .await?
        .json()?;
    assert_eq!(season.len(), 1);
    Ok(())
}

#[tokio::test]
async fn deposit_logs_event_and_owner_withdraws() -> anyhow::Result<()> {
    let env = setup().await?;
    let out = env
        .buyer
        .call(env.deposits.id(), "deposit")
        .deposit(NearToken::from_near(2))
        .transact()
        .await?;
    assert!(out.is_success(), "{out:?}");
    let log = out
        .logs()
        .into_iter()
        .find(|l| l.starts_with("EVENT_JSON:"))
        .expect("event");
    let v: Value = serde_json::from_str(&log["EVENT_JSON:".len()..])?;
    assert_eq!(v["event"], "deposit");
    assert_eq!(v["data"][0]["player"], env.buyer.id().to_string());
    assert_eq!(v["data"][0]["amount"], near(2).to_string());
    assert_eq!(v["data"][0]["receipt"], "1");

    let denied = env
        .buyer
        .call(env.deposits.id(), "withdraw")
        .deposit(NearToken::from_yoctonear(1))
        .transact()
        .await?;
    assert!(denied.is_failure());

    settle(&env).await?;
    let treasury0 = balance(&env.treasury).await?;
    env.owner
        .call(env.deposits.id(), "withdraw")
        .args_json(json!({ "amount": near(2).to_string() }))
        .deposit(NearToken::from_yoctonear(1))
        // The transfer plus the on_withdrawn callback need more than the 10 TGas default.
        .gas(Gas::from_tgas(30))
        .transact()
        .await?
        .into_result()?;
    assert_eq!(balance(&env.treasury).await? - treasury0, near(2));
    Ok(())
}

/// Measures the storage each platform write costs the paying contract (to size how much
/// NEAR `skills` and `registry` need). 1 byte = 10^19 yoctoNEAR.
#[tokio::test]
async fn storage_cost_per_platform_write() -> anyhow::Result<()> {
    let env = setup().await?;
    let usage = |c: &Contract| {
        let c = c.as_account().clone();
        async move { anyhow::Ok(c.view_account().await?.storage_usage) }
    };

    let before = usage(&env.skills).await?;
    assert!(mint(&env, 1).await?.is_success());
    let per_mint = usage(&env.skills).await? - before;

    let before = usage(&env.registry).await?;
    env.ops
        .call(env.registry.id(), "record_match")
        .args_json(json!({
            "match_id": "mat_01JB7Z3K9QX4M2T8V6N5R1C0DE", "season_id": 1, "map_id": "copper-hollow",
            "ranked": true,
            "side_a": { "player": "player-with-a-long-name.testnet",
                "agents": ["agt_01JB7Z3K9QX4M2T8V6N5R1C0D1", "agt_01JB7Z3K9QX4M2T8V6N5R1C0D2", "agt_01JB7Z3K9QX4M2T8V6N5R1C0D3"],
                "tiers": ["quiet", "standard", "open"], "delivered": 3 },
            "side_b": { "player": "p2.testnet",
                "agents": ["agt_01JB7Z3K9QX4M2T8V6N5R1C0D4", "agt_01JB7Z3K9QX4M2T8V6N5R1C0D5", "agt_01JB7Z3K9QX4M2T8V6N5R1C0D6"],
                "tiers": ["standard", "standard", "standard"], "delivered": 1 },
            "result": "A", "decided_by": "score", "head_start_ticks": 0, "ticks": 150,
            "log_sha256": SHA,
            "elo_changes": [
                { "player": "player-with-a-long-name.testnet", "delta": 16 },
                { "player": "p2.testnet", "delta": -16 }
            ],
        }))
        .transact()
        .await?
        .into_result()?;
    let per_match = usage(&env.registry).await? - before;

    eprintln!(
        "storage bytes: mint {per_mint}, ranked 3v3 season match with 2 new players {per_match}"
    );
    assert!(per_mint < 2_000 && per_match < 2_500);
    Ok(())
}
