import { useEffect, useRef, useState } from "react";
import { motion } from "motion/react";
import { Glow } from "./Glow";
import type { Verdict } from "../types";

interface HeroProps {
  counts: Record<Verdict, number>;
  total: number;
}

/**
 * The headline is Mirror's thesis, and the reveal performs it rather than
 * merely displaying it: the page states the comfortable lie at full volume,
 * holds long enough for you to believe it, then strikes it out and delivers
 * the verdict in hazard red. One orchestrated sequence, no scattered effects.
 *
 * Everything around that sequence is choreographed to it rather than fading in
 * alongside it — eyebrow, then type, then the readout rail, then the
 * standfirst, each on its own beat. And the whole stack is scroll-linked: the
 * type lifts and dims as you leave, the readout rail sinks the other way, so
 * the hero dismantles itself instead of scrolling away as one flat slab.
 *
 * Every number rendered here traces to the real `counts`/`total` the scan
 * produced. Nothing counts up from zero and nothing is rounded for effect —
 * a rolling counter would put wrong numbers on screen, which this page cannot
 * afford even for 400ms.
 */
const CLAIM_LINES = ["this resource", "looks safe", "to delete."] as const;
const CLAIM = CLAIM_LINES.join(" "); // "this resource looks safe to delete."
const VERDICT = "it isn't.";
/** The middle line is set hollow — the claim is structurally empty. */
const HOLLOW_LINE = 1;

/** Start index of each visual line within CLAIM. */
const CLAIM_OFFSETS = CLAIM_LINES.map((_, i) =>
  CLAIM_LINES.slice(0, i).reduce((n, line) => n + line.length + 1, 0),
);

const LEAD_IN_MS = 260; // a caret alone on black before anything is claimed
const HOLD_AFTER_CLAIM_MS = 750; // the beat where you believe it

/**
 * The strike is one duration expressed in two places — a CSS transition and a
 * JS wait — so it gets one source of truth. STRIKE_TRANSITION_MS is
 * interpolated into HERO_CSS below; STRIKE_SWEEP_MS is derived from it, so
 * retuning the sweep can never leave the verdict typing over a rule that is
 * still moving.
 */
const STRIKE_TRANSITION_MS = 460; // one rule's own left-to-right sweep
const STRIKE_STAGGER_MS = 60; // each line is struck after the one above it
/** Last rule's start offset + its own sweep, plus a frame of settle. */
const STRIKE_SWEEP_MS =
  STRIKE_STAGGER_MS * (CLAIM_LINES.length - 1) + STRIKE_TRANSITION_MS + 20;

/**
 * The claim's type size, named once because GraphBackground's legibility veil
 * is derived from it (see `--hero-text-edge` in GraphBackground.tsx). Change
 * this and that veil stops tracking the real right edge of the headline.
 *
 * Bounds are set by the longest line, "this resource": 7.87em in Unbounded 700
 * at default tracking, ~7.9em at the 900 weight and -0.055em tracking
 * `.mirror-display-crush` applies. At the 320px floor that is 7.9 x 32px =
 * 253px inside a 272px gutter-to-gutter measure, so the claim can never wrap
 * or push the page sideways.
 */
const CLAIM_SIZE = "clamp(1.9rem, 10vw, 9rem)";

/**
 * Cadence, not a metronome. A constant interval reads as machinery; a human
 * cadence breathes at word boundaries. The variation is derived from the
 * character index rather than Math.random so every run is identical — this
 * headline gets screen-recorded, and takes should match.
 */
function claimDelay(typed: number): number {
  if (CLAIM[typed - 1] === " ") return 62;
  return 30 + ((typed * 37) % 17);
}

/** The correction is slower. Each character lands like a separate fact. */
function verdictDelay(typed: number): number {
  return 70 + ((typed * 53) % 29);
}

