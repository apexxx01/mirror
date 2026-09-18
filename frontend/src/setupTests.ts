import "@testing-library/jest-dom/vitest";
import { vi } from "vitest";

// jsdom does not implement IntersectionObserver. motion/react's `whileInView`
// (used by VerdictTable's entrance animations) needs one to mount at all —
// without this stub every `motion.div` in the tree throws during commit and
// React unmounts the whole render, which otherwise only surfaces once
// components are composed together in App.test.tsx.
class MockIntersectionObserver implements IntersectionObserver {
  readonly root: Element | Document | null = null;
  readonly rootMargin: string = "";
  readonly scrollMargin: string = "";
  readonly thresholds: ReadonlyArray<number> = [];
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords(): IntersectionObserverEntry[] {
    return [];
  }
}

vi.stubGlobal("IntersectionObserver", MockIntersectionObserver);
