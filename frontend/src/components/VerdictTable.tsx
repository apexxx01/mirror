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

function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

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
}: {
  label: string;
  active: boolean;
  dir: 1 | -1;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      className={`flex items-center gap-1 border-b px-1 pb-1 font-mono text-[10px] uppercase tracking-[0.2em] outline-none transition-colors duration-150 hover:text-ink focus-visible:text-ink ${
        active ? "border-hazard text-ink" : "border-transparent text-smoke hover:border-white/20"
      }`}
    >
      {label}
      <span aria-hidden="true" className={active ? "text-hazard" : "opacity-0"}>
        {dir === 1 ? "↑" : "↓"}
      </span>
    </button>
  );
}

export function VerdictTable({ results }: VerdictTableProps) {
  const [selected, setSelected] = useState<Verdict[]>([]);
  const [reduced] = useState(prefersReducedMotion);
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
      className="relative z-10 mx-auto max-w-4xl scroll-mt-32 px-4 py-24 sm:px-6 sm:scroll-mt-24"
    >
      {hasBlocked && (
        <Glow
          colorFrom="rgba(220,38,38,0.28)"
          colorTo="rgba(0,0,0,0)"
          className="-z-10 left-1/2 top-0 h-[420px] w-[420px] -translate-x-1/2"
        />
      )}

      {/* Section plate — gallery label, then the census. */}
      <motion.div
        className="mb-8"
        initial={reduced ? false : { opacity: 0, y: 20 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, margin: "-80px" }}
        transition={{ duration: 0.5, ease: ENTRANCE_EASE }}
      >
        <div className="mirror-hairline flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2 pt-4">
          <div className="mirror-eyebrow text-sm text-smoke">the ledger</div>
          <div className="font-mono text-[10px] uppercase tracking-[0.25em] text-smoke">
            {results.length} resource{results.length === 1 ? "" : "s"} · 7 real signals each
          </div>
        </div>
        <h2 className="mirror-display-crush mt-3 text-[clamp(30px,8.6vw,64px)] uppercase text-ink">
          Every verdict,
          <br />
          <span className="mirror-stroke-text">every signal</span>
        </h2>
      </motion.div>

      <StatTiles counts={counts} />

      <motion.div
        className="mt-8 mb-5"
        initial={reduced ? false : { opacity: 0, y: 20 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, margin: "-80px" }}
        transition={{ delay: 0.1, duration: 0.5, ease: ENTRANCE_EASE }}
      >
        <VerdictPills selected={selected} onChange={setSelected} counts={counts} />
      </motion.div>

      <motion.div
        className="mirror-panel relative overflow-hidden"
        initial={reduced ? false : { opacity: 0, y: 20 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, margin: "-80px" }}
        transition={{ delay: 0.15, duration: 0.5, ease: ENTRANCE_EASE }}
      >
        {/* Sort toolbar — mono micro-labels, hairline-underlined when active. */}
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 border-b border-white/10 px-4 py-3">
          <span className="font-mono text-[10px] uppercase tracking-[0.25em] text-smoke">sort</span>
          <SortHeader
            label="Verdict"
            active={sortKey === "verdict"}
            dir={sortDir}
            onClick={() => toggleSort("verdict")}
          />
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
          <span className="ml-auto font-mono text-[10px] uppercase tracking-[0.2em] text-smoke">
            <span className="tabular-nums text-ink/80">{visible.length}</span>
            <span className="text-smoke"> / {results.length} shown</span>
          </span>
        </div>

        {visible.length === 0 ? (
          <div data-testid="verdict-table-empty" className="px-6 py-14 text-center">
            <div
              aria-hidden="true"
              className="mirror-display-crush mirror-stroke-text text-[clamp(36px,10vw,64px)] uppercase"
            >
              empty
            </div>
            <div className="mt-4 font-mono text-xs uppercase tracking-[0.25em] text-smoke">
              no resources match this filter
            </div>
          </div>
        ) : (
          visible.map((r, i) => (
            <motion.div
              key={r.resource}
              initial={reduced ? false : { opacity: 0, y: 12 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-20px" }}
              transition={{
                delay: Math.min(i * 0.04, 0.4),
                duration: 0.4,
                ease: ENTRANCE_EASE,
              }}
            >
              <VerdictRow result={r} />
            </motion.div>
          ))
        )}
      </motion.div>
    </section>
  );
}
