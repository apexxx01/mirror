/**
 * Restraint on purpose: one hairline, the wordmark, the provenance claim,
 * and a live status chip. Nothing here competes with the page above it.
 */
export function Footer() {
  return (
    <footer className="relative z-10 mt-20 w-full border-t border-white/15 sm:mt-28">
      <div className="mx-auto flex max-w-6xl flex-col gap-6 px-6 py-10 sm:py-12 md:flex-row md:items-center md:justify-between">
        <div className="flex items-center gap-4">
          <span className="font-display text-lg font-black tracking-tight text-ink">
            MIRROR<span className="text-hazard">*</span>
          </span>
          <span className="hidden h-6 w-px bg-white/15 sm:block" />
          <span className="hidden font-mono text-[10px] uppercase tracking-[0.3em] text-white/30 sm:block">
            aws dependency guardrail
          </span>
        </div>

        <p className="max-w-lg font-mono text-[11px] leading-relaxed text-white/35 md:text-right">
          every value on this page is a real scan of this AWS account, published by the last{" "}
          <code className="text-white/55">mirror.py</code> run — nothing here is simulated.
        </p>
      </div>

      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-4 gap-y-3 border-t border-white/10 px-6 py-4">
        <span className="flex items-center gap-2 border border-white/10 bg-carbon px-3 py-1.5 font-mono text-[9px] uppercase tracking-[0.25em] text-white/45">
          <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-safe" />
          real data only
        </span>
        <span className="font-mono text-[9px] uppercase tracking-[0.25em] text-white/25">
          cedar · bedrock · cloudwatch
        </span>
      </div>
    </footer>
  );
}
