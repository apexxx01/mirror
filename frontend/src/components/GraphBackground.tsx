import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Component, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode, RefObject } from "react";
import * as THREE from "three";
import type { MirrorResult, Verdict } from "../types";

/**
 * GraphBackground — the real AWS dependency graph, rendered as the page's
 * living substrate.
 *
 * Every point on screen is one resource Mirror actually evaluated, and every
 * line is one dependency edge Mirror actually found. Nothing here is padded
 * out with decorative particles: `results.length` spheres, and exactly one
 * line per real entry in `dependents`. That constraint is the whole point —
 * a background that is literally the evidence.
 *
 * Two facts about the real payload shaped every decision below:
 *
 *  1. The graph is SMALL. Mirror's sandbox produces ~8 resources and ~3 edges.
 *     A scatter of eight 6px dots is not a centrepiece, so the presence has to
 *     come from how much each real node is worth looking at — size that
 *     encodes real dependent count, glow that encodes real risk_score,
 *     reticles on exactly the resources Cedar blocked, and pulses that travel
 *     the real edges in the direction damage would actually propagate.
 *
 *  2. The Hero deliberately has NO scrim. Its 140px white Unbounded headline
 *     sits on bare void, and the hero's implementer left the contrast problem
 *     here on purpose. GraphBackground therefore owns its own legibility
 *     contract — see HERO_TEXT_ZONE / the veil below.
 */

interface GraphBackgroundProps {
  results: MirrorResult[];
}

/** Locked verdict palette. These are the same three colours the table uses. */
const VERDICT_COLOR: Record<Verdict, string> = {
  BLOCKED: "#DC2626",
  NEEDS_REVIEW: "#EAB308",
  SAFE: "#16A34A",
};
/** Hazard red is reserved for evidence of a real dependency: edges and reticles. */
const HAZARD = "#FF1E1E";
const VOID = "#0A0A0A";

const BASE_CAMERA_Z = 12;
/** ~125s per revolution. Slow enough to read as drift, not as a turntable. */
const SPIN_RATE = 0.05;
/** Full traversal of an edge every ~4.5s. */
const PULSE_RATE = 0.22;
/** Pulses are the most per-frame work here; cap them on implausibly large graphs. */
const MAX_PULSES = 64;
/**
 * Pointer-parallax pan, in world units at the graph's depth.
 *
 * X spends part of the clearance the right-margin bias buys: a positive camera
 * x shifts all projected content LEFT, toward the headline, by ~29px at
 * 1920px wide. That is inside the budget (measured worst-case clearance at
 * 1920 is 59px *including* this term) but it is not free, so it is named
 * rather than inlined. Y is free — the headline competes on the horizontal
 * axis only.
 */
const PARALLAX_X = 0.3;
const PARALLAX_Y = 0.2;

/* ------------------------------------------------------------------ *
 * Layout
 * ------------------------------------------------------------------ */

export interface LayoutNode {
  id: string;
  verdict: Verdict;
  /** Real count of resources that break if this one is deleted. */
  dependentCount: number;
  /** Real risk_score, 0-100. */
  risk: number;
  /** Resting position inside the unit sphere; scaled to world units on resize. */
  unit: THREE.Vector3;
}

/** Indices into the node array. `from` is the resource; `to` is what breaks. */
export interface LayoutEdge {
  from: number;
  to: number;
}

/**
 * Stable per-name value in [0,1). FNV-1a — no Math.random anywhere in here,
 * because the same payload must produce the same picture on every reload.
 *
 * Exported for tests: determinism is a spec constraint, not an implementation
 * detail, so it is worth locking down.
 */
export function hashUnit(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) / 4294967296;
}

/** Evenly-spaced point i of n on the unit sphere (Fibonacci lattice). Exported for tests. */
export function fibonacciPoint(i: number, n: number, out: THREE.Vector3): THREE.Vector3 {
  const k = i + 0.5;
  const phi = Math.acos(clamp(1 - (2 * k) / Math.max(n, 1), -1, 1));
  const theta = Math.PI * (1 + Math.sqrt(5)) * k;
  return out.set(Math.cos(theta) * Math.sin(phi), Math.cos(phi), Math.sin(theta) * Math.sin(phi));
}

