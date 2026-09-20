import { useEffect, useRef, useState } from "react";

/**
 * Nav — the page's instrument chrome.
 *
 * Voice is monospace-as-UI (the Midjourney reference's "every label carries
 * the weight of a terminal command") wrapped in Hyperstudio's hairline
 * structure and Charlie's figure-ground pill flip: the inactive pill is a
 * 1px outline, the active/hovered pill inverts to a solid ink fill with void
 * text. No third state, no color — the inversion IS the affordance.
 *
 * Two things here are real rather than decorative:
 *  - the section index tracks the section actually under the viewport's
 *    reading line, so the nav is a position readout, not a static menu;
 *  - the hairline at the nav's bottom edge is the real document scroll
 *    progress, so the one hazard-red element on the bar always means
 *    "this is where you are", never "this is a button".
 */

interface NavProps {
  // "Full Story" only has somewhere real to go when the Bedrock summary
  // callout is actually mounted — App.tsx passes this based on whether
  // data.bedrock_summary is present. Without this, the link would silently
  // do nothing whenever no summary is published (the default path without
  // --bedrock-report, and confirmed live: also the path when the Bedrock
  // call itself fails).
  hasFullStory: boolean;
}

interface NavItem {
  /** DOM id of the section this points at; null for an off-site link. */
  target: string | null;
  href: string;
  label: string;
  external?: boolean;
}

const NAV_CSS = `
/*
  The bar is the one piece of chrome allowed to float, so it is the one place
  glass survives — but flattened: a blur over near-opaque void with a single
  hairline, never a rounded translucent card sitting on the page.
*/
.mirror-nav {
  background: rgba(10, 10, 10, 0.72);
  backdrop-filter: blur(22px) saturate(140%);
  -webkit-backdrop-filter: blur(22px) saturate(140%);
  border-bottom: 1px solid var(--line);
}

/* Scroll progress. Width is written from JS each frame; the element is the
   nav's bottom border rather than a separate bar, so it never reads as a
   loading spinner. */
.mirror-nav-progress {
  position: absolute;
  left: 0;
  bottom: -1px;
  height: 1px;
  width: 0%;
  background: var(--hazard);
  box-shadow: 0 0 8px rgba(255, 30, 30, 0.7);
}

/*
  Hairline pill -> solid inversion. The fill is painted by a pseudo-element
  that wipes in from the left, so the flip has direction: it reads as the
  bar selecting the item, not as a hover color swap.
*/
.mirror-nav-pill {
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  isolation: isolate;
  border: 1px solid var(--line);
  border-radius: 9999px;
  padding: 0.3rem 0.8rem;
  color: rgba(242, 242, 238, 0.66);
  transition: color 180ms ease, border-color 180ms ease;
  outline: none;
}
.mirror-nav-pill::before {
  content: "";
  position: absolute;
  inset: 0;
  z-index: -1;
  border-radius: 9999px;
  background: var(--ink);
  transform: scaleX(0);
  transform-origin: left center;
  transition: transform 260ms cubic-bezier(0.16, 0.84, 0.24, 1);
}
.mirror-nav-pill:hover,
.mirror-nav-pill:focus-visible {
  color: var(--ink);
  border-color: var(--line-strong);
}
.mirror-nav-pill[data-active="true"] {
  color: var(--void);
  border-color: var(--ink);
}
.mirror-nav-pill[data-active="true"]::before { transform: scaleX(1); }
.mirror-nav-pill:focus-visible {
  box-shadow: 0 0 0 1px var(--void), 0 0 0 3px var(--hazard);
}
.mirror-nav-pill[data-active="true"]:hover { color: var(--void); }

/* The index prefix is the terminal tell: a fixed-width ordinal that stays
   quiet until its item is the current one. */
.mirror-nav-idx {
  font-variant-numeric: tabular-nums;
  opacity: 0.45;
}
.mirror-nav-pill[data-active="true"] .mirror-nav-idx { opacity: 0.7; }

/* A live-scan tell, not a notification dot: a hard two-state blink on a
   square, matching the hero caret's cadence. */
.mirror-nav-live {
  width: 6px;
  height: 6px;
  background: var(--hazard);
  animation: mirror-nav-blink 1.9s steps(1, end) infinite;
}
@keyframes mirror-nav-blink {
  0%, 62% { opacity: 1; }
  62.01%, 100% { opacity: 0.15; }
}

@media (prefers-reduced-motion: reduce) {
  .mirror-nav-live { animation: none; }
  .mirror-nav-pill,
  .mirror-nav-pill::before { transition: none; }
}
`;

