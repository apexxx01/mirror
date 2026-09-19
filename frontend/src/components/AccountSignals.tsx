import type { MirrorResult } from "../types";

interface AccountSignalsProps {
  results: MirrorResult[];
}

/**
 * Every number here is a real aggregate computed from the payload already
 * on the page — no new backend calls, no invented account-wide metric.
 * This exists because a per-row view alone under-uses the real data the
 * scan already produced at the whole-account level.
 */
export function AccountSignals({ results }: AccountSignalsProps) {
  const totalDependents = results.reduce((n, r) => n + r.dependents.length, 0);
  const totalInvocations = results.reduce(
    (n, r) => n + r.blast_radius.reduce((m, e) => m + (e.invocations_90d ?? 0), 0),
    0
  );
  const totalErrors = results.reduce(
    (n, r) => n + r.adversarial.reduce((m, e) => m + (e.errors ?? 0), 0),
    0
  );
  const lowReversibility = results.filter((r) => r.reversibility.level === "LOW").length;
  const hasRollback = results.filter((r) => r.rollback_plan.available).length;
  const avgScore =
    results.length === 0
      ? 0
      : Math.round(results.reduce((n, r) => n + r.mirror_score.score, 0) / results.length);

  const items = [
    { label: "real dependency edges", value: totalDependents },
    { label: "real Lambda invocations (90d)", value: totalInvocations },
    { label: "real historical errors (90d)", value: totalErrors },
    { label: "resources with LOW reversibility", value: lowReversibility },
    { label: "resources with a real rollback path", value: hasRollback },
    { label: "average mirror score", value: avgScore },
  ];

  return (
    <section className="relative z-10 mx-auto max-w-4xl px-6 pt-4">
      <div className="mirror-glass px-6 py-5">
        <div className="mb-3 font-mono text-[10px] uppercase tracking-widest text-white/40">
          account-wide real signals
        </div>
        <div className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3">
          {items.map((item) => (
            <div key={item.label}>
              <div className="font-mono text-xl font-bold text-white/90">{item.value}</div>
              <div className="font-mono text-[10px] uppercase tracking-widest text-white/40">
                {item.label}
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
