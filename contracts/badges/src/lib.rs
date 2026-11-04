//! skirm badges contract (badges.playskirm.testnet, not deployed yet).
//!
//! Soulbound achievement badges in the NEP-171 shape: tokens, the NEP-171 `nft_mint` event, the
//! NEP-181 enumeration and NEP-177 metadata views, so wallets and explorers list them like any
//! NFT. They never move: `nft_transfer` and `nft_transfer_call` always panic and there are no
//! approvals.
//!
//! * `nft_mint` is callable only by the platform signer (`ops.playskirm.testnet`), a function-call
//!   key that cannot attach NEAR, so this contract pays token storage from its own balance.
//! * One badge per player and achievement: the token id is `<achievement id>:<player>`, where
//!   `player` is the platform account id. Minting the same badge to the same owner again returns
//!   the existing token (no second event), so the backend can resend a call whose answer was lost.

use near_contract_standards::non_fungible_token::core::NonFungibleTokenCore;
use near_contract_standards::non_fungible_token::enumeration::NonFungibleTokenEnumeration;
use near_contract_standards::non_fungible_token::events::NftMint;
use near_contract_standards::non_fungible_token::metadata::{
    NFTContractMetadata, NonFungibleTokenMetadataProvider, TokenMetadata, NFT_METADATA_SPEC,
};
use near_contract_standards::non_fungible_token::{NonFungibleToken, Token, TokenId};
use near_sdk::collections::LazyOption;
use near_sdk::json_types::U128;
use near_sdk::store::LookupMap;
use near_sdk::{
    assert_one_yocto, env, near, require, AccountId, BorshStorageKey, PanicOnDefault,
    PromiseOrValue,
};

pub const BADGE_SCHEMA: &str = "skirm.badge/v0";
pub const MAX_ACHIEVEMENT_ID: usize = 32;
pub const MAX_PLAYER: usize = 64;
pub const MAX_TITLE: usize = 64;
pub const MAX_DESCRIPTION: usize = 140;

/// Token id of a badge: `<achievement id>:<player>`.
pub fn token_id_for(achievement_id: &str, player: &str) -> TokenId {
    format!("{achievement_id}:{player}")
}

/// What the platform submits to mint one badge.
#[derive(Clone, Debug)]
#[near(serializers = [json])]
pub struct BadgeMint {
    /// 1–32 chars: `a`–`z`, `0`–`9`, `_`.
    pub achievement_id: String,
    /// Platform account id, 1–64 chars: letters, digits, `_` and `-`.
    pub player: String,
    /// 1–64 chars.
    pub title: String,
    /// ≤ 140 chars.
    pub description: String,
    /// When the achievement unlocked, ms since the epoch.
    pub unlocked_at_ms: u64,
}

/// Onchain facts per badge (also written into `metadata.extra` as JSON).
#[derive(Clone, Debug, PartialEq, Eq)]
#[near(serializers = [borsh, json])]
pub struct BadgeInfo {
    pub token_id: TokenId,
    pub achievement_id: String,
    pub player: String,
    pub owner_id: AccountId,
    pub unlocked_at_ms: u64,
    pub minted_at_ms: u64,
}

#[derive(Clone, Debug, PartialEq, Eq)]
#[near(serializers = [json])]
pub struct Config {
    pub owner_id: AccountId,
    pub ops_id: AccountId,
}

#[derive(BorshStorageKey)]
#[near]
enum StorageKey {
    NonFungibleToken,
    TokenMetadata,
    Enumeration,
    ContractMetadata,
    BadgeInfo,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Contract {
    owner_id: AccountId,
    ops_id: AccountId,
    tokens: NonFungibleToken,
    metadata: LazyOption<NFTContractMetadata>,
    badge_info: LookupMap<TokenId, BadgeInfo>,
}

#[near]
impl Contract {
    #[init]
    pub fn new(owner_id: AccountId, ops_id: AccountId, metadata: Option<NFTContractMetadata>) -> Self {
        let metadata = metadata.unwrap_or_else(|| NFTContractMetadata {
            spec: NFT_METADATA_SPEC.to_string(),
            name: "skirm badges".to_string(),
            symbol: "SKIRMBADGE".to_string(),
            icon: None,
            base_uri: None,
            reference: None,
            reference_hash: None,
        });
        metadata.assert_valid();
        Self {
            tokens: NonFungibleToken::new(
                StorageKey::NonFungibleToken,
                owner_id.clone(),
                Some(StorageKey::TokenMetadata),
                Some(StorageKey::Enumeration),
                None::<StorageKey>,
            ),
            owner_id,
            ops_id,
            metadata: LazyOption::new(StorageKey::ContractMetadata, Some(&metadata)),
            badge_info: LookupMap::new(StorageKey::BadgeInfo),
        }
    }

