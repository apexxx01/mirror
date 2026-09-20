import type { ReactNode } from "react";

/*
  The legend is the one place on this page where clarity outranks spectacle —
  but "clear" and "boring" are not the same constraint, and the previous pass
  confused them. A 2x2 grid of hairline cards is a spec sheet; this page is a
  ledger with a detonation in it.

  So the key is rebuilt at the ledger's own scale: the VerdictTable header
  treatment (crushed display type, second line hollow), and then four
  full-width entries carrying a display-scale outlined numeral in the gutter,
  the way KillSwitchBanner makes its count the message. Every real
  explanation, and every real badge vocabulary, is still here verbatim — it
  just reads as the page's opening statement instead of a footnote.
*/

const ICON_PROPS = {
  width: 34,
  height: 34,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.1,
  strokeLinecap: "round",
  strokeLinejoin: "round",
  "aria-hidden": true,
} as const;

/** Policy gate — a shield split by the decision line. */
function VerdictMark() {
  return (
    <svg {...ICON_PROPS}>
      <path d="M12 2.5 20 6v6c0 4.4-3.2 8.2-8 9.5-4.8-1.3-8-5.1-8-9.5V6l8-3.5Z" />
      <path d="M4 12h16" />
      <path d="M12 2.5v19" />
    </svg>
  );
}

/** Composite gauge — one needle over a graded arc. */
function ScoreMark() {
  return (
    <svg {...ICON_PROPS}>
      <path d="M3.5 17.5a9 9 0 1 1 17 0" />
      <path d="M12 17.5 16.5 10" />
      <circle cx="12" cy="17.5" r="1.4" />
      <path d="M3.5 17.5h3M17.5 17.5h3" />
    </svg>
  );
}

/** Recovery — an arrow that comes back. */
function ReversibilityMark() {
  return (
    <svg {...ICON_PROPS}>
      <path d="M3.5 5.5v5h5" />
      <path d="M3.9 10.5a8.5 8.5 0 1 1 1.6 6" />
      <path d="M12 8v4.4l2.8 1.8" />
    </svg>
  );
}

/** Hard stop — an open palm reduced to a bar and a bracket. */
function KillSwitchMark() {
  return (
    <svg {...ICON_PROPS}>
      <rect x="3.5" y="3.5" width="17" height="17" />
      <path d="M8 12h8" />
      <path d="M8 8.5h8M8 15.5h8" opacity="0.45" />
    </svg>
  );
}

interface Chip {
  text: string;
  /** Border + fill + text, in the same status colour the table uses. */
  className: string;
  /** The solid swatch that leads the chip, same colour again. */
  dot: string;
}

interface LegendItem {
  label: string;
  mark: ReactNode;
  chips: Chip[];
  body: string;
  /** Where this signal is actually rendered — real placement, not a claim. */
  where: string;
}

