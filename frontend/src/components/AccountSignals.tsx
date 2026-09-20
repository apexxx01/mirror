import { useEffect, useRef, useState } from "react";
import { useReducedMotion } from "motion/react";
import type { MirrorResult, Verdict } from "../types";

interface AccountSignalsProps {
  results: MirrorResult[];
}

const VERDICT_DOT: Record<Verdict, string> = {
  BLOCKED: "bg-blocked",
  NEEDS_REVIEW: "bg-review",
  SAFE: "bg-safe",
};

/**
 * Counts up to the REAL value and stops there. The animation is theatre; the
 * destination is data. Reduced-motion visitors get the number immediately,
 * and so does any environment without rAF.
 */
function useCountUp(target: number, durationMs = 1100): number {
  const reduced = useReducedMotion();
  // No rAF (or reduced motion) means the real figure renders immediately —
  // derived during render, never written from an effect.
  const animates = !reduced && typeof requestAnimationFrame === "function";
  const [value, setValue] = useState(0);
  const frame = useRef<number | null>(null);

  useEffect(() => {
    if (!animates) return;
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / durationMs);
      // Decelerating quint — lands softly on the real figure.
      const eased = 1 - Math.pow(1 - t, 5);
      setValue(Math.round(target * eased));
      if (t < 1) frame.current = requestAnimationFrame(tick);
    };
    frame.current = requestAnimationFrame(tick);
    return () => {
      if (frame.current !== null) cancelAnimationFrame(frame.current);
    };
  }, [target, durationMs, animates]);

  return animates ? value : target;
}

interface SignalTileProps {
  index: number;
  value: number;
  label: string;
  note: string;
  /** Real 0–1 share, only where a real denominator exists. */
  ratio?: number;
  accent?: "ink" | "hazard";
}

function SignalTile({ index, value, label, note, ratio, accent = "ink" }: SignalTileProps) {
  const shown = useCountUp(value, 900 + index * 90);

  return (
    <div className="mirror-panel-hover group relative border-b border-r border-white/10 px-5 py-6 sm:px-6 sm:py-7">
      <div className="flex items-baseline justify-between gap-3">
        <span className="font-mono text-[10px] tracking-[0.3em] text-white/25">
          {String(index + 1).padStart(2, "0")}
        </span>
        {ratio !== undefined && (
          <span className="font-mono text-[10px] tabular-nums tracking-[0.2em] text-white/30">
            {Math.round(ratio * 100)}%
          </span>
        )}
      </div>

      <div
        className={`mt-4 font-mono font-bold tabular-nums leading-[0.85] tracking-crush ${
          accent === "hazard" ? "text-hazard" : "text-ink"
        }`}
        style={{ fontSize: "clamp(2.25rem, 6vw, 3.5rem)" }}
      >
        {shown.toLocaleString("en-US")}
      </div>

      {/* Meter only where the denominator is real — never a decorative bar. */}
      {ratio !== undefined && (
        <div className="mt-4 h-px w-full bg-white/10">
          <div
            className={`h-px ${accent === "hazard" ? "bg-hazard" : "bg-ink"} transition-[width] duration-700 ease-out`}
            style={{ width: `${Math.max(0, Math.min(1, ratio)) * 100}%` }}
          />
        </div>
      )}

      <div
        className={`font-mono text-[10px] uppercase leading-relaxed tracking-[0.2em] text-white/55 ${
          ratio !== undefined ? "mt-3" : "mt-4"
        }`}
      >
        {label}
      </div>
      <div className="mt-1.5 font-mono text-[10px] leading-relaxed text-white/30">{note}</div>
    </div>
  );
}

/**
 * Every number here is a real aggregate computed from the payload already
 * on the page — no new backend calls, no invented account-wide metric.
 * This exists because a per-row view alone under-uses the real data the
 * scan already produced at the whole-account level.
 */