    /// Mint a badge to `receiver_id`. Ops only; no deposit (storage is paid by this contract).
    /// `token_id` must be `<achievement id>:<player>`. The same badge to the same owner again
    /// returns the existing token; to another owner it panics.
    pub fn nft_mint(&mut self, token_id: TokenId, receiver_id: AccountId, badge: BadgeMint) -> Token {
        require!(
            env::predecessor_account_id() == self.ops_id,
            "Only the platform ops account can mint"
        );
        validate_badge(&badge);
        require!(
            token_id == token_id_for(&badge.achievement_id, &badge.player),
            "token_id must be <achievement_id>:<player>"
        );
        if let Some(existing) = self.tokens.nft_token(token_id.clone()) {
            require!(
                existing.owner_id == receiver_id,
                "This badge was already minted to another account"
            );
            return existing;
        }

        let info = BadgeInfo {
            token_id: token_id.clone(),
            achievement_id: badge.achievement_id.clone(),
            player: badge.player.clone(),
            owner_id: receiver_id.clone(),
            unlocked_at_ms: badge.unlocked_at_ms,
            minted_at_ms: env::block_timestamp_ms(),
        };
        let metadata = TokenMetadata {
            title: Some(badge.title.clone()),
            description: Some(badge.description.clone()),
            media: None,
            media_hash: None,
            copies: Some(1),
            issued_at: Some(info.minted_at_ms.to_string()),
            expires_at: None,
            starts_at: None,
            updated_at: None,
            extra: Some(metadata_extra(&info)),
            reference: None,
            reference_hash: None,
        };
        // `None` refund account: the contract pays storage from its own balance.
        let token =
            self.tokens
                .internal_mint_with_refund(token_id.clone(), receiver_id, Some(metadata), None);
        NftMint {
            owner_id: &token.owner_id,
            token_ids: &[&token.token_id],
            memo: Some("soulbound"),
        }
        .emit();
        self.badge_info.insert(token_id, info);
        token
    }

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
        }
    }

    pub fn badge_info(&self, token_id: TokenId) -> Option<BadgeInfo> {
        self.badge_info.get(&token_id).cloned()
    }

    /// The badge of one player for one achievement, if minted.
    pub fn badge_for(&self, achievement_id: String, player: String) -> Option<Token> {
        self.tokens.nft_token(token_id_for(&achievement_id, &player))
    }

    /// Always true: badges never move.
    pub fn is_soulbound(&self) -> bool {
        true
    }
}

impl Contract {
    fn assert_owner(&self) {
        require!(
            env::predecessor_account_id() == self.owner_id,
            "Only the owner can call this method"
        );
    }
}

fn metadata_extra(info: &BadgeInfo) -> String {
    near_sdk::serde_json::json!({
        "schema": BADGE_SCHEMA,
        "achievement_id": info.achievement_id,
        "player": info.player,
        "unlocked_at_ms": info.unlocked_at_ms,
        "soulbound": true,
    })
    .to_string()
}

pub fn validate_badge(b: &BadgeMint) {
    let id_len = b.achievement_id.len();
    require!(
        (1..=MAX_ACHIEVEMENT_ID).contains(&id_len)
            && b
                .achievement_id
                .chars()
                .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '_'),
        "achievement_id must be 1-32 chars of a-z, 0-9 and _"
    );
    require!(
        (1..=MAX_PLAYER).contains(&b.player.len())
            && b
                .player
                .chars()
                .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-'),
        "player must be 1-64 chars of letters, digits, _ and -"
    );
    let title = b.title.chars().count();
    require!(
        (1..=MAX_TITLE).contains(&title) && b.title.trim() == b.title,
        "title must be 1-64 chars without outer spaces"
    );
    require!(
        b.description.chars().count() <= MAX_DESCRIPTION,
        "description must be at most 140 chars"
    );
}

// ---------- NEP-171 core (soulbound) ----------

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
        let _ = (receiver_id, token_id, approval_id, memo);
        env::panic_str("Badges are soulbound and cannot be transferred")
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
        let _ = (receiver_id, token_id, approval_id, memo, msg);
        env::panic_str("Badges are soulbound and cannot be transferred")
    }

    fn nft_token(&self, token_id: TokenId) -> Option<Token> {
        self.tokens.nft_token(token_id)
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