const HERO_CSS = `
/*
  Struck at the optical centre of the x-height, not the middle of the line box.
  Measured against Unbounded 900: x-height 0.571em, ascent 0.995em, descent
  0.245em. With .mirror-display-crush's line-height of 0.74 the half-leading is
  (0.74 - 1.24)/2 = -0.25em, so the baseline sits 0.7095em below the line-box
  top and the x-height centre 0.4595em down — 62.1% of the 0.74em box. The
  rule's own 0.07em height is 9.5% of that box, so its top is 62.1% - 4.7%.
  (At the previous 0.86 line-height this figure was 56.3%; it moves with the
  leading, so it is recomputed rather than carried over.)
*/
.mirror-strike {
  position: absolute;
  left: 0;
  right: 0;
  top: 57.4%;
  height: 0.07em;
  background: #FF1E1E;
  transform: scaleX(0);
  transform-origin: left center;
  transition: transform ${STRIKE_TRANSITION_MS}ms cubic-bezier(0.16, 0.84, 0.24, 1);
  pointer-events: none;
}
.mirror-strike[data-struck="true"] { transform: scaleX(1); }

.mirror-caret {
  display: inline-block;
  width: 0.46ch;
  height: 0.72em;
  margin-left: 0.12em;
  vertical-align: -0.04em;
  background: #FF1E1E;
}
/* Solid while typing, hard two-state blink when idle. Never a soft sine fade. */
.mirror-caret[data-idle="true"] { animation: mirror-blink 1.05s steps(1, end) infinite; }
@keyframes mirror-blink { 0%, 50% { opacity: 1; } 50.01%, 100% { opacity: 0; } }

/*
  Hollow letterforms for one line of the claim. -webkit-text-fill-color (not
  \`color\`) is what empties the glyph, so \`currentColor\` still resolves to the
  container's transitioning colour — the outline dims with the rest of the
  claim when it is struck instead of staying stubbornly bright.

  Only above 768px: below that the type is small enough that a sub-pixel
  outline would thin out into illegibility against the graph.
*/
@media (min-width: 768px) {
  .mirror-hero-hollow {
    -webkit-text-fill-color: transparent;
    -webkit-text-stroke: 0.018em currentColor;
  }
}

/*
  Scroll choreography. --hero-scroll is written from JS (0 at rest, 1 once the
  hero is a viewport behind you) and consumed as a plain number here, so the
  transform work stays on the compositor and no React state updates per frame.
  The two rails move in opposite directions: the type leaves upward, the
  readout sinks, and the hero comes apart rather than sliding away.
*/
.mirror-hero-lift {
  transform: translate3d(0, calc(var(--hero-scroll, 0) * -4.5rem), 0);
  opacity: calc(1 - var(--hero-scroll, 0) * 0.85);
  will-change: transform, opacity;
}
.mirror-hero-sink {
  transform: translate3d(0, calc(var(--hero-scroll, 0) * 2.5rem), 0);
  opacity: calc(1 - var(--hero-scroll, 0) * 0.95);
  will-change: transform, opacity;
}

/*
  Readout rail: hairline columns, two-up on a phone and four-up from 640px.
  Done in CSS rather than per-cell utility classes because the divider has to
  disappear on the first cell of each row, and that rule differs per breakpoint.
*/
.mirror-hero-rail > * {
  border-left: 1px solid var(--line);
  padding-left: 1rem;
}
.mirror-hero-rail > *:nth-child(2n + 1) {
  border-left: none;
  padding-left: 0;
}
@media (min-width: 640px) {
  .mirror-hero-rail > *:nth-child(2n + 1) {
    border-left: 1px solid var(--line);
    padding-left: 1.25rem;
  }
  .mirror-hero-rail > *:first-child {
    border-left: none;
    padding-left: 0;
  }
}

/*
  The one number on this page worth making you look twice at, etched with a
  scanline rather than filled flat. currentColor keeps the stripes in the real
  BLOCKED status hue — this never borrows hazard red, which means brand, not
  verdict.
*/
.mirror-hero-etched {
  background-image: repeating-linear-gradient(
    to bottom,
    currentColor 0px,
    currentColor 3px,
    transparent 3px,
    transparent 6px
  );
  -webkit-background-clip: text;
  background-clip: text;
  -webkit-text-fill-color: transparent;
}

@media (prefers-reduced-motion: reduce) {
  .mirror-strike { transition: none; }
  .mirror-caret { display: none; }
  .mirror-hero-lift,
  .mirror-hero-sink { transform: none; opacity: 1; }
}
`;

