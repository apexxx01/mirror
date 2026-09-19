import { describe, it, expect } from "vitest";
import { buildLayout, fibonacciPoint, hashUnit } from "./GraphBackground";
import type { MirrorResult } from "../types";
import { makeMirrorResult } from "../test-utils";
import * as THREE from "three";

/**
 * These tests guard the one constraint the whole component exists to honour:
 * the picture is the payload. One node per real resource, one edge per real
 * dependency, nothing invented to make it look busier. `buildLayout` is where
 * both counts are decided, so that is where the guarantee is pinned down.
 *
 * The rendering itself (WebGL) is not testable in jsdom and is verified by a
 * manual browser check — but none of the logic below needs a GL context.
 */

const make = (
  resource: string,
  dependents: string[] = [],
  verdict: MirrorResult["verdict"] = "SAFE",
  risk_score = 0,
): MirrorResult => makeMirrorResult({ resource, verdict, dependents, risk_score, node_name: resource });

/** The real sandbox shape: 8 resources, 3 genuine dependency edges. */
const SANDBOX: MirrorResult[] = [
  make("s3:scratch"),
  make("s3:archive-2023", ["lambda:report-generator"], "BLOCKED", 12),
  make("dynamodb:temp-cache"),
  make("dynamodb:user-sessions", ["lambda:billing-processor"], "BLOCKED", 98),
  make("lambda:cleanup-worker"),
  make("lambda:report-generator", ["eventbridge:report-schedule"], "BLOCKED", 96),
  make("lambda:billing-processor", [], "NEEDS_REVIEW", 99),
  make("eventbridge:report-schedule", [], "NEEDS_REVIEW", 50),
];

describe("buildLayout — node count is the resource count", () => {
  it("emits exactly one node per result, with no extras", () => {
    const { nodes } = buildLayout(SANDBOX);
    expect(nodes).toHaveLength(SANDBOX.length);
    expect(nodes.map((n) => n.id)).toEqual(SANDBOX.map((r) => r.resource));
  });

  it("carries each result's real verdict, dependent count and risk_score onto its node", () => {
    const { nodes } = buildLayout(SANDBOX);
    for (const [i, r] of SANDBOX.entries()) {
      expect(nodes[i].verdict).toBe(r.verdict);
      expect(nodes[i].dependentCount).toBe(r.dependents.length);
      expect(nodes[i].risk).toBe(r.risk_score);
    }
  });

  it("returns nothing at all for an empty payload", () => {
    expect(buildLayout([])).toEqual({ nodes: [], edges: [] });
  });
});

describe("buildLayout — edges are real dependency relationships only", () => {
  it("emits exactly one edge per real dependents entry", () => {
    const { edges } = buildLayout(SANDBOX);
    const expected = SANDBOX.reduce((n, r) => n + r.dependents.length, 0);
    expect(edges).toHaveLength(expected);
    expect(edges).toHaveLength(3);
  });

  it("points each edge from the resource to the dependent that would break", () => {
    const { nodes, edges } = buildLayout(SANDBOX);
    const named = edges.map((e) => [nodes[e.from].id, nodes[e.to].id]);
    expect(named).toEqual([
      ["s3:archive-2023", "lambda:report-generator"],
      ["dynamodb:user-sessions", "lambda:billing-processor"],
      ["lambda:report-generator", "eventbridge:report-schedule"],
    ]);
  });

  it("drops dangling dependents rather than inventing a node to hang them on", () => {
    const results = [make("a", ["ghost:not-in-payload"]), make("b")];
    const { nodes, edges } = buildLayout(results);
    // The node count still tracks the payload exactly — no phantom endpoint.
    expect(nodes).toHaveLength(2);
    expect(edges).toHaveLength(0);
  });

  it("drops self-referential dependents", () => {
    const { nodes, edges } = buildLayout([make("a", ["a"]), make("b")]);
    expect(nodes).toHaveLength(2);
    expect(edges).toHaveLength(0);
  });

  it("collapses a duplicated dependent into a single edge", () => {
    const { edges } = buildLayout([make("a", ["b", "b", "b"]), make("b")]);
    expect(edges).toHaveLength(1);
    expect(edges[0]).toEqual({ from: 0, to: 1 });
  });

  it("keeps both directions when two resources genuinely depend on each other", () => {
    const { edges } = buildLayout([make("a", ["b"]), make("b", ["a"])]);
    expect(edges).toHaveLength(2);
    expect(edges).toEqual([
      { from: 0, to: 1 },
      { from: 1, to: 0 },
    ]);
  });
});

describe("buildLayout — determinism", () => {
  it("produces byte-identical positions for the same payload twice", () => {
    const a = buildLayout(SANDBOX);
    const b = buildLayout(SANDBOX);
    expect(a.edges).toEqual(b.edges);
    expect(a.nodes.map((n) => n.unit.toArray())).toEqual(b.nodes.map((n) => n.unit.toArray()));
  });

  it("keeps every node inside the unit sphere so the viewport scaling stays bounded", () => {
    const { nodes } = buildLayout(SANDBOX);
    for (const n of nodes) {
      expect(n.unit.length()).toBeLessThanOrEqual(1 + 1e-6);
    }
  });

  it("separates connected resources by less than the graph's own diameter", () => {
    // The relaxation exists to make real relationships visible as proximity.
    const { nodes, edges } = buildLayout(SANDBOX);
    for (const e of edges) {
      expect(nodes[e.from].unit.distanceTo(nodes[e.to].unit)).toBeLessThan(2);
    }
  });
});

describe("hashUnit", () => {
  it("is stable across calls and bounded to [0, 1)", () => {
    for (const s of ["s3:archive-2023", "", "lambda:x", "a".repeat(200)]) {
      const v = hashUnit(s);
      expect(v).toBe(hashUnit(s));
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it("separates names that differ only slightly", () => {
    expect(hashUnit("mirror-demo-scratch")).not.toBe(hashUnit("mirror-demo-scratci"));
  });
});

describe("fibonacciPoint", () => {
  it("returns unit-length points for every index, including the edges of the range", () => {
    const v = new THREE.Vector3();
    for (const n of [1, 2, 8, 64]) {
      for (let i = 0; i < n; i++) {
        expect(fibonacciPoint(i, n, v).length()).toBeCloseTo(1, 6);
      }
    }
  });

  it("stays finite when asked for a point in an empty set", () => {
    // acos() is clamped so a degenerate n can never produce NaN positions.
    const v = fibonacciPoint(0, 0, new THREE.Vector3());
    expect(Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z)).toBe(true);
  });
});
