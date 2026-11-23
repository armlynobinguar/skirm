// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {FHE, ebool, euint8, externalEuint8} from "@fhevm/solidity/lib/FHE.sol";
import {ZamaEthereumConfig} from "@fhevm/solidity/config/ZamaConfig.sol";

/// @title FogSkirm
/// @notice A short two-player skirm mode played entirely on chain, where the hidden information is
///         enforced by FHE. Each player runs one scout on a 5x5 grid: find the hidden seed vial in
///         the middle row and carry it back to your home row, while avoiding the flood switches
///         (traps) your rival planted in secret. Scout positions, traps, moves and the vial stay
///         ciphertexts for the whole game; each round only three aggregate facts become public
///         ("someone hit a trap", "the vial is carried", "winner"), and each player privately reads
///         a "sense" ping (how far the rival and the vial are) through the ACL. At the end every
///         hidden value is opened for public decryption so anyone can replay and verify the game.
/// @dev Board: tile = row * 5 + col. Side 0 starts at (0, 2) with home row 0, side 1 at (4, 2) with
///      home row 4. The vial sits on (2, vialCol), vialCol = FHE.randEuint8() mod 5, drawn when the
///      second player joins (after both sets of traps are committed); nobody holds ACL access to it.
///      Traps: side 0 plants in tiles 10..19 (rows 2-3, the rival's half), side 1 in tiles 5..14
///      (rows 1-2). A trap outside its band is made inert (NO_TILE) under FHE, without revealing it.
///      Moves: encrypted direction, 0 stay, 1 north (row - 1), 2 east (col + 1), 3 south (row + 1),
///      4 west (col - 1). Off the board or any other code means the scout stays (FHE.select).
///      Round resolution, in order, for both scouts at once:
///        1. move;
///        2. trap: landing on a live rival trap sends the scout home, spends the trap and drops the
///           vial if carried (it returns to its tile);
///        3. tag: two scouts on one tile knock the vial loose (it returns to its tile);
///        4. pickup: a scout alone on the vial tile while nobody carries it picks it up;
///        5. delivery: the carrier on its home row wins.
///      After MAX_ROUNDS without a delivery the game is a draw. packages/shared/src/fog-skirm.ts
///      mirrors these rules in TypeScript (UI prediction and replay verification).
///      Public decryption uses the current FHEVM flow: `FHE.makePubliclyDecryptable`, relayer
///      `publicDecrypt` off chain, `FHE.checkSignatures` on chain.
contract FogSkirm is ZamaEthereumConfig {
    /// @notice Board side length and tile count.
    uint8 public constant SIZE = 5;
    uint8 public constant TILES = 25;
    /// @notice Rounds before the game ends in a draw.
    uint8 public constant MAX_ROUNDS = 10;
    /// @notice Traps each player plants.
    uint8 public constant TRAPS = 2;
    /// @notice A spent or invalid trap: never equals a tile.
    uint8 public constant NO_TILE = 255;
    /// @notice The vial row (middle of the board).
    uint8 public constant VIAL_ROW = 2;
    /// @notice Column both scouts start on (in their home row).
    uint8 public constant START_COL = 2;
    /// @notice Shortest and longest time a player gets per move.
    uint64 public constant MIN_MOVE_WINDOW = 1 minutes;
    uint64 public constant MAX_MOVE_WINDOW = 1 days;

    /// @notice Sense bands: the rival or the vial is on or next to your tile (distance <= 1), near
    ///         (distance 2-3) or far (4+), by Manhattan distance.
    uint8 public constant SENSE_ADJACENT = 0;
    uint8 public constant SENSE_NEAR = 1;
    uint8 public constant SENSE_FAR = 2;

    /// @notice Lifecycle. None → Waiting (seat 1 open) → Playing → Ended, or Waiting → Cancelled.
    enum Status {
        None,
        Waiting,
        Playing,
        Ended,
        Cancelled
    }

    /// @notice Why a game ended.
    enum EndReason {
        None,
        Delivered,
        MaxRounds,
        Timeout
    }

    /// @notice Public game header.
    /// @param players Side 0 (creator) and side 1; address(0) is an open seat any account can join.
    /// @param status Lifecycle step.
    /// @param round Current round, 1-based, while playing; the last round played once ended.
    /// @param roundsPlayed Rounds resolved and finalized.
    /// @param awaitingReveal Both moves are in and resolved; the outcome waits for `finalizeRound`.
    /// @param moved Whether each side has submitted its move this round.
    /// @param moveWindow Seconds each side gets per move (also to join before `cancelGame`).
    /// @param deadline When the current round's moves are due; after it, `claimTimeout`.
    /// @param winner 0 draw / none, 1 side 0, 2 side 1 (public once ended).
    /// @param endReason How it ended.
    /// @param revealed Whether the full board was revealed and verified (`finalizeGameReveal`).
    struct Game {
        address[2] players;
        Status status;
        uint8 round;
        uint8 roundsPlayed;
        bool awaitingReveal;
        bool[2] moved;
        uint64 moveWindow;
        uint64 deadline;
        uint8 winner;
        EndReason endReason;
        bool revealed;
    }

    /// @notice The encrypted board.
    struct Board {
        euint8[2] row;
        euint8[2] col;
        euint8[2] tile;
        ebool[2] carrying;
        // [owner][k]: traps planted by `owner`, which only the rival can hit.
        euint8[2][2] trapsPlaced;
        euint8[2][2] trapsLive;
        euint8 vialCol;
        euint8 vialTile;
        // [round - 1][side]: every move, for the end-of-game replay.
        euint8[2][10] moves;
    }

    /// @notice What each player privately learns after a round (latest round only).
    struct Senses {
        ebool[2] hit;
        euint8[2] vial;
        euint8 rival;
    }

    /// @notice The pending round outcome (public decryption handles).
    struct PendingOutcome {
        ebool trapHit;
        ebool vialTaken;
        euint8 winner;
    }

    /// @notice A finalized round, public.
    struct RoundOutcome {
        bool trapHit;
        bool vialTaken;
        uint8 winner;
    }

    /// @notice The revealed game, after `finalizeGameReveal` (KMS-verified plaintexts).
    struct Replay {
        uint8[2][2] traps;
        uint8 vialCol;
        uint8[2] finalTiles;
        uint8[2][] moves;
    }

    /// @notice Handles a player user-decrypts for its own view of the board.
    struct PlayerView {
        bytes32 tile;
        bytes32 carrying;
        bytes32 hit;
        bytes32 senseVial;
        bytes32 senseRival;
        bytes32[2] trapsPlaced;
        bytes32[2] trapsLive;
    }

    uint256 public nextGameId = 1;

    mapping(uint256 => Game) private _games;
    mapping(uint256 => Board) private _boards;
    mapping(uint256 => Senses) private _senses;
    mapping(uint256 => PendingOutcome) private _pending;
    mapping(uint256 => mapping(uint8 => RoundOutcome)) private _outcomes;
    mapping(uint256 => Replay) private _replays;

    event GameCreated(uint256 indexed gameId, address indexed creator, address opponent, uint64 moveWindow);
    event GameJoined(uint256 indexed gameId, address indexed player, bytes32 vialHandle);
    event GameCancelled(uint256 indexed gameId);
    event MoveSubmitted(uint256 indexed gameId, uint8 indexed round, uint8 side);
    /// @notice Both moves are in and resolved under FHE; `handles` (trapHit, vialTaken, winner) are publicly decryptable.
    event RoundResolved(uint256 indexed gameId, uint8 indexed round, bytes32[3] handles);
    /// @notice The KMS-verified public outcome of a round.
    event RoundRevealed(uint256 indexed gameId, uint8 indexed round, bool trapHit, bool vialTaken, uint8 winner);
    event GameEnded(uint256 indexed gameId, uint8 winner, EndReason reason, uint8 roundsPlayed);
    /// @notice Every hidden value of the game is publicly decryptable now (`revealHandles`).
    event GameRevealRequested(uint256 indexed gameId, bytes32[] handles);
    event GameRevealed(uint256 indexed gameId, uint8[2][2] traps, uint8 vialCol, uint8[2] finalTiles, uint8[2][] moves);

    error UnknownGame(uint256 gameId);
    error WrongStatus(Status status);
    error InvalidMoveWindow(uint64 moveWindow);
    error InvalidOpponent(address opponent);
    error NotPlayer(address account);
    error NotYourTurn();
    error AlreadyMoved(uint8 side);
    error NotAwaitingReveal();
    error DeadlineNotReached(uint64 deadline);
    error AlreadyRevealed();

    // ------------------------------------------------------------------ lobby

    /// @notice Creates a game and plants the creator's two traps (side 0).
    /// @param opponent The only account that may join, or address(0) for an open seat.
    /// @param moveWindow Seconds per move, MIN_MOVE_WINDOW to MAX_MOVE_WINDOW.
    /// @param trap0 First trap tile (encrypted; tiles 10..19 count, anything else is inert).
    /// @param trap1 Second trap tile.
    /// @param inputProof Proof for both traps, created for this contract and the caller.
    /// @return gameId The new game's id.
    function createGame(
        address opponent,
        uint64 moveWindow,
        externalEuint8 trap0,
        externalEuint8 trap1,
        bytes calldata inputProof
    ) external returns (uint256 gameId) {
        if (moveWindow < MIN_MOVE_WINDOW || moveWindow > MAX_MOVE_WINDOW) revert InvalidMoveWindow(moveWindow);
        if (opponent == msg.sender) revert InvalidOpponent(opponent);
        gameId = nextGameId++;
        Game storage g = _games[gameId];
        g.players[0] = msg.sender;
        g.players[1] = opponent;
        g.status = Status.Waiting;
        g.moveWindow = moveWindow;
        _plantTraps(gameId, 0, trap0, trap1, inputProof);
        emit GameCreated(gameId, msg.sender, opponent, moveWindow);
    }

    /// @notice Takes seat 1, plants the joiner's traps (tiles 5..14 count), draws the hidden vial
    ///         and starts round 1.
    function joinGame(uint256 gameId, externalEuint8 trap0, externalEuint8 trap1, bytes calldata inputProof) external {
        Game storage g = _requireGame(gameId);
        if (g.status != Status.Waiting) revert WrongStatus(g.status);
        address seat = g.players[1];
        if (msg.sender == g.players[0] || (seat != address(0) && seat != msg.sender)) revert NotPlayer(msg.sender);
        g.players[1] = msg.sender;
        _plantTraps(gameId, 1, trap0, trap1, inputProof);

        Board storage b = _boards[gameId];
        // Both trap sets are committed before the vial exists, so nobody can plant on a known vial.
        // randEuint8 mod 5: column 0 is drawn with probability 52/256, the others 51/256.
        b.vialCol = FHE.rem(FHE.randEuint8(), SIZE);
        b.vialTile = FHE.add(b.vialCol, VIAL_ROW * SIZE);
        FHE.allowThis(b.vialCol);
        FHE.allowThis(b.vialTile);

        for (uint8 side = 0; side < 2; side++) {
            uint8 homeRow = _homeRow(side);
            b.row[side] = FHE.asEuint8(homeRow);
            b.col[side] = FHE.asEuint8(START_COL);
            b.tile[side] = FHE.asEuint8(homeRow * SIZE + START_COL);
            b.carrying[side] = FHE.asEbool(false);
            _senses[gameId].hit[side] = FHE.asEbool(false);
            _keep(gameId, side);
        }
        _sense(gameId);

        g.status = Status.Playing;
        g.round = 1;
        g.deadline = uint64(block.timestamp) + g.moveWindow;
        emit GameJoined(gameId, msg.sender, euint8.unwrap(b.vialCol));
    }

    /// @notice The creator calls off a game nobody joined yet.
    function cancelGame(uint256 gameId) external {
        Game storage g = _requireGame(gameId);
        if (g.status != Status.Waiting) revert WrongStatus(g.status);
        if (msg.sender != g.players[0]) revert NotPlayer(msg.sender);
        g.status = Status.Cancelled;
        emit GameCancelled(gameId);
    }

    // ------------------------------------------------------------------ rounds

    /// @notice Submits this round's encrypted move (0 stay, 1 N, 2 E, 3 S, 4 W). The second move
    ///         of a round resolves it under FHE and opens the public outcome for decryption.
    function submitMove(uint256 gameId, externalEuint8 direction, bytes calldata inputProof) external {
        Game storage g = _requireGame(gameId);
        if (g.status != Status.Playing || g.awaitingReveal) revert NotYourTurn();
        uint8 side = _sideOf(g, msg.sender);
        if (g.moved[side]) revert AlreadyMoved(side);
        euint8 move = FHE.fromExternal(direction, inputProof);
        FHE.allowThis(move);
        FHE.allow(move, msg.sender);
        _boards[gameId].moves[g.round - 1][side] = move;
        g.moved[side] = true;
        emit MoveSubmitted(gameId, g.round, side);
        if (g.moved[0] && g.moved[1]) _resolve(gameId, g);
    }

    /// @notice Stores a resolved round's public outcome after checking the KMS proof, then starts
    ///         the next round or ends the game. Anyone can submit it; forged values revert.
    /// @param abiEncodedClearValues The three clear values in `roundHandles` order (trapHit, vialTaken, winner).
    /// @param decryptionProof KMS signatures from the relayer's public decryption.
    function finalizeRound(uint256 gameId, bytes calldata abiEncodedClearValues, bytes calldata decryptionProof) external {
        Game storage g = _requireGame(gameId);
        if (g.status != Status.Playing || !g.awaitingReveal) revert NotAwaitingReveal();
        FHE.checkSignatures(_roundHandleList(gameId), abiEncodedClearValues, decryptionProof);
        uint256[3] memory clear = abi.decode(abiEncodedClearValues, (uint256[3]));
        RoundOutcome memory o = RoundOutcome(clear[0] != 0, clear[1] != 0, uint8(clear[2]));
        uint8 round = g.round;
        _outcomes[gameId][round] = o;
        g.roundsPlayed = round;
        g.awaitingReveal = false;
        emit RoundRevealed(gameId, round, o.trapHit, o.vialTaken, o.winner);

        if (o.winner != 0) {
            _end(gameId, g, o.winner, EndReason.Delivered);
        } else if (round == MAX_ROUNDS) {
            _end(gameId, g, 0, EndReason.MaxRounds);
        } else {
            g.round = round + 1;
            g.moved = [false, false];
            g.deadline = uint64(block.timestamp) + g.moveWindow;
        }
    }

    /// @notice After the move deadline: the only side that moved wins; if neither moved, a draw.
    ///         Not while a resolved round waits for `finalizeRound` (anyone can send that).
    function claimTimeout(uint256 gameId) external {
        Game storage g = _requireGame(gameId);
        if (g.status != Status.Playing || g.awaitingReveal) revert WrongStatus(g.status);
        if (block.timestamp <= g.deadline) revert DeadlineNotReached(g.deadline);
        uint8 winner = g.moved[0] ? 1 : g.moved[1] ? 2 : 0;
        _end(gameId, g, winner, EndReason.Timeout);
    }

    /// @notice Stores the revealed board after checking the KMS proof: the traps as planted, the
    ///         vial column, both final tiles and every move of every finalized round.
    /// @param abiEncodedClearValues One word per `revealHandles` entry.
    function finalizeGameReveal(uint256 gameId, bytes calldata abiEncodedClearValues, bytes calldata decryptionProof) external {
        Game storage g = _requireGame(gameId);
        if (g.status != Status.Ended) revert WrongStatus(g.status);
        if (g.revealed) revert AlreadyRevealed();
        bytes32[] memory handles = revealHandles(gameId);
        FHE.checkSignatures(handles, abiEncodedClearValues, decryptionProof);
        g.revealed = true;

        Replay storage r = _replays[gameId];
        for (uint8 owner = 0; owner < 2; owner++) {
            r.traps[owner][0] = _word(abiEncodedClearValues, owner * 2);
            r.traps[owner][1] = _word(abiEncodedClearValues, owner * 2 + 1);
        }
        r.vialCol = _word(abiEncodedClearValues, 4);
        r.finalTiles = [_word(abiEncodedClearValues, 5), _word(abiEncodedClearValues, 6)];
        for (uint8 i = 0; i < g.roundsPlayed; i++) {
            r.moves.push([_word(abiEncodedClearValues, 7 + 2 * uint256(i)), _word(abiEncodedClearValues, 8 + 2 * uint256(i))]);
        }
        emit GameRevealed(gameId, r.traps, r.vialCol, r.finalTiles, r.moves);
    }

    // ------------------------------------------------------------------ views

    function getGame(uint256 gameId) external view returns (Game memory) {
        return _games[gameId];
    }

    /// @notice The handles side `side` can user-decrypt: its scout, its senses and its traps.
    function playerView(uint256 gameId, uint8 side) external view returns (PlayerView memory v) {
        Board storage b = _boards[gameId];
        Senses storage s = _senses[gameId];
        v.tile = euint8.unwrap(b.tile[side]);
        v.carrying = ebool.unwrap(b.carrying[side]);
        v.hit = ebool.unwrap(s.hit[side]);
        v.senseVial = euint8.unwrap(s.vial[side]);
        v.senseRival = euint8.unwrap(s.rival);
        for (uint8 k = 0; k < TRAPS; k++) {
            v.trapsPlaced[k] = euint8.unwrap(b.trapsPlaced[side][k]);
            v.trapsLive[k] = euint8.unwrap(b.trapsLive[side][k]);
        }
    }

    /// @notice The pending round outcome handles (trapHit, vialTaken, winner), publicly decryptable
    ///         while `awaitingReveal`.
    function roundHandles(uint256 gameId) external view returns (bytes32[3] memory h) {
        PendingOutcome storage p = _pending[gameId];
        h = [ebool.unwrap(p.trapHit), ebool.unwrap(p.vialTaken), euint8.unwrap(p.winner)];
    }

    /// @notice A finalized round's public outcome (round 1-based).
    function outcome(uint256 gameId, uint8 round) external view returns (RoundOutcome memory) {
        return _outcomes[gameId][round];
    }

    /// @notice The handles opened at the end of the game, in this order: side 0's traps, side 1's
    ///         traps, the vial column, both final tiles, then (side 0, side 1) moves per finalized round.
    function revealHandles(uint256 gameId) public view returns (bytes32[] memory handles) {
        Board storage b = _boards[gameId];
        uint8 rounds = _games[gameId].roundsPlayed;
        handles = new bytes32[](7 + 2 * uint256(rounds));
        handles[0] = euint8.unwrap(b.trapsPlaced[0][0]);
        handles[1] = euint8.unwrap(b.trapsPlaced[0][1]);
        handles[2] = euint8.unwrap(b.trapsPlaced[1][0]);
        handles[3] = euint8.unwrap(b.trapsPlaced[1][1]);
        handles[4] = euint8.unwrap(b.vialCol);
        handles[5] = euint8.unwrap(b.tile[0]);
        handles[6] = euint8.unwrap(b.tile[1]);
        for (uint256 i = 0; i < rounds; i++) {
            handles[7 + 2 * i] = euint8.unwrap(b.moves[i][0]);
            handles[8 + 2 * i] = euint8.unwrap(b.moves[i][1]);
        }
    }

    /// @notice The revealed game (empty until `finalizeGameReveal`).
    function replay(uint256 gameId) external view returns (Replay memory) {
        return _replays[gameId];
    }

    // ------------------------------------------------------------------ internals

    function _requireGame(uint256 gameId) private view returns (Game storage g) {
        g = _games[gameId];
        if (g.status == Status.None) revert UnknownGame(gameId);
    }

    function _sideOf(Game storage g, address account) private view returns (uint8) {
        if (account == g.players[0]) return 0;
        if (account == g.players[1]) return 1;
        revert NotPlayer(account);
    }

    function _homeRow(uint8 side) private pure returns (uint8) {
        return side == 0 ? 0 : SIZE - 1;
    }

    /// @dev One 32-byte word of ABI-encoded clear values, as a uint8.
    function _word(bytes calldata data, uint256 i) private pure returns (uint8) {
        return uint8(uint256(bytes32(data[i * 32:(i + 1) * 32])));
    }

    /// @dev Verifies and stores `owner`'s traps; an out-of-band tile becomes NO_TILE (inert).
    function _plantTraps(uint256 gameId, uint8 owner, externalEuint8 t0, externalEuint8 t1, bytes calldata inputProof) private {
        Board storage b = _boards[gameId];
        // Side 0 plants on rows 2-3 (tiles 10..19), side 1 on rows 1-2 (tiles 5..14).
        uint8 lo = owner == 0 ? 10 : 5;
        uint8 hi = owner == 0 ? 19 : 14;
        euint8 none = FHE.asEuint8(NO_TILE);
        euint8[2] memory raw = [FHE.fromExternal(t0, inputProof), FHE.fromExternal(t1, inputProof)];
        for (uint8 k = 0; k < TRAPS; k++) {
            ebool inBand = FHE.and(FHE.ge(raw[k], lo), FHE.le(raw[k], hi));
            euint8 trap = FHE.select(inBand, raw[k], none);
            b.trapsPlaced[owner][k] = trap;
            b.trapsLive[owner][k] = trap;
            FHE.allowThis(trap);
            FHE.allow(trap, msg.sender);
        }
    }

    /// @dev Resolves the round under FHE and opens its aggregate outcome for public decryption.
    function _resolve(uint256 gameId, Game storage g) private {
        Board storage b = _boards[gameId];
        uint8 round = g.round;

        // 1. Move.
        for (uint8 side = 0; side < 2; side++) _move(b, side, b.moves[round - 1][side]);

        // 2. Traps: each scout against the rival's live traps.
        ebool[2] memory hit;
        for (uint8 side = 0; side < 2; side++) hit[side] = _trap(b, side);

        // 3. Tag: sharing a tile knocks the vial loose (only the carrier holds it, so clear both).
        ebool apart = FHE.not(FHE.eq(b.tile[0], b.tile[1]));
        b.carrying[0] = FHE.and(b.carrying[0], apart);
        b.carrying[1] = FHE.and(b.carrying[1], apart);

        // 4. Pickup: alone on the vial tile while it lies free.
        ebool free = FHE.not(FHE.or(b.carrying[0], b.carrying[1]));
        ebool on0 = FHE.eq(b.tile[0], b.vialTile);
        ebool on1 = FHE.eq(b.tile[1], b.vialTile);
        b.carrying[0] = FHE.or(b.carrying[0], FHE.and(free, FHE.and(on0, FHE.not(on1))));
        b.carrying[1] = FHE.or(b.carrying[1], FHE.and(free, FHE.and(on1, FHE.not(on0))));

        // 5. Delivery: the carrier on its home row.
        ebool won0 = FHE.and(b.carrying[0], FHE.eq(b.row[0], _homeRow(0)));
        ebool won1 = FHE.and(b.carrying[1], FHE.eq(b.row[1], _homeRow(1)));

        PendingOutcome storage p = _pending[gameId];
        p.trapHit = FHE.or(hit[0], hit[1]);
        p.vialTaken = FHE.or(b.carrying[0], b.carrying[1]);
        p.winner = FHE.select(won0, FHE.asEuint8(1), FHE.select(won1, FHE.asEuint8(2), FHE.asEuint8(0)));
        FHE.allowThis(p.trapHit);
        FHE.allowThis(p.vialTaken);
        FHE.allowThis(p.winner);
        FHE.makePubliclyDecryptable(p.trapHit);
        FHE.makePubliclyDecryptable(p.vialTaken);
        FHE.makePubliclyDecryptable(p.winner);

        Senses storage s = _senses[gameId];
        for (uint8 side = 0; side < 2; side++) {
            s.hit[side] = hit[side];
            _keep(gameId, side);
        }
        _sense(gameId);

        g.awaitingReveal = true;
        bytes32[3] memory handles = [ebool.unwrap(p.trapHit), ebool.unwrap(p.vialTaken), euint8.unwrap(p.winner)];
        emit RoundResolved(gameId, round, handles);
    }

    /// @dev Applies an encrypted direction; off the board or an unknown code leaves the scout put.
    function _move(Board storage b, uint8 side, euint8 dir) private {
        euint8 r = b.row[side];
        euint8 c = b.col[side];
        euint8 r2 = FHE.select(FHE.and(FHE.eq(dir, 1), FHE.gt(r, 0)), FHE.sub(r, 1), r);
        r2 = FHE.select(FHE.and(FHE.eq(dir, 3), FHE.lt(r, SIZE - 1)), FHE.add(r, 1), r2);
        euint8 c2 = FHE.select(FHE.and(FHE.eq(dir, 2), FHE.lt(c, SIZE - 1)), FHE.add(c, 1), c);
        c2 = FHE.select(FHE.and(FHE.eq(dir, 4), FHE.gt(c, 0)), FHE.sub(c, 1), c2);
        b.row[side] = r2;
        b.col[side] = c2;
        b.tile[side] = FHE.add(FHE.mul(r2, SIZE), c2);
    }

    /// @dev Checks `side`'s scout against the rival's live traps: a hit spends the trap, sends the
    ///      scout home and drops the vial.
    function _trap(Board storage b, uint8 side) private returns (ebool hit) {
        uint8 rival = 1 - side;
        euint8 tile = b.tile[side];
        euint8 none = FHE.asEuint8(NO_TILE);
        ebool e0 = FHE.eq(tile, b.trapsLive[rival][0]);
        ebool e1 = FHE.eq(tile, b.trapsLive[rival][1]);
        hit = FHE.or(e0, e1);
        b.trapsLive[rival][0] = FHE.select(e0, none, b.trapsLive[rival][0]);
        b.trapsLive[rival][1] = FHE.select(e1, none, b.trapsLive[rival][1]);
        uint8 homeRow = _homeRow(side);
        b.row[side] = FHE.select(hit, FHE.asEuint8(homeRow), b.row[side]);
        b.col[side] = FHE.select(hit, FHE.asEuint8(START_COL), b.col[side]);
        b.tile[side] = FHE.select(hit, FHE.asEuint8(homeRow * SIZE + START_COL), tile);
        b.carrying[side] = FHE.and(b.carrying[side], FHE.not(hit));
    }

    /// @dev Computes both players' sense pings: the rival band (shared, symmetric) and each one's
    ///      vial band. Only that player (and this contract) can decrypt them.
    function _sense(uint256 gameId) private {
        Board storage b = _boards[gameId];
        Senses storage s = _senses[gameId];
        address[2] storage players = _games[gameId].players;
        euint8 dr = FHE.sub(FHE.max(b.row[0], b.row[1]), FHE.min(b.row[0], b.row[1]));
        euint8 dc = FHE.sub(FHE.max(b.col[0], b.col[1]), FHE.min(b.col[0], b.col[1]));
        s.rival = _band(FHE.add(dr, dc));
        FHE.allowThis(s.rival);
        FHE.allow(s.rival, players[0]);
        FHE.allow(s.rival, players[1]);
        for (uint8 side = 0; side < 2; side++) {
            euint8 r = b.row[side];
            euint8 c = b.col[side];
            euint8 vr = FHE.sub(FHE.max(r, VIAL_ROW), FHE.min(r, VIAL_ROW));
            euint8 vc = FHE.sub(FHE.max(c, b.vialCol), FHE.min(c, b.vialCol));
            s.vial[side] = _band(FHE.add(vr, vc));
            FHE.allowThis(s.vial[side]);
            FHE.allow(s.vial[side], players[side]);
        }
    }

    /// @dev Distance to band: <= 1 adjacent, <= 3 near, else far.
    function _band(euint8 d) private returns (euint8) {
        return FHE.select(FHE.le(d, 1), FHE.asEuint8(SENSE_ADJACENT), FHE.select(FHE.le(d, 3), FHE.asEuint8(SENSE_NEAR), FHE.asEuint8(SENSE_FAR)));
    }

    /// @dev Grants this contract (for later rounds) and the owning player access to its scout state,
    ///      and the planter access to its live traps.
    function _keep(uint256 gameId, uint8 side) private {
        Board storage b = _boards[gameId];
        address player = _games[gameId].players[side];
        FHE.allowThis(b.row[side]);
        FHE.allowThis(b.col[side]);
        FHE.allowThis(b.tile[side]);
        FHE.allowThis(b.carrying[side]);
        FHE.allow(b.tile[side], player);
        FHE.allow(b.carrying[side], player);
        ebool hit = _senses[gameId].hit[side];
        FHE.allowThis(hit);
        FHE.allow(hit, player);
        for (uint8 k = 0; k < TRAPS; k++) {
            FHE.allowThis(b.trapsLive[side][k]);
            FHE.allow(b.trapsLive[side][k], player);
        }
    }

    function _roundHandleList(uint256 gameId) private view returns (bytes32[] memory h) {
        PendingOutcome storage p = _pending[gameId];
        h = new bytes32[](3);
        h[0] = ebool.unwrap(p.trapHit);
        h[1] = ebool.unwrap(p.vialTaken);
        h[2] = euint8.unwrap(p.winner);
    }

    /// @dev Ends the game and opens every hidden value for public decryption (once a board exists).
    function _end(uint256 gameId, Game storage g, uint8 winner, EndReason reason) private {
        g.status = Status.Ended;
        g.winner = winner;
        g.endReason = reason;
        bytes32[] memory handles = revealHandles(gameId);
        for (uint256 i = 0; i < handles.length; i++) FHE.makePubliclyDecryptable(euint8.wrap(handles[i]));
        emit GameEnded(gameId, winner, reason, g.roundsPlayed);
        emit GameRevealRequested(gameId, handles);
    }
}
