import { FhevmType } from "@fhevm/hardhat-plugin";
import { time } from "@nomicfoundation/hardhat-network-helpers";
import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { expect } from "chai";
import { ethers, fhevm } from "hardhat";

import type { ConfidentialSkirmCredits } from "../types";

const FAUCET_AMOUNT = 1_000n * 10n ** 6n; // 1,000 cSKIRM (6 decimals)
const FAUCET_COOLDOWN = 24n * 60n * 60n; // one day

describe("ConfidentialSkirmCredits", function () {
  let owner: HardhatEthersSigner;
  let alice: HardhatEthersSigner;
  let bob: HardhatEthersSigner;
  let minter: HardhatEthersSigner;
  let token: ConfidentialSkirmCredits;
  let tokenAddress: string;

  async function balanceOf(account: HardhatEthersSigner): Promise<bigint> {
    const handle = await token.confidentialBalanceOf(account.address);
    if (handle === ethers.ZeroHash) return 0n;
    return fhevm.userDecryptEuint(FhevmType.euint64, handle, tokenAddress, account);
  }

  before(async function () {
    [owner, alice, bob, minter] = await ethers.getSigners();
  });

  beforeEach(async function () {
    if (!fhevm.isMock) {
      console.warn("ConfidentialSkirmCredits tests need the FHEVM mock (hardhat network)");
      this.skip();
    }
    const factory = await ethers.getContractFactory("ConfidentialSkirmCredits");
    token = await factory.deploy(owner.address, FAUCET_AMOUNT, FAUCET_COOLDOWN);
    tokenAddress = await token.getAddress();
  });

  it("exposes ERC-7984 metadata", async function () {
    expect(await token.name()).to.eq("Confidential skirm credits");
    expect(await token.symbol()).to.eq("cSKIRM");
    expect(await token.decimals()).to.eq(6n);
    expect(await token.faucetAmount()).to.eq(FAUCET_AMOUNT);
    expect(await token.faucetCooldown()).to.eq(FAUCET_COOLDOWN);
  });

  describe("faucet", function () {
    it("mints the faucet amount as an encrypted balance only the claimer can decrypt", async function () {
      await expect(token.connect(alice).claimFaucet())
        .to.emit(token, "FaucetClaimed")
        .withArgs(alice.address, FAUCET_AMOUNT);

      const handle = await token.confidentialBalanceOf(alice.address);
      expect(handle).to.not.eq(ethers.ZeroHash);
      expect(await balanceOf(alice)).to.eq(FAUCET_AMOUNT);

      // Bob holds no ACL grant on Alice's balance, so decrypting it must fail.
      await expect(fhevm.userDecryptEuint(FhevmType.euint64, handle, tokenAddress, bob)).to.be.rejected;
    });

    it("reverts a second claim inside the cooldown and allows it after", async function () {
      await token.connect(alice).claimFaucet();
      const availableAt = await token.nextFaucetClaimAt(alice.address);
      expect(availableAt).to.eq((await token.lastFaucetClaim(alice.address)) + FAUCET_COOLDOWN);

      await expect(token.connect(alice).claimFaucet())
        .to.be.revertedWithCustomError(token, "FaucetCooldownActive")
        .withArgs(availableAt);

      // Other addresses are not affected by Alice's cooldown.
      await expect(token.connect(bob).claimFaucet()).to.not.be.reverted;

      await time.increaseTo(availableAt);
      await token.connect(alice).claimFaucet();
      expect(await balanceOf(alice)).to.eq(FAUCET_AMOUNT * 2n);
    });

    it("can be disabled and reconfigured by the owner only", async function () {
      await expect(token.connect(alice).setFaucet(1n, 1n))
        .to.be.revertedWithCustomError(token, "OwnableUnauthorizedAccount")
        .withArgs(alice.address);

      await expect(token.setFaucet(0n, FAUCET_COOLDOWN)).to.emit(token, "FaucetConfigured").withArgs(0n, FAUCET_COOLDOWN);
      await expect(token.connect(alice).claimFaucet()).to.be.revertedWithCustomError(token, "FaucetDisabled");
    });
  });

  describe("minting", function () {
    it("lets the owner mint an encrypted input amount", async function () {
      const input = await fhevm.createEncryptedInput(tokenAddress, owner.address).add64(42n).encrypt();
      await token.mint(alice.address, input.handles[0], input.inputProof);
      expect(await balanceOf(alice)).to.eq(42n);
    });

    it("reverts mints from accounts that are neither owner nor minter", async function () {
      const input = await fhevm.createEncryptedInput(tokenAddress, alice.address).add64(42n).encrypt();
      await expect(token.connect(alice).mint(alice.address, input.handles[0], input.inputProof))
        .to.be.revertedWithCustomError(token, "UnauthorizedMinter")
        .withArgs(alice.address);
    });

    it("lets an approved minter mint until the role is revoked", async function () {
      await expect(token.connect(alice).setMinter(minter.address, true))
        .to.be.revertedWithCustomError(token, "OwnableUnauthorizedAccount")
        .withArgs(alice.address);

      await expect(token.setMinter(minter.address, true)).to.emit(token, "MinterSet").withArgs(minter.address, true);
      const input = await fhevm.createEncryptedInput(tokenAddress, minter.address).add64(7n).encrypt();
      await token.connect(minter).mint(bob.address, input.handles[0], input.inputProof);
      expect(await balanceOf(bob)).to.eq(7n);

      await token.setMinter(minter.address, false);
      const again = await fhevm.createEncryptedInput(tokenAddress, minter.address).add64(7n).encrypt();
      await expect(
        token.connect(minter).mint(bob.address, again.handles[0], again.inputProof),
      ).to.be.revertedWithCustomError(token, "UnauthorizedMinter");
    });

    it("rejects mintFromHandle with a ciphertext the minter has no access to", async function () {
      await token.connect(alice).claimFaucet();
      const aliceBalance = await token.confidentialBalanceOf(alice.address);
      await expect(token.mintFromHandle(owner.address, aliceBalance)).to.be.revertedWithCustomError(
        token,
        "ERC7984UnauthorizedUseOfEncryptedAmount",
      );
    });
  });

  describe("confidential transfers", function () {
    it("moves an encrypted amount and both parties can decrypt their own balance", async function () {
      await token.connect(alice).claimFaucet();

      const amount = 250n * 10n ** 6n;
      const input = await fhevm.createEncryptedInput(tokenAddress, alice.address).add64(amount).encrypt();
      await expect(
        token
          .connect(alice)
          ["confidentialTransfer(address,bytes32,bytes)"](bob.address, input.handles[0], input.inputProof),
      ).to.emit(token, "ConfidentialTransfer");

      expect(await balanceOf(alice)).to.eq(FAUCET_AMOUNT - amount);
      expect(await balanceOf(bob)).to.eq(amount);
    });

    it("transfers zero (instead of reverting) when the balance is too low, hiding the failure", async function () {
      await token.connect(alice).claimFaucet();

      const input = await fhevm
        .createEncryptedInput(tokenAddress, alice.address)
        .add64(FAUCET_AMOUNT + 1n)
        .encrypt();
      await token
        .connect(alice)
        ["confidentialTransfer(address,bytes32,bytes)"](bob.address, input.handles[0], input.inputProof);

      expect(await balanceOf(alice)).to.eq(FAUCET_AMOUNT);
      expect(await balanceOf(bob)).to.eq(0n);
    });

    it("rejects an encrypted input that was created for another sender", async function () {
      await token.connect(alice).claimFaucet();
      const input = await fhevm.createEncryptedInput(tokenAddress, bob.address).add64(1n).encrypt();
      await expect(
        token
          .connect(alice)
          ["confidentialTransfer(address,bytes32,bytes)"](bob.address, input.handles[0], input.inputProof),
      ).to.be.reverted;
    });
  });
});
