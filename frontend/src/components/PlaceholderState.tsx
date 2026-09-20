import { StateShell } from "./StateShell";

/**
 * No data source configured yet — the honest pre-flight screen, with the
 * exact command that produces the URL this page needs.
 */
export function PlaceholderState() {
  return (
    <StateShell
      testId="placeholder-state"
      status="unconfigured"
      title="No data source configured"
      accentText="text-gold"
      accentBg="bg-gold/70"
      accentBorder="border-gold/40"
      footnote="mirror renders real scans only — there is no demo payload"
    >
      <p>
        Point the app at a published scan before it can show anything real.
      </p>
      <div className="mt-4 border border-white/10 bg-void px-4 py-3">
        <div className="text-[10px] uppercase tracking-[0.25em] text-white/30">step 01</div>
        <div className="mt-1.5 text-ink">
          run <code className="text-hazard">mirror.py --publish-s3</code>
        </div>
        <div className="mt-4 text-[10px] uppercase tracking-[0.25em] text-white/30">step 02</div>
        <div className="mt-1.5 break-words text-ink">
          set <code className="text-white/70">MIRROR_DATA_URL</code> in{" "}
          <code className="text-white/70">src/config.ts</code> to the URL it prints
        </div>
      </div>
    </StateShell>
  );
}
