//! skirm skills contract (skills.playskirm.testnet).
//!
//! NEP-171 NFT with the approval (NEP-178), enumeration (NEP-181) and metadata (NEP-177)
//! extensions, plus NEP-199 payouts. Each token is one immutable skill version
//! (editing a skill creates the next version, minted as its own token; the skill format is
//! `SkillPublic` in packages/shared/src/types.ts).
//!
//! * `nft_mint` is callable only by the platform signer (`ops.playskirm.testnet`). The ops key is a
//!   function-call key, which cannot attach NEAR, so this contract pays token storage from its
//!   own balance.
//! * The token is minted to the skill's creator. Creator and `royalty_bps` (0–1,000, default
//!   500) are fixed at mint.
//! * NEP-199 payout: on a resale the creator gets `floor(P · royalty_bps / 10^4)` and the owner
//!   the rest; when the creator is the seller (primary sale) the royalty is 0. The backend
//!   mirrors this split in packages/shared/src/market.ts.
//! * The prompt is never on chain; only `prompt_sha256`. The starter skill (Flood Warden) is
//!   account-bound and never minted: its id can be registered with `set_account_bound`.

use std::collections::HashMap;

use near_contract_standards::non_fungible_token::approval::NonFungibleTokenApproval;
use near_contract_standards::non_fungible_token::core::{
    NonFungibleTokenCore, NonFungibleTokenResolver,
};
use near_contract_standards::non_fungible_token::enumeration::NonFungibleTokenEnumeration;
use near_contract_standards::non_fungible_token::events::NftMint;
use near_contract_standards::non_fungible_token::metadata::{
    NFTContractMetadata, NonFungibleTokenMetadataProvider, TokenMetadata, NFT_METADATA_SPEC,
};
use near_contract_standards::non_fungible_token::{
    refund_approved_account_ids, NonFungibleToken, Token, TokenId,
};
use near_sdk::collections::LazyOption;
use near_sdk::json_types::U128;
use near_sdk::store::{LookupMap, LookupSet};
use near_sdk::{
    assert_one_yocto, env, near, require, AccountId, BorshStorageKey, PanicOnDefault, Promise,
    PromiseOrValue,
};

pub const SKILL_SCHEMA: &str = "skirm.skill/v0";
pub const BPS_DENOMINATOR: u128 = 10_000;
/// Creator royalty on resale, set at mint, 0 to 1,000 bps, default 500.
pub const DEFAULT_ROYALTY_BPS: u16 = 500;
pub const MAX_ROYALTY_BPS: u16 = 1_000;

/// The 10 tags, in the order of `Tag` in packages/shared/src/types.ts (tag lists are always
/// written in this order).
pub const TAGS: [&str; 10] = [
    "spreads",
    "liquid",
    "damages",
    "solid",
    "blocks",
    "pushable",
    "breakable",
    "flammable",
    "collectible",
    "goal",
];
/// Gated actions a skill may declare in `requires_actions`, in canonical order.
pub const GATED_ACTIONS: [&str; 3] = ["place_block", "dig", "extinguish"];

/// `floor(amount · bps / 10^4)` without overflowing u128.
pub fn bps_of(amount: u128, bps: u16) -> u128 {
    let bps = bps as u128;
    (amount / BPS_DENOMINATOR) * bps + (amount % BPS_DENOMINATOR) * bps / BPS_DENOMINATOR
}

/// Token id of a skill version: `<skill id>:<version>`.
pub fn token_id_for(skill_id: &str, version: u32) -> TokenId {
    format!("{skill_id}:{version}")
}

/// NEP-199 payout object.
#[derive(Clone, Debug, PartialEq, Eq)]
#[near(serializers = [json])]
pub struct Payout {
    pub payout: HashMap<AccountId, U128>,
}

/// Payout for a sale of `balance` yoctoNEAR by `owner`: royalty is 0 when the
/// owner is the creator, otherwise `floor(balance · royalty_bps / 10^4)`; the owner gets the
/// remainder, so the entries always sum to `balance` exactly.
pub fn compute_payout(
    owner: &AccountId,
    creator: &AccountId,
    royalty_bps: u16,
    balance: u128,
) -> Payout {
    let mut payout = HashMap::new();
    let royalty = if owner == creator {
        0
    } else {
        bps_of(balance, royalty_bps)
    };
    if royalty > 0 {
        payout.insert(creator.clone(), U128(royalty));
    }
    payout.insert(owner.clone(), U128(balance - royalty));
    Payout { payout }
}

