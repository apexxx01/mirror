export type Verdict = "BLOCKED" | "NEEDS_REVIEW" | "SAFE";

export type NodeType = "s3_bucket" | "dynamodb_table" | "lambda_function" | "eventbridge_rule";

export type ReversibilityLevel = "HIGH" | "MEDIUM" | "LOW";

export interface Reversibility {
  level: ReversibilityLevel;
  reason: string;
}

export type MirrorBadge = "STOP" | "CAUTION" | "CLEAR";

export interface MirrorScore {
  score: number;
  badge: MirrorBadge;
}

export interface FutureDiffSelf {
  before: Record<string, unknown>;
  after: { exists: boolean; note: string };
}

export interface FutureDiffDownstreamEffect {
  dependent: string;
  via: string;
  before: string;
  after: string;
}

export interface FutureDiff {
  resource: string;
  action: string;
  self: FutureDiffSelf;
  downstream: FutureDiffDownstreamEffect[];
}

export interface RollbackPlan {
  available: boolean;
  steps: string[];
  reason: string | null;
}

export interface BlastRadiusEntry {
  resource: string;
  hop: number;
  invocations_90d?: number | null;
}

export interface AdversarialEntry {
  resource: string;
  hop: number;
  errors: number | null;
  throttles: number | null;
}

export interface DecisionMatrixRow {
  scenario: string;
  dependents_count: number;
  risk_score: number;
  verdict: Verdict;
}

export interface MirrorResult {
  resource: string;
  verdict: Verdict;
  dependents: string[];
  risk_score: number;
  node_type: NodeType;
  node_name: string;
  reversibility: Reversibility;
  mirror_score: MirrorScore;
  future_diff: FutureDiff;
  rollback_plan: RollbackPlan;
  cedar_decision: string;
  cedar_reasons: string[];
  blast_radius: BlastRadiusEntry[];
  adversarial: AdversarialEntry[];
  decision_matrix: DecisionMatrixRow[];
}

export interface MirrorPayload {
  generated_at: string;
  bedrock_summary: string | null;
  results: MirrorResult[];
}
