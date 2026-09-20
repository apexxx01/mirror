import { useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import type { MirrorResult, ReversibilityLevel, MirrorBadge, Verdict } from "../types";

interface VerdictRowProps {
  result: MirrorResult;
}

/**
 * One resource, two registers.
 *
 * Closed: a ledger line — verdict flag, resource id, and a strip of real
 * meters (mirror score, risk, dependent count, blast hops, historical
 * errors) so the row itself already carries evidence, not just a label.
 *
 * Open: the full dossier — all seven real signals laid out as a wall of
 * hairline panels. Nothing here is summarised away or invented; every
 * value is read straight off the MirrorResult the scan produced.
 */

const VERDICT_HEX: Record<Verdict, string> = {
  BLOCKED: "#DC2626",
  NEEDS_REVIEW: "#EAB308",
  SAFE: "#16A34A",
};

const VERDICT_TEXT: Record<Verdict, string> = {
  BLOCKED: "text-blocked",
  NEEDS_REVIEW: "text-review",
  SAFE: "text-safe",
};

const LEVEL_HEX: Record<ReversibilityLevel, string> = {
  HIGH: "#16A34A",
  MEDIUM: "#EAB308",
  LOW: "#DC2626",
};

const BADGE_HEX: Record<MirrorBadge, string> = {
  CLEAR: "#16A34A",
  CAUTION: "#EAB308",
  STOP: "#DC2626",
};

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

/** Tinted specimen pill — translucent fill of its own status colour. */
function Pill({ hex, children }: { hex: string; children: React.ReactNode }) {
  return (
    <span
      className="whitespace-nowrap rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.18em]"
      style={{ background: tint(hex, 0.14), borderColor: tint(hex, 0.45), color: hex }}
    >
      {children}
    </span>
  );
}

/**
 * A 0-100 meter. Both mirror_score and risk_score are real 0-100 values
 * from the scan (see decide.py), so the track length is honest.
 */
function Meter({ value, hex, label }: { value: number; hex: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className="text-smoke">{label}</span>
      <span className="tabular-nums text-ink/85">{value}</span>
      <span
        aria-hidden="true"
        className="hidden h-[3px] w-10 overflow-hidden sm:block"
        style={{ background: "rgba(242,242,238,0.10)" }}
      >
        <span
          className="block h-full"
          style={{ width: `${Math.max(0, Math.min(100, value))}%`, background: hex }}
        />
      </span>
    </span>
  );
}

function Signal({
  n,
  title,
  meta,
  className = "",
  children,
}: {
  n: number;
  title: string;
  meta?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={`relative overflow-hidden border border-white/10 bg-black/40 p-4 ${className}`}>
      <span
        aria-hidden="true"
        className="mirror-display-crush pointer-events-none absolute -bottom-3 right-1 select-none text-[48px] text-ink opacity-[0.05]"
      >
        {String(n).padStart(2, "0")}
      </span>
      <div className="relative mb-3 flex items-baseline gap-2 border-b border-white/10 pb-2">
        <span className="text-hazard">{String(n).padStart(2, "0")}</span>
        <span className="uppercase tracking-[0.22em] text-ink/70">{title}</span>
        {meta && <span className="ml-auto whitespace-nowrap text-[10px] text-smoke">{meta}</span>}
      </div>
      <div className="relative">{children}</div>
    </div>
  );
}

function Chip({ children }: { children: React.ReactNode }) {
  return (
    <span className="max-w-full truncate border border-white/10 bg-white/[0.03] px-2 py-1 text-[11px] text-ink/85">
      {children}
    </span>
  );
}

export function VerdictRow({ result }: VerdictRowProps) {
  const [open, setOpen] = useState(false);
  const [reduced] = useState(prefersReducedMotion);
  const {
    reversibility,
    mirror_score: mirrorScore,
    future_diff: futureDiff,
    rollback_plan: rollbackPlan,
    blast_radius: blastRadius = [],
    adversarial = [],
    decision_matrix: decisionMatrix = [],
  } = result;

  const totalErrors = adversarial.reduce((n, e) => n + (e.errors ?? 0), 0);
  const totalThrottles = adversarial.reduce((n, e) => n + (e.throttles ?? 0), 0);
  const hasInstability = totalErrors > 0 || totalThrottles > 0;
  const totalInvocations = blastRadius.reduce((n, e) => n + (e.invocations_90d ?? 0), 0);
  const maxHop = blastRadius.reduce((n, e) => Math.max(n, e.hop), 0);
  const hex = VERDICT_HEX[result.verdict];

  const panel = (i: number) =>
    reduced
      ? {}
      : {
          initial: { opacity: 0, y: 10 },
          animate: { opacity: 1, y: 0 },
          transition: { delay: 0.04 + i * 0.035, duration: 0.3, ease: [0.16, 1, 0.3, 1] as const },
        };

  return (
    <div className="relative border-b border-white/10 last:border-b-0">
      <button
        data-testid="row-toggle"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-controls={`row-detail-${result.resource}`}
        className="group relative block w-full py-3 pl-5 pr-4 text-left font-mono text-sm outline-none transition-colors duration-150 hover:bg-white/[0.03] active:bg-white/[0.06] focus-visible:bg-white/[0.03] focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-hazard"
      >
        {/* Verdict spine — the row's colour, brightening on hover. */}
        <span
          aria-hidden="true"
          className="absolute inset-y-0 left-0 w-[3px] transition-opacity duration-150 group-hover:opacity-100"
          style={{ background: hex, opacity: open ? 1 : 0.55 }}
        />

        <span className="flex items-center gap-3">
          <Pill hex={hex}>{result.verdict.replace("_", " ")}</Pill>
          <span className="min-w-0 flex-1 truncate text-ink/90">{result.resource}</span>
          <span
            aria-hidden="true"
            className="shrink-0 text-lg leading-none text-smoke transition-colors duration-150 group-hover:text-ink"
          >
            {open ? "−" : "+"}
          </span>
        </span>

        {/* Real evidence strip — visible before anything is expanded. */}
        <span className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[11px] uppercase tracking-[0.12em]">
          <Pill hex={LEVEL_HEX[reversibility.level]}>rev {reversibility.level}</Pill>
          <Pill hex={BADGE_HEX[mirrorScore.badge]}>{mirrorScore.badge}</Pill>
          <Meter value={mirrorScore.score} hex={BADGE_HEX[mirrorScore.badge]} label="score" />
          <Meter value={result.risk_score} hex={hex} label="risk" />
          <span className="text-smoke">
            deps <span className="tabular-nums text-ink/85">{result.dependents.length}</span>
          </span>
          <span className="text-smoke">
            blast <span className="tabular-nums text-ink/85">{blastRadius.length}</span>
          </span>
          <span className="text-smoke">
            err{" "}
            <span className={`tabular-nums ${hasInstability ? "text-blocked" : "text-ink/85"}`}>
              {totalErrors}
            </span>
          </span>
          <span className="hidden text-smoke sm:inline">
            {result.node_type.replace(/_/g, " ")}
          </span>
        </span>
      </button>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            id={`row-detail-${result.resource}`}
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: reduced ? 0 : 0.28, ease: [0.4, 0, 0.2, 1] }}
            className="overflow-hidden"
          >
            <div className="border-t border-white/10 bg-black/30 px-4 py-5 font-mono text-xs text-ink/70 sm:px-5">
              <div className="mb-4 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-white/10 pb-3">
                <div className="text-[10px] font-bold uppercase tracking-[0.25em] text-ink/50">
                  Full Story — all 7 real signals
                </div>
                <div
                  className={`text-[10px] font-bold uppercase tracking-[0.25em] ${VERDICT_TEXT[result.verdict]}`}
                >
                  {result.verdict.replace("_", " ")}
                </div>
              </div>

              <div className="grid grid-cols-1 gap-px bg-white/5 lg:grid-cols-2">
                {/* 1. Verdict & Cedar output — the kill-switch / shadow-execution proof */}
                <motion.div {...panel(0)} className="lg:col-span-2">
                  <Signal
                    n={1}
                    title="Verdict & real Cedar policy output"
                    meta={`${result.cedar_reasons.length} policy reason(s)`}
                  >
                    <div className="border border-white/10 bg-black/50 px-3 py-2 leading-relaxed">
                      <div>
                        <span aria-hidden="true" className="mr-2 text-hazard">
                          ▸
                        </span>
                        decision: {result.cedar_decision}
                      </div>
                      <div>
                        <span aria-hidden="true" className="mr-2 text-hazard">
                          ▸
                        </span>
                        reasons: [{result.cedar_reasons.join(", ") || "none"}]
                      </div>
                    </div>
                    <div className="mt-3">
                      <div className="mb-1.5 text-[10px] uppercase tracking-[0.22em] text-smoke">
                        real dependents
                      </div>
                      {result.dependents.length === 0 ? (
                        <span className="text-ink/60">no real dependents found</span>
                      ) : (
                        <div className="flex flex-wrap gap-1.5">
                          {result.dependents.map((dep) => (
                            <Chip key={dep}>{dep}</Chip>
                          ))}
                        </div>
                      )}
                    </div>
                  </Signal>
                </motion.div>

                {/* 2. Blast radius — transitive chain + real traffic */}
                <motion.div {...panel(1)}>
                  <Signal
                    n={2}
                    title="Blast radius"
                    meta={maxHop > 0 ? `${maxHop} hop(s) deep` : "no chain"}
                  >
                    {blastRadius.length === 0 ? (
                      <div className="text-ink/60">
                        no transitive dependents — nothing downstream is affected
                      </div>
                    ) : (
                      <ul className="space-y-1.5">
                        {blastRadius.map((entry) => (
                          <li key={entry.resource} className="flex flex-wrap items-baseline gap-2">
                            <span className="border border-white/10 px-1.5 py-0.5 text-[10px] uppercase tracking-widest text-smoke">
                              hop {entry.hop}
                            </span>
                            <span className="min-w-0 break-all text-ink/85">{entry.resource}</span>
                            {typeof entry.invocations_90d === "number" && (
                              <span className="text-smoke">
                                {entry.invocations_90d} real invocations (90d)
                              </span>
                            )}
                          </li>
                        ))}
                      </ul>
                    )}
                    {totalInvocations > 0 && (
                      <div className="mt-3 border-t border-white/10 pt-2 text-[10px] uppercase tracking-[0.18em] text-smoke">
                        <span className="tabular-nums text-ink/85">{totalInvocations}</span> real
                        invocations across the chain
                      </div>
                    )}
                  </Signal>
                </motion.div>

                {/* 3. Adversarial evidence — real historical errors/throttles */}
                <motion.div {...panel(2)}>
                  <Signal
                    n={3}
                    title="Adversarial check"
                    meta={`${adversarial.length} lambda(s) checked`}
                  >
                    {adversarial.length === 0 ? (
                      <div className="text-ink/60">
                        no Lambda functions in this chain — no reliability signal to check
                      </div>
                    ) : (
                      <>
                        <div className="mb-3 flex gap-6">
                          <div>
                            <div
                              className={`mirror-display text-[28px] tabular-nums ${hasInstability ? "text-blocked" : "text-ink/80"}`}
                            >
                              {totalErrors}
                            </div>
                            <div className="text-[10px] uppercase tracking-[0.2em] text-smoke">
                              errors 90d
                            </div>
                          </div>
                          <div>
                            <div
                              className={`mirror-display text-[28px] tabular-nums ${totalThrottles > 0 ? "text-blocked" : "text-ink/80"}`}
                            >
                              {totalThrottles}
                            </div>
                            <div className="text-[10px] uppercase tracking-[0.2em] text-smoke">
                              throttles 90d
                            </div>
                          </div>
                        </div>
                        <ul className="space-y-1.5">
                          {adversarial.map((entry) => (
                            <li key={entry.resource}>
                              <span className="break-all text-ink/85">{entry.resource}</span>
                              <span className="text-smoke">
                                {" "}
                                — errors: {entry.errors ?? "unknown"}, throttles:{" "}
                                {entry.throttles ?? "unknown"} (90d)
                              </span>
                            </li>
                          ))}
                        </ul>
                        <div
                          className={`mt-2 border-t border-white/10 pt-2 ${hasInstability ? "text-blocked" : "text-ink/60"}`}
                        >
                          {hasInstability
                            ? `real historical instability: ${totalErrors} error(s), ${totalThrottles} throttle(s)`
                            : "no historical error evidence found — a real negative result, not a claim it \"passed\""}
                        </div>
                      </>
                    )}
                  </Signal>
                </motion.div>

                {/* 4. Decision matrix — real counterfactuals */}
                <motion.div {...panel(3)} className="lg:col-span-2">
                  <Signal
                    n={4}
                    title="Decision matrix (real counterfactuals)"
                    meta={`${decisionMatrix.length} scenario(s), same engine`}
                  >
                    <div className="-mx-1 overflow-x-auto">
                      <table className="w-full min-w-[420px] text-left">
                        <thead>
                          <tr className="border-b border-white/10 text-[10px] uppercase tracking-[0.2em] text-smoke">
                            <th className="px-2 py-1.5 font-normal">scenario</th>
                            <th className="px-2 py-1.5 font-normal">deps</th>
                            <th className="px-2 py-1.5 font-normal">risk</th>
                            <th className="px-2 py-1.5 font-normal">verdict</th>
                          </tr>
                        </thead>
                        <tbody>
                          {decisionMatrix.map((row) => (
                            <tr
                              key={row.scenario}
                              className="border-b border-white/5 transition-colors duration-150 last:border-b-0 hover:bg-white/[0.03]"
                            >
                              <td className="px-2 py-1.5 text-ink/75">{row.scenario}</td>
                              <td className="px-2 py-1.5 tabular-nums">{row.dependents_count}</td>
                              <td className="px-2 py-1.5 tabular-nums">{row.risk_score}</td>
                              <td className="px-2 py-1.5">
                                <span
                                  className="whitespace-nowrap px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.16em]"
                                  style={{
                                    background: tint(VERDICT_HEX[row.verdict], 0.14),
                                    color: VERDICT_HEX[row.verdict],
                                  }}
                                >
                                  {row.verdict.replace("_", " ")}
                                </span>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </Signal>
                </motion.div>

                {/* 5. Reversibility */}
                <motion.div {...panel(4)}>
                  <Signal n={5} title="Reversibility" meta={reversibility.level}>
                    <div className="mb-2 flex items-center gap-2">
                      <Pill hex={LEVEL_HEX[reversibility.level]}>{reversibility.level}</Pill>
                      <span
                        aria-hidden="true"
                        className="h-[3px] flex-1"
                        style={{ background: tint(LEVEL_HEX[reversibility.level], 0.35) }}
                      />
                    </div>
                    <div className="leading-relaxed text-ink/75">{reversibility.reason}</div>
                  </Signal>
                </motion.div>

                {/* 6. Rollback plan */}
                <motion.div {...panel(5)}>
                  <Signal
                    n={6}
                    title="Rollback plan"
                    meta={rollbackPlan.available ? `${rollbackPlan.steps.length} step(s)` : "none"}
                  >
                    {rollbackPlan.available ? (
                      <ol className="space-y-1.5">
                        {rollbackPlan.steps.map((step, i) => (
                          <li key={i} className="flex gap-2">
                            <span className="shrink-0 text-smoke tabular-nums">
                              {String(i + 1).padStart(2, "0")}
                            </span>
                            <span className="leading-relaxed text-ink/80">{step}</span>
                          </li>
                        ))}
                      </ol>
                    ) : (
                      <div className="text-blocked">no rollback path — {rollbackPlan.reason}</div>
                    )}
                  </Signal>
                </motion.div>

                {/* 7. Future diff */}
                <motion.div {...panel(6)} className="lg:col-span-2">
                  <Signal
                    n={7}
                    title="Future diff (real before / after)"
                    meta={`action: ${futureDiff.action}`}
                  >
                    <div className="border border-white/10 bg-black/50 px-3 py-2">
                      <span className="text-smoke">this resource: </span>
                      exists <span className="text-hazard">&rarr;</span>{" "}
                      {futureDiff.self.after.note}
                    </div>
                    <div className="mt-3 space-y-2">
                      {futureDiff.downstream.length === 0 ? (
                        <div className="text-ink/60">
                          no downstream effects — nothing else depends on this
                        </div>
                      ) : (
                        futureDiff.downstream.map((effect) => (
                          <div
                            key={effect.dependent}
                            className="border-l-2 pl-3"
                            style={{ borderColor: tint(hex, 0.5) }}
                          >
                            <div className="break-all text-ink/85">
                              {effect.dependent}{" "}
                              <span className="text-smoke">(via {effect.via})</span>
                            </div>
                            <div className="mt-1 grid gap-1 sm:grid-cols-2">
                              <div className="border border-white/10 px-2 py-1">
                                <span className="text-smoke">before: </span>
                                {effect.before}
                              </div>
                              <div
                                className="border px-2 py-1"
                                style={{
                                  borderColor: tint(hex, 0.3),
                                  background: tint(hex, 0.06),
                                }}
                              >
                                <span className="text-smoke">after: </span>
                                {effect.after}
                              </div>
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  </Signal>
                </motion.div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
