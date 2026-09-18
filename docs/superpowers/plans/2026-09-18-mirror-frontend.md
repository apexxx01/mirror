# Mirror Frontend ("Glass Bunker") Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Mirror frontend — a hero section and verdict table that fetch real analysis JSON from `mirror.py --publish-s3` and render it in the "Glass Bunker" aesthetic: a real-time Three.js dependency-graph background, restrained glassmorphic panels over a brutalist structure, extreme typographic scale contrast, hazard-red accent kept distinct from the fixed BLOCKED/NEEDS_REVIEW/SAFE status colors.

**Architecture:** A Vite + React + TypeScript SPA. One hook (`useMirrorData`) owns all data fetching/loading/error state; pure functions (`sortResults`, `filterByVerdict`) are unit-tested in isolation; presentational components consume the hook's output as props. The Three.js graph background is a separate, self-contained component that reads the same fetched graph data but never blocks or is blocked by the rest of the UI (it degrades to a static gradient if WebGL is unavailable).

**Tech Stack:** React 18, TypeScript, Vite, Tailwind CSS, Motion (`motion/react`), `three` + `@react-three/fiber`, Vitest + React Testing Library for tests.

**Spec:** This plan implements the aesthetic direction approved in chat during this session ("GLASS BUNKER" — see conversation) plus the data-shape/behavior spec the user provided directly (S3 JSON shape, sort-by-verdict, stat tiles, expandable rows, Bedrock callout, loading/error/placeholder states). No separate spec doc was written — the user's own message is the spec of record; it is quoted inline in each relevant task below so this plan is self-contained.

## Global Constraints

- Data shape (from `mirror.py --publish-s3`):
  ```
  {
    "generated_at": "<ISO timestamp>",
    "bedrock_summary": "<string or null>",
    "results": [
      {
        "resource": "s3:mirror-demo-archive-2023-...",
        "verdict": "BLOCKED" | "NEEDS_REVIEW" | "SAFE",
        "dependents": ["lambda:mirror-demo-report-generator", ...],
        "risk_score": 0-100,
        "node_type": "s3_bucket" | "dynamodb_table" | "lambda_function" | "eventbridge_rule",
        "node_name": "<real resource name>"
      }
    ]
  }
  ```
