// Who can read each confidential value, and when. Taken from the contracts' ACLs (FHE.allow and
// FHE.makePubliclyDecryptable in packages/fhevm/contracts): change a contract's ACL, change this too.
export interface VisibilityRow {
  value: string;
  /** Who can decrypt it, and when. */
  who: string;
  /** sealed: some people never can; open: public once its moment comes. */
  state: 'sealed' | 'open';
}

export const VISIBILITY = {
  credits: [
    { value: 'Your balance', who: 'Only your wallet.', state: 'sealed' },
    { value: 'The amount of a transfer', who: 'Only the two wallets. That a transfer happened is public.', state: 'sealed' },
  ],
  loadout: [
    { value: 'Your picks', who: 'On chain, only your wallet until both crews have sealed. Then everyone, both at once.', state: 'open' },
    { value: 'Your stake', who: 'Only your wallet, for good. Everyone learns whether it counted.', state: 'sealed' },
  ],
  stakes: [
    { value: 'Each stake', who: 'Only the player who staked it. Whether it counted is public.', state: 'sealed' },
    { value: 'Each payout', who: 'Only the player who was paid.', state: 'sealed' },
    { value: 'Who won', who: 'Everyone, once the match is settled.', state: 'open' },
  ],
  randomness: [
    { value: 'The match seed', who: 'Nobody until both crews have sealed. Then everyone.', state: 'open' },
    { value: 'Each supply drop', who: 'Nobody until it is due, not even the game server. Then everyone.', state: 'open' },
  ],
  fog: [
    { value: 'Your scout and your traps', who: 'Only you during the game.', state: 'open' },
    { value: 'Your vial ping', who: 'Only you during the game. The ping between scouts is read by both players.', state: 'open' },
    { value: 'Your last move', who: 'Only you can decrypt what you sent, until the game ends.', state: 'open' },
    { value: 'Where the vial is', who: 'Nobody during the game.', state: 'open' },
    { value: 'A trap went off, the vial was taken, a win', who: 'Everyone, after each round.', state: 'open' },
    { value: 'Everything, once the game ends', who: 'Everyone, with a proof.', state: 'open' },
  ],
  auction: [
    { value: 'Your bid', who: 'Only your wallet, for good. The second-highest bid becomes the public price.', state: 'sealed' },
    { value: 'The running highest bid', who: 'Nobody while bidding is open.', state: 'sealed' },
    { value: 'A sealed reserve', who: 'Only the seller, unless it becomes the price.', state: 'sealed' },
    { value: 'The winner and the price', who: 'Everyone, after the close.', state: 'open' },
    { value: 'How many bid, and from which wallets', who: 'Everyone.', state: 'open' },
  ],
  predictions: [
    { value: 'Your side and stake', who: 'Only your wallet, for good.', state: 'sealed' },
    { value: 'Your payout', who: 'Only your wallet.', state: 'sealed' },
    { value: 'The two totals', who: 'Nobody while predictions are open. Then everyone.', state: 'open' },
    { value: 'Which wallets predicted and claimed', who: 'Everyone.', state: 'open' },
  ],
  benchmarks: [
    { value: 'The seed', who: 'Only the platform operator until the results are posted, or the reveal window passes. Then everyone.', state: 'open' },
    { value: 'The prompt hash, results hash and score', who: 'Everyone.', state: 'open' },
  ],
} as const satisfies Record<string, readonly VisibilityRow[]>;

export type VisibilityTopic = keyof typeof VISIBILITY;
