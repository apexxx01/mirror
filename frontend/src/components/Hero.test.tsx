import { render, screen, act } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { Hero } from "./Hero";

describe("Hero", () => {
  it("types out the full headline text over time", () => {
    vi.useFakeTimers();
    render(<Hero />);

    act(() => {
      vi.advanceTimersByTime(5000);
    });

    expect(screen.getByTestId("hero-headline").textContent).toContain("this resource looks safe to delete.");
    expect(screen.getByTestId("hero-headline").textContent).toContain("it isn't.");
    vi.useRealTimers();
  });

  it("reveals the headline progressively rather than all at once", () => {
    vi.useFakeTimers();
    render(<Hero />);

    expect(screen.getByTestId("hero-headline").textContent).toBe("");

    act(() => {
      vi.advanceTimersByTime(400);
    });

    const partial = screen.getByTestId("hero-headline").textContent ?? "";
    expect(partial.length).toBeGreaterThan(0);
    expect(partial).not.toContain("it isn't.");
    vi.useRealTimers();
  });

  it("exposes the complete headline to assistive technology immediately", () => {
    vi.useFakeTimers();
    render(<Hero />);

    expect(
      screen.getByRole("heading", { level: 1 }).textContent,
    ).toBe("this resource looks safe to delete. it isn't.");
    vi.useRealTimers();
  });
});
