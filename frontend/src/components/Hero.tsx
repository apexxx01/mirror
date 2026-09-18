import { useEffect, useState } from "react";

/**
 * The headline is Mirror's thesis, and the reveal performs it rather than
 * merely displaying it: the page states the comfortable lie at full volume,
 * holds long enough for you to believe it, then strikes it out and delivers
 * the verdict in hazard red. One orchestrated sequence, no scattered effects.
 */
const CLAIM_LINES = ["this resource", "looks safe", "to delete."] as const;
const CLAIM = CLAIM_LINES.join(" "); // "this resource looks safe to delete."
const VERDICT = "it isn't.";

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
  Measured against Unbounded 700: x-height 0.571em, ascent 0.995em, descent
  0.245em; with line-height 0.86 the baseline lands 0.805em below the line-box
  top, so the x-height centre is 0.519em down — 60.4% of the 0.86em box. Rule
  top = 60.4% minus half the rule's own height.
*/
.mirror-strike {
  position: absolute;
  left: 0;
  right: 0;
  top: 56.3%;
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

@media (prefers-reduced-motion: reduce) {
  .mirror-strike { transition: none; }
  .mirror-caret { display: none; }
}
`;

function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

export function Hero() {
  // Read once at mount. Everything below is then derived during render, so a
  // reduced-motion visitor never sees an empty frame before the full headline.
  const [reduced] = useState(prefersReducedMotion);
  const [typedClaim, setTypedClaim] = useState(0);
  const [typedVerdict, setTypedVerdict] = useState(0);
  const [hasStruck, setHasStruck] = useState(false);
  const [hasSettled, setHasSettled] = useState(false);

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

  return (
    <section
      id="hero"
      className="relative z-10 flex min-h-screen scroll-mt-32 flex-col justify-center px-6 pb-20 pt-24 sm:scroll-mt-24 md:px-12 md:pt-32"
    >
      <style>{HERO_CSS}</style>

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
        className="font-display select-none"
      >
        {/*
          The claim: loud, white, confident — and wrong. It dims via `color`
          rather than `opacity` on purpose: the strike rules are children of
          this element, and fading the container would fade the correction
          along with the thing it is correcting.
        */}
        <div
          className="font-bold transition-colors duration-[600ms] ease-out"
          style={{
            // The longest line, "this resource", measures 7.87em wide in
            // Unbounded 700. The vw term and the floor are both set so that
            // 7.87em still clears the 48px gutters at 320px, the narrowest
            // width worth supporting — the claim must never wrap by accident.
            fontSize: "clamp(2rem, 10.3vw, 8.75rem)",
            lineHeight: 0.86,
            letterSpacing: "-0.035em",
            color: struck ? "rgba(245,245,245,0.3)" : "rgba(245,245,245,0.95)",
          }}
        >
          {CLAIM_LINES.map((line, i) => {
            const start = CLAIM_OFFSETS[i];
            const shown = line.slice(0, Math.min(line.length, Math.max(0, claimLen - start)));
            const spaceTyped = claimLen > start + line.length;
            return (
              <span key={line} className="block">
                <span className="relative inline-block">
                  {shown}
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

        {/* The correction: smaller, denser, hazard red. Deadpan beats shouting. */}
        <div
          className="mt-[0.18em] font-black text-hazard"
          style={{
            fontSize: "clamp(1.9rem, 7.2vw, 4.9rem)",
            lineHeight: 0.95,
            letterSpacing: "-0.05em",
          }}
        >
          <span>{VERDICT.slice(0, verdictLen)}</span>
          {struck ? <span className="mirror-caret" data-idle={!typing} /> : null}
        </div>
      </div>

      <p
        className="mt-10 max-w-xl font-mono text-xs leading-relaxed text-white/55 transition-[opacity,transform] duration-700 ease-out md:text-sm"
        style={{
          opacity: done ? 1 : 0,
          transform: done ? "translateY(0)" : "translateY(0.5rem)",
        }}
      >
        Mirror previews the real consequences of a risky action against your actual AWS account
        before it's allowed to run — gated by real Cedar policy, not a hand-rolled if/else.
      </p>
    </section>
  );
}
