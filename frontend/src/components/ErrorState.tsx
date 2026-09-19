interface ErrorStateProps {
  message: string;
}

export function ErrorState({ message }: ErrorStateProps) {
  return (
    <div data-testid="error-state" className="flex min-h-screen items-center justify-center px-6">
      <div className="max-w-md border border-blocked/50 bg-blocked/5 px-6 py-5 text-center">
        <div className="font-display font-bold text-xl text-blocked">could not load real data</div>
        <div className="mt-2 font-mono text-xs text-white/60">{message}</div>
      </div>
    </div>
  );
}