/// What the platform submits to mint one skill version (public fields of `skirm.skill/v0`).
#[derive(Clone, Debug)]
#[near(serializers = [json])]
pub struct SkillMint {
    /// `skl_` + ULID.
    pub id: String,
    /// ≥ 1.
    pub version: u32,
    /// 3–32 chars: letters, digits, spaces, `-` and `'`.
    pub name: String,
    /// ≤ 140 chars.
    pub summary: Option<String>,
    /// NEAR account of the writer; receives the token and royalties.
    pub creator: AccountId,
    /// 0–1,000; default 500.
    pub royalty_bps: Option<u16>,
    /// 0–3 unique values from `place_block`, `dig`, `extinguish`.
    pub requires_actions: Vec<String>,
    /// 1–10 unique tags.
    pub handles_tags: Vec<String>,
    /// 64 lowercase hex chars.
    pub prompt_sha256: String,
    /// ISO 8601 UTC, e.g. `2026-11-03T08:15:00Z`.
    pub created_at: String,
}

/// Onchain skill facts per token (also written into `metadata.extra` as JSON).
#[derive(Clone, Debug, PartialEq, Eq)]
#[near(serializers = [borsh, json])]
pub struct SkillInfo {
    pub token_id: TokenId,
    pub skill_id: String,
    pub version: u32,
    pub creator: AccountId,
    pub royalty_bps: u16,
    pub prompt_sha256: String,
    pub requires_actions: Vec<String>,
    pub handles_tags: Vec<String>,
    pub created_at: String,
}

#[derive(Clone, Debug, PartialEq, Eq)]
#[near(serializers = [json])]
pub struct Config {
    pub owner_id: AccountId,
    pub ops_id: AccountId,
    pub default_royalty_bps: u16,
    pub max_royalty_bps: u16,
}

#[derive(BorshStorageKey)]
#[near]
enum StorageKey {
    NonFungibleToken,
    TokenMetadata,
    Enumeration,
    Approval,
    ContractMetadata,
    SkillInfo,
    SkillCreator,
    AccountBound,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Contract {
    owner_id: AccountId,
    ops_id: AccountId,
    tokens: NonFungibleToken,
    metadata: LazyOption<NFTContractMetadata>,
    skill_info: LookupMap<TokenId, SkillInfo>,
    /// Creator of each skill id, fixed by its first minted version.
    skill_creator: LookupMap<String, AccountId>,
    /// Skill ids that must never be minted (the account-bound starter skill).
    account_bound: LookupSet<String>,
}

#[near]
impl Contract {
    #[init]
    pub fn new(
        owner_id: AccountId,
        ops_id: AccountId,
        metadata: Option<NFTContractMetadata>,
        account_bound_skill_ids: Option<Vec<String>>,
    ) -> Self {
        let metadata = metadata.unwrap_or_else(|| NFTContractMetadata {
            spec: NFT_METADATA_SPEC.to_string(),
            name: "skirm skills".to_string(),
            symbol: "SKIRM".to_string(),
            icon: None,
            base_uri: None,
            reference: None,
            reference_hash: None,
        });
        metadata.assert_valid();
        let mut account_bound = LookupSet::new(StorageKey::AccountBound);
        for id in account_bound_skill_ids.unwrap_or_default() {
            account_bound.insert(id);
        }
        Self {
            tokens: NonFungibleToken::new(
                StorageKey::NonFungibleToken,
                owner_id.clone(),
                Some(StorageKey::TokenMetadata),
                Some(StorageKey::Enumeration),
                Some(StorageKey::Approval),
            ),
            owner_id,
            ops_id,
            metadata: LazyOption::new(StorageKey::ContractMetadata, Some(&metadata)),
            skill_info: LookupMap::new(StorageKey::SkillInfo),
            skill_creator: LookupMap::new(StorageKey::SkillCreator),
            account_bound,
        }
    }

