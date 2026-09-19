import { motion } from "motion/react";
import type { MirrorResult } from "../types";
import { Glow } from "./Glow";

interface KillSwitchBannerProps {
  results: MirrorResult[];
}

/**
 * Independent of whether a Bedrock summary exists — this is Mirror's own
 * "I'm not confident enough to auto-approve" signal (Cedar's implicit
 * deny, surfaced as NEEDS_REVIEW), and it renders whenever that's real,
 * listing the actual resource names it applies to.
 */
export function KillSwitchBanner({ results }: KillSwitchBannerProps) {
  const needsReview = results.filter((r) => r.verdict === "NEEDS_REVIEW");
  if (needsReview.length === 0) return null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-80px" }}
      transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
      className="relative z-10 mx-auto mt-16 max-w-4xl px-6"
    >
      <div className="mirror-glass relative overflow-hidden px-6 py-6">
        <Glow
          colorFrom="rgba(234,179,8,0.4)"
          colorTo="rgba(0,0,0,0)"
          className="-left-16 -top-16 h-56 w-56"
        />
        <div className="relative">
          <div className="flex items-center gap-2">
            <span className="rounded-full bg-review/20 px-2.5 py-1 font-mono text-[10px] font-bold uppercase tracking-widest text-review">
              Kill switch
            </span>
            <span className="font-mono text-[10px] uppercase tracking-widest text-white/40">
              {needsReview.length} resource{needsReview.length === 1 ? "" : "s"} held back
            </span>
          </div>
          <p className="mt-3 max-w-2xl font-mono text-xs leading-relaxed text-white/70">
            Mirror refuses to auto-approve these — not enough signal to call them safe, and
            no real dependent forces a hard block either. A human should look.
          </p>
          <ul className="mt-3 space-y-1 font-mono text-xs text-white/50">
            {needsReview.map((r) => (
              <li key={r.resource}>{r.resource}</li>
            ))}
          </ul>
        </div>
      </div>
    </motion.div>
  );
}
