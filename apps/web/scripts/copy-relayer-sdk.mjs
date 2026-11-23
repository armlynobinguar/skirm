// Copies the Zama relayer SDK's prebuilt browser bundle into public/ so the page can load it with a
// <script> tag (window.relayerSDK) instead of the bundler compiling it.
//
// Why: the SDK's ESM build (`@zama-fhe/relayer-sdk/web`) contains a wasm-bindgen-rayon worker
// (workerHelpers.js) that spawns `new Worker(new URL('workerHelpers.js', import.meta.url))` on
// itself. Turbopack follows that self-reference while bundling and `next build` never finishes.
//
// The UMD bundle resolves its files from the site root (/tfhe_bg.wasm, /kms_lib_bg.wasm,
// /workerHelpers.js), so those three land at the root of public/ and the script itself under
// public/zama/. Runs before `next build` and `next dev` (prebuild/predev); the copies are gitignored.
import { copyFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const webRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const bundleDir = path.join(path.dirname(require.resolve('@zama-fhe/relayer-sdk/package.json')), 'bundle');
const publicDir = path.join(webRoot, 'public');

/** [file in the SDK bundle/, destination relative to public/] */
const FILES = [
  ['relayer-sdk-js.umd.cjs', 'zama/relayer-sdk-js.umd.js'],
  ['tfhe_bg.wasm', 'tfhe_bg.wasm'],
  ['kms_lib_bg.wasm', 'kms_lib_bg.wasm'],
  ['workerHelpers.js', 'workerHelpers.js'],
];

for (const [from, to] of FILES) {
  const dest = path.join(publicDir, to);
  mkdirSync(path.dirname(dest), { recursive: true });
  copyFileSync(path.join(bundleDir, from), dest);
}
console.log(`relayer SDK bundle copied to ${path.relative(webRoot, publicDir)}/`);
