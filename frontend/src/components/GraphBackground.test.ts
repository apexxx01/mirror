import { describe, it, expect } from "vitest";
import {
  buildEvidenceField,
  buildGlyphStream,
  buildLayout,
  buildNebula,
  evidenceCount,
  fibonacciPoint,
  GLYPH_MAX_CHARS,
  hashUnit,
  MAX_CLOUDS,
  MAX_GLYPHS,
  MAX_MOTES,
  severityOf,
  sharedNamePrefix,
  shortenToken,
  verdictShares,
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

describe("verdictShares", () => {
  it("is the real verdict mix, and the three shares total the whole scan", () => {
    const s = verdictShares(SANDBOX);
    expect(s.BLOCKED).toBeCloseTo(3 / 8, 6);
    expect(s.NEEDS_REVIEW).toBeCloseTo(2 / 8, 6);
    expect(s.SAFE).toBeCloseTo(3 / 8, 6);
    expect(s.BLOCKED + s.NEEDS_REVIEW + s.SAFE).toBeCloseTo(1, 6);
  });

  it("gives a verdict with no resources a share of exactly zero", () => {
    // The accretion disk's band widths are these numbers, so a zero here is
    // the guarantee that the disk cannot paint a verdict the scan never
    // returned.
    const s = verdictShares([make("a"), make("b")]);
    expect(s.BLOCKED).toBe(0);
    expect(s.NEEDS_REVIEW).toBe(0);
    expect(s.SAFE).toBe(1);
  });

  it("is all zeroes rather than NaN for an empty payload", () => {
    expect(verdictShares([])).toEqual({ BLOCKED: 0, NEEDS_REVIEW: 0, SAFE: 0 });
  });
});

/**
 * The glyph stream is the one place this scene could most easily start lying —
 * "stream some plausible-looking hex" is the default way to build a techy
 * backdrop. These tests pin the opposite guarantee: every glyph on screen is a
 * substring of something the payload actually carries.
 */
describe("buildGlyphStream — every glyph is a real payload string", () => {
  const rich: MirrorResult[] = [
    makeMirrorResult({
      resource: "lambda:mirror-demo-report-generator",
      node_name: "mirror-demo-report-generator",
      verdict: "BLOCKED",
      risk_score: 96,
      cedar_decision: "Decision.Deny",
      cedar_reasons: ["policy0"],
      blast_radius: [
        { resource: "eventbridge:mirror-demo-report-schedule", hop: 1, invocations_90d: 3 },
        { resource: "s3:mirror-demo-archive-2023", hop: 2 },
      ],
      adversarial: [{ resource: "x", hop: 1, errors: 4, throttles: 0 }],
      future_diff: {
        resource: "lambda:mirror-demo-report-generator",
        action: "delete",
        self: { before: {}, after: { exists: false, note: "" } },
        downstream: [
          { dependent: "d", via: "env_var:REPORTS_BUCKET", before: "b", after: "a" },
        ],
      },
      rollback_plan: { available: true, steps: ["restore the rule"], reason: null },
    }),
    makeMirrorResult({
      resource: "s3:mirror-demo-scratch",
      node_name: "mirror-demo-scratch",
      verdict: "SAFE",
    }),
  ];

  /** Every literal the payload can legitimately contribute a glyph for. */
  const vocabulary = (results: MirrorResult[]): string[] => {
    const out: string[] = [];
    for (const r of results) {
      out.push(r.resource, r.node_name, r.verdict, `risk ${r.risk_score}`, r.cedar_decision);
      out.push(`rev ${r.reversibility.level}`, r.mirror_score.badge);
      out.push(...r.cedar_reasons);
      for (const b of r.blast_radius) {
        out.push(`hop${b.hop} inv ${b.invocations_90d}`, `hop${b.hop} ${b.resource}`);
      }
      for (const a of r.adversarial) out.push(`hop${a.hop} err ${a.errors} thr ${a.throttles}`);
      for (const row of r.decision_matrix) out.push(row.scenario);
      for (const d of r.future_diff.downstream) out.push(`via ${d.via}`);
      out.push(...r.rollback_plan.steps);
    }
    return out;
  };

  it("emits nothing that is not traceable to a field in the payload", () => {
    const prefix = sharedNamePrefix(rich);
    const allowed = new Set(
      vocabulary(rich).flatMap((s) => [
        shortenToken(s),
        shortenToken(prefix ? s.split(prefix).join("") : s),
      ]),
    );
    const glyphs = buildGlyphStream(rich);
    expect(glyphs.length).toBeGreaterThan(0);
    for (const g of glyphs) {
      expect(allowed.has(g.text)).toBe(true);
    }
  });

  it("emits one glyph per real record on top of the per-resource fields", () => {
    // 7 fixed fields (resource, verdict, risk, cedar decision, reversibility,
    // badge) — six of them — plus one per evidence record.
    const expected = rich.reduce((n, r) => n + 6 + evidenceCount(r), 0);
    expect(buildGlyphStream(rich)).toHaveLength(expected);
  });

  it("attributes every glyph to a real resource, verdict and risk", () => {
    for (const g of buildGlyphStream(rich)) {
      expect(g.owner).toBeGreaterThanOrEqual(0);
      expect(g.owner).toBeLessThan(rich.length);
      expect(g.heat).toBeCloseTo(rich[g.owner].risk_score / 100, 6);
      expect(["BLOCKED", "NEEDS_REVIEW", "SAFE"]).toContain(g.verdict);
    }
  });

  it("colours a decision-matrix glyph by that ROW's verdict, not the resource's", () => {
    const row = makeMirrorResult({
      resource: "r",
      node_name: "r",
      verdict: "BLOCKED",
      decision_matrix: [
        { scenario: "if zero dependents", dependents_count: 0, risk_score: 0, verdict: "SAFE" },
      ],
    });
    const glyph = buildGlyphStream([row]).find((g) => g.text === "if zero dependents");
    expect(glyph?.verdict).toBe("SAFE");
  });

  it("puts glyphs on the jet only for resources Cedar actually refused", () => {
    for (const g of buildGlyphStream(rich)) {
      if (g.jet) expect(rich[g.owner].verdict).toBe("BLOCKED");
    }
    expect(buildGlyphStream([make("a"), make("b")]).some((g) => g.jet)).toBe(false);
  });

  it("is deterministic for the same payload", () => {
    const a = buildGlyphStream(rich);
    const b = buildGlyphStream(rich);
    expect(a.map((g) => [g.text, g.owner, g.jet, g.seedA, g.seedB])).toEqual(
      b.map((g) => [g.text, g.owner, g.jet, g.seedA, g.seedB]),
    );
  });

  it("emits nothing for an empty payload", () => {
    expect(buildGlyphStream([])).toEqual([]);
  });

  it("caps the stream so a pathological payload cannot melt the frame budget", () => {
    const huge = Array.from({ length: 400 }, (_, i) => make(`r${i}`));
    expect(buildGlyphStream(huge).length).toBeLessThanOrEqual(MAX_GLYPHS);
  });
});

describe("shortenToken", () => {
  it("leaves a string that already fits exactly as the payload wrote it", () => {
    expect(shortenToken("Decision.Deny")).toBe("Decision.Deny");
  });

  it("marks a truncation rather than silently cutting the string", () => {
    const long = "via env_var:REPORTS_BUCKET_NAME_HERE";
    const out = shortenToken(long);
    expect(out).toHaveLength(GLYPH_MAX_CHARS);
    expect(out.endsWith("…")).toBe(true);
    expect(long.startsWith(out.slice(0, -1))).toBe(true);
  });

  it("collapses whitespace so a multi-line rollback step stays one glyph", () => {
    expect(shortenToken("  restore\n  the rule ")).toBe("restore the rule");
  });
});

describe("sharedNamePrefix", () => {
  it("finds the deployment prefix every scanned resource really shares", () => {
    expect(sharedNamePrefix(SANDBOX.map((r) => r))).toBe("");
    const deployed = [
      make("a"),
      make("b"),
    ].map((r, i) => ({ ...r, node_name: `mirror-demo-${i === 0 ? "scratch" : "archive"}` }));
    expect(sharedNamePrefix(deployed)).toBe("mirror-demo-");
  });

  it("returns nothing when the names share no prefix, so full names are used", () => {
    expect(sharedNamePrefix([make("a"), make("b")])).toBe("");
  });

  it("returns nothing for a single-resource scan — there is nothing to share", () => {
    expect(sharedNamePrefix([make("only-one")])).toBe("");
  });
});

describe("buildNebula", () => {
  it("emits one cloud per scanned resource — no padding", () => {
    const clouds = buildNebula(SANDBOX);
    expect(clouds).toHaveLength(SANDBOX.length);
    expect(clouds.map((c) => c.verdict)).toEqual(SANDBOX.map((r) => r.verdict));
  });

  it("sizes each cloud by how much evidence Mirror really holds on it", () => {
    const thin = makeMirrorResult({ resource: "thin", decision_matrix: [], cedar_reasons: [] });
    const thick = makeMirrorResult({
      resource: "thick",
      cedar_reasons: ["p0", "p1"],
      blast_radius: [{ resource: "x", hop: 1, invocations_90d: 1 }],
      rollback_plan: { available: true, steps: ["a", "b", "c"], reason: null },
    });
    const [a, b] = buildNebula([thin, thick]);
    expect(evidenceCount(thin)).toBeLessThan(evidenceCount(thick));
    expect(a.scale).toBeLessThan(b.scale);
    expect(a.alpha).toBeLessThan(b.alpha);
  });

  it("puts every cloud behind the quasar, never in front of it", () => {
    for (const c of buildNebula(SANDBOX)) expect(c.z).toBeLessThan(0);
  });

  it("is deterministic and emits nothing for an empty payload", () => {
    expect(buildNebula(SANDBOX)).toEqual(buildNebula(SANDBOX));
    expect(buildNebula([])).toEqual([]);
  });

  it("caps the cloud count on an implausibly large account", () => {
    const huge = Array.from({ length: 400 }, (_, i) => make(`r${i}`));
    expect(buildNebula(huge).length).toBeLessThanOrEqual(MAX_CLOUDS);
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
