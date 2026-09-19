import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { MirrorChat } from "./MirrorChat";
import { makeMirrorResult } from "../test-utils";
import type { MirrorPayload } from "../types";

const payload: MirrorPayload = {
  generated_at: "2026-01-01T00:00:00Z",
  bedrock_summary: null,
  results: [makeMirrorResult({ resource: "s3:example" })],
};

describe("MirrorChat", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("shows an honest not-configured state instead of faking a chat when no key is set", () => {
    // Explicitly stub the key to empty for this test — a real deploy
    // without VITE_GEMINI_API_KEY set must degrade honestly, and this
    // dev environment's own .env.local (real key) shouldn't leak in.
    vi.stubEnv("VITE_GEMINI_API_KEY", "");
    render(<MirrorChat payload={payload} />);
    fireEvent.click(screen.getByText("Ask Mirror"));
    expect(screen.getByText(/Gemini API key not configured/)).toBeInTheDocument();
    expect(screen.getByPlaceholderText("chat disabled")).toBeDisabled();
  });

  it("toggles open and closed", () => {
    render(<MirrorChat payload={payload} />);
    expect(screen.queryByText(/grounded in this page's real scan/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByText("Ask Mirror"));
    expect(screen.getByText(/grounded in this page's real scan/)).toBeInTheDocument();
  });
});
