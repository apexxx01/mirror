export function Nav() {
  return (
    <nav className="fixed top-0 left-0 right-0 z-50 flex items-center justify-between px-6 py-4 backdrop-blur-md bg-void/60 border-b border-white/10">
      <a href="#hero" className="font-display font-black text-xl tracking-tight text-white">
        MIRROR<span className="text-hazard">*</span>
      </a>
      <div className="flex items-center gap-6 font-mono text-xs uppercase tracking-widest text-white/70">
        <a href="#verdicts" className="hover:text-hazard transition-colors duration-200">Verdicts</a>
        <a href="#blast-radius" className="hover:text-hazard transition-colors duration-200">Blast Radius</a>
        <a href="#full-story" className="hover:text-hazard transition-colors duration-200">Full Story</a>
        <a
          href="https://github.com/apexxx01/mirror"
          target="_blank"
          rel="noreferrer"
          className="border border-white/30 px-3 py-1.5 hover:border-hazard hover:text-hazard transition-colors duration-200"
        >
          GitHub
        </a>
      </div>
    </nav>
  );
}
