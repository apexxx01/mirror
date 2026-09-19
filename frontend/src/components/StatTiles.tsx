import type { Verdict } from "../types";
import { Glow } from "./Glow";

interface StatTilesProps {
  counts: Record<Verdict, number>;
}

const TILES: { verdict: Verdict; label: string; color: string; glowFrom: string }[] = [
  { verdict: "BLOCKED", label: "Blocked", color: "text-blocked", glowFrom: "rgba(220,38,38,0.35)" },
  { verdict: "NEEDS_REVIEW", label: "Needs Review", color: "text-review", glowFrom: "rgba(234,179,8,0.3)" },
  { verdict: "SAFE", label: "Safe", color: "text-safe", glowFrom: "rgba(22,163,74,0.3)" },
];

export function StatTiles({ counts }: StatTilesProps) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
      {TILES.map((tile) => (
        <div key={tile.verdict} className="mirror-glass relative overflow-hidden px-6 py-8">
          {counts[tile.verdict] > 0 && (
            <Glow
              colorFrom={tile.glowFrom}
              colorTo="rgba(0,0,0,0)"
              className="-right-10 -top-10 h-40 w-40"
            />
          )}
          <div
            data-testid={`stat-${tile.verdict}`}
            className={`relative font-display font-black text-5xl ${tile.color}`}
          >
            {counts[tile.verdict]}
          </div>
          <div className="relative mt-2 font-mono text-xs uppercase tracking-widest text-white/50">
            {tile.label}
          </div>
        </div>
      ))}
    </div>
  );
}
