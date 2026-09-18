export function PlaceholderState() {
  return (
    <div data-testid="placeholder-state" className="flex min-h-screen items-center justify-center px-6">
      <div className="max-w-md border border-white/20 px-6 py-5 text-center">
        <div className="font-display font-bold text-xl text-white">no data source configured</div>
        <div className="mt-2 font-mono text-xs text-white/60">
          set MIRROR_DATA_URL in src/config.ts to the URL printed by{" "}
          <code className="text-hazard">mirror.py --publish-s3</code>
        </div>
      </div>
    </div>
  );
}
