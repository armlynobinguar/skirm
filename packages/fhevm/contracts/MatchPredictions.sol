// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {FHE, ebool, euint64, euint128, externalEbool, externalEuint64} from "@fhevm/solidity/lib/FHE.sol";
import {ZamaEthereumConfig} from "@fhevm/solidity/config/ZamaConfig.sol";
import {IERC7984} from "@openzeppelin/confidential-contracts/interfaces/IERC7984.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";

/// @notice The slice of SkirmMatch this contract reads: a sealed match's header and its settlement.
interface ISkirmMatchResult {
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

/// @title MatchPredictions
/// @author skirm
/// @notice Confidential spectator predictions on live skirm matches, staked in cSKIRM (ERC-7984).
///         A spectator backs team A or team B; both the side and the amount are FHE ciphertexts, so
///         while betting is open nobody (players, other spectators, the operator, validators) can see
///         how the pool is split. There is nothing to herd behind, no whale to follow and no order
///         flow to front-run, and the players cannot read the crowd's sentiment mid-match. After the
///         market closes only two numbers become public, the total backing each side; each winner's
///         pro-rata payout is computed and paid under FHE.
/// @dev Flow.
///      1. `openMarket(matchKey, closesAt)` (operator) when a match starts. `matchKey` is
///         keccak256 of the off-chain match id, the same key SkirmMatch uses.
///      2. `predict(matchKey, encSide, encAmount, proof)`: one prediction per address. The stake is
///         capped at MAX_STAKE under FHE and pulled with `confidentialTransferFrom` (the spectator
///         first makes this contract a cSKIRM operator); only what actually arrived counts, so a
///         short balance silently stakes 0 (ERC-7984 moves 0 instead of reverting). The totals move
///         by `select(backsB, 0, received)` and `select(backsB, received, 0)`, so every prediction
///         touches both totals the same way and the transaction reveals no side.
///      3. `close(matchKey)`: the operator closes at a fixed tick (the game server does it at tick
///         30, before late-game information exists), or anyone once `closesAt` has passed. Both
///         totals are opened for public decryption.
///      4. `revealTotals(matchKey, clear, proof)` (anyone): checks the KMS proof and stores the two
///         totals in the clear: the market's odds.
///      5. `resolve(matchKey, winnerSide)`. If SkirmMatch knows the match (a sealed match), the
///         winner is read from `SkirmMatch.settlement` and the argument is ignored: SkirmMatch's
///         `settle` is what moves the players' own stakes and anchors the log hash, so the market
///         cannot be resolved differently from the match, and anyone can resolve it. A forfeited or
///         cancelled sealed match voids the market. Otherwise (an ordinary match, which has no
///         on-chain record) only the operator may resolve, and its value is taken; the match log
///         stays verifiable off-chain. A draw (NO_SIDE), an empty winning side or a market nobody
///         resolved within RESOLVE_TIMEOUT after `closesAt` (`voidStale`, anyone) refunds everyone.
///      6. `claim(matchKey)`: pays `select(backedWinner, payout, 0)`, with
///            payout = stake + winnings - fee,  winnings = stake * losingTotal / winningTotal,
///            fee = winnings * feeBps / 10000.
///         FHE division only takes a plaintext divisor, which is why the totals are public by then.
///         `stake * losingTotal` can exceed 64 bits (both go up to MAX_STAKE * MAX_PREDICTORS), so
///         that one product is widened to euint128; the quotient is at most `losingTotal` and fits
///         back in euint64. Rounding is down, so the sum of payouts never exceeds the pool. A loser
///         gets an encrypted 0, which looks the same on chain as a payout: an observer learns who
///         claimed, never who won or how much.
///      ACL: each predictor can decrypt its own side, stake and payout; the running totals are
///      readable by this contract only until `close` makes them public.
contract MatchPredictions is ZamaEthereumConfig, Ownable2Step {
    /// @notice "No side": a draw or a void market (SkirmMatch.NO_SIDE).
    uint8 public constant NO_SIDE = type(uint8).max;
    /// @notice Highest fee, in basis points of the winnings (10%).
    uint16 public constant MAX_FEE_BPS = 1_000;
    /// @notice Largest stake per prediction, in cSKIRM base units (100,000 cSKIRM at 6 decimals).
    uint64 public constant MAX_STAKE = 100_000 * 1e6;
    /// @notice Most predictions per market (MAX_STAKE * MAX_PREDICTORS stays far below 2^64).
    uint32 public constant MAX_PREDICTORS = 10_000;
    /// @notice Longest betting window.
    uint64 public constant MAX_WINDOW = 1 days;
    /// @notice A closed market nobody resolved is voidable by anyone this long after `closesAt`.
    uint64 public constant RESOLVE_TIMEOUT = 1 days;

    /// @dev SkirmMatch.Status values this contract cares about.
    uint8 private constant SM_NONE = 0;
    uint8 private constant SM_FORFEITED = 5;
    uint8 private constant SM_CANCELLED = 6;
    uint8 private constant SM_SETTLED = 7;

    /// @notice Lifecycle. None → Open → Closed (totals decrypting) → Revealed → Resolved or Void.
    enum Status {
        None,
        Open,
        Closed,
        Revealed,
        Resolved,
        Void
    }

    /// @notice Public market record.
    /// @param closesAt No prediction lands at or after this timestamp; anyone may close from then on.
    /// @param status Lifecycle step.
    /// @param winner 0 (team A) or 1 (team B) once Resolved, else NO_SIDE.
    /// @param feeBps Fee on the winnings, fixed when the market opened.
    /// @param predictors Predictions so far ("N sealed predictions": the count is public).
    /// @param totalA Total staked on team A, public once Revealed (0 before).
    /// @param totalB Total staked on team B, public once Revealed (0 before).
    struct Market {
        uint64 closesAt;
        Status status;
        uint8 winner;
        uint16 feeBps;
        uint32 predictors;
        uint64 totalA;
        uint64 totalB;
    }

    /// @dev Encrypted per-market state.
    struct Pool {
        euint64 totalA;
        euint64 totalB;
    }

    /// @dev One spectator's sealed prediction.
    struct Prediction {
        ebool backsB;
        euint64 stake;
        euint64 payout;
        bool claimed;
    }

    /// @notice The cSKIRM token stakes are paid in.
    IERC7984 public immutable credits;
    /// @notice SkirmMatch, read for the winner of sealed matches (address(0): always the operator's value).
    ISkirmMatchResult public immutable skirmMatch;
    /// @notice The game server signer that opens, closes and resolves markets.
    address public operator;
    /// @notice Fee recipient (address(0) for none).
    address public treasury;
    /// @notice Fee on the winnings in basis points, for markets opened from now on.
    uint16 public feeBps;

    mapping(bytes32 matchKey => Market) private _markets;
    mapping(bytes32 matchKey => Pool) private _pools;
    mapping(bytes32 matchKey => mapping(address predictor => Prediction)) private _predictions;

    /// @notice A market opened on a live match.
    event MarketOpened(bytes32 indexed matchKey, uint64 closesAt, uint16 feeBps);
    /// @notice `predictor` placed a sealed prediction (side and amount stay encrypted).
    event Predicted(bytes32 indexed matchKey, address indexed predictor, uint32 predictors, bytes32 stakeHandle);
    /// @notice Betting closed; the two totals are open for public decryption.
    event MarketClosed(bytes32 indexed matchKey, bytes32 totalAHandle, bytes32 totalBHandle);
    /// @notice The totals were decrypted with a KMS proof: the market's odds are public.
    event TotalsRevealed(bytes32 indexed matchKey, uint64 totalA, uint64 totalB);
    /// @notice The market was resolved: `winner` 0 or 1; `fromChain` when read from SkirmMatch.
    event MarketResolved(bytes32 indexed matchKey, uint8 winner, bool fromChain);
    /// @notice The market was voided (draw, forfeit, empty side, empty market or timeout): everyone is refunded.
    event MarketVoided(bytes32 indexed matchKey);
    /// @notice `predictor` claimed; `payoutHandle` is the encrypted amount sent (0 for a loser).
    event Claimed(bytes32 indexed matchKey, address indexed predictor, bytes32 payoutHandle);
    event OperatorSet(address indexed operator);
    event FeeSet(address indexed treasury, uint16 feeBps);

    error ZeroAddress();
    error InvalidFee(uint16 feeBps);
    error NotOperator(address caller);
    error InvalidMatchKey();
    error InvalidCloseTime(uint64 closesAt);
    error MarketExists(bytes32 matchKey);
    error UnknownMarket(bytes32 matchKey);
    error WrongStatus(Status status);
    error BettingClosed(uint64 closesAt);
    error StillOpen(uint64 closesAt);
    error AlreadyPredicted(address predictor);
    error PlayerCannotPredict(address player);
    error TooManyPredictors();
    error InvalidWinner(uint8 winner);
    error MatchNotSettled(bytes32 matchKey);
    error NotStale(uint64 voidableAt);
    error NotAPredictor(address predictor);
    error AlreadyClaimed(address predictor);

    modifier onlyOperator() {
        if (msg.sender != operator) revert NotOperator(msg.sender);
        _;
    }

    /// @param credits_ The cSKIRM token.
    /// @param skirmMatch_ SkirmMatch (address(0) when it is not deployed).
    /// @param operator_ The game server signer.
    /// @param treasury_ Fee recipient (address(0) for none).
    /// @param feeBps_ Fee on the winnings, at most MAX_FEE_BPS.
    constructor(IERC7984 credits_, ISkirmMatchResult skirmMatch_, address operator_, address treasury_, uint16 feeBps_) Ownable(msg.sender) {
        if (address(credits_) == address(0) || operator_ == address(0)) revert ZeroAddress();
        if (feeBps_ > MAX_FEE_BPS) revert InvalidFee(feeBps_);
        credits = credits_;
        skirmMatch = skirmMatch_;
        operator = operator_;
        treasury = treasury_;
        feeBps = feeBps_;
        emit OperatorSet(operator_);
        emit FeeSet(treasury_, feeBps_);
    }

    /// @notice Changes the game server signer.
    function setOperator(address operator_) external onlyOwner {
        if (operator_ == address(0)) revert ZeroAddress();
        operator = operator_;
        emit OperatorSet(operator_);
    }

    /// @notice Changes the fee terms for markets opened from now on.
    function setFee(address treasury_, uint16 feeBps_) external onlyOwner {
        if (feeBps_ > MAX_FEE_BPS) revert InvalidFee(feeBps_);
        treasury = treasury_;
        feeBps = feeBps_;
        emit FeeSet(treasury_, feeBps_);
    }

    /// @notice Opens a market on a match that just started.
    /// @param matchKey keccak256 of the off-chain match id (nonzero).
    /// @param closesAt Latest time a prediction lands (in the future, at most MAX_WINDOW away).
    function openMarket(bytes32 matchKey, uint64 closesAt) external onlyOperator {
        if (matchKey == bytes32(0)) revert InvalidMatchKey();
        if (_markets[matchKey].status != Status.None) revert MarketExists(matchKey);
        if (closesAt <= block.timestamp || closesAt > block.timestamp + MAX_WINDOW) revert InvalidCloseTime(closesAt);
        _markets[matchKey] = Market({closesAt: closesAt, status: Status.Open, winner: NO_SIDE, feeBps: feeBps, predictors: 0, totalA: 0, totalB: 0});
        Pool storage p = _pools[matchKey];
        p.totalA = FHE.asEuint64(0);
        p.totalB = FHE.asEuint64(0);
        FHE.allowThis(p.totalA);
        FHE.allowThis(p.totalB);
        emit MarketOpened(matchKey, closesAt, feeBps);
    }

    /// @notice Places the caller's sealed prediction: an encrypted side and an encrypted amount.
    /// @dev The caller must have made this contract a cSKIRM operator (`setOperator`). The amount is
    ///      capped at MAX_STAKE, and a short balance stakes 0.
    /// @param matchKey The market.
    /// @param encBacksB Encrypted side: false backs team A, true backs team B.
    /// @param encAmount Encrypted stake in cSKIRM base units.
    /// @param inputProof Proof covering both encrypted inputs (for this contract and the caller).
    function predict(bytes32 matchKey, externalEbool encBacksB, externalEuint64 encAmount, bytes calldata inputProof) external {
        Market storage m = _require(matchKey);
        if (m.status != Status.Open) revert WrongStatus(m.status);
        if (block.timestamp >= m.closesAt) revert BettingClosed(m.closesAt);
        Prediction storage pr = _predictions[matchKey][msg.sender];
        if (FHE.isInitialized(pr.stake)) revert AlreadyPredicted(msg.sender);
        if (m.predictors >= MAX_PREDICTORS) revert TooManyPredictors();
        _notAPlayer(matchKey);
        m.predictors++;

        ebool backsB = FHE.fromExternal(encBacksB, inputProof);
        euint64 amount = FHE.min(FHE.fromExternal(encAmount, inputProof), MAX_STAKE);
        FHE.allowTransient(amount, address(credits));
        // Reverts only without operator approval (public anyway); a short balance moves 0.
        euint64 stake = credits.confidentialTransferFrom(msg.sender, address(this), amount);

        Pool storage p = _pools[matchKey];
        euint64 zero = FHE.asEuint64(0);
        p.totalA = FHE.add(p.totalA, FHE.select(backsB, zero, stake));
        p.totalB = FHE.add(p.totalB, FHE.select(backsB, stake, zero));
        FHE.allowThis(p.totalA);
        FHE.allowThis(p.totalB);

        FHE.allowThis(backsB);
        FHE.allow(backsB, msg.sender);
        FHE.allowThis(stake);
        FHE.allow(stake, msg.sender);
        pr.backsB = backsB;
        pr.stake = stake;
        emit Predicted(matchKey, msg.sender, m.predictors, euint64.unwrap(stake));
    }

    /// @notice Ends betting: the operator at any time (the game server closes at a fixed early tick),
    ///         anyone once `closesAt` has passed. Both totals are opened for public decryption; an
    ///         empty market is voided at once.
    function close(bytes32 matchKey) external {
        Market storage m = _require(matchKey);
        if (m.status != Status.Open) revert WrongStatus(m.status);
        if (msg.sender != operator && block.timestamp < m.closesAt) revert StillOpen(m.closesAt);
        if (m.predictors == 0) {
            m.status = Status.Void;
            emit MarketVoided(matchKey);
            return;
        }
        m.status = Status.Closed;
        Pool storage p = _pools[matchKey];
        FHE.makePubliclyDecryptable(p.totalA);
        FHE.makePubliclyDecryptable(p.totalB);
        emit MarketClosed(matchKey, euint64.unwrap(p.totalA), euint64.unwrap(p.totalB));
    }

    /// @notice Stores the decrypted totals after checking the KMS proof (anyone can submit it: the
    ///         proof binds the values to the handles, so a forged value reverts).
    /// @param abiEncodedClearValues ABI-encoded (totalA, totalB), in `totalHandles` order.
    /// @param decryptionProof KMS signatures from the relayer's public decryption.
    function revealTotals(bytes32 matchKey, bytes calldata abiEncodedClearValues, bytes calldata decryptionProof) external {
        Market storage m = _require(matchKey);
        if (m.status != Status.Closed) revert WrongStatus(m.status);
        FHE.checkSignatures(totalHandles(matchKey), abiEncodedClearValues, decryptionProof);
        (uint256 a, uint256 b) = abi.decode(abiEncodedClearValues, (uint256, uint256));
        m.totalA = uint64(a);
        m.totalB = uint64(b);
        m.status = Status.Revealed;
        emit TotalsRevealed(matchKey, uint64(a), uint64(b));
    }

    /// @notice Resolves a revealed market. A sealed match's winner comes from SkirmMatch (anyone can
    ///         call, `winnerSide` is ignored); any other match takes the operator's `winnerSide`.
    /// @param winnerSide 0 (team A), 1 (team B) or NO_SIDE (draw or void: refunds everyone).
    function resolve(bytes32 matchKey, uint8 winnerSide) external {
        Market storage m = _require(matchKey);
        if (m.status != Status.Revealed) revert WrongStatus(m.status);
        (bool onChain, uint8 winner) = _chainWinner(matchKey);
        if (!onChain) {
            if (msg.sender != operator) revert NotOperator(msg.sender);
            if (winnerSide > 1 && winnerSide != NO_SIDE) revert InvalidWinner(winnerSide);
            winner = winnerSide;
        }
        uint64 winning = winner == 0 ? m.totalA : m.totalB;
        if (winner == NO_SIDE || winning == 0) {
            m.status = Status.Void;
            emit MarketVoided(matchKey);
            return;
        }
        m.winner = winner;
        m.status = Status.Resolved;
        emit MarketResolved(matchKey, winner, onChain);
    }

    /// @notice Voids a market nobody resolved within RESOLVE_TIMEOUT after `closesAt` (anyone), so
    ///         stakes are never stuck behind a missing operator or relayer.
    function voidStale(bytes32 matchKey) external {
        Market storage m = _require(matchKey);
        if (m.status != Status.Open && m.status != Status.Closed && m.status != Status.Revealed) revert WrongStatus(m.status);
        uint64 voidableAt = m.closesAt + RESOLVE_TIMEOUT;
        if (block.timestamp < voidableAt) revert NotStale(voidableAt);
        m.status = Status.Void;
        emit MarketVoided(matchKey);
    }

    /// @notice Pays the caller's prediction out: the stake on a void market, else the pro-rata payout
    ///         if its sealed side won and an encrypted 0 if it lost (see the contract notes).
    function claim(bytes32 matchKey) external {
        Market storage m = _require(matchKey);
        if (m.status != Status.Resolved && m.status != Status.Void) revert WrongStatus(m.status);
        Prediction storage pr = _predictions[matchKey][msg.sender];
        if (!FHE.isInitialized(pr.stake)) revert NotAPredictor(msg.sender);
        if (pr.claimed) revert AlreadyClaimed(msg.sender);
        pr.claimed = true;

        euint64 payout;
        if (m.status == Status.Void) {
            payout = pr.stake;
        } else {
            (uint64 winning, uint64 losing) = m.winner == 0 ? (m.totalA, m.totalB) : (m.totalB, m.totalA);
            ebool won = m.winner == 1 ? pr.backsB : FHE.not(pr.backsB);
            euint64 zero = FHE.asEuint64(0);
            euint64 winnings = zero;
            if (losing != 0) {
                // stake * losing can pass 2^64: widen the product, the quotient is <= losing.
                winnings = FHE.asEuint64(FHE.div(FHE.mul(FHE.asEuint128(pr.stake), uint128(losing)), uint128(winning)));
            }
            euint64 fee = zero;
            if (m.feeBps != 0 && treasury != address(0) && losing != 0) {
                // winnings <= losing <= MAX_STAKE * MAX_PREDICTORS, so winnings * MAX_FEE_BPS fits 64 bits.
                fee = FHE.div(FHE.mul(winnings, uint64(m.feeBps)), uint64(10_000));
                euint64 feeOut = FHE.select(won, fee, zero);
                _send(treasury, feeOut);
            }
            payout = FHE.select(won, FHE.sub(FHE.add(pr.stake, winnings), fee), zero);
        }
        FHE.allowThis(payout);
        FHE.allow(payout, msg.sender);
        pr.payout = payout;
        _send(msg.sender, payout);
        emit Claimed(matchKey, msg.sender, euint64.unwrap(payout));
    }

    /// @notice The public market record (status None for an unknown key).
    function getMarket(bytes32 matchKey) external view returns (Market memory) {
        return _markets[matchKey];
    }

    /// @notice `predictor`'s sealed handles: side (ebool, true = team B), stake and payout (zero
    ///         handles before it predicted / claimed), and whether it claimed. Only it can decrypt them.
    function predictionOf(bytes32 matchKey, address predictor) external view returns (bytes32 side, bytes32 stake, bytes32 payout, bool claimed) {
        Prediction storage pr = _predictions[matchKey][predictor];
        return (ebool.unwrap(pr.backsB), euint64.unwrap(pr.stake), euint64.unwrap(pr.payout), pr.claimed);
    }

    /// @notice The two total handles, in `revealTotals` order (team A, team B). Publicly
    ///         decryptable only once the market is closed.
    function totalHandles(bytes32 matchKey) public view returns (bytes32[] memory handles) {
        Pool storage p = _pools[matchKey];
        handles = new bytes32[](2);
        handles[0] = euint64.unwrap(p.totalA);
        handles[1] = euint64.unwrap(p.totalB);
    }

    function _require(bytes32 matchKey) private view returns (Market storage m) {
        m = _markets[matchKey];
        if (m.status == Status.None) revert UnknownMarket(matchKey);
    }

    /// @dev On a sealed match the two players may not bet on it (they know their own sealed crews).
    function _notAPlayer(bytes32 matchKey) private view {
        if (address(skirmMatch) == address(0)) return;
        ISkirmMatchResult.MatchInfo memory info = skirmMatch.getMatch(matchKey);
        if (info.status == SM_NONE) return;
        if (msg.sender == info.players[0] || msg.sender == info.players[1]) revert PlayerCannotPredict(msg.sender);
    }

    /// @dev (true, winner) when SkirmMatch knows the match: its settled winner, or NO_SIDE when it was
    ///      forfeited or cancelled; reverts while it is still unsettled. (false, _) otherwise.
    function _chainWinner(bytes32 matchKey) private view returns (bool onChain, uint8 winner) {
        if (address(skirmMatch) == address(0)) return (false, NO_SIDE);
        uint8 status = skirmMatch.getMatch(matchKey).status;
        if (status == SM_NONE) return (false, NO_SIDE);
        if (status == SM_SETTLED) return (true, skirmMatch.settlement(matchKey).winner);
        if (status == SM_FORFEITED || status == SM_CANCELLED) return (true, NO_SIDE);
        revert MatchNotSettled(matchKey);
    }

    /// @dev Confidential transfer out of escrow.
    function _send(address to, euint64 amount) private {
        FHE.allowTransient(amount, address(credits));
        credits.confidentialTransfer(to, amount);
    }
}
