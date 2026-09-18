import { useMemo, useState } from "react";
import type { MirrorResult, Verdict } from "../types";
import { sortByVerdict } from "../lib/sortResults";
import { filterByVerdicts } from "../lib/filterResults";
import { countByVerdict } from "../lib/statCounts";
import { StatTiles } from "./StatTiles";
import { VerdictPills } from "./VerdictPills";
import { VerdictRow } from "./VerdictRow";

interface VerdictTableProps {
  results: MirrorResult[];
}

export function VerdictTable({ results }: VerdictTableProps) {
  const [selected, setSelected] = useState<Verdict[]>([]);

  const counts = useMemo(() => countByVerdict(results), [results]);
  const visible = useMemo(
    () => sortByVerdict(filterByVerdicts(results, selected)),
    [results, selected]
  );

  return (
    <section id="verdicts" className="relative z-10 mx-auto max-w-4xl px-6 py-24">
      <StatTiles counts={counts} />
      <div className="mt-10 mb-6">
        <VerdictPills selected={selected} onChange={setSelected} counts={counts} />
      </div>
      <div className="border border-white/10 backdrop-blur-sm bg-white/[0.02]">
        {visible.map((r) => (
          <VerdictRow key={r.resource} result={r} />
        ))}
      </div>
    </section>
  );
}
