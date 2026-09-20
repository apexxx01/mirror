interface BedrockBannerProps {
  summary: string;
}

/**
 * The one piece of prose on the page Mirror didn't write itself — a real
 * Bedrock-generated read of this exact scan. It gets a gallery-label
 * treatment rather than an alert treatment: a serif caption rail on the
 * left, the model's sentence given room on the right, and a hazard hairline
 * down the edge so it still reads as Mirror's voice and not a chat bubble.
 */
export function BedrockBanner({ summary }: BedrockBannerProps) {
  return (
    <section
      id="full-story"
      aria-labelledby="full-story-title"
      className="relative z-10 mx-auto mt-20 max-w-6xl scroll-mt-32 px-6 sm:mt-28 sm:scroll-mt-24"
    >
      <header className="border-t border-white/15 pt-5">
        <div className="flex items-center gap-3">
          <span className="font-mono text-[10px] tracking-[0.35em] text-smoke">03</span>
          <span className="mirror-eyebrow text-base text-gold">the synthesis</span>
        </div>
        <h2
          id="full-story-title"
          className="mt-3 font-mono text-2xl font-bold uppercase leading-[1.05] tracking-crush text-ink sm:text-[2.5rem]"
        >
          The full story
        </h2>
      </header>

      <div
        className="mirror-panel relative mt-8 overflow-hidden"
        style={{ borderLeft: "2px solid var(--hazard)" }}
      >
        {/* A slow light sweep — the panel reads as actively generated rather
            than statically printed. Disabled under prefers-reduced-motion. */}
        <div className="mirror-scanline" aria-hidden="true" />

        <div className="relative grid grid-cols-1 md:grid-cols-[14rem_1fr]">
          {/* Gallery label rail: what this is, who wrote it, what binds it. */}
          <div className="border-b border-white/10 px-6 py-6 md:border-b-0 md:border-r md:py-8">
            <div className="mirror-eyebrow text-lg leading-tight text-gold">
              Generated
              <br />
              summary
            </div>
            <dl className="mt-5 space-y-3 font-mono text-[10px] uppercase tracking-[0.2em]">
              <div>
                <dt className="text-white/30">engine</dt>
                <dd className="mt-1 text-ink">Amazon Bedrock</dd>
              </div>
              <div>
                <dt className="text-white/30">source</dt>
                <dd className="mt-1 text-ink">this scan only</dd>
              </div>
              <div>
                <dt className="text-white/30">status</dt>
                <dd className="mt-1 flex items-center gap-2 text-hazard">
                  <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-hazard" />
                  published
                </dd>
              </div>
            </dl>
          </div>

          {/* The model's own sentence, given the room a pull quote gets. */}
          <blockquote className="relative px-6 py-7 sm:px-9 sm:py-10">
            <span
              aria-hidden="true"
              className="mirror-eyebrow pointer-events-none absolute left-2 top-1 select-none text-6xl leading-none text-hazard/20 sm:left-4"
            >
              &ldquo;
            </span>
            <p className="relative font-mono text-sm leading-[1.75] text-ink/85 sm:text-[15px]">
              {summary}
            </p>
            <footer className="mt-6 border-t border-white/10 pt-4 font-mono text-[10px] uppercase tracking-[0.25em] text-white/30">
              written by a model, bound to the real numbers above
            </footer>
          </blockquote>
        </div>
      </div>
    </section>
  );
}