// Chip colors are deliberately identical to the ones VerdictRow uses for the
// same values, so reading the legend teaches the table's color language too.
const ITEMS: LegendItem[] = [
  {
    label: "Verdict",
    mark: <VerdictMark />,
    where: "every row · leading pill",
    chips: [
      { text: "BLOCKED", className: "border-blocked/40 bg-blocked/10 text-blocked", dot: "bg-blocked" },
      { text: "NEEDS_REVIEW", className: "border-review/40 bg-review/10 text-review", dot: "bg-review" },
      { text: "SAFE", className: "border-safe/40 bg-safe/10 text-safe", dot: "bg-safe" },
    ],
    body: "The real Cedar policy decision — BLOCKED (a real dependent exists, deletion refused), NEEDS_REVIEW (not enough signal to auto-approve), or SAFE.",
  },
  {
    label: "Mirror Score",
    mark: <ScoreMark />,
    where: "every row · badge + 0–100 meter",
    chips: [
      { text: "STOP", className: "border-blocked/40 bg-blocked/10 text-blocked", dot: "bg-blocked" },
      { text: "CAUTION", className: "border-review/40 bg-review/10 text-review", dot: "bg-review" },
      { text: "CLEAR", className: "border-safe/40 bg-safe/10 text-safe", dot: "bg-safe" },
    ],
    body: "STOP / CAUTION / CLEAR — one composite badge combining the verdict, real activity risk, and real recovery options. BLOCKED always forces STOP; nothing can buy that back.",
  },
  {
    label: "Reversibility",
    mark: <ReversibilityMark />,
    where: "every row · rev pill",
    chips: [
      { text: "HIGH", className: "border-safe/40 bg-safe/10 text-safe", dot: "bg-safe" },
      { text: "MEDIUM", className: "border-review/40 bg-review/10 text-review", dot: "bg-review" },
      { text: "LOW", className: "border-blocked/40 bg-blocked/10 text-blocked", dot: "bg-blocked" },
    ],
    body: "HIGH / MEDIUM / LOW — whether a real AWS recovery mechanism (versioning, point-in-time recovery, a published Lambda version) is actually configured right now.",
  },
  {
    label: "Kill Switch",
    mark: <KillSwitchMark />,
    where: "the red banner below",
    chips: [
      {
        text: "HELD FOR A HUMAN",
        className: "border-review/40 bg-review/10 text-review",
        dot: "bg-review",
      },
    ],
    body: "When Mirror isn't confident enough to call something safe, it refuses to auto-approve rather than guess. That refusal is the banner below, not a hidden default.",
  },
];

/*
  Two pieces of craft that Tailwind can't express, kept local to this section.

  1. The gutter numeral is hollow display type that FILLS to hazard as you
     reach for its entry — the same stroke-to-solid move the ledger header
     makes across two lines, here made interactive.
  2. A hazard rule wipes down the entry's left edge on hover, so the row
     announces itself with direction rather than a background tint.

  Both are colour/transform only, and both are switched off under
  prefers-reduced-motion.
*/
const LEGEND_CSS = `
.mirror-legend-entry::before {
  content: "";
  position: absolute;
  left: 0;
  top: -1px;
  bottom: -1px;
  width: 2px;
  background: var(--hazard);
  transform: scaleY(0);
  transform-origin: top center;
  transition: transform 380ms cubic-bezier(0.16, 1, 0.3, 1);
  pointer-events: none;
}
.mirror-legend-entry:hover::before { transform: scaleY(1); }

.mirror-legend-num {
  color: transparent;
  -webkit-text-stroke: 1.5px rgba(242, 242, 238, 0.45);
  transition: -webkit-text-stroke-color 300ms ease, color 300ms ease;
}
.mirror-legend-entry:hover .mirror-legend-num {
  color: rgba(255, 30, 30, 0.14);
  -webkit-text-stroke-color: var(--hazard);
}

.mirror-legend-mark { transition: color 300ms ease; }
.mirror-legend-entry:hover .mirror-legend-mark { color: var(--hazard); }

@media (prefers-reduced-motion: reduce) {
  .mirror-legend-entry::before { transition: none; }
  .mirror-legend-num,
  .mirror-legend-mark { transition: none; }
}
`;

/**
 * A first-time visitor — including a judge watching a 3-minute video —
 * shouldn't have to reverse-engineer what a pill means. This is the one
 * static, always-visible explainer for the four real signals every row
 * below carries. Expanding a row goes further: real dependents, the real
 * mechanical future diff, the real rollback plan, and the raw Cedar
 * decision/reasons — this legend is the map, not the whole territory.
 */
