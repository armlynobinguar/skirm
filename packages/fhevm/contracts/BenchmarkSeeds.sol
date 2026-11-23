// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {FHE, euint64} from "@fhevm/solidity/lib/FHE.sol";
import {ZamaEthereumConfig} from "@fhevm/solidity/config/ZamaConfig.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";

/// @title BenchmarkSeeds
/// @author skirm
/// @notice Hidden benchmark seeds for minted skirm skill versions, drawn with on-chain FHE randomness
///         and kept encrypted until the benchmark has been played. Every minted version plays a
///         hidden gauntlet of 6 matches; which (map, difficulty) each match uses comes from the seed
///         drawn here. Nobody, the skill writer included, can read the seed before the benchmark
///         runs, so nobody can tune a skill for it. Afterwards the seed is revealed with a KMS proof,
///         so anyone can check the benchmark played exactly the matches it was dealt.
/// @dev Flow.
///      1. `commit(skillRef, promptHash)` (operator): binds the version's prompt hash and draws one
///         encrypted 64-bit seed (`FHE.randEuint64`). The seed is drawn in the same transaction that
///         fixes the prompt, so it cannot depend on anything the writer does afterwards, and a
///         version can be committed only once (no re-rolls).
///      2. The game server user-decrypts the seed (it is the only address on the ACL besides this
///         contract), maps it to 6 (map, difficulty) picks (`splitSeed`, and `benchmarkSeedPicks` in
///         packages/shared/src/benchmark-seeds.ts) and plays the 6 matches off-chain.
///      3. `publish(skillRef, resultsHash, scoreBps)` (operator): posts the outcome (the score and a
///         hash of the 6 match log heads, in play order) *before* the seed is public, then opens the
///         seed for public decryption.
///      4. `finalize(skillRef, cleartext, proof)` (anyone): checks the KMS proof and stores the seed.
///      If the operator never publishes, anyone can `forceReveal` once `revealDeadline` has passed:
///      the seed becomes public without any results, which is itself a visible failure.
///
///      Why one euint64 and not six euint32: the six picks only need 10 bits each (a map index and a
///      difficulty bit), so one 64-bit draw covers them. It is one random op, one ACL entry, one
///      handle to user-decrypt and one handle to prove at the reveal, against six of each; the
///      splitting is done on the plaintext after the reveal (`splitSeed`). The test suite measures
///      both draws (see the README).
///
///      Trust model. The operator (the game server's signer) is on the seed's ACL: it has to know the
///      picks to play the matches. It can therefore learn the seed early, but it cannot choose it:
///      the seed is drawn by the FHEVM coprocessor after the prompt hash is fixed. Compared with the
///      old keyed-hash picks (HMAC with a server secret), the operator can no longer pick favourable
///      seeds for a friend or grind a secret until a version gets easy matches, and a leak of the
///      seed before the run is limited to the operator itself (it is not derivable from any key).
///      Only `commit` is operator-only: skill references are public (`keccak256("skirm-skill:<id>:<v>")`),
///      so if anyone could commit, a griefer could commit a version first with a wrong prompt hash
///      and block the real benchmark, since a version commits only once.
contract BenchmarkSeeds is ZamaEthereumConfig, Ownable2Step {
    /// @notice Matches in a benchmark gauntlet (picks per seed).
    uint8 public constant SEED_COUNT = 6;
    /// @notice Bits of the seed each pick uses (pick i is bits [10*i, 10*i + 10)).
    uint8 public constant SEED_BITS = 10;
    /// @notice Bounds on the time the operator has to publish before anyone may force the reveal.
    uint64 public constant MIN_REVEAL_WINDOW = 10 minutes;
    uint64 public constant MAX_REVEAL_WINDOW = 30 days;
    /// @notice The score scale: `scoreBps` 10_000 is a score of 1.
    uint16 public constant MAX_SCORE_BPS = 10_000;

    /// @notice Lifecycle. None → Committed (seed drawn, sealed) → Publishing (seed public, proof
    ///         pending) → Revealed (seed verified and stored).
    enum Status {
        None,
        Committed,
        Publishing,
        Revealed
    }

    /// @notice Public benchmark record.
    /// @param promptHash The version's prompt hash bound at commit (sha256 of the prompt, as stored
    ///        off-chain in skill_versions.prompt_sha256).
    /// @param committedAt When the seed was drawn.
    /// @param revealDeadline From this time on anyone may `forceReveal` an unpublished seed.
    /// @param status Lifecycle step.
    /// @param forced True when the seed was opened by `forceReveal` (then there are no results).
    /// @param scoreBps The benchmark score the operator posted, in basis points (0 when forced).
    /// @param resultsHash keccak256 of the 6 match log head hashes (bytes32 each, in play order), as
    ///        posted by the operator before the seed became public (zero when forced).
    /// @param seed The verified seed once `Revealed`, else 0.
    struct Benchmark {
        bytes32 promptHash;
        uint64 committedAt;
        uint64 revealDeadline;
        Status status;
        bool forced;
        uint16 scoreBps;
        bytes32 resultsHash;
        uint64 seed;
    }

    /// @notice The game server account that commits, reads and publishes benchmark seeds.
    address public operator;
    /// @notice Reveal window for benchmarks committed from now on.
    uint64 public revealWindow;

    mapping(bytes32 skillRef => Benchmark) private _benchmarks;
    mapping(bytes32 skillRef => euint64) private _seeds;

    /// @notice A version was committed and its seed drawn. `seedHandle` only the operator can decrypt.
    event Committed(bytes32 indexed skillRef, bytes32 promptHash, bytes32 seedHandle, uint64 revealDeadline);
    /// @notice The operator posted the results and opened the seed for public decryption.
    event Published(bytes32 indexed skillRef, bytes32 resultsHash, uint16 scoreBps);
    /// @notice The reveal deadline passed without results; the seed was opened by `caller`.
    event ForcedReveal(bytes32 indexed skillRef, address indexed caller);
    /// @notice The seed's KMS proof checked out; it is stored and public.
    event Revealed(bytes32 indexed skillRef, uint64 seed, bool forced);
    /// @notice The owner changed the operator.
    event OperatorSet(address indexed operator);
    /// @notice The owner changed the reveal window for new commits.
    event RevealWindowSet(uint64 revealWindow);

    error ZeroAddress();
    error NotOperator(address caller);
    error InvalidSkillRef();
    error InvalidPromptHash();
    error InvalidRevealWindow(uint64 revealWindow);
    error InvalidScore(uint16 scoreBps);
    error InvalidResultsHash();
    error AlreadyCommitted(bytes32 skillRef);
    error WrongStatus(Status status);
    error RevealNotDue(uint64 revealDeadline);
    error NotRevealed(bytes32 skillRef);

    modifier onlyOperator() {
        if (msg.sender != operator) revert NotOperator(msg.sender);
        _;
    }

    /// @param operator_ The game server account (holds ZAMA_OPERATOR_PRIVATE_KEY).
    /// @param revealWindow_ Time the operator has to publish (MIN_REVEAL_WINDOW..MAX_REVEAL_WINDOW).
    constructor(address operator_, uint64 revealWindow_) Ownable(msg.sender) {
        _setOperator(operator_);
        _setRevealWindow(revealWindow_);
    }

    /// @notice Changes the operator. Seeds already drawn stay readable by the operator they were drawn for.
    function setOperator(address operator_) external onlyOwner {
        _setOperator(operator_);
    }

    /// @notice Changes the reveal window for benchmarks committed from now on.
    function setRevealWindow(uint64 revealWindow_) external onlyOwner {
        _setRevealWindow(revealWindow_);
    }

    /// @notice Binds a version's prompt hash and draws its encrypted benchmark seed.
    /// @param skillRef keccak256("skirm-skill:<skillId>:<version>") (skillRefPreimage in packages/shared).
    /// @param promptHash The version's prompt hash (nonzero).
    function commit(bytes32 skillRef, bytes32 promptHash) external onlyOperator {
        if (skillRef == bytes32(0)) revert InvalidSkillRef();
        if (promptHash == bytes32(0)) revert InvalidPromptHash();
        Benchmark storage b = _benchmarks[skillRef];
        if (b.status != Status.None) revert AlreadyCommitted(skillRef);

        euint64 seed = FHE.randEuint64();
        FHE.allowThis(seed);
        FHE.allow(seed, msg.sender);
        _seeds[skillRef] = seed;

        uint64 deadline = uint64(block.timestamp) + revealWindow;
        b.promptHash = promptHash;
        b.committedAt = uint64(block.timestamp);
        b.revealDeadline = deadline;
        b.status = Status.Committed;
        emit Committed(skillRef, promptHash, euint64.unwrap(seed), deadline);
    }

    /// @notice Posts the benchmark outcome, then opens the seed for public decryption.
    /// @param skillRef The committed version.
    /// @param resultsHash keccak256 of the 6 match log head hashes in play order (nonzero).
    /// @param scoreBps The score in basis points (0..10_000).
    function publish(bytes32 skillRef, bytes32 resultsHash, uint16 scoreBps) external onlyOperator {
        Benchmark storage b = _benchmarks[skillRef];
        if (b.status != Status.Committed) revert WrongStatus(b.status);
        if (resultsHash == bytes32(0)) revert InvalidResultsHash();
        if (scoreBps > MAX_SCORE_BPS) revert InvalidScore(scoreBps);
        b.resultsHash = resultsHash;
        b.scoreBps = scoreBps;
        b.status = Status.Publishing;
        FHE.makePubliclyDecryptable(_seeds[skillRef]);
        emit Published(skillRef, resultsHash, scoreBps);
    }

    /// @notice Opens an unpublished seed once its reveal deadline has passed (anyone can call it).
    ///         The benchmark then has no results on chain: the operator did not deliver.
    /// @param skillRef The committed version.
    function forceReveal(bytes32 skillRef) external {
        Benchmark storage b = _benchmarks[skillRef];
        if (b.status != Status.Committed) revert WrongStatus(b.status);
        if (block.timestamp < b.revealDeadline) revert RevealNotDue(b.revealDeadline);
        b.forced = true;
        b.status = Status.Publishing;
        FHE.makePubliclyDecryptable(_seeds[skillRef]);
        emit ForcedReveal(skillRef, msg.sender);
    }

    /// @notice Stores the seed after checking the KMS decryption proof (anyone can submit it: the
    ///         proof binds the value to the handle, so a forged seed reverts).
    /// @param skillRef The published version.
    /// @param abiEncodedClearValues ABI-encoded seed (one uint256), as the relayer returns it.
    /// @param decryptionProof KMS signatures from the relayer's public decryption.
    function finalize(bytes32 skillRef, bytes calldata abiEncodedClearValues, bytes calldata decryptionProof) external {
        Benchmark storage b = _benchmarks[skillRef];
        if (b.status != Status.Publishing) revert WrongStatus(b.status);
        bytes32[] memory handles = new bytes32[](1);
        handles[0] = euint64.unwrap(_seeds[skillRef]);
        FHE.checkSignatures(handles, abiEncodedClearValues, decryptionProof);
        uint64 seed = uint64(abi.decode(abiEncodedClearValues, (uint256)));
        b.seed = seed;
        b.status = Status.Revealed;
        emit Revealed(skillRef, seed, b.forced);
    }

    /// @notice The public benchmark record.
    function getBenchmark(bytes32 skillRef) external view returns (Benchmark memory) {
        return _benchmarks[skillRef];
    }

    /// @notice The seed ciphertext handle (bytes32(0) before commit). Only the operator can decrypt it
    ///         until it is published or forced open.
    function seedHandle(bytes32 skillRef) external view returns (bytes32) {
        return euint64.unwrap(_seeds[skillRef]);
    }

    /// @notice The six 10-bit pick values of a revealed seed; reverts before the reveal.
    function seedsOf(bytes32 skillRef) external view returns (uint16[6] memory) {
        Benchmark storage b = _benchmarks[skillRef];
        if (b.status != Status.Revealed) revert NotRevealed(skillRef);
        return splitSeed(b.seed);
    }

    /// @notice Splits a seed into its six pick values: value i is bits [10*i, 10*i + 10). Off-chain,
    ///         value v picks map `(v >> 1) % maps` and difficulty `v & 1` (benchmarkSeedPicks).
    function splitSeed(uint64 seed) public pure returns (uint16[6] memory values) {
        for (uint256 i = 0; i < SEED_COUNT; i++) {
            values[i] = uint16((seed >> (SEED_BITS * i)) & ((uint64(1) << SEED_BITS) - 1));
        }
    }

    function _setOperator(address operator_) private {
        if (operator_ == address(0)) revert ZeroAddress();
        operator = operator_;
        emit OperatorSet(operator_);
    }

    function _setRevealWindow(uint64 revealWindow_) private {
        if (revealWindow_ < MIN_REVEAL_WINDOW || revealWindow_ > MAX_REVEAL_WINDOW) revert InvalidRevealWindow(revealWindow_);
        revealWindow = revealWindow_;
        emit RevealWindowSet(revealWindow_);
    }
}