    /// Mint one skill version to its creator. Ops only; no deposit (storage is paid by this
    /// contract). Token id is `<skill id>:<version>`.
    ///
    /// Idempotent: when the version is already minted with the same content (creator, royalty,
    /// prompt hash, tags, actions, created_at, name and summary), the existing token is returned
    /// with no new storage and no second `nft_mint` event, so the platform can safely retry a
    /// call whose answer was lost. The same version with different content panics.
    pub fn nft_mint(&mut self, skill: SkillMint) -> Token {
        require!(
            env::predecessor_account_id() == self.ops_id,
            "Only the platform ops account can mint"
        );
        let info = validate_skill(skill.clone());
        require!(
            !self.account_bound.contains(&info.skill_id),
            "This skill is account-bound and is never minted"
        );
        if let Some(existing) = self.skill_info.get(&info.token_id) {
            let token = self
                .tokens
                .nft_token(info.token_id.clone())
                .unwrap_or_else(|| env::panic_str("Skill info without a token"));
            let same_metadata = token.metadata.as_ref().is_some_and(|md| {
                md.title.as_deref() == Some(skill.name.as_str())
                    && md.description == skill.summary
            });
            require!(
                existing == &info && same_metadata,
                "This skill version is already minted with different content"
            );
            return token;
        }
        if let Some(creator) = self.skill_creator.get(&info.skill_id) {
            require!(
                creator == &info.creator,
                "Creator is fixed by the skill's first version"
            );
        }

        let metadata = TokenMetadata {
            title: Some(skill.name.clone()),
            description: skill.summary.clone(),
            media: None,
            media_hash: None,
            copies: Some(1),
            issued_at: Some(info.created_at.clone()),
            expires_at: None,
            starts_at: None,
            updated_at: None,
            extra: Some(metadata_extra(&info)),
            reference: None,
            reference_hash: None,
        };
        // `None` refund account: the contract pays storage from its own balance.
        let token = self.tokens.internal_mint_with_refund(
            info.token_id.clone(),
            info.creator.clone(),
            Some(metadata),
            None,
        );
        NftMint {
            owner_id: &token.owner_id,
            token_ids: &[&token.token_id],
            memo: None,
        }
        .emit();
        self.skill_creator
            .insert(info.skill_id.clone(), info.creator.clone());
        self.skill_info.insert(info.token_id.clone(), info);
        token
    }

    // ---------- NEP-199 payouts ----------

    /// How `balance` would be split if the current owner sold the token now.
    pub fn nft_payout(
        &self,
        token_id: TokenId,
        balance: U128,
        max_len_payout: Option<u32>,
    ) -> Payout {
        let owner = self
            .tokens
            .owner_by_id
            .get(&token_id)
            .unwrap_or_else(|| env::panic_str("Token not found"));
        self.payout_for(&token_id, &owner, balance.0, max_len_payout)
    }

    /// Transfer (as owner or approved account) and return the payout of `balance` computed
    /// for the owner before the transfer. Requires exactly 1 yoctoNEAR.
    #[payable]
    pub fn nft_transfer_payout(
        &mut self,
        receiver_id: AccountId,
        token_id: TokenId,
        approval_id: Option<u64>,
        memo: Option<String>,
        balance: U128,
        max_len_payout: Option<u32>,
    ) -> Payout {
        assert_one_yocto();
        let owner = self
            .tokens
            .owner_by_id
            .get(&token_id)
            .unwrap_or_else(|| env::panic_str("Token not found"));
        let payout = self.payout_for(&token_id, &owner, balance.0, max_len_payout);
        let (previous_owner, approvals) = self.tokens.internal_transfer(
            &env::predecessor_account_id(),
            &receiver_id,
            &token_id,
            approval_id,
            memo,
        );
        if let Some(approvals) = approvals {
            if !approvals.is_empty() {
                refund_approved_account_ids(previous_owner, &approvals).detach();
            }
        }
        payout
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

    /// Mark a skill id as account-bound (never mintable), or clear the mark.
    #[payable]
    pub fn set_account_bound(&mut self, skill_id: String, bound: bool) {
        assert_one_yocto();
        self.assert_owner();
        if bound {
            self.account_bound.insert(skill_id);
        } else {
            self.account_bound.remove(&skill_id);
        }
    }

    // ---------- views ----------

    pub fn get_config(&self) -> Config {
        Config {
            owner_id: self.owner_id.clone(),
            ops_id: self.ops_id.clone(),
            default_royalty_bps: DEFAULT_ROYALTY_BPS,
            max_royalty_bps: MAX_ROYALTY_BPS,
        }
    }

    pub fn skill_info(&self, token_id: TokenId) -> Option<SkillInfo> {
        self.skill_info.get(&token_id).cloned()
    }

    pub fn skill_token(&self, skill_id: String, version: u32) -> Option<Token> {
        self.tokens.nft_token(token_id_for(&skill_id, version))
    }

    pub fn is_account_bound(&self, skill_id: String) -> bool {
        self.account_bound.contains(&skill_id)
    }
}

impl Contract {
    fn assert_owner(&self) {
        require!(
            env::predecessor_account_id() == self.owner_id,
            "Only the owner can call this method"
        );
    }

