import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { ChatInvite, MirrorChat } from "./MirrorChat";
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
    fireEvent.click(screen.getByTestId("chat-toggle"));
    expect(screen.getByText(/Gemini API key not configured/)).toBeInTheDocument();
    expect(screen.getByPlaceholderText("chat disabled")).toBeDisabled();
  });

  it("toggles open and closed", () => {
    render(<MirrorChat payload={payload} />);
    expect(screen.queryByText(/grounded in this page's real scan/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId("chat-toggle"));
    expect(screen.getByText(/grounded in this page's real scan/)).toBeInTheDocument();
  });

  it("closes on Escape, so the scrim can never trap the page", () => {
    render(<MirrorChat payload={payload} />);
    fireEvent.click(screen.getByTestId("chat-toggle"));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    fireEvent.keyDown(window, { key: "Escape" });
    // The panel plays an exit animation, so the reliable synchronous signal
    // that Escape was honoured is the trigger's own expanded state.
    expect(screen.getByTestId("chat-toggle")).toHaveAttribute("aria-expanded", "false");
  });

  it("opens the panel from the in-page ChatInvite callout", () => {
    render(
      <>
        <ChatInvite total={payload.results.length} />
        <MirrorChat payload={payload} />
      </>
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /open ask mirror/i }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });
});
