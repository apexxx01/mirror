import { describe, it, expect } from "vitest";
import { sortByVerdict } from "./sortResults";
import type { MirrorResult } from "../types";
import { makeMirrorResult } from "../test-utils";

const make = (verdict: MirrorResult["verdict"], resource: string): MirrorResult =>
  makeMirrorResult({ resource, verdict, node_name: resource });

describe("sortByVerdict", () => {
  it("orders BLOCKED, then NEEDS_REVIEW, then SAFE", () => {
    const input = [make("SAFE", "c"), make("BLOCKED", "a"), make("NEEDS_REVIEW", "b")];
    const result = sortByVerdict(input).map((r) => r.resource);
    expect(result).toEqual(["a", "b", "c"]);
  });

  it("does not mutate the input array", () => {
    const input = [make("SAFE", "c"), make("BLOCKED", "a")];
    const copy = [...input];
    sortByVerdict(input);
    expect(input).toEqual(copy);
  });
});
