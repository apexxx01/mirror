import type { MirrorResult, Verdict } from "../types";

const ORDER: Record<Verdict, number> = { BLOCKED: 0, NEEDS_REVIEW: 1, SAFE: 2 };

export function sortByVerdict(results: MirrorResult[]): MirrorResult[] {
  return [...results].sort((a, b) => ORDER[a.verdict] - ORDER[b.verdict]);
}
