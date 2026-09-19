import { describe, it, expect } from "vitest";
import { countByVerdict } from "./statCounts";
import type { MirrorResult } from "../types";
import { makeMirrorResult } from "../test-utils";

const make = (verdict: MirrorResult["verdict"]): MirrorResult => makeMirrorResult({ resource: "x", verdict, node_name: "x" });

describe("countByVerdict", () => {
  it("counts each verdict correctly, including zero counts", () => {
    const input = [make("BLOCKED"), make("BLOCKED"), make("SAFE")];
    expect(countByVerdict(input)).toEqual({ BLOCKED: 2, NEEDS_REVIEW: 0, SAFE: 1 });
  });

  it("returns all-zero counts for an empty result set", () => {
    expect(countByVerdict([])).toEqual({ BLOCKED: 0, NEEDS_REVIEW: 0, SAFE: 0 });
  });
});
