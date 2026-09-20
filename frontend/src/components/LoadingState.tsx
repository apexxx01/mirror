import { useState } from "react";
import { motion } from "motion/react";
import { StateShell } from "./StateShell";

// A slow, deliberate breathe — not Tailwind's stock `animate-pulse` (a
// symmetric cubic-bezier(0.4,0,0.6,1) over 2s). This eases in slower than it
// eases out, so the line reads as scanning rather than blinking.
const PULSE_EASE = [0.65, 0, 0.35, 1] as const;

function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

/** The real stages the hook goes through, stated plainly while you wait. */
const STAGES = ["fetch", "graph", "cedar", "render"] as const;

export function LoadingState() {
  const [reduced] = useState(prefersReducedMotion);

  return (
    <StateShell
      testId="loading-state"
      status="scanning"
      title="Reading the account"
      accentText="text-gold"
      accentBg="bg-gold/60"
      accentBorder="border-gold/40"
      footnote="no data is rendered until the real payload lands"
    >
      <motion.div
        className="uppercase tracking-[0.25em] text-white/60"
        animate={reduced ? { opacity: 0.75 } : { opacity: [0.3, 1, 0.3] }}
        transition={reduced ? undefined : { duration: 1.8, repeat: Infinity, ease: PULSE_EASE }}
      >
        pulling real evidence from AWS...
      </motion.div>

      {/* A single hairline sweeping its track — progress as structure, not a spinner. */}
      <div className="mt-6 h-px w-full overflow-hidden bg-white/10">
        <motion.div
          className="h-px w-1/3 bg-gold"
          animate={reduced ? { x: 0 } : { x: ["-100%", "300%"] }}
          transition={reduced ? undefined : { duration: 2.2, repeat: Infinity, ease: "easeInOut" }}
        />
      </div>

      <div className="mt-5 flex flex-wrap gap-x-5 gap-y-2 text-[10px] uppercase tracking-[0.25em] text-white/25">
        {STAGES.map((stage, i) => (
          <span key={stage} className="flex items-center gap-2">
            <span className="h-1 w-1 shrink-0 bg-white/30" />
            {String(i + 1).padStart(2, "0")} {stage}
          </span>
        ))}
      </div>
    </StateShell>
  );
}
