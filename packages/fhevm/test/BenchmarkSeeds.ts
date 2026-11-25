import { FhevmType } from "@fhevm/hardhat-plugin";
import { time } from "@nomicfoundation/hardhat-network-helpers";
import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { expect } from "chai";
import type { ContractTransactionResponse, TransactionReceipt } from "ethers";
import { ethers, fhevm } from "hardhat";

import { benchmarkSeedPicks, resultsHashPreimage, splitBenchmarkSeed } from "../../shared/src/benchmark-seeds";
import { skillRefPreimage } from "../../shared/src/sealed-auction";
import type { BenchmarkSeeds, SeedDrawProbe } from "../types";

const WINDOW = 24n * 60n * 60n;
const Status = { None: 0n, Committed: 1n, Publishing: 2n, Revealed: 3n };
const SKILL_REF = ethers.id(skillRefPreimage("skl_bench", 2));
const PROMPT_HASH = `0x${"ab".repeat(32)}`;
const LOGS = Array.from({ length: 6 }, (_, i) => String(i + 1).repeat(64));
const RESULTS_HASH = ethers.keccak256(resultsHashPreimage(LOGS));
const MAPS = ["m0", "m1", "m2", "m3"];

/** Gas and HCU per call, printed after the suite (the numbers in the README come from here). */
const report = new Map<string, { gas: bigint; hcu: number; depth: number }>();

async function measure(label: string, tx: Promise<ContractTransactionResponse>): Promise<TransactionReceipt> {
  const receipt = (await (await tx).wait())!;
  const hcu = fhevm.computeTransactionHCU(receipt);
  const prev = report.get(label);
  if (!prev || receipt.gasUsed > prev.gas) report.set(label, { gas: receipt.gasUsed, hcu: hcu.globalHCU, depth: hcu.maxHCUDepth });
  return receipt;
}

