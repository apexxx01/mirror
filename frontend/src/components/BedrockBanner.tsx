interface BedrockBannerProps {
  summary: string;
}

export function BedrockBanner({ summary }: BedrockBannerProps) {
  return (
    <div
      id="full-story"
      className="mx-auto max-w-4xl px-6 mt-24 relative z-10 scroll-mt-32 sm:scroll-mt-24"
    >
      <div
        className="mirror-glass px-5 py-4 font-mono text-sm text-white/80"
        style={{ borderColor: "rgba(255,30,30,0.3)" }}
      >
        <div className="mb-1 text-[10px] uppercase tracking-widest text-hazard">Bedrock summary</div>
        {summary}
      </div>
    </div>
  );
}