export function FeatureLegend() {
  return (
    <section
      id="legend"
      aria-labelledby="legend-title"
      className="relative z-10 mx-auto mt-20 max-w-6xl px-6 sm:mt-28"
    >
      <style>{LEGEND_CSS}</style>

      {/* Ledger plate — same treatment as "every verdict, every signal": index
          rule, gallery label, census, then crushed display type with the
          second line hollow. */}
      <header>
        <div className="mirror-hairline flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2 pt-4">
          <div className="flex items-baseline gap-3">
            <span className="font-mono text-[10px] tracking-[0.35em] text-smoke">01</span>
            <span className="mirror-eyebrow text-sm text-gold sm:text-base">the legend</span>
          </div>
          <div className="font-mono text-[10px] uppercase tracking-[0.25em] text-smoke">
            4 signals · on every row below
          </div>
        </div>

        <h2
          id="legend-title"
          className="mirror-display-crush mt-3 text-[clamp(30px,8.6vw,64px)] uppercase text-ink"
        >
          How to read
          <br />
          <span className="mirror-stroke-text">this page</span>
        </h2>

        <p className="mt-6 max-w-xl font-mono text-xs leading-relaxed text-smoke">
          Four signals sit on every row below. None of them is a guess — each one is a value the
          scan actually produced against this AWS account.
        </p>
      </header>

      {/* The key itself: four entries on hard rules, numeral in the gutter. */}
      <ol className="mt-10 border-t border-white/15 sm:mt-14">
        {ITEMS.map((item, i) => (
          <li
            key={item.label}
            className="mirror-legend-entry relative border-b border-white/15 py-8 pl-4 sm:py-11 sm:pl-8"
          >
            <div className="grid gap-y-6 sm:grid-cols-[7rem_1fr] sm:gap-x-10 lg:grid-cols-[9rem_1fr]">
              {/* Gutter: hollow ordinal over the signal's mark. */}
              <div className="flex items-center gap-5 sm:flex-col sm:items-start sm:gap-6">
                <span
                  aria-hidden="true"
                  className="mirror-display-crush mirror-legend-num select-none text-[clamp(2.5rem,8vw,4.5rem)] leading-[0.78]"
                >
                  {String(i + 1).padStart(2, "0")}
                </span>
                <span className="mirror-legend-mark shrink-0 text-gold">{item.mark}</span>
              </div>

              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                  <h3 className="font-mono text-base font-bold uppercase tracking-[0.22em] text-ink sm:text-lg">
                    {item.label}
                  </h3>
                  <span aria-hidden="true" className="hidden h-px flex-1 bg-white/10 sm:block" />
                  <span className="font-mono text-[9px] uppercase tracking-[0.26em] text-smoke/70">
                    {item.where}
                  </span>
                </div>

                {/* The vocabulary, in the exact colours the table uses. */}
                <div className="mt-5 flex flex-wrap gap-2">
                  {item.chips.map((chip) => (
                    <span
                      key={chip.text}
                      className={`inline-flex items-center gap-2 border px-2.5 py-1.5 font-mono text-[10px] font-bold uppercase tracking-[0.16em] ${chip.className}`}
                    >
                      <span aria-hidden="true" className={`h-1.5 w-1.5 shrink-0 ${chip.dot}`} />
                      {chip.text}
                    </span>
                  ))}
                </div>

                <p className="mt-5 max-w-2xl font-mono text-xs leading-relaxed text-smoke sm:text-[13px]">
                  {item.body}
                </p>
              </div>
            </div>
          </li>
        ))}
      </ol>

      {/* The one instruction that turns the table from a report into an
          interactive proof — given a hazard chip on black, the inversion of
          the kill-switch banner's black chip on hazard. */}
      <div className="mt-8 flex flex-col gap-4 border border-white/15 bg-carbon px-5 py-5 sm:flex-row sm:items-center sm:gap-6 sm:px-7">
        <span className="shrink-0 self-start bg-hazard px-2.5 py-1.5 font-mono text-[10px] font-bold uppercase tracking-[0.3em] text-void sm:self-auto">
          next
        </span>
        <p className="font-mono text-[11px] leading-relaxed text-smoke sm:text-xs">
          Click any row below to open real dependents, the real before/after diff, the real rollback
          plan, and the raw Cedar policy output — the actual proof a policy engine made this call,
          not a hand-rolled if/else.
        </p>
      </div>
    </section>
  );
}