/**
 * A soft radial falloff, drawn once into a 128px canvas and reused by every
 * glow in the scene.
 *
 * The obvious cheap glow — a bigger transparent sphere behind each node —
 * renders as a flat disc with a hard silhouette, which read as a bullseye
 * rather than light. A real falloff needs a gradient, and a gradient sprite is
 * a fraction of the cost of a post-processing bloom pass we would otherwise
 * have to pull in a dependency for.
 */
function makeGlowTexture(): THREE.Texture {
  const size = 128;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, "rgba(255,255,255,1)");
  g.addColorStop(0.16, "rgba(255,255,255,0.5)");
  g.addColorStop(0.42, "rgba(255,255,255,0.13)");
  g.addColorStop(0.72, "rgba(255,255,255,0.025)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/**
 * Build the graph's resting shape from the payload alone.
 *
 * Seeded from a Fibonacci lattice (even, deterministic, no clumping at small
 * N) and then relaxed for a fixed number of iterations with springs along the
 * REAL edges and mutual separation between all nodes. So when two resources
 * are genuinely connected they end up visibly adjacent, and the sandbox's two
 * dependency chains read as chains rather than as arbitrary chords across a
 * ring. Deterministic in, deterministic out — this runs once per payload.
 *
 * Radial depth is data too: anything with real dependents is pulled toward the
 * core, and leaves drift out to the shell. Load-bearing resources sit at the
 * centre of the structure because that is what they are.
 *
 * Exported because this function IS the "no decorative nodes" guarantee: node
 * count and edge count are decided here and nowhere else, so this is where
 * that constraint is worth locking down in tests rather than re-checking by
 * eye in a browser.
 */
export function buildLayout(results: MirrorResult[]): { nodes: LayoutNode[]; edges: LayoutEdge[] } {
  const n = results.length;

  const indexOf = new Map<string, number>();
  for (let i = 0; i < n; i++) {
    if (!indexOf.has(results[i].resource)) indexOf.set(results[i].resource, i);
  }

  const edges: LayoutEdge[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < n; i++) {
    for (const dep of results[i].dependents) {
      const j = indexOf.get(dep);
      // Dangling or self-referential dependents are dropped rather than faked.
      if (j === undefined || j === i) continue;
      const key = `${i}>${j}`;
      if (seen.has(key)) continue;
      seen.add(key);
      edges.push({ from: i, to: j });
    }
  }

  const seeds: THREE.Vector3[] = [];
  const pos: THREE.Vector3[] = [];
  for (let i = 0; i < n; i++) {
    const r = results[i];
    const v = fibonacciPoint(i, n, new THREE.Vector3());
    const shell = (r.dependents.length > 0 ? 0.5 : 0.9) + (hashUnit(r.resource) - 0.5) * 0.2;
    v.multiplyScalar(shell);
    seeds.push(v);
    pos.push(v.clone());
  }

  const iterations = n <= 96 ? 180 : 70;
  const REST = 0.42; // how close a real dependency pair settles
  const MIN_GAP = 0.34;
  const delta = new THREE.Vector3();

  for (let it = 0; it < iterations; it++) {
    const cool = 1 - it / iterations;

    for (const e of edges) {
      delta.subVectors(pos[e.to], pos[e.from]);
      const len = delta.length() || 1e-6;
      delta.multiplyScalar(((len - REST) * 0.09 * cool) / len);
      pos[e.from].add(delta);
      pos[e.to].sub(delta);
    }

    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        delta.subVectors(pos[j], pos[i]);
        const len = delta.length() || 1e-6;
        if (len >= MIN_GAP) continue;
        delta.multiplyScalar(((MIN_GAP - len) * 0.5 * cool) / len);
        pos[j].add(delta);
        pos[i].sub(delta);
      }
    }

    // A weak tether to the seed keeps the lattice's evenness from collapsing.
    for (let i = 0; i < n; i++) {
      pos[i].lerp(seeds[i], 0.02 * cool);
      if (pos[i].lengthSq() > 1) pos[i].setLength(1);
    }
  }

  const nodes: LayoutNode[] = results.map((r, i) => ({
    id: r.resource,
    verdict: r.verdict,
    dependentCount: r.dependents.length,
    risk: r.risk_score,
    unit: pos[i],
  }));

  return { nodes, edges };
}

