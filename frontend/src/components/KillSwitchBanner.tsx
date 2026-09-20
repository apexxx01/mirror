import { motion, useReducedMotion } from "motion/react";
import type { MirrorResult } from "../types";

interface KillSwitchBannerProps {
  results: MirrorResult[];
}

/**
 * Independent of whether a Bedrock summary exists — this is Mirror's own
 * "I'm not confident enough to auto-approve" signal (Cedar's implicit
 * deny, surfaced as NEEDS_REVIEW), and it renders whenever that's real,
 * listing the actual resource names it applies to.
 *
 * Visually this is the page's single detonation: the one full-bleed
 * hazard-red surface, black type, no container, no card. Everywhere else
 * Mirror is hairlines on obsidian — here the system slams on the brakes,
 * and the layout stops being polite about it.
 */
export function KillSwitchBanner({ results }: KillSwitchBannerProps) {
  const reduced = useReducedMotion();
  const needsReview = results.filter((r) => r.verdict === "NEEDS_REVIEW");
  if (needsReview.length === 0) return null;

  const plural = needsReview.length === 1 ? "" : "s";

  return (
    <motion.section
      aria-labelledby="kill-switch-title"
      initial={reduced ? false : { opacity: 0, scaleY: 0.94 }}
      whileInView={{ opacity: 1, scaleY: 1 }}
      viewport={{ once: true, margin: "-60px" }}
      transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
      style={{ transformOrigin: "top center" }}
      className="mirror-detonation relative z-10 mt-20 w-full overflow-hidden sm:mt-28"
    >
      <div className="mx-auto max-w-6xl px-6 py-12 sm:py-16">
        {/* Status line — black chip, hard rule, plain statement of what happened. */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
          <span className="bg-void px-3 py-1.5 font-mono text-[10px] font-bold uppercase tracking-[0.3em] text-hazard">
            Kill switch
          </span>
          <span className="font-mono text-[10px] font-bold uppercase tracking-[0.3em] text-void/70">
            auto-approval withheld
          </span>
          <span className="hidden h-px flex-1 bg-void/30 sm:block" />
          <span className="font-mono text-[10px] uppercase tracking-[0.3em] text-void/70">
            cedar: implicit deny
          </span>
        </div>

        {/* The number is the message. Everything else is caption. */}
        <div className="mt-8 flex flex-col gap-4 sm:flex-row sm:items-end sm:gap-8">
          <div
            className="mirror-display-crush text-void"
            style={{ fontSize: "clamp(4.5rem, 16vw, 10rem)" }}
          >
            {needsReview.length}
          </div>
          <h2
            id="kill-switch-title"
            className="pb-1 font-mono text-xl font-bold uppercase leading-[1.05] tracking-crush text-void sm:pb-3 sm:text-3xl"
          >
            resource{plural} held
            <br className="hidden sm:block" /> for a human
          </h2>
        </div>

        <p className="mt-6 max-w-2xl font-mono text-xs leading-relaxed text-void/75 sm:text-[13px]">
          Mirror refuses to auto-approve these — not enough signal to call them safe, and no real
          dependent forces a hard block either. A human should look.
        </p>

        {/* The held resources, stated one per line on black rules. */}
        <ul className="mt-8 border-t border-void/25">
          {needsReview.map((r, i) => (
            <motion.li
              key={r.resource}
              initial={reduced ? false : { opacity: 0, x: -8 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.3, delay: 0.08 + i * 0.05, ease: "easeOut" }}
              className="flex items-baseline gap-4 border-b border-void/25 py-3"
            >
              <span className="shrink-0 font-mono text-[10px] tabular-nums tracking-[0.3em] text-void/50">
                {String(i + 1).padStart(2, "0")}
              </span>
              <span className="min-w-0 break-all font-mono text-xs font-bold text-void sm:text-sm">
                {r.resource}
              </span>
              <span className="ml-auto shrink-0 border border-void/40 px-2 py-0.5 font-mono text-[9px] font-bold uppercase tracking-[0.2em] text-void/70">
                held
              </span>
            </motion.li>
          ))}
        </ul>
      </div>

      {/* Hazard tape: a black band running the full bleed, ticking the one
          instruction that matters. Decorative repetition, hidden from AT. */}
      <div aria-hidden="true" className="overflow-hidden bg-void py-2">
        <div className="mirror-marquee-track">
          {[0, 1].map((copy) => (
            <div key={copy} className="flex shrink-0 items-center">
              {Array.from({ length: 8 }).map((_, i) => (
                <span
                  key={i}
                  className="whitespace-nowrap px-6 font-mono text-[10px] font-bold uppercase tracking-[0.3em] text-hazard"
                >
                  human review required
                </span>
              ))}
            </div>
          ))}
        </div>
      </div>
    </motion.section>
  );
}
