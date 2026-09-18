export type Verdict = "BLOCKED" | "NEEDS_REVIEW" | "SAFE";

export type NodeType = "s3_bucket" | "dynamodb_table" | "lambda_function" | "eventbridge_rule";

export interface MirrorResult {
  resource: string;
  verdict: Verdict;
  dependents: string[];
  risk_score: number;
  node_type: NodeType;
  node_name: string;
}

export interface MirrorPayload {
  generated_at: string;
  bedrock_summary: string | null;
  results: MirrorResult[];
}
