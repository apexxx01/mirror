import { useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import type { MirrorResult, ReversibilityLevel, MirrorBadge } from "../types";

interface VerdictRowProps {
  result: MirrorResult;
}

const BADGE: Record<MirrorResult["verdict"], string> = {
  BLOCKED: "bg-blocked text-void",
  NEEDS_REVIEW: "bg-review text-void",
  SAFE: "bg-safe text-void",
};

const REVERSIBILITY_PILL: Record<ReversibilityLevel, string> = {
  HIGH: "bg-safe/20 text-safe border border-safe/40",
  MEDIUM: "bg-review/20 text-review border border-review/40",
  LOW: "bg-blocked/20 text-blocked border border-blocked/40",
};

const SCORE_PILL: Record<MirrorBadge, string> = {
  CLEAR: "bg-safe/20 text-safe border border-safe/40",
  CAUTION: "bg-review/20 text-review border border-review/40",
  STOP: "bg-blocked/20 text-blocked border border-blocked/40",
};

function Pill({ className, children }: { className: string; children: React.ReactNode }) {
  return (
    <span className={`rounded-full px-2 py-1 text-[10px] font-bold uppercase tracking-widest ${className}`}>
      {children}
    </span>
  );
}

export function VerdictRow({ result }: VerdictRowProps) {
  const [open, setOpen] = useState(false);
  const { reversibility, mirror_score: mirrorScore, future_diff: futureDiff, rollback_plan: rollbackPlan } = result;

  return (
    <div className="border-b border-white/10 last:border-b-0">
      <button
        data-testid="row-toggle"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-controls={`row-detail-${result.resource}`}
        className="grid w-full grid-cols-[auto_1fr_auto_auto] items-center gap-3 px-4 py-3 text-left font-mono text-sm outline-none transition-colors duration-150 hover:bg-white/5 active:bg-white/10 focus-visible:bg-white/5 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-hazard sm:grid-cols-[auto_1fr_auto_auto_auto_auto]"
      >
        <Pill className={BADGE[result.verdict]}>{result.verdict.replace("_", " ")}</Pill>
        <span className="min-w-0 truncate text-white/90">{result.resource}</span>
        <span className="hidden sm:block">
          <Pill className={REVERSIBILITY_PILL[reversibility.level]}>{reversibility.level}</Pill>
        </span>
        <Pill className={SCORE_PILL[mirrorScore.badge]}>{mirrorScore.badge}</Pill>
        <span className="text-white/50">risk {result.risk_score}</span>
        <span className="text-white/30">{open ? "−" : "+"}</span>
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            id={`row-detail-${result.resource}`}
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25, ease: [0.4, 0, 0.2, 1] }}
            className="overflow-hidden"
          >
            <div className="mirror-glass mx-4 mb-4 space-y-5 px-5 py-5 font-mono text-xs text-white/70">
              <div>
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

              <div>
                <div className="mb-2 uppercase tracking-widest text-white/40">
                  Reversibility — {reversibility.level}
                </div>
                <div className="text-white/70">{reversibility.reason}</div>
              </div>

              <div>
                <div className="mb-2 uppercase tracking-widest text-white/40">
                  Future diff (before / after)
                </div>
                <div className="space-y-1">
                  <div>
                    <span className="text-white/40">this resource: </span>
                    exists <span className="text-white/40">&rarr;</span> {futureDiff.self.after.note}
                  </div>
                  {futureDiff.downstream.length === 0 ? (
                    <div className="text-white/50">no downstream effects — nothing else depends on this</div>
                  ) : (
                    futureDiff.downstream.map((effect) => (
                      <div key={effect.dependent} className="border-l-2 border-white/10 pl-3">
                        <div className="text-white/50">{effect.dependent} (via {effect.via})</div>
                        <div>before: {effect.before}</div>
                        <div>after: {effect.after}</div>
                      </div>
                    ))
                  )}
                </div>
              </div>

              <div>
                <div className="mb-2 uppercase tracking-widest text-white/40">Rollback plan</div>
                {rollbackPlan.available ? (
                  <ul className="space-y-1">
                    {rollbackPlan.steps.map((step, i) => (
                      <li key={i}>{step}</li>
                    ))}
                  </ul>
                ) : (
                  <div>no rollback path — {rollbackPlan.reason}</div>
                )}
              </div>

              <div>
                <div className="mb-2 uppercase tracking-widest text-white/40">Cedar policy output</div>
                <div className="rounded-lg border border-white/10 bg-black/30 px-3 py-2">
                  <div>decision: {result.cedar_decision}</div>
                  <div>reasons: [{result.cedar_reasons.join(", ") || "none"}]</div>
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
