import { FhevmType } from "@fhevm/hardhat-plugin";
import { time } from "@nomicfoundation/hardhat-network-helpers";
import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { expect } from "chai";
import type { ContractTransactionResponse, TransactionReceipt } from "ethers";
import { ethers, fhevm } from "hardhat";

import { auctionPayout, skillRefPreimage, vickreyOutcome } from "../../shared/src/sealed-auction";
import type { ConfidentialSkirmCredits, SkillAuction } from "../types";

const UNIT = 10n ** 6n; // cSKIRM has 6 decimals
const FAUCET = 1_000n * UNIT;
const FEE_BPS = 250; // 2.5% of the clearing price
const DURATION = 60n * 60n;
const Status = { None: 0n, Open: 1n, Closing: 2n, Won: 3n, Failed: 4n };
const SKILL_REF = ethers.id(skillRefPreimage("skl_sealed", 3));

/** Gas and HCU per call, printed after the suite (the numbers in the README come from here). */
const report = new Map<string, { gas: bigint; hcu: number; depth: number; n: number }>();

async function measure(label: string, tx: Promise<ContractTransactionResponse>): Promise<TransactionReceipt> {
  const receipt = (await (await tx).wait())!;
  const hcu = fhevm.computeTransactionHCU(receipt);
  const prev = report.get(label);
  const gas = receipt.gasUsed;
  if (!prev || gas > prev.gas) report.set(label, { gas, hcu: hcu.globalHCU, depth: hcu.maxHCUDepth, n: (prev?.n ?? 0) + 1 });
  else prev.n++;
  return receipt;
}

