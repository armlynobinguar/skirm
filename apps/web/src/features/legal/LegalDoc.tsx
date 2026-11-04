// /terms and /privacy: the rules of play and what skirm does with player data. Plain facts about
// how this build works (testnet, NEAR payments, skill NFTs, agent rentals, model calls, what is
// stored where), marked as a draft: they need a legal review before skirm takes mainnet money.
// Readable signed out (the shell needs no session); linked from S01 and the account page.
import Link from 'next/link';
import type { ReactNode } from 'react';
import { routes } from '@/lib/routes';

export const LEGAL_UPDATED = '2026-11-03';
const REPO = 'https://github.com/TyronVT/skirm';

function Doc({ title, testId, children }: { title: string; testId: string; children: ReactNode }) {
  return (
    <article className="app-page legal" data-testid={testId}>
      <h1 className="app-h1">{title}</h1>
      <p className="sk-muted" data-testid="legal-draft">
        Draft, last updated {LEGAL_UPDATED}. skirm runs on NEAR <b>testnet</b> for the NEAR Hackathon: testnet NEAR has no
        value. This text describes how the game works today; it is not legal advice and will be reviewed before skirm
        takes real money.
      </p>
      {children}
      <p className="sk-muted">
        Questions or requests: open an issue on <a href={REPO}>{REPO.replace('https://', '')}</a>.
      </p>
    </article>
  );
}

export function TermsDoc() {
  return (
    <Doc title="Terms of play" testId="legal-terms">
      <h2 className="app-h3">The game</h2>
      <p>
        skirm is a match between two crews of AI agents. Your agents act on prompts you write (skills and system prompts)
        and on model output you do not control. Results, Elo and season standings come from the match engine; the replay
        hash of each ranked match is written to the NEAR registry contract and cannot be changed afterwards.
      </p>
      <h2 className="app-h3">Your account</h2>
      <p>
        Sign in with Privy, or in a local build with a handle. Keep one account per person. Do not automate play outside
        the game, flood the service (requests are rate limited), or try to read other players&apos; skills.
      </p>
      <h2 className="app-h3">Credits</h2>
      <p>
        Credits pay for your agents&apos; model calls by talk tier. A match holds its credits up front and returns what it
        did not use; a void match returns everything. Credits are not money and cannot be cashed out. Deleting your
        account forfeits its credits.
      </p>
      <h2 className="app-h3">Skills, sales and rentals</h2>
      <ul>
        <li>
          A minted skill version is an NFT on the skills contract. Buying one grants use of that version; its prompt stays
          encrypted and only its creator can read it.
        </li>
        <li>
          Sales pay a 5% platform fee and the creator&apos;s resale royalty (up to 10%), split by the market contract.
        </li>
        <li>
          Renting another player&apos;s agent buys one match with it, paid through the market contract with the same 5%
          fee. A pass is used when that match ends; a match that never starts keeps it. The agent plays with its
          owner&apos;s skills, which you never see.
        </li>
        <li>Blockchain transactions are final: skirm cannot reverse a purchase or a rental on chain.</li>
      </ul>
      <h2 className="app-h3">What you write</h2>
      <p>
        You are responsible for the names, prompts and messages you give your agents. Agent speech is filtered for abuse
        and for leaks of skill text; do not use agents to harass anyone. skirm may remove content or suspend an account
        that breaks these rules.
      </p>
      <h2 className="app-h3">No warranty</h2>
      <p>
        skirm is a hackathon build, provided as is. Matches, balances and listings may be reset on testnet. How your data
        is handled is in the <Link href={routes.privacy()}>privacy policy</Link>.
      </p>
    </Doc>
  );
}

export function PrivacyDoc() {
  return (
    <Doc title="Privacy" testId="legal-privacy">
      <h2 className="app-h3">What skirm stores</h2>
      <ul>
        <li>Your account: handle, the Privy user id you sign in with, a linked NEAR account if you add one, Elo and record.</li>
        <li>Your agents: names, looks, stats, talk tiers and your system prompts.</li>
        <li>Your skills: prompts are encrypted at rest (Cloud KMS in production) and decrypted only to run your agents.</li>
        <li>
          Matches: crews, results, the action log, and the messages agents said aloud (other players in the match could
          hear them). Live frames are kept 6 hours for replays.
        </li>
        <li>Money: your credits ledger, deposits, skill sales and purchases, rental offers and passes.</li>
        <li>Error reports carry the error type and code, never message text or request parameters.</li>
      </ul>
      <h2 className="app-h3">Who else sees it</h2>
      <ul>
        <li>
          <b>Other players</b> see your handle, agents&apos; names and record, leaderboard places and what your agents
          say in matches. They never see your skills, system prompts, credits or plans (ranked hides minds).
        </li>
        <li>
          <b>The NEAR blockchain</b> is public and permanent: your NEAR account, skill NFTs, purchases, rentals and ranked
          result hashes on it cannot be deleted by skirm or anyone.
        </li>
        <li>
          <b>Privy</b> handles sign-in. <b>OpenRouter</b> relays model calls to Anthropic&apos;s Claude: your agents&apos;
          prompts and skills are sent to the model each turn and are not shown to anyone else. <b>Google Cloud</b> hosts
          the service and database.
        </li>
      </ul>
      <h2 className="app-h3">Your choices</h2>
      <ul>
        <li>
          <b>Export:</b> download everything skirm holds about you, your own skill prompts included, from the account
          page.
        </li>
        <li>
          <b>Delete:</b> deleting your account removes your sign-in, NEAR link, system prompts and offers, and replaces
          your handle with a placeholder. Match history and sales stay (other players&apos; records depend on them),
          credits are forfeited, and rental passes others bought for your agents stay usable. Records on the NEAR
          blockchain cannot be removed.
        </li>
      </ul>
      <p className="sk-muted">
        The rules of play are in the <Link href={routes.terms()}>terms</Link>.
      </p>
    </Doc>
  );
}
