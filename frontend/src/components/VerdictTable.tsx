import { useMemo, useState } from "react";
import { motion } from "motion/react";
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

// Sharp, confident ease-out — no bounce, no default linear/ease.
const ENTRANCE_EASE = [0.16, 1, 0.3, 1] as const;

export function VerdictTable({ results }: VerdictTableProps) {
  const [selected, setSelected] = useState<Verdict[]>([]);

  const counts = useMemo(() => countByVerdict(results), [results]);
  const visible = useMemo(
    () => sortByVerdict(filterByVerdicts(results, selected)),
    [results, selected]
  );

  return (
    <section id="verdicts" className="relative z-10 mx-auto max-w-4xl px-6 py-24">
      <motion.div
        initial={{ opacity: 0, y: 24 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, margin: "-100px" }}
        transition={{ duration: 0.5, ease: ENTRANCE_EASE }}
      >
        <StatTiles counts={counts} />
      </motion.div>
      <motion.div
        className="mt-10 mb-6"
        initial={{ opacity: 0, y: 24 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, margin: "-100px" }}
        transition={{ delay: 0.1, duration: 0.5, ease: ENTRANCE_EASE }}
      >
        <VerdictPills selected={selected} onChange={setSelected} counts={counts} />
      </motion.div>
      <motion.div
        className="border border-white/10 backdrop-blur-sm bg-white/[0.02]"
        initial={{ opacity: 0, y: 24 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, margin: "-100px" }}
        transition={{ delay: 0.2, duration: 0.5, ease: ENTRANCE_EASE }}
      >
        {visible.map((r) => (
          <VerdictRow key={r.resource} result={r} />
        ))}
      </motion.div>
    </section>
  );
}
