import { useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
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
 * A real Q&A layer over Mirror's own real scan data — not a generic
 * "paste any repo" code reviewer. Every answer is grounded in the exact
 * payload already loaded on this page (the same JSON the table renders),
 * sent to Gemini as context on every question. No key means no chat: the
 * component degrades to an honest "not configured" state rather than a
 * fake or silent one.
 */
export function MirrorChat({ payload }: MirrorChatProps) {
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
    <div className="fixed bottom-6 right-6 z-50 font-mono">
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: 16, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 16, scale: 0.97 }}
            transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
            className="mirror-glass mb-3 flex h-[480px] w-[360px] flex-col overflow-hidden sm:w-[400px]"
          >
            <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
              <div>
                <div className="text-xs font-bold uppercase tracking-widest text-white/90">
                  Ask Mirror
                </div>
                <div className="text-[10px] text-white/40">
                  grounded in this page's real scan — nothing invented
                </div>
              </div>
              <button
                onClick={() => setOpen(false)}
                aria-label="Close chat"
                className="rounded-full px-2 py-1 text-white/50 outline-none transition-colors hover:text-hazard focus-visible:text-hazard"
              >
                ✕
              </button>
            </div>

            <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto px-4 py-4 text-xs">
              {!configured ? (
                <div className="rounded-lg border border-review/40 bg-review/10 px-3 py-3 text-review">
                  Gemini API key not configured (VITE_GEMINI_API_KEY missing) — chat is disabled,
                  not faked.
                </div>
              ) : messages.length === 0 ? (
                <div className="space-y-2">
                  <div className="text-white/50">
                    Ask about the {payload.results.length} real resources on this page.
                  </div>
                  {SUGGESTIONS.map((s) => (
                    <button
                      key={s}
                      onClick={() => send(s)}
                      className="block w-full rounded-lg border border-white/10 px-3 py-2 text-left text-white/60 outline-none transition-colors hover:border-hazard/40 hover:text-white/90 focus-visible:border-hazard/40 focus-visible:text-white/90"
                    >
                      {s}
                    </button>
                  ))}
                </div>
              ) : null}

              {messages.map((m, i) => (
                <div
                  key={i}
                  className={
                    m.role === "user"
                      ? "ml-6 rounded-lg bg-white/10 px-3 py-2 text-white/90"
                      : m.role === "error"
                        ? "rounded-lg border border-blocked/40 bg-blocked/10 px-3 py-2 text-blocked"
                        : "rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-white/80"
                  }
                >
                  {m.role === "assistant" ? stripMarkdown(m.text) : m.text}
                </div>
              ))}
              {loading && (
                <div className="rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-white/40">
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
                className="min-w-0 flex-1 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs text-white/90 outline-none placeholder:text-white/30 focus-visible:border-hazard/50 disabled:opacity-40"
              />
              <button
                type="submit"
                disabled={!configured || loading || !input.trim()}
                className="rounded-full bg-hazard px-4 py-2 text-[10px] font-bold uppercase tracking-widest text-void outline-none transition-opacity disabled:opacity-30"
              >
                Ask
              </button>
            </form>
          </motion.div>
        )}
      </AnimatePresence>

      <motion.button
        onClick={() => setOpen((o) => !o)}
        whileTap={{ scale: 0.94 }}
        className="mirror-glass flex items-center gap-2 px-5 py-3 text-xs font-bold uppercase tracking-widest text-white/90 outline-none transition-colors hover:text-hazard focus-visible:text-hazard"
      >
        <span className={`h-2 w-2 rounded-full ${configured ? "bg-safe" : "bg-white/30"}`} />
        {open ? "Close" : "Ask Mirror"}
      </motion.button>
    </div>
  );
}
