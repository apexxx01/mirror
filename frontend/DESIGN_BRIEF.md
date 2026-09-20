# Mirror v2 — Design Brief (read this first, fully, before touching any component)

Mirror is an AWS dependency-graph guardrail. Its whole thesis: "this resource
looks safe to delete. it isn't." Every number on this page is REAL — computed
from a live AWS scan (Cedar policy decisions, real Lambda invocation counts,
real CloudWatch errors, real dependency graph edges). **Never invent a stat,
a label, or a number that isn't already flowing through the existing data
pipeline** (`src/types.ts` → `src/hooks/useMirrorData.ts` → components).

This is a hackathon submission being judged in hours, explicitly for a
"Best UI" prize category ("the best-designed thing at the event... a
pleasure to use"). The founder's own words, verbatim, on the current state:
"still too vague and non-drastic... every look at the screen must be
visually treating and ethereal... sensory overload... blissfully amazed...
ban out all the basic AI slop... unmistakably 'Mirror'... memorable
exclusively for the UI." Timid is a failure mode here. Boring is a failure
mode. A component that looks like a template is a failure mode.

## Foundation already in place (do not redefine — build on top of it)

`src/index.css` and `tailwind.config.js` already carry the full v2 design
system. Read both files now. Key pieces:

- **Colors**: `void` (#0A0A0A, page canvas), `carbon` (#050505, panel fill),
  `ink` (#f2f2ee, primary text), `smoke` (#9c9c9c, muted text), `hazard`
  (#FF1E1E, THE single chromatic detonation — sparing, dramatic use only),
  `gold` (#C9A876, rare icon/accent tint), plus the FIXED status colors that
  must never be reused for anything else: `blocked` (#DC2626), `review`
  (#EAB308), `safe` (#16A34A). Status colors mean "this resource's verdict."
  Hazard red means "Mirror brand energy." Never blur that line — a judge
  should never mistake page chrome for a danger signal.
- **Type**: `font-display` (Unbounded 900) for brutal-scale headlines only
  (96px+, use `.mirror-display` or `.mirror-display-crush` for the
  crushed-line-height treatment). `font-mono` (Space Mono) is the UNIVERSAL
  UI voice — every label, nav item, button, data value, caption. `font-serif`
  (Fraunces italic) is a rare gallery-label accent for eyebrows/pull-quotes
  only — never body copy.
- **Utility classes already defined**: `.mirror-panel` (hairline-bordered
  flat surface, the new default — NOT glass), `.mirror-panel-hover`,
  `.mirror-glass` (reserved for floating chrome: nav, chat FAB only),
  `.mirror-detonation` (full-bleed hazard-red block), `.mirror-glow`,
  `.mirror-display` / `.mirror-display-crush`, `.mirror-eyebrow`,
  `.mirror-glitch-text`, `.mirror-stroke-text` (hollow outlined type),
  `.mirror-diagonal-in` / `.mirror-diagonal-out` (clip-path seams),
  `.mirror-hairline`, `.mirror-marquee-track` (infinite scroll strip,
  pauses on hover, respects reduced-motion), `.mirror-scanline` (drifting
  light sweep overlay for panels).
- **Structure rule**: 0px border-radius everywhere except pills (nav chips,
  buttons = fully rounded, nothing in between). Elevation comes from 1px
  borders and background-color steps, never box-shadow.
- **Motion**: `motion/react` (Framer Motion, already a dependency) for all
  entrance/scroll animations. `@react-three/fiber` + `three` for 3D.
- Respect `prefers-reduced-motion` on every animation you add (existing
  components already do this — follow the pattern).

## Data contract — do not change without checking `src/types.ts`

`MirrorResult` has: `resource`, `verdict` (BLOCKED/NEEDS_REVIEW/SAFE),
`dependents[]`, `risk_score`, `node_type`, `node_name`, `reversibility`
(level + reason), `mirror_score` (score + badge), `future_diff` (self +
downstream[]), `rollback_plan` (available + steps + reason),
`cedar_decision`, `cedar_reasons[]`, `blast_radius[]` (resource, hop,
invocations_90d), `adversarial[]` (resource, hop, errors, throttles),
`decision_matrix[]` (scenario, dependents_count, risk_score, verdict). That
is the full set of "7 features." `MirrorPayload` wraps `results[]` +
`bedrock_summary` + `generated_at`.

## Non-negotiable constraints

1. **Every existing test file must still pass** (`npm test`). Tests query by
   `data-testid`, role, or visible text — keep those stable identifiers even
   as you redesign the visuals around them. If a test's selector no longer
   makes sense for the new layout, update the test to match the new
   structure, but never delete a test's assertion just to make it pass.
2. **`npm run build` must succeed** (`tsc -b && vite build`) — no type
   errors.
3. **No new npm dependencies** without a real reason — `motion`,
   `@react-three/fiber`, `three`, and Tailwind cover everything this brief
   asks for. Adding a heavy new library this close to a deadline risks a
   broken build.
4. **No fabricated data.** If you want a "live" feeling number, compute it
   from `results` the way `AccountSignals.tsx` already does (real
   aggregation, not a hardcoded constant).
5. Keep `prefers-reduced-motion` handling on any new animation.
6. Mobile: the page must not horizontally scroll at 400px width. Test this.

## Report contract

When done, report back: files changed, a one-line description of what each
now does visually, confirmation `npm test` and `npm run build` both pass,
and any concern worth flagging (a test you had to adjust, a tradeoff you
made under time pressure).
