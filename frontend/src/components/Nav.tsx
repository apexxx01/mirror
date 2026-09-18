// Shared focus/active treatment: a hazard-red ring on keyboard focus (never on
// mouse click, via :focus-visible) and a dimmed hazard tone while pressed —
// same color language as the hover state, not a generic browser ring.
const NAV_LINK_INTERACTION =
  "outline-none transition-colors duration-200 hover:text-hazard active:text-hazard/60 focus-visible:text-hazard focus-visible:ring-2 focus-visible:ring-hazard focus-visible:ring-offset-2 focus-visible:ring-offset-void";

export function Nav() {
  return (
    <nav className="fixed top-0 left-0 right-0 z-50 flex flex-col gap-3 px-6 py-4 backdrop-blur-md bg-void/60 border-b border-white/10 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
      <a
        href="#hero"
        className="font-display font-black text-xl tracking-tight text-white outline-none transition-colors duration-200 hover:text-hazard active:text-hazard/60 focus-visible:text-hazard focus-visible:ring-2 focus-visible:ring-hazard focus-visible:ring-offset-2 focus-visible:ring-offset-void"
      >
        MIRROR<span className="text-hazard">*</span>
      </a>
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 font-mono text-xs uppercase tracking-widest text-white/70">
        <a href="#verdicts" className={NAV_LINK_INTERACTION}>Verdicts</a>
        <a href="#full-story" className={NAV_LINK_INTERACTION}>Full Story</a>
        <a
          href="https://github.com/apexxx01/mirror"
          target="_blank"
          rel="noreferrer"
          className="border border-white/30 px-3 py-1.5 outline-none transition-colors duration-200 hover:border-hazard hover:text-hazard active:border-hazard/60 active:text-hazard/60 focus-visible:border-hazard focus-visible:text-hazard focus-visible:ring-2 focus-visible:ring-hazard focus-visible:ring-offset-2 focus-visible:ring-offset-void"
        >
          GitHub
        </a>
      </div>
    </nav>
  );
}
