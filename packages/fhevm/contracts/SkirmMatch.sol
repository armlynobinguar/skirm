// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {FHE, euint8, euint16, euint64, externalEuint8} from "@fhevm/solidity/lib/FHE.sol";
import {ZamaEthereumConfig} from "@fhevm/solidity/config/ZamaConfig.sol";

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
///      Extension points: the internal `_on*` hooks are empty here. A later contract layers a
///      cSKIRM stake escrow (taken on seal, paid out on result or forfeit) on top of them without
///      changing this flow.
contract SkirmMatch is ZamaEthereumConfig {
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

    /// @notice Lifecycle of a match.
    /// @dev None → Open → Locked → Revealing → Revealed, or Open → Forfeited / Cancelled after the deadline.
    enum Status {
        None,
        Open,
        Locked,
        Revealing,
        Revealed,
        Forfeited,
        Cancelled
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

    /// @notice The lock deadline passed with no side sealed.
    event MatchCancelled(bytes32 indexed matchId);

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

    /// @notice Creates a match. A seat left as address(0) goes to the first account that seals it.
    /// @dev When a seat is fixed, the creator must be one of the fixed players, so nobody can bind
    ///      two other people to a match id. Both seats open is allowed (the client that gets there
    ///      first creates it; the game server checks each seat's address against the one its player
    ///      declared off chain).
    /// @param matchId Off-chain match id, hashed: keccak256(utf8(matchId)).
    /// @param playerA Side 0 (team A), or address(0) for an open seat.
    /// @param playerB Side 1 (team B), or address(0) for an open seat.
    /// @param lockWindow Seconds from now until the lock deadline.
    function createMatch(bytes32 matchId, address playerA, address playerB, uint64 lockWindow) external {
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
        _onCreated(matchId);
    }

    /// @notice Seals the caller's loadout for `side`. One submission per side, before the deadline.
    /// @dev All nine values share one input proof (created for this contract and the caller).
    ///      Only the caller and this contract get ACL access to the handles.
    /// @param matchId The match.
    /// @param side 0 for team A, 1 for team B.
    /// @param agents Encrypted roster index per slot (0 = empty).
    /// @param skills Encrypted equipped-skill bitmask per slot.
    /// @param tiers Encrypted talk tier per slot.
    /// @param inputProof Proof for the encrypted inputs.
    function submitLoadout(
        bytes32 matchId,
        uint8 side,
        externalEuint8[3] calldata agents,
        externalEuint8[3] calldata skills,
        externalEuint8[3] calldata tiers,
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
        _onSealed(matchId, side);

        if (m.locked[1 - side]) {
            m.status = Status.Locked;
            emit BothLocked(matchId);
            _drawRandomness(matchId);
            _onBothLocked(matchId);
        }
    }

    /// @notice Opens both loadouts and the match seed for public decryption. Anyone can call it once
    ///         both sides sealed.
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

        // 19 static words (18 loadout values, then the seed): the same layout as uint256[19].
        uint256[19] memory clear = abi.decode(abiEncodedClearValues, (uint256[19]));
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
        _onRevealed(matchId);
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
    ///         side 0 then side 1, each agents[0..2], skills[0..2], tiers[0..2]; then the match seed.
    function revealHandles(bytes32 matchId) public view returns (bytes32[] memory handles) {
        handles = new bytes32[](2 * uint256(VALUES_PER_SIDE) + 1);
        for (uint8 side = 0; side < 2; side++) {
            SealedLoadout storage l = _sealed[matchId][side];
            uint256 base = uint256(side) * VALUES_PER_SIDE;
            for (uint256 i = 0; i < SLOTS; i++) {
                handles[base + i] = euint8.unwrap(l.agents[i]);
                handles[base + SLOTS + i] = euint8.unwrap(l.skills[i]);
                handles[base + 2 * SLOTS + i] = euint8.unwrap(l.tiers[i]);
            }
        }
        handles[2 * uint256(VALUES_PER_SIDE)] = euint64.unwrap(_random[matchId].seed);
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

    /// @dev Hook: a match was created (stake escrow can record the stake terms here).
    function _onCreated(bytes32 matchId) internal virtual {}

    /// @dev Hook: `side` sealed its loadout (stake escrow can pull the side's stake here).
    function _onSealed(bytes32 matchId, uint8 side) internal virtual {}

    /// @dev Hook: both sides sealed; the FHE seed and drop values are already drawn (`randomness`).
    function _onBothLocked(bytes32 matchId) internal virtual {}

    /// @dev Hook: plaintext loadouts are stored.
    function _onRevealed(bytes32 matchId) internal virtual {}

    /// @dev Hook: the match was forfeited or cancelled (stake escrow pays out or refunds here).
    function _onForfeited(bytes32 matchId) internal virtual {}
}
