import { useLayoutEffect, useRef, useState } from "react";
import { motion } from "motion/react";
import type { Verdict } from "../types";

interface StatTilesProps {
  counts: Record<Verdict, number>;
}

/**
 * The verdict census, rendered as three monumental slabs rather than three
 * cards. Every number here is the REAL count handed down from
 * countByVerdict(results) — the count-up animation only re-plays the number
 * the scan already produced, it never invents or extrapolates one. The
 * share meter under each digit is count/total, also real.
 */

const ENTRANCE_EASE = [0.16, 1, 0.3, 1] as const;

const TILES: {
  verdict: Verdict;
  index: string;
  label: string;
  ghost: string;
  note: string;
  hex: string;
  text: string;
}[] = [
  {
    verdict: "BLOCKED",
    index: "01",
    label: "Blocked",
    ghost: "DENY",
    note: "cedar forbid — real dependents downstream",
    hex: "#DC2626",
    text: "text-blocked",
  },
  {
    verdict: "NEEDS_REVIEW",
    index: "02",
    label: "Needs Review",
    ghost: "HOLD",
    note: "evidence is ambiguous — a human decides",
    hex: "#EAB308",
    text: "text-review",
  },
  {
    verdict: "SAFE",
    index: "03",
    label: "Safe",
    ghost: "ALLOW",
    note: "no dependents, no traffic, no objections",
    hex: "#16A34A",
    text: "text-safe",
  },
];

function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

const COUNT_MS = 900;

/**
 * Counts from 0 up to the real value once the tile scrolls into view.
 *
 * The initial DOM already holds the true number, so a visitor with
 * reduced-motion, a failed IntersectionObserver, or no JS animation frame
 * still reads the correct count — the animation is layered on top of the
 * truth, never a substitute for it.
 */
function CountUp({
  value,
  run,
  testId,
  className,
}: {
  value: number;
  run: boolean;
  testId: string;
  className: string;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const width = String(value).length;
  const format = (n: number) => String(n).padStart(width, "0");

  useLayoutEffect(() => {
    if (!run) return;
    const node = ref.current;
    if (!node) return;
    if (prefersReducedMotion() || typeof requestAnimationFrame !== "function") {
      node.textContent = format(value);
      return;
    }
    let frame = 0;
    let started: number | null = null;
    const step = (ts: number) => {
      if (started === null) started = ts;
      const t = Math.min(1, (ts - started) / COUNT_MS);
      // Same sharp ease-out curve the section entrances use.
      const eased = 1 - Math.pow(1 - t, 3);
      node.textContent = format(Math.round(value * eased));
      if (t < 1) frame = requestAnimationFrame(step);
    };
    node.textContent = format(0);
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
    // `format` is derived purely from `value`, which is already a dep.
  }, [run, value]);

  return (
    <span ref={ref} data-testid={testId} className={className}>
      {format(value)}
    </span>
  );
}

export function StatTiles({ counts }: StatTilesProps) {
  const [started, setStarted] = useState(false);
  const [reduced] = useState(prefersReducedMotion);
  const total = counts.BLOCKED + counts.NEEDS_REVIEW + counts.SAFE;

  return (
    <div className="grid grid-cols-1 sm:grid-cols-3">
      {TILES.map((tile, i) => {
        const count = counts[tile.verdict];
        const pct = total === 0 ? 0 : Math.round((count / total) * 100);
        const live = count > 0;
        return (
          <motion.div
            key={tile.verdict}
            className="mirror-panel mirror-panel-hover relative overflow-hidden px-5 py-6 sm:-ml-px sm:first:ml-0 sm:px-6 sm:py-8"
            initial={reduced ? false : { opacity: 0, y: 18 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-60px" }}
            transition={{ delay: i * 0.08, duration: 0.5, ease: ENTRANCE_EASE }}
            onViewportEnter={() => setStarted(true)}
          >
            {/* Status rule — the tile's verdict colour, dimmed to a scar when
                the count is zero. */}
            <div
              aria-hidden="true"
              className="absolute inset-x-0 top-0 h-[2px]"
              style={{ background: tile.hex, opacity: live ? 1 : 0.22 }}
            />
            {live && tile.verdict === "BLOCKED" && <div className="mirror-scanline" />}

            {/* Hollow display word, bleeding off the tile's right edge. */}
            <span
              aria-hidden="true"
              className="mirror-display-crush pointer-events-none absolute -right-3 bottom-2 select-none text-[52px] sm:text-[64px]"
              style={{
                color: "transparent",
                WebkitTextStroke: `1px ${tile.hex}`,
                opacity: live ? 0.16 : 0.07,
              }}
            >
              {tile.ghost}
            </span>

            <div className="relative flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.3em] text-smoke">
              <span>{tile.index}</span>
              <span
                aria-hidden="true"
                className="h-1.5 w-1.5 rounded-full"
                style={{ background: tile.hex, opacity: live ? 1 : 0.3 }}
              />
              <span className="h-px flex-1" style={{ background: "var(--line)" }} />
              <span>{pct}%</span>
            </div>

            <div className="relative mt-5 flex items-end gap-2">
              <span className="flex items-end">
                {/* Dim leading zero — an odometer, not a padded number. */}
                {count < 10 && (
                  <span
                    aria-hidden="true"
                    className={`mirror-display-crush text-[64px] leading-none sm:text-[84px] ${tile.text}`}
                    style={{ opacity: 0.18 }}
                  >
                    0
                  </span>
                )}
                <CountUp
                  value={count}
                  run={started}
                  testId={`stat-${tile.verdict}`}
                  className={`mirror-display-crush text-[64px] leading-none tabular-nums sm:text-[84px] ${tile.text}`}
                />
              </span>
              <span className="mb-3 font-mono text-[10px] tracking-widest text-smoke">
                /{total}
              </span>
            </div>

            <div
              className={`relative mt-3 font-mono text-[11px] uppercase tracking-[0.28em] ${tile.text}`}
            >
              {tile.label}
            </div>

            {/* Real share of the scan, as a hairline meter. */}
            <div
              aria-hidden="true"
              className="relative mt-3 h-[3px] w-full overflow-hidden"
              style={{ background: "rgba(242,242,238,0.08)" }}
            >
              <motion.div
                className="h-full"
                style={{ width: `${pct}%`, background: tile.hex, transformOrigin: "left" }}
                initial={reduced ? false : { scaleX: 0 }}
                whileInView={{ scaleX: 1 }}
                viewport={{ once: true }}
                transition={{ delay: 0.25 + i * 0.08, duration: 0.7, ease: ENTRANCE_EASE }}
              />
            </div>
            <div className="relative mt-2 font-mono text-[10px] leading-snug text-smoke">
              {tile.note}
            </div>
          </motion.div>
        );
      })}
    </div>
  );
}
