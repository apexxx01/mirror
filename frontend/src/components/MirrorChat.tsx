import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import type { MirrorPayload } from "../types";
import { askMirror } from "../lib/gemini";

interface MirrorChatProps {
  payload: MirrorPayload;
}

interface Message {
  role: "user" | "assistant" | "error";
  text: string;
}

/**
 * Strips markdown bold/italic markers rather than rendering them as HTML —
 * this text comes from a model response, and turning ** into real <strong>
 * would mean injecting model output as HTML. Plain-text readability without
 * that risk.
 */
function stripMarkdown(text: string): string {
  return text.replace(/\*\*(.*?)\*\*/g, "$1").replace(/\*/g, "");
}

const SUGGESTIONS = [
  "Which resources are safest to delete right now, and why?",
  "What's the single biggest risk in this account?",
  "Give me a prioritized fix list for the BLOCKED resources.",
];

/**
 * The inline callout (`ChatInvite`) lives in the page flow, the chat panel
 * lives in fixed chrome, and they are deliberately not parent/child — the
 * panel must stay mounted at the document root so its scrim can cover the
 * whole viewport. One window event is the entire coupling: the callout asks
 * for the panel, optionally carrying a real question to fire immediately.
 */
const ASK_EVENT = "mirror:ask";

export function openMirrorChat(question?: string): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<string | undefined>(ASK_EVENT, { detail: question }));
}

function isConfigured(): boolean {
  return Boolean(import.meta.env.VITE_GEMINI_API_KEY);
}

// The chat panel is floating chrome, and floating chrome is the one place
// `.mirror-glass` survives — but the system bans soft corners everywhere
// except pills, so the panel's own 16px radius is squared off here and the
// trigger is pushed all the way to a pill.
const SQUARE = { borderRadius: 0 } as const;
const PILL = { borderRadius: 9999 } as const;

/*
  Why there is a scrim at all — this is the fix for a real, reported bug.

  The panel is `.mirror-glass`: a 5%-white fill over a 20px backdrop blur.
  Over the page's own hairline-on-obsidian surfaces that reads beautifully.
  Over the hero it did not: the headline is ~124px of Unbounded 900 in near
  -white, and a 20px blur of that is not "frosted", it is three bright smears
  crawling under the chat copy. At 1024px the open panel also genuinely
  overlapped the hero's readout rail (the rail runs to max-w-3xl = 768px from
  a 48px gutter; the 380px panel starts at ~620px), and at 1280px+ it sat
  straight on top of "the risk core" placard, which is pinned bottom-24
  right-12. Same collision, three different widths.

  So the panel now behaves like what it actually is — a modal surface. The
  scrim mutes the entire page to a flat near-black before the glass is drawn
  over it, which means there is no page content left behind the panel to
  collide with at ANY scroll position or viewport width, and the glass
  material the founder liked is untouched. Click-through-to-close and Escape
  keep it from feeling like a trap.
*/
const CHAT_CSS = `
.mirror-chat-scrim {
  background: rgba(6, 6, 6, 0.88);
  backdrop-filter: blur(6px) saturate(70%);
  -webkit-backdrop-filter: blur(6px) saturate(70%);
}

/*
  The same glass, held to a legible floor. .mirror-glass on its own is a 5%
  white fill, which over a muted page is nearly invisible; this keeps the
  blur, the translucency and the hairline, and adds just enough dark body for
  12px mono to hold contrast on it.
*/
.mirror-chat-shell {
  background:
    linear-gradient(
      180deg,
      rgba(255, 255, 255, 0.075) 0%,
      rgba(255, 255, 255, 0.032) 46%,
      rgba(255, 255, 255, 0.055) 100%
    ),
    rgba(12, 12, 12, 0.78);
  backdrop-filter: blur(26px) saturate(150%);
  -webkit-backdrop-filter: blur(26px) saturate(150%);
  border: 1px solid rgba(255, 255, 255, 0.14);
}

/*
  Corner shroud — the closed trigger's half of the same bug.

  The hero fills the viewport, so on a short laptop screen (measured: 1280x800
  and 1366x768, both common) the hero's "the risk core" placard is pinned into
  exactly the corner the trigger lives in, and a labelled trigger slices its
  caption in half. There is no free corner to move to — the hero owns all four
  at scroll 0 — so instead the page dissolves into the void underneath the
  trigger, the same way the ticker fades its names out at its edges. Anything
  behind the trigger ends in a vignette rather than a cut.

  It is only painted when the trigger is measurably covering hero copy (see
  the effect below), so it never dims a figure that was legible without it,
  and it never appears further down the page where it would sit over the
  full-bleed hazard banner and read as a smudge.
*/
.mirror-chat-shroud {
  background: radial-gradient(
    118% 118% at 100% 100%,
    rgba(10, 10, 10, 0.97) 0%,
    rgba(10, 10, 10, 0.9) 40%,
    rgba(10, 10, 10, 0.52) 64%,
    rgba(10, 10, 10, 0) 84%
  );
  opacity: 0;
  transition: opacity 320ms ease;
}
.mirror-chat-shroud[data-on="true"] { opacity: 1; }

/* Border colour lives here rather than on a Tailwind hover: utility, because
   .mirror-chat-shell sets the border shorthand and this stylesheet is
   injected after index.css — the shorthand would otherwise win. */
.mirror-chat-trigger:hover,
.mirror-chat-trigger:focus-visible {
  border-color: rgba(255, 30, 30, 0.6);
}

@media (prefers-reduced-motion: reduce) {
  .mirror-chat-scrim { backdrop-filter: none; -webkit-backdrop-filter: none; }
  .mirror-chat-shroud { transition: none; }
}
`;

