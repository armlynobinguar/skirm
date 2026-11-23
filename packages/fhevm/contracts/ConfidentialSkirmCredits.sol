// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {FHE, euint64, externalEuint64} from "@fhevm/solidity/lib/FHE.sol";
import {ZamaEthereumConfig} from "@fhevm/solidity/config/ZamaConfig.sol";
import {ERC7984} from "@openzeppelin/confidential-contracts/token/ERC7984/ERC7984.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";

/// @title Confidential skirm credits (cSKIRM)
/// @author skirm
/// @notice ERC-7984 confidential token used for skirm stakes and rewards on the Zama Protocol.
///         Balances and transfer amounts are FHE ciphertexts: only the holder (and contracts they
///         grant access to) can decrypt them.
/// @dev Minting is restricted to the owner and to minter accounts (game contracts) the owner approves.
///      A rate-limited public faucet hands out a fixed amount so testers can get credits on Sepolia.
///      The faucet amount is public by design (it is a constant), but the resulting balance is not:
///      once a holder transfers or stakes, nobody else can tell how many credits they hold.
contract ConfidentialSkirmCredits is ZamaEthereumConfig, ERC7984, Ownable2Step {
    /// @notice Accounts allowed to mint, besides the owner.
    mapping(address account => bool) public isMinter;

    /// @notice Amount (in base units, 6 decimals) minted per faucet claim.
    uint64 public faucetAmount;

    /// @notice Seconds an address must wait between two faucet claims.
    uint64 public faucetCooldown;

    /// @notice Timestamp of each address's last faucet claim (0 if never claimed).
    mapping(address account => uint64) public lastFaucetClaim;

    /// @notice Emitted when the owner grants or revokes the minter role.
    event MinterSet(address indexed account, bool allowed);

    /// @notice Emitted when the owner changes the faucet parameters.
    event FaucetConfigured(uint64 amount, uint64 cooldown);

    /// @notice Emitted on each successful faucet claim. The minted amount is the public `faucetAmount`.
    event FaucetClaimed(address indexed account, uint64 amount);

    /// @notice The caller is neither the owner nor an approved minter.
    error UnauthorizedMinter(address caller);

    /// @notice The caller claimed the faucet too recently.
    /// @param availableAt Timestamp from which the caller can claim again.
    error FaucetCooldownActive(uint64 availableAt);

    /// @notice The faucet is disabled (amount set to zero).
    error FaucetDisabled();

    /// @param initialOwner Owner of the token (can mint, manage minters and configure the faucet).
    /// @param faucetAmount_ Base units minted per faucet claim (0 disables the faucet).
    /// @param faucetCooldown_ Seconds between two claims from the same address.
    constructor(
        address initialOwner,
        uint64 faucetAmount_,
        uint64 faucetCooldown_
    ) ERC7984("Confidential skirm credits", "cSKIRM", "") Ownable(initialOwner) {
        faucetAmount = faucetAmount_;
        faucetCooldown = faucetCooldown_;
        emit FaucetConfigured(faucetAmount_, faucetCooldown_);
    }

    modifier onlyMinter() {
        if (msg.sender != owner() && !isMinter[msg.sender]) revert UnauthorizedMinter(msg.sender);
        _;
    }

    /// @notice Grants or revokes the minter role.
    /// @param account Account (usually a game contract) to update.
    /// @param allowed Whether `account` may mint.
    function setMinter(address account, bool allowed) external onlyOwner {
        isMinter[account] = allowed;
        emit MinterSet(account, allowed);
    }

    /// @notice Changes the faucet parameters.
    /// @param amount Base units minted per claim (0 disables the faucet).
    /// @param cooldown Seconds between two claims from the same address.
    function setFaucet(uint64 amount, uint64 cooldown) external onlyOwner {
        faucetAmount = amount;
        faucetCooldown = cooldown;
        emit FaucetConfigured(amount, cooldown);
    }

    /// @notice Mints an encrypted amount supplied as an FHEVM encrypted input.
    /// @param to Recipient.
    /// @param encryptedAmount Encrypted input handle created for this contract and the caller.
    /// @param inputProof Proof attached to the encrypted input.
    /// @return minted Handle of the amount actually minted (0 if total supply would overflow).
    function mint(
        address to,
        externalEuint64 encryptedAmount,
        bytes calldata inputProof
    ) external onlyMinter returns (euint64 minted) {
        minted = _mint(to, FHE.fromExternal(encryptedAmount, inputProof));
    }

    /// @notice Mints an amount the caller already holds as a ciphertext (e.g. a game contract's payout).
    /// @dev The caller must have ACL access to `amount`.
    /// @param to Recipient.
    /// @param amount Encrypted amount handle the caller is allowed to use.
    /// @return minted Handle of the amount actually minted.
    function mintFromHandle(address to, euint64 amount) external onlyMinter returns (euint64 minted) {
        require(FHE.isSenderAllowed(amount), ERC7984UnauthorizedUseOfEncryptedAmount(amount, msg.sender));
        minted = _mint(to, amount);
        FHE.allowTransient(minted, msg.sender);
    }

    /// @notice Claims `faucetAmount` test credits. Each address can claim once per `faucetCooldown`.
    function claimFaucet() external {
        uint64 amount = faucetAmount;
        if (amount == 0) revert FaucetDisabled();
        uint64 availableAt = nextFaucetClaimAt(msg.sender);
        if (block.timestamp < availableAt) revert FaucetCooldownActive(availableAt);

        lastFaucetClaim[msg.sender] = uint64(block.timestamp);
        _mint(msg.sender, FHE.asEuint64(amount));
        emit FaucetClaimed(msg.sender, amount);
    }

    /// @notice Timestamp from which `account` can claim the faucet (0 if it never claimed).
    /// @param account Address to check.
    function nextFaucetClaimAt(address account) public view returns (uint64) {
        uint64 last = lastFaucetClaim[account];
        return last == 0 ? 0 : last + faucetCooldown;
    }
}