describe("SkillAuction", function () {
  let owner: HardhatEthersSigner;
  let seller: HardhatEthersSigner;
  let alice: HardhatEthersSigner;
  let bob: HardhatEthersSigner;
  let carol: HardhatEthersSigner;
  let eve: HardhatEthersSigner;
  let treasury: HardhatEthersSigner;
  let credits: ConfidentialSkirmCredits;
  let creditsAddress: string;
  let auction: SkillAuction;
  let address: string;

  async function balanceOf(who: HardhatEthersSigner): Promise<bigint> {
    const handle = await credits.confidentialBalanceOf(who.address);
    if (handle === ethers.ZeroHash) return 0n;
    return fhevm.userDecryptEuint(FhevmType.euint64, handle, creditsAddress, who);
  }

  async function approve(who: HardhatEthersSigner) {
    const until = (await time.latest()) + 7 * 24 * 3600;
    await (await credits.connect(who).setOperator(address, until)).wait();
  }

  async function create(reserve = 0n): Promise<bigint> {
    const id = await auction.nextAuctionId();
    const end = BigInt(await time.latest()) + DURATION;
    await measure("createAuction (public reserve)", auction.connect(seller).createAuction(SKILL_REF, end, reserve));
    return id;
  }

  async function createSealedReserve(reserve: bigint): Promise<bigint> {
    const id = await auction.nextAuctionId();
    const end = BigInt(await time.latest()) + DURATION;
    const enc = await fhevm.createEncryptedInput(address, seller.address).add64(reserve).encrypt();
    await measure(
      "createAuctionSealedReserve",
      auction.connect(seller).createAuctionSealedReserve(SKILL_REF, end, enc.handles[0]!, enc.inputProof),
    );
    return id;
  }

  async function bid(id: bigint, who: HardhatEthersSigner, amount: bigint) {
    const enc = await fhevm.createEncryptedInput(address, who.address).add64(amount).encrypt();
    const first = (await auction.bidOf(id, who.address)) === ethers.ZeroHash;
    return measure(first ? "bid (first)" : "bid (raise)", auction.connect(who).bid(id, enc.handles[0]!, enc.inputProof));
  }

  async function closeAndFinalize(id: bigint) {
    await time.increase(DURATION);
    await measure("close", auction.close(id));
    const res = await fhevm.publicDecrypt([...(await auction.revealHandles(id))]);
    const [idx] = ethers.AbiCoder.defaultAbiCoder().decode(["uint256", "uint256"], res.abiEncodedClearValues);
    return measure(idx === 0n ? "finalize (fails)" : "finalize (sells)", auction.finalize(id, res.abiEncodedClearValues, res.decryptionProof));
  }

  const myBid = (id: bigint, who: HardhatEthersSigner) =>
    auction.bidOf(id, who.address).then((h) => fhevm.userDecryptEuint(FhevmType.euint64, h, address, who));

  before(async function () {
    [owner, seller, alice, bob, carol, eve, treasury] = await ethers.getSigners();
  });

  beforeEach(async function () {
    if (!fhevm.isMock) {
      console.warn("SkillAuction tests need the FHEVM mock (hardhat network)");
      this.skip();
    }
    credits = await (await ethers.getContractFactory("ConfidentialSkirmCredits")).deploy(owner.address, FAUCET, 0n);
    creditsAddress = await credits.getAddress();
    auction = await (await ethers.getContractFactory("SkillAuction")).deploy(creditsAddress, treasury.address, FEE_BPS);
    address = await auction.getAddress();
    for (const p of [alice, bob, carol]) {
      await (await credits.connect(p).claimFaucet()).wait();
      await approve(p);
    }
  });

  after(function () {
    if (report.size === 0) return;
    console.log("\n    SkillAuction gas / HCU (FHEVM mock, worst case seen):");
    for (const [label, r] of report) {
      console.log(`      ${label.padEnd(34)} gas ${r.gas.toString().padStart(9)}   HCU ${String(r.hcu).padStart(9)}   depth ${String(r.depth).padStart(8)}`);
    }
  });

  describe("deployment", function () {
    it("records the token and fee terms, and validates them", async function () {
      expect(await auction.credits()).to.eq(creditsAddress);
      expect(await auction.treasury()).to.eq(treasury.address);
      expect(await auction.feeBps()).to.eq(BigInt(FEE_BPS));
      const factory = await ethers.getContractFactory("SkillAuction");
      await expect(factory.deploy(ethers.ZeroAddress, treasury.address, 0)).to.be.revertedWithCustomError(auction, "ZeroAddress");
      await expect(factory.deploy(creditsAddress, treasury.address, 1001)).to.be.revertedWithCustomError(auction, "InvalidFee");
    });

    it("lets only the owner change the fee", async function () {
      await expect(auction.connect(eve).setFee(eve.address, 0)).to.be.revertedWithCustomError(auction, "OwnableUnauthorizedAccount");
      await expect(auction.setFee(eve.address, 100)).to.emit(auction, "FeeSet").withArgs(eve.address, 100);
      await expect(auction.setFee(eve.address, 1001)).to.be.revertedWithCustomError(auction, "InvalidFee");
    });
  });

  describe("create", function () {
    it("opens an auction with a public reserve", async function () {
      const end = BigInt(await time.latest()) + DURATION;
      await expect(auction.connect(seller).createAuction(SKILL_REF, end, 5n * UNIT))
        .to.emit(auction, "AuctionCreated")
        .withArgs(1n, seller.address, SKILL_REF, end, false, 5n * UNIT);
      const a = await auction.getAuction(1n);
      expect(a.seller).to.eq(seller.address);
      expect(a.status).to.eq(Status.Open);
      expect(a.feeBps).to.eq(BigInt(FEE_BPS));
      expect(a.bidders).to.eq(0n);
    });

    it("keeps an encrypted reserve readable by the seller only", async function () {
      const id = await createSealedReserve(40n * UNIT);
      const a = await auction.getAuction(id);
      expect(a.reserveEncrypted).to.eq(true);
      expect(a.reserve).to.eq(0n);
      const h = await auction.reserveHandle(id);
      expect(await fhevm.userDecryptEuint(FhevmType.euint64, h, address, seller)).to.eq(40n * UNIT);
      await expect(fhevm.userDecryptEuint(FhevmType.euint64, h, address, alice)).to.be.rejected;
      await expect(fhevm.publicDecrypt([h])).to.be.rejected;
    });

    it("rejects an empty skill reference and an out-of-range end time", async function () {
      const now = BigInt(await time.latest());
      await expect(auction.connect(seller).createAuction(ethers.ZeroHash, now + DURATION, 0n)).to.be.revertedWithCustomError(auction, "InvalidSkillRef");
      await expect(auction.connect(seller).createAuction(SKILL_REF, now + 10n, 0n)).to.be.revertedWithCustomError(auction, "InvalidEndTime");
      await expect(auction.connect(seller).createAuction(SKILL_REF, now + 31n * 86400n, 0n)).to.be.revertedWithCustomError(auction, "InvalidEndTime");
    });
  });

  describe("bidding", function () {
    it("escrows each sealed bid and lets only its bidder read it", async function () {
      const id = await create();
      await bid(id, alice, 30n * UNIT);
      await bid(id, bob, 50n * UNIT);
      const a = await auction.getAuction(id);
      expect(a.bidders).to.eq(2n);
      expect(await auction.biddersOf(id)).to.deep.eq([alice.address, bob.address]);
      expect(await balanceOf(alice)).to.eq(FAUCET - 30n * UNIT);
      expect(await myBid(id, alice)).to.eq(30n * UNIT);

      const h = await auction.bidOf(id, alice.address);
      for (const who of [bob, seller, eve]) {
        await expect(fhevm.userDecryptEuint(FhevmType.euint64, h, address, who)).to.be.rejected;
      }
      await expect(fhevm.publicDecrypt([h])).to.be.rejected;
    });

    it("adds a raise to the bidder's total without a second bidder slot", async function () {
      const id = await create();
      await bid(id, alice, 20n * UNIT);
      await bid(id, alice, 15n * UNIT);
      expect((await auction.getAuction(id)).bidders).to.eq(1n);
      expect(await myBid(id, alice)).to.eq(35n * UNIT);
    });

    it("counts a bid beyond the balance as 0 (ERC-7984 moves nothing)", async function () {
      const id = await create();
      await bid(id, alice, 5_000n * UNIT);
      expect(await myBid(id, alice)).to.eq(0n);
      expect(await balanceOf(alice)).to.eq(FAUCET);
      await bid(id, bob, 1n * UNIT);
      await closeAndFinalize(id);
      const a = await auction.getAuction(id);
      expect(a.winner).to.eq(bob.address);
      expect(a.price).to.eq(0n); // runner-up bid counted as 0 and no reserve
    });

    it("reverts without operator approval, for the seller, and after the end", async function () {
      const id = await create();
      const enc = await fhevm.createEncryptedInput(address, eve.address).add64(1n).encrypt();
      await expect(auction.connect(eve).bid(id, enc.handles[0]!, enc.inputProof)).to.be.revertedWithCustomError(credits, "ERC7984UnauthorizedSpender");
      const encS = await fhevm.createEncryptedInput(address, seller.address).add64(1n).encrypt();
      await expect(auction.connect(seller).bid(id, encS.handles[0]!, encS.inputProof)).to.be.revertedWithCustomError(auction, "SellerCannotBid");
      await time.increase(DURATION);
      await expect(bid(id, alice, UNIT)).to.be.revertedWithCustomError(auction, "AuctionEnded");
      await expect(bid(99n, alice, UNIT)).to.be.revertedWithCustomError(auction, "UnknownAuction");
    });

    it("rejects an input proof made for another account", async function () {
      const id = await create();
      const enc = await fhevm.createEncryptedInput(address, bob.address).add64(UNIT).encrypt();
      await expect(auction.connect(alice).bid(id, enc.handles[0]!, enc.inputProof)).to.be.reverted;
    });
  });

  describe("close and finalize", function () {
    it("sells to the highest bid at the second price and reveals only winner and price", async function () {
      const id = await create(10n * UNIT);
      const bids: [HardhatEthersSigner, bigint][] = [
        [alice, 30n * UNIT],
        [bob, 80n * UNIT],
        [carol, 55n * UNIT],
      ];
      for (const [who, amount] of bids) await bid(id, who, amount);
      await expect(auction.close(id)).to.be.revertedWithCustomError(auction, "AuctionStillOpen");

      await time.increase(DURATION);
      await expect(auction.connect(eve).close(id)).to.emit(auction, "CloseRequested");
      expect((await auction.getAuction(id)).status).to.eq(Status.Closing);
      await expect(bid(id, alice, UNIT)).to.be.revertedWithCustomError(auction, "WrongStatus");

      const res = await fhevm.publicDecrypt([...(await auction.revealHandles(id))]);
      const expected = vickreyOutcome(bids.map(([, b]) => b), 10n * UNIT);
      const [idx, price] = ethers.AbiCoder.defaultAbiCoder().decode(["uint256", "uint256"], res.abiEncodedClearValues);
      expect(idx).to.eq(BigInt(expected.winner! + 1));
      expect(price).to.eq(expected.price);

      await expect(auction.connect(eve).finalize(id, res.abiEncodedClearValues, res.decryptionProof))
        .to.emit(auction, "Won")
        .withArgs(id, SKILL_REF, bob.address, seller.address, 55n * UNIT);
      const a = await auction.getAuction(id);
      expect(a.status).to.eq(Status.Won);
      expect(a.winner).to.eq(bob.address);
      expect(a.price).to.eq(55n * UNIT);

      const { fee, seller: net } = auctionPayout(55n * UNIT, FEE_BPS);
      expect(await balanceOf(seller)).to.eq(net);
      expect(await balanceOf(treasury)).to.eq(fee);

      // Losing bids stay sealed after the sale: no public decryption, no access for others.
      for (const [who] of [bids[0]!, bids[2]!]) {
        const h = await auction.bidOf(id, who.address);
        await expect(fhevm.publicDecrypt([h])).to.be.rejected;
        await expect(fhevm.userDecryptEuint(FhevmType.euint64, h, address, seller)).to.be.rejected;
        await expect(fhevm.userDecryptEuint(FhevmType.euint64, h, address, bob)).to.be.rejected;
      }

      // Refunds: losers get everything back, the winner its bid minus the price.
      for (const who of [alice, bob, carol]) await measure("refund", auction.connect(eve).refund(id, who.address));
      expect(await balanceOf(alice)).to.eq(FAUCET);
      expect(await balanceOf(carol)).to.eq(FAUCET);
      expect(await balanceOf(bob)).to.eq(FAUCET - 55n * UNIT);
      await expect(auction.refund(id, alice.address)).to.be.revertedWithCustomError(auction, "AlreadyRefunded");
      await expect(auction.refund(id, eve.address)).to.be.revertedWithCustomError(auction, "NotABidder");
    });

    it("tracks the top two when the leader and the runner-up raise", async function () {
      const id = await create();
      await bid(id, alice, 40n * UNIT);
      await bid(id, bob, 30n * UNIT);
      await bid(id, alice, 20n * UNIT); // leader raises: 60 vs 30
      await bid(id, bob, 50n * UNIT); // runner-up overtakes: 80 vs 60
      await bid(id, carol, 70n * UNIT); // new second: 80, 70
      await closeAndFinalize(id);
      const a = await auction.getAuction(id);
      expect(a.winner).to.eq(bob.address);
      expect(a.price).to.eq(70n * UNIT);
    });

    it("charges the reserve when only one bid clears it", async function () {
      const id = await create(25n * UNIT);
      await bid(id, alice, 60n * UNIT);
      await closeAndFinalize(id);
      const a = await auction.getAuction(id);
      expect(a.winner).to.eq(alice.address);
      expect(a.price).to.eq(25n * UNIT);
      await auction.refund(id, alice.address);
      expect(await balanceOf(alice)).to.eq(FAUCET - 25n * UNIT);
    });

    it("fails below an encrypted reserve, reveals nothing and refunds every bid", async function () {
      const id = await createSealedReserve(100n * UNIT);
      await bid(id, alice, 60n * UNIT);
      await bid(id, bob, 90n * UNIT);
      await time.increase(DURATION);
      await auction.close(id);
      const res = await fhevm.publicDecrypt([...(await auction.revealHandles(id))]);
      const [idx, price] = ethers.AbiCoder.defaultAbiCoder().decode(["uint256", "uint256"], res.abiEncodedClearValues);
      expect([idx, price]).to.deep.eq([0n, 0n]);
      const failed = await measure("finalize (fails)", auction.finalize(id, res.abiEncodedClearValues, res.decryptionProof));
      expect(failed.logs.map((l) => auction.interface.parseLog(l)?.name)).to.include("Failed");
      expect((await auction.getAuction(id)).status).to.eq(Status.Failed);
      for (const who of [alice, bob]) await auction.refund(id, who.address);
      expect(await balanceOf(alice)).to.eq(FAUCET);
      expect(await balanceOf(bob)).to.eq(FAUCET);
      expect(await balanceOf(seller)).to.eq(0n);
    });

    it("fails at once with no bids, with nothing to decrypt", async function () {
      const id = await create(1n);
      await time.increase(DURATION);
      await expect(measure("close (no bids)", auction.close(id))).to.not.be.reverted;
      const a = await auction.getAuction(id);
      expect(a.status).to.eq(Status.Failed);
      await expect(auction.close(id)).to.be.revertedWithCustomError(auction, "WrongStatus");
      await expect(auction.finalize(id, "0x", "0x")).to.be.revertedWithCustomError(auction, "WrongStatus");
    });

    it("rejects a forged outcome and a missing proof, then a second finalize", async function () {
      const id = await create();
      await bid(id, alice, 30n * UNIT);
      await bid(id, bob, 20n * UNIT);
      await time.increase(DURATION);
      await expect(auction.finalize(id, "0x", "0x")).to.be.revertedWithCustomError(auction, "WrongStatus");
      await auction.close(id);
      const res = await fhevm.publicDecrypt([...(await auction.revealHandles(id))]);
      const coder = ethers.AbiCoder.defaultAbiCoder();
      // Claim bob won at a price of 1: the KMS signatures do not cover these values.
      const forged = coder.encode(["uint256", "uint256"], [2n, 1n]);
      await expect(auction.finalize(id, forged, res.decryptionProof)).to.be.reverted;
      await expect(auction.finalize(id, res.abiEncodedClearValues, "0x")).to.be.reverted;
      await expect(auction.refund(id, alice.address)).to.be.revertedWithCustomError(auction, "WrongStatus");
      await auction.finalize(id, res.abiEncodedClearValues, res.decryptionProof);
      const a = await auction.getAuction(id);
      expect(a.winner).to.eq(alice.address);
      expect(a.price).to.eq(20n * UNIT);
      await expect(auction.finalize(id, res.abiEncodedClearValues, res.decryptionProof)).to.be.revertedWithCustomError(auction, "WrongStatus");
    });

    it("pays the whole price to the seller when there is no treasury", async function () {
      await auction.setFee(ethers.ZeroAddress, FEE_BPS);
      const id = await create();
      await bid(id, alice, 30n * UNIT);
      await bid(id, bob, 20n * UNIT);
      await closeAndFinalize(id);
      expect(await balanceOf(seller)).to.eq(20n * UNIT);
    });
  });
});
