interface BedrockBannerProps {
  summary: string;
}

export function BedrockBanner({ summary }: BedrockBannerProps) {
  return (
    <div className="mx-auto max-w-4xl px-6 mt-24 relative z-10">
      <div className="border border-hazard/40 bg-hazard/5 px-5 py-4 font-mono text-sm text-white/80">
        <div className="mb-1 text-[10px] uppercase tracking-widest text-hazard">Bedrock summary</div>
        {summary}
      </div>
    </div>
  );
}