/**
 * A real Q&A layer over Mirror's own real scan data — not a generic
 * "paste any repo" code reviewer. Every answer is grounded in the exact
 * payload already loaded on this page (the same JSON the table renders),
 * sent to Gemini as context on every question. No key means no chat: the
 * component degrades to an honest "not configured" state rather than a
 * fake or silent one.
 */
export function MirrorChat({ payload }: MirrorChatProps) {
  const reduced = useReducedMotion();
  const [open, setOpen] = useState(false);
  // Once you've used it, the trigger stops advertising itself.
  const [hasOpened, setHasOpened] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const configured = isConfigured();

  const send = async (question: string) => {
    if (!question.trim() || loading) return;
    setMessages((m) => [...m, { role: "user", text: question }]);
    setInput("");
    setLoading(true);
    try {
      const result = await askMirror(question, payload);
      setMessages((m) => [...m, { role: "assistant", text: result.text }]);
    } catch (err) {
      setMessages((m) => [
        ...m,
        { role: "error", text: err instanceof Error ? err.message : "Something went wrong asking Gemini." },
      ]);
    } finally {
      setLoading(false);
      requestAnimationFrame(() => {
        scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
      });
    }
  };

  // The window listener must call the *current* send, not the one captured
  // when the listener was attached, so it reads through a ref instead of
  // re-subscribing on every keystroke.
  const sendRef = useRef(send);
  useEffect(() => {
    sendRef.current = send;
  });

  useEffect(() => {
    if (typeof window === "undefined") return;
    const onAsk = (event: Event) => {
      setOpen(true);
      setHasOpened(true);
      const question = (event as CustomEvent<string | undefined>).detail;
      if (question && configured) void sendRef.current(question);
    };
    window.addEventListener(ASK_EVENT, onAsk);
    return () => window.removeEventListener(ASK_EVENT, onAsk);
  }, [configured]);

  // Escape closes, and opening moves focus into the field — the panel is a
  // modal surface now, so it has to behave like one.
  useEffect(() => {
    if (!open || typeof window === "undefined") return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    inputRef.current?.focus();
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const toggle = () => {
    setOpen((o) => !o);
    setHasOpened(true);
  };

  /*
    Is the trigger actually sitting on hero copy right now?

    This is measured rather than guessed, because whether it happens depends
    on the viewport's height as much as its width: at 390x844 and 1440x900
    the trigger clears the hero entirely, while at 390x667 it lands on the
    "cleared / 4" rail cell and at 1280x720 on the risk-core placard. A
    hardcoded breakpoint would be wrong at half of those. The shroud is only
    painted when there is really something under the trigger to dissolve, so
    it never dims a real figure that was legible without it.

    Scoped to #hero (a stable anchor — the nav links to it) because that is
    the one section composed of full-bleed lit type over a 3D scene. Further
    down, the trigger rests on opaque carbon panels, which need no help, and
    the full-bleed hazard banner would show a dark wash as a smudge.
  */
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [shroud, setShroud] = useState(false);
  const shroudRef = useRef(false);
  useEffect(() => {
    if (typeof window === "undefined") return;
    let queued = 0;

    const measure = () => {
      queued = 0;
      const trigger = triggerRef.current;
      const hero = document.getElementById("hero");
      let hit = false;

      if (trigger && hero) {
        const t = trigger.getBoundingClientRect();
        // A margin so type that stops just short of the pill still fades out
        // rather than ending abruptly against its edge.
        const box = { left: t.left - 30, right: t.right + 30, top: t.top - 30, bottom: t.bottom + 30 };
        const hr = hero.getBoundingClientRect();
        // One cheap rect while the hero is behind you; the full sweep only
        // runs when it could possibly matter.
        if (hr.bottom > box.top && hr.top < box.bottom) {
          for (const el of hero.querySelectorAll("p, span, div, h1, h2, h3, li")) {
            if (el.children.length > 0) continue;
            if (!el.textContent?.trim()) continue;
            const r = el.getBoundingClientRect();
            if (r.width === 0 || r.height === 0) continue;
            if (r.right < box.left || r.left > box.right) continue;
            if (r.bottom < box.top || r.top > box.bottom) continue;
            hit = true;
            break;
          }
        }
      }

      if (hit !== shroudRef.current) {
        shroudRef.current = hit;
        setShroud(hit);
      }
    };

    const onScroll = () => {
      if (!queued) queued = requestAnimationFrame(measure);
    };

    // The hero's own entrance is choreographed over ~2.2s (its placard is the
    // last beat), so a single measurement at mount reads positions that have
    // not settled yet. These re-checks land after each beat; after that,
    // scroll and resize are the only things that can move anything.
    const settles = [400, 1000, 1800, 2800].map((ms) => setTimeout(measure, ms));

    measure();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll, { passive: true });
    return () => {
      if (queued) cancelAnimationFrame(queued);
      settles.forEach(clearTimeout);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, []);

  return (
    <>
      <style>{CHAT_CSS}</style>

      {/*
        Sits under the nav (z-40 vs the nav's z-50) so the page's own chrome
        stays readable, and over everything else. Clicking it closes.
      */}
      <AnimatePresence>
        {open && (
          <motion.div
            aria-hidden="true"
            onClick={() => setOpen(false)}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: reduced ? 0 : 0.2, ease: "easeOut" }}
            className="mirror-chat-scrim fixed inset-0 z-40"
          />
        )}
      </AnimatePresence>

      <div
        aria-hidden="true"
        data-on={shroud && !open}
        className="mirror-chat-shroud pointer-events-none fixed bottom-0 right-0 z-40 h-[240px] w-[min(100vw,440px)]"
      />

      <div className="fixed bottom-4 right-4 z-50 flex max-w-[calc(100vw-2rem)] flex-col items-end font-mono sm:bottom-6 sm:right-6">
        <AnimatePresence>
          {open && (
            <motion.div
              role="dialog"
              aria-modal="true"
              aria-label="Ask Mirror"
              initial={reduced ? { opacity: 0 } : { opacity: 0, y: 12, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={reduced ? { opacity: 0 } : { opacity: 0, y: 12, scale: 0.98 }}
              transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
              style={{ ...SQUARE, transformOrigin: "bottom right" }}
              // Height is capped against the viewport, not just a fixed px
              // value: the trigger below it and the fixed nav above it both
              // have to stay clear at every height, including a 390px phone
              // where the nav wraps to two rows.
              className="mirror-glass mirror-chat-shell mb-3 flex h-[min(72vh,540px)] max-h-[calc(100dvh-13rem)] w-[min(calc(100vw-2rem),380px)] flex-col overflow-hidden sm:max-h-[calc(100dvh-10rem)] sm:w-[420px]"
            >
              {/* Brand edge — the one hazard element on the panel. */}
              <div aria-hidden="true" className="h-[3px] w-full shrink-0 bg-hazard" />

              <div className="flex items-start justify-between gap-3 border-b border-white/10 px-4 py-3.5">
                <div className="min-w-0">
                  <div className="flex items-center gap-2.5">
                    <span
                      className={`h-1.5 w-1.5 shrink-0 rounded-full ${configured ? "bg-safe" : "bg-white/30"}`}
                    />
                    <span className="mirror-display text-[15px] leading-none text-ink">
                      ASK MIRROR<span className="text-hazard">*</span>
                    </span>
                  </div>
                  <div className="mt-2 text-[10px] leading-relaxed text-white/45">
                    grounded in this page's real scan — nothing invented
                  </div>
                </div>
                <button
                  onClick={() => setOpen(false)}
                  aria-label="Close chat"
                  style={PILL}
                  className="-mr-1 shrink-0 border border-white/10 px-2.5 py-1 text-[11px] leading-none text-white/50 outline-none transition-colors hover:border-hazard/60 hover:text-hazard focus-visible:border-hazard/60 focus-visible:text-hazard"
                >
                  ✕
                </button>
              </div>

              <div ref={scrollRef} className="flex-1 space-y-2.5 overflow-y-auto px-4 py-4 text-xs">
                {!configured ? (
                  <div className="border border-review/40 bg-review/10 px-3 py-3 leading-relaxed text-review">
                    Gemini API key not configured (VITE_GEMINI_API_KEY missing) — chat is disabled,
                    not faked.
                  </div>
                ) : messages.length === 0 ? (
                  <div className="space-y-2">
                    <div className="text-[10px] uppercase tracking-[0.2em] text-white/35">
                      Ask about the {payload.results.length} real resources on this page.
                    </div>
                    {SUGGESTIONS.map((s) => (
                      <button
                        key={s}
                        onClick={() => send(s)}
                        className="block w-full border border-white/10 px-3 py-2.5 text-left leading-relaxed text-white/60 outline-none transition-colors hover:border-hazard/50 hover:bg-white/[0.03] hover:text-ink focus-visible:border-hazard/50 focus-visible:text-ink"
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                ) : null}

                {messages.map((m, i) => (
                  <motion.div
                    key={i}
                    initial={reduced ? false : { opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.18, ease: "easeOut" }}
                    className={
                      m.role === "user"
                        ? "ml-6 border-l-2 border-ink/40 bg-white/[0.06] px-3 py-2 leading-relaxed text-ink"
                        : m.role === "error"
                          ? "border border-blocked/40 bg-blocked/10 px-3 py-2 leading-relaxed text-blocked"
                          : "border border-white/10 bg-white/[0.03] px-3 py-2 leading-relaxed text-white/80"
                    }
                  >
                    {m.role === "assistant" ? stripMarkdown(m.text) : m.text}
                  </motion.div>
                ))}

                {loading && (
                  <div className="flex items-center gap-2 border border-white/10 bg-white/[0.03] px-3 py-2 text-white/40">
                    <span className="flex gap-1" aria-hidden="true">
                      {[0, 1, 2].map((i) => (
                        <motion.span
                          key={i}
                          className="h-1 w-1 bg-hazard"
                          animate={reduced ? { opacity: 0.6 } : { opacity: [0.2, 1, 0.2] }}
                          transition={
                            reduced
                              ? undefined
                              : { duration: 1, repeat: Infinity, delay: i * 0.15, ease: "easeInOut" }
                          }
                        />
                      ))}
                    </span>
                    thinking…
                  </div>
                )}
              </div>

              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  send(input);
                }}
                className="flex gap-2 border-t border-white/10 p-3"
              >
                <input
                  ref={inputRef}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  disabled={!configured || loading}
                  placeholder={configured ? "ask about this scan…" : "chat disabled"}
                  className="min-w-0 flex-1 border border-white/10 bg-white/5 px-3 py-2 text-xs text-ink outline-none placeholder:text-white/30 focus-visible:border-hazard/60 disabled:opacity-40"
                />
                <button
                  type="submit"
                  disabled={!configured || loading || !input.trim()}
                  style={PILL}
                  className="shrink-0 bg-hazard px-4 py-2 text-[10px] font-bold uppercase tracking-[0.2em] text-void outline-none transition-opacity disabled:opacity-30"
                >
                  Ask
                </button>
              </form>
            </motion.div>
          )}
        </AnimatePresence>

        {/*
          A labelled, two-line trigger rather than an icon-only FAB. The chat
          is a real feature of this page — it answers from the same payload
          the table renders — so it gets a name, a live status dot, and the
          real resource count it is holding, and it keeps them without
          needing a hover to reveal them.
        */}
        <motion.button
          ref={triggerRef}
          data-testid="chat-toggle"
          onClick={toggle}
          aria-expanded={open}
          aria-haspopup="dialog"
          whileTap={reduced ? undefined : { scale: 0.96 }}
          style={PILL}
          className="mirror-glass mirror-chat-shell mirror-chat-trigger group relative flex items-center gap-3 py-2.5 pl-3.5 pr-5 text-left outline-none transition-colors"
        >
          {/* One slow hazard ring, only until the thing has been opened once. */}
          {!open && !hasOpened && !reduced && (
            <motion.span
              aria-hidden="true"
              style={PILL}
              className="pointer-events-none absolute inset-0 border border-hazard/70"
              animate={{ opacity: [0.5, 0, 0.5], scale: [1, 1.13, 1] }}
              transition={{ duration: 2.8, repeat: Infinity, ease: "easeOut" }}
            />
          )}

          <span
            aria-hidden="true"
            className={`h-1.5 w-1.5 shrink-0 rounded-full ${configured ? "bg-safe" : "bg-white/30"}`}
          />
          <span
            aria-hidden="true"
            className="text-base leading-none text-hazard transition-transform duration-300 group-hover:rotate-90"
          >
            {open ? "✕" : "✦"}
          </span>
          <span className="flex min-w-0 flex-col leading-none">
            <span className="text-[11px] font-bold uppercase tracking-[0.26em] text-ink">
              {open ? "Close" : "Ask Mirror"}
            </span>
            <span className="mt-1.5 whitespace-nowrap text-[9px] uppercase tracking-[0.18em] text-white/40">
              {payload.results.length} real result{payload.results.length === 1 ? "" : "s"} loaded
            </span>
          </span>
        </motion.button>
      </div>
    </>
  );
}

interface ChatInviteProps {
  /** Real resource count from the payload already on the page. */
  total: number;
}

/**
 * The in-page doorway to the chat. It exists because a corner trigger, no
 * matter how loud, is still something you have to notice — this states what
 * the feature actually is, in the reading flow, at section scale, and every
 * claim in it is literally what `askMirror` does: the whole payload goes to
 * Gemini as context, and a failure surfaces as an error rather than a guess.
 */
export function ChatInvite({ total }: ChatInviteProps) {
  const reduced = useReducedMotion();
  const configured = isConfigured();

  return (
    <section
      id="ask"
      aria-labelledby="ask-title"
      className="relative z-10 mx-auto mt-20 max-w-6xl px-6 sm:mt-28"
    >
      <motion.div
        initial={reduced ? false : { opacity: 0, y: 20 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, margin: "-80px" }}
        transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
        className="mirror-panel relative overflow-hidden"
      >
        <div className="mirror-scanline" aria-hidden="true" />

        <div className="relative grid gap-10 px-5 py-9 sm:px-10 sm:py-12 lg:grid-cols-[1.25fr_1fr] lg:items-end lg:gap-14">
          <div className="min-w-0">
            <div className="flex items-center gap-3">
              <span
                aria-hidden="true"
                className={`h-1.5 w-1.5 shrink-0 ${configured ? "bg-safe" : "bg-white/30"}`}
              />
              <span className="mirror-eyebrow text-base text-gold">ask mirror</span>
            </div>

            <h2
              id="ask-title"
              // Bounded by the longest line, "about this scan": 15 characters
              // of Unbounded 900 is ~0.68em each, so at the 42px ceiling it
              // runs ~428px inside a 467px column at 1024, and at the 24px
              // floor ~245px inside a 302px measure at 390. It can never wrap
              // into a third crushed line at any width between.
              className="mirror-display-crush mt-4 text-[clamp(24px,5vw,42px)] uppercase text-ink"
            >
              Ask mirror
              <br />
              <span className="mirror-stroke-text">about this scan</span>
            </h2>

            <p className="mt-6 max-w-lg font-mono text-xs leading-relaxed text-smoke">
              The chat in the corner is not a generic assistant. Every question ships with this
              page&apos;s entire payload — all {total} {total === 1 ? "result" : "results"}, their
              verdicts, real dependents, Cedar reasons and rollback plans — as context. If the model
              can&apos;t answer from that, you get an error, not a guess.
            </p>

            {!configured && (
              <p className="mt-4 max-w-lg border border-review/40 bg-review/10 px-3 py-2 font-mono text-[11px] leading-relaxed text-review">
                VITE_GEMINI_API_KEY isn&apos;t configured in this build — the panel opens and says
                so rather than faking an answer.
              </p>
            )}
          </div>

          <div className="min-w-0">
            <div className="font-mono text-[10px] uppercase tracking-[0.28em] text-smoke/70">
              start with a real question
            </div>
            <ul className="mt-4 border-t border-white/10">
              {SUGGESTIONS.map((s) => (
                <li key={s}>
                  <button
                    onClick={() => openMirrorChat(s)}
                    className="group flex w-full items-start gap-3 border-b border-white/10 py-3.5 text-left font-mono text-[11px] leading-relaxed text-smoke outline-none transition-colors hover:text-ink focus-visible:text-ink"
                  >
                    <span
                      aria-hidden="true"
                      className="mt-[3px] shrink-0 text-hazard opacity-60 transition-opacity group-hover:opacity-100"
                    >
                      &#8627;
                    </span>
                    <span className="min-w-0">{s}</span>
                  </button>
                </li>
              ))}
            </ul>

            <button
              onClick={() => openMirrorChat()}
              style={PILL}
              className="mt-6 inline-flex items-center gap-2.5 bg-hazard px-5 py-2.5 font-mono text-[10px] font-bold uppercase tracking-[0.24em] text-void outline-none transition-opacity hover:opacity-85 focus-visible:opacity-85"
            >
              <span aria-hidden="true">✦</span>
              Open ask mirror
            </button>
          </div>
        </div>
      </motion.div>
    </section>
  );
}