function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

export function Hero({ counts, total }: HeroProps) {
  // Read once at mount. Everything below is then derived during render, so a
  // reduced-motion visitor never sees an empty frame before the full headline.
  const [reduced] = useState(prefersReducedMotion);
  const [typedClaim, setTypedClaim] = useState(0);
  const [typedVerdict, setTypedVerdict] = useState(0);
  const [hasStruck, setHasStruck] = useState(false);
  const [hasSettled, setHasSettled] = useState(false);
  const sectionRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (reduced) return;

    let timer: ReturnType<typeof setTimeout>;
    let claimed = 0;
    let verdicted = 0;

    const typeVerdict = () => {
      verdicted += 1;
      setTypedVerdict(verdicted);
      if (verdicted < VERDICT.length) {
        timer = setTimeout(typeVerdict, verdictDelay(verdicted));
        return;
      }
      setHasSettled(true);
    };

    const typeClaim = () => {
      claimed += 1;
      setTypedClaim(claimed);
      if (claimed < CLAIM.length) {
        timer = setTimeout(typeClaim, claimDelay(claimed));
        return;
      }
      timer = setTimeout(() => {
        setHasStruck(true);
        timer = setTimeout(typeVerdict, STRIKE_SWEEP_MS);
      }, HOLD_AFTER_CLAIM_MS);
    };

    timer = setTimeout(typeClaim, LEAD_IN_MS);
    return () => clearTimeout(timer);
  }, [reduced]);

  // Scroll progress through the hero, published as a CSS custom property so
  // the parallax never round-trips through React.
  useEffect(() => {
    if (reduced || typeof window === "undefined") return;
    let queued = 0;

    const apply = () => {
      queued = 0;
      const el = sectionRef.current;
      if (!el) return;
      const p = Math.min(Math.max(window.scrollY / Math.max(window.innerHeight, 1), 0), 1);
      el.style.setProperty("--hero-scroll", p.toFixed(4));
    };

    const onScroll = () => {
      if (!queued) queued = requestAnimationFrame(apply);
    };

    apply();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      if (queued) cancelAnimationFrame(queued);
      window.removeEventListener("scroll", onScroll);
    };
  }, [reduced]);

  const claimLen = reduced ? CLAIM.length : typedClaim;
  const verdictLen = reduced ? VERDICT.length : typedVerdict;
  const struck = reduced || hasStruck;
  const done = reduced || hasSettled;

  // Solid caret while characters are landing; it only blinks when Mirror pauses.
  const typing =
    (claimLen > 0 && claimLen < CLAIM.length) ||
    (verdictLen > 0 && verdictLen < VERDICT.length);

  const activeClaimLine = CLAIM_OFFSETS.reduce(
    (active, offset, i) => (claimLen >= offset ? i : active),
    0,
  );

  // Real aggregates only — the same three verdict counts the stat tiles and
  // the verdict table read from, and a share derived from them. `total` is the
  // real resource count, so an empty scan degrades to zeroes rather than to a
  // fabricated "—".
  const share = (n: number) => (total > 0 ? (n / total) * 100 : 0);
  const blockedShare = Math.round(share(counts.BLOCKED));
  const rail = [
    { label: "scanned", value: total, unit: "resources", tone: "text-ink" },
    { label: "blocked", value: counts.BLOCKED, unit: "hard refusals", tone: "text-blocked", etched: true },
    { label: "held", value: counts.NEEDS_REVIEW, unit: "need a human", tone: "text-review" },
    { label: "cleared", value: counts.SAFE, unit: "safe to delete", tone: "text-safe" },
  ];

  // Entrance beats, in seconds. Named so the cascade is readable as a
  // sequence instead of four magic numbers scattered through the JSX.
  const BEAT = { eyebrow: 0.08, rule: 0.22, rail: 0.95, meter: 1.15 };
  const rise = (delay: number) =>
    reduced
      ? {}
      : {
          initial: { opacity: 0, y: 14 },
          animate: { opacity: 1, y: 0 },
          transition: {
            duration: 0.7,
            delay,
            ease: [0.16, 1, 0.3, 1] as [number, number, number, number],
          },
        };

  // Top padding clears the nav at its tallest: on a phone the pills wrap to a
  // second row under the wordmark, ~120px of fixed chrome.
  return (
    <section
      id="hero"
      ref={sectionRef}
      className="relative z-10 flex min-h-screen scroll-mt-32 flex-col justify-center overflow-hidden px-6 pb-16 pt-32 sm:scroll-mt-24 md:px-12 md:pt-36"
    >
      <style>{HERO_CSS}</style>

      {/*
        Hero-local scrim. GraphBackground owns the page-wide legibility veil,
        but it can only darken what it knows about; this is the belt-and-braces
        floor under the display type itself, so the claim holds its contrast
        even if the graph is ever allowed further forward.
      */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 -z-10"
        style={{
          background:
            "radial-gradient(ellipse 85% 62% at 12% 48%, rgba(10,10,10,0.92) 0%, rgba(10,10,10,0.55) 55%, rgba(10,10,10,0) 78%)",
        }}
      />

      <Glow
        colorFrom="rgba(59,130,246,0.55)"
        colorTo="rgba(249,115,22,0.05)"
        className="left-[-10%] top-[8%] h-[520px] w-[520px] md:h-[680px] md:w-[680px]"
      />
      {/* The second light source only exists when the account really has a
          hard refusal in it — the hero is lit by its own findings. */}
      {counts.BLOCKED > 0 ? (
        <Glow
          colorFrom="rgba(220,38,38,0.32)"
          colorTo="rgba(10,10,10,0)"
          className="bottom-[6%] left-[26%] h-[380px] w-[380px] md:h-[520px] md:w-[520px]"
          delaySeconds={3.5}
        />
      ) : null}

      <div className="mirror-hero-lift relative">
        {/* Gallery label, then the machine reading. Serif italic is the one
            non-mono voice allowed on this page, and it appears exactly here. */}
        <motion.div
          {...rise(BEAT.eyebrow)}
          className="flex flex-wrap items-baseline gap-x-4 gap-y-1"
        >
          <span className="mirror-eyebrow text-sm text-gold md:text-base">
            live account scan
          </span>
          <span className="font-mono text-[10px] uppercase tracking-[0.32em] text-smoke/70">
            {total} {total === 1 ? "resource" : "resources"} evaluated
          </span>
        </motion.div>

        <motion.div
          {...rise(BEAT.rule)}
          className="mt-4 h-px w-full max-w-3xl origin-left bg-[var(--line)] md:mt-5"
        />

        {/*
          The real heading for assistive technology, stated once and in full.
          A character-by-character reveal is a visual performance, so the
          animated copy below is hidden from the accessibility tree instead of
          being re-announced on every keystroke.
        */}
        <h1 className="sr-only">this resource looks safe to delete. it isn't.</h1>

        <div
          aria-hidden="true"
          data-testid="hero-headline"
          className="mt-6 select-none md:mt-8"
        >
          {/*
            The claim: loud, white, confident — and wrong. It dims via `color`
            rather than `opacity` on purpose: the strike rules are children of
            this element, and fading the container would fade the correction
            along with the thing it is correcting.
          */}
          <div
            className="mirror-display-crush -ml-[0.05em]"
            style={{
              fontSize: CLAIM_SIZE,
              color: struck ? "rgba(245,245,245,0.28)" : "rgba(245,245,245,0.96)",
              transition: "color 600ms ease-out",
            }}
          >
            {CLAIM_LINES.map((line, i) => {
              const start = CLAIM_OFFSETS[i];
              const shown = line.slice(0, Math.min(line.length, Math.max(0, claimLen - start)));
              const spaceTyped = claimLen > start + line.length;
              return (
                <span key={line} className="block">
                  <span className="relative inline-block">
                    <span className={i === HOLLOW_LINE ? "mirror-hero-hollow" : undefined}>
                      {shown}
                    </span>
                    {/*
                      Staggered so the correction cascades down the claim rather
                      than stamping all three lines at once — it reads as Mirror
                      working through the statement line by line.
                    */}
                    <span
                      className="mirror-strike"
                      data-struck={struck}
                      style={{ transitionDelay: `${i * STRIKE_STAGGER_MS}ms` }}
                    />
                  </span>
                  {spaceTyped ? " " : ""}
                  {!struck && i === activeClaimLine ? (
                    <span className="mirror-caret" data-idle={!typing} />
                  ) : null}
                </span>
              );
            })}
          </div>

          {/*
            The correction crashes up into the claim rather than sitting politely
            below it — a negative top margin against a 0.74 line-height, so the
            verdict's ascenders overlap the struck line above. Deadpan beats
            shouting; collision beats both.
          */}
          <div
            className="mirror-display-crush -mt-[0.06em] text-hazard"
            style={{ fontSize: "clamp(2rem, 8.2vw, 7rem)" }}
          >
            <span>{VERDICT.slice(0, verdictLen)}</span>
            {struck ? <span className="mirror-caret" data-idle={!typing} /> : null}
          </div>
        </div>

        <p
          className="mt-8 max-w-xl font-mono text-xs leading-relaxed text-ink/60 transition-[opacity,transform] duration-700 ease-out md:text-sm"
          style={{
            opacity: done ? 1 : 0,
            transform: done ? "translateY(0)" : "translateY(0.5rem)",
          }}
        >
          Mirror previews the real consequences of a risky action against your actual AWS account
          before it&apos;s allowed to run — gated by real Cedar policy, not a hand-rolled if/else.
        </p>
      </div>

      {/*
        The readout rail. Same live counts the stat tiles and kill-switch banner
        use, given the page's floor rather than a floating card: hairline
        columns, mono numerals, serif labels. It sinks as the type lifts.
      */}
      <div className="mirror-hero-sink relative mt-12 max-w-3xl md:mt-16">
        <motion.div
          {...rise(BEAT.meter)}
          className="flex items-center justify-between font-mono text-[9px] uppercase tracking-[0.3em] text-smoke/60"
        >
          <span>verdict spectrum</span>
          <span>
            {blockedShare}% blocked
          </span>
        </motion.div>

        {/*
          A real proportion bar: three segments whose widths are the actual
          verdict counts over the actual resource count. Nothing is padded to a
          minimum width, so a zero count is genuinely invisible.
        */}
        <motion.div
          {...rise(BEAT.meter + 0.06)}
          className="mt-2 flex h-[3px] w-full overflow-hidden bg-white/5"
        >
          <div className="bg-blocked" style={{ width: `${share(counts.BLOCKED)}%` }} />
          <div className="bg-review" style={{ width: `${share(counts.NEEDS_REVIEW)}%` }} />
          <div className="bg-safe" style={{ width: `${share(counts.SAFE)}%` }} />
        </motion.div>

        <div className="mirror-hero-rail mt-6 grid grid-cols-2 gap-y-7 sm:grid-cols-4">
          {rail.map((cell, i) => (
            <motion.div key={cell.label} {...rise(BEAT.rail + i * 0.09)}>
              <div className="mirror-eyebrow text-[13px] text-smoke">{cell.label}</div>
              <div
                className={`mt-1 font-mono text-[2rem] font-bold leading-none tabular-nums md:text-[2.6rem] ${cell.tone} ${
                  cell.etched ? "mirror-hero-etched" : ""
                }`}
              >
                {cell.value}
              </div>
              <div className="mt-1.5 font-mono text-[9px] uppercase tracking-[0.24em] text-smoke/55">
                {cell.unit}
              </div>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
