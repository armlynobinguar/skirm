use super::*;
use near_sdk::mock::MockAction;
use near_sdk::test_utils::{get_created_receipts, get_logs, VMContextBuilder};
use near_sdk::{testing_env, PromiseResult, RuntimeFeesConfig};

const TOKEN: &str = "skl_01JB7Z3K9QX4M2T8V6N5R1C0DE:1";

fn acc(s: &str) -> AccountId {
    s.parse().unwrap()
}
fn owner() -> AccountId {
    acc("playskirm.testnet")
}
fn skills() -> AccountId {
    acc("skills.playskirm.testnet")
}
fn market() -> AccountId {
    acc("market.playskirm.testnet")
}
fn treasury() -> AccountId {
    acc("treasury.playskirm.testnet")
}
fn creator() -> AccountId {
    acc("tyron.testnet")
}
fn reseller() -> AccountId {
    acc("reseller.testnet")
}
fn buyer() -> AccountId {
    acc("jev.testnet")
}
fn near(n: u128) -> u128 {
    NearToken::from_near(n).as_yoctonear()
}
fn milli(n: u128) -> u128 {
    NearToken::from_millinear(n).as_yoctonear()
}

fn ctx(predecessor: AccountId, deposit: u128) -> VMContextBuilder {
    let mut b = VMContextBuilder::new();
    b.current_account_id(market())
        .signer_account_id(predecessor.clone())
        .predecessor_account_id(predecessor)
        .attached_deposit(NearToken::from_yoctonear(deposit))
        .prepaid_gas(Gas::from_tgas(300))
        .account_balance(NearToken::from_near(50))
        .block_timestamp(1_762_000_000_000_000_000);
    b
}

fn set(predecessor: AccountId, deposit: u128) {
    testing_env!(ctx(predecessor, deposit).build());
}

fn setup() -> Contract {
    set(owner(), 0);
    Contract::new(owner(), skills(), treasury(), None, None, None, None)
}

fn price_msg(price: u128) -> String {
    format!("{{\"price\":\"{price}\"}}")
}

fn list(c: &mut Contract, token: &str, seller: AccountId, approval_id: u64, price: u128) {
    set(skills(), 0);
    let _ = c.nft_on_approve(token.to_string(), seller, approval_id, price_msg(price));
}

/// Simulates the callback with the given result of `nft_transfer_payout`.
fn resolve(
    c: &mut Contract,
    result: PromiseResult,
    buyer: AccountId,
    listing: Listing,
    deposit: u128,
) -> bool {
    testing_env!(
        ctx(market(), 0).build(),
        near_sdk::test_vm_config(),
        RuntimeFeesConfig::test(),
        Default::default(),
        vec![result],
    );
    c.resolve_purchase(buyer, listing, U128(deposit))
}

