// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {FHE, ebool, euint8, euint16, euint64, externalEuint8, externalEuint64} from "@fhevm/solidity/lib/FHE.sol";
import {ZamaEthereumConfig} from "@fhevm/solidity/config/ZamaConfig.sol";
import {IERC7984} from "@openzeppelin/confidential-contracts/interfaces/IERC7984.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";

/// @title skirm sealed loadouts
/// @author skirm
/// @notice Commit-and-reveal for a skirm PvP lock-in, with the commitment kept as FHE ciphertexts.
///         Each player seals an encrypted loadout (which agents, which skills, which talk tier per
///         crew slot). Until both sides have sealed, nobody (the rival, the game server, a block
///         explorer) can read a pick: only the player who submitted it can user-decrypt it. Once
///         both are sealed, anyone can call `reveal`, which marks every handle publicly decryptable;
///         the KMS-signed plaintexts are then posted back with `finalizeReveal`, checked on chain
///         and stored, so the game server plays exactly the crews that were committed.
/// @dev Loadout encoding (see packages/shared/src/sealed-loadout.ts):
///      - `agents[i]`: 0 = empty slot, n = the n-th agent (1-based) of the player's roster sorted by id.
///      - `skills[i]`: bitmask over that agent's equipped skills (bit j = j-th equipped skill plays).
///      - `tiers[i]`:  talk tier, 0 quiet, 1 standard, 2 open.
///      Values are not range-checked on chain (an encrypted check could only clamp, never revert,
///      without leaking); the game server validates the revealed plaintexts.
///
///      Public decryption follows the current FHEVM flow (no oracle callback): `reveal` calls
///      `FHE.makePubliclyDecryptable`, a client fetches the clear values and the KMS proof from the
///      relayer (`publicDecrypt`), and `finalizeReveal` verifies them with `FHE.checkSignatures`.
///
///      On-chain randomness: the moment the second loadout is sealed, the contract draws an FHE
///      random match seed (`FHE.randEuint64`) and one encrypted value per supply drop slot
///      (`FHE.randEuint16`). Both sides are committed by then, so neither player can pick a loadout
///      against the seed, and nobody (players, the game server, the deployer) can read or re-roll
///      it: only this contract holds ACL access. The seed opens with the loadouts at `reveal`
///      (the 19th handle), so everyone learns it at the same moment the match starts. Each drop
///      value opens on its own, in order, no earlier than `dropDueAt` (`revealDrop`, then
///      `finalizeDrop` with the KMS proof). The game server maps a drop value to a legal tile
///      (packages/engine v2 `sealedDropTile`) and lands the drop once its value is public.
///
///      Confidential stakes: a match created with a nonzero `minStake` is staked. Each player
///      stakes an encrypted cSKIRM amount with its seal (same input proof), pulled through ERC-7984
///      `confidentialTransferFrom` (the player first makes this contract an operator with
///      `setOperator` on cSKIRM). ERC-7984 moves 0 instead of reverting when the balance is short,
///      so the escrow works on the amount actually transferred and derives an encrypted
///      "stake ok" flag (`transferred >= minStake`). The flags open with the loadouts at `reveal`
///      (handles 20 and 21): everyone learns "stake ok yes/no", never the amount. A side whose
///      flag is false does not count as locked in the escrow: the matched pot is
///      `min(select(ok0, stake0, 0), select(ok1, stake1, 0))`, so it can win nothing and both
///      stakes go back at settlement. The game server (the `operator` role) settles the result with
///      `settle`, which anchors the final log hash on chain and pays the matched pot to the winner
///      (minus the treasury fee), each side's unmatched excess back to it, or both stakes back on a
///      draw. Every payout is a confidential transfer: only its recipient can decrypt the amount.
///      The escrow lives in the `_on*` hooks below.
contract SkirmMatch is ZamaEthereumConfig, Ownable2Step {
    /// @notice Crew slots per side (the map crew limit never exceeds 3).
    uint8 public constant SLOTS = 3;

    /// @notice Number of encrypted values per loadout (agents, skills and tiers for each slot).
    uint8 public constant VALUES_PER_SIDE = 3 * SLOTS;

    /// @notice Shortest and longest lock window a match can be created with.
    uint64 public constant MIN_LOCK_WINDOW = 1 minutes;
    uint64 public constant MAX_LOCK_WINDOW = 1 days;

    /// @notice Sentinel for "no side" (e.g. no forfeit winner).
    uint8 public constant NO_SIDE = type(uint8).max;

    /// @notice Encrypted supply drop values drawn per match (maps use at most this many drops).
    uint8 public constant DROP_SLOTS = 3;

    /// @notice Drop `i` opens no earlier than `(i + 1) * DROP_INTERVAL` after the reveal is finalized.
    /// @dev The official maps land their drops 70 s to 140 s into a match (2 s ticks), so each
    ///      value is public at most a few seconds before its drop lands; a late reveal delays the drop
    ///      (the server lands it on the first tick after it reads the value), never the other way round.
    uint64 public constant DROP_INTERVAL = 60 seconds;

    /// @notice Highest treasury fee, in basis points of the matched pot (10%).
    uint16 public constant MAX_FEE_BPS = 1_000;

    /// @notice A locked match nobody settled is refundable by anyone this long after its lock deadline.
    uint64 public constant SETTLE_TIMEOUT = 1 days;

    /// @notice Lifecycle of a match.
    /// @dev None → Open → Locked → Revealing → Revealed → Settled, or Open → Forfeited / Cancelled
    ///      after the lock deadline, or Locked / Revealing / Revealed → Cancelled once SETTLE_TIMEOUT
    ///      passed without a settlement (`refundUnsettled`).
    enum Status {
        None,
        Open,
        Locked,
        Revealing,
        Revealed,
        Forfeited,
        Cancelled,
        Settled
    }

    /// @notice Public match header.
    /// @param players Side 0 (team A) and side 1 (team B); address(0) is an open seat claimed by the first submitter.
    /// @param lockDeadline Timestamp after which no loadout is accepted and `forfeit` becomes callable.
    /// @param status Current lifecycle step.
    /// @param locked Whether each side has sealed its loadout.
    /// @param winner Forfeit winner (the only side that locked), else NO_SIDE.
    struct MatchInfo {
        address[2] players;
        uint64 lockDeadline;
        Status status;
        bool[2] locked;
        uint8 winner;
    }

    /// @notice One side's sealed loadout (FHE handles).
    struct SealedLoadout {
        euint8[3] agents;
        euint8[3] skills;
        euint8[3] tiers;
    }

    /// @notice One side's revealed loadout (plaintexts, after `finalizeReveal`).
    struct RevealedLoadout {
        uint8[3] agents;
        uint8[3] skills;
        uint8[3] tiers;
    }

    mapping(bytes32 matchId => MatchInfo) private _matches;
    mapping(bytes32 matchId => SealedLoadout[2]) private _sealed;
    mapping(bytes32 matchId => RevealedLoadout[2]) private _revealed;

    /// @notice A match's on-chain randomness: the encrypted draws and, once opened, their plaintexts.
    /// @param seed FHE random match seed (zero handle until both sides sealed).
    /// @param drops FHE random value per supply drop slot.
    /// @param clearSeed The seed's verified plaintext (after `finalizeReveal`).
    /// @param clearDrops Each drop's verified plaintext (after its `finalizeDrop`).
    /// @param startedAt Timestamp `finalizeReveal` landed (the drop clock starts here; 0 before).
    /// @param dropsRequested Drops made publicly decryptable so far (they open in slot order).
    /// @param dropsRevealed Drops whose plaintext is stored so far.
    struct Randomness {
        euint64 seed;
        euint16[3] drops;
        uint64 clearSeed;
        uint16[3] clearDrops;
        uint64 startedAt;
        uint8 dropsRequested;
        uint8 dropsRevealed;
    }

    mapping(bytes32 matchId => Randomness) private _random;

    /// @notice A match's cSKIRM escrow. Amounts are FHE handles; only the side's player (and this
    ///         contract) can decrypt its own stake, payout and flag.
    /// @param minStake Public minimum stake in base units (0: the match is unstaked, nothing moves).
    /// @param feeBps Treasury fee on the matched pot, fixed when the match was created.
    /// @param staked Amount each side actually transferred in (ERC-7984 moves 0 on a short balance).
    /// @param stakeOk Encrypted `staked >= minStake` per side; public from `reveal` on.
    /// @param matched The pot each side puts at risk: min of both sides' valid stakes (0 if any is not ok).
    /// @param paid Amount paid back to each side at settlement, forfeit or refund.
    /// @param stakeOkClear The verified flags (after `finalizeReveal`).
    struct Escrow {
        uint64 minStake;
        uint16 feeBps;
        euint64[2] staked;
        ebool[2] stakeOk;
        euint64 matched;
        euint64[2] paid;
        bool[2] stakeOkClear;
    }

    /// @notice A settled match: the result the operator posted and the anchored log hash.
    /// @param logHash Head of the match's hash-chained log (the verification anchor).
    /// @param winner 0 or 1, or NO_SIDE for a draw.
    /// @param settledAt Timestamp of the settlement (0 before).
    struct Settlement {
        bytes32 logHash;
        uint8 winner;
        uint64 settledAt;
    }

    mapping(bytes32 matchId => Escrow) private _escrow;
    mapping(bytes32 matchId => Settlement) private _settlement;

    /// @notice The cSKIRM (ERC-7984) token stakes are paid in.
    IERC7984 public immutable credits;

    /// @notice The game server's signer: the only account that can `settle`.
    address public operator;

    /// @notice Receives the fee on settled pots (address(0) or a zero fee: no fee).
    address public treasury;

    /// @notice Fee in basis points of the matched pot for matches created from now on.
    uint16 public feeBps;

    /// @notice A match was created.
    event MatchCreated(bytes32 indexed matchId, address playerA, address playerB, uint64 lockDeadline);

    /// @notice A side sealed its loadout. The values stay encrypted.
    event LoadoutSealed(bytes32 indexed matchId, uint8 indexed side, address indexed player);

    /// @notice Both sides sealed; `reveal` can be called.
    event BothLocked(bytes32 indexed matchId);

    /// @notice The loadout handles are now publicly decryptable, in `revealHandles` order.
    event RevealRequested(bytes32 indexed matchId, bytes32[] handles);

    /// @notice The FHE seed and drop values were drawn (after both commitments). The values stay encrypted.
    event RandomnessDrawn(bytes32 indexed matchId, bytes32 seedHandle, bytes32[3] dropHandles);

    /// @notice The match seed's verified plaintext, published with the loadouts.
    event SeedRevealed(bytes32 indexed matchId, uint64 seed, uint64 startedAt);

    /// @notice Drop `slot` is now publicly decryptable.
    event DropRevealRequested(bytes32 indexed matchId, uint8 indexed slot, bytes32 handle);

    /// @notice Drop `slot`'s verified plaintext.
    event DropRevealed(bytes32 indexed matchId, uint8 indexed slot, uint16 value);

    /// @notice A side's verified plaintext loadout.
    event LoadoutRevealed(bytes32 indexed matchId, uint8 indexed side, uint8[3] agents, uint8[3] skills, uint8[3] tiers);

    /// @notice The lock deadline passed with exactly one side sealed: that side wins by forfeit.
    event MatchForfeited(bytes32 indexed matchId, uint8 winner);

    /// @notice The lock deadline passed with no side sealed, or a locked match was never settled.
    event MatchCancelled(bytes32 indexed matchId);

    /// @notice A side's stake went into escrow. `stakeHandle` is the transferred amount, encrypted.
    event StakeLocked(bytes32 indexed matchId, uint8 indexed side, address indexed player, bytes32 stakeHandle);

    /// @notice A side's verified "stake ok" flag (only yes/no: the amount stays encrypted).
    event StakeChecked(bytes32 indexed matchId, uint8 indexed side, bool ok);

    /// @notice A side was paid out of escrow. `amountHandle` only decrypts for `player`.
    event StakePaid(bytes32 indexed matchId, uint8 indexed side, address indexed player, bytes32 amountHandle);

    /// @notice The operator settled the match and anchored its final log hash.
    event MatchSettled(bytes32 indexed matchId, uint8 winner, bytes32 logHash);

    event OperatorSet(address indexed operator);
    event FeeSet(address indexed treasury, uint16 feeBps);

    /// @param credits_ The cSKIRM token stakes are paid in.
    /// @param operator_ The game server's signer (settles results).
    /// @param treasury_ Fee recipient (address(0) for none).
    /// @param feeBps_ Fee on the matched pot, at most MAX_FEE_BPS.
    constructor(IERC7984 credits_, address operator_, address treasury_, uint16 feeBps_) Ownable(msg.sender) {
        if (address(credits_) == address(0) || operator_ == address(0)) revert ZeroAddress();
        if (feeBps_ > MAX_FEE_BPS) revert InvalidFee(feeBps_);
        credits = credits_;
        operator = operator_;
        treasury = treasury_;
        feeBps = feeBps_;
        emit OperatorSet(operator_);
        emit FeeSet(treasury_, feeBps_);
    }

    /// @notice Changes the settlement operator.
    function setOperator(address operator_) external onlyOwner {
        if (operator_ == address(0)) revert ZeroAddress();
        operator = operator_;
        emit OperatorSet(operator_);
    }

    /// @notice Changes the fee recipient and the fee for matches created from now on.
    function setFee(address treasury_, uint16 feeBps_) external onlyOwner {
        if (feeBps_ > MAX_FEE_BPS) revert InvalidFee(feeBps_);
        treasury = treasury_;
        feeBps = feeBps_;
        emit FeeSet(treasury_, feeBps_);
    }

    error MatchExists(bytes32 matchId);
    error UnknownMatch(bytes32 matchId);
    error InvalidPlayers();
    error InvalidLockWindow(uint64 lockWindow);
    error InvalidSide(uint8 side);
    error WrongStatus(Status status);
    error NotPlayer(address caller);
    error AlreadySealed(uint8 side);
    error LockClosed(uint64 lockDeadline);
    error LockStillOpen(uint64 lockDeadline);
    error InvalidDrop(uint8 slot);
    error DropOutOfOrder(uint8 slot, uint8 next);
    error DropNotDue(uint8 slot, uint64 dueAt);
    error NotOperator(address caller);
    error InvalidWinner(uint8 winner);
    error InvalidLogHash();
    error InvalidFee(uint16 feeBps);
    error ZeroAddress();
    error SettleStillOpen(uint64 refundableAt);

    /// @notice Creates a match. A seat left as address(0) goes to the first account that seals it.
    /// @dev When a seat is fixed, the creator must be one of the fixed players, so nobody can bind
    ///      two other people to a match id. Both seats open is allowed (the client that gets there
    ///      first creates it; the game server checks each seat's address against the one its player
    ///      declared off chain).
    /// @param matchId Off-chain match id, hashed: keccak256(utf8(matchId)).
    /// @param playerA Side 0 (team A), or address(0) for an open seat.
    /// @param playerB Side 1 (team B), or address(0) for an open seat.
    /// @param lockWindow Seconds from now until the lock deadline.
    /// @param minStake Public minimum cSKIRM stake per side in base units (0: unstaked match).
    function createMatch(bytes32 matchId, address playerA, address playerB, uint64 lockWindow, uint64 minStake) external {
        MatchInfo storage m = _matches[matchId];
        if (m.status != Status.None) revert MatchExists(matchId);
        if (playerA != address(0) && playerA == playerB) revert InvalidPlayers();
        if ((playerA != address(0) || playerB != address(0)) && msg.sender != playerA && msg.sender != playerB) {
            revert InvalidPlayers();
        }
        if (lockWindow < MIN_LOCK_WINDOW || lockWindow > MAX_LOCK_WINDOW) revert InvalidLockWindow(lockWindow);

        uint64 deadline = uint64(block.timestamp) + lockWindow;
        m.players = [playerA, playerB];
        m.lockDeadline = deadline;
        m.status = Status.Open;
        m.winner = NO_SIDE;
        emit MatchCreated(matchId, playerA, playerB, deadline);
        _onCreated(matchId, minStake);
    }

    /// @notice Seals the caller's loadout for `side`. One submission per side, before the deadline.
    /// @dev All ten values share one input proof (created for this contract and the caller).
    ///      Only the caller and this contract get ACL access to the handles. On a staked match the
    ///      caller must have made this contract a cSKIRM operator (`setOperator`); the stake is
    ///      pulled even when it is short (the transfer then moves 0), and only the encrypted flag
    ///      records whether it met `minStake`, so the call never reveals the amount.
    /// @param matchId The match.
    /// @param side 0 for team A, 1 for team B.
    /// @param agents Encrypted roster index per slot (0 = empty).
    /// @param skills Encrypted equipped-skill bitmask per slot.
    /// @param tiers Encrypted talk tier per slot.
    /// @param stake Encrypted cSKIRM stake (ignored on an unstaked match).
    /// @param inputProof Proof for the encrypted inputs.
    function submitLoadout(
        bytes32 matchId,
        uint8 side,
        externalEuint8[3] calldata agents,
        externalEuint8[3] calldata skills,
        externalEuint8[3] calldata tiers,
        externalEuint64 stake,
        bytes calldata inputProof
    ) external {
        MatchInfo storage m = _requireMatch(matchId);
        if (side > 1) revert InvalidSide(side);
        if (m.status != Status.Open) revert WrongStatus(m.status);
        if (block.timestamp > m.lockDeadline) revert LockClosed(m.lockDeadline);
        address seat = m.players[side];
        if (seat == address(0)) {
            // Claim the open seat, unless the caller already holds the other one.
            if (m.players[1 - side] == msg.sender) revert NotPlayer(msg.sender);
            m.players[side] = msg.sender;
        } else if (seat != msg.sender) {
            revert NotPlayer(msg.sender);
        }
        if (m.locked[side]) revert AlreadySealed(side);

        SealedLoadout storage l = _sealed[matchId][side];
        for (uint256 i = 0; i < SLOTS; i++) {
            l.agents[i] = _seal(FHE.fromExternal(agents[i], inputProof));
            l.skills[i] = _seal(FHE.fromExternal(skills[i], inputProof));
            l.tiers[i] = _seal(FHE.fromExternal(tiers[i], inputProof));
        }
        m.locked[side] = true;
        emit LoadoutSealed(matchId, side, msg.sender);
        _onSealed(matchId, side, stake, inputProof);

        if (m.locked[1 - side]) {
            m.status = Status.Locked;
            emit BothLocked(matchId);
            _drawRandomness(matchId);
            _onBothLocked(matchId);
        }
    }

    /// @notice Opens both loadouts, the match seed and both "stake ok" flags for public decryption.
    ///         Anyone can call it once both sides sealed.
    /// @param matchId The match.
    function reveal(bytes32 matchId) external {
        MatchInfo storage m = _requireMatch(matchId);
        if (m.status != Status.Locked) revert WrongStatus(m.status);
        m.status = Status.Revealing;
        bytes32[] memory handles = revealHandles(matchId);
        uint256 loadoutValues = 2 * uint256(VALUES_PER_SIDE);
        for (uint256 i = 0; i < loadoutValues; i++) {
            FHE.makePubliclyDecryptable(euint8.wrap(handles[i]));
        }
        FHE.makePubliclyDecryptable(_random[matchId].seed);
        Escrow storage e = _escrow[matchId];
        FHE.makePubliclyDecryptable(e.stakeOk[0]);
        FHE.makePubliclyDecryptable(e.stakeOk[1]);
        emit RevealRequested(matchId, handles);
    }

    /// @notice Stores the plaintext loadouts after checking the KMS decryption proof.
    /// @dev Anyone can submit it: the proof binds the values to the handles, so a wrong value reverts.
    /// @param matchId The match.
    /// @param abiEncodedClearValues ABI-encoded clear values, one per handle, in `revealHandles` order.
    /// @param decryptionProof KMS signatures from the relayer's public decryption.
    function finalizeReveal(bytes32 matchId, bytes calldata abiEncodedClearValues, bytes calldata decryptionProof) external {
        MatchInfo storage m = _requireMatch(matchId);
        if (m.status != Status.Revealing) revert WrongStatus(m.status);
        FHE.checkSignatures(revealHandles(matchId), abiEncodedClearValues, decryptionProof);

        // 21 static words (18 loadout values, the seed, both stake flags): the layout of uint256[21].
        uint256[21] memory clear = abi.decode(abiEncodedClearValues, (uint256[21]));
        m.status = Status.Revealed;
        for (uint8 side = 0; side < 2; side++) {
            RevealedLoadout storage r = _revealed[matchId][side];
            uint256 base = uint256(side) * VALUES_PER_SIDE;
            for (uint256 i = 0; i < SLOTS; i++) {
                r.agents[i] = uint8(clear[base + i]);
                r.skills[i] = uint8(clear[base + SLOTS + i]);
                r.tiers[i] = uint8(clear[base + 2 * SLOTS + i]);
            }
            emit LoadoutRevealed(matchId, side, r.agents, r.skills, r.tiers);
        }
        Randomness storage rnd = _random[matchId];
        rnd.clearSeed = uint64(clear[2 * VALUES_PER_SIDE]);
        rnd.startedAt = uint64(block.timestamp);
        emit SeedRevealed(matchId, rnd.clearSeed, rnd.startedAt);
        _onRevealed(matchId, clear[2 * VALUES_PER_SIDE + 1] != 0, clear[2 * VALUES_PER_SIDE + 2] != 0);
    }

    /// @notice Opens supply drop `slot` for public decryption. Anyone can call it once the drop is
    ///         due (`dropDueAt`) and every earlier slot is revealed.
    /// @param matchId The match.
    /// @param slot Drop slot, 0 to DROP_SLOTS - 1, in order.
    function revealDrop(bytes32 matchId, uint8 slot) external {
        MatchInfo storage m = _requireMatch(matchId);
        if (m.status != Status.Revealed) revert WrongStatus(m.status);
        if (slot >= DROP_SLOTS) revert InvalidDrop(slot);
        Randomness storage rnd = _random[matchId];
        // In order: the previous slot must be revealed (not only requested) before this one opens.
        if (slot != rnd.dropsRequested || rnd.dropsRequested != rnd.dropsRevealed) revert DropOutOfOrder(slot, rnd.dropsRevealed);
        uint64 dueAt = _dropDueAt(rnd, slot);
        if (block.timestamp < dueAt) revert DropNotDue(slot, dueAt);
        rnd.dropsRequested = slot + 1;
        FHE.makePubliclyDecryptable(rnd.drops[slot]);
        emit DropRevealRequested(matchId, slot, euint16.unwrap(rnd.drops[slot]));
    }

    /// @notice Stores drop `slot`'s plaintext after checking the KMS decryption proof. Anyone can
    ///         submit it: a value that does not match the handle reverts.
    /// @param matchId The match.
    /// @param slot The drop slot `revealDrop` opened last.
    /// @param abiEncodedClearValue ABI-encoded clear value (one uint256 word).
    /// @param decryptionProof KMS signatures from the relayer's public decryption.
    function finalizeDrop(bytes32 matchId, uint8 slot, bytes calldata abiEncodedClearValue, bytes calldata decryptionProof) external {
        _requireMatch(matchId);
        if (slot >= DROP_SLOTS) revert InvalidDrop(slot);
        Randomness storage rnd = _random[matchId];
        if (slot != rnd.dropsRevealed || slot >= rnd.dropsRequested) revert DropOutOfOrder(slot, rnd.dropsRevealed);
        bytes32[] memory handles = new bytes32[](1);
        handles[0] = euint16.unwrap(rnd.drops[slot]);
        FHE.checkSignatures(handles, abiEncodedClearValue, decryptionProof);
        uint16 value = uint16(abi.decode(abiEncodedClearValue, (uint256)));
        rnd.clearDrops[slot] = value;
        rnd.dropsRevealed = slot + 1;
        emit DropRevealed(matchId, slot, value);
    }

    /// @notice Settles a match whose lock deadline passed before both sides sealed.
    /// @dev One side sealed: it wins by forfeit. Neither: the match is cancelled.
    /// @param matchId The match.
    function forfeit(bytes32 matchId) external {
        MatchInfo storage m = _requireMatch(matchId);
        if (m.status != Status.Open) revert WrongStatus(m.status);
        if (block.timestamp <= m.lockDeadline) revert LockStillOpen(m.lockDeadline);
        if (m.locked[0] || m.locked[1]) {
            uint8 winner = m.locked[0] ? 0 : 1;
            m.status = Status.Forfeited;
            m.winner = winner;
            emit MatchForfeited(matchId, winner);
        } else {
            m.status = Status.Cancelled;
            emit MatchCancelled(matchId);
        }
        _onForfeited(matchId);
    }

    /// @notice Posts a revealed match's result: anchors the final log hash on chain and pays out
    ///         the escrow. Only the operator (the game server) can call it, once.
    /// @dev Staked match, win: the winner gets its stake plus the matched pot from the loser, minus
    ///      the fee (`feeBps` of both matched stakes) which goes to the treasury; the loser gets its
    ///      unmatched excess back. Draw: both stakes go back. A side whose stake was not ok makes the
    ///      matched pot 0, so either result refunds both. Every amount stays encrypted.
    /// @param matchId The match.
    /// @param winnerSeat 0 or 1, or NO_SIDE for a draw.
    /// @param logHash Head of the match's hash-chained log (nonzero).
    function settle(bytes32 matchId, uint8 winnerSeat, bytes32 logHash) external {
        if (msg.sender != operator) revert NotOperator(msg.sender);
        MatchInfo storage m = _requireMatch(matchId);
        if (m.status != Status.Revealed) revert WrongStatus(m.status);
        if (winnerSeat > 1 && winnerSeat != NO_SIDE) revert InvalidWinner(winnerSeat);
        if (logHash == bytes32(0)) revert InvalidLogHash();

        m.status = Status.Settled;
        m.winner = winnerSeat;
        _settlement[matchId] = Settlement({logHash: logHash, winner: winnerSeat, settledAt: uint64(block.timestamp)});
        emit MatchSettled(matchId, winnerSeat, logHash);
        _payOut(matchId, winnerSeat);
    }

    /// @notice Refunds both stakes of a locked match nobody settled within SETTLE_TIMEOUT after its
    ///         lock deadline (the server went away, or the reveal never finished). Anyone can call it.
    /// @param matchId The match.
    function refundUnsettled(bytes32 matchId) external {
        MatchInfo storage m = _requireMatch(matchId);
        if (m.status != Status.Locked && m.status != Status.Revealing && m.status != Status.Revealed) revert WrongStatus(m.status);
        uint64 refundableAt = m.lockDeadline + SETTLE_TIMEOUT;
        if (block.timestamp <= refundableAt) revert SettleStillOpen(refundableAt);
        m.status = Status.Cancelled;
        emit MatchCancelled(matchId);
        _payOut(matchId, NO_SIDE);
    }

    /// @notice A match's escrow: public terms, encrypted handles and the verified flags.
    /// @return minStake Minimum stake per side (0: unstaked).
    /// @return matchFeeBps Fee on the matched pot.
    /// @return staked Each side's transferred stake (handles; the side's player can decrypt its own).
    /// @return stakeOk Each side's encrypted flag (public from `reveal` on).
    /// @return matched The matched pot per side (handle; only this contract holds access).
    /// @return paid Each side's payout (handles; zero until paid).
    /// @return stakeOkClear The verified flags (false before `finalizeReveal`).
    function escrow(bytes32 matchId)
        external
        view
        returns (
            uint64 minStake,
            uint16 matchFeeBps,
            bytes32[2] memory staked,
            bytes32[2] memory stakeOk,
            bytes32 matched,
            bytes32[2] memory paid,
            bool[2] memory stakeOkClear
        )
    {
        Escrow storage e = _escrow[matchId];
        for (uint256 i = 0; i < 2; i++) {
            staked[i] = euint64.unwrap(e.staked[i]);
            stakeOk[i] = ebool.unwrap(e.stakeOk[i]);
            paid[i] = euint64.unwrap(e.paid[i]);
        }
        return (e.minStake, e.feeBps, staked, stakeOk, euint64.unwrap(e.matched), paid, e.stakeOkClear);
    }

    /// @notice The posted result and anchored log hash (all zero before `settle`).
    function settlement(bytes32 matchId) external view returns (Settlement memory) {
        return _settlement[matchId];
    }

    /// @notice The public match header (status None for an unknown id).
    function getMatch(bytes32 matchId) external view returns (MatchInfo memory) {
        return _matches[matchId];
    }

    /// @notice One side's sealed handles: agents, then skills, then tiers (zero before it seals).
    /// @dev Handles are public; reading the values needs ACL access (the player, or anyone after reveal).
    function sealedLoadout(bytes32 matchId, uint8 side) external view returns (bytes32[9] memory handles) {
        if (side > 1) revert InvalidSide(side);
        SealedLoadout storage l = _sealed[matchId][side];
        for (uint256 i = 0; i < SLOTS; i++) {
            handles[i] = euint8.unwrap(l.agents[i]);
            handles[SLOTS + i] = euint8.unwrap(l.skills[i]);
            handles[2 * SLOTS + i] = euint8.unwrap(l.tiers[i]);
        }
    }

    /// @notice One side's revealed plaintexts (all zero before `finalizeReveal`).
    function revealedLoadout(bytes32 matchId, uint8 side) external view returns (RevealedLoadout memory) {
        if (side > 1) revert InvalidSide(side);
        return _revealed[matchId][side];
    }

    /// @notice The match's randomness: encrypted handles, the plaintexts opened so far, the drop clock.
    /// @return seedHandle The FHE seed (zero before both sides sealed).
    /// @return dropHandles The FHE drop values, per slot.
    /// @return seed The verified seed (0 before `finalizeReveal`).
    /// @return drops The verified drop values (0 for a slot not revealed yet).
    /// @return startedAt When the reveal was finalized (0 before).
    /// @return dropsRequested Drop slots opened for decryption so far.
    /// @return dropsRevealed Drop slots whose plaintext is stored so far.
    function randomness(bytes32 matchId)
        external
        view
        returns (
            bytes32 seedHandle,
            bytes32[3] memory dropHandles,
            uint64 seed,
            uint16[3] memory drops,
            uint64 startedAt,
            uint8 dropsRequested,
            uint8 dropsRevealed
        )
    {
        Randomness storage rnd = _random[matchId];
        seedHandle = euint64.unwrap(rnd.seed);
        for (uint256 i = 0; i < DROP_SLOTS; i++) dropHandles[i] = euint16.unwrap(rnd.drops[i]);
        return (seedHandle, dropHandles, rnd.clearSeed, rnd.clearDrops, rnd.startedAt, rnd.dropsRequested, rnd.dropsRevealed);
    }

    /// @notice When drop `slot` may be opened (0 while the reveal is not finalized).
    function dropDueAt(bytes32 matchId, uint8 slot) external view returns (uint64) {
        if (slot >= DROP_SLOTS) revert InvalidDrop(slot);
        return _dropDueAt(_random[matchId], slot);
    }

    /// @notice Every handle `reveal` opens, in the order `finalizeReveal` expects the clear values:
    ///         side 0 then side 1, each agents[0..2], skills[0..2], tiers[0..2]; then the match seed;
    ///         then side 0's and side 1's "stake ok" flag.
    function revealHandles(bytes32 matchId) public view returns (bytes32[] memory handles) {
        uint256 n = 2 * uint256(VALUES_PER_SIDE);
        handles = new bytes32[](n + 3);
        for (uint8 side = 0; side < 2; side++) {
            SealedLoadout storage l = _sealed[matchId][side];
            uint256 base = uint256(side) * VALUES_PER_SIDE;
            for (uint256 i = 0; i < SLOTS; i++) {
                handles[base + i] = euint8.unwrap(l.agents[i]);
                handles[base + SLOTS + i] = euint8.unwrap(l.skills[i]);
                handles[base + 2 * SLOTS + i] = euint8.unwrap(l.tiers[i]);
            }
        }
        handles[n] = euint64.unwrap(_random[matchId].seed);
        Escrow storage e = _escrow[matchId];
        handles[n + 1] = ebool.unwrap(e.stakeOk[0]);
        handles[n + 2] = ebool.unwrap(e.stakeOk[1]);
    }

    // ---------------------------------------------------------------- internals and hooks

    function _requireMatch(bytes32 matchId) internal view returns (MatchInfo storage m) {
        m = _matches[matchId];
        if (m.status == Status.None) revert UnknownMatch(matchId);
    }

    /// @dev Grants the contract and the submitting player access to a freshly verified input.
    function _seal(euint8 value) private returns (euint8) {
        FHE.allowThis(value);
        FHE.allow(value, msg.sender);
        return value;
    }

    /// @dev Draws the seed and the drop values once both commitments are in. Only this contract gets
    ///      ACL access: no player, server or deployer can decrypt them before `reveal`/`revealDrop`.
    function _drawRandomness(bytes32 matchId) private {
        Randomness storage rnd = _random[matchId];
        rnd.seed = FHE.randEuint64();
        FHE.allowThis(rnd.seed);
        bytes32[3] memory dropHandles;
        for (uint256 i = 0; i < DROP_SLOTS; i++) {
            rnd.drops[i] = FHE.randEuint16();
            FHE.allowThis(rnd.drops[i]);
            dropHandles[i] = euint16.unwrap(rnd.drops[i]);
        }
        emit RandomnessDrawn(matchId, euint64.unwrap(rnd.seed), dropHandles);
    }

    function _dropDueAt(Randomness storage rnd, uint8 slot) private view returns (uint64) {
        if (rnd.startedAt == 0) return 0;
        return rnd.startedAt + uint64(slot + 1) * DROP_INTERVAL;
    }

    /// @dev Splits `pot` into the treasury fee: `pot * bps / 10_000`, computed as
    ///      `(pot / 10_000) * bps + (pot % 10_000) * bps / 10_000` so it cannot overflow 64 bits.
    function _fee(euint64 pot, uint16 bps) private returns (euint64) {
        euint64 whole = FHE.mul(FHE.div(pot, 10_000), uint64(bps));
        euint64 part = FHE.div(FHE.mul(FHE.rem(pot, 10_000), uint64(bps)), 10_000);
        return FHE.add(whole, part);
    }

    /// @dev Confidential transfer of `amount` out of escrow to `side`'s player, recorded as its payout.
    function _pay(bytes32 matchId, uint8 side, euint64 amount) private {
        address to = _matches[matchId].players[side];
        FHE.allowTransient(amount, address(credits));
        euint64 sent = credits.confidentialTransfer(to, amount);
        _escrow[matchId].paid[side] = sent;
        emit StakePaid(matchId, side, to, euint64.unwrap(sent));
    }

    /// @dev Pays a locked match out: `winner` takes the matched pot (minus the fee), NO_SIDE refunds both.
    function _payOut(bytes32 matchId, uint8 winner) private {
        Escrow storage e = _escrow[matchId];
        if (e.minStake == 0) return;
        if (winner == NO_SIDE) {
            _pay(matchId, 0, e.staked[0]);
            _pay(matchId, 1, e.staked[1]);
            return;
        }
        uint8 loser = 1 - winner;
        euint64 winnings = e.matched;
        address to = treasury;
        if (e.feeBps != 0 && to != address(0)) {
            euint64 fee = _fee(FHE.add(e.matched, e.matched), e.feeBps);
            winnings = FHE.sub(winnings, fee);
            FHE.allowTransient(fee, address(credits));
            credits.confidentialTransfer(to, fee);
        }
        _pay(matchId, winner, FHE.add(e.staked[winner], winnings));
        _pay(matchId, loser, FHE.sub(e.staked[loser], e.matched));
    }

    /// @dev Hook: a match was created. Records the stake terms.
    function _onCreated(bytes32 matchId, uint64 minStake) internal virtual {
        Escrow storage e = _escrow[matchId];
        e.minStake = minStake;
        e.feeBps = feeBps;
    }

    /// @dev Hook: `side` sealed its loadout. Pulls its stake into escrow and derives the encrypted
    ///      "stake ok" flag from the amount actually transferred. Unstaked match: nothing moves and
    ///      the flag is `stake >= 0` (always true; computed rather than a trivial constant so each
    ///      side's flag is a distinct handle for the batch public decryption).
    function _onSealed(bytes32 matchId, uint8 side, externalEuint64 stake, bytes calldata inputProof) internal virtual {
        Escrow storage e = _escrow[matchId];
        euint64 amount = FHE.fromExternal(stake, inputProof);
        ebool ok;
        if (e.minStake == 0) {
            ok = FHE.ge(amount, 0);
        } else {
            FHE.allowTransient(amount, address(credits));
            // Reverts only without operator approval (public anyway); a short balance moves 0.
            euint64 transferred = credits.confidentialTransferFrom(msg.sender, address(this), amount);
            FHE.allowThis(transferred);
            FHE.allow(transferred, msg.sender);
            e.staked[side] = transferred;
            ok = FHE.ge(transferred, e.minStake);
            emit StakeLocked(matchId, side, msg.sender, euint64.unwrap(transferred));
        }
        FHE.allowThis(ok);
        FHE.allow(ok, msg.sender);
        e.stakeOk[side] = ok;
    }

    /// @dev Hook: both sides sealed; the FHE seed and drop values are already drawn (`randomness`).
    ///      Matches the pot: a side whose stake is not ok counts as 0, so the pot is 0.
    function _onBothLocked(bytes32 matchId) internal virtual {
        Escrow storage e = _escrow[matchId];
        if (e.minStake == 0) return;
        euint64 zero = FHE.asEuint64(0);
        euint64 valid0 = FHE.select(e.stakeOk[0], e.staked[0], zero);
        euint64 valid1 = FHE.select(e.stakeOk[1], e.staked[1], zero);
        e.matched = FHE.min(valid0, valid1);
        FHE.allowThis(e.matched);
    }

    /// @dev Hook: plaintext loadouts are stored, with the verified "stake ok" flags.
    function _onRevealed(bytes32 matchId, bool ok0, bool ok1) internal virtual {
        Escrow storage e = _escrow[matchId];
        e.stakeOkClear = [ok0, ok1];
        emit StakeChecked(matchId, 0, ok0);
        emit StakeChecked(matchId, 1, ok1);
    }

    /// @dev Hook: the match was forfeited or cancelled at the lock deadline. The side that sealed
    ///      takes the pot, which only holds its own stake: it gets it back.
    function _onForfeited(bytes32 matchId) internal virtual {
        MatchInfo storage m = _matches[matchId];
        if (_escrow[matchId].minStake == 0 || m.status != Status.Forfeited) return;
        _pay(matchId, m.winner, _escrow[matchId].staked[m.winner]);
    }
}
