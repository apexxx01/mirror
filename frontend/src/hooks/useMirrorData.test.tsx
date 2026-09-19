import { renderHook, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { useMirrorData } from "./useMirrorData";

describe("useMirrorData", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  it("returns placeholder status when the URL is unconfigured", async () => {
    const { result } = renderHook(() => useMirrorData("MIRROR_DATA_URL_PLACEHOLDER"));
    expect(result.current.status).toBe("placeholder");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("returns loading then success on a good fetch", async () => {
    const payload = { generated_at: "2026-01-01T00:00:00Z", bedrock_summary: null, results: [] };
    (fetch as any).mockResolvedValueOnce({ ok: true, json: async () => payload });

    const { result } = renderHook(() => useMirrorData("https://example.com/data.json"));
    expect(result.current.status).toBe("loading");

    await waitFor(() => expect(result.current.status).toBe("success"));
    expect(result.current.data).toEqual(payload);
  });

  it("returns error status with a clear message on fetch failure", async () => {
    (fetch as any).mockResolvedValueOnce({ ok: false, status: 403 });

    const { result } = renderHook(() => useMirrorData("https://example.com/data.json"));
    await waitFor(() => expect(result.current.status).toBe("error"));
    expect(result.current.error).toMatch(/403/);
  });

  it("returns error status when fetch itself throws (network failure)", async () => {
    (fetch as any).mockRejectedValueOnce(new Error("network down"));

    const { result } = renderHook(() => useMirrorData("https://example.com/data.json"));
    await waitFor(() => expect(result.current.status).toBe("error"));
    expect(result.current.error).toMatch(/network down/);
  });
});