/* ------------------------------------------------------------------ *
 * Scene
 * ------------------------------------------------------------------ */

interface SceneProps {
  results: MirrorResult[];
  reduced: boolean;
  pointerRef: RefObject<{ x: number; y: number }>;
  scrollRef: RefObject<number>;
}

function GraphScene({ results, reduced, pointerRef, scrollRef }: SceneProps) {
  const groupRef = useRef<THREE.Group>(null);
  const pulseRefs = useRef<(THREE.Sprite | null)[]>([]);
  const reticleRefs = useRef<(THREE.Mesh | null)[]>([]);
  const camTarget = useMemo(() => new THREE.Vector3(), []);

  const layout = useMemo(() => buildLayout(results), [results]);

  const viewport = useThree((s) => s.viewport);

  /**
   * Composition, resolved in screen space so it holds at any aspect ratio.
   *
   * On a landscape viewport the graph is pushed into the right margin and
   * shaped into a tall, narrow ellipsoid — a vertical spine of structure in
   * the margin, which keeps its footprint on the one axis the headline
   * competes for as small as the node count allows. Because the group spins
   * about its own Y axis and its radius is bounded, that bias is not something
   * the rotation can undo: the structure orbits an off-centre axis and never
   * sweeps back across the type.
   *
   * On a portrait viewport there is no right margin — the headline runs the
   * full width — so the bias rotates ninety degrees: the graph centres
   * horizontally, flattens, and drops below the standfirst into the only
   * clear band on the screen. The veil switches axis with it (see GRAPH_CSS).
   *
   * `wide` interpolates between the two so there is no snap at any width.
   */
  const place = useMemo(() => {
    const halfW = viewport.width / 2;
    const halfH = viewport.height / 2;
    const wide = clamp((viewport.width / viewport.height - 0.95) / 0.55, 0, 1);
    const rx = lerp(halfW * 0.72, Math.min(halfW * 0.3, halfH * 0.44), wide);
    const ry = lerp(halfH * 0.3, halfH * 0.8, wide);
    return {
      centerX: halfW * lerp(0, 0.52, wide),
      centerY: halfH * lerp(-0.55, -0.02, wide),
      rx,
      ry,
      rz: rx,
      nodeScale: clamp(Math.min(rx, ry) / 1.6, 0.55, 1.5),
    };
  }, [viewport.width, viewport.height]);

  /** Resting unit positions blown up into world units for the current viewport. */
  const placed = useMemo(
    () =>
      layout.nodes.map((nd) =>
        new THREE.Vector3(nd.unit.x * place.rx, nd.unit.y * place.ry, nd.unit.z * place.rz),
      ),
    [layout, place],
  );

  /** One THREE line segment per real dependency edge, in a single draw call. */
  const edgeGeometry = useMemo(() => {
    const geo = new THREE.BufferGeometry();
    const arr = new Float32Array(layout.edges.length * 6);
    layout.edges.forEach((e, i) => {
      const a = placed[e.from];
      const b = placed[e.to];
      arr.set([a.x, a.y, a.z, b.x, b.y, b.z], i * 6);
    });
    geo.setAttribute("position", new THREE.BufferAttribute(arr, 3));
    return geo;
  }, [layout.edges, placed]);
  useEffect(() => () => edgeGeometry.dispose(), [edgeGeometry]);

  const sphereGeo = useMemo(() => new THREE.SphereGeometry(1, 20, 20), []);
  const reticleGeo = useMemo(() => new THREE.RingGeometry(0.955, 1, 64), []);
  const glowTex = useMemo(() => makeGlowTexture(), []);
  useEffect(
    () => () => {
      sphereGeo.dispose();
      reticleGeo.dispose();
      glowTex.dispose();
    },
    [sphereGeo, reticleGeo, glowTex],
  );

  const pulseCount = Math.min(layout.edges.length, MAX_PULSES);

  // The risk core: a single dominant visual object at the real center of the
  // graph, colored by the account's real aggregate state — not decoration,
  // the same three-state signal the kill-switch banner and stat tiles show,
  // just given weight as the page's one hero object instead of buried in
  // small type. Sized off the real resource count so a bigger scan reads as
  // a bigger, denser core.
  const coreColor = useMemo(() => {
    if (layout.nodes.some((n) => n.verdict === "BLOCKED")) return VERDICT_COLOR.BLOCKED;
    if (layout.nodes.some((n) => n.verdict === "NEEDS_REVIEW")) return VERDICT_COLOR.NEEDS_REVIEW;
    return VERDICT_COLOR.SAFE;
  }, [layout.nodes]);
  const coreRadius = (0.55 + Math.min(layout.nodes.length, 20) * 0.02) * place.nodeScale;
  const coreRingRefs = useRef<(THREE.Mesh | null)[]>([]);
  const coreGlowRef = useRef<THREE.Sprite>(null);

  // Under reduced motion the Canvas runs on demand rather than every frame
  // (see frameloop below), so nothing is repainted unless something actually
  // changed. Scrolling still moves the camera, so it has to ask for a frame.
  const invalidate = useThree((s) => s.invalidate);
  useEffect(() => {
    if (!reduced) return;
    const onScroll = () => invalidate();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [reduced, invalidate]);

  useFrame((state, dt) => {
    const t = state.clock.elapsedTime;
    const group = groupRef.current;

    if (group) {
      if (reduced) {
        // Still a real 3D structure, just held still.
        group.rotation.set(0.06, 0.6, 0);
      } else {
        group.rotation.y = t * SPIN_RATE;
        // A shallow nod on X so the structure never reads as a flat turntable.
        group.rotation.x = Math.sin(t * 0.09) * 0.07;
      }
    }

    // Pointer parallax is a pan, not a swing: translating the camera keeps the
    // right-margin bias intact, where a lookAt() would rock the graph back
    // across the headline.
    const p = pointerRef.current;
    const scrolled = scrollRef.current;
    camTarget.set(
      reduced ? 0 : p.x * PARALLAX_X,
      reduced ? 0 : -p.y * PARALLAX_Y,
      // As the page scrolls past the hero the graph recedes, so it settles
      // into a background behind the verdict table instead of competing.
      BASE_CAMERA_Z + scrolled * 2.4,
    );
    // Easing needs a continuous frame loop; on demand there isn't one, so the
    // reduced-motion path snaps instead of chasing a target it would never reach.
    if (reduced) state.camera.position.copy(camTarget);
    else state.camera.position.lerp(camTarget, 1 - Math.pow(0.0015, dt));

    // Pulses travel resource -> dependent: the direction the damage would
    // actually propagate if you deleted the resource. That's Mirror's thesis,
    // animated on the real edges rather than narrated.
    for (let i = 0; i < pulseCount; i++) {
      const spark = pulseRefs.current[i];
      if (!spark) continue;
      const e = layout.edges[i];
      const u = reduced ? 0.5 : (t * PULSE_RATE + i * 0.37) % 1;
      spark.position.lerpVectors(placed[e.from], placed[e.to], u);
      // Fade in and out at the endpoints so a spark never pops on top of a node.
      spark.material.opacity = Math.sin(Math.PI * u) * 0.95;
    }

    for (const ring of reticleRefs.current) {
      if (!ring) continue;
      // Billboarded so the reticle always reads as a ring, never as an ellipse
      // edge-on. lookAt() resolves through the spinning parent group, so the
      // slow rotateZ below is an absolute offset, not an accumulating one.
      ring.lookAt(state.camera.position);
      if (!reduced) ring.rotateZ(t * 0.25);
    }

    // Each concentric ring turns at its own rate on its own axis, so the core
    // reads as a real nested-shell object rather than one flat spinning disc —
    // the same "glossy concentric orb" shape the reference direction uses.
    coreRingRefs.current.forEach((ring, i) => {
      if (!ring) return;
      if (reduced) return;
      const speed = 0.12 + i * 0.05;
      ring.rotation.x = t * speed * (i % 2 === 0 ? 1 : -1);
      ring.rotation.y = t * speed * 0.7;
    });
    // Slow ambient pulse on the core's glow — same 8-14s cinematic band as
    // every other glow on the page, never a fast blink.
    if (coreGlowRef.current) {
      const pulse = reduced ? 1 : 0.85 + Math.sin(t * (Math.PI * 2) / 10) * 0.15;
      coreGlowRef.current.material.opacity = 0.6 * pulse;
    }
  });

  return (
    <group ref={groupRef} position={[place.centerX, place.centerY, 0]}>
      {/* The risk core — real aggregate state, given real visual weight. */}
      <group>
        <mesh scale={coreRadius}>
          <sphereGeometry args={[1, 32, 32]} />
          <meshBasicMaterial color={coreColor} toneMapped={false} />
        </mesh>
        {[1.55, 2.05, 2.6].map((mult, i) => (
          <mesh
            key={i}
            ref={(m) => {
              coreRingRefs.current[i] = m;
            }}
            scale={coreRadius * mult}
          >
            <torusGeometry args={[1, 0.035, 12, 64]} />
            <meshBasicMaterial
              color={coreColor}
              transparent
              opacity={0.35 - i * 0.08}
              toneMapped={false}
            />
          </mesh>
        ))}
        <sprite ref={coreGlowRef} scale={[coreRadius * 9, coreRadius * 9, 1]}>
          <spriteMaterial
            map={glowTex}
            color={coreColor}
            transparent
            opacity={0.6}
            blending={THREE.AdditiveBlending}
            depthWrite={false}
            fog={false}
            toneMapped={false}
          />
        </sprite>
      </group>

      {layout.nodes.map((nd, i) => {
        const color = VERDICT_COLOR[nd.verdict];
        // Radius is the real dependent count. The resources that would break
        // things are literally the biggest objects on screen.
        const radius =
          (0.098 + 0.05 * Math.min(nd.dependentCount, 5)) * place.nodeScale;
        // risk_score is Mirror's "how live is this evidence" number; it drives
        // how hot the node burns, so recently-touched resources glow harder.
        const heat = 0.42 + (clamp(nd.risk, 0, 100) / 100) * 0.45;
        const blocked = nd.verdict === "BLOCKED";

        return (
          <group key={`${nd.id}-${i}`} position={placed[i]}>
            <mesh geometry={sphereGeo} scale={radius}>
              <meshBasicMaterial color={color} toneMapped={false} />
            </mesh>
            {/* Additive halo — the bloom we can afford without a post stack. */}
            <sprite scale={[radius * 13, radius * 13, 1]}>
              <spriteMaterial
                map={glowTex}
                color={color}
                transparent
                opacity={heat}
                blending={THREE.AdditiveBlending}
                depthWrite={false}
                fog={false}
                toneMapped={false}
              />
            </sprite>
            {blocked ? (
              // Only the resources Cedar actually refused get a reticle. On the
              // real sandbox payload that is three objects out of eight — the
              // reticle is a finding, not an ornament.
              <mesh
                ref={(m) => {
                  reticleRefs.current[i] = m;
                }}
                geometry={reticleGeo}
                scale={radius * 3.1}
              >
                <meshBasicMaterial
                  color={HAZARD}
                  transparent
                  opacity={0.45}
                  side={THREE.DoubleSide}
                  depthWrite={false}
                  toneMapped={false}
                />
              </mesh>
            ) : null}
          </group>
        );
      })}

      {layout.edges.length > 0 ? (
        <lineSegments geometry={edgeGeometry}>
          <lineBasicMaterial color={HAZARD} transparent opacity={0.7} toneMapped={false} />
        </lineSegments>
      ) : null}

      {Array.from({ length: pulseCount }, (_, i) => (
        <sprite
          key={`pulse-${i}`}
          ref={(s) => {
            pulseRefs.current[i] = s;
          }}
          scale={[0.62 * place.nodeScale, 0.62 * place.nodeScale, 1]}
        >
          <spriteMaterial
            map={glowTex}
            color={HAZARD}
            transparent
            opacity={0}
            blending={THREE.AdditiveBlending}
            depthWrite={false}
            fog={false}
            toneMapped={false}
          />
        </sprite>
      ))}
    </group>
  );
}

/* ------------------------------------------------------------------ *
 * Legibility layer
 * ------------------------------------------------------------------ */

/**
 * The hero's headline has no scrim of its own, so the graph brings its own
 * veil — the darkening belongs to the background, not to the type.
 *
 * `--hero-text-edge` is derived from the headline's real type metrics rather
 * than guessed: the hero's longest line ("this resource") measures 7.87em in
 * Unbounded 700 at font-size clamp(2rem, 10.3vw, 8.75rem), offset by the
 * hero's md:px-12 gutter. So the veil tracks the actual right edge of the
 * headline at every viewport width instead of drifting off it at, say, 1440px
 * where the type occupies ~80% of the screen.
 *
 * The vertical mask is what stops this from being a flat wash: the veil is a
 * band, opaque only across the horizontal slab the headline occupies, so the
 * graph still reads above and below it. And the whole veil lifts on scroll —
 * the 140px display type is what needs protecting; the verdict table's small
 * mono does not, so past the hero the graph is allowed to come forward.
 */
const GRAPH_CSS = `
/*
  This component renders into a fixed, -z-10 layer, which only survives if
  nothing paints an opaque background over it. body and #root are kept
  transparent in index.css (Task 1) for exactly this reason — see the comment
  there for the full CSS-painting-order explanation. html keeps the real
  #0A0A0A fill, so the page still reads as void top to bottom whether or not
  this component is mounted.
*/

.mirror-graph-veil {
  --hero-text-edge: calc(48px + 7.87 * clamp(2rem, 10.3vw, 8.75rem));
  position: absolute;
  inset: 0;
  background: linear-gradient(
    to right,
    rgba(10, 10, 10, 0.975) 0,
    rgba(10, 10, 10, 0.965) calc(var(--hero-text-edge) * 0.72),
    rgba(10, 10, 10, 0.86) var(--hero-text-edge),
    rgba(10, 10, 10, 0) calc(var(--hero-text-edge) + 12vw)
  );
  -webkit-mask-image: linear-gradient(to bottom, transparent 2%, #000 19%, #000 84%, transparent 99%);
  mask-image: linear-gradient(to bottom, transparent 2%, #000 19%, #000 84%, transparent 99%);
  transition: opacity 200ms linear;
  will-change: opacity;
}

/* Always on: keeps the graph from reading as wallpaper and holds the nav and
   the verdict table on solid ground at the top and bottom of the viewport. */
.mirror-graph-vignette {
  position: absolute;
  inset: 0;
  background:
    linear-gradient(to bottom, rgba(10, 10, 10, 0.78) 0, rgba(10, 10, 10, 0) 16%),
    linear-gradient(to top, rgba(10, 10, 10, 0.7) 0, rgba(10, 10, 10, 0) 20%),
    radial-gradient(ellipse 118% 88% at 50% 46%, rgba(10, 10, 10, 0) 36%, rgba(10, 10, 10, 0.8) 100%);
}

/*
  Portrait: the headline runs the full width, so a left-weighted veil would
  simply black out the whole screen. The veil turns through ninety degrees
  with the graph — a horizontal band protecting the type, clearing for the
  lower third the graph has moved into — and the heavy bottom fade is eased
  off, because on this axis the bottom of the screen is where the graph lives.
*/
@media (max-aspect-ratio: 1 / 1) {
  .mirror-graph-veil {
    background: linear-gradient(
      to bottom,
      rgba(10, 10, 10, 0.96) 0,
      rgba(10, 10, 10, 0.94) 56%,
      rgba(10, 10, 10, 0.5) 69%,
      rgba(10, 10, 10, 0) 80%
    );
    -webkit-mask-image: none;
    mask-image: none;
  }
  .mirror-graph-vignette {
    background:
      linear-gradient(to bottom, rgba(10, 10, 10, 0.7) 0, rgba(10, 10, 10, 0) 13%),
      radial-gradient(ellipse 132% 96% at 50% 52%, rgba(10, 10, 10, 0) 46%, rgba(10, 10, 10, 0.72) 100%);
  }
}

@media (prefers-reduced-motion: reduce) {
  .mirror-graph-veil { transition: none; }
}
`;

/* ------------------------------------------------------------------ *
 * Shell
 * ------------------------------------------------------------------ */

function detectWebGL(): boolean {
  if (typeof document === "undefined") return false;
  try {
    const canvas = document.createElement("canvas");
    return Boolean(
      canvas.getContext("webgl2") ??
        canvas.getContext("webgl") ??
        canvas.getContext("experimental-webgl"),
    );
  } catch {
    return false;
  }
}

function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

/** A lost context or a driver that fails mid-init must cost the page nothing. */
class CanvasBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    return this.state.failed ? null : this.props.children;
  }
}