    fn payout_for(
        &self,
        token_id: &TokenId,
        owner: &AccountId,
        balance: u128,
        max_len_payout: Option<u32>,
    ) -> Payout {
        let info = self
            .skill_info
            .get(token_id)
            .unwrap_or_else(|| env::panic_str("Skill info not found"));
        let payout = compute_payout(owner, &info.creator, info.royalty_bps, balance);
        if let Some(max) = max_len_payout {
            require!(
                payout.payout.len() as u32 <= max,
                "Payout exceeds max_len_payout"
            );
        }
        payout
    }
}

fn metadata_extra(info: &SkillInfo) -> String {
    near_sdk::serde_json::json!({
        "schema": SKILL_SCHEMA,
        "id": info.skill_id,
        "version": info.version,
        "creator": info.creator,
        "royalty_bps": info.royalty_bps,
        "prompt_sha256": info.prompt_sha256,
        "requires_actions": info.requires_actions,
        "handles_tags": info.handles_tags,
    })
    .to_string()
}

fn is_crockford(c: char) -> bool {
    c.is_ascii_digit() || (c.is_ascii_uppercase() && !matches!(c, 'I' | 'L' | 'O' | 'U'))
}

/// Validates the public skill fields (`skirm.skill/v0`) and returns the onchain record, with tag
/// and action lists in canonical order.
pub fn validate_skill(skill: SkillMint) -> SkillInfo {
    let id = &skill.id;
    require!(
        id.len() == 30 && id.starts_with("skl_") && id[4..].chars().all(is_crockford),
        "Skill id must be skl_ followed by a 26-character ULID"
    );
    require!(skill.version >= 1, "Skill version must be at least 1");

    let name_len = skill.name.chars().count();
    require!(
        (3..=32).contains(&name_len)
            && skill
                .name
                .chars()
                .all(|c| c.is_alphanumeric() || c == ' ' || c == '-' || c == '\''),
        "Skill name must be 3-32 letters, digits, spaces, - or '"
    );
    if let Some(summary) = &skill.summary {
        require!(
            summary.chars().count() <= 140,
            "Skill summary must be at most 140 characters"
        );
    }

    let royalty_bps = skill.royalty_bps.unwrap_or(DEFAULT_ROYALTY_BPS);
    require!(
        royalty_bps <= MAX_ROYALTY_BPS,
        "royalty_bps must be between 0 and 1000"
    );

    require!(
        skill.requires_actions.len() <= 3,
        "requires_actions takes at most 3 values"
    );
    let requires_actions =
        canonical_subset(&skill.requires_actions, &GATED_ACTIONS, "requires_actions");

    require!(
        (1..=10).contains(&skill.handles_tags.len()),
        "handles_tags takes 1 to 10 tags"
    );
    let handles_tags = canonical_subset(&skill.handles_tags, &TAGS, "handles_tags");

    require!(
        skill.prompt_sha256.len() == 64
            && skill
                .prompt_sha256
                .chars()
                .all(|c| c.is_ascii_digit() || ('a'..='f').contains(&c)),
        "prompt_sha256 must be 64 lowercase hex characters"
    );

    let ts = skill.created_at.as_bytes();
    require!(
        (20..=30).contains(&ts.len())
            && ts[4] == b'-'
            && ts[10] == b'T'
            && ts[ts.len() - 1] == b'Z',
        "created_at must be an ISO 8601 UTC timestamp"
    );

    SkillInfo {
        token_id: token_id_for(&skill.id, skill.version),
        skill_id: skill.id,
        version: skill.version,
        creator: skill.creator,
        royalty_bps,
        prompt_sha256: skill.prompt_sha256,
        requires_actions,
        handles_tags,
        created_at: skill.created_at,
    }
}

/// Checks that `values` are unique members of `allowed` and returns them in `allowed` order.
fn canonical_subset(values: &[String], allowed: &[&str], field: &str) -> Vec<String> {
    for (i, v) in values.iter().enumerate() {
        require!(
            allowed.contains(&v.as_str()),
            format!("{field}: unknown value {v}")
        );
        require!(
            !values[..i].contains(v),
            format!("{field}: duplicate value {v}")
        );
    }
    allowed
        .iter()
        .filter(|a| values.iter().any(|v| v == *a))
        .map(|a| a.to_string())
        .collect()
}

// ---------- NEP-171 core ----------

#[near]
impl NonFungibleTokenCore for Contract {
    #[payable]
    fn nft_transfer(
        &mut self,
        receiver_id: AccountId,
        token_id: TokenId,
        approval_id: Option<u64>,
        memo: Option<String>,
    ) {
        self.tokens
            .nft_transfer(receiver_id, token_id, approval_id, memo)
    }

