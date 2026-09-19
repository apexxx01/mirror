import type { MirrorResult } from "./types";

/**
 * Shared test fixture: a complete, valid MirrorResult with sensible
 * defaults for every field the backend now publishes (reversibility,
 * mirror_score, future_diff, rollback_plan, cedar_decision, cedar_reasons).
 * Individual tests override only the fields they care about.
 */
export function makeMirrorResult(overrides: Partial<MirrorResult> = {}): MirrorResult {
  return {
    resource: "s3:mirror-demo-example",
    verdict: "SAFE",
    dependents: [],
    risk_score: 10,
    node_type: "s3_bucket",
    node_name: "mirror-demo-example",
    reversibility: { level: "LOW", reason: "versioning not enabled — no prior object versions exist to restore" },
    mirror_score: { score: 75, badge: "CLEAR" },
    future_diff: {
      resource: "s3:mirror-demo-example",
      action: "delete",
      self: { before: { exists: true }, after: { exists: false, note: "resource would no longer exist after delete" } },
      downstream: [],
    },
    rollback_plan: { available: false, steps: [], reason: "versioning not enabled" },
    cedar_decision: "Decision.Allow",
    cedar_reasons: ["policy1"],
    blast_radius: [],
    adversarial: [],
    decision_matrix: [
      { scenario: "as observed", dependents_count: 0, risk_score: 10, verdict: "SAFE" },
      { scenario: "if zero dependents", dependents_count: 0, risk_score: 10, verdict: "SAFE" },
      { scenario: "if risk score < 50", dependents_count: 0, risk_score: 0, verdict: "SAFE" },
      { scenario: "if both were true", dependents_count: 0, risk_score: 0, verdict: "SAFE" },
    ],
    ...overrides,
  };
}
