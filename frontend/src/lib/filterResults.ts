import type { MirrorResult, Verdict } from "../types";

export function filterByVerdicts(results: MirrorResult[], selected: Verdict[]): MirrorResult[] {
  if (selected.length === 0) return results;
  return results.filter((r) => selected.includes(r.verdict));
}
