import { useState } from "react";
import { motion } from "motion/react";
import type { Verdict } from "../types";

interface VerdictPillsProps {
  selected: Verdict[];
  onChange: (next: Verdict[]) => void;
  counts: Record<Verdict, number>;
}

/**
 * Specimen-tray filter pills: each verdict is a translucent tint of its own
 * fixed status colour rather than a solid fill, so the row reads as a
 * taxonomy (three categories of evidence) instead of a priority ladder.
 * Counts are the real per-verdict totals already computed from `results`.
 */

const PILLS: { verdict: Verdict; label: string; hex: string }[] = [
  { verdict: "BLOCKED", label: "Blocked", hex: "#DC2626" },
  { verdict: "NEEDS_REVIEW", label: "Needs Review", hex: "#EAB308" },
  { verdict: "SAFE", label: "Safe", hex: "#16A34A" },
];

const SPRING = { type: "spring", stiffness: 420, damping: 17, mass: 0.6 } as const;

function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

function tint(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export function VerdictPills({ selected, onChange, counts }: VerdictPillsProps) {
  const [reduced] = useState(prefersReducedMotion);
  const total = counts.BLOCKED + counts.NEEDS_REVIEW + counts.SAFE;
  const allActive = selected.length === 0;

  const toggle = (verdict: Verdict) => {
    if (selected.includes(verdict)) {
      onChange(selected.filter((v) => v !== verdict));
    } else {
      onChange([...selected, verdict]);
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="mirror-eyebrow mr-1 text-xs text-smoke">filter</span>

      <motion.button
        data-testid="pill-ALL"
        onClick={() => onChange([])}
        aria-pressed={allActive}
        whileTap={{ scale: 0.92 }}
        whileHover={{ y: -2 }}
        animate={{ scale: allActive ? 1.04 : 1 }}
        transition={SPRING}
        className="rounded-full border px-4 py-2 font-mono text-[11px] uppercase tracking-[0.2em] outline-none transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-hazard focus-visible:ring-offset-2 focus-visible:ring-offset-void"
        style={{
          background: allActive ? "rgba(242,242,238,0.10)" : "transparent",
          borderColor: allActive ? "rgba(242,242,238,0.45)" : "var(--line)",
          color: allActive ? "var(--ink)" : "var(--smoke)",
        }}
      >
        all
        <span className="ml-2 tabular-nums opacity-50">{total}</span>
      </motion.button>

      {PILLS.map((pill) => {
        const active = selected.includes(pill.verdict);
        const count = counts[pill.verdict];
        return (
          <motion.button
            key={pill.verdict}
            data-testid={`pill-${pill.verdict}`}
            onClick={() => toggle(pill.verdict)}
            aria-pressed={active}
            whileTap={{ scale: 0.92 }}
            whileHover={{ y: -2 }}
            animate={{ scale: active ? 1.06 : 1 }}
            transition={SPRING}
            className="group flex items-center gap-2 rounded-full border px-4 py-2 font-mono text-[11px] uppercase tracking-[0.2em] outline-none transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-hazard focus-visible:ring-offset-2 focus-visible:ring-offset-void"
            style={{
              background: active ? tint(pill.hex, 0.16) : "transparent",
              borderColor: active ? tint(pill.hex, 0.5) : "var(--line)",
              color: active ? pill.hex : "var(--smoke)",
            }}
          >
            <motion.span
              aria-hidden="true"
              className="h-1.5 w-1.5 rounded-full"
              style={{ background: pill.hex, opacity: active ? 1 : 0.35 }}
              animate={active && !reduced ? { opacity: [1, 0.3, 1] } : { opacity: active ? 1 : 0.35 }}
              transition={
                active && !reduced
                  ? { duration: 1.8, repeat: Infinity, ease: "easeInOut" }
                  : { duration: 0.2 }
              }
            />
            {pill.label}
            <span
              className="tabular-nums"
              style={{ color: active ? pill.hex : "var(--smoke)", opacity: 0.6 }}
            >
              {count}
            </span>
          </motion.button>
        );
      })}
    </div>
  );
}
