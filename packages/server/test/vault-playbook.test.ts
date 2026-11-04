import { describe, expect, it } from 'vitest';
import { LocalKeyWrapper, Vault, playbookSha256 } from '../src/index';

const kek = (n: number) => new Uint8Array(32).fill(n);
const text = 'Rook hauls, Wren scouts and calls hazards, Moss blocks. Regroup at E when two are down.';

describe('vault: crew playbooks', () => {
  it('round-trips under a fresh data key, bound to the text sha', async () => {
    const vault = new Vault(new LocalKeyWrapper(kek(1)));
    const a = await vault.encryptPlaybook(text);
    const b = await vault.encryptPlaybook(text);
    expect(a.promptSha256).toBe(playbookSha256(text));
    expect(Buffer.from(a.ciphertext).toString('utf8')).not.toContain('Rook');
    expect(Buffer.from(a.wrappedKey).equals(Buffer.from(b.wrappedKey))).toBe(false);
    expect(await vault.decryptPlaybook(a)).toBe(text);
  });

  it('never opens a playbook as a skill or a skill as a playbook', async () => {
    const vault = new Vault(new LocalKeyWrapper(kek(1)));
    const pb = await vault.encryptPlaybook(text);
    const skill = await vault.encryptSkill(text);
    await expect(vault.decryptSkill(pb)).rejects.toMatchObject({ code: 'tampered' });
    await expect(vault.decryptPlaybook(skill)).rejects.toMatchObject({ code: 'tampered' });
  });

  it('detects tampering and refuses another KEK', async () => {
    const vault = new Vault(new LocalKeyWrapper(kek(1)));
    const pb = await vault.encryptPlaybook(text);
    const flipped = Uint8Array.from(pb.ciphertext);
    flipped[0] = flipped[0]! ^ 1;
    await expect(vault.decryptPlaybook({ ...pb, ciphertext: flipped })).rejects.toMatchObject({ code: 'tampered' });
    await expect(vault.decryptPlaybook({ ...pb, promptSha256: playbookSha256('other') })).rejects.toMatchObject({ code: 'tampered' });
    await expect(vault.decryptPlaybook({ ...pb, authTag: pb.authTag.slice(0, 8) })).rejects.toMatchObject({ code: 'tampered' });
    await expect(new Vault(new LocalKeyWrapper(kek(2))).decryptPlaybook(pb)).rejects.toMatchObject({ code: 'wrong_key' });
  });
});
