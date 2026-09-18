import { useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import type { MirrorResult } from "../types";

interface VerdictRowProps {
  result: MirrorResult;
}

const BADGE: Record<MirrorResult["verdict"], string> = {
  BLOCKED: "bg-blocked text-void",
  NEEDS_REVIEW: "bg-review text-void",
  SAFE: "bg-safe text-void",
};

export function VerdictRow({ result }: VerdictRowProps) {
  const [open, setOpen] = useState(false);

  return (
    <div className="border-b border-white/10">
      <button
        data-testid="row-toggle"
        onClick={() => setOpen((o) => !o)}
        className="grid w-full grid-cols-[auto_1fr_auto_auto] items-center gap-4 px-4 py-3 text-left font-mono text-sm hover:bg-white/5 transition-colors duration-150"
      >
        <span className={`px-2 py-1 text-[10px] font-bold uppercase tracking-widest ${BADGE[result.verdict]}`}>
          {result.verdict.replace("_", " ")}
        </span>
        <span className="truncate text-white/90">{result.resource}</span>
        <span className="text-white/50">risk {result.risk_score}</span>
        <span className="text-white/30">{open ? "−" : "+"}</span>
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: [0.4, 0, 0.2, 1] }}
            className="overflow-hidden bg-white/5 px-4 font-mono text-xs text-white/70"
          >
            <div className="py-3">
              <div className="mb-2 uppercase tracking-widest text-white/40">Real dependents</div>
              {result.dependents.length === 0 ? (
                <div>no real dependents found</div>
              ) : (
                <ul className="space-y-1">
                  {result.dependents.map((dep) => (
                    <li key={dep}>{dep}</li>
                  ))}
                </ul>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