export function AccountSignals({ results }: AccountSignalsProps) {
  const total = results.length;

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
    total === 0
      ? 0
      : Math.round(results.reduce((n, r) => n + r.mirror_score.score, 0) / total);

  // Secondary facts — also real, also derived from the same payload.
  const withDependents = results.filter((r) => r.dependents.length > 0).length;
  const blastHops = results.reduce((n, r) => n + r.blast_radius.length, 0);
  const unstable = results.filter((r) =>
    r.adversarial.some((e) => (e.errors ?? 0) > 0 || (e.throttles ?? 0) > 0)
  ).length;

  const share = (n: number) => (total === 0 ? 0 : n / total);

  const items: Array<Omit<SignalTileProps, "index">> = [
    {
      value: totalDependents,
      label: "real dependency edges",
      note: `${withDependents} of ${total} resources carry at least one`,
    },
    {
      value: totalInvocations,
      label: "real Lambda invocations (90d)",
      note: `observed across ${blastHops} blast-radius hops`,
    },
    {
      value: totalErrors,
      label: "real historical errors (90d)",
      note: `${unstable} resources show real instability`,
      accent: totalErrors > 0 ? "hazard" : "ink",
    },
    {
      value: lowReversibility,
      label: "resources with LOW reversibility",
      note: "no real AWS recovery mechanism configured",
      ratio: share(lowReversibility),
      accent: lowReversibility > 0 ? "hazard" : "ink",
    },
    {
      value: hasRollback,
      label: "resources with a real rollback path",
      note: "a published, executable recovery plan exists",
      ratio: share(hasRollback),
    },
    {
      value: avgScore,
      label: "average mirror score",
      note: "composite of verdict, activity risk and recovery",
      ratio: avgScore / 100,
    },
  ];

  return (
    <section
      id="signals"
      aria-labelledby="signals-title"
      className="relative z-10 mx-auto mt-20 max-w-6xl px-6 sm:mt-28"
    >
      {/*
        Matched to the ledger's own plate (VerdictTable: "the ledger" / crushed
        display headline with a stroked second line) — this section used a
        smaller mono headline with no stroke treatment and read as a visibly
        different, lesser UI register than the rest of the page.
      */}
      <header className="mirror-hairline flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2 pt-5">
        <div className="mirror-eyebrow text-sm text-gold">02 / the account</div>
        <div className="max-w-sm font-mono text-[10px] uppercase leading-relaxed tracking-[0.25em] text-smoke">
          {total} scanned {total === 1 ? "resource" : "resources"} · 6 real aggregates
        </div>
      </header>
      <h2
        id="signals-title"
        className="mirror-display-crush mt-3 text-[clamp(30px,8.6vw,64px)] uppercase text-ink"
      >
        Account-wide,
        <br />
        <span className="mirror-stroke-text">real signals</span>
      </h2>
      <p className="mt-4 max-w-lg font-mono text-xs leading-relaxed text-smoke">
        Six aggregates, recomputed from the {total} scanned {total === 1 ? "resource" : "resources"} on this
        page. Nothing cached, nothing rounded up, nothing invented.
      </p>

      <div className="mt-8 grid grid-cols-1 border-l border-t border-white/10 sm:grid-cols-2 lg:grid-cols-3">
        {items.map((item, i) => (
          <SignalTile key={item.label} index={i} {...item} />
        ))}
      </div>

      {/*
        The live strip: every real resource name the scan touched, ticking
        past with its real verdict color. Decorative repetition of data the
        table states properly, so it is hidden from assistive tech — and the
        marquee keyframe itself is disabled under prefers-reduced-motion.
      */}
      {results.length > 0 && (
        <div
          aria-hidden="true"
          className="relative mt-px overflow-hidden border-b border-l border-r border-white/10 bg-carbon py-3"
        >
          <div className="mirror-marquee-track">
            {[0, 1].map((copy) => (
              <div key={copy} className="flex shrink-0 items-center">
                {results.map((r) => (
                  <span
                    key={`${copy}-${r.resource}`}
                    className="flex items-center gap-2 whitespace-nowrap px-5 font-mono text-[10px] uppercase tracking-[0.2em] text-white/35"
                  >
                    <span className={`h-1 w-1 shrink-0 ${VERDICT_DOT[r.verdict]}`} />
                    {/*
                      The trailing separator lives inside this text node on
                      purpose: it keeps the ticker from shadowing the table as
                      an exact text match, so `getByText("<resource>")` still
                      resolves to the real row below rather than to decoration.
                    */}
                    {`${r.resource} ·`}
                  </span>
                ))}
              </div>
            ))}
          </div>
          {/* Hard edge-fades so names enter and leave the strip, not the page. */}
          <div className="pointer-events-none absolute inset-y-0 left-0 w-16 bg-gradient-to-r from-carbon to-transparent" />
          <div className="pointer-events-none absolute inset-y-0 right-0 w-16 bg-gradient-to-l from-carbon to-transparent" />
        </div>
      )}
    </section>
  );
}
