import type { Verdict } from "../types";

interface StatTilesProps {
  counts: Record<Verdict, number>;
}

const TILES: { verdict: Verdict; label: string; color: string }[] = [
  { verdict: "BLOCKED", label: "Blocked", color: "text-blocked" },
  { verdict: "NEEDS_REVIEW", label: "Needs Review", color: "text-review" },
  { verdict: "SAFE", label: "Safe", color: "text-safe" },
];

export function StatTiles({ counts }: StatTilesProps) {
  return (
    <div className="grid grid-cols-3 gap-px border border-white/10 bg-white/10">
      {TILES.map((tile) => (
        <div key={tile.verdict} className="bg-void px-6 py-8">
          <div data-testid={`stat-${tile.verdict}`} className={`font-display font-black text-5xl ${tile.color}`}>
            {counts[tile.verdict]}
          </div>
          <div className="mt-2 font-mono text-xs uppercase tracking-widest text-white/50">{tile.label}</div>
        </div>
      ))}
    </div>
  );
}