fn payout_bytes(entries: &[(AccountId, u128)]) -> Vec<u8> {
    let payout: HashMap<AccountId, U128> =
        entries.iter().map(|(a, v)| (a.clone(), U128(*v))).collect();
    serde_json::to_vec(&Payout { payout }).unwrap()
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

fn event(name: &str) -> serde_json::Value {
    let log = get_logs()
        .into_iter()
        .find(|l| l.contains(&format!("\"event\":\"{name}\"")))
        .unwrap_or_else(|| panic!("no {name} event"));
    let v: serde_json::Value =
        serde_json::from_str(log.strip_prefix("EVENT_JSON:").unwrap()).unwrap();
    assert_eq!(v["standard"], EVENT_STANDARD);
    assert_eq!(v["version"], "1.0.0");
    v["data"][0].clone()
}

// ---------- settlement arithmetic ----------

#[test]
fn resale_of_5_near_pays_fee_025_royalty_025_seller_45() {
    // The skills contract's own NEP-199 payout for a resale, then the market split.
    let p = skirm_skills::compute_payout(&reseller(), &creator(), 500, near(5));
    let s = settle(near(5), DEFAULT_FEE_BPS, Some(&p.payout), &reseller());
    assert_eq!(s.fee, milli(250));
    assert_eq!(s.royalties, vec![(creator(), milli(250))]);
    assert_eq!(s.seller_proceeds, milli(4500));
    assert!(!s.fallback);
    assert_eq!(s.fee + milli(250) + s.seller_proceeds, near(5));
}

#[test]
fn primary_sale_of_5_near_pays_fee_025_royalty_0_creator_475() {
    let p = skirm_skills::compute_payout(&creator(), &creator(), 500, near(5));
    let s = settle(near(5), DEFAULT_FEE_BPS, Some(&p.payout), &creator());
    assert_eq!(s.fee, milli(250));
    assert!(s.royalties.is_empty());
    assert_eq!(s.seller_proceeds, milli(4750));
}

#[test]
fn parts_sum_to_price_exactly_for_awkward_prices() {
    let prices = [
        1u128,
        19,
        9_999,
        10_001,
        333_333_333_333,
        near(5) + 7,
        near(1_000_000_000) + 12_345,
    ];
    for &price in &prices {
        for royalty in [0u16, 1, 499, 500, 1000] {
            for fee in [0u16, 1, 250, 500, 1000] {
                let p = skirm_skills::compute_payout(&reseller(), &creator(), royalty, price);
                let s = settle(price, fee, Some(&p.payout), &reseller());
                let royalty_paid: u128 = s.royalties.iter().map(|r| r.1).sum();
                assert!(!s.fallback, "price {price} royalty {royalty} fee {fee}");
                assert_eq!(s.fee, bps_of(price, fee));
                assert_eq!(royalty_paid, skirm_skills::bps_of(price, royalty));
                assert_eq!(s.fee + royalty_paid + s.seller_proceeds, price);
            }
        }
    }
}

#[test]
fn fee_rounds_down() {
    assert_eq!(bps_of(19, 500), 0); // 0.95 -> 0
    assert_eq!(bps_of(9_999, 500), 499);
    assert_eq!(bps_of(u128::MAX, 1000), u128::MAX / 10);
}

#[test]
fn invalid_payouts_fall_back_to_seller() {
    let price = near(5);
    let cases: Vec<HashMap<AccountId, U128>> = vec![
        // Sum below price.
        [(creator(), U128(1)), (reseller(), U128(1))]
            .into_iter()
            .collect(),
        // Sum above price.
        [(creator(), U128(price)), (reseller(), U128(price))]
            .into_iter()
            .collect(),
        // Seller missing.
        [(creator(), U128(price))].into_iter().collect(),
        // Seller's share below the fee.
        [(creator(), U128(price - 1)), (reseller(), U128(1))]
            .into_iter()
            .collect(),
        // Too many entries.
        (0..11)
            .map(|i| {
                (
                    acc(&format!("a{i}.testnet")),
                    U128(if i == 0 { price - 10 } else { 1 }),
                )
            })
            .collect(),
    ];
    for payout in cases {
        let s = settle(price, 500, Some(&payout), &reseller());
        assert!(s.fallback);
        assert!(s.royalties.is_empty());
        assert_eq!(s.fee, milli(250));
        assert_eq!(s.seller_proceeds, milli(4750));
    }
    let s = settle(price, 500, None, &reseller());
    assert!(s.fallback);
    assert_eq!(s.fee + s.seller_proceeds, price);
}

#[test]
fn overflowing_payout_sum_falls_back() {
    let payout: HashMap<AccountId, U128> =
        [(creator(), U128(u128::MAX)), (reseller(), U128(u128::MAX))]
            .into_iter()
            .collect();
    let s = settle(near(5), 500, Some(&payout), &reseller());
    assert!(s.fallback);
}

// ---------- listing ----------

#[test]
fn nft_on_approve_from_skills_creates_listing() {
    let mut c = setup();
    list(&mut c, TOKEN, creator(), 1, near(5));
    let l = c.get_listing(TOKEN.into()).unwrap();
    assert_eq!(l.seller, creator());
    assert_eq!(l.approval_id, 1);
    assert_eq!(l.price, U128(near(5)));
    assert_eq!(l.listed_at_ms, U64(1_762_000_000_000));
    assert_eq!(c.listing_count(), 1);
    assert_eq!(c.get_listings_by_seller(creator()), vec![l.clone()]);
    let e = event("list");
    assert_eq!(e["token_id"], TOKEN);
    assert_eq!(e["price"], near(5).to_string());
}

#[test]
fn relisting_replaces_price_and_approval() {
    let mut c = setup();
    list(&mut c, TOKEN, creator(), 1, near(5));
    list(&mut c, TOKEN, creator(), 2, near(7));
    assert_eq!(c.listing_count(), 1);
    let l = c.get_listing(TOKEN.into()).unwrap();
    assert_eq!((l.approval_id, l.price), (2, U128(near(7))));
    assert_eq!(c.get_listings_by_seller(creator()).len(), 1);
}

#[test]
fn listing_by_new_owner_moves_seller_index() {
    let mut c = setup();
    list(&mut c, TOKEN, creator(), 1, near(5));
    // Token changed hands outside the market; new owner lists it.
    list(&mut c, TOKEN, reseller(), 3, near(6));
    assert!(c.get_listings_by_seller(creator()).is_empty());
    assert_eq!(c.get_listings_by_seller(reseller()).len(), 1);
}

#[test]
#[should_panic(expected = "Only the skills contract can list tokens")]
fn nft_on_approve_from_other_contract_rejected() {
    let mut c = setup();
    set(creator(), 0);
    let _ = c.nft_on_approve(TOKEN.into(), creator(), 1, price_msg(near(5)));
}

#[test]
#[should_panic(expected = "msg must be")]
fn bad_listing_msg_rejected() {
    let mut c = setup();
    set(skills(), 0);
    let _ = c.nft_on_approve(TOKEN.into(), creator(), 1, "{\"price\":5}".into());
}

#[test]
#[should_panic(expected = "Price must be greater than 0")]
fn zero_price_rejected() {
    let mut c = setup();
    list(&mut c, TOKEN, creator(), 1, 0);
}

#[test]
fn listings_paginate() {
    let mut c = setup();
    for i in 0..5 {
        list(&mut c, &format!("skl_X:{i}"), creator(), 1, near(1) + i);
    }
    assert_eq!(c.get_listings(None, None).len(), 5);
    assert_eq!(c.get_listings(Some(1), Some(2)).len(), 2);
    assert_eq!(c.get_listings(Some(4), Some(10)).len(), 1);
    assert_eq!(c.get_listings_by_seller(creator()).len(), 5);
}

#[test]
fn seller_delists() {
    let mut c = setup();
    list(&mut c, TOKEN, creator(), 1, near(5));
    set(creator(), 1);
    c.delist(TOKEN.into());
    assert!(c.get_listing(TOKEN.into()).is_none());
    assert!(c.get_listings_by_seller(creator()).is_empty());
    assert_eq!(event("delist")["token_id"], TOKEN);
}

#[test]
#[should_panic(expected = "Only the seller can delist")]
fn non_seller_cannot_delist() {
    let mut c = setup();
    list(&mut c, TOKEN, creator(), 1, near(5));
    set(buyer(), 1);
    c.delist(TOKEN.into());
}

#[test]
#[should_panic(expected = "Requires attached deposit of exactly 1 yoctoNEAR")]
fn delist_requires_one_yocto() {
    let mut c = setup();
    list(&mut c, TOKEN, creator(), 1, near(5));
    set(creator(), 0);
    c.delist(TOKEN.into());
}

#[test]
#[should_panic(expected = "Token is not listed")]
fn delist_unknown_token_panics() {
    let mut c = setup();
    set(creator(), 1);
    c.delist(TOKEN.into());
}

#[test]
fn seller_updates_price() {
    let mut c = setup();
    list(&mut c, TOKEN, creator(), 1, near(5));
    set(creator(), 1);
    c.update_price(TOKEN.into(), U128(near(3)));
    assert_eq!(c.get_listing(TOKEN.into()).unwrap().price, U128(near(3)));
}

#[test]
#[should_panic(expected = "Only the seller can change the price")]
fn non_seller_cannot_update_price() {
    let mut c = setup();
    list(&mut c, TOKEN, creator(), 1, near(5));
    set(buyer(), 1);
    c.update_price(TOKEN.into(), U128(1));
}

// ---------- buy ----------

#[test]
fn buy_calls_nft_transfer_payout_then_resolve() {
    let mut c = setup();
    list(&mut c, TOKEN, creator(), 4, near(5));
    set(buyer(), near(6));
    let _ = c.buy(TOKEN.into());

    assert!(c.get_listing(TOKEN.into()).is_none());
    assert!(c.is_purchase_pending(TOKEN.into()));

    let receipts = get_created_receipts();
    assert_eq!(receipts.len(), 2);
    assert_eq!(receipts[0].receiver_id, skills());
    match &receipts[0].actions[0] {
        MockAction::FunctionCallWeight {
            method_name,
            args,
            attached_deposit,
            prepaid_gas,
            ..
        } => {
            assert_eq!(method_name, b"nft_transfer_payout");
            assert_eq!(*attached_deposit, NearToken::from_yoctonear(1));
            assert_eq!(*prepaid_gas, GAS_FOR_NFT_TRANSFER_PAYOUT);
            let a: serde_json::Value = serde_json::from_slice(args).unwrap();
            assert_eq!(a["receiver_id"], "jev.testnet");
            assert_eq!(a["token_id"], TOKEN);
            assert_eq!(a["approval_id"], 4);
            assert_eq!(a["balance"], near(5).to_string());
            assert_eq!(a["max_len_payout"], MAX_LEN_PAYOUT);
        }
        a => panic!("unexpected {a:?}"),
    }
    assert_eq!(receipts[1].receiver_id, market());
    match &receipts[1].actions[0] {
        MockAction::FunctionCallWeight {
            method_name, args, ..
        } => {
            assert_eq!(method_name, b"resolve_purchase");
            let a: serde_json::Value = serde_json::from_slice(args).unwrap();
            assert_eq!(a["buyer"], "jev.testnet");
            assert_eq!(a["deposit"], near(6).to_string());
            assert_eq!(a["listing"]["seller"], "tyron.testnet");
        }
        a => panic!("unexpected {a:?}"),
    }
}

#[test]
#[should_panic(expected = "Attach at least the price")]
fn buy_with_too_little_deposit_rejected() {
    let mut c = setup();
    list(&mut c, TOKEN, creator(), 1, near(5));
    set(buyer(), near(5) - 1);
    let _ = c.buy(TOKEN.into());
}

#[test]
#[should_panic(expected = "The seller cannot buy their own listing")]
fn seller_cannot_buy_own_listing() {
    let mut c = setup();
    list(&mut c, TOKEN, creator(), 1, near(5));
    set(creator(), near(5));
    let _ = c.buy(TOKEN.into());
}

#[test]
#[should_panic(expected = "Attach at least 120 Tgas")]
fn buy_with_too_little_gas_rejected() {
    let mut c = setup();
    list(&mut c, TOKEN, creator(), 1, near(5));
    let mut b = ctx(buyer(), near(5));
    b.prepaid_gas(Gas::from_tgas(110));
    testing_env!(b.build());
    let _ = c.buy(TOKEN.into());
}

#[test]
#[should_panic(expected = "Token is not listed")]
fn buy_unlisted_token_rejected() {
    let mut c = setup();
    set(buyer(), near(5));
    let _ = c.buy(TOKEN.into());
}

#[test]
#[should_panic(expected = "Token is not listed")]
fn second_buy_while_pending_rejected() {
    let mut c = setup();
    list(&mut c, TOKEN, creator(), 1, near(5));
    set(buyer(), near(5));
    let _ = c.buy(TOKEN.into());
    set(acc("other.testnet"), near(5));
    let _ = c.buy(TOKEN.into());
}

#[test]
#[should_panic(expected = "A purchase of this token is in progress")]
fn relisting_while_pending_rejected() {
    let mut c = setup();
    list(&mut c, TOKEN, creator(), 1, near(5));
    set(buyer(), near(5));
    let _ = c.buy(TOKEN.into());
    list(&mut c, TOKEN, creator(), 2, near(9));
}

fn buy_and_take_listing(
    c: &mut Contract,
    seller: AccountId,
    price: u128,
    deposit: u128,
) -> Listing {
    list(c, TOKEN, seller, 1, price);
    let listing = c.get_listing(TOKEN.into()).unwrap();
    set(buyer(), deposit);
    let _ = c.buy(TOKEN.into());
    listing
}

#[test]
fn resolve_resale_pays_treasury_creator_seller_and_refunds_excess() {
    let mut c = setup();
    let listing = buy_and_take_listing(&mut c, reseller(), near(5), near(6));
    let p = skirm_skills::compute_payout(&reseller(), &creator(), 500, near(5));
    let ok = resolve(
        &mut c,
        PromiseResult::Successful(serde_json::to_vec(&p).unwrap()),
        buyer(),
        listing,
        near(6),
    );
    assert!(ok);
    let t = transfers();
    assert_eq!(t[&treasury()], milli(250));
    assert_eq!(t[&creator()], milli(250));
    assert_eq!(t[&reseller()], milli(4500));
    assert_eq!(t[&buyer()], near(1));
    assert_eq!(t.values().sum::<u128>(), near(6));
    assert!(!c.is_purchase_pending(TOKEN.into()));

    let e = event("sale");
    assert_eq!(e["price"], near(5).to_string());
    assert_eq!(e["fee"], milli(250).to_string());
    assert_eq!(e["royalties"]["tyron.testnet"], milli(250).to_string());
    assert_eq!(e["seller_proceeds"], milli(4500).to_string());
    assert_eq!(e["refund"], near(1).to_string());
    assert_eq!(e["payout_fallback"], false);
}

#[test]
fn resolve_primary_sale_pays_fee_and_creator_only() {
    let mut c = setup();
    let listing = buy_and_take_listing(&mut c, creator(), near(5), near(5));
    let p = skirm_skills::compute_payout(&creator(), &creator(), 500, near(5));
    assert!(resolve(
        &mut c,
        PromiseResult::Successful(serde_json::to_vec(&p).unwrap()),
        buyer(),
        listing,
        near(5)
    ));
    let t = transfers();
    assert_eq!(t.len(), 2);
    assert_eq!(t[&treasury()], milli(250));
    assert_eq!(t[&creator()], milli(4750));
}

#[test]
fn resolve_with_custom_fee() {
    let mut c = setup();
    set(owner(), 1);
    c.set_fee_bps(250);
    let listing = buy_and_take_listing(&mut c, reseller(), near(4), near(4));
    let bytes = payout_bytes(&[(creator(), milli(200)), (reseller(), milli(3800))]);
    assert!(resolve(
        &mut c,
        PromiseResult::Successful(bytes),
        buyer(),
        listing,
        near(4)
    ));
    let t = transfers();
    assert_eq!(t[&treasury()], milli(100));
    assert_eq!(t[&creator()], milli(200));
    assert_eq!(t[&reseller()], milli(3700));
}

#[test]
fn zero_fee_creates_no_treasury_transfer() {
    let mut c = setup();
    set(owner(), 1);
    c.set_fee_bps(0);
    let listing = buy_and_take_listing(&mut c, creator(), near(5), near(5));
    let bytes = payout_bytes(&[(creator(), near(5))]);
    assert!(resolve(
        &mut c,
        PromiseResult::Successful(bytes),
        buyer(),
        listing,
        near(5)
    ));
    let t = transfers();
    assert!(!t.contains_key(&treasury()));
    assert_eq!(t[&creator()], near(5));
}

#[test]
fn failed_transfer_refunds_buyer_in_full_and_drops_listing() {
    let mut c = setup();
    let listing = buy_and_take_listing(&mut c, reseller(), near(5), near(6));
    let ok = resolve(&mut c, PromiseResult::Failed, buyer(), listing, near(6));
    assert!(!ok);
    let t = transfers();
    assert_eq!(t.len(), 1);
    assert_eq!(t[&buyer()], near(6));
    assert!(!c.is_purchase_pending(TOKEN.into()));
    assert!(c.get_listing(TOKEN.into()).is_none());
    let e = event("purchase_failed");
    assert_eq!(e["refund"], near(6).to_string());
    // The seller can list again afterwards.
    list(&mut c, TOKEN, reseller(), 2, near(5));
    assert!(c.get_listing(TOKEN.into()).is_some());
}

#[test]
fn unparseable_payout_after_transfer_pays_seller_minus_fee() {
    let mut c = setup();
    let listing = buy_and_take_listing(&mut c, reseller(), near(5), near(5));
    assert!(resolve(
        &mut c,
        PromiseResult::Successful(b"not json".to_vec()),
        buyer(),
        listing,
        near(5)
    ));
    let t = transfers();
    assert_eq!(t[&treasury()], milli(250));
    assert_eq!(t[&reseller()], milli(4750));
    assert_eq!(t.values().sum::<u128>(), near(5));
    assert_eq!(event("sale")["payout_fallback"], true);
}

#[test]
fn oversized_payout_after_transfer_is_still_a_sale_not_a_refund() {
    let mut c = setup();
    let listing = buy_and_take_listing(&mut c, reseller(), near(5), near(5));
    let huge = vec![b' '; 5000];
    assert!(resolve(
        &mut c,
        PromiseResult::Successful(huge),
        buyer(),
        listing,
        near(5)
    ));
    let t = transfers();
    assert!(!t.contains_key(&buyer()));
    assert_eq!(t[&treasury()], milli(250));
    assert_eq!(t[&reseller()], milli(4750));
}

#[test]
fn payout_with_wrong_sum_falls_back() {
    let mut c = setup();
    let listing = buy_and_take_listing(&mut c, reseller(), near(5), near(5));
    let bytes = payout_bytes(&[(creator(), near(4)), (reseller(), near(4))]);
    assert!(resolve(
        &mut c,
        PromiseResult::Successful(bytes),
        buyer(),
        listing,
        near(5)
    ));
    let t = transfers();
    assert!(!t.contains_key(&creator()));
    assert_eq!(t[&reseller()], milli(4750));
}

#[test]
#[should_panic(expected = "Method resolve_purchase is private")]
fn resolve_purchase_is_private() {
    let mut c = setup();
    let listing = Listing {
        token_id: TOKEN.into(),
        seller: reseller(),
        approval_id: 1,
        price: U128(near(5)),
        listed_at_ms: U64(0),
    };
    set(buyer(), 0);
    c.resolve_purchase(buyer(), listing, U128(near(5)));
}

// ---------- admin and views ----------

#[test]
fn defaults_and_fee_view() {
    let c = setup();
    let cfg = c.get_config();
    assert_eq!(cfg.fee_bps, 500);
    assert_eq!(cfg.nft_contract_id, skills());
    assert_eq!(cfg.treasury_id, treasury());
    assert_eq!(c.fee_for(U128(near(5))), U128(milli(250)));
}

#[test]
#[should_panic(expected = "fee_bps must be at most 1000")]
fn init_fee_above_cap_rejected() {
    set(owner(), 0);
    Contract::new(owner(), skills(), treasury(), Some(1001), None, None, None);
}

#[test]
fn owner_sets_fee_treasury_and_owner() {
    let mut c = setup();
    set(owner(), 1);
    c.set_fee_bps(1000);
    c.set_treasury(acc("vault.playskirm.testnet"));
    c.set_owner(acc("admin.playskirm.testnet"));
    let cfg = c.get_config();
    assert_eq!(cfg.fee_bps, 1000);
    assert_eq!(cfg.treasury_id, acc("vault.playskirm.testnet"));
    assert_eq!(cfg.owner_id, acc("admin.playskirm.testnet"));
}

#[test]
#[should_panic(expected = "fee_bps must be at most 1000")]
fn fee_above_cap_rejected() {
    let mut c = setup();
    set(owner(), 1);
    c.set_fee_bps(1001);
}

#[test]
#[should_panic(expected = "Only the owner can call this method")]
fn non_owner_cannot_set_fee() {
    let mut c = setup();
    set(creator(), 1);
    c.set_fee_bps(0);
}

#[test]
#[should_panic(expected = "Only the owner can call this method")]
fn non_owner_cannot_set_treasury() {
    let mut c = setup();
    set(creator(), 1);
    c.set_treasury(creator());
}

#[test]
#[should_panic(expected = "Only the owner can call this method")]
fn non_owner_cannot_set_owner() {
    let mut c = setup();
    set(creator(), 1);
    c.set_owner(creator());
}

#[test]
#[should_panic(expected = "Requires attached deposit of exactly 1 yoctoNEAR")]
fn set_fee_requires_one_yocto() {
    let mut c = setup();
    set(owner(), 0);
    c.set_fee_bps(100);
}

// ---------- governance, fee timelock and setter events ----------

fn governance() -> AccountId {
    acc("dao.playskirm.testnet")
}
fn seasons() -> AccountId {
    acc("seasons.playskirm.testnet")
}

/// Market with a separate governance account and the seasons contract as the season pool.
fn setup_governed(season_share_bps: Option<u16>) -> Contract {
    set(owner(), 0);
    Contract::new(
        owner(),
        skills(),
        treasury(),
        None,
        Some(governance()),
        Some(seasons()),
        season_share_bps,
    )
}

/// `set`, with block time moved forward by `ms` from the default test timestamp.
fn set_at(predecessor: AccountId, deposit: u128, ms: u64) {
    let mut b = ctx(predecessor, deposit);
    b.block_timestamp(1_762_000_000_000_000_000 + ms * 1_000_000);
    testing_env!(b.build());
}

/// The `fund` call created in this call: (receiver, attached yocto, args).
fn fund_call() -> Option<(AccountId, u128, serde_json::Value)> {
    get_created_receipts().into_iter().find_map(|r| {
        r.actions.iter().find_map(|a| match a {
            MockAction::FunctionCallWeight {
                method_name,
                args,
                attached_deposit,
                ..
            } if method_name == b"fund" => Some((
                r.receiver_id.clone(),
                attached_deposit.as_yoctonear(),
                serde_json::from_slice(args).unwrap(),
            )),
            _ => None,
        })
    })
}

#[test]
fn init_without_new_args_defaults_governance_to_owner_and_no_pool() {
    let c = setup();
    let cfg = c.get_config();
    assert_eq!(cfg.governance_id, owner());
    assert_eq!(cfg.season_pool_id, None);
    assert_eq!(cfg.season_share_bps, DEFAULT_SEASON_SHARE_BPS);
    assert_eq!(cfg.pending_fee, None);
    assert_eq!(cfg.fee_delay_ms, U64(FEE_DELAY_MS));
    assert_eq!(cfg.max_fee_bps, MAX_FEE_BPS);
}

#[test]
fn init_with_new_args() {
    let c = setup_governed(Some(2_500));
    let cfg = c.get_config();
    assert_eq!(cfg.governance_id, governance());
    assert_eq!(cfg.season_pool_id, Some(seasons()));
    assert_eq!(cfg.season_share_bps, 2_500);
    let json = serde_json::to_value(&cfg).unwrap();
    assert_eq!(json["season_pool_id"], "seasons.playskirm.testnet");
    assert_eq!(json["fee_delay_ms"], FEE_DELAY_MS.to_string());
}

#[test]
#[should_panic(expected = "season_share_bps must be at most 10000")]
fn init_season_share_above_whole_rejected() {
    setup_governed(Some(10_001));
}

#[test]
fn propose_then_apply_after_delay() {
    let mut c = setup_governed(None);
    set(governance(), 1);
    let p = c.propose_fee(800);
    assert_eq!(p.bps, 800);
    assert_eq!(p.effective_at_ms, U64(1_762_000_000_000 + FEE_DELAY_MS));
    assert_eq!(c.get_config().pending_fee, Some(p));
    assert_eq!(c.get_config().fee_bps, 500);
    let e = event("fee_proposed");
    assert_eq!(e["old_bps"], 500);
    assert_eq!(e["new_bps"], 800);
    assert_eq!(
        e["effective_at_ms"],
        (1_762_000_000_000 + FEE_DELAY_MS).to_string()
    );
    assert_eq!(e["by"], "dao.playskirm.testnet");

    set_at(governance(), 1, FEE_DELAY_MS);
    assert_eq!(c.apply_fee(), 800);
    let cfg = c.get_config();
    assert_eq!(cfg.fee_bps, 800);
    assert_eq!(cfg.pending_fee, None);
    let e = event("fee_updated");
    assert_eq!(e["old_bps"], 500);
    assert_eq!(e["new_bps"], 800);
    assert_eq!(e["by"], "dao.playskirm.testnet");
}

#[test]
#[should_panic(expected = "The fee change is not effective yet")]
fn apply_before_delay_rejected() {
    let mut c = setup_governed(None);
    set(owner(), 1);
    c.propose_fee(800);
    set_at(owner(), 1, FEE_DELAY_MS - 1);
    c.apply_fee();
}

#[test]
#[should_panic(expected = "No fee change is pending")]
fn apply_without_proposal_rejected() {
    let mut c = setup_governed(None);
    set(governance(), 1);
    c.apply_fee();
}

#[test]
#[should_panic(expected = "No fee change is pending")]
fn applied_proposal_cannot_be_applied_twice() {
    let mut c = setup_governed(None);
    set(owner(), 1);
    c.propose_fee(800);
    set_at(owner(), 1, FEE_DELAY_MS);
    c.apply_fee();
    c.apply_fee();
}

#[test]
#[should_panic(expected = "fee_bps must be at most 1000")]
fn proposal_above_cap_rejected() {
    let mut c = setup_governed(None);
    set(governance(), 1);
    c.propose_fee(MAX_FEE_BPS + 1);
}

#[test]
fn proposal_at_cap_applies() {
    let mut c = setup_governed(None);
    set(governance(), 1);
    c.propose_fee(MAX_FEE_BPS);
    set_at(governance(), 1, FEE_DELAY_MS);
    assert_eq!(c.apply_fee(), MAX_FEE_BPS);
}

#[test]
fn new_proposal_replaces_pending_and_restarts_delay() {
    let mut c = setup_governed(None);
    set(owner(), 1);
    c.propose_fee(800);
    set_at(governance(), 1, 1_000);
    c.propose_fee(100);
    let p = c.get_config().pending_fee.unwrap();
    assert_eq!(p.bps, 100);
    assert_eq!(
        p.effective_at_ms,
        U64(1_762_000_000_000 + 1_000 + FEE_DELAY_MS)
    );
}

#[test]
#[should_panic(expected = "Only the owner or governance can call this method")]
fn stranger_cannot_propose_fee() {
    let mut c = setup_governed(None);
    set(creator(), 1);
    c.propose_fee(100);
}

#[test]
#[should_panic(expected = "Only the owner or governance can call this method")]
fn stranger_cannot_apply_fee() {
    let mut c = setup_governed(None);
    set(owner(), 1);
    c.propose_fee(100);
    set_at(creator(), 1, FEE_DELAY_MS);
    c.apply_fee();
}

#[test]
#[should_panic(expected = "Requires attached deposit of exactly 1 yoctoNEAR")]
fn propose_fee_requires_one_yocto() {
    let mut c = setup_governed(None);
    set(governance(), 0);
    c.propose_fee(100);
}

#[test]
#[should_panic(expected = "Requires attached deposit of exactly 1 yoctoNEAR")]
fn apply_fee_requires_one_yocto() {
    let mut c = setup_governed(None);
    set(governance(), 1);
    c.propose_fee(100);
    set_at(governance(), 0, FEE_DELAY_MS);
    c.apply_fee();
}

#[test]
#[should_panic(expected = "Only the owner can call this method")]
fn governance_cannot_set_fee_without_delay() {
    let mut c = setup_governed(None);
    set(governance(), 1);
    c.set_fee_bps(100);
}

#[test]
fn set_fee_bps_emits_fee_updated() {
    let mut c = setup();
    set(owner(), 1);
    c.set_fee_bps(250);
    let e = event("fee_updated");
    assert_eq!(e["old_bps"], 500);
    assert_eq!(e["new_bps"], 250);
    assert_eq!(e["by"], "playskirm.testnet");
}

#[test]
fn setters_emit_old_new_by() {
    let mut c = setup_governed(None);
    set(owner(), 1);
    c.set_treasury(acc("vault.playskirm.testnet"));
    let e = event("treasury_updated");
    assert_eq!(e["old"], "treasury.playskirm.testnet");
    assert_eq!(e["new"], "vault.playskirm.testnet");
    assert_eq!(e["by"], "playskirm.testnet");

    set(governance(), 1);
    c.set_season_pool(None);
    let e = event("season_pool_updated");
    assert_eq!(e["old"], "seasons.playskirm.testnet");
    assert_eq!(e["new"], serde_json::Value::Null);
    assert_eq!(e["by"], "dao.playskirm.testnet");
    assert_eq!(c.get_config().season_pool_id, None);

    set(governance(), 1);
    c.set_season_pool(Some(acc("seasons2.playskirm.testnet")));
    let e = event("season_pool_updated");
    assert_eq!(e["old"], serde_json::Value::Null);
    assert_eq!(e["new"], "seasons2.playskirm.testnet");

    set(governance(), 1);
    c.set_governance(acc("dao2.playskirm.testnet"));
    let e = event("governance_updated");
    assert_eq!(e["old"], "dao.playskirm.testnet");
    assert_eq!(e["new"], "dao2.playskirm.testnet");
    assert_eq!(e["by"], "dao.playskirm.testnet");
    assert_eq!(c.get_config().governance_id, acc("dao2.playskirm.testnet"));

    set(owner(), 1);
    c.set_owner(acc("admin.playskirm.testnet"));
    let e = event("owner_updated");
    assert_eq!(e["old"], "playskirm.testnet");
    assert_eq!(e["new"], "admin.playskirm.testnet");
    assert_eq!(e["by"], "playskirm.testnet");
}

#[test]
fn owner_sets_governance_and_season_pool() {
    let mut c = setup();
    set(owner(), 1);
    c.set_governance(governance());
    c.set_season_pool(Some(seasons()));
    let cfg = c.get_config();
    assert_eq!(cfg.governance_id, governance());
    assert_eq!(cfg.season_pool_id, Some(seasons()));
}

#[test]
#[should_panic(expected = "Only the owner or governance can call this method")]
fn replaced_governance_loses_access() {
    let mut c = setup_governed(None);
    set(governance(), 1);
    c.set_governance(acc("dao2.playskirm.testnet"));
    c.propose_fee(100);
}

#[test]
#[should_panic(expected = "Only the owner or governance can call this method")]
fn stranger_cannot_set_governance() {
    let mut c = setup_governed(None);
    set(creator(), 1);
    c.set_governance(creator());
}

#[test]
#[should_panic(expected = "Only the owner or governance can call this method")]
fn stranger_cannot_set_season_pool() {
    let mut c = setup_governed(None);
    set(creator(), 1);
    c.set_season_pool(Some(creator()));
}

#[test]
#[should_panic(expected = "Only the owner can call this method")]
fn governance_cannot_set_treasury() {
    let mut c = setup_governed(None);
    set(governance(), 1);
    c.set_treasury(governance());
}

#[test]
#[should_panic(expected = "Only the owner can call this method")]
fn governance_cannot_set_owner() {
    let mut c = setup_governed(None);
    set(governance(), 1);
    c.set_owner(governance());
}

#[test]
#[should_panic(expected = "Requires attached deposit of exactly 1 yoctoNEAR")]
fn set_season_pool_requires_one_yocto() {
    let mut c = setup_governed(None);
    set(owner(), 0);
    c.set_season_pool(None);
}

#[test]
#[should_panic(expected = "Requires attached deposit of exactly 1 yoctoNEAR")]
fn set_governance_requires_one_yocto() {
    let mut c = setup_governed(None);
    set(governance(), 0);
    c.set_governance(owner());
}

// ---------- season share of fees ----------

#[test]
fn fee_split_sums_to_fee_for_awkward_prices() {
    let prices = [
        1u128,
        19,
        9_999,
        10_001,
        333_333_333_333,
        near(5) + 7,
        u128::MAX,
    ];
    for &price in &prices {
        for fee_bps in [0u16, 1, 333, 500, 1000] {
            let fee = bps_of(price, fee_bps);
            for share in [0u16, 1, 2_999, 3_000, 3_333, 9_999, 10_000] {
                let (season, treasury) = split_fee(fee, share);
                assert_eq!(
                    season + treasury,
                    fee,
                    "price {price} fee {fee_bps} share {share}"
                );
                assert_eq!(season, bps_of(fee, share));
            }
        }
    }
    assert_eq!(split_fee(milli(250), 3_000), (milli(75), milli(175)));
    assert_eq!(split_fee(3, 3_000), (0, 3)); // rounding dust stays with the treasury
    assert_eq!(split_fee(7, 10_000), (7, 0));
}

#[test]
fn sale_with_season_pool_funds_season_and_pays_treasury_the_rest() {
    let mut c = setup_governed(None);
    let listing = buy_and_take_listing(&mut c, reseller(), near(5), near(5));
    let p = skirm_skills::compute_payout(&reseller(), &creator(), 500, near(5));
    assert!(resolve(
        &mut c,
        PromiseResult::Successful(serde_json::to_vec(&p).unwrap()),
        buyer(),
        listing,
        near(5)
    ));
    // Fee 0.25 NEAR: 30% (0.075) to the season pool, 0.175 to the treasury.
    let (to, amount, args) = fund_call().expect("fund call");
    assert_eq!(to, seasons());
    assert_eq!(amount, milli(75));
    assert_eq!(args["season_id"], serde_json::Value::Null);
    let t = transfers();
    assert_eq!(t[&treasury()], milli(175));
    assert_eq!(t[&creator()], milli(250));
    assert_eq!(t[&reseller()], milli(4500));
    assert_eq!(t.values().sum::<u128>() + amount, near(5));

    // The callback is scheduled on the market with the share.
    let cb = get_created_receipts()
        .into_iter()
        .find_map(|r| match &r.actions[0] {
            MockAction::FunctionCallWeight {
                method_name,
                args,
                prepaid_gas,
                ..
            } if method_name == b"on_season_funded" => {
                assert_eq!(r.receiver_id, market());
                assert_eq!(*prepaid_gas, GAS_FOR_ON_SEASON_FUNDED);
                Some(serde_json::from_slice::<serde_json::Value>(args).unwrap())
            }
            _ => None,
        })
        .expect("on_season_funded callback");
    assert_eq!(cb["amount"], milli(75).to_string());

    let e = event("sale");
    assert_eq!(e["fee"], milli(250).to_string());
    assert_eq!(e["fee_bps"], 500);
    assert_eq!(e["season_share"], milli(75).to_string());
    assert_eq!(e["treasury_share"], milli(175).to_string());
}

#[test]
fn sale_without_season_pool_sends_whole_fee_to_treasury() {
    let mut c = setup();
    let listing = buy_and_take_listing(&mut c, reseller(), near(5), near(5));
    let bytes = payout_bytes(&[(creator(), milli(250)), (reseller(), milli(4750))]);
    assert!(resolve(
        &mut c,
        PromiseResult::Successful(bytes),
        buyer(),
        listing,
        near(5)
    ));
    assert!(fund_call().is_none());
    assert_eq!(transfers()[&treasury()], milli(250));
    let e = event("sale");
    assert_eq!(e["fee_bps"], 500);
    assert_eq!(e["season_share"], "0");
    assert_eq!(e["treasury_share"], milli(250).to_string());
}

#[test]
fn zero_season_share_makes_no_fund_call() {
    let mut c = setup_governed(Some(0));
    let listing = buy_and_take_listing(&mut c, creator(), near(5), near(5));
    let bytes = payout_bytes(&[(creator(), near(5))]);
    assert!(resolve(
        &mut c,
        PromiseResult::Successful(bytes),
        buyer(),
        listing,
        near(5)
    ));
    assert!(fund_call().is_none());
    assert_eq!(transfers()[&treasury()], milli(250));
    assert_eq!(event("sale")["season_share"], "0");
}

#[test]
fn share_that_rounds_to_zero_makes_no_fund_call() {
    // Price 19 yocto at 1000 bps: fee 1, and 30% of 1 rounds down to 0.
    let mut c = setup_governed(None);
    set(owner(), 1);
    c.set_fee_bps(1000);
    let listing = buy_and_take_listing(&mut c, creator(), 19, 19);
    let bytes = payout_bytes(&[(creator(), 19)]);
    assert!(resolve(
        &mut c,
        PromiseResult::Successful(bytes),
        buyer(),
        listing,
        19
    ));
    assert!(fund_call().is_none());
    let t = transfers();
    assert_eq!(t[&treasury()], 1);
    assert_eq!(t[&creator()], 18);
}

#[test]
fn whole_fee_to_season_pays_treasury_nothing() {
    let mut c = setup_governed(Some(10_000));
    let listing = buy_and_take_listing(&mut c, creator(), near(5), near(5));
    let bytes = payout_bytes(&[(creator(), near(5))]);
    assert!(resolve(
        &mut c,
        PromiseResult::Successful(bytes),
        buyer(),
        listing,
        near(5)
    ));
    assert_eq!(fund_call().unwrap().1, milli(250));
    assert!(!transfers().contains_key(&treasury()));
    assert_eq!(event("sale")["treasury_share"], "0");
}

#[test]
fn failed_purchase_funds_no_season() {
    let mut c = setup_governed(None);
    let listing = buy_and_take_listing(&mut c, reseller(), near(5), near(5));
    assert!(!resolve(
        &mut c,
        PromiseResult::Failed,
        buyer(),
        listing,
        near(5)
    ));
    assert!(fund_call().is_none());
    assert_eq!(transfers()[&buyer()], near(5));
}

/// Simulates the season share's callback with the given result of `fund`.
fn season_funded(c: &mut Contract, result: PromiseResult, amount: u128) -> bool {
    testing_env!(
        ctx(market(), 0).build(),
        near_sdk::test_vm_config(),
        RuntimeFeesConfig::test(),
        Default::default(),
        vec![result],
    );
    c.on_season_funded(U128(amount))
}

#[test]
fn failed_fund_forwards_share_to_treasury() {
    let mut c = setup_governed(None);
    assert!(!season_funded(&mut c, PromiseResult::Failed, milli(75)));
    let t = transfers();
    assert_eq!(t.len(), 1);
    assert_eq!(t[&treasury()], milli(75));
    let e = event("season_share_forwarded");
    assert_eq!(e["amount"], milli(75).to_string());
    assert_eq!(e["treasury_id"], "treasury.playskirm.testnet");
    assert_eq!(e["season_pool_id"], "seasons.playskirm.testnet");
}

#[test]
fn successful_fund_moves_nothing() {
    let mut c = setup_governed(None);
    let ok = season_funded(
        &mut c,
        PromiseResult::Successful(b"\"75000000000000000000000\"".to_vec()),
        milli(75),
    );
    assert!(ok);
    assert!(transfers().is_empty());
    assert!(get_logs().is_empty());
}

#[test]
fn successful_fund_with_long_result_moves_nothing() {
    // `fund` took the share; an oversized return value must not be read as a failure, or the
    // share would also go to the treasury out of the market's own balance.
    let mut c = setup_governed(None);
    let ok = season_funded(
        &mut c,
        PromiseResult::Successful(vec![b'7'; 200]),
        milli(75),
    );
    assert!(ok);
    assert!(transfers().is_empty());
    assert!(get_logs().is_empty());
}

#[test]
#[should_panic(expected = "Method on_season_funded is private")]
fn on_season_funded_is_private() {
    let mut c = setup_governed(None);
    set(buyer(), 0);
    c.on_season_funded(U128(1));
}

// ---------- agent rentals ----------

fn renter() -> AccountId {
    acc("kai.testnet")
}

#[test]
fn rent_pays_the_owner_the_price_less_the_fee_and_refunds_the_excess() {
    let mut c = setup();
    set(renter(), milli(1_200));
    c.rent("rnt_1:n1".to_string(), creator(), U128(near(1)));
    let t = transfers();
    // 5% of 1 NEAR to the treasury (no season pool), 0.95 to the owner, 0.2 back.
    assert_eq!(t.get(&treasury()), Some(&milli(50)));
    assert_eq!(t.get(&creator()), Some(&milli(950)));
    assert_eq!(t.get(&renter()), Some(&milli(200)));
    let e = event("rental");
    assert_eq!(e["rental_id"], "rnt_1:n1");
    assert_eq!(e["owner"], "tyron.testnet");
    assert_eq!(e["renter"], "kai.testnet");
    assert_eq!(e["price"], near(1).to_string());
    assert_eq!(e["fee"], milli(50).to_string());
    assert_eq!(e["fee_bps"], 500);
    assert_eq!(e["owner_proceeds"], milli(950).to_string());
    assert_eq!(e["refund"], milli(200).to_string());
    assert_eq!(e["season_share"], "0");
    assert_eq!(e["treasury_share"], milli(50).to_string());
}

#[test]
fn rent_parts_sum_to_the_deposit_for_awkward_prices() {
    for price in [1u128, 19, 10_001, 123_456_789_012_345_678_901] {
        let mut c = setup();
        set(renter(), price + 7);
        c.rent("rnt_x".to_string(), creator(), U128(price));
        let total: u128 = transfers().values().sum();
        assert_eq!(total, price + 7, "price {price}");
    }
}

#[test]
fn rent_sends_the_season_share_of_the_fee_to_the_pool() {
    let mut c = setup_governed(None);
    set(renter(), near(2));
    c.rent("rnt_2".to_string(), creator(), U128(near(2)));
    // Fee 0.1 NEAR: 30% (0.03) to the seasons contract's fund(None), 0.07 to the treasury.
    let (to, amount, args) = fund_call().expect("fund call");
    assert_eq!(to, seasons());
    assert_eq!(amount, milli(30));
    assert_eq!(args["season_id"], serde_json::Value::Null);
    let t = transfers();
    assert_eq!(t.get(&treasury()), Some(&milli(70)));
    assert_eq!(t.get(&creator()), Some(&milli(1_900)));
    let e = event("rental");
    assert_eq!(e["season_share"], milli(30).to_string());
    assert_eq!(e["treasury_share"], milli(70).to_string());
}

#[test]
#[should_panic(expected = "Attach at least the price")]
fn rent_below_price_rejected() {
    let mut c = setup();
    set(renter(), near(1) - 1);
    c.rent("rnt_3".to_string(), creator(), U128(near(1)));
}

#[test]
#[should_panic(expected = "The owner cannot rent their own agent")]
fn rent_own_agent_rejected() {
    let mut c = setup();
    set(creator(), near(1));
    c.rent("rnt_4".to_string(), creator(), U128(near(1)));
}

#[test]
#[should_panic(expected = "Price must be greater than 0")]
fn rent_zero_price_rejected() {
    let mut c = setup();
    set(renter(), 1);
    c.rent("rnt_5".to_string(), creator(), U128(0));
}

#[test]
#[should_panic(expected = "rental_id must be 1 to 96 bytes")]
fn rent_empty_id_rejected() {
    let mut c = setup();
    set(renter(), near(1));
    c.rent(String::new(), creator(), U128(near(1)));
}

#[test]
#[should_panic(expected = "rental_id must be 1 to 96 bytes")]
fn rent_overlong_id_rejected() {
    let mut c = setup();
    set(renter(), near(1));
    c.rent("x".repeat(MAX_RENTAL_ID_LEN + 1), creator(), U128(near(1)));
}

#[test]
fn rent_keeps_no_state_and_leaves_listings_alone() {
    let mut c = setup();
    list(&mut c, TOKEN, creator(), 1, near(5));
    set(renter(), near(1));
    c.rent("rnt_6".to_string(), creator(), U128(near(1)));
    assert_eq!(c.get_listings(None, None).len(), 1);
    assert_eq!(c.get_listing(TOKEN.to_string()).unwrap().price, U128(near(5)));
}
