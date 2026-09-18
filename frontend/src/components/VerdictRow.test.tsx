import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { VerdictRow } from "./VerdictRow";
import type { MirrorResult } from "../types";

const withDeps: MirrorResult = {
  resource: "s3:mirror-demo-archive-2023-74391983",
  verdict: "BLOCKED",
  dependents: ["lambda:mirror-demo-report-generator"],
  risk_score: 10,
  node_type: "s3_bucket",
  node_name: "mirror-demo-archive-2023-74391983",
};

const noDeps: MirrorResult = {
  resource: "s3:mirror-demo-scratch-74391983",
  verdict: "SAFE",
  dependents: [],
  risk_score: 10,
  node_type: "s3_bucket",
  node_name: "mirror-demo-scratch-74391983",
};

describe("VerdictRow", () => {
  it("shows the real dependents list when expanded and it has dependents", () => {
    render(<VerdictRow result={withDeps} />);
    fireEvent.click(screen.getByTestId("row-toggle"));
    expect(screen.getByText("lambda:mirror-demo-report-generator")).toBeInTheDocument();
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
});
