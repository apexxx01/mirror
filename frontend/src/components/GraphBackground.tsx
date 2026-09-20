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
 * The core is no longer hiding in the right margin — it is the centrepiece, and
 * the composition (see `place`) leaves real clearance on both sides — so the
 * parallax is symmetric again rather than being spent entirely on protecting
 * the headline's right edge.
 */
const PARALLAX_X = 0.34;
const PARALLAX_Y = 0.24;

/**
 * Camera drift, on top of the parallax pan — a slow breath so the scene is
 * never still even when the pointer is. Symmetric on all three axes now that
 * the structure sits away from both edges; the Z term is a dolly.
 */
const DRIFT_X = 0.3;
const DRIFT_Y = 0.46;
const DRIFT_Z = 0.62;

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

/**
 * A hollow annulus — transparent through the middle, a hard bright ring at 93%
 * of the radius, feathered on both sides.
 *
 * Billboarded just outside the core's silhouette this reads as a refractive
 * edge: the bright chromatic lip you get where light grazes the rim of a
 * glass or polished object. It is the cheapest honest substitute for a
 * fresnel shader, and unlike a shader it costs one sprite.
 */
function makeRimTexture(): THREE.Texture {
  const size = 256;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, "rgba(255,255,255,0)");
  g.addColorStop(0.7, "rgba(255,255,255,0)");
  g.addColorStop(0.85, "rgba(255,255,255,0.16)");
  g.addColorStop(0.93, "rgba(255,255,255,1)");
  g.addColorStop(0.97, "rgba(255,255,255,0.22)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/**
 * An anamorphic streak — a long horizontal smear with a soft vertical falloff.
 *
 * Two of these, additively blended and scaled to different widths, are the
 * lens flare the reference direction asks for. Building it as one texture
 * rather than a post-processing flare pass keeps the no-new-dependency rule
 * intact and costs two more sprites.
 */
function makeStreakTexture(): THREE.Texture {
  const w = 512;
  const h = 64;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d")!;
  const gx = ctx.createLinearGradient(0, 0, w, 0);
  gx.addColorStop(0, "rgba(255,255,255,0)");
  gx.addColorStop(0.34, "rgba(255,255,255,0.28)");
  gx.addColorStop(0.5, "rgba(255,255,255,1)");
  gx.addColorStop(0.66, "rgba(255,255,255,0.28)");
  gx.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = gx;
  ctx.fillRect(0, 0, w, h);
  // Multiply the vertical falloff in, so the streak is a lens flare rather
  // than a hard-edged bar.
  ctx.globalCompositeOperation = "destination-in";
  const gy = ctx.createLinearGradient(0, 0, 0, h);
  gy.addColorStop(0, "rgba(0,0,0,0)");
  gy.addColorStop(0.5, "rgba(0,0,0,1)");
  gy.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = gy;
  ctx.fillRect(0, 0, w, h);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/**
 * Weld a non-indexed geometry's duplicate corners into shared vertices.
 *
 * This is not a micro-optimisation, it is a correctness fix. `IcosahedronGeometry`
 * (like every PolyhedronGeometry) is non-indexed: each triangle carries its own
 * three corners, so `computeVertexNormals` has nothing to average and assigns
 * every corner its own FACE normal. That is flat shading — which was invisible
 * while the core was unlit and, the moment it became a lit surface, turned it
 * into a ball with a few dozen hard triangular highlights stamped on it.
 *
 * Welding by position gives each vertex one normal averaged over every face
 * that touches it, which is what makes a displaced surface read as a surface.
 * It also makes the per-frame work cheaper: the displacement loop then runs
 * over unique vertices (~1.7k) instead of every corner of every face (~10k).
 *
 * Only `position` is carried across — the core's material has no maps, and the
 * normals are recomputed every frame anyway.
 */
function weldByPosition(source: THREE.BufferGeometry): THREE.BufferGeometry {
  const src = source.attributes.position.array as ArrayLike<number>;
  const seen = new Map<string, number>();
  const verts: number[] = [];
  const index: number[] = [];

  for (let i = 0; i < src.length; i += 3) {
    const key = `${src[i].toFixed(5)}|${src[i + 1].toFixed(5)}|${src[i + 2].toFixed(5)}`;
    let id = seen.get(key);
    if (id === undefined) {
      id = verts.length / 3;
      seen.set(key, id);
      verts.push(src[i], src[i + 1], src[i + 2]);
    }
    index.push(id);
  }

  const welded = new THREE.BufferGeometry();
  welded.setAttribute("position", new THREE.Float32BufferAttribute(verts, 3));
  welded.setIndex(index);
  return welded;
}

/**
 * The studio, painted as an equirectangular panorama.
 *
 * The core is a metal, and a metal has almost no diffuse response — with no
 * environment to reflect it is a black ball with four specular dots on it.
 * Rather than ship an HDRI (a new asset, and a large one) the studio is drawn
 * here and run through PMREM into a proper prefiltered IBL. That reflection is
 * most of what the surface actually shows, which is why it is worth being
 * exact about what goes in it.
 *
 * Four lamps: one constant hard white key, and one gel per verdict whose
 * brightness is that verdict's REAL share of the scan. So the colour washing
 * across the artifact is the account's verdict mix, in the same three locked
 * status hues the table uses, in the same proportions — a clean account
 * reflects green, an account Cedar mostly refused reflects red. A verdict with
 * no resources in it paints nothing, so the reflection can never imply a
 * finding that isn't there.
 */
function makeStudioEnvTexture(share: Record<Verdict, number>): THREE.Texture {
  const w = 512;
  const h = 256;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#050507";
  ctx.fillRect(0, 0, w, h);

  const blob = (x: number, y: number, r: number, color: string, alpha: number) => {
    if (alpha <= 0) return;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, color);
    g.addColorStop(0.45, color);
    g.addColorStop(1, "rgba(0,0,0,0)");
    ctx.globalAlpha = Math.min(alpha, 1);
    ctx.fillStyle = g;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
    ctx.globalAlpha = 1;
  };

  // The constant: a hard key lamp, high and left. Studio, not data.
  blob(w * 0.24, h * 0.2, w * 0.24, "#ffffff", 0.92);
  // The data: three gels, set well apart so their washes meet across the
  // surface instead of stacking into one muddy tint.
  blob(w * 0.62, h * 0.32, w * 0.26, VERDICT_COLOR.BLOCKED, share.BLOCKED * 0.95);
  blob(w * 0.88, h * 0.62, w * 0.2, VERDICT_COLOR.NEEDS_REVIEW, share.NEEDS_REVIEW * 0.95);
  blob(w * 0.42, h * 0.76, w * 0.22, VERDICT_COLOR.SAFE, share.SAFE * 0.9);
  // A cold bounce off the floor, so the shadow side is never dead black.
  blob(w * 0.04, h * 0.88, w * 0.2, "#16233f", 0.75);

  const tex = new THREE.CanvasTexture(canvas);
  tex.mapping = THREE.EquirectangularReflectionMapping;
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
 * Evidence field
 * ------------------------------------------------------------------ */

function len(a: unknown): number {
  return Array.isArray(a) ? a.length : 0;
}

/**
 * How many distinct pieces of evidence Mirror actually holds on one resource.
 *
 * This is the count of real records in the payload — every Cedar reason,
 * every blast-radius hop, every adversarial CloudWatch reading, every
 * decision-matrix scenario, every downstream effect in the future diff, every
 * rollback step. It is not a density knob: turning it up would mean inventing
 * findings, so it can only ever be what the scan returned.
 */
export function evidenceCount(r: MirrorResult): number {
  return (
    len(r.cedar_reasons) +
    len(r.blast_radius) +
    len(r.adversarial) +
    len(r.decision_matrix) +
    len(r.future_diff?.downstream) +
    len(r.rollback_plan?.steps)
  );
}

/** One orbiting mote. `owner` indexes the node array `buildLayout` produced. */
export interface EvidenceMote {
  owner: number;
  verdict: Verdict;
  /** Owner's real risk_score, normalised to [0,1]. Drives brightness. */
  heat: number;
  /** Orbit radius in node-scale units. */
  radius: number;
  phase: number;
  /** Radians per second, signed — half the field orbits the other way. */
  speed: number;
  /** Orthonormal basis of this mote's orbit plane. */
  u: THREE.Vector3;
  v: THREE.Vector3;
}

/**
 * A hard ceiling so a pathological payload cannot turn the background into a
 * per-frame CPU bill. The real sandbox produces ~80 motes; this is ~17x that.
 */
export const MAX_MOTES = 1400;

/**
 * The evidence field — the ambient cloud that gives the graph atmosphere
 * without a single invented particle.
 *
 * Each mote is one real record, orbiting the resource it was found on. So the
 * density around a node is literally how much Mirror knows about it: a
 * resource with three dependency hops, two error readings and four scenarios
 * wears a visibly thicker halo than an untouched scratch bucket. Deterministic
 * throughout (FNV-1a + Fibonacci lattice, no Math.random), so the same scan
 * renders the same sky every reload.
 */
export function buildEvidenceField(results: MirrorResult[]): EvidenceMote[] {
  const motes: EvidenceMote[] = [];
  const axis = new THREE.Vector3();
  const ref = new THREE.Vector3();

  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    const n = evidenceCount(r);
    const heat = clamp(r.risk_score, 0, 100) / 100;

    for (let k = 0; k < n; k++) {
      if (motes.length >= MAX_MOTES) return motes;

      // The orbit normal is spread over the sphere so a node's motes form a
      // shell rather than a single ring.
      fibonacciPoint(k, n, axis);
      const nearX = Math.abs(axis.x) < 0.9;
      ref.set(nearX ? 1 : 0, nearX ? 0 : 1, 0);
      const u = new THREE.Vector3().crossVectors(axis, ref).normalize();
      const v = new THREE.Vector3().crossVectors(axis, u).normalize();

      const h1 = hashUnit(`${r.resource}#${k}`);
      const h2 = hashUnit(`${k}@${r.resource}`);

      motes.push({
        owner: i,
        verdict: r.verdict,
        heat,
        // Kept tight on purpose. A wider field would spill left past the
        // headline's clearance budget (see PARALLAX_X), and the reading only
        // works if a mote visibly belongs to one resource.
        radius: 0.3 + h1 * 0.7,
        phase: h2 * Math.PI * 2,
        speed: (0.09 + h1 * 0.2) * (h2 < 0.5 ? -1 : 1),
        u,
        v,
      });
    }
  }

  return motes;
}

/**
 * The account's real aggregate severity: the share of scanned resources Cedar
 * actually refused, in [0,1]. This is the one number that drives every
 * reactive intensity in the scene — core distortion, shell brightness, edge
 * opacity, pulse speed — so a clean account renders calm and a compromised one
 * renders violent, from real data rather than a mood setting.
 */
export function severityOf(results: MirrorResult[]): number {
  if (results.length === 0) return 0;
  return results.filter((r) => r.verdict === "BLOCKED").length / results.length;
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
   * The risk core is the page's one hero object, so it is sized off the SHORT
   * edge of the viewport: ~24.5% of it in landscape, which puts the artifact's
   * own silhouette at roughly half the viewport height and a third of its
   * width. Everything else — the evidence shell, the node radii, the mote
   * orbits — is expressed as a multiple of that radius, so the whole scene
   * scales as one object instead of drifting apart between breakpoints.
   *
   * Horizontally the core sits at ~61% of the frame on a landscape viewport:
   * right of centre, because the headline owns the left, but nowhere near the
   * edge. The numbers are chosen so the widest thing in the scene (a mote at
   * full orbit radius on the outermost node) still lands inside the frame at
   * 1920, 1440 and 1024 even at the extreme of the pointer parallax and the
   * camera drift combined.
   *
   * On a portrait viewport there is no right margin — the headline runs the
   * full width — so the bias rotates ninety degrees: the core centres
   * horizontally and drops into the lower third. The veil switches axis with
   * it (see GRAPH_CSS).
   *
   * `wide` interpolates between the two so there is no snap at any width.
   */
  const place = useMemo(() => {
    const halfW = viewport.width / 2;
    const halfH = viewport.height / 2;
    const wide = clamp((viewport.width / viewport.height - 0.95) / 0.55, 0, 1);
    const span = Math.min(viewport.width, viewport.height);

    const coreRadius = span * lerp(0.19, 0.245, wide);
    // The evidence shell orbits OUTSIDE the core rather than inside it, so the
    // real nodes read as a structure around the artifact, not as freckles on it.
    const shell = coreRadius * lerp(2.0, 1.95, wide);

    return {
      centerX: lerp(0, halfW * 0.18, wide),
      centerY: lerp(-halfH * 0.34, -halfH * 0.02, wide),
      rx: shell,
      ry: shell * lerp(0.92, 0.78, wide),
      rz: shell,
      coreRadius,
      nodeScale: clamp(coreRadius / 1.75, 0.6, 1.6),
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
  const rimTex = useMemo(() => makeRimTexture(), []);
  const streakTex = useMemo(() => makeStreakTexture(), []);
  useEffect(
    () => () => {
      sphereGeo.dispose();
      reticleGeo.dispose();
      glowTex.dispose();
      rimTex.dispose();
      streakTex.dispose();
    },
    [sphereGeo, reticleGeo, glowTex, rimTex, streakTex],
  );

  /* ---------------- evidence field ---------------- */

  const motes = useMemo(() => buildEvidenceField(results), [results]);

  /**
   * One interleaved buffer for the whole field: colours written once (they
   * encode the owner's real verdict and risk and never change), positions
   * rewritten per frame. A Points cloud is a single draw call, so the field
   * costs one more draw no matter how much evidence the scan returned.
   */
  const moteGeo = useMemo(() => {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute(
      "position",
      new THREE.BufferAttribute(new Float32Array(motes.length * 3), 3),
    );
    const colors = new Float32Array(motes.length * 3);
    const c = new THREE.Color();
    motes.forEach((m, i) => {
      // Risk is brightness, not hue: the verdict colour still has to read as
      // the verdict, so a hot SAFE node burns brighter green, never orange.
      c.set(VERDICT_COLOR[m.verdict]).multiplyScalar(0.5 + m.heat * 0.5);
      colors[i * 3] = c.r;
      colors[i * 3 + 1] = c.g;
      colors[i * 3 + 2] = c.b;
    });
    geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    return geo;
  }, [motes]);
  useEffect(() => () => moteGeo.dispose(), [moteGeo]);
  /** Written per frame from real scroll position — see the frame loop. */
  const moteMatRef = useRef<THREE.PointsMaterial>(null);

  /* ---------------- reactive severity ---------------- */

  const severity = useMemo(() => severityOf(results), [results]);
  const meanRisk = useMemo(() => {
    if (results.length === 0) return 0;
    return (
      results.reduce((n, r) => n + clamp(r.risk_score, 0, 100), 0) / results.length / 100
    );
  }, [results]);

  /**
   * The real verdict mix, as three shares of the scan. These are the exact
   * numbers the hero's proportion bar and the stat tiles render — here they
   * are spent as light instead of as type: the artifact is lit by the
   * account's own findings, and a verdict with no resources in it contributes
   * no light at all, so the lighting can never imply a finding that isn't there.
   */
  const verdictShare = useMemo(() => {
    const n = results.length;
    const of = (v: Verdict) =>
      n === 0 ? 0 : results.filter((r) => r.verdict === v).length / n;
    return {
      BLOCKED: of("BLOCKED"),
      NEEDS_REVIEW: of("NEEDS_REVIEW"),
      SAFE: of("SAFE"),
    };
  }, [results]);

  /**
   * The core's displacement amplitude. A calm account barely ripples; an
   * account where Cedar refused most of what it was asked about boils. Both
   * terms are real aggregates, so this is a readout with a skin on it.
   */
  const distortAmp = 0.05 + severity * 0.17 + meanRisk * 0.05;

  /**
   * A dense icosphere whose vertices are displaced on the CPU every frame.
   *
   * The core is a LIT surface now, so vertex density buys two things rather
   * than one: the silhouette carries the distortion, and — because the normals
   * are recomputed alongside the positions — so does the shading. Detail 12 is
   * 3380 faces over 1692 welded vertices, which is what makes the travelling
   * specular highlights break over the ripples instead of stepping across
   * visible facets.
   *
   * The weld is mandatory, not tidiness — see weldByPosition.
   */
  const coreGeo = useMemo(() => {
    const raw = new THREE.IcosahedronGeometry(1, 12);
    const welded = weldByPosition(raw);
    raw.dispose();
    return welded;
  }, []);
  const coreBase = useMemo(
    () => Float32Array.from(coreGeo.attributes.position.array as ArrayLike<number>),
    [coreGeo],
  );
  useEffect(() => () => coreGeo.dispose(), [coreGeo]);
  const coreMeshRef = useRef<THREE.Mesh>(null);
  const coreShellRef = useRef<THREE.Mesh>(null);

  const pulseCount = Math.min(layout.edges.length, MAX_PULSES);
  /** Damage propagates faster the more of the account is actually blocked. */
  const pulseRate = PULSE_RATE * (1 + severity * 0.8);

  // The risk core: the page's hero object, at the real center of the graph and
  // colored by the account's real aggregate state — not decoration, the same
  // three-state signal the kill-switch banner and stat tiles show, given the
  // scale it deserves. Its radius comes from `place` so the artifact is sized
  // against the viewport rather than against the node count: a scan of eight
  // resources still gets a centrepiece.
  const coreColor = useMemo(() => {
    if (layout.nodes.some((n) => n.verdict === "BLOCKED")) return VERDICT_COLOR.BLOCKED;
    if (layout.nodes.some((n) => n.verdict === "NEEDS_REVIEW")) return VERDICT_COLOR.NEEDS_REVIEW;
    return VERDICT_COLOR.SAFE;
  }, [layout.nodes]);
  const coreRadius = place.coreRadius;
  const coreRingRefs = useRef<(THREE.Mesh | null)[]>([]);
  const coreGlowRef = useRef<THREE.Sprite>(null);
  const coreRimRef = useRef<THREE.Sprite>(null);

  /* ---------------- the lighting rig ---------------- */

  const gl = useThree((s) => s.gl);

  /**
   * The studio, prefiltered into a real IBL. PMREM is the only env-map format
   * three's physical materials accept, and it is what lets `roughness`
   * actually blur the reflection instead of mirroring a gradient.
   *
   * Wrapped, because this is the one line in the component that touches the
   * renderer directly: a driver that refuses the float render target must cost
   * the page a duller orb, never a blank background. (CanvasBoundary would
   * catch a throw, but it would take the whole scene with it.)
   */
  const env = useMemo(() => {
    try {
      const src = makeStudioEnvTexture(verdictShare);
      const pmrem = new THREE.PMREMGenerator(gl);
      const target = pmrem.fromEquirectangular(src);
      pmrem.dispose();
      src.dispose();
      return target;
    } catch {
      return null;
    }
  }, [gl, verdictShare]);
  useEffect(() => () => env?.dispose(), [env]);

  /**
   * Four punctual lights around the artifact.
   *
   * One is a fixed cool key — the studio lamp, constant regardless of what the
   * scan found. The other three ARE the scan: one per verdict, in that
   * verdict's locked status colour, with a brightness equal to that verdict's
   * real share of the account. A clean account is lit green; an account Cedar
   * mostly refused is lit red from below. Nothing is floored, so a verdict
   * with zero resources is genuinely dark.
   *
   * `irr` is irradiance at the core's surface, not raw intensity: three's
   * lighting is physical (1/r² falloff), so the intensity a light needs
   * depends on how far out it orbits, and that distance scales with the
   * viewport. Expressing the rig in irradiance keeps it looking identical at
   * every breakpoint.
   */
  const lightRig = useMemo(
    () => [
      { color: "#eaf2ff", irr: 2.3, radius: 2.5, y: 1.5, phase: 0.85, speed: 0.043 },
      { color: VERDICT_COLOR.BLOCKED, irr: verdictShare.BLOCKED * 4.4, radius: 2.15, y: -0.95, phase: 3.6, speed: 0.031 },
      { color: VERDICT_COLOR.NEEDS_REVIEW, irr: verdictShare.NEEDS_REVIEW * 4.4, radius: 2.6, y: 0.45, phase: 5.35, speed: -0.024 },
      { color: VERDICT_COLOR.SAFE, irr: verdictShare.SAFE * 4.4, radius: 2.3, y: -1.65, phase: 1.9, speed: 0.037 },
    ],
    [verdictShare],
  );
  const lightRefs = useRef<(THREE.PointLight | null)[]>([]);

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
    // composition intact, where a lookAt() would rock the artifact back across
    // the headline.
    const p = pointerRef.current;
    const scrolled = scrollRef.current;
    // Three incommensurable periods (94s / 153s / 217s) so the drift never
    // visibly repeats — the scene is always moving and never loops.
    const driftX = reduced ? 0 : Math.sin(t * 0.067) * DRIFT_X;
    const driftY = reduced ? 0 : Math.sin(t * 0.041) * DRIFT_Y;
    const driftZ = reduced ? 0 : Math.sin(t * 0.029) * DRIFT_Z;
    camTarget.set(
      reduced ? 0 : p.x * PARALLAX_X + driftX,
      reduced ? 0 : -p.y * PARALLAX_Y + driftY,
      // As the page scrolls past the hero the graph recedes, so it settles
      // into a background behind the verdict table instead of competing.
      BASE_CAMERA_Z + scrolled * 2.4 + driftZ,
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
      const u = reduced ? 0.5 : (t * pulseRate + i * 0.37) % 1;
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

    /*
      The lights orbit. This is the single most important motion in the scene
      now: the artifact itself barely turns, so what moves across its surface
      is the LIGHT — a hard cool key sweeping one way, the verdict lamps
      crossing the other, specular highlights breaking over the ripples.
      Three different periods, none a multiple of another, so the rig never
      returns to the same pose.
    */
    for (let i = 0; i < lightRig.length; i++) {
      const light = lightRefs.current[i];
      if (!light) continue;
      const rig = lightRig[i];
      const a = rig.phase + (reduced ? 0 : t * rig.speed);
      light.position.set(
        Math.cos(a) * rig.radius * coreRadius,
        rig.y * coreRadius,
        Math.sin(a) * rig.radius * coreRadius,
      );
    }

    // Slow ambient pulse on the core's glow — same 8-14s cinematic band as
    // every other glow on the page, never a fast blink. A blocked-heavy
    // account burns brighter at the same cadence.
    if (coreGlowRef.current) {
      const pulse = reduced ? 1 : 0.85 + Math.sin(t * (Math.PI * 2) / 10) * 0.15;
      coreGlowRef.current.material.opacity = (0.33 + severity * 0.24) * pulse;
    }
    // The refractive lip breathes on its own, slower period — so the rim and
    // the bloom are never at peak together and the object keeps shifting.
    if (coreRimRef.current) {
      const pulse = reduced ? 1 : 0.8 + Math.sin(t * (Math.PI * 2) / 13 + 1.1) * 0.2;
      coreRimRef.current.material.opacity = 0.78 * pulse;
    }

    /*
      The core's surface. Three orthogonal sine waves multiplied together give
      a cheap, seamless, seed-free 3D field — the displacement equivalent of
      the distort material, without pulling a shader library in. Vertices are
      pushed along their own radius from the pristine copy in `coreBase`, so
      the deformation never accumulates or drifts off the unit sphere.

      Two octaves, not one. At the frequencies this started with (~2.1 on a
      unit sphere) a single wave is a third of a cycle across the whole
      object — readable as a wobble on a 60px blob, invisible on a 530px one.
      The first octave is the slow heave that still shapes the silhouette; the
      second, roughly twice the frequency at a tenth the amplitude, is the fine
      boil that gives the highlights something to break over. Both numbers are
      ceilings found by looking: push the second octave much past this and the
      key light's specular shatters into speckle instead of travelling.
    */
    const corePos = coreGeo.attributes.position;
    const arr = corePos.array as Float32Array;
    const tt = reduced ? 0 : t * 0.55;
    for (let i = 0; i < arr.length; i += 3) {
      const x = coreBase[i];
      const y = coreBase[i + 1];
      const z = coreBase[i + 2];
      const n =
        Math.sin(x * 3.1 + tt) *
          Math.sin(y * 3.7 - tt * 0.83) *
          Math.sin(z * 3.3 + tt * 0.61) +
        0.1 *
          Math.sin(x * 7.3 - tt * 1.4) *
          Math.sin(y * 7.9 + tt * 1.1) *
          Math.sin(z * 7.6 - tt * 1.7);
      const d = 1 + distortAmp * n;
      arr[i] = x * d;
      arr[i + 1] = y * d;
      arr[i + 2] = z * d;
    }
    corePos.needsUpdate = true;
    // The surface is lit now, so displacing it without recomputing normals
    // would leave the shading perfectly smooth over a rippling silhouette —
    // the single tell that separates a real displaced surface from a sphere
    // with a bumpy outline. 3380 welded faces is a sub-millisecond cost.
    coreGeo.computeVertexNormals();

    // A breath on the whole core, and a wireframe shell turning against it so
    // the object reads as a containment field around something unstable
    // rather than as one spinning ball.
    if (coreMeshRef.current && !reduced) {
      coreMeshRef.current.scale.setScalar(coreRadius * (1 + Math.sin(t * 0.45) * 0.035));
    }
    if (coreShellRef.current && !reduced) {
      coreShellRef.current.rotation.y = -t * 0.11;
      coreShellRef.current.rotation.x = Math.sin(t * 0.07) * 0.5;
    }

    /*
      The evidence field. Each mote rides a circle in its own plane around the
      resource the record belongs to, with a slow radial breath so the shell
      never crystallises into a set of clean rings.

      Real scroll position is the second input: as the hero leaves, every orbit
      widens and the whole field dims, so the tight evidence shells around each
      resource disperse into ambient dust behind the sections below. The motion
      is genuinely scroll-linked — it does not run on its own — and it fades as
      it spreads, so the field never competes with the verdict table's type.
    */
    if (motes.length > 0) {
      const spread = 1 + scrolled * 1.1;
      const motePos = moteGeo.attributes.position;
      const marr = motePos.array as Float32Array;
      for (let i = 0; i < motes.length; i++) {
        const m = motes[i];
        const c = placed[m.owner];
        if (!c) continue;
        const a = m.phase + (reduced ? 0 : t * m.speed);
        const cos = Math.cos(a);
        const sin = Math.sin(a);
        const r =
          m.radius *
          place.nodeScale *
          spread *
          (reduced ? 1 : 1 + Math.sin(t * 0.4 + m.phase) * 0.12);
        marr[i * 3] = c.x + (m.u.x * cos + m.v.x * sin) * r;
        marr[i * 3 + 1] = c.y + (m.u.y * cos + m.v.y * sin) * r;
        marr[i * 3 + 2] = c.z + (m.u.z * cos + m.v.z * sin) * r;
      }
      motePos.needsUpdate = true;
      if (moteMatRef.current) moteMatRef.current.opacity = 0.9 - scrolled * 0.55;
    }
  });

  return (
    <group position={[place.centerX, place.centerY, 0]}>
      {/*
        The risk core — real aggregate state, given real visual weight.

        It sits OUTSIDE the spinning group on purpose. The evidence structure
        orbits; the artifact is held still and dead-on, and what moves across
        it is the light. That is the whole difference between a spinning ball
        and a lit object.
      */}
      <group>
        {/*
          The rig. One fixed cool key plus one lamp per verdict, each burning
          at that verdict's real share of the scan (see `lightRig`). Nothing
          else in this scene is lit — every node, edge, mote and ring is an
          unlit readout — so these four lights touch exactly one object: the
          core. Adding them cannot change what any data-bearing colour means.
        */}
        <ambientLight intensity={0.16} color="#6f83ad" />
        {lightRig.map((rig, i) => (
          <pointLight
            key={i}
            ref={(l) => {
              lightRefs.current[i] = l;
            }}
            color={rig.color}
            // Physical falloff: intensity is irradiance x distance². See lightRig.
            intensity={rig.irr * Math.pow(rig.radius * coreRadius, 2)}
            decay={2}
          />
        ))}

        {/*
          Two anamorphic streaks through the artifact's waist — the lens flare
          the reference direction leans on. The wide one carries the account's
          real dominant verdict colour; the short one is the cool key's own
          flare, which is what sells the two as the same optical event.
        */}
        <sprite
          scale={[coreRadius * 11, coreRadius * 0.8, 1]}
          position={[0, coreRadius * 0.12, -coreRadius * 0.4]}
        >
          <spriteMaterial
            map={streakTex}
            color={coreColor}
            transparent
            opacity={0.2 + severity * 0.14}
            blending={THREE.AdditiveBlending}
            depthWrite={false}
            fog={false}
            toneMapped={false}
          />
        </sprite>
        <sprite
          scale={[coreRadius * 6, coreRadius * 0.34, 1]}
          position={[coreRadius * 0.25, coreRadius * 0.52, -coreRadius * 0.3]}
        >
          <spriteMaterial
            map={streakTex}
            color="#9fc4ff"
            transparent
            opacity={0.22}
            blending={THREE.AdditiveBlending}
            depthWrite={false}
            fog={false}
            toneMapped={false}
          />
        </sprite>

        {/* A fixed cool-blue ambient undertone, offset behind the real-state
            glow — the same identity color as the hero's own glow, so the
            core reads as a two-tone plasma object rather than a flat
            single-hue ball, without diluting what the dominant color means. */}
        <sprite
          scale={[coreRadius * 8, coreRadius * 8, 1]}
          position={[coreRadius * 0.3, -coreRadius * 0.2, -coreRadius * 0.5]}
        >
          <spriteMaterial
            map={glowTex}
            color="#3B82F6"
            transparent
            opacity={0.2}
            blending={THREE.AdditiveBlending}
            depthWrite={false}
            fog={false}
            toneMapped={false}
          />
        </sprite>

        {/*
          The artifact itself: a clearcoated gunmetal, not an emissive blob.

          That choice does two jobs at once. It is what makes the object read
          as a dramatically lit THING — most of its surface falls away into
          shadow, and the light that lands on it is the account's own verdict
          mix — and it is what keeps 140px of white display type legible where
          the headline crosses it, because an unlit emissive fill at this
          scale would be a floodlight behind the type.

          The base colour is deliberately neutral. On a metal, `color` tints
          the reflection, so a coloured body would put the verdict hue
          everywhere and make it mean nothing; keeping the metal grey means
          every scrap of colour on this object arrives as LIGHT — the verdict
          lamps, the studio blob in the env map, the sheen — which is the only
          honest way to render a readout as a surface. Iridescence gives the
          prismatic shift at the terminator, clearcoat gives the hard white
          specular the lamps rake across, and the emissive floor means the
          dominant verdict is present even where nothing is lighting it.
        */}
        <mesh ref={coreMeshRef} geometry={coreGeo} scale={coreRadius}>
          <meshPhysicalMaterial
            color="#545a6c"
            metalness={0.84}
            roughness={0.29}
            clearcoat={1}
            clearcoatRoughness={0.12}
            iridescence={0.85}
            iridescenceIOR={1.5}
            iridescenceThicknessRange={[120, 520]}
            sheen={0.35}
            sheenColor={coreColor}
            sheenRoughness={0.5}
            emissive={coreColor}
            emissiveIntensity={0.05 + severity * 0.09}
            envMap={env?.texture ?? null}
            envMapIntensity={1.4}
            fog={false}
          />
        </mesh>

        {/*
          The refractive lip. A billboarded annulus just outside the
          silhouette, which is where a polished object throws its brightest
          chromatic edge. Drawn rather than shaded — see makeRimTexture.

          The 2.6 is load-bearing: the texture's bright ring sits at 93% of the
          sprite's half-size, i.e. 1.21 core radii, while the displaced surface
          only ever reaches 1 + distortAmp (0.27 at the theoretical worst, ~0.14
          on a real payload). So the lip always clears the silhouette and is
          never swallowed by the depth test, while its inner feather still
          overlaps the edge it is supposed to be hugging.
        */}
        <sprite ref={coreRimRef} scale={[coreRadius * 2.6, coreRadius * 2.6, 1]}>
          <spriteMaterial
            map={rimTex}
            color="#d8e6ff"
            transparent
            opacity={0.78}
            blending={THREE.AdditiveBlending}
            depthWrite={false}
            fog={false}
            toneMapped={false}
          />
        </sprite>

        {/* Containment shell: a coarse wireframe cage turning against the
            core's own spin. It brightens with the real blocked share, so the
            cage looks like it is straining on a bad account. */}
        <mesh ref={coreShellRef} scale={coreRadius * 1.5}>
          <icosahedronGeometry args={[1, 1]} />
          <meshBasicMaterial
            color={coreColor}
            wireframe
            transparent
            opacity={0.13 + severity * 0.24}
            depthWrite={false}
            toneMapped={false}
          />
        </mesh>

        {/*
          The armature. Three gyroscope hoops on independent axes.

          Radius and tube are both deliberately small. A hoop at 2.4 core radii
          is a 600px arc at 1440, and a 600px arc with any visible thickness
          stops being an armature and becomes a grey band sweeping through the
          headline — which is precisely what it did on the first pass. Held at
          1.9 radii and a 0.009 tube they stay inside the artifact's own
          footprint and read as structure, not as smears. The middle hoop is
          cool white — the key light's own colour — so the set does not read as
          three copies of one ring.
        */}
        {[1.28, 1.48, 1.72].map((mult, i) => (
          <mesh
            key={i}
            ref={(m) => {
              coreRingRefs.current[i] = m;
            }}
            scale={coreRadius * mult}
          >
            <torusGeometry args={[1, 0.006, 8, 128]} />
            <meshBasicMaterial
              color={i === 1 ? "#cfe0ff" : coreColor}
              transparent
              opacity={0.26 + severity * 0.16 - i * 0.06}
              blending={THREE.AdditiveBlending}
              depthWrite={false}
              toneMapped={false}
            />
          </mesh>
        ))}

        {/*
          Layered bloom. Three additive falloffs at different radii rather than
          one: a tight hot centre, the mid halo that carries the account's real
          state, and a wide atmospheric wash that puts light on the void itself.
          Stacking them is what gives the glow a real curve instead of the flat
          disc a single sprite always reads as.
        */}
        <sprite scale={[coreRadius * 2.9, coreRadius * 2.9, 1]}>
          <spriteMaterial
            map={glowTex}
            color="#ffffff"
            transparent
            opacity={0.13 + severity * 0.1}
            blending={THREE.AdditiveBlending}
            depthWrite={false}
            fog={false}
            toneMapped={false}
          />
        </sprite>
        <sprite ref={coreGlowRef} scale={[coreRadius * 6, coreRadius * 6, 1]}>
          <spriteMaterial
            map={glowTex}
            color={coreColor}
            transparent
            opacity={0.34}
            blending={THREE.AdditiveBlending}
            depthWrite={false}
            fog={false}
            toneMapped={false}
          />
        </sprite>
        <sprite scale={[coreRadius * 11, coreRadius * 11, 1]} position={[0, 0, -coreRadius]}>
          <spriteMaterial
            map={glowTex}
            color={coreColor}
            transparent
            opacity={0.16}
            blending={THREE.AdditiveBlending}
            depthWrite={false}
            fog={false}
            toneMapped={false}
          />
        </sprite>
      </group>

      {/* Everything below is the evidence, and the evidence is what orbits. */}
      <group ref={groupRef}>
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

      {/*
        The evidence field — one point per real record in the payload, orbiting
        the resource it was found on. This is where the scene gets its depth
        and its ambient shimmer, and not one mote of it is padding.
      */}
      {motes.length > 0 ? (
        <points geometry={moteGeo}>
          <pointsMaterial
            ref={moteMatRef}
            map={glowTex}
            size={0.15 * place.nodeScale}
            sizeAttenuation
            vertexColors
            transparent
            opacity={0.9}
            blending={THREE.AdditiveBlending}
            depthWrite={false}
            toneMapped={false}
          />
        </points>
      ) : null}

      {layout.edges.length > 0 ? (
        <lineSegments geometry={edgeGeometry}>
          <lineBasicMaterial
            color={HAZARD}
            transparent
            opacity={0.55 + severity * 0.35}
            toneMapped={false}
          />
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
 * than guessed: the hero's longest line ("this resource") measures ~7.9em in
 * Unbounded 900 at .mirror-display-crush's -0.055em tracking, at font-size
 * clamp(1.9rem, 8.6vw, 8.2rem) — Hero.tsx's CLAIM_SIZE, which these two
 * numbers must be kept in step with — offset by the hero's md:px-12 gutter. So the
 * veil tracks the actual right edge of the headline at every viewport width
 * instead of drifting off it at, say, 1440px where the type occupies ~80% of
 * the screen.
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
  --hero-text-edge: calc(48px + 7.9 * clamp(1.9rem, 8.6vw, 8.2rem));
  position: absolute;
  inset: 0;
  /*
    The veil is now a RAKING light, not a blanket. The previous ramp held
    ~0.86 all the way out to the headline's right edge and only cleared 12vw
    later, which on a 1440 screen meant the scene was only ever visible in the
    right 6% of the frame — the single reason the artifact read as dim and
    cornered. These stops are expressed as fractions of the same real type
    metric, so the darkness still tracks the headline, but it is spent almost
    entirely on the left column where the type actually lives and is gone by
    the time it reaches the artifact.
  */
  background: linear-gradient(
    to right,
    rgba(10, 10, 10, 0.94) 0,
    rgba(10, 10, 10, 0.9) calc(var(--hero-text-edge) * 0.26),
    rgba(10, 10, 10, 0.62) calc(var(--hero-text-edge) * 0.5),
    rgba(10, 10, 10, 0.18) calc(var(--hero-text-edge) * 0.74),
    rgba(10, 10, 10, 0.04) calc(var(--hero-text-edge) * 0.92),
    rgba(10, 10, 10, 0) calc(var(--hero-text-edge) * 1.06)
  );
  -webkit-mask-image: linear-gradient(to bottom, transparent 2%, #000 19%, #000 84%, transparent 99%);
  mask-image: linear-gradient(to bottom, transparent 2%, #000 19%, #000 84%, transparent 99%);
  transition: opacity 200ms linear;
  will-change: opacity;
}

/* Always on: keeps the graph from reading as wallpaper and holds the nav and
   the verdict table on solid ground at the top and bottom of the viewport.
   The radial term is re-centred on the artifact (62% / 48%) and opened up, so
   the vignette frames the core rather than cropping its glow. */
.mirror-graph-vignette {
  position: absolute;
  inset: 0;
  background:
    linear-gradient(to bottom, rgba(10, 10, 10, 0.74) 0, rgba(10, 10, 10, 0) 14%),
    linear-gradient(to top, rgba(10, 10, 10, 0.66) 0, rgba(10, 10, 10, 0) 18%),
    radial-gradient(ellipse 132% 104% at 62% 48%, rgba(10, 10, 10, 0) 44%, rgba(10, 10, 10, 0.74) 100%);
}

/*
  Caustics — the light the artifact throws back onto the void around it.

  Four soft elliptical fields on screen-blend, drifting against each other on a
  26s cycle that shares no factor with the 3D drift periods, so the pattern
  never repeats.

  Every stop here is an ellipse with a long fade. A conic gradient was the
  obvious way to get refracted spokes and it is the wrong tool: its stops are
  hard angular edges, and over a lit sphere they render as opaque pie wedges
  across the whole hero. Caustics are soft or they are nothing.
*/
.mirror-graph-caustics {
  position: absolute;
  inset: 0;
  mix-blend-mode: screen;
  background:
    radial-gradient(ellipse 22% 34% at 70% 30%, rgba(150, 190, 255, 0.09), transparent 70%),
    radial-gradient(ellipse 30% 18% at 52% 70%, rgba(255, 70, 70, 0.05), transparent 72%),
    radial-gradient(ellipse 14% 26% at 78% 58%, rgba(200, 220, 255, 0.05), transparent 74%),
    radial-gradient(ellipse 40% 14% at 62% 44%, rgba(255, 150, 120, 0.035), transparent 76%);
  animation: mirror-caustics 26s ease-in-out infinite;
  will-change: transform, opacity;
}

@keyframes mirror-caustics {
  0%, 100% { transform: translate3d(-1.6%, -1.1%, 0) scale(1.02); opacity: 0.4; }
  50% { transform: translate3d(1.9%, 1.5%, 0) scale(1.1); opacity: 0.72; }
}

/*
  Portrait: the headline runs the full width, so a left-weighted veil would
  simply black out the whole screen. The veil turns through ninety degrees
  with the graph — a horizontal band protecting the type, clearing for the
  lower third the artifact has moved into. It never reaches zero on this axis,
  because on a phone the readout rail sits directly over the core.
*/
@media (max-aspect-ratio: 1 / 1) {
  .mirror-graph-veil {
    background: linear-gradient(
      to bottom,
      rgba(10, 10, 10, 0.95) 0,
      rgba(10, 10, 10, 0.92) 40%,
      rgba(10, 10, 10, 0.62) 56%,
      rgba(10, 10, 10, 0.4) 72%,
      rgba(10, 10, 10, 0.34) 100%
    );
    -webkit-mask-image: none;
    mask-image: none;
  }
  .mirror-graph-vignette {
    background:
      linear-gradient(to bottom, rgba(10, 10, 10, 0.7) 0, rgba(10, 10, 10, 0) 13%),
      radial-gradient(ellipse 140% 104% at 50% 62%, rgba(10, 10, 10, 0) 48%, rgba(10, 10, 10, 0.7) 100%);
  }
  .mirror-graph-caustics {
    background:
      radial-gradient(ellipse 52% 22% at 50% 66%, rgba(150, 190, 255, 0.08), transparent 72%),
      radial-gradient(ellipse 60% 16% at 50% 78%, rgba(255, 60, 60, 0.045), transparent 74%);
  }
}

@media (prefers-reduced-motion: reduce) {
  .mirror-graph-veil { transition: none; }
  .mirror-graph-caustics { animation: none; opacity: 0.5; }
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
  const sceneRef = useRef<HTMLDivElement>(null);
  const pointerRef = useRef({ x: 0, y: 0 });
  const scrollRef = useRef(0);

  const live = webgl && results.length > 0;

  /**
   * One scroll listener for the whole page's depth.
   *
   * It publishes two things. `scrollRef` (0-1 through the hero) is what the 3D
   * scene reads. `--mirror-scroll-y` — raw scrollY as a bare number on the
   * document element — is what index.css reads to parallax the fixed
   * atmosphere layers (grid, grain, halftone) against each other, which is how
   * the page gets depth below the fold without a second listener or a single
   * extra DOM node. Deliberately NOT gated on `live`: a machine with no WebGL
   * still gets the parallax, because none of it is 3D.
   */
  useEffect(() => {
    if (typeof window === "undefined") return;

    let queued = 0;

    const applyScroll = () => {
      queued = 0;
      const y = window.scrollY;
      const vh = Math.max(window.innerHeight, 1);
      const p = clamp(y / vh, 0, 1);
      scrollRef.current = p;
      if (veilRef.current) veilRef.current.style.opacity = String(1 - p * 0.8);
      document.documentElement.style.setProperty("--mirror-scroll-y", y.toFixed(1));

      /* The orb is now large enough to dominate the frame, which is exactly
         what the hero wants — but this canvas is `fixed`, so without this it
         stays that bright and that big behind every section all the way to
         the footer, fighting unbacked section text (the legend, the
         account-signal cluster) for contrast. It has no business being
         anything but a faint ambient presence once you're two hero-heights
         past it, so the whole scene (canvas + caustics + vignette; the veil
         already fades on its own, faster, for the hero text itself) recedes
         from full presence to a quiet 14% over that stretch and holds there
         — never fully gone, so the "living background" behind later panels
         survives, just no longer competing with anything printed on it. */
      const recede = clamp((y - vh * 0.55) / (vh * 0.75), 0, 1);
      if (sceneRef.current) sceneRef.current.style.opacity = String(1 - recede * 0.94);
    };

    const onScroll = () => {
      if (!queued) queued = requestAnimationFrame(applyScroll);
    };

    applyScroll();
    window.addEventListener("scroll", onScroll, { passive: true });

    return () => {
      if (queued) cancelAnimationFrame(queued);
      window.removeEventListener("scroll", onScroll);
    };
  }, []);

  useEffect(() => {
    if (!live || reduced) return;

    const onPointerMove = (e: PointerEvent) => {
      pointerRef.current.x = (e.clientX / window.innerWidth) * 2 - 1;
      pointerRef.current.y = (e.clientY / window.innerHeight) * 2 - 1;
    };

    window.addEventListener("pointermove", onPointerMove, { passive: true });
    return () => window.removeEventListener("pointermove", onPointerMove);
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
      <div ref={sceneRef} className="absolute inset-0">
        <CanvasBoundary>
          <Canvas
            dpr={[1, 1.75]}
            frameloop={reduced ? "demand" : "always"}
            camera={{ position: [0, 0, BASE_CAMERA_Z], fov: 50 }}
            gl={{ antialias: true, powerPreference: "high-performance" }}
          >
            {/* Fog carries depth for the EVIDENCE — nodes, edges, motes, pulses
                are all still unlit readout points, and the void swallowing the
                far side of the structure is what makes the shell read as a
                volume. The core opts out (fog={false}); it is a lit object with
                its own rig and it is meant to sit in front of all of this.
                Pushed out from 10-22 to 11-26 because the structure is now
                roughly twice as deep as it was. */}
            <fog attach="fog" args={[VOID, 11, 26]} />
            <GraphScene
              results={results}
              reduced={reduced}
              pointerRef={pointerRef}
              scrollRef={scrollRef}
            />
          </Canvas>
        </CanvasBoundary>
        <div className="mirror-graph-caustics" />
        <div className="mirror-graph-vignette" />
      </div>
      <div ref={veilRef} className="mirror-graph-veil" />
    </div>
  );
}
