import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { VerdictRow } from "./VerdictRow";
import { makeMirrorResult } from "../test-utils";

const withDeps = makeMirrorResult({
  resource: "s3:mirror-demo-archive-2023-74391983",
  verdict: "BLOCKED",
  dependents: ["lambda:mirror-demo-report-generator"],
  risk_score: 10,
  node_name: "mirror-demo-archive-2023-74391983",
  reversibility: { level: "LOW", reason: "versioning never enabled — deletes are permanent" },
  mirror_score: { score: 0, badge: "STOP" },
  cedar_decision: "Decision.Deny",
  cedar_reasons: ["policy0"],
  rollback_plan: { available: false, steps: [], reason: "versioning not enabled" },
  future_diff: {
    resource: "s3:mirror-demo-archive-2023-74391983",
    action: "delete",
    self: { before: { exists: true }, after: { exists: false, note: "resource would no longer exist" } },
    downstream: [
      {
        dependent: "lambda:mirror-demo-report-generator",
        via: "env_var:REPORTS_BUCKET",
        before: "resolves to an existing bucket",
        after: "would fail with NoSuchBucket",
      },
    ],
  },
});

const noDeps = makeMirrorResult({
  resource: "s3:mirror-demo-scratch-74391983",
  verdict: "SAFE",
  dependents: [],
  risk_score: 10,
  node_name: "mirror-demo-scratch-74391983",
});

describe("VerdictRow", () => {
  it("shows the real dependents list when expanded and it has dependents", () => {
    render(<VerdictRow result={withDeps} />);
    fireEvent.click(screen.getByTestId("row-toggle"));
    expect(screen.getAllByText("lambda:mirror-demo-report-generator").length).toBeGreaterThan(0);
  });

  it('shows "no real dependents found" when expanded and it has none', () => {
    render(<VerdictRow result={noDeps} />);
    fireEvent.click(screen.getByTestId("row-toggle"));
    expect(screen.getByText("no real dependents found")).toBeInTheDocument();
  });

  it("does not show dependent details before being expanded", () => {
    render(<VerdictRow result={withDeps} />);
    expect(screen.queryByText("lambda:mirror-demo-report-generator")).not.toBeInTheDocument();
  });

  it("shows the raw Cedar decision and reasons when expanded", () => {
    render(<VerdictRow result={withDeps} />);
    fireEvent.click(screen.getByTestId("row-toggle"));
    expect(screen.getByText(/decision: Decision.Deny/)).toBeInTheDocument();
    expect(screen.getByText(/reasons: \[policy0\]/)).toBeInTheDocument();
  });

  it("shows the reversibility and mirror score pills in the closed row", () => {
    render(<VerdictRow result={withDeps} />);
    expect(screen.getByText("STOP")).toBeInTheDocument();
  });

  it("sets aria-expanded to reflect open state", () => {
    render(<VerdictRow result={withDeps} />);
    const toggle = screen.getByTestId("row-toggle");
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
  });
});
