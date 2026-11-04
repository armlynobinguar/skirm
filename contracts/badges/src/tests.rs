use super::*;
use near_sdk::test_utils::{get_logs, VMContextBuilder};
use near_sdk::{testing_env, NearToken};

const PLAYER: &str = "acc_01JB7Z3K9QX4M2T8V6N5R1C0DE";

fn acc(s: &str) -> AccountId {
    s.parse().unwrap()
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

fn set(predecessor: AccountId, deposit: NearToken) {
    let mut b = VMContextBuilder::new();
    b.current_account_id(acc("badges.playskirm.testnet"))
        .signer_account_id(predecessor.clone())
        .predecessor_account_id(predecessor)
        .attached_deposit(deposit)
        .account_balance(NearToken::from_near(100))
        .block_timestamp(1_793_700_000_000_000_000);
    testing_env!(b.build());
}

fn setup() -> Contract {
    set(owner(), NearToken::from_yoctonear(0));
    Contract::new(owner(), ops(), None)
}

fn badge(achievement: &str) -> BadgeMint {
    BadgeMint {
        achievement_id: achievement.to_string(),
        player: PLAYER.to_string(),
        title: "First win".to_string(),
        description: "Win a match".to_string(),
        unlocked_at_ms: 1_793_600_000_000,
    }
}

fn mint(c: &mut Contract, achievement: &str, to: AccountId) -> Token {
    set(ops(), NearToken::from_yoctonear(0));
    c.nft_mint(token_id_for(achievement, PLAYER), to, badge(achievement))
}

#[test]
fn ops_mints_a_badge_with_a_nep171_event() {
    let mut c = setup();
    let t = mint(&mut c, "first_win", ana());
    assert_eq!(t.token_id, format!("first_win:{PLAYER}"));
    assert_eq!(t.owner_id, ana());
    let md = t.metadata.clone().unwrap();
    assert_eq!(md.title.as_deref(), Some("First win"));
    assert_eq!(md.copies, Some(1));
    let extra: near_sdk::serde_json::Value =
        near_sdk::serde_json::from_str(md.extra.as_deref().unwrap()).unwrap();
    assert_eq!(extra["schema"], BADGE_SCHEMA);
    assert_eq!(extra["achievement_id"], "first_win");
    assert_eq!(extra["soulbound"], true);

    let logs = get_logs();
    assert_eq!(logs.len(), 1);
    let v: near_sdk::serde_json::Value =
        near_sdk::serde_json::from_str(&logs[0]["EVENT_JSON:".len()..]).unwrap();
    assert_eq!(v["standard"], "nep171");
    assert_eq!(v["event"], "nft_mint");
    assert_eq!(v["data"][0]["owner_id"], "ana.testnet");
    assert_eq!(v["data"][0]["token_ids"][0], t.token_id);

    let info = c.badge_info(t.token_id.clone()).unwrap();
    assert_eq!(info.player, PLAYER);
    assert_eq!(info.owner_id, ana());
    assert_eq!(info.unlocked_at_ms, 1_793_600_000_000);
    assert_eq!(info.minted_at_ms, 1_793_700_000_000);
    assert_eq!(
        c.badge_for("first_win".to_string(), PLAYER.to_string()).unwrap().token_id,
        t.token_id
    );
}

#[test]
fn mint_again_to_the_same_owner_returns_the_existing_badge() {
    let mut c = setup();
    let first = mint(&mut c, "first_win", ana());
    let again = mint(&mut c, "first_win", ana());
    assert_eq!(first.token_id, again.token_id);
    assert!(get_logs().is_empty(), "no second event");
    assert_eq!(c.nft_total_supply(), U128(1));
}

#[test]
#[should_panic(expected = "already minted to another account")]
fn the_same_badge_cannot_go_to_another_owner() {
    let mut c = setup();
    mint(&mut c, "first_win", ana());
    mint(&mut c, "first_win", ben());
}

#[test]
#[should_panic(expected = "Only the platform ops account can mint")]
fn only_ops_mints() {
    let mut c = setup();
    set(ana(), NearToken::from_yoctonear(0));
    c.nft_mint(token_id_for("first_win", PLAYER), ana(), badge("first_win"));
}

#[test]
#[should_panic(expected = "Only the platform ops account can mint")]
fn the_owner_cannot_mint_either() {
    let mut c = setup();
    set(owner(), NearToken::from_yoctonear(0));
    c.nft_mint(token_id_for("first_win", PLAYER), ana(), badge("first_win"));
}

#[test]
#[should_panic(expected = "token_id must be <achievement_id>:<player>")]
fn token_id_must_match_the_badge() {
    let mut c = setup();
    set(ops(), NearToken::from_yoctonear(0));
    c.nft_mint("first_win:someone_else".to_string(), ana(), badge("first_win"));
}

#[test]
#[should_panic(expected = "achievement_id must be")]
fn rejects_a_bad_achievement_id() {
    let mut c = setup();
    set(ops(), NearToken::from_yoctonear(0));
    let mut b = badge("First-Win");
    b.achievement_id = "First-Win".to_string();
    c.nft_mint(token_id_for("First-Win", PLAYER), ana(), b);
}

#[test]
#[should_panic(expected = "title must be")]
fn rejects_an_empty_title() {
    let mut c = setup();
    set(ops(), NearToken::from_yoctonear(0));
    let mut b = badge("first_win");
    b.title = String::new();
    c.nft_mint(token_id_for("first_win", PLAYER), ana(), b);
}

#[test]
#[should_panic(expected = "soulbound")]
fn badges_cannot_be_transferred() {
    let mut c = setup();
    let t = mint(&mut c, "first_win", ana());
    set(ana(), NearToken::from_yoctonear(1));
    c.nft_transfer(ben(), t.token_id, None, None);
}

#[test]
#[should_panic(expected = "soulbound")]
fn badges_cannot_be_transferred_with_a_call() {
    let mut c = setup();
    let t = mint(&mut c, "first_win", ana());
    set(ana(), NearToken::from_yoctonear(1));
    let _ = c.nft_transfer_call(ben(), t.token_id, None, None, String::new());
}

#[test]
fn enumeration_and_metadata() {
    let mut c = setup();
    mint(&mut c, "first_win", ana());
    mint(&mut c, "first_match", ana());
    assert!(c.is_soulbound());
    assert_eq!(c.nft_total_supply(), U128(2));
    assert_eq!(c.nft_supply_for_owner(ana()), U128(2));
    assert_eq!(c.nft_supply_for_owner(ben()), U128(0));
    let mine = c.nft_tokens_for_owner(ana(), None, None);
    assert_eq!(mine.len(), 2);
    assert_eq!(c.nft_tokens(None, Some(1)).len(), 1);
    let md = c.nft_metadata();
    assert_eq!(md.name, "skirm badges");
    assert_eq!(md.spec, NFT_METADATA_SPEC);
    assert_eq!(
        c.get_config(),
        Config {
            owner_id: owner(),
            ops_id: ops()
        }
    );
}

#[test]
fn owner_rotates_ops_with_one_yocto() {
    let mut c = setup();
    set(owner(), NearToken::from_yoctonear(1));
    c.set_ops(ben());
    assert_eq!(c.get_config().ops_id, ben());
    set(ben(), NearToken::from_yoctonear(0));
    let t = c.nft_mint(token_id_for("first_win", PLAYER), ana(), badge("first_win"));
    assert_eq!(t.owner_id, ana());
}

#[test]
#[should_panic(expected = "Only the owner")]
fn only_the_owner_rotates_ops() {
    let mut c = setup();
    set(ops(), NearToken::from_yoctonear(1));
    c.set_ops(ben());
}
