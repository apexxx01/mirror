export function LoadingState() {
  return (
    <div data-testid="loading-state" className="flex min-h-screen items-center justify-center">
      <div className="font-mono text-sm uppercase tracking-widest text-white/50 animate-pulse">
        pulling real evidence from AWS...
      </div>
    </div>
  );
}
