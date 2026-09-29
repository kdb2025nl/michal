'use strict';
// Compare Whisper transcript with target text. Whisper is a CONTENT check (missing/extra/cut-off words),
// not proof of good pronunciation.
const norm = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[’']/g, '').replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter(Boolean);

function lcsDiff(a, b) {
  const n = a.length; const m = b.length; const dp = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const missing = []; const extra = []; let i = 0; let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) { i++; j++; } else if (dp[i + 1][j] >= dp[i][j + 1]) missing.push({ word: a[i], index: i++ }); else extra.push({ word: b[j], index: j++ });
  }
  while (i < n) missing.push({ word: a[i], index: i++ });
  while (j < m) extra.push({ word: b[j], index: j++ });
  return { matched: dp[0][0], missing, extra };
}

function compareTranscript(target, transcript, opts = {}) {
  const minRatio = opts.minRatio ?? 0.85;
  const a = norm(target); const b = norm(transcript);
  if (!a.length) return { pass: true, ratio: 1, missing: [], extra: [], truncated: false, targetWords: 0, transcriptWords: b.length };
  const d = lcsDiff(a, b);
  const ratio = d.matched / a.length;
  const tail = a.slice(-Math.min(3, a.length));
  const tailMissing = d.missing.filter((x) => x.index >= a.length - tail.length).length;
  const truncated = tailMissing >= Math.min(2, tail.length) && b.length < a.length;
  const significant = d.missing.filter((x) => x.word.length > 3).length; // ignore tiny words
  return {
    pass: ratio >= minRatio && !truncated,
    ratio: Math.round(ratio * 1000) / 1000, truncated,
    missing: d.missing.map((x) => x.word), extra: d.extra.map((x) => x.word), significantMissing: significant,
    targetWords: a.length, transcriptWords: b.length,
  };
}
module.exports = { compareTranscript, norm };
