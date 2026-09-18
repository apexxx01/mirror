import { useState } from "react";
import { motion } from "motion/react";

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

export function LoadingState() {
  const [reduced] = useState(prefersReducedMotion);

  return (
    <div data-testid="loading-state" className="flex min-h-screen items-center justify-center">
      <motion.div
        className="font-mono text-sm uppercase tracking-widest text-white/50"
        animate={reduced ? { opacity: 0.75 } : { opacity: [0.3, 1, 0.3] }}
        transition={
          reduced
            ? undefined
            : { duration: 1.8, repeat: Infinity, ease: PULSE_EASE }
        }
      >
        pulling real evidence from AWS...
      </motion.div>
    </div>
  );
}
