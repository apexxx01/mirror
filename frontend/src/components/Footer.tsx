export function Footer() {
  return (
    <footer className="relative z-10 mx-auto max-w-4xl px-6 py-16 text-center">
      <p className="font-mono text-[11px] uppercase tracking-widest text-white/30">
        every value on this page is a real scan of this AWS account, published by the last{" "}
        <code className="text-white/40">mirror.py</code> run — nothing here is simulated.
      </p>
    </footer>
  );
}
