// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {FHE, ebool, euint16, euint64, externalEuint64} from "@fhevm/solidity/lib/FHE.sol";
import {ZamaEthereumConfig} from "@fhevm/solidity/config/ZamaConfig.sol";
import {IERC7984} from "@openzeppelin/confidential-contracts/interfaces/IERC7984.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";

/// @title SkillAuction
/// @author skirm
/// @notice Sealed-bid (Vickrey, second-price) auctions of skirm skill licenses on the Exchange, paid
///         in cSKIRM (ERC-7984). Bids are FHE ciphertexts escrowed in this contract: nobody, the
///         seller included, can read a bid while the auction runs or after it ends. At close only two
///         numbers become public: who won and the clearing price. Losing bids are refunded
///         confidentially and their amounts are never revealed.
/// @dev Design.
///      - One sealed bid per address, which can only grow. `bid` pulls the encrypted amount into
///        escrow with `confidentialTransferFrom` (the bidder first makes this contract a cSKIRM
///        operator) and adds what was *actually transferred* to the bidder's total. ERC-7984 moves
///        0 instead of reverting on a short balance, so an unfunded bid silently counts as 0 and
///        nobody, the bidder included, learns more than "my escrow did not grow". A raise is a
///        second `bid` call; there is no replace-and-refund, so the running ranking never has to
///        forget a value.
///      - The contract keeps the two highest totals and the winner's index under FHE, updated in
///        O(1) per bid (no loop over bidders): with `t` the bidder's new total, `i` its 1-based
///        index, `beats = t > first` and `isFirst = (firstIdx == i)`:
///            first'    = max(first, t)               (if i is already first, t >= first)
///            firstIdx' = beats ? i : firstIdx        (if i is already first, both sides are i)
///            second'   = isFirst ? second : (beats ? first : max(second, t))
///        Strict `>` breaks ties for the earlier bidder; the tied value becomes the price.
///      - Second price: the winner pays `max(second, reserve)`, the runner-up's bid or the reserve
///        when it is higher. Truthful bidding is the dominant strategy, which suits a sealed market
///        (nobody gains from guessing the others). The reserve is public or an encrypted input; an
///        encrypted reserve is only learned if it ends up being the clearing price.
///      - `close` (anyone, after `endTime`) computes `met = first >= reserve`, then opens exactly two
///        handles for public decryption: `met ? firstIdx : 0` and `met ? price : 0`. A failed
///        auction (no winner, or the best bid below the reserve) reveals two zeros and nothing else.
///        No bids at all: the auction fails right away, with nothing to decrypt.
///      - `finalize` checks the KMS proof (`FHE.checkSignatures`), records the winner and price and
///        pays the seller `price - fee` and the treasury `fee` (both public, since the price is).
///        It emits `Won`, which the off-chain Exchange watches to grant the buyer the license.
///      - Refunds are pulled per bidder (`refund`, callable by anyone, always paid to the bidder) so
///        finalize stays O(1) under the per-transaction HCU limit. A loser gets its whole escrow
///        back, the winner gets `total - price` back; both as ciphertexts.
///      ACL: each bidder's total is readable by that bidder (user decryption) and this contract only.
///      The running top-two values, the winner index and the reserve are readable by this contract
///      only. The seller gets access to nothing it could use to probe bids.
contract SkillAuction is ZamaEthereumConfig, Ownable2Step {
    /// @notice Highest treasury fee, in basis points of the clearing price (10%).
    uint16 public constant MAX_FEE_BPS = 1000;
    /// @notice Shortest and longest auction.
    uint64 public constant MIN_DURATION = 1 minutes;
    uint64 public constant MAX_DURATION = 30 days;
    /// @notice Most bidders per auction (the winner index is a euint16; index 0 means nobody).
    uint16 public constant MAX_BIDDERS = 1000;

    /// @notice Lifecycle. None → Open → Closing (decryption requested) → Won or Failed.
    enum Status {
        None,
        Open,
        Closing,
        Won,
        Failed
    }

    /// @notice Public auction record.
    /// @param seller Who started it and gets paid.
    /// @param skillRef Opaque reference to the off-chain skill version (see `skillRef` in
    ///        packages/shared/src/sealed-auction.ts: keccak256 of "skirm-skill:<skillId>:<version>").
    /// @param endTime No bid lands at or after this timestamp.
    /// @param status Lifecycle step.
    /// @param feeBps Treasury fee on the clearing price, fixed when the auction was created.
    /// @param reserveEncrypted True when the reserve is a ciphertext (then `reserve` is 0).
    /// @param reserve The public reserve price (base units), when not encrypted.
    /// @param bidders Distinct bidders so far ("N sealed bids": the count is public, amounts are not).
    /// @param winner The winning bidder once `Won`, else address(0).
    /// @param price The clearing price once `Won`, else 0.
    struct AuctionInfo {
        address seller;
        bytes32 skillRef;
        uint64 endTime;
        Status status;
        uint16 feeBps;
        bool reserveEncrypted;
        uint64 reserve;
        uint16 bidders;
        address winner;
        uint64 price;
    }

    /// @dev Encrypted ranking state, readable by this contract only.
    struct Sealed {
        euint64 reserve;
        euint64 first;
        euint64 second;
        euint16 firstIdx;
        /// The two handles `close` opens: winner index (0 = none) and clearing price (0 = none).
        euint16 revealIdx;
        euint64 revealPrice;
    }

    /// @notice The cSKIRM token bids are paid in.
    IERC7984 public immutable credits;
    /// @notice Fee recipient (address(0) for none).
    address public treasury;
    /// @notice Fee on the clearing price in basis points for new auctions.
    uint16 public feeBps;
    /// @notice Id the next auction gets (ids start at 1).
    uint256 public nextAuctionId = 1;

    mapping(uint256 auctionId => AuctionInfo) private _auctions;
    mapping(uint256 auctionId => Sealed) private _sealed;
    mapping(uint256 auctionId => address[]) private _bidders;
    /// @dev 1-based index of each bidder in `_bidders` (0 = has not bid).
    mapping(uint256 auctionId => mapping(address bidder => uint16)) private _index;
    mapping(uint256 auctionId => mapping(address bidder => euint64)) private _escrow;
    mapping(uint256 auctionId => mapping(address bidder => bool)) private _refunded;

    /// @notice A seller started an auction.
    event AuctionCreated(uint256 indexed auctionId, address indexed seller, bytes32 indexed skillRef, uint64 endTime, bool reserveEncrypted, uint64 reserve);
    /// @notice `bidder` placed or raised its sealed bid. `totalHandle` is its escrow total (only it can decrypt).
    event BidPlaced(uint256 indexed auctionId, address indexed bidder, uint16 bidders, bytes32 totalHandle);
    /// @notice The auction ended and its outcome was opened for public decryption.
    event CloseRequested(uint256 indexed auctionId, bytes32 winnerIndexHandle, bytes32 priceHandle);
    /// @notice The auction sold: the Exchange grants `winner` the skill license referenced by `skillRef`.
    event Won(uint256 indexed auctionId, bytes32 indexed skillRef, address indexed winner, address seller, uint64 price);
    /// @notice The auction ended without a sale (no bids, or the best bid below the reserve).
    event Failed(uint256 indexed auctionId, bytes32 indexed skillRef);
    /// @notice A bidder's escrow went back to it. `amountHandle` is the refunded ciphertext.
    event Refunded(uint256 indexed auctionId, address indexed bidder, bytes32 amountHandle);
    /// @notice The owner changed the fee terms for new auctions.
    event FeeSet(address indexed treasury, uint16 feeBps);

    error ZeroAddress();
    error InvalidFee(uint16 feeBps);
    error InvalidSkillRef();
    error InvalidEndTime(uint64 endTime);
    error UnknownAuction(uint256 auctionId);
    error WrongStatus(Status status);
    error AuctionEnded(uint64 endTime);
    error AuctionStillOpen(uint64 endTime);
    error SellerCannotBid();
    error TooManyBidders();
    error NotABidder(address bidder);
    error AlreadyRefunded(address bidder);

    /// @param credits_ The cSKIRM token.
    /// @param treasury_ Fee recipient (address(0) for none).
    /// @param feeBps_ Fee on the clearing price, at most MAX_FEE_BPS.
    constructor(IERC7984 credits_, address treasury_, uint16 feeBps_) Ownable(msg.sender) {
        if (address(credits_) == address(0)) revert ZeroAddress();
        if (feeBps_ > MAX_FEE_BPS) revert InvalidFee(feeBps_);
        credits = credits_;
        treasury = treasury_;
        feeBps = feeBps_;
        emit FeeSet(treasury_, feeBps_);
    }

    /// @notice Changes the fee terms for auctions created from now on.
    function setFee(address treasury_, uint16 feeBps_) external onlyOwner {
        if (feeBps_ > MAX_FEE_BPS) revert InvalidFee(feeBps_);
        treasury = treasury_;
        feeBps = feeBps_;
        emit FeeSet(treasury_, feeBps_);
    }

    /// @notice Starts an auction with a public reserve price.
    /// @param skillRef The off-chain skill version being sold (nonzero).
    /// @param endTime When bidding closes (MIN_DURATION..MAX_DURATION from now).
    /// @param reserve Lowest acceptable clearing price, in cSKIRM base units (0 for none).
    /// @return auctionId The new auction's id.
    function createAuction(bytes32 skillRef, uint64 endTime, uint64 reserve) external returns (uint256 auctionId) {
        auctionId = _create(skillRef, endTime, FHE.asEuint64(reserve), false, reserve);
    }

    /// @notice Starts an auction with an encrypted reserve price: bidders cannot aim just above it.
    /// @param skillRef The off-chain skill version being sold (nonzero).
    /// @param endTime When bidding closes (MIN_DURATION..MAX_DURATION from now).
    /// @param encryptedReserve Encrypted input (for this contract and the caller).
    /// @param inputProof Proof attached to the encrypted input.
    /// @return auctionId The new auction's id.
    function createAuctionSealedReserve(
        bytes32 skillRef,
        uint64 endTime,
        externalEuint64 encryptedReserve,
        bytes calldata inputProof
    ) external returns (uint256 auctionId) {
        euint64 reserve = FHE.fromExternal(encryptedReserve, inputProof);
        FHE.allow(reserve, msg.sender);
        auctionId = _create(skillRef, endTime, reserve, true, 0);
    }

    /// @notice Places, or raises, the caller's sealed bid. The amount is pulled into escrow; a short
    ///         balance moves 0 (ERC-7984 semantics), so only what actually arrived counts.
    /// @dev The caller must have made this contract a cSKIRM operator (`setOperator`).
    /// @param auctionId The auction.
    /// @param encryptedAmount Encrypted amount to add (input for this contract and the caller).
    /// @param inputProof Proof attached to the encrypted input.
    function bid(uint256 auctionId, externalEuint64 encryptedAmount, bytes calldata inputProof) external {
        AuctionInfo storage a = _require(auctionId);
        if (a.status != Status.Open) revert WrongStatus(a.status);
        if (block.timestamp >= a.endTime) revert AuctionEnded(a.endTime);
        if (msg.sender == a.seller) revert SellerCannotBid();

        uint16 idx = _index[auctionId][msg.sender];
        bool existing = idx != 0;
        if (!existing) {
            if (a.bidders >= MAX_BIDDERS) revert TooManyBidders();
            _bidders[auctionId].push(msg.sender);
            idx = ++a.bidders;
            _index[auctionId][msg.sender] = idx;
        }

        euint64 amount = FHE.fromExternal(encryptedAmount, inputProof);
        FHE.allowTransient(amount, address(credits));
        // Reverts only without operator approval (public anyway); a short balance moves 0.
        euint64 transferred = credits.confidentialTransferFrom(msg.sender, address(this), amount);
        euint64 total = existing ? FHE.add(_escrow[auctionId][msg.sender], transferred) : transferred;
        FHE.allowThis(total);
        FHE.allow(total, msg.sender);
        _escrow[auctionId][msg.sender] = total;

        Sealed storage s = _sealed[auctionId];
        ebool beats = FHE.gt(total, s.first);
        euint64 runnerUp = FHE.select(beats, s.first, FHE.max(s.second, total));
        if (existing) runnerUp = FHE.select(FHE.eq(s.firstIdx, idx), s.second, runnerUp);
        s.second = runnerUp;
        s.first = FHE.max(s.first, total);
        s.firstIdx = FHE.select(beats, FHE.asEuint16(idx), s.firstIdx);
        FHE.allowThis(s.first);
        FHE.allowThis(s.second);
        FHE.allowThis(s.firstIdx);

        emit BidPlaced(auctionId, msg.sender, a.bidders, euint64.unwrap(total));
    }

    /// @notice Ends the auction once `endTime` has passed (anyone can call it). With no bids it fails
    ///         at once; otherwise the winner index and the clearing price (both 0 if the reserve was
    ///         not met) are opened for public decryption, to be submitted to `finalize`.
    /// @param auctionId The auction.
    function close(uint256 auctionId) external {
        AuctionInfo storage a = _require(auctionId);
        if (a.status != Status.Open) revert WrongStatus(a.status);
        if (block.timestamp < a.endTime) revert AuctionStillOpen(a.endTime);
        if (a.bidders == 0) {
            a.status = Status.Failed;
            emit Failed(auctionId, a.skillRef);
            return;
        }
        a.status = Status.Closing;
        Sealed storage s = _sealed[auctionId];
        ebool met = FHE.ge(s.first, s.reserve);
        euint64 price = FHE.max(s.second, s.reserve);
        s.revealIdx = FHE.select(met, s.firstIdx, FHE.asEuint16(0));
        s.revealPrice = FHE.select(met, price, FHE.asEuint64(0));
        FHE.allowThis(s.revealIdx);
        FHE.allowThis(s.revealPrice);
        FHE.makePubliclyDecryptable(s.revealIdx);
        FHE.makePubliclyDecryptable(s.revealPrice);
        emit CloseRequested(auctionId, euint16.unwrap(s.revealIdx), euint64.unwrap(s.revealPrice));
    }

    /// @notice Records the outcome after checking the KMS decryption proof, and pays the seller.
    /// @dev Anyone can submit it: the proof binds the values to the handles, so a forged value reverts.
    /// @param auctionId The auction.
    /// @param abiEncodedClearValues ABI-encoded (winner index, price), in `revealHandles` order.
    /// @param decryptionProof KMS signatures from the relayer's public decryption.
    function finalize(uint256 auctionId, bytes calldata abiEncodedClearValues, bytes calldata decryptionProof) external {
        AuctionInfo storage a = _require(auctionId);
        if (a.status != Status.Closing) revert WrongStatus(a.status);
        FHE.checkSignatures(revealHandles(auctionId), abiEncodedClearValues, decryptionProof);
        (uint256 idx, uint256 price) = abi.decode(abiEncodedClearValues, (uint256, uint256));

        if (idx == 0) {
            a.status = Status.Failed;
            emit Failed(auctionId, a.skillRef);
            return;
        }
        address winner = _bidders[auctionId][idx - 1];
        a.status = Status.Won;
        a.winner = winner;
        a.price = uint64(price);

        uint64 fee = treasury == address(0) ? 0 : uint64((price * a.feeBps) / 10_000);
        if (fee != 0) _send(treasury, FHE.asEuint64(fee));
        _send(a.seller, FHE.asEuint64(uint64(price) - fee));
        emit Won(auctionId, a.skillRef, winner, a.seller, uint64(price));
    }

    /// @notice Sends `bidder` its escrow back once the auction is over (anyone can call it; the
    ///         credits always go to the bidder). A loser gets its whole bid, the winner `bid - price`.
    /// @param auctionId The auction.
    /// @param bidder The bidder to refund.
    function refund(uint256 auctionId, address bidder) external {
        AuctionInfo storage a = _require(auctionId);
        if (a.status != Status.Won && a.status != Status.Failed) revert WrongStatus(a.status);
        if (_index[auctionId][bidder] == 0) revert NotABidder(bidder);
        if (_refunded[auctionId][bidder]) revert AlreadyRefunded(bidder);
        _refunded[auctionId][bidder] = true;
        euint64 amount = _escrow[auctionId][bidder];
        if (bidder == a.winner) amount = FHE.sub(amount, a.price);
        FHE.allowThis(amount);
        FHE.allow(amount, bidder);
        euint64 sent = _send(bidder, amount);
        emit Refunded(auctionId, bidder, euint64.unwrap(sent));
    }

    /// @notice The public auction record.
    function getAuction(uint256 auctionId) external view returns (AuctionInfo memory) {
        return _auctions[auctionId];
    }

    /// @notice Everyone who bid, in bid order (addresses are public as transaction senders anyway).
    function biddersOf(uint256 auctionId) external view returns (address[] memory) {
        return _bidders[auctionId];
    }

    /// @notice `bidder`'s escrow total handle (bytes32(0) if it never bid). Only the bidder can decrypt it.
    function bidOf(uint256 auctionId, address bidder) external view returns (bytes32) {
        return euint64.unwrap(_escrow[auctionId][bidder]);
    }

    /// @notice Whether `bidder` already got its refund.
    function refunded(uint256 auctionId, address bidder) external view returns (bool) {
        return _refunded[auctionId][bidder];
    }

    /// @notice The encrypted reserve handle (only the seller and this contract can decrypt it).
    function reserveHandle(uint256 auctionId) external view returns (bytes32) {
        return euint64.unwrap(_sealed[auctionId].reserve);
    }

    /// @notice The two handles `close` opens, in `finalize` order: winner index (1-based, 0 = no
    ///         sale) and clearing price. Zero handles before `close`.
    function revealHandles(uint256 auctionId) public view returns (bytes32[] memory handles) {
        Sealed storage s = _sealed[auctionId];
        handles = new bytes32[](2);
        handles[0] = euint16.unwrap(s.revealIdx);
        handles[1] = euint64.unwrap(s.revealPrice);
    }

    function _require(uint256 auctionId) private view returns (AuctionInfo storage a) {
        a = _auctions[auctionId];
        if (a.status == Status.None) revert UnknownAuction(auctionId);
    }

    function _create(bytes32 skillRef, uint64 endTime, euint64 reserve, bool encrypted, uint64 clearReserve) private returns (uint256 auctionId) {
        if (skillRef == bytes32(0)) revert InvalidSkillRef();
        if (endTime < block.timestamp + MIN_DURATION || endTime > block.timestamp + MAX_DURATION) revert InvalidEndTime(endTime);
        auctionId = nextAuctionId++;
        _auctions[auctionId] = AuctionInfo({
            seller: msg.sender,
            skillRef: skillRef,
            endTime: endTime,
            status: Status.Open,
            feeBps: feeBps,
            reserveEncrypted: encrypted,
            reserve: clearReserve,
            bidders: 0,
            winner: address(0),
            price: 0
        });
        Sealed storage s = _sealed[auctionId];
        s.reserve = reserve;
        s.first = FHE.asEuint64(0);
        s.second = FHE.asEuint64(0);
        s.firstIdx = FHE.asEuint16(0);
        FHE.allowThis(s.reserve);
        FHE.allowThis(s.first);
        FHE.allowThis(s.second);
        FHE.allowThis(s.firstIdx);
        emit AuctionCreated(auctionId, msg.sender, skillRef, endTime, encrypted, clearReserve);
    }

    /// @dev Confidential transfer out of escrow.
    function _send(address to, euint64 amount) private returns (euint64 sent) {
        FHE.allowTransient(amount, address(credits));
        sent = credits.confidentialTransfer(to, amount);
    }
}