function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

export function Nav({ hasFullStory }: NavProps) {
  const items: NavItem[] = [
    { target: "hero", href: "#hero", label: "Thesis" },
    { target: "verdicts", href: "#verdicts", label: "Verdicts" },
    ...(hasFullStory
      ? [{ target: "full-story", href: "#full-story", label: "Full Story" }]
      : []),
    {
      target: null,
      href: "https://github.com/apexxx01/mirror",
      label: "GitHub",
      external: true,
    },
  ];

  const progressRef = useRef<HTMLDivElement>(null);
  const [activeTarget, setActiveTarget] = useState<string | null>("hero");
  // The progress hairline is written straight to the DOM and the active
  // section is only pushed into state when it actually changes, so scrolling
  // the page does not re-render the nav sixty times a second.
  const activeRef = useRef<string | null>("hero");

  // Scroll spy without IntersectionObserver: one rAF-throttled read of the
  // real section offsets against a reading line a third of the way down the
  // viewport. IO would need a separate observer per section and a threshold
  // that lies about which section you are actually reading on a tall page.
  const targets = items.map((i) => i.target).filter((t): t is string => t !== null);
  const targetKey = targets.join(",");

  useEffect(() => {
    if (typeof window === "undefined") return;
    const ids = targetKey ? targetKey.split(",") : [];
    let queued = 0;

    const measure = () => {
      queued = 0;
      const doc = document.documentElement;
      const scrollable = Math.max(doc.scrollHeight - window.innerHeight, 1);
      const progress = Math.min(Math.max(window.scrollY / scrollable, 0), 1);
      if (progressRef.current) {
        progressRef.current.style.width = `${(progress * 100).toFixed(2)}%`;
      }

      const line = window.scrollY + window.innerHeight * 0.34;
      let current: string | null = ids[0] ?? null;
      for (const id of ids) {
        const el = document.getElementById(id);
        if (!el) continue;
        if (el.offsetTop <= line) current = id;
      }
      if (current !== activeRef.current) {
        activeRef.current = current;
        setActiveTarget(current);
      }
    };

    const onScroll = () => {
      if (!queued) queued = requestAnimationFrame(measure);
    };

    measure();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll, { passive: true });
    return () => {
      if (queued) cancelAnimationFrame(queued);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, [targetKey]);

  const [reduced] = useState(prefersReducedMotion);

  return (
    <nav className="mirror-nav fixed left-0 right-0 top-0 z-50">
      <style>{NAV_CSS}</style>

      <div className="flex flex-col gap-3 px-5 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-6 md:px-10">
        {/* Wordmark block: display face for the name, mono for the machine
            reading beneath it. The asterisk is the only hazard on the left. */}
        <a
          href="#hero"
          className="group flex items-baseline gap-2.5 outline-none focus-visible:ring-2 focus-visible:ring-hazard focus-visible:ring-offset-2 focus-visible:ring-offset-void"
        >
          <span className="mirror-display text-lg text-ink transition-colors duration-200 group-hover:text-hazard sm:text-xl">
            MIRROR<span className="text-hazard">*</span>
          </span>
          <span className="hidden font-mono text-[9px] uppercase tracking-[0.34em] text-smoke/70 md:inline">
            dependency guardrail
          </span>
        </a>

        <div className="flex flex-wrap items-center gap-2 font-mono text-[10px] uppercase tracking-[0.2em] sm:gap-2.5 sm:text-[11px]">
          {/* Live tell, left of the pills: Mirror is reading a real scan. */}
          <span className="mr-1 hidden items-center gap-2 text-[9px] tracking-[0.3em] text-smoke/70 lg:flex">
            {reduced ? (
              <span className="h-1.5 w-1.5 bg-hazard" />
            ) : (
              <span className="mirror-nav-live" />
            )}
            scan live
          </span>

          {items.map((item, i) => {
            const active = item.target !== null && item.target === activeTarget;
            return (
              <a
                key={item.label}
                href={item.href}
                className="mirror-nav-pill"
                data-active={active}
                {...(item.external ? { target: "_blank", rel: "noreferrer" } : {})}
              >
                <span className="mirror-nav-idx">
                  {String(i + 1).padStart(2, "0")}
                </span>
                <span>{item.label}</span>
                {item.external ? <span aria-hidden="true">&#8599;</span> : null}
              </a>
            );
          })}
        </div>
      </div>

      <div ref={progressRef} className="mirror-nav-progress" aria-hidden="true" />
    </nav>
  );
}