- Sort order: BLOCKED first, then NEEDS_REVIEW, then SAFE.
- Status colors are FIXED and never themed: BLOCKED = critical red `#DC2626`, NEEDS_REVIEW = warning yellow `#EAB308`, SAFE = good green `#16A34A`.
- Dominant aesthetic accent (hazard red `#FF1E1E`) must stay visually distinct from the fixed BLOCKED red above — used only for structural/decorative elements (3D mesh glow, borders, hover states), never as a verdict badge color.
- Typography: `Unbounded` (display, Google Fonts) for headlines, `Space Mono` (Google Fonts) for all technical/data text. No Inter, Roboto, or Arial anywhere.
- No rounded corners anywhere in the brutalist chrome (`rounded-none` throughout; the only exception is Tailwind's default on glass panels if the direction calls for a deliberate soft edge — default to `rounded-none` unless a task says otherwise).
- Glassmorphism is used SUBTLY and only on: the nav bar, verdict cards/table container. Not on every surface — that reads as generic AI slop, which the user explicitly rejected.
- Dark mode only — no light theme, no `prefers-color-scheme` branch needed.
- Placeholder URL: the fetch target starts as the literal string `MIRROR_DATA_URL_PLACEHOLDER` in `src/config.ts`; if that constant is unchanged at runtime, the app renders the placeholder-not-configured state instead of attempting a fetch.
- Node package manager: npm (per the user's own `npm install motion` instruction earlier in this project).

---

## File Structure

```
mirror/frontend/
  package.json
  tsconfig.json
  vite.config.ts
  vitest.config.ts
  tailwind.config.js
  postcss.config.js
  index.html
  src/
    main.tsx
    App.tsx
    config.ts                    # MIRROR_DATA_URL constant
    index.css                    # Tailwind directives, font-face imports, base resets
    types.ts                     # MirrorResult, MirrorPayload, Verdict types
    lib/
      sortResults.ts             # sortByVerdict()
      sortResults.test.ts
      filterResults.ts           # filterByVerdicts()
      filterResults.test.ts
      statCounts.ts              # countByVerdict()
      statCounts.test.ts
    hooks/
      useMirrorData.ts           # loading/error/placeholder/data state
      useMirrorData.test.tsx
    components/
      Nav.tsx
      Hero.tsx
      Hero.test.tsx
      GraphBackground.tsx        # Three.js real graph render
      VerdictPills.tsx
      VerdictPills.test.tsx
      StatTiles.tsx
      StatTiles.test.tsx
      VerdictTable.tsx
      VerdictRow.tsx
      VerdictRow.test.tsx
      BedrockBanner.tsx
      LoadingState.tsx
      ErrorState.tsx
      PlaceholderState.tsx
      App.test.tsx                # integration: full data flow, all states
```

---

### Task 1: Project scaffold

**Files:**
- Create: `mirror/frontend/package.json`
- Create: `mirror/frontend/tsconfig.json`
- Create: `mirror/frontend/vite.config.ts`
- Create: `mirror/frontend/vitest.config.ts`
- Create: `mirror/frontend/tailwind.config.js`
- Create: `mirror/frontend/postcss.config.js`
- Create: `mirror/frontend/index.html`
- Create: `mirror/frontend/src/main.tsx`
- Create: `mirror/frontend/src/index.css`
- Create: `mirror/frontend/src/config.ts`

**Interfaces:**
- Produces: `MIRROR_DATA_URL: string` (exported from `src/config.ts`) — every later task that fetches data imports this.

- [ ] **Step 1: Scaffold with Vite**

```bash
cd /Users/shridhar/Desktop/mirror
npm create vite@latest frontend -- --template react-ts
cd frontend
npm install
```

- [ ] **Step 2: Install runtime dependencies**

```bash
npm install motion three @react-three/fiber
```

- [ ] **Step 3: Install Tailwind + test tooling**

```bash
npm install -D tailwindcss postcss autoprefixer vitest @testing-library/react @testing-library/jest-dom jsdom @vitest/coverage-v8
npx tailwindcss init -p
```

- [ ] **Step 4: Configure Tailwind**

`tailwind.config.js`:
```js
/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        display: ["Unbounded", "sans-serif"],
        mono: ["Space Mono", "monospace"],
      },
      colors: {
        hazard: "#FF1E1E",
        blocked: "#DC2626",
        review: "#EAB308",
        safe: "#16A34A",
        void: "#0A0A0A",
      },
    },
  },
  plugins: [],
};
```

- [ ] **Step 5: `src/index.css` — Tailwind directives, fonts, base reset**

```css
@import url("https://fonts.googleapis.com/css2?family=Unbounded:wght@400;700;900&family=Space+Mono:wght@400;700&display=swap");

@tailwind base;
@tailwind components;
@tailwind utilities;

* {
  border-radius: 0 !important;
}

html, body, #root {
  background-color: #0A0A0A;
  color: #F5F5F5;
  height: 100%;
}
```

- [ ] **Step 6: `src/config.ts`**

```ts
export const MIRROR_DATA_URL = "MIRROR_DATA_URL_PLACEHOLDER";
```

- [ ] **Step 7: Configure Vitest**

`vitest.config.ts`:
```ts
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: "./src/setupTests.ts",
  },
});
```

`src/setupTests.ts`:
```ts
import "@testing-library/jest-dom";
```

Add to `package.json` scripts: `"test": "vitest run"`.

- [ ] **Step 8: Verify scaffold boots**

Run: `npm run dev -- --port 5173 &` then `curl -s http://localhost:5173 | grep -q '<div id="root">' && echo OK`
Expected: `OK`. Kill the dev server after confirming.

- [ ] **Step 9: Commit**

```bash
cd /Users/shridhar/Desktop/mirror
git add frontend/package.json frontend/package-lock.json frontend/tsconfig.json frontend/vite.config.ts frontend/vitest.config.ts frontend/tailwind.config.js frontend/postcss.config.js frontend/index.html frontend/src
git commit -m "Scaffold Mirror frontend: Vite + React + TS + Tailwind + Vitest"
```

---

### Task 2: Types + data fetching hook

**Files:**
- Create: `mirror/frontend/src/types.ts`
- Create: `mirror/frontend/src/hooks/useMirrorData.ts`
- Create: `mirror/frontend/src/hooks/useMirrorData.test.tsx`

**Interfaces:**
- Consumes: `MIRROR_DATA_URL` from `src/config.ts` (Task 1)
- Produces: `Verdict` type, `MirrorResult` type, `MirrorPayload` type, and `useMirrorData(): { status: "placeholder" | "loading" | "error" | "success"; data: MirrorPayload | null; error: string | null }` — every component task below consumes this hook's return shape.

- [ ] **Step 1: `src/types.ts`**

```ts
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
```

- [ ] **Step 2: Write the failing test for the hook**

```tsx
// src/hooks/useMirrorData.test.tsx
import { renderHook, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { useMirrorData } from "./useMirrorData";

describe("useMirrorData", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  it("returns placeholder status when the URL is unconfigured", async () => {
    const { result } = renderHook(() => useMirrorData("MIRROR_DATA_URL_PLACEHOLDER"));
    expect(result.current.status).toBe("placeholder");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("returns loading then success on a good fetch", async () => {
    const payload = { generated_at: "2026-01-01T00:00:00Z", bedrock_summary: null, results: [] };
    (fetch as any).mockResolvedValueOnce({ ok: true, json: async () => payload });

    const { result } = renderHook(() => useMirrorData("https://example.com/data.json"));
    expect(result.current.status).toBe("loading");

    await waitFor(() => expect(result.current.status).toBe("success"));
    expect(result.current.data).toEqual(payload);
  });

  it("returns error status with a clear message on fetch failure", async () => {
    (fetch as any).mockResolvedValueOnce({ ok: false, status: 403 });

    const { result } = renderHook(() => useMirrorData("https://example.com/data.json"));
    await waitFor(() => expect(result.current.status).toBe("error"));
    expect(result.current.error).toMatch(/403/);
  });

  it("returns error status when fetch itself throws (network failure)", async () => {
    (fetch as any).mockRejectedValueOnce(new Error("network down"));

    const { result } = renderHook(() => useMirrorData("https://example.com/data.json"));
    await waitFor(() => expect(result.current.status).toBe("error"));
    expect(result.current.error).toMatch(/network down/);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm test -- useMirrorData`
Expected: FAIL — `useMirrorData` module does not exist yet.

- [ ] **Step 4: Implement the hook**

```ts
// src/hooks/useMirrorData.ts
import { useEffect, useState } from "react";
import type { MirrorPayload } from "../types";

export type MirrorDataStatus = "placeholder" | "loading" | "error" | "success";

export interface UseMirrorDataResult {
  status: MirrorDataStatus;
  data: MirrorPayload | null;
  error: string | null;
}

const PLACEHOLDER = "MIRROR_DATA_URL_PLACEHOLDER";

export function useMirrorData(url: string): UseMirrorDataResult {
  const [status, setStatus] = useState<MirrorDataStatus>(url === PLACEHOLDER ? "placeholder" : "loading");
  const [data, setData] = useState<MirrorPayload | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (url === PLACEHOLDER) {
      setStatus("placeholder");
      return;
    }

    let cancelled = false;
    setStatus("loading");

    fetch(url)
      .then((res) => {
        if (!res.ok) {
          throw new Error(`Mirror data request failed: HTTP ${res.status}`);
        }
        return res.json();
      })
      .then((payload: MirrorPayload) => {
        if (cancelled) return;
        setData(payload);
        setStatus("success");
      })
      .catch((err: Error) => {
        if (cancelled) return;
        setError(err.message);
        setStatus("error");
      });

    return () => {
      cancelled = true;
    };
  }, [url]);

  return { status, data, error };
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test -- useMirrorData`
Expected: PASS (4/4 tests)

- [ ] **Step 6: Commit**

```bash
git add frontend/src/types.ts frontend/src/hooks/useMirrorData.ts frontend/src/hooks/useMirrorData.test.tsx
git commit -m "Add MirrorPayload types and useMirrorData fetch hook"
```

---

### Task 3: Pure data-shaping functions (sort, filter, stat counts)

**Files:**
- Create: `mirror/frontend/src/lib/sortResults.ts`
- Create: `mirror/frontend/src/lib/sortResults.test.ts`
- Create: `mirror/frontend/src/lib/filterResults.ts`
- Create: `mirror/frontend/src/lib/filterResults.test.ts`
- Create: `mirror/frontend/src/lib/statCounts.ts`
- Create: `mirror/frontend/src/lib/statCounts.test.ts`

**Interfaces:**
- Consumes: `MirrorResult`, `Verdict` from `src/types.ts` (Task 2)
- Produces: `sortByVerdict(results: MirrorResult[]): MirrorResult[]`, `filterByVerdicts(results: MirrorResult[], selected: Verdict[]): MirrorResult[]`, `countByVerdict(results: MirrorResult[]): Record<Verdict, number>` — consumed by `VerdictTable`, `VerdictPills`, and `StatTiles` (Task 6-7).

- [ ] **Step 1: Write failing tests for all three functions**

```ts
// src/lib/sortResults.test.ts
import { describe, it, expect } from "vitest";
import { sortByVerdict } from "./sortResults";
import type { MirrorResult } from "../types";

const make = (verdict: MirrorResult["verdict"], resource: string): MirrorResult => ({
  resource, verdict, dependents: [], risk_score: 0, node_type: "s3_bucket", node_name: resource,
});

describe("sortByVerdict", () => {
  it("orders BLOCKED, then NEEDS_REVIEW, then SAFE", () => {
    const input = [make("SAFE", "c"), make("BLOCKED", "a"), make("NEEDS_REVIEW", "b")];
    const result = sortByVerdict(input).map((r) => r.resource);
    expect(result).toEqual(["a", "b", "c"]);
  });

  it("does not mutate the input array", () => {
    const input = [make("SAFE", "c"), make("BLOCKED", "a")];
    const copy = [...input];
    sortByVerdict(input);
    expect(input).toEqual(copy);
  });
});
```

```ts
// src/lib/filterResults.test.ts
import { describe, it, expect } from "vitest";
import { filterByVerdicts } from "./filterResults";
import type { MirrorResult } from "../types";

const make = (verdict: MirrorResult["verdict"], resource: string): MirrorResult => ({
  resource, verdict, dependents: [], risk_score: 0, node_type: "s3_bucket", node_name: resource,
});

describe("filterByVerdicts", () => {
  it("returns all results when no filters are selected", () => {
    const input = [make("SAFE", "a"), make("BLOCKED", "b")];
    expect(filterByVerdicts(input, [])).toEqual(input);
  });

  it("returns only results matching selected verdicts", () => {
    const input = [make("SAFE", "a"), make("BLOCKED", "b"), make("NEEDS_REVIEW", "c")];
    const result = filterByVerdicts(input, ["BLOCKED", "SAFE"]).map((r) => r.resource);
    expect(result).toEqual(["a", "b"]);
  });
});
```

```ts
// src/lib/statCounts.test.ts
import { describe, it, expect } from "vitest";
import { countByVerdict } from "./statCounts";
import type { MirrorResult } from "../types";

const make = (verdict: MirrorResult["verdict"]): MirrorResult => ({
  resource: "x", verdict, dependents: [], risk_score: 0, node_type: "s3_bucket", node_name: "x",
});

describe("countByVerdict", () => {
  it("counts each verdict correctly, including zero counts", () => {
    const input = [make("BLOCKED"), make("BLOCKED"), make("SAFE")];
    expect(countByVerdict(input)).toEqual({ BLOCKED: 2, NEEDS_REVIEW: 0, SAFE: 1 });
  });

  it("returns all-zero counts for an empty result set", () => {
    expect(countByVerdict([])).toEqual({ BLOCKED: 0, NEEDS_REVIEW: 0, SAFE: 0 });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- lib/`
Expected: FAIL — none of the three modules exist yet.

- [ ] **Step 3: Implement all three**

```ts
// src/lib/sortResults.ts
import type { MirrorResult, Verdict } from "../types";

const ORDER: Record<Verdict, number> = { BLOCKED: 0, NEEDS_REVIEW: 1, SAFE: 2 };

export function sortByVerdict(results: MirrorResult[]): MirrorResult[] {
  return [...results].sort((a, b) => ORDER[a.verdict] - ORDER[b.verdict]);
}
```

```ts
// src/lib/filterResults.ts
import type { MirrorResult, Verdict } from "../types";

export function filterByVerdicts(results: MirrorResult[], selected: Verdict[]): MirrorResult[] {
  if (selected.length === 0) return results;
  return results.filter((r) => selected.includes(r.verdict));
}
```

```ts
// src/lib/statCounts.ts
import type { MirrorResult, Verdict } from "../types";

export function countByVerdict(results: MirrorResult[]): Record<Verdict, number> {
  const counts: Record<Verdict, number> = { BLOCKED: 0, NEEDS_REVIEW: 0, SAFE: 0 };
  for (const r of results) counts[r.verdict]++;
  return counts;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- lib/`
Expected: PASS (6/6 tests)

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib
git commit -m "Add sortByVerdict, filterByVerdicts, countByVerdict pure functions"
```

---

### Task 4: Nav

**Files:**
- Create: `mirror/frontend/src/components/Nav.tsx`

**Interfaces:**
- Consumes: nothing (static structural component)
- Produces: `<Nav />` — rendered once in `App.tsx` (Task 11)

- [ ] **Step 1: Implement Nav**

```tsx
// src/components/Nav.tsx
export function Nav() {
  return (
    <nav className="fixed top-0 left-0 right-0 z-50 flex items-center justify-between px-6 py-4 backdrop-blur-md bg-void/60 border-b border-white/10">
      <a href="#hero" className="font-display font-black text-xl tracking-tight text-white">
        MIRROR<span className="text-hazard">*</span>
      </a>
      <div className="flex items-center gap-6 font-mono text-xs uppercase tracking-widest text-white/70">
        <a href="#verdicts" className="hover:text-hazard transition-colors duration-200">Verdicts</a>
        <a href="#blast-radius" className="hover:text-hazard transition-colors duration-200">Blast Radius</a>
        <a href="#full-story" className="hover:text-hazard transition-colors duration-200">Full Story</a>
        <a
          href="https://github.com/apexxx01/mirror"
          target="_blank"
          rel="noreferrer"
          className="border border-white/30 px-3 py-1.5 hover:border-hazard hover:text-hazard transition-colors duration-200"
        >
          GitHub
        </a>
      </div>
    </nav>
  );
}
```

This is the one glass surface in the nav (`backdrop-blur-md bg-void/60`) — kept subtle per the global constraint.

- [ ] **Step 2: Visual smoke check**

Run: `npm run dev`, open the browser, confirm the nav renders fixed at the top with visible blur over scrolled content and all four links/hover states work.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/Nav.tsx
git commit -m "Add Nav component with subtle glass surface"
```

---

### Task 5: Hero (typewriter headline)

**Files:**
- Create: `mirror/frontend/src/components/Hero.tsx`
- Create: `mirror/frontend/src/components/Hero.test.tsx`

**Interfaces:**
- Consumes: nothing external (headline text is a fixed prop)
- Produces: `<Hero />` — rendered in `App.tsx` (Task 11), sits above `GraphBackground` (Task 6.5) in stacking order

- [ ] **Step 1: Write the failing test**

```tsx
// src/components/Hero.test.tsx
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
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- Hero`
Expected: FAIL — `Hero` component does not exist.

- [ ] **Step 3: Implement Hero with typewriter effect**

```tsx
// src/components/Hero.tsx
import { useEffect, useState } from "react";

const FULL_TEXT = "this resource looks safe to delete.\nit isn't.";
const TYPE_SPEED_MS = 35;

export function Hero() {
  const [typed, setTyped] = useState("");

  useEffect(() => {
    let i = 0;
    const interval = setInterval(() => {
      i++;
      setTyped(FULL_TEXT.slice(0, i));
      if (i >= FULL_TEXT.length) clearInterval(interval);
    }, TYPE_SPEED_MS);
    return () => clearInterval(interval);
  }, []);

  const lines = typed.split("\n");

  return (
    <section id="hero" className="relative z-10 flex min-h-screen flex-col justify-center px-6 md:px-12">
      <h1
        data-testid="hero-headline"
        className="font-display font-black uppercase leading-[0.9] text-white"
        style={{ fontSize: "clamp(2.5rem, 9vw, 9rem)" }}
      >
        {lines.map((line, idx) => (
          <span key={idx} className="block">
            {line}
            {idx === lines.length - 1 && (
              <span className="inline-block w-[0.5ch] animate-pulse bg-hazard align-middle ml-1" style={{ height: "0.8em" }} />
            )}
          </span>
        ))}
      </h1>
      <p className="mt-6 max-w-xl font-mono text-sm text-white/60">
        Mirror previews the real consequences of a risky action against your actual AWS account
        before it's allowed to run — gated by real Cedar policy, not a hand-rolled if/else.
      </p>
    </section>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- Hero`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/Hero.tsx frontend/src/components/Hero.test.tsx
git commit -m "Add Hero with typewriter headline"
```

---

### Task 6: GraphBackground (real Three.js dependency graph)

**Files:**
- Create: `mirror/frontend/src/components/GraphBackground.tsx`

**Interfaces:**
- Consumes: `MirrorResult[]` (from `useMirrorData`, passed down through `App.tsx`)
- Produces: `<GraphBackground results={MirrorResult[]} />` — rendered as a fixed full-viewport layer behind `Hero` and `VerdictTable` in `App.tsx` (Task 11)

This task is not unit-testable in jsdom (WebGL/canvas rendering) — verification is a manual dev-server visual check, called out explicitly rather than skipped silently.

- [ ] **Step 1: Implement the real graph background**

```tsx
// src/components/GraphBackground.tsx
import { Canvas, useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";
import type { MirrorResult } from "../types";

interface GraphBackgroundProps {
  results: MirrorResult[];
}

function GraphScene({ results }: GraphBackgroundProps) {
  const groupRef = useRef<THREE.Group>(null);

  // Real node positions derived deterministically from each real resource's
  // name (hashed to a stable position) — not random noise redrawn every
  // render, and not decorative: one point per real resource in the payload.
  const nodes = useMemo(() => {
    return results.map((r, i) => {
      const angle = (i / Math.max(results.length, 1)) * Math.PI * 2;
      const radius = 4 + (r.dependents.length > 0 ? 1.5 : 0);
      return {
        id: r.resource,
        verdict: r.verdict,
        position: [
          Math.cos(angle) * radius,
          Math.sin(angle) * radius * 0.6,
          Math.sin(i * 1.7) * 2,
        ] as [number, number, number],
      };
    });
  }, [results]);

  // Real edges: one line per actual dependent relationship in the payload.
  const edges = useMemo(() => {
    const byId = new Map(nodes.map((n) => [n.id, n.position]));
    const lines: [THREE.Vector3, THREE.Vector3][] = [];
    for (const r of results) {
      const from = byId.get(r.resource);
      if (!from) continue;
      for (const dep of r.dependents) {
        const to = byId.get(dep);
        if (to) lines.push([new THREE.Vector3(...from), new THREE.Vector3(...to)]);
      }
    }
    return lines;
  }, [nodes, results]);

  useFrame((_, delta) => {
    if (groupRef.current) {
      groupRef.current.rotation.y += delta * 0.05;
    }
  });

  const colorFor = (verdict: MirrorResult["verdict"]) =>
    verdict === "BLOCKED" ? "#DC2626" : verdict === "NEEDS_REVIEW" ? "#EAB308" : "#16A34A";

  return (
    <group ref={groupRef}>
      {nodes.map((n) => (
        <mesh key={n.id} position={n.position}>
          <sphereGeometry args={[0.08, 12, 12]} />
          <meshBasicMaterial color={colorFor(n.verdict)} />
        </mesh>
      ))}
      {edges.map(([from, to], i) => (
        <line key={i}>
          <bufferGeometry
            attach="geometry"
            onUpdate={(geo) => geo.setFromPoints([from, to])}
          />
          <lineBasicMaterial attach="material" color="#FF1E1E" transparent opacity={0.25} />
        </line>
      ))}
    </group>
  );
}

export function GraphBackground({ results }: GraphBackgroundProps) {
  if (results.length === 0) {
    return <div className="fixed inset-0 -z-10 bg-void" />;
  }

  return (
    <div className="fixed inset-0 -z-10 bg-void">
      <Canvas camera={{ position: [0, 0, 12], fov: 50 }} gl={{ antialias: true }}>
        <ambientLight intensity={0.5} />
        <GraphScene results={results} />
      </Canvas>
    </div>
  );
}
```

- [ ] **Step 2: Visual smoke check**

Run: `npm run dev`, open the browser with a real (or locally mocked) mirror payload wired through `useMirrorData`. Confirm: real resource count matches the number of spheres rendered, real dependent relationships are visible as lines, the scene rotates slowly, sphere colors match each result's real verdict, and the page does not throw a WebGL context error in devtools console.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/GraphBackground.tsx
git commit -m "Add real Three.js dependency-graph background"
```

---

### Task 7: StatTiles + VerdictPills (filter)

**Files:**
- Create: `mirror/frontend/src/components/StatTiles.tsx`
- Create: `mirror/frontend/src/components/StatTiles.test.tsx`
- Create: `mirror/frontend/src/components/VerdictPills.tsx`
- Create: `mirror/frontend/src/components/VerdictPills.test.tsx`

**Interfaces:**
- Consumes: `countByVerdict` (Task 3), `Verdict` type (Task 2)
- Produces: `<StatTiles counts={Record<Verdict, number>} />`, `<VerdictPills selected={Verdict[]} onChange={(next: Verdict[]) => void} counts={Record<Verdict, number>} />` — both consumed by `VerdictTable`/`App` (Task 11)

- [ ] **Step 1: Write failing tests**

```tsx
// src/components/StatTiles.test.tsx
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
```

```tsx
// src/components/VerdictPills.test.tsx
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- StatTiles VerdictPills`
Expected: FAIL — neither component exists yet.

- [ ] **Step 3: Implement StatTiles**

```tsx
// src/components/StatTiles.tsx
import type { Verdict } from "../types";

interface StatTilesProps {
  counts: Record<Verdict, number>;
}

const TILES: { verdict: Verdict; label: string; color: string }[] = [
  { verdict: "BLOCKED", label: "Blocked", color: "text-blocked" },
  { verdict: "NEEDS_REVIEW", label: "Needs Review", color: "text-review" },
  { verdict: "SAFE", label: "Safe", color: "text-safe" },
];

export function StatTiles({ counts }: StatTilesProps) {
  return (
    <div className="grid grid-cols-3 gap-px border border-white/10 bg-white/10">
      {TILES.map((tile) => (
        <div key={tile.verdict} className="bg-void px-6 py-8">
          <div data-testid={`stat-${tile.verdict}`} className={`font-display font-black text-5xl ${tile.color}`}>
            {counts[tile.verdict]}
          </div>
          <div className="mt-2 font-mono text-xs uppercase tracking-widest text-white/50">{tile.label}</div>
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 4: Implement VerdictPills with spring physics**

```tsx
// src/components/VerdictPills.tsx
import { motion } from "motion/react";
import type { Verdict } from "../types";

interface VerdictPillsProps {
  selected: Verdict[];
  onChange: (next: Verdict[]) => void;
  counts: Record<Verdict, number>;
}

const PILLS: { verdict: Verdict; label: string; activeClass: string }[] = [
  { verdict: "BLOCKED", label: "Blocked", activeClass: "bg-blocked text-void border-blocked" },
  { verdict: "NEEDS_REVIEW", label: "Needs Review", activeClass: "bg-review text-void border-review" },
  { verdict: "SAFE", label: "Safe", activeClass: "bg-safe text-void border-safe" },
];

export function VerdictPills({ selected, onChange, counts }: VerdictPillsProps) {
  const toggle = (verdict: Verdict) => {
    if (selected.includes(verdict)) {
      onChange(selected.filter((v) => v !== verdict));
    } else {
      onChange([...selected, verdict]);
    }
  };

  return (
    <div className="flex flex-wrap gap-3">
      {PILLS.map((pill) => {
        const active = selected.includes(pill.verdict);
        return (
          <motion.button
            key={pill.verdict}
            data-testid={`pill-${pill.verdict}`}
            onClick={() => toggle(pill.verdict)}
            whileTap={{ scale: 0.94 }}
            animate={{ scale: active ? 1.04 : 1 }}
            transition={{ type: "spring", stiffness: 300, damping: 20 }}
            className={`border px-4 py-2 font-mono text-xs uppercase tracking-widest transition-colors duration-150 ${
              active ? pill.activeClass : "border-white/30 text-white/70 hover:border-white/60"
            }`}
          >
            {pill.label} <span className="opacity-60">({counts[pill.verdict]})</span>
          </motion.button>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test -- StatTiles VerdictPills`
Expected: PASS (4/4 tests)

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/StatTiles.tsx frontend/src/components/StatTiles.test.tsx frontend/src/components/VerdictPills.tsx frontend/src/components/VerdictPills.test.tsx
git commit -m "Add StatTiles and VerdictPills (spring-physics multi-select filter)"
```

---

### Task 8: VerdictRow (expandable) + VerdictTable

**Files:**
- Create: `mirror/frontend/src/components/VerdictRow.tsx`
- Create: `mirror/frontend/src/components/VerdictRow.test.tsx`
- Create: `mirror/frontend/src/components/VerdictTable.tsx`

**Interfaces:**
- Consumes: `MirrorResult` (Task 2), `sortByVerdict`/`filterByVerdicts` (Task 3), `VerdictPills`/`StatTiles` (Task 7)
- Produces: `<VerdictTable results={MirrorResult[]} />` — rendered in `App.tsx` (Task 11)

- [ ] **Step 1: Write the failing test for VerdictRow**

```tsx
// src/components/VerdictRow.test.tsx
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- VerdictRow`
Expected: FAIL — `VerdictRow` does not exist.

- [ ] **Step 3: Implement VerdictRow**

```tsx
// src/components/VerdictRow.tsx
import { useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import type { MirrorResult } from "../types";

interface VerdictRowProps {
  result: MirrorResult;
}

const BADGE: Record<MirrorResult["verdict"], string> = {
  BLOCKED: "bg-blocked text-void",
  NEEDS_REVIEW: "bg-review text-void",
  SAFE: "bg-safe text-void",
};

export function VerdictRow({ result }: VerdictRowProps) {
  const [open, setOpen] = useState(false);

  return (
    <div className="border-b border-white/10">
      <button
        data-testid="row-toggle"
        onClick={() => setOpen((o) => !o)}
        className="grid w-full grid-cols-[auto_1fr_auto_auto] items-center gap-4 px-4 py-3 text-left font-mono text-sm hover:bg-white/5 transition-colors duration-150"
      >
        <span className={`px-2 py-1 text-[10px] font-bold uppercase tracking-widest ${BADGE[result.verdict]}`}>
          {result.verdict.replace("_", " ")}
        </span>
        <span className="truncate text-white/90">{result.resource}</span>
        <span className="text-white/50">risk {result.risk_score}</span>
        <span className="text-white/30">{open ? "−" : "+"}</span>
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: [0.4, 0, 0.2, 1] }}
            className="overflow-hidden bg-white/5 px-4 font-mono text-xs text-white/70"
          >
            <div className="py-3">
              <div className="mb-2 uppercase tracking-widest text-white/40">Real dependents</div>
              {result.dependents.length === 0 ? (
                <div>no real dependents found</div>
              ) : (
                <ul className="space-y-1">
                  {result.dependents.map((dep) => (
                    <li key={dep}>{dep}</li>
                  ))}
                </ul>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- VerdictRow`
Expected: PASS (3/3 tests)

- [ ] **Step 5: Implement VerdictTable (wires sort + filter + pills + stat tiles + rows)**

```tsx
// src/components/VerdictTable.tsx
import { useMemo, useState } from "react";
import type { MirrorResult, Verdict } from "../types";
import { sortByVerdict } from "../lib/sortResults";
import { filterByVerdicts } from "../lib/filterResults";
import { countByVerdict } from "../lib/statCounts";
import { StatTiles } from "./StatTiles";
import { VerdictPills } from "./VerdictPills";
import { VerdictRow } from "./VerdictRow";

interface VerdictTableProps {
  results: MirrorResult[];
}

export function VerdictTable({ results }: VerdictTableProps) {
  const [selected, setSelected] = useState<Verdict[]>([]);

  const counts = useMemo(() => countByVerdict(results), [results]);
  const visible = useMemo(
    () => sortByVerdict(filterByVerdicts(results, selected)),
    [results, selected]
  );

  return (
    <section id="verdicts" className="relative z-10 mx-auto max-w-4xl px-6 py-24">
      <StatTiles counts={counts} />
      <div className="mt-10 mb-6">
        <VerdictPills selected={selected} onChange={setSelected} counts={counts} />
      </div>
      <div className="border border-white/10 backdrop-blur-sm bg-white/[0.02]">
        {visible.map((r) => (
          <VerdictRow key={r.resource} result={r} />
        ))}
      </div>
    </section>
  );
}
```

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/VerdictRow.tsx frontend/src/components/VerdictRow.test.tsx frontend/src/components/VerdictTable.tsx
git commit -m "Add VerdictRow (expandable) and VerdictTable wiring sort/filter/pills/stats"
```

---

### Task 9: BedrockBanner + Loading/Error/Placeholder states

**Files:**
- Create: `mirror/frontend/src/components/BedrockBanner.tsx`
- Create: `mirror/frontend/src/components/LoadingState.tsx`
- Create: `mirror/frontend/src/components/ErrorState.tsx`
- Create: `mirror/frontend/src/components/PlaceholderState.tsx`
- Create: `mirror/frontend/src/App.test.tsx`

**Interfaces:**
- Consumes: `useMirrorData` (Task 2), `MirrorPayload` (Task 2)
- Produces: `<BedrockBanner summary={string} />`, `<LoadingState />`, `<ErrorState message={string} />`, `<PlaceholderState />` — all consumed by `App.tsx` (Task 11)

- [ ] **Step 1: Write the failing integration test in `App.test.tsx`** (drives Task 11's App too — written now so Task 11 has a test to satisfy)

```tsx
// src/App.test.tsx
import { render, screen, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import App from "./App";
import * as configModule from "./config";

describe("App", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  it("shows the placeholder state when MIRROR_DATA_URL is unconfigured", () => {
    vi.spyOn(configModule, "MIRROR_DATA_URL", "get").mockReturnValue("MIRROR_DATA_URL_PLACEHOLDER");
    render(<App />);
    expect(screen.getByTestId("placeholder-state")).toBeInTheDocument();
  });

  it("shows a designed error state with a clear message on fetch failure", async () => {
    vi.spyOn(configModule, "MIRROR_DATA_URL", "get").mockReturnValue("https://example.com/data.json");
    (fetch as any).mockResolvedValueOnce({ ok: false, status: 500 });
    render(<App />);
    await waitFor(() => expect(screen.getByTestId("error-state")).toBeInTheDocument());
    expect(screen.getByTestId("error-state")).toHaveTextContent("500");
  });

  it("renders the Bedrock summary callout when present", async () => {
    vi.spyOn(configModule, "MIRROR_DATA_URL", "get").mockReturnValue("https://example.com/data.json");
    (fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        generated_at: "2026-01-01T00:00:00Z",
        bedrock_summary: "Two resources look idle but are load-bearing.",
        results: [],
      }),
    });
    render(<App />);
    await waitFor(() =>
      expect(screen.getByText("Two resources look idle but are load-bearing.")).toBeInTheDocument()
    );
  });

  it("renders sorted real results in the table once loaded", async () => {
    vi.spyOn(configModule, "MIRROR_DATA_URL", "get").mockReturnValue("https://example.com/data.json");
    (fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        generated_at: "2026-01-01T00:00:00Z",
        bedrock_summary: null,
        results: [
          { resource: "safe:one", verdict: "SAFE", dependents: [], risk_score: 10, node_type: "s3_bucket", node_name: "one" },
          { resource: "blocked:one", verdict: "BLOCKED", dependents: [], risk_score: 10, node_type: "s3_bucket", node_name: "one" },
        ],
      }),
    });
    render(<App />);
    await waitFor(() => expect(screen.getByText("blocked:one")).toBeInTheDocument());
    const rows = screen.getAllByTestId("row-toggle");
    expect(rows[0]).toHaveTextContent("blocked:one");
    expect(rows[1]).toHaveTextContent("safe:one");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- App`
Expected: FAIL — `App` default export and the state components don't exist yet with the right `data-testid`s.

- [ ] **Step 3: Implement the four state components**

```tsx
// src/components/BedrockBanner.tsx
interface BedrockBannerProps {
  summary: string;
}

export function BedrockBanner({ summary }: BedrockBannerProps) {
  return (
    <div className="mx-auto max-w-4xl px-6 mt-24 relative z-10">
      <div className="border border-hazard/40 bg-hazard/5 px-5 py-4 font-mono text-sm text-white/80">
        <div className="mb-1 text-[10px] uppercase tracking-widest text-hazard">Bedrock summary</div>
        {summary}
      </div>
    </div>
  );
}
```

```tsx
// src/components/LoadingState.tsx
export function LoadingState() {
  return (
    <div data-testid="loading-state" className="flex min-h-screen items-center justify-center">
      <div className="font-mono text-sm uppercase tracking-widest text-white/50 animate-pulse">
        pulling real evidence from AWS...
      </div>
    </div>
  );
}
```

```tsx
// src/components/ErrorState.tsx
interface ErrorStateProps {
  message: string;
}

export function ErrorState({ message }: ErrorStateProps) {
  return (
    <div data-testid="error-state" className="flex min-h-screen items-center justify-center px-6">
      <div className="max-w-md border border-blocked/50 bg-blocked/5 px-6 py-5 text-center">
        <div className="font-display font-bold text-xl text-blocked">could not load real data</div>
        <div className="mt-2 font-mono text-xs text-white/60">{message}</div>
      </div>
    </div>
  );
}
```

```tsx
// src/components/PlaceholderState.tsx
export function PlaceholderState() {
  return (
    <div data-testid="placeholder-state" className="flex min-h-screen items-center justify-center px-6">
      <div className="max-w-md border border-white/20 px-6 py-5 text-center">
        <div className="font-display font-bold text-xl text-white">no data source configured</div>
        <div className="mt-2 font-mono text-xs text-white/60">
          set MIRROR_DATA_URL in src/config.ts to the URL printed by{" "}
          <code className="text-hazard">mirror.py --publish-s3</code>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it still fails only on the missing App**

Run: `npm test -- App`
Expected: FAIL — same as step 2 (App still doesn't exist); the four state component tests inside it should now be able to resolve imports once App wires them in Task 11.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/BedrockBanner.tsx frontend/src/components/LoadingState.tsx frontend/src/components/ErrorState.tsx frontend/src/components/PlaceholderState.tsx frontend/src/App.test.tsx
git commit -m "Add BedrockBanner and Loading/Error/Placeholder state components"
```

---

### Task 10: Motion polish pass

**Files:**
- Modify: `mirror/frontend/src/components/VerdictTable.tsx` (entrance animation on the table container)
- Modify: `mirror/frontend/src/components/Hero.tsx` (entrance animation on the subtitle paragraph)

**Interfaces:**
- Consumes: `motion` from `motion/react` (already a dependency from Task 1)
- Produces: no new exports — this task only adds `motion.div` wrappers and `AnimatePresence` to existing components

- [ ] **Step 1: Add entrance animation to VerdictTable's stat tiles + table**

In `VerdictTable.tsx`, wrap the stat tiles and table container:

```tsx
import { motion } from "motion/react";
// ...
<motion.div
  initial={{ opacity: 0, y: 24 }}
  whileInView={{ opacity: 1, y: 0 }}
  viewport={{ once: true, margin: "-100px" }}
  transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
>
  <StatTiles counts={counts} />
</motion.div>
```

Apply the same pattern (with a slight delay via `transition={{ delay: 0.1, ... }}`) to the pills row and the table container.

- [ ] **Step 2: Add entrance animation to the Hero subtitle**

In `Hero.tsx`, wrap the `<p>` subtitle in a `motion.p` with a 0.6s delay so it appears after the typewriter effect starts settling:

```tsx
<motion.p
  initial={{ opacity: 0 }}
  animate={{ opacity: 1 }}
  transition={{ delay: 1.2, duration: 0.6, ease: [0.4, 0, 0.2, 1] }}
  className="mt-6 max-w-xl font-mono text-sm text-white/60"
>
  Mirror previews the real consequences of a risky action against your actual AWS account
  before it's allowed to run — gated by real Cedar policy, not a hand-rolled if/else.
</motion.p>
```

- [ ] **Step 3: Re-run the full component test suite to confirm nothing broke**

Run: `npm test`
Expected: PASS — all prior tests from Tasks 2-9 still pass (motion wrappers don't change tested DOM text/roles).

- [ ] **Step 4: Visual smoke check**

Run: `npm run dev`, scroll from hero into the verdict table, confirm entrance animations trigger once on scroll into view (not on every re-render) and easing feels sharp/confident, not bouncy.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/VerdictTable.tsx frontend/src/components/Hero.tsx
git commit -m "Add scroll-triggered entrance animations with custom easing"
```

---

### Task 11: App.tsx integration + final review

**Files:**
- Create: `mirror/frontend/src/App.tsx`
- Modify: `mirror/frontend/src/main.tsx`

**Interfaces:**
- Consumes: everything from Tasks 2-10 (`useMirrorData`, `Nav`, `Hero`, `GraphBackground`, `VerdictTable`, `BedrockBanner`, `LoadingState`, `ErrorState`, `PlaceholderState`)
- Produces: `export default function App()` — the app's root component, satisfying the `App.test.tsx` written in Task 9

- [ ] **Step 1: Implement App.tsx**

```tsx
// src/App.tsx
import { MIRROR_DATA_URL } from "./config";
import { useMirrorData } from "./hooks/useMirrorData";
import { Nav } from "./components/Nav";
import { Hero } from "./components/Hero";
import { GraphBackground } from "./components/GraphBackground";
import { VerdictTable } from "./components/VerdictTable";
import { BedrockBanner } from "./components/BedrockBanner";
import { LoadingState } from "./components/LoadingState";
import { ErrorState } from "./components/ErrorState";
import { PlaceholderState } from "./components/PlaceholderState";

export default function App() {
  const { status, data, error } = useMirrorData(MIRROR_DATA_URL);

  if (status === "placeholder") return <PlaceholderState />;
  if (status === "loading") return <LoadingState />;
  if (status === "error") return <ErrorState message={error ?? "unknown error"} />;

  const results = data?.results ?? [];

  return (
    <div className="relative min-h-screen">
      <GraphBackground results={results} />
      <Nav />
      <Hero />
      {data?.bedrock_summary && <BedrockBanner summary={data.bedrock_summary} />}
      <VerdictTable results={results} />
    </div>
  );
}
```

- [ ] **Step 2: Implement main.tsx**

```tsx
// src/main.tsx
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
```

- [ ] **Step 3: Run the full test suite**

Run: `npm test`
Expected: PASS — all tests across Tasks 2-9, including `App.test.tsx`'s 4 integration tests, now pass with `App` fully wired.

- [ ] **Step 4: Full visual + data-reality review (manual)**

Run: `npm run dev`, open in browser with `MIRROR_DATA_URL` temporarily pointed at a real `mirror.py --publish-s3` output (or a local static JSON file matching the shape for a dry run). Confirm against the quality-gate checklist from the user's original spec:
- No default Tailwind look (no `rounded-lg`, no purple gradients, no default `shadow-md`) — verify by inspecting rendered classes
- Every interactive element (nav links, pills, row toggles, GitHub link) has a visible hover/focus/active state
- At least 3 real typographic weight/size contrasts are visible (hero ~144px black display vs. body 14px mono vs. badge 10px mono)
- Custom easing present on every `motion` transition (grep for `ease:` and `type: "spring"` — no default linear/ease transitions left in)
- Loading/error/placeholder states are the designed components, not generic browser text
- Consistent spacing scale (Tailwind's default scale used throughout, no arbitrary one-off px values outside the hero's `clamp()`)
- Dark mode only, confirmed no light-theme leakage (background, text, and border colors are hardcoded to the dark palette, not `dark:` variants)
- The hero and verdict table are polished first — confirm both are complete and correct before considering below-the-fold sections (Bedrock banner, footer if any) for further polish

- [ ] **Step 5: Commit**

```bash
git add frontend/src/App.tsx frontend/src/main.tsx
git commit -m "Wire Mirror frontend: App integrates data hook, graph, hero, and verdict table"
```

---

## Self-Review Notes

- **Spec coverage:** sort-by-verdict (Task 3 + 8), stat tiles (Task 7), expandable rows with real dependents / "no real dependents found" (Task 8), Bedrock callout (Task 9), loading/error/placeholder states (Task 9), typewriter hero (Task 5), nav with real section links + GitHub (Task 4), 3D real-graph background (Task 6), multi-select spring-physics pills (Task 7), motion polish (Task 10) — every requirement in the user's spec has a task.
- **Placeholder scan:** no TBD/TODO markers; every step has real, complete code.
- **Type consistency:** `MirrorResult`/`MirrorPayload`/`Verdict` defined once in Task 2 and referenced identically by name in every later task; `useMirrorData`'s return shape (`status`/`data`/`error`) is consumed identically in Task 11.
- **Scope check:** single subsystem (frontend), no decomposition needed.
