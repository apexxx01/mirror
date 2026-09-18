import type { MirrorResult, Verdict } from "../types";

export function countByVerdict(results: MirrorResult[]): Record<Verdict, number> {
  const counts: Record<Verdict, number> = { BLOCKED: 0, NEEDS_REVIEW: 0, SAFE: 0 };
  for (const r of results) counts[r.verdict]++;
  return counts;
}
