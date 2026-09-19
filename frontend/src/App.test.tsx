import { render, screen, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import App from "./App";
import * as configModule from "./config";
import { makeMirrorResult } from "./test-utils";

describe("App", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  it("shows the placeholder state when MIRROR_DATA_URL is unconfigured", () => {
    vi.spyOn(configModule, "MIRROR_DATA_URL", "get").mockReturnValue("MIRROR_DATA_URL_PLACEHOLDER");
    render(<App />);
    expect(screen.getByTestId("placeholder-state")).toBeInTheDocument();
  });

  it("shows a designed error state with a clear message on fetch failure", async () => {
    vi.spyOn(configModule, "MIRROR_DATA_URL", "get").mockReturnValue("https://example.com/data.json");
    (fetch as any).mockResolvedValueOnce({ ok: false, status: 500 });
    render(<App />);
    await waitFor(() => expect(screen.getByTestId("error-state")).toBeInTheDocument());
    expect(screen.getByTestId("error-state")).toHaveTextContent("500");
  });

  it("renders the Bedrock summary callout when present", async () => {
    vi.spyOn(configModule, "MIRROR_DATA_URL", "get").mockReturnValue("https://example.com/data.json");
    (fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        generated_at: "2026-01-01T00:00:00Z",
        bedrock_summary: "Two resources look idle but are load-bearing.",
        results: [],
      }),
    });
    render(<App />);
    await waitFor(() =>
      expect(screen.getByText("Two resources look idle but are load-bearing.")).toBeInTheDocument()
    );
  });

  it("renders sorted real results in the table once loaded", async () => {
    vi.spyOn(configModule, "MIRROR_DATA_URL", "get").mockReturnValue("https://example.com/data.json");
    (fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        generated_at: "2026-01-01T00:00:00Z",
        bedrock_summary: null,
        results: [
          makeMirrorResult({ resource: "safe:one", verdict: "SAFE", node_name: "one" }),
          makeMirrorResult({ resource: "blocked:one", verdict: "BLOCKED", node_name: "one" }),
        ],
      }),
    });
    render(<App />);
    await waitFor(() => expect(screen.getByText("blocked:one")).toBeInTheDocument());
    const rows = screen.getAllByTestId("row-toggle");
    expect(rows[0]).toHaveTextContent("blocked:one");
    expect(rows[1]).toHaveTextContent("safe:one");
  });
});
