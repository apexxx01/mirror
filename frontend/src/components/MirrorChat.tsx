import { useRef, useState } from "react";
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

// The chat panel is floating chrome, and floating chrome is the one place
// `.mirror-glass` survives — but the system bans soft corners everywhere
// except pills, so the panel's own 16px radius is squared off here and the
// FAB is pushed all the way to a pill.
const SQUARE = { borderRadius: 0 } as const;
const PILL = { borderRadius: 9999 } as const;

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
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const configured = Boolean(import.meta.env.VITE_GEMINI_API_KEY);

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

  return (
    <div className="fixed bottom-5 right-5 z-50 flex flex-col items-end font-mono sm:bottom-6 sm:right-6">
      <AnimatePresence>
        {open && (
          <motion.div
            role="dialog"
            aria-label="Ask Mirror"
            initial={reduced ? { opacity: 0 } : { opacity: 0, y: 12, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={reduced ? { opacity: 0 } : { opacity: 0, y: 12, scale: 0.98 }}
            transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
            style={{ ...SQUARE, transformOrigin: "bottom right" }}
            className="mirror-glass mb-3 flex h-[min(70vh,480px)] w-[min(calc(100vw-2.5rem),360px)] flex-col overflow-hidden sm:w-[380px]"
          >
            <div className="flex items-center justify-between gap-3 border-b border-white/10 px-4 py-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span
                    className={`h-1.5 w-1.5 shrink-0 rounded-full ${configured ? "bg-safe" : "bg-white/30"}`}
                  />
                  <div className="text-[11px] font-bold uppercase tracking-[0.25em] text-ink">
                    Ask Mirror
                  </div>
                </div>
                <div className="mt-1 text-[10px] leading-relaxed text-white/40">
                  grounded in this page's real scan — nothing invented
                </div>
              </div>
              <button
                onClick={() => setOpen(false)}
                aria-label="Close chat"
                style={PILL}
                className="shrink-0 px-2 py-1 text-white/50 outline-none transition-colors hover:text-hazard focus-visible:text-hazard"
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
                      className="block w-full border border-white/10 px-3 py-2 text-left leading-relaxed text-white/60 outline-none transition-colors hover:border-hazard/50 hover:bg-white/[0.03] hover:text-ink focus-visible:border-hazard/50 focus-visible:text-ink"
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
        Deliberately a small icon-first FAB, not a labeled hero button — the
        real scan data is the page's subject, this is a secondary utility
        layered on top of it, not a competing centerpiece. Expands to show
        its label only on hover/focus.
      */}
      <motion.button
        data-testid="chat-toggle"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        whileTap={reduced ? undefined : { scale: 0.92 }}
        style={PILL}
        className="group mirror-glass flex h-10 items-center gap-2 overflow-hidden px-3 text-[10px] font-bold uppercase tracking-[0.2em] text-white/70 outline-none transition-colors hover:text-hazard focus-visible:text-hazard"
      >
        <span
          className={`h-1.5 w-1.5 shrink-0 rounded-full ${configured ? "bg-safe" : "bg-white/30"}`}
        />
        <span className="text-sm leading-none">{open ? "✕" : "✦"}</span>
        <span className="max-w-0 overflow-hidden whitespace-nowrap opacity-0 transition-all duration-200 group-hover:max-w-[80px] group-hover:opacity-100 group-focus-visible:max-w-[80px] group-focus-visible:opacity-100">
          {open ? "close" : "ask mirror"}
        </span>
      </motion.button>
    </div>
  );
}
