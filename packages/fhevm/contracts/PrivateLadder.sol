// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {FHE, ebool, euint8, euint16} from "@fhevm/solidity/lib/FHE.sol";
import {ZamaEthereumConfig} from "@fhevm/solidity/config/ZamaConfig.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";

/// @notice The slice of SkirmMatch this contract reads: a sealed match's players and its settlement.
interface ISkirmMatchLadder {
    struct MatchInfo {
        address[2] players;
        uint64 lockDeadline;
        uint8 status;
        bool[2] locked;
        uint8 winner;
    }

    struct Settlement {
        bytes32 logHash;
        uint8 winner;
        uint64 settledAt;
    }

    function getMatch(bytes32 matchId) external view returns (MatchInfo memory);

    function settlement(bytes32 matchId) external view returns (Settlement memory);
}

/// @title PrivateLadder
/// @author skirm
/// @notice An encrypted rating ladder. Every player's exact rating is an FHE ciphertext (`euint16`)
///         that only the player can decrypt; the public sees a coarse tier (Bronze .. Master), and
///         matchmaking learns one bit per pair ("close enough to pair?"), never a number. With
///         exact ratings hidden there is nothing to snipe (dodging or picking opponents by their
///         number), no low-rated smurf to target, and no public number to grind or boast about.
/// @dev Rating update: a simplified Elo evaluated under FHE (the off-chain ladder's real Elo is in
///      packages/shared/src/elo.ts). The real update is K * (S - E), E = 1 / (1 + 10^((Rb - Ra) / 400)).
///      FHE has no exponentials, so the expected score is replaced by three bands of the encrypted
///      rating gap between the winner and the loser:
///        winner favoured by >= BAND (E ~ 0.64 .. 1):    step = STEP_FAVOURED  (real Elo, K = 32: 11.5 .. 0)
///        gap under BAND (E ~ 0.36 .. 0.64):              step = STEP_EVEN      (real: 20.5 .. 11.5)
///        winner the underdog by >= BAND (E ~ 0 .. 0.36): step = STEP_UNDERDOG  (real: 20.5 .. 32)
///      The band is chosen with `FHE.ge` + `FHE.select` on ciphertexts, so the step itself stays
///      encrypted. A small encrypted dither, `FHE.randEuint16(DITHER)`, is added to each step and to the
///      starting rating. That matters: every report (players and winner) is public, so with a public
///      start and a step computable from public data anyone could replay the whole ladder in the clear
///      and the encryption would hide nothing. The dither keeps each rating's exact value unknowable
///      while moving it by at most 3 points a match. The winner gains the step and the loser loses the
///      same step (zero-sum, as in Elo) within the clamps: never below FLOOR, never above CEILING. A
///      draw changes nothing (real Elo would move the favourite down a few points).
///      Tier: after each update the tier index (0 Bronze .. 5 Master, thresholds as
///      DEFAULTS.ranked.tiers) is computed under FHE and made publicly decryptable; anyone then
///      submits the KMS-signed cleartext with `revealTier` and the contract stores it. Only the tier
///      becomes public; a tier change tells observers a rating crossed a threshold, nothing more.
///      Reports: a sealed match (known to SkirmMatch) is reported by anyone once it is settled, with
///      the winner read from `SkirmMatch.settlement`, so the ladder cannot disagree with the match;
///      any other match (an off-chain ranked match, with a hash-chained log verifiable off chain) is
///      reported by the operator. Each match key is reported once.
///      Matchmaking: `isCloseMatch(a, b)` (operator) returns an encrypted bool, |ra - rb| < matchWindow,
///      that only the operator (and this contract) may decrypt. The window is a contract setting, not
///      a call argument, so the operator cannot binary-search a gap with shrinking windows; every check
///      is an on-chain event, so probing is publicly visible.
contract PrivateLadder is ZamaEthereumConfig, Ownable2Step {
    /// @notice "No side": a draw (SkirmMatch.NO_SIDE).
    uint8 public constant NO_SIDE = type(uint8).max;
    /// @notice Lowest starting rating; a new player starts at START_RATING + a dither in [0, START_DITHER).
    uint16 public constant START_RATING = 1168;
    /// @notice The starting dither range (START_RATING .. START_RATING + 63, mean ~1200 as off chain).
    uint16 public constant START_DITHER = 64;
    /// @notice Ratings never go below this (DEFAULTS.elo.floor).
    uint16 public constant FLOOR = 100;
    /// @notice Ratings never go above this.
    uint16 public constant CEILING = 3000;
    /// @notice Rating gap that separates the three Elo bands.
    uint16 public constant BAND = 100;
    /// @notice Base step when the winner was favoured by at least BAND.
    uint16 public constant STEP_FAVOURED = 7;
    /// @notice Base step when the gap is under BAND.
    uint16 public constant STEP_EVEN = 15;
    /// @notice Base step when the winner was the underdog by at least BAND.
    uint16 public constant STEP_UNDERDOG = 23;
    /// @notice Per-match dither range: each step gets + [0, DITHER).
    uint16 public constant DITHER = 4;
    /// @notice Tier thresholds (Silver, Gold, Platinum, Diamond, Master), as DEFAULTS.ranked.tiers.
    uint16 public constant SILVER = 1100;
    uint16 public constant GOLD = 1300;
    uint16 public constant PLATINUM = 1500;
    uint16 public constant DIAMOND = 1700;
    uint16 public constant MASTER = 1900;
    /// @notice The tier every new player starts in: START_RATING .. +63 is always Silver.
    uint8 public constant START_TIER = 1;
    /// @notice Bounds of the matchmaking window.
    uint16 public constant MIN_WINDOW = 25;
    uint16 public constant MAX_WINDOW = 1000;

    /// @dev SkirmMatch.Status values this contract cares about.
    uint8 private constant SM_NONE = 0;
    uint8 private constant SM_FORFEITED = 5;
    uint8 private constant SM_CANCELLED = 6;
    uint8 private constant SM_SETTLED = 7;

    /// @notice A player's public record.
    /// @param registered Whether the player joined the ladder.
    /// @param tier The last revealed tier (0 Bronze .. 5 Master).
    /// @param tierPending Whether a newer tier is waiting for `revealTier`.
    /// @param matches Matches reported for this player (public anyway: reports are transactions).
    struct Player {
        bool registered;
        uint8 tier;
        bool tierPending;
        uint32 matches;
    }

    /// @notice SkirmMatch, read for sealed matches (address(0): every report comes from the operator).
    ISkirmMatchLadder public immutable skirmMatch;
    /// @notice The game server signer that reports off-chain matches and asks for close-match checks.
    address public operator;
    /// @notice Largest rating gap `isCloseMatch` calls close.
    uint16 public matchWindow;

    mapping(address player => Player) private _players;
    mapping(address player => euint16) private _ratings;
    mapping(address player => euint8) private _tiers;
    mapping(bytes32 matchKey => bool) private _reported;
    mapping(bytes32 pairKey => ebool) private _closeChecks;

    /// @notice `player` joined with an encrypted starting rating.
    event Registered(address indexed player, bytes32 ratingHandle);
    /// @notice A match updated both ratings (`winnerSide` 0: a won, 1: b won, NO_SIDE: draw, no change).
    event Reported(bytes32 indexed matchKey, address indexed a, address indexed b, uint8 winnerSide, bool fromChain);
    /// @notice `player`'s new tier is computed and open for public decryption.
    event TierPending(address indexed player, bytes32 tierHandle);
    /// @notice `player`'s tier was decrypted with a KMS proof.
    event TierRevealed(address indexed player, uint8 tier);
    /// @notice The operator asked whether `a` and `b` are within the window; only it can decrypt the answer.
    event CloseChecked(address indexed a, address indexed b, bytes32 closeHandle);
    event OperatorSet(address indexed operator);
    event MatchWindowSet(uint16 matchWindow);

    error ZeroAddress();
    error NotOperator(address caller);
    error InvalidWindow(uint16 matchWindow);
    error AlreadyRegistered(address player);
    error NotRegistered(address player);
    error SamePlayer(address player);
    error InvalidMatchKey();
    error AlreadyReported(bytes32 matchKey);
    error InvalidWinner(uint8 winner);
    error WrongPlayers(bytes32 matchKey);
    error MatchNotSettled(bytes32 matchKey);
    error NoTierPending(address player);

    modifier onlyOperator() {
        if (msg.sender != operator) revert NotOperator(msg.sender);
        _;
    }

    /// @param skirmMatch_ SkirmMatch (address(0) when it is not deployed).
    /// @param operator_ The game server signer.
    /// @param matchWindow_ Largest gap `isCloseMatch` calls close (MIN_WINDOW .. MAX_WINDOW).
    constructor(ISkirmMatchLadder skirmMatch_, address operator_, uint16 matchWindow_) Ownable(msg.sender) {
        if (operator_ == address(0)) revert ZeroAddress();
        if (matchWindow_ < MIN_WINDOW || matchWindow_ > MAX_WINDOW) revert InvalidWindow(matchWindow_);
        skirmMatch = skirmMatch_;
        operator = operator_;
        matchWindow = matchWindow_;
        emit OperatorSet(operator_);
        emit MatchWindowSet(matchWindow_);
    }

    /// @notice Changes the game server signer.
    function setOperator(address operator_) external onlyOwner {
        if (operator_ == address(0)) revert ZeroAddress();
        operator = operator_;
        emit OperatorSet(operator_);
    }

    /// @notice Changes the matchmaking window.
    function setMatchWindow(uint16 matchWindow_) external onlyOwner {
        if (matchWindow_ < MIN_WINDOW || matchWindow_ > MAX_WINDOW) revert InvalidWindow(matchWindow_);
        matchWindow = matchWindow_;
        emit MatchWindowSet(matchWindow_);
    }

    /// @notice Joins the ladder: the caller gets an encrypted rating in START_RATING .. +63 (Silver)
    ///         that only it can decrypt.
    function register() external {
        Player storage p = _players[msg.sender];
        if (p.registered) revert AlreadyRegistered(msg.sender);
        p.registered = true;
        p.tier = START_TIER;
        euint16 rating = FHE.add(FHE.randEuint16(START_DITHER), START_RATING);
        _store(msg.sender, rating);
        emit Registered(msg.sender, euint16.unwrap(rating));
    }

    /// @notice Reports a finished match between two registered players and moves both ratings.
    ///         A sealed match (SkirmMatch knows it): anyone, once settled; `a` and `b` must be its seats
    ///         0 and 1 and `winnerSide` is ignored (the settlement's winner counts; a forfeit or a
    ///         cancel changes nothing). Any other match: the operator, with its `winnerSide`.
    /// @param matchKey keccak256 of the off-chain match id (the key SkirmMatch uses).
    /// @param a Team A's player.
    /// @param b Team B's player.
    /// @param winnerSide 0 (a won), 1 (b won) or NO_SIDE (draw).
    function report(bytes32 matchKey, address a, address b, uint8 winnerSide) external {
        if (matchKey == bytes32(0)) revert InvalidMatchKey();
        if (_reported[matchKey]) revert AlreadyReported(matchKey);
        if (a == b) revert SamePlayer(a);
        if (!_players[a].registered) revert NotRegistered(a);
        if (!_players[b].registered) revert NotRegistered(b);
        (bool onChain, uint8 winner) = _chainWinner(matchKey, a, b);
        if (!onChain) {
            if (msg.sender != operator) revert NotOperator(msg.sender);
            if (winnerSide > 1 && winnerSide != NO_SIDE) revert InvalidWinner(winnerSide);
            winner = winnerSide;
        }
        _reported[matchKey] = true;
        _players[a].matches++;
        _players[b].matches++;
        if (winner != NO_SIDE) {
            (address w, address l) = winner == 0 ? (a, b) : (b, a);
            _update(w, l);
        }
        emit Reported(matchKey, a, b, winner, onChain);
    }

    /// @notice Stores `player`'s pending tier after checking the KMS proof (anyone can submit it; a
    ///         forged value fails the signature check).
    /// @param abiEncodedClearValues ABI-encoded (tier) for `tierHandle(player)`.
    /// @param decryptionProof KMS signatures from the relayer's public decryption.
    function revealTier(address player, bytes calldata abiEncodedClearValues, bytes calldata decryptionProof) external {
        Player storage p = _players[player];
        if (!p.tierPending) revert NoTierPending(player);
        bytes32[] memory handles = new bytes32[](1);
        handles[0] = euint8.unwrap(_tiers[player]);
        FHE.checkSignatures(handles, abiEncodedClearValues, decryptionProof);
        uint8 tier = uint8(abi.decode(abiEncodedClearValues, (uint256)));
        p.tier = tier;
        p.tierPending = false;
        emit TierRevealed(player, tier);
    }

    /// @notice Whether `a` and `b` are within `matchWindow` of each other, as an encrypted bool only
    ///         the operator can decrypt (the handle is in `CloseChecked` and `closeCheck(a, b)`).
    function isCloseMatch(address a, address b) external onlyOperator returns (ebool close) {
        if (a == b) revert SamePlayer(a);
        if (!_players[a].registered) revert NotRegistered(a);
        if (!_players[b].registered) revert NotRegistered(b);
        euint16 ra = _ratings[a];
        euint16 rb = _ratings[b];
        euint16 gap = FHE.sub(FHE.max(ra, rb), FHE.min(ra, rb));
        close = FHE.lt(gap, matchWindow);
        FHE.allowThis(close);
        FHE.allow(close, msg.sender);
        _closeChecks[pairKey(a, b)] = close;
        emit CloseChecked(a, b, ebool.unwrap(close));
    }

    /// @notice `player`'s public record.
    function playerOf(address player) external view returns (Player memory) {
        return _players[player];
    }

    /// @notice `player`'s encrypted rating handle (zero before registering). Only `player` can decrypt it.
    function ratingOf(address player) external view returns (bytes32) {
        return euint16.unwrap(_ratings[player]);
    }

    /// @notice `player`'s latest tier handle (publicly decryptable).
    function tierHandle(address player) external view returns (bytes32) {
        return euint8.unwrap(_tiers[player]);
    }

    /// @notice Whether `matchKey` was reported.
    function reported(bytes32 matchKey) external view returns (bool) {
        return _reported[matchKey];
    }

    /// @notice The latest `isCloseMatch(a, b)` answer handle (either order), zero if never asked.
    function closeCheck(address a, address b) external view returns (bytes32) {
        return ebool.unwrap(_closeChecks[pairKey(a, b)]);
    }

    /// @notice The order-independent key of a pair.
    function pairKey(address a, address b) public pure returns (bytes32) {
        return a < b ? keccak256(abi.encode(a, b)) : keccak256(abi.encode(b, a));
    }

    /// @dev The banded Elo step, applied to the winner (+) and the loser (-), with the clamps.
    function _update(address winner, address loser) private {
        euint16 rw = _ratings[winner];
        euint16 rl = _ratings[loser];
        // Ratings stay <= CEILING, so + BAND never overflows 16 bits.
        ebool favoured = FHE.ge(rw, FHE.add(rl, BAND));
        ebool underdog = FHE.ge(rl, FHE.add(rw, BAND));
        euint16 step = FHE.select(favoured, FHE.asEuint16(STEP_FAVOURED), FHE.select(underdog, FHE.asEuint16(STEP_UNDERDOG), FHE.asEuint16(STEP_EVEN)));
        step = FHE.add(step, FHE.randEuint16(DITHER));
        _store(winner, FHE.min(FHE.add(rw, step), CEILING));
        // max(rl, FLOOR + step) - step: rl - step, never below FLOOR.
        _store(loser, FHE.sub(FHE.max(rl, FHE.add(step, FLOOR)), step));
        _setTier(winner);
        _setTier(loser);
    }

    /// @dev Stores a rating, readable by this contract and its player only.
    function _store(address player, euint16 rating) internal {
        FHE.allowThis(rating);
        FHE.allow(rating, player);
        _ratings[player] = rating;
    }

    /// @dev The tier index (count of thresholds reached) under FHE, opened for public decryption.
    function _setTier(address player) internal {
        euint16 r = _ratings[player];
        euint8 tier = FHE.asEuint8(FHE.ge(r, SILVER));
        tier = FHE.add(tier, FHE.asEuint8(FHE.ge(r, GOLD)));
        tier = FHE.add(tier, FHE.asEuint8(FHE.ge(r, PLATINUM)));
        tier = FHE.add(tier, FHE.asEuint8(FHE.ge(r, DIAMOND)));
        tier = FHE.add(tier, FHE.asEuint8(FHE.ge(r, MASTER)));
        FHE.allowThis(tier);
        FHE.makePubliclyDecryptable(tier);
        _tiers[player] = tier;
        _players[player].tierPending = true;
        emit TierPending(player, euint8.unwrap(tier));
    }

    /// @dev (true, winner) when SkirmMatch knows the match: its settled winner (seats must be a, b),
    ///      or NO_SIDE when it was forfeited or cancelled; reverts while it is unsettled. (false, _) otherwise.
    function _chainWinner(bytes32 matchKey, address a, address b) private view returns (bool onChain, uint8 winner) {
        if (address(skirmMatch) == address(0)) return (false, NO_SIDE);
        ISkirmMatchLadder.MatchInfo memory info = skirmMatch.getMatch(matchKey);
        if (info.status == SM_NONE) return (false, NO_SIDE);
        if (info.players[0] != a || info.players[1] != b) revert WrongPlayers(matchKey);
        if (info.status == SM_SETTLED) return (true, skirmMatch.settlement(matchKey).winner);
        if (info.status == SM_FORFEITED || info.status == SM_CANCELLED) return (true, NO_SIDE);
        revert MatchNotSettled(matchKey);
    }
}