    #[payable]
    fn nft_transfer_call(
        &mut self,
        receiver_id: AccountId,
        token_id: TokenId,
        approval_id: Option<u64>,
        memo: Option<String>,
        msg: String,
    ) -> PromiseOrValue<bool> {
        self.tokens
            .nft_transfer_call(receiver_id, token_id, approval_id, memo, msg)
    }

    fn nft_token(&self, token_id: TokenId) -> Option<Token> {
        self.tokens.nft_token(token_id)
    }
}

#[near]
impl NonFungibleTokenResolver for Contract {
    #[private]
    fn nft_resolve_transfer(
        &mut self,
        previous_owner_id: AccountId,
        receiver_id: AccountId,
        token_id: TokenId,
        approved_account_ids: Option<HashMap<AccountId, u64>>,
    ) -> bool {
        self.tokens.nft_resolve_transfer(
            previous_owner_id,
            receiver_id,
            token_id,
            approved_account_ids,
        )
    }
}

// ---------- NEP-178 approvals ----------

#[near]
impl NonFungibleTokenApproval for Contract {
    #[payable]
    fn nft_approve(
        &mut self,
        token_id: TokenId,
        account_id: AccountId,
        msg: Option<String>,
    ) -> Option<Promise> {
        self.tokens.nft_approve(token_id, account_id, msg)
    }

    #[payable]
    fn nft_revoke(&mut self, token_id: TokenId, account_id: AccountId) {
        self.tokens.nft_revoke(token_id, account_id)
    }

    #[payable]
    fn nft_revoke_all(&mut self, token_id: TokenId) {
        self.tokens.nft_revoke_all(token_id)
    }

    fn nft_is_approved(
        &self,
        token_id: TokenId,
        approved_account_id: AccountId,
        approval_id: Option<u64>,
    ) -> bool {
        self.tokens
            .nft_is_approved(token_id, approved_account_id, approval_id)
    }
}

// ---------- NEP-181 enumeration ----------

#[near]
impl NonFungibleTokenEnumeration for Contract {
    fn nft_total_supply(&self) -> U128 {
        self.tokens.nft_total_supply()
    }

    fn nft_tokens(&self, from_index: Option<U128>, limit: Option<u64>) -> Vec<Token> {
        self.tokens.nft_tokens(from_index, limit)
    }

    fn nft_supply_for_owner(&self, account_id: AccountId) -> U128 {
        self.tokens.nft_supply_for_owner(account_id)
    }

    fn nft_tokens_for_owner(
        &self,
        account_id: AccountId,
        from_index: Option<U128>,
        limit: Option<u64>,
    ) -> Vec<Token> {
        self.tokens
            .nft_tokens_for_owner(account_id, from_index, limit)
    }
}

// ---------- NEP-177 metadata ----------

#[near]
impl NonFungibleTokenMetadataProvider for Contract {
    fn nft_metadata(&self) -> NFTContractMetadata {
        self.metadata.get().unwrap()
    }
}

#[cfg(test)]
mod tests;
