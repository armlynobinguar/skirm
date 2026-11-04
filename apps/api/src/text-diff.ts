// A word-level text diff for the bench's prompt comparison: the longest common subsequence of
// words and whitespace runs, merged into runs of kept, removed and added text. Prompts are at most
// 1,600 characters (prompt + reflexes), so the quadratic table stays small; longer input is cut to
// DIFF_MAX_TOKENS tokens per side before the table is built.

export interface DiffPart {
  op: 'same' | 'del' | 'add';
  text: string;
}

export const DIFF_MAX_TOKENS = 1_200;

const tokens = (s: string) => s.split(/(\s+)/).filter((t) => t !== '').slice(0, DIFF_MAX_TOKENS);

/** `a` → `b` as runs: `del` is only in `a`, `add` only in `b`. Adjacent runs of one kind are merged. */
export function diffWords(a: string, b: string): DiffPart[] {
  const x = tokens(a);
  const y = tokens(b);
  const n = x.length;
  const m = y.length;
  // lcs[i][j]: LCS length of x[i..] and y[j..], flattened.
  const w = m + 1;
  const lcs = new Uint16Array((n + 1) * w);
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      lcs[i * w + j] = x[i] === y[j] ? lcs[(i + 1) * w + j + 1]! + 1 : Math.max(lcs[(i + 1) * w + j]!, lcs[i * w + j + 1]!);
  const out: DiffPart[] = [];
  const push = (op: DiffPart['op'], text: string) => {
    const last = out[out.length - 1];
    if (last && last.op === op) last.text += text;
    else out.push({ op, text });
  };
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (x[i] === y[j]) {
      push('same', x[i]!);
      i++;
      j++;
    } else if (lcs[(i + 1) * w + j]! >= lcs[i * w + j + 1]!) push('del', x[i++]!);
    else push('add', y[j++]!);
  }
  while (i < n) push('del', x[i++]!);
  while (j < m) push('add', y[j++]!);
  return out;
}
