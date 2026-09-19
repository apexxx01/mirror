import type { MirrorPayload } from "../types";

const MODEL = "gemini-3.6-flash";
const API_KEY = import.meta.env.VITE_GEMINI_API_KEY as string | undefined;

const SYSTEM_PROMPT = `You are Mirror's analysis assistant. Mirror is a real AWS dependency-graph
guardrail: it previews the real consequences of deleting an AWS resource against an actual
AWS account, gated by a real Cedar policy engine — not a hand-rolled if/else.

Below is REAL data from an actual scan of a real AWS account, published moments ago. Every
verdict, dependent, risk score, reversibility fact, future-diff entry, rollback step, and
Cedar decision/reason in it is a genuine field from that scan — nothing is simulated.

Answer the user's question using ONLY this real data. Be concrete: name real resources by
their real ids, cite real reasons. If asked for fixes or next steps, give tangible,
specific recommendations grounded in the real reversibility/rollback data already present —
e.g. "enable S3 versioning on X" only if X's reversibility reason actually says versioning
is disabled, never invent an AWS behavior you have no evidence for in the data below. If the
data doesn't support an answer, say so plainly instead of guessing. Keep answers under 180
words unless the user explicitly asks for more detail.`;

function summarizeForContext(payload: MirrorPayload): string {
  const lines = payload.results.map((r) => {
    return [
      `- ${r.resource} [${r.verdict}]`,
      `  risk_score=${r.risk_score}, dependents=[${r.dependents.join(", ") || "none"}]`,
      `  reversibility=${r.reversibility.level} (${r.reversibility.reason})`,
      `  mirror_score=${r.mirror_score.score} (${r.mirror_score.badge})`,
      `  cedar_decision=${r.cedar_decision}, cedar_reasons=[${r.cedar_reasons.join(", ") || "none"}]`,
      `  rollback_available=${r.rollback_plan.available}${
        r.rollback_plan.available ? "" : ` (${r.rollback_plan.reason})`
      }`,
    ].join("\n");
  });
  return `Scan generated at: ${payload.generated_at}\n\n${lines.join("\n")}`;
}

export interface AskMirrorResult {
  text: string;
}

/**
 * Sends the real currently-loaded scan data plus the user's question to
 * Gemini and returns the real model response. Throws on any failure —
 * callers must show a real error, never a fabricated fallback answer.
 */
export async function askMirror(question: string, payload: MirrorPayload): Promise<AskMirrorResult> {
  if (!API_KEY) {
    throw new Error("Gemini API key not configured (VITE_GEMINI_API_KEY missing)");
  }

  const context = summarizeForContext(payload);
  const prompt = `${SYSTEM_PROMPT}\n\nREAL SCAN DATA:\n${context}\n\nUSER QUESTION: ${question}`;

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${API_KEY}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
    }
  );

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Gemini request failed: HTTP ${res.status}${body ? ` — ${body.slice(0, 200)}` : ""}`);
  }

  const data = await res.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) {
    throw new Error("Gemini returned no text in its response");
  }

  return { text };
}
