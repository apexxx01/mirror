import { useMemo, useState } from "react";
import { motion } from "motion/react";
import type { MirrorResult, Verdict } from "../types";
import { sortByVerdict } from "../lib/sortResults";
import { filterByVerdicts } from "../lib/filterResults";
import { countByVerdict } from "../lib/statCounts";
import { StatTiles } from "./StatTiles";
import { VerdictPills } from "./VerdictPills";
import { VerdictRow } from "./VerdictRow";
import { Glow } from "./Glow";

interface VerdictTableProps {
  results: MirrorResult[];
}

// Sharp, confident ease-out — no bounce, no default linear/ease.
const ENTRANCE_EASE = [0.16, 1, 0.3, 1] as const;

const VERDICT_ORDER: Record<Verdict, number> = { BLOCKED: 0, NEEDS_REVIEW: 1, SAFE: 2 };

type SortKey = "verdict" | "risk_score" | "mirror_score";

function sortRows(rows: MirrorResult[], key: SortKey, dir: 1 | -1): MirrorResult[] {
  const copy = [...rows];
  copy.sort((a, b) => {
    let diff = 0;
    if (key === "verdict") diff = VERDICT_ORDER[a.verdict] - VERDICT_ORDER[b.verdict];
    else if (key === "risk_score") diff = a.risk_score - b.risk_score;
    else diff = a.mirror_score.score - b.mirror_score.score;
    return diff * dir;
  });
  return copy;
}

function SortHeader({
  label,
  active,
  dir,
  onClick,
  className = "",
}: {
  label: string;
  active: boolean;
  dir: 1 | -1;
  onClick: () => void;
  className?: string;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1 font-mono text-[10px] uppercase tracking-widest outline-none transition-colors duration-150 hover:text-white/80 focus-visible:text-white/80 ${
        active ? "text-white/80" : "text-white/40"
      } ${className}`}
    >
      {label}
      {active && <span>{dir === 1 ? "↑" : "↓"}</span>}
    </button>
  );
}

export function VerdictTable({ results }: VerdictTableProps) {
  const [selected, setSelected] = useState<Verdict[]>([]);
  const [sortKey, setSortKey] = useState<SortKey>("verdict");
  const [sortDir, setSortDir] = useState<1 | -1>(1);

  const counts = useMemo(() => countByVerdict(results), [results]);
  const hasBlocked = counts.BLOCKED > 0;

  const visible = useMemo(() => {
    const filtered = filterByVerdicts(results, selected);
    // Default view stays BLOCKED-first via sortByVerdict; any other sort
    // key/direction the user picks overrides it explicitly.
    if (sortKey === "verdict" && sortDir === 1) return sortByVerdict(filtered);
    return sortRows(filtered, sortKey, sortDir);
  }, [results, selected, sortKey, sortDir]);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === 1 ? -1 : 1));
    } else {
      setSortKey(key);
      setSortDir(1);
    }
  };

  return (
    <section
      id="verdicts"
      className="relative z-10 mx-auto max-w-4xl scroll-mt-32 px-6 py-24 sm:scroll-mt-24"
    >
      {hasBlocked && (
        <Glow
          colorFrom="rgba(220,38,38,0.28)"
          colorTo="rgba(0,0,0,0)"
          className="-z-10 left-1/2 top-0 h-[420px] w-[420px] -translate-x-1/2"
        />
      )}
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
        className="mirror-glass overflow-hidden"
        initial={{ opacity: 0, y: 24 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, margin: "-100px" }}
        transition={{ delay: 0.2, duration: 0.5, ease: ENTRANCE_EASE }}
      >
        <div className="grid grid-cols-[auto_1fr_auto_auto] gap-3 border-b border-white/10 px-4 py-3 sm:grid-cols-[auto_1fr_auto_auto_auto_auto]">
          <SortHeader label="Verdict" active={sortKey === "verdict"} dir={sortDir} onClick={() => toggleSort("verdict")} />
          <span />
          <span className="hidden font-mono text-[10px] uppercase tracking-widest text-white/40 sm:block">
            Reversibility
          </span>
          <SortHeader
            label="Score"
            active={sortKey === "mirror_score"}
            dir={sortDir}
            onClick={() => toggleSort("mirror_score")}
          />
          <SortHeader
            label="Risk"
            active={sortKey === "risk_score"}
            dir={sortDir}
            onClick={() => toggleSort("risk_score")}
          />
          <span />
        </div>
        {visible.length === 0 ? (
          <div data-testid="verdict-table-empty" className="px-6 py-8 text-center">
            <div className="font-mono text-xs uppercase tracking-widest text-white/60">
              no resources match this filter
            </div>
          </div>
        ) : (
          visible.map((r) => <VerdictRow key={r.resource} result={r} />)
        )}
      </motion.div>
    </section>
  );
}
