import { motion } from "motion/react";
import type { Verdict } from "../types";

interface VerdictPillsProps {
  selected: Verdict[];
  onChange: (next: Verdict[]) => void;
  counts: Record<Verdict, number>;
}

const PILLS: { verdict: Verdict; label: string; activeClass: string }[] = [
  { verdict: "BLOCKED", label: "Blocked", activeClass: "bg-blocked text-void border-blocked" },
  { verdict: "NEEDS_REVIEW", label: "Needs Review", activeClass: "bg-review text-void border-review" },
  { verdict: "SAFE", label: "Safe", activeClass: "bg-safe text-void border-safe" },
];

export function VerdictPills({ selected, onChange, counts }: VerdictPillsProps) {
  const toggle = (verdict: Verdict) => {
    if (selected.includes(verdict)) {
      onChange(selected.filter((v) => v !== verdict));
    } else {
      onChange([...selected, verdict]);
    }
  };

  return (
    <div className="flex flex-wrap gap-3">
      {PILLS.map((pill) => {
        const active = selected.includes(pill.verdict);
        return (
          <motion.button
            key={pill.verdict}
            data-testid={`pill-${pill.verdict}`}
            onClick={() => toggle(pill.verdict)}
            whileTap={{ scale: 0.94 }}
            animate={{ scale: active ? 1.04 : 1 }}
            transition={{ type: "spring", stiffness: 300, damping: 20 }}
            className={`border px-4 py-2 font-mono text-xs uppercase tracking-widest transition-colors duration-150 ${
              active ? pill.activeClass : "border-white/30 text-white/70 hover:border-white/60"
            }`}
          >
            {pill.label} <span className="opacity-60">({counts[pill.verdict]})</span>
          </motion.button>
        );
      })}
    </div>
  );
}
