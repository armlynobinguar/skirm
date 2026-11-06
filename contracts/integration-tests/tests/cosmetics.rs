//! The cosmetics contract (NEP-245) on a local near-sandbox node: ops creates and mints an item,
//! the holder transfers a copy, and a transfer_call to an account with no contract is refunded by
//! the private resolver.
//!
//! Build the wasm first, then run:
//!   cargo test -p skirm-integration-tests --features sandbox --test cosmetics
#![cfg(feature = "sandbox")]

use near_workspaces::types::{Gas, NearToken};
use near_workspaces::{Account, Contract};
use serde_json::{json, Value};

fn wasm() -> anyhow::Result<Vec<u8>> {
    let path = format!(
        "{}/../target/wasm32-unknown-unknown/release/skirm_cosmetics.wasm",
        env!("CARGO_MANIFEST_DIR")
    );
    std::fs::read(&path).map_err(|e| anyhow::anyhow!("{path}: {e} (build the wasm first)"))
}

async fn account(root: &Account, name: &str, balance: u128) -> anyhow::Result<Account> {
    Ok(root
        .create_subaccount(name)
        .initial_balance(NearToken::from_near(balance))
        .transact()
        .await?
        .into_result()?)
}

async fn balance_of(c: &Contract, who: &Account, token: &str) -> anyhow::Result<String> {
    let v: Value = c
        .view("mt_balance_of")
        .args_json(json!({ "account_id": who.id(), "token_id": token }))
        .await?
        .json()?;
    Ok(v.as_str().unwrap_or_default().to_string())
}

fn events(logs: Vec<&str>) -> Vec<Value> {
    logs.into_iter()
        .filter_map(|l| l.strip_prefix("EVENT_JSON:"))
        .map(|j| serde_json::from_str(j).unwrap())
        .collect()
}

#[tokio::test]
async fn create_mint_transfer_and_refunded_transfer_call() -> anyhow::Result<()> {
    let worker = near_workspaces::sandbox().await?;
    let root = worker.root_account()?;
    let owner = account(&root, "owner", 20).await?;
    let ops = account(&root, "ops", 20).await?;
    let ana = account(&root, "ana", 10).await?;
    let ben = account(&root, "ben", 10).await?;
    let c = account(&root, "cosmetics", 20)
        .await?
        .deploy(&wasm()?)
        .await?
        .into_result()?;
    c.call("new")
        .args_json(json!({ "owner_id": owner.id(), "ops_id": ops.id() }))
        .transact()
        .await?
        .into_result()?;

    // Ops pays storage from a storage balance the owner tops up (a function-call key attaches nothing).
    owner
        .call(c.id(), "storage_deposit")
        .args_json(json!({ "account_id": ops.id() }))
        .deposit(NearToken::from_near(1))
        .transact()
        .await?
        .into_result()?;
    let extra = json!({ "schema": "skirm.cosmetic/v0", "kind": "skin", "body": "#ff6a3d" }).to_string();
    ops.call(c.id(), "mt_create")
        .args_json(json!({
            "token_id": "skin_ember",
            "metadata": { "title": "Ember skin", "description": "Hot orange with gold stripes", "extra": extra },
        }))
        .transact()
        .await?
        .into_result()?;
    let minted = ops
        .call(c.id(), "mt_mint")
        .args_json(json!({
            "receiver_id": ana.id(),
            "token_ids": ["skin_ember"],
            "amounts": ["2"],
            "mint_id": "acc_1:skin_ember",
        }))
        .transact()
        .await?;
    assert!(minted.is_success(), "{minted:?}");
    let ev = events(minted.logs());
    assert_eq!(ev[0]["standard"], "nep245");
    assert_eq!(ev[0]["event"], "mt_mint");
    assert_eq!(balance_of(&c, &ana, "skin_ember").await?, "2");

    // A resend with the same mint_id mints nothing.
    let again: bool = ops
        .call(c.id(), "mt_mint")
        .args_json(json!({
            "receiver_id": ana.id(),
            "token_ids": ["skin_ember"],
            "amounts": ["2"],
            "mint_id": "acc_1:skin_ember",
        }))
        .transact()
        .await?
        .json()?;
    assert!(!again);
    assert_eq!(balance_of(&c, &ana, "skin_ember").await?, "2");

    // Players cannot mint.
    let denied = ana
        .call(c.id(), "mt_mint")
        .args_json(json!({ "receiver_id": ana.id(), "token_ids": ["skin_ember"], "amounts": ["1"] }))
        .deposit(NearToken::from_millinear(10))
        .transact()
        .await?;
    assert!(denied.is_failure());

    // Ana registers storage, then sends one copy to Ben (1 yocto).
    ana.call(c.id(), "storage_deposit")
        .deposit(NearToken::from_millinear(50))
        .transact()
        .await?
        .into_result()?;
    let sent = ana
        .call(c.id(), "mt_transfer")
        .args_json(json!({ "receiver_id": ben.id(), "token_id": "skin_ember", "amount": "1" }))
        .deposit(NearToken::from_yoctonear(1))
        .transact()
        .await?;
    assert!(sent.is_success(), "{sent:?}");
    assert_eq!(events(sent.logs())[0]["event"], "mt_transfer");
    assert_eq!(balance_of(&c, &ana, "skin_ember").await?, "1");
    assert_eq!(balance_of(&c, &ben, "skin_ember").await?, "1");

    // transfer_call to an account with no contract: mt_on_transfer fails, the resolver refunds.
    let call = ana
        .call(c.id(), "mt_transfer_call")
        .args_json(json!({ "receiver_id": ben.id(), "token_id": "skin_ember", "amount": "1", "msg": "" }))
        .deposit(NearToken::from_yoctonear(1))
        .gas(Gas::from_tgas(150))
        .transact()
        .await?;
    let kept: Vec<String> = call.json()?;
    assert_eq!(kept, vec!["0".to_string()]);
    assert_eq!(balance_of(&c, &ana, "skin_ember").await?, "1");
    assert_eq!(balance_of(&c, &ben, "skin_ember").await?, "1");

    let tokens: Value = c
        .view("mt_tokens_for_owner")
        .args_json(json!({ "account_id": ben.id() }))
        .await?
        .json()?;
    assert_eq!(tokens[0]["token_id"], "skin_ember");
    assert_eq!(tokens[0]["supply"], "2");
    Ok(())
}
