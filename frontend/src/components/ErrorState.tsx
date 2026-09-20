import { StateShell } from "./StateShell";

interface ErrorStateProps {
  message: string;
}

/**
 * Mirror's whole thesis is refusing to pretend. If the real payload can't be
 * read, the page says exactly that and shows the raw failure — no skeleton
 * rows, no cached numbers, no "demo mode".
 */
export function ErrorState({ message }: ErrorStateProps) {
  return (
    <StateShell
      testId="error-state"
      status="failed"
      title="Could not load real data"
      accentText="text-blocked"
      accentBg="bg-blocked"
      accentBorder="border-blocked/50"
      footnote="mirror shows nothing rather than showing something fake"
    >
      <p>
        The scan payload could not be fetched, so there is nothing real to render yet.
      </p>
      <div className="mt-4 border border-blocked/40 bg-blocked/5 px-4 py-3">
        <div className="text-[10px] uppercase tracking-[0.25em] text-blocked/70">raw failure</div>
        <div className="mt-1.5 break-words text-blocked">{message}</div>
      </div>
    </StateShell>
  );
}
