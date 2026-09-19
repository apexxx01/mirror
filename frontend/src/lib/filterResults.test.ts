import { describe, it, expect } from "vitest";
import { filterByVerdicts } from "./filterResults";
import type { MirrorResult } from "../types";

const make = (verdict: MirrorResult["verdict"], resource: string): MirrorResult => ({
  resource, verdict, dependents: [], risk_score: 0, node_type: "s3_bucket", node_name: resource,
});

describe("filterByVerdicts", () => {
  it("returns all results when no filters are selected", () => {
    const input = [make("SAFE", "a"), make("BLOCKED", "b")];
    expect(filterByVerdicts(input, [])).toEqual(input);
  });

  it("returns only results matching selected verdicts", () => {
    const input = [make("SAFE", "a"), make("BLOCKED", "b"), make("NEEDS_REVIEW", "c")];
    const result = filterByVerdicts(input, ["BLOCKED", "SAFE"]).map((r) => r.resource);
    expect(result).toEqual(["a", "b"]);
  });
});