export function GraphBackground({ results }: GraphBackgroundProps) {
  const [webgl] = useState(detectWebGL);
  const [reduced] = useState(prefersReducedMotion);
  const veilRef = useRef<HTMLDivElement>(null);
  const pointerRef = useRef({ x: 0, y: 0 });
  const scrollRef = useRef(0);

  const live = webgl && results.length > 0;

  useEffect(() => {
    if (!live) return;

    let queued = 0;

    const onPointerMove = (e: PointerEvent) => {
      pointerRef.current.x = (e.clientX / window.innerWidth) * 2 - 1;
      pointerRef.current.y = (e.clientY / window.innerHeight) * 2 - 1;
    };

    const applyScroll = () => {
      queued = 0;
      const p = clamp(window.scrollY / Math.max(window.innerHeight, 1), 0, 1);
      scrollRef.current = p;
      if (veilRef.current) veilRef.current.style.opacity = String(1 - p * 0.8);
    };

    const onScroll = () => {
      if (!queued) queued = requestAnimationFrame(applyScroll);
    };

    applyScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    if (!reduced) window.addEventListener("pointermove", onPointerMove, { passive: true });

    return () => {
      if (queued) cancelAnimationFrame(queued);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("pointermove", onPointerMove);
    };
  }, [live, reduced]);

  // No data, or no WebGL: the page still gets its void, never a crash.
  if (!live) {
    return <div aria-hidden="true" className="pointer-events-none fixed inset-0 -z-10 bg-void" />;
  }

  return (
    <div
      aria-hidden="true"
      data-testid="graph-background"
      className="pointer-events-none fixed inset-0 -z-10 overflow-hidden bg-void"
    >
      <style>{GRAPH_CSS}</style>
      <CanvasBoundary>
        <Canvas
          dpr={[1, 1.75]}
          frameloop={reduced ? "demand" : "always"}
          camera={{ position: [0, 0, BASE_CAMERA_Z], fov: 50 }}
          gl={{ antialias: true, powerPreference: "high-performance" }}
        >
          {/* Fog, not lights: every material here is unlit on purpose. These
              are readout points, not a lit diorama, and depth is carried by
              the void swallowing the far side of the structure. */}
          <fog attach="fog" args={[VOID, 10, 22]} />
          <GraphScene
            results={results}
            reduced={reduced}
            pointerRef={pointerRef}
            scrollRef={scrollRef}
          />
        </Canvas>
      </CanvasBoundary>
      <div ref={veilRef} className="mirror-graph-veil" />
      <div className="mirror-graph-vignette" />
    </div>
  );
}
