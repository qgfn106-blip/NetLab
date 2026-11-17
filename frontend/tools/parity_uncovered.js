// Pure helpers for verify_app_parity uncovered-file checks (F-05 A/C).
import { createHash } from 'node:crypto';

export function basenames(list) {
  return list.map((p) => String(p).split(/[\\/]/).pop());
}

// Exact set-equality between actual uncovered runtime files and allowlist.
// extra = uncovered but not allowed (new invisible monolith -> must FAIL)
// absent = allowlisted but no longer uncovered (stale entry -> must FAIL/remove)
export function diffUncovered(actual, allowed) {
  const a = new Set(basenames(actual));
  const b = new Set(basenames(allowed));
  const extra = [...a].filter((x) => !b.has(x)).sort();
  const absent = [...b].filter((x) => !a.has(x)).sort();
  return { ok: extra.length === 0 && absent.length === 0, extra, absent };
}

export function wholeFileHash(text) {
  return createHash('sha256').update(String(text), 'utf8').digest('hex');
}
