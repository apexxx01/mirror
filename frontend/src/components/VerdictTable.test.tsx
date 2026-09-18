import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { VerdictTable } from "./VerdictTable";
import type { MirrorResult } from "../types";

const results: MirrorResult[] = [
  {
    resource: "bucket-1",
    verdict: "BLOCKED",
    dependents: ["lambda-a"],
    risk_score: 9,
    node_type: "s3_bucket",
    node_name: "bucket-1",
  },
];

describe("VerdictTable", () => {
  it("renders rows when results match the current filter", () => {
    render(<VerdictTable results={results} />);
    expect(screen.getByText("bucket-1")).toBeInTheDocument();
    expect(screen.queryByTestId("verdict-table-empty")).not.toBeInTheDocument();
  });

  it("renders a designed empty state when a filter excludes every result", () => {
    render(<VerdictTable results={results} />);
    fireEvent.click(screen.getByTestId("pill-SAFE"));
    expect(screen.getByTestId("verdict-table-empty")).toHaveTextContent(
      "no resources match this filter"
    );
    expect(screen.queryByText("bucket-1")).not.toBeInTheDocument();
  });

  it("renders the empty state when there are no results at all", () => {
    render(<VerdictTable results={[]} />);
    expect(screen.getByTestId("verdict-table-empty")).toBeInTheDocument();
  });
});
