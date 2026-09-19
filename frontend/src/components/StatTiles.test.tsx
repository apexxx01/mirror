import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { StatTiles } from "./StatTiles";

describe("StatTiles", () => {
  it("renders the real count for each verdict", () => {
    render(<StatTiles counts={{ BLOCKED: 3, NEEDS_REVIEW: 1, SAFE: 4 }} />);
    expect(screen.getByTestId("stat-BLOCKED")).toHaveTextContent("3");
    expect(screen.getByTestId("stat-NEEDS_REVIEW")).toHaveTextContent("1");
    expect(screen.getByTestId("stat-SAFE")).toHaveTextContent("4");
  });
});
