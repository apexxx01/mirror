import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { VerdictPills } from "./VerdictPills";

describe("VerdictPills", () => {
  const counts = { BLOCKED: 3, NEEDS_REVIEW: 1, SAFE: 4 };

  it("calls onChange adding a verdict when an unselected pill is clicked", () => {
    const onChange = vi.fn();
    render(<VerdictPills selected={[]} onChange={onChange} counts={counts} />);
    fireEvent.click(screen.getByTestId("pill-BLOCKED"));
    expect(onChange).toHaveBeenCalledWith(["BLOCKED"]);
  });

  it("calls onChange removing a verdict when a selected pill is clicked again", () => {
    const onChange = vi.fn();
    render(<VerdictPills selected={["BLOCKED", "SAFE"]} onChange={onChange} counts={counts} />);
    fireEvent.click(screen.getByTestId("pill-BLOCKED"));
    expect(onChange).toHaveBeenCalledWith(["SAFE"]);
  });

  it("supports multi-select across multiple clicks", () => {
    const onChange = vi.fn();
    const { rerender } = render(<VerdictPills selected={[]} onChange={onChange} counts={counts} />);
    fireEvent.click(screen.getByTestId("pill-BLOCKED"));
    rerender(<VerdictPills selected={["BLOCKED"]} onChange={onChange} counts={counts} />);
    fireEvent.click(screen.getByTestId("pill-SAFE"));
    expect(onChange).toHaveBeenLastCalledWith(["BLOCKED", "SAFE"]);
  });
});
