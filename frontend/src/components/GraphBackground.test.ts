import { describe, it, expect } from "vitest";
import {
  buildEvidenceField,
  buildLayout,
  evidenceCount,
  fibonacciPoint,
  hashUnit,
  MAX_MOTES,
  severityOf,
} from "./GraphBackground";
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

/**
 * The ambient particle field is the one place a background like this usually
 * cheats — "add 2000 stars" — so the same guarantee `buildLayout` carries for
 * nodes and edges is pinned down here for motes: one mote per real evidence
 * record, and no other source of motes exists.
 */
describe("evidenceCount — motes are real records only", () => {
  it("counts every evidence array the payload actually carries", () => {
    const r = makeMirrorResult({
      cedar_reasons: ["p1", "p2"],
      blast_radius: [{ resource: "x", hop: 1, invocations_90d: 3 }],
      adversarial: [{ resource: "x", hop: 1, errors: 2, throttles: 0 }],
      future_diff: {
        resource: "a",
        action: "delete",
        self: { before: {}, after: { exists: false, note: "" } },
        downstream: [{ dependent: "x", via: "y", before: "b", after: "a" }],
      },
      rollback_plan: { available: true, steps: ["s1", "s2", "s3"], reason: null },
    });
    // 2 reasons + 1 hop + 1 adversarial + 4 matrix rows + 1 downstream + 3 steps
    expect(evidenceCount(r)).toBe(12);
  });

  it("is zero when a resource carries no evidence at all", () => {
    const bare = makeMirrorResult({
      cedar_reasons: [],
      decision_matrix: [],
      rollback_plan: { available: false, steps: [], reason: null },
    });
    expect(evidenceCount(bare)).toBe(0);
  });
});

describe("buildEvidenceField", () => {
  it("emits exactly the payload's total evidence count — no padding", () => {
    const motes = buildEvidenceField(SANDBOX);
    const expected = SANDBOX.reduce((n, r) => n + evidenceCount(r), 0);
    expect(motes).toHaveLength(expected);
    expect(expected).toBeGreaterThan(0);
  });

  it("attributes every mote to a real node index, verdict and risk", () => {
    const motes = buildEvidenceField(SANDBOX);
    for (const m of motes) {
      expect(m.owner).toBeGreaterThanOrEqual(0);
      expect(m.owner).toBeLessThan(SANDBOX.length);
      expect(m.verdict).toBe(SANDBOX[m.owner].verdict);
      expect(m.heat).toBeCloseTo(SANDBOX[m.owner].risk_score / 100, 6);
    }
  });

  it("gives every mote an orthonormal orbit basis so orbits stay circular", () => {
    for (const m of buildEvidenceField(SANDBOX)) {
      expect(m.u.length()).toBeCloseTo(1, 6);
      expect(m.v.length()).toBeCloseTo(1, 6);
      expect(m.u.dot(m.v)).toBeCloseTo(0, 6);
      expect(Number.isFinite(m.radius) && m.radius > 0).toBe(true);
    }
  });

  it("is deterministic for the same payload", () => {
    const a = buildEvidenceField(SANDBOX);
    const b = buildEvidenceField(SANDBOX);
    expect(a.map((m) => [m.owner, m.radius, m.phase, m.speed])).toEqual(
      b.map((m) => [m.owner, m.radius, m.phase, m.speed]),
    );
  });

  it("emits nothing for an empty payload", () => {
    expect(buildEvidenceField([])).toEqual([]);
  });

  it("caps the field so a pathological payload cannot melt the frame budget", () => {
    const huge = Array.from({ length: 400 }, (_, i) =>
      make(`r${i}`, [], "SAFE", 0),
    );
    expect(buildEvidenceField(huge).length).toBeLessThanOrEqual(MAX_MOTES);
  });
});

describe("severityOf", () => {
  it("is the real share of resources Cedar blocked", () => {
    expect(severityOf(SANDBOX)).toBeCloseTo(3 / 8, 6);
  });

  it("is 0 for a clean account and 1 when everything is blocked", () => {
    expect(severityOf([make("a"), make("b")])).toBe(0);
    expect(severityOf([make("a", [], "BLOCKED"), make("b", [], "BLOCKED")])).toBe(1);
  });

  it("is 0 rather than NaN for an empty payload", () => {
    expect(severityOf([])).toBe(0);
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