describe("BenchmarkSeeds", function () {
  let owner: HardhatEthersSigner;
  let operator: HardhatEthersSigner;
  let writer: HardhatEthersSigner;
  let eve: HardhatEthersSigner;
  let seeds: BenchmarkSeeds;
  let address: string;

  const commit = (ref = SKILL_REF) => measure("commit (draws the seed)", seeds.connect(operator).commit(ref, PROMPT_HASH));
  const decryptAs = async (who: HardhatEthersSigner, ref = SKILL_REF) =>
    fhevm.userDecryptEuint(FhevmType.euint64, await seeds.seedHandle(ref), address, who);

  async function finalize(ref = SKILL_REF, label = "finalize") {
    const res = await fhevm.publicDecrypt([await seeds.seedHandle(ref)]);
    await measure(label, seeds.finalize(ref, res.abiEncodedClearValues, res.decryptionProof));
    return res;
  }

  before(async function () {
    [owner, operator, writer, eve] = await ethers.getSigners();
  });

  beforeEach(async function () {
    if (!fhevm.isMock) {
      console.warn("BenchmarkSeeds tests need the FHEVM mock (hardhat network)");
      this.skip();
    }
    seeds = await (await ethers.getContractFactory("BenchmarkSeeds")).deploy(operator.address, WINDOW);
    address = await seeds.getAddress();
  });

  after(function () {
    if (report.size === 0) return;
    console.log("\n    BenchmarkSeeds gas / HCU (FHEVM mock, worst case seen):");
    for (const [label, r] of report) {
      console.log(`      ${label.padEnd(34)} gas ${r.gas.toString().padStart(9)}   HCU ${String(r.hcu).padStart(9)}   depth ${String(r.depth).padStart(8)}`);
    }
  });

  describe("deployment and admin", function () {
    it("records the operator and the reveal window, and validates them", async function () {
      expect(await seeds.operator()).to.eq(operator.address);
      expect(await seeds.revealWindow()).to.eq(WINDOW);
      const factory = await ethers.getContractFactory("BenchmarkSeeds");
      await expect(factory.deploy(ethers.ZeroAddress, WINDOW)).to.be.revertedWithCustomError(seeds, "ZeroAddress");
      await expect(factory.deploy(operator.address, 60n)).to.be.revertedWithCustomError(seeds, "InvalidRevealWindow");
      await expect(factory.deploy(operator.address, 31n * 86400n)).to.be.revertedWithCustomError(seeds, "InvalidRevealWindow");
    });

    it("lets only the owner change the operator and the window", async function () {
      await expect(seeds.connect(eve).setOperator(eve.address)).to.be.revertedWithCustomError(seeds, "OwnableUnauthorizedAccount");
      await expect(seeds.connect(eve).setRevealWindow(WINDOW)).to.be.revertedWithCustomError(seeds, "OwnableUnauthorizedAccount");
      await expect(seeds.connect(owner).setOperator(eve.address)).to.emit(seeds, "OperatorSet").withArgs(eve.address);
      await expect(seeds.connect(owner).setRevealWindow(3600n)).to.emit(seeds, "RevealWindowSet").withArgs(3600n);
    });
  });

  describe("commit", function () {
    it("has no seed before the commit, and draws one sealed seed with it", async function () {
      expect(await seeds.seedHandle(SKILL_REF)).to.eq(ethers.ZeroHash);
      expect((await seeds.getBenchmark(SKILL_REF)).status).to.eq(Status.None);
      const receipt = await commit();
      const handle = await seeds.seedHandle(SKILL_REF);
      expect(handle).to.not.eq(ethers.ZeroHash);
      const at = BigInt((await ethers.provider.getBlock(receipt.blockNumber))!.timestamp);
      const b = await seeds.getBenchmark(SKILL_REF);
      expect(b.status).to.eq(Status.Committed);
      expect(b.promptHash).to.eq(PROMPT_HASH);
      expect(b.committedAt).to.eq(at);
      expect(b.revealDeadline).to.eq(at + WINDOW);
      expect(b.seed).to.eq(0n);
    });

    it("emits Committed with the seed handle", async function () {
      await expect(seeds.connect(operator).commit(SKILL_REF, PROMPT_HASH)).to.emit(seeds, "Committed");
      const [ev] = await seeds.queryFilter(seeds.filters.Committed(SKILL_REF));
      expect(ev!.args.seedHandle).to.eq(await seeds.seedHandle(SKILL_REF));
      expect(ev!.args.promptHash).to.eq(PROMPT_HASH);
    });

    it("lets only the operator decrypt the seed; nobody else, the writer included", async function () {
      await commit();
      const seed = await decryptAs(operator);
      expect(seed).to.be.a("bigint");
      await expect(decryptAs(writer)).to.be.rejected;
      await expect(decryptAs(owner)).to.be.rejected;
      await expect(fhevm.publicDecrypt([await seeds.seedHandle(SKILL_REF)])).to.be.rejected;
    });

    it("draws different seeds for different versions", async function () {
      const other = ethers.id(skillRefPreimage("skl_bench", 3));
      await commit();
      await commit(other);
      expect(await decryptAs(operator)).to.not.eq(await decryptAs(operator, other));
    });

    it("refuses a re-commit, a non-operator and empty inputs", async function () {
      await commit();
      await expect(seeds.connect(operator).commit(SKILL_REF, PROMPT_HASH)).to.be.revertedWithCustomError(seeds, "AlreadyCommitted");
      await expect(seeds.connect(writer).commit(ethers.id("x"), PROMPT_HASH)).to.be.revertedWithCustomError(seeds, "NotOperator");
      await expect(seeds.connect(operator).commit(ethers.ZeroHash, PROMPT_HASH)).to.be.revertedWithCustomError(seeds, "InvalidSkillRef");
      await expect(seeds.connect(operator).commit(ethers.id("x"), ethers.ZeroHash)).to.be.revertedWithCustomError(seeds, "InvalidPromptHash");
    });
  });

  describe("publish and finalize", function () {
    it("posts the results, opens the seed and stores it with the KMS proof", async function () {
      await commit();
      const known = await decryptAs(operator);
      await measure("publish", seeds.connect(operator).publish(SKILL_REF, RESULTS_HASH, 5000));
      const pub = await seeds.queryFilter(seeds.filters.Published(SKILL_REF));
      expect(pub[0]!.args.resultsHash).to.eq(RESULTS_HASH);
      expect((await seeds.getBenchmark(SKILL_REF)).status).to.eq(Status.Publishing);
      await expect(seeds.seedsOf(SKILL_REF)).to.be.revertedWithCustomError(seeds, "NotRevealed");

      const res = await fhevm.publicDecrypt([await seeds.seedHandle(SKILL_REF)]);
      await expect(seeds.finalize(SKILL_REF, res.abiEncodedClearValues, res.decryptionProof))
        .to.emit(seeds, "Revealed")
        .withArgs(SKILL_REF, known, false);
      const b = await seeds.getBenchmark(SKILL_REF);
      expect(b.status).to.eq(Status.Revealed);
      expect(b.seed).to.eq(known);
      expect(b.resultsHash).to.eq(RESULTS_HASH);
      expect(b.scoreBps).to.eq(5000n);
      expect(b.forced).to.eq(false);
    });

    it("splits the seed on chain exactly as the shared mapping does", async function () {
      await commit();
      await (await seeds.connect(operator).publish(SKILL_REF, RESULTS_HASH, 0)).wait();
      await finalize();
      const seed = (await seeds.getBenchmark(SKILL_REF)).seed;
      const onChain = (await seeds.seedsOf(SKILL_REF)).map(Number);
      expect(onChain).to.deep.eq(splitBenchmarkSeed(seed));
      expect(benchmarkSeedPicks(seed, MAPS)).to.have.length(6);
      for (const v of [0n, 1n, (1n << 64n) - 1n, 0x0123_4567_89ab_cdefn]) {
        expect((await seeds.splitSeed(v)).map(Number)).to.deep.eq(splitBenchmarkSeed(v));
      }
    });

    it("rejects a forged seed", async function () {
      await commit();
      await (await seeds.connect(operator).publish(SKILL_REF, RESULTS_HASH, 5000)).wait();
      const res = await fhevm.publicDecrypt([await seeds.seedHandle(SKILL_REF)]);
      const real = BigInt(ethers.AbiCoder.defaultAbiCoder().decode(["uint256"], res.abiEncodedClearValues)[0]);
      const forged = ethers.AbiCoder.defaultAbiCoder().encode(["uint256"], [real ^ 1n]);
      await expect(seeds.finalize(SKILL_REF, forged, res.decryptionProof)).to.be.reverted;
      await expect(seeds.finalize(SKILL_REF, res.abiEncodedClearValues, "0x")).to.be.reverted;
      expect((await seeds.getBenchmark(SKILL_REF)).status).to.eq(Status.Publishing);
    });

    it("refuses publish from a non-operator, out of order or with bad values", async function () {
      await expect(seeds.connect(operator).publish(SKILL_REF, RESULTS_HASH, 1)).to.be.revertedWithCustomError(seeds, "WrongStatus");
      await commit();
      await expect(seeds.connect(writer).publish(SKILL_REF, RESULTS_HASH, 1)).to.be.revertedWithCustomError(seeds, "NotOperator");
      await expect(seeds.connect(operator).publish(SKILL_REF, ethers.ZeroHash, 1)).to.be.revertedWithCustomError(seeds, "InvalidResultsHash");
      await expect(seeds.connect(operator).publish(SKILL_REF, RESULTS_HASH, 10_001)).to.be.revertedWithCustomError(seeds, "InvalidScore");
      await expect(seeds.finalize(SKILL_REF, "0x", "0x")).to.be.revertedWithCustomError(seeds, "WrongStatus");
      await (await seeds.connect(operator).publish(SKILL_REF, RESULTS_HASH, 1)).wait();
      await expect(seeds.connect(operator).publish(SKILL_REF, RESULTS_HASH, 1)).to.be.revertedWithCustomError(seeds, "WrongStatus");
      await finalize();
      await expect(seeds.finalize(SKILL_REF, "0x", "0x")).to.be.revertedWithCustomError(seeds, "WrongStatus");
      await expect(seeds.connect(operator).commit(SKILL_REF, PROMPT_HASH)).to.be.revertedWithCustomError(seeds, "AlreadyCommitted");
    });
  });

  describe("forced reveal", function () {
    it("is refused before the deadline and open to anyone after it", async function () {
      await commit();
      await expect(seeds.connect(eve).forceReveal(SKILL_REF)).to.be.revertedWithCustomError(seeds, "RevealNotDue");
      await time.increase(WINDOW);
      await measure("forceReveal", seeds.connect(eve).forceReveal(SKILL_REF));
      const [ev] = await seeds.queryFilter(seeds.filters.ForcedReveal(SKILL_REF));
      expect(ev!.args.caller).to.eq(eve.address);
      // The operator can no longer post results for seeds everyone could see.
      await expect(seeds.connect(operator).publish(SKILL_REF, RESULTS_HASH, 1)).to.be.revertedWithCustomError(seeds, "WrongStatus");
      const known = await decryptAs(operator);
      await finalize(SKILL_REF, "finalize (forced)");
      const b = await seeds.getBenchmark(SKILL_REF);
      expect(b.status).to.eq(Status.Revealed);
      expect(b.forced).to.eq(true);
      expect(b.seed).to.eq(known);
      expect(b.resultsHash).to.eq(ethers.ZeroHash);
    });

    it("is refused once the operator published, and for an unknown version", async function () {
      await expect(seeds.forceReveal(SKILL_REF)).to.be.revertedWithCustomError(seeds, "WrongStatus");
      await commit();
      await (await seeds.connect(operator).publish(SKILL_REF, RESULTS_HASH, 1)).wait();
      await time.increase(WINDOW);
      await expect(seeds.forceReveal(SKILL_REF)).to.be.revertedWithCustomError(seeds, "WrongStatus");
    });

    it("keeps the deadline fixed at commit time", async function () {
      await commit();
      await (await seeds.connect(owner).setRevealWindow(30n * 86400n)).wait();
      await time.increase(WINDOW);
      await expect(seeds.forceReveal(SKILL_REF)).to.emit(seeds, "ForcedReveal");
    });
  });

  describe("draw cost: one euint64 against six euint32", function () {
    it("measures both draws", async function () {
      const probe = (await (await ethers.getContractFactory("SeedDrawProbe")).deploy()) as unknown as SeedDrawProbe;
      await measure("probe: 6 x randEuint32", probe.drawSix(1));
      await measure("probe: 1 x randEuint64", probe.drawOne(1));
      const six = report.get("probe: 6 x randEuint32")!;
      const one = report.get("probe: 1 x randEuint64")!;
      expect(one.gas < six.gas).to.eq(true);
      expect(one.hcu <= six.hcu).to.eq(true);
    });
  });
});
