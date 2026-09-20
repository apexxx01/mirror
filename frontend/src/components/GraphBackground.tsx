import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Component, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode, RefObject } from "react";
import * as THREE from "three";
import type { MirrorResult, Verdict } from "../types";

/**
 * GraphBackground — the real AWS dependency graph, rendered as a quasar.
 *
 * Every mark on screen is something Mirror actually found. `results.length`
 * spheres, exactly one line per real entry in `dependents`, one orbiting mote
 * per real evidence record, and one streaming ASCII glyph per real field —
 * resource names, Cedar decisions, policy ids, blast-radius hops, CloudWatch
 * error counts, decision-matrix scenarios, rollback steps. Nothing here is
 * padded out with decorative particles. That constraint is the whole point: a
 * background that is literally the evidence.
 *
 * The centrepiece is a black hole.
 *
 *  - The EVENT HORIZON is the darkest object in the scene — a pure #000 sphere
 *    that writes depth and emits nothing. It is not drawn so much as carved:
 *    every glow, streak, halo and disk fragment behind it is depth-culled by
 *    its silhouette, so the hole is a genuine absence punched through the
 *    light rather than a black ball painted on top of it. That is also what
 *    makes 140px of white Unbounded survive crossing it.
 *
 *  - The ACCRETION DISK is the hero's verdict spectrum bar, revolved. Hot
 *    white-blue at the inner edge, then radial colour bands whose WIDTHS are
 *    the account's real verdict shares in the three locked status hues — a
 *    verdict with no resources in it occupies no band at all, so the disk can
 *    never imply a finding that isn't there. It shears Keplerian (inner
 *    material laps the rim) and is Doppler-beamed on the approaching limb.
 *
 *  - The GLYPH STREAM is the telemetry: real strings from the payload, drawn
 *    into a canvas atlas and flung outward through the disk plane on instanced
 *    billboards. Glyphs from resources Cedar refused ride the polar jets
 *    instead — refusals are what the quasar ejects.
 *
 *  - The NEBULA behind it is the scan again, blurred into gas: one soft cloud
 *    per scanned resource, sized by how much evidence Mirror holds on it and
 *    tinted by its verdict, pulled most of the way toward a deep indigo so it
 *    reads as depth rather than as a status signal.
 *
 * Two facts about the real payload shaped every decision below:
 *
 *  1. The graph is SMALL. Mirror's sandbox produces ~9 resources and ~3 edges.
 *     A scatter of nine 6px dots is not a centrepiece, so the presence has to
 *     come from how much each real record is worth looking at.
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
 * The quasar is the centrepiece, and the composition (see `place`) leaves real
 * clearance on both sides, so the parallax is symmetric rather than being spent
 * entirely on protecting the headline's right edge.
 */
const PARALLAX_X = 0.34;
const PARALLAX_Y = 0.24;

/**
 * Camera drift, on top of the parallax pan — a slow breath so the scene is
 * never still even when the pointer is. The Z term is a dolly.
 */
const DRIFT_X = 0.3;
const DRIFT_Y = 0.46;
const DRIFT_Z = 0.62;

/**
 * The disk's resting inclination. Shallow enough that the ring reads as a disk
 * seen at an angle (the iconic silhouette) and steep enough that the far limb
 * clears the horizon's top edge.
 */
const DISK_TILT = -0.42;
/** How far the cursor is allowed to tip the disk. Real interactivity, small amplitude. */
const DISK_TILT_POINTER = 0.13;

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
 * Billboarded just outside the horizon this is the photon ring: the last stable
 * orbit of light, which is the one feature that makes a black sphere read as a
 * black HOLE rather than as a dead pixel.
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
 * Two of these, additively blended behind the horizon, are the quasar's glare.
 * Building it as one texture rather than a post-processing flare pass keeps the
 * no-new-dependency rule intact and costs two more sprites.
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
 * The gravitational lens, drawn rather than traced.
 *
 * A real black hole bends the light of the disk material BEHIND it up and over
 * the top (and under the bottom) of the horizon, which is why the iconic
 * silhouette is a flat ring with a second ring standing vertically through it.
 * Ray-marching a Schwarzschild metric for that is a whole shader budget; the
 * honest cheap version is an annulus whose alpha is modulated by ANGLE —
 * strongest at the poles of the silhouette, zero at the sides where the flat
 * disk already covers the frame — billboarded so it always stands up against
 * the camera. The top limb is brighter than the bottom, which is what sells it
 * as light arriving over the horizon rather than as a decorative halo.
 *
 * One per-pixel pass over 256x256 at mount. Nothing per frame.
 */
function makeLensTexture(): THREE.Texture {
  const size = 256;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const img = ctx.createImageData(size, size);
  const data = img.data;
  const half = size / 2;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const nx = (x - half) / half;
      const ny = (y - half) / half;
      const r = Math.hypot(nx, ny);
      // A thin bright band at 0.8 of the half-size, feathered on both sides.
      const band = Math.exp(-Math.pow((r - 0.8) / 0.075, 2));
      // Poles bright, sides clear. |sin| peaks at the top and bottom of the ring.
      const ang = Math.atan2(ny, nx);
      const pole = Math.pow(Math.abs(Math.sin(ang)), 2.6);
      // The upper limb carries more of the lensed light than the lower.
      const bias = ny < 0 ? 1 : 0.55;
      const a = clamp(band * pole * bias, 0, 1);
      const i = (y * size + x) * 4;
      data[i] = 255;
      data[i + 1] = 255;
      data[i + 2] = 255;
      data[i + 3] = Math.round(a * 255);
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/**
 * The bipolar jet: a double-ended plume, narrow and white-hot at the horizon,
 * widening and cooling as it leaves.
 *
 * Drawn symmetric about the centre so a single plane carries both poles, and
 * cylindrically billboarded at render time (rotated about its own axis to face
 * the camera) rather than sprite-billboarded, because a jet has to stay welded
 * to the disk's normal as the disk tilts.
 */
function makeJetTexture(): THREE.Texture {
  const w = 128;
  const h = 512;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d")!;
  const img = ctx.createImageData(w, h);
  const data = img.data;

  for (let y = 0; y < h; y++) {
    const ny = (y / (h - 1)) * 2 - 1; // -1 top, +1 bottom
    const ay = Math.abs(ny);
    const halfWidth = 0.055 + 0.46 * Math.pow(ay, 1.35);
    const falloff = Math.pow(1 - ay, 1.15);
    for (let x = 0; x < w; x++) {
      const nx = (x / (w - 1)) * 2 - 1;
      const sheath = Math.exp(-Math.pow(nx / halfWidth, 2) * 2.1);
      const core = Math.exp(-Math.pow(nx / (halfWidth * 0.3), 2) * 2.6);
      const a = clamp(falloff * (sheath * 0.62 + core * 0.55), 0, 1);
      const i = (y * w + x) * 4;
      data[i] = 255;
      data[i + 1] = 255;
      data[i + 2] = 255;
      data[i + 3] = Math.round(a * 255);
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/**
 * One nebula cloud, as a soft clump of overlapping falloffs rather than a
 * single gradient — a lone radial gradient reads as a headlight, and gas does
 * not have a centre. Deterministic from `seed` (FNV-1a, no Math.random), and
 * masked by a global radial falloff so the sprite never shows its own square.
 */
function makeNebulaTexture(seed: number): THREE.Texture {
  const size = 256;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;

  for (let i = 0; i < 22; i++) {
    const h1 = hashUnit(`neb${seed}/x${i}`);
    const h2 = hashUnit(`neb${seed}/y${i}`);
    const h3 = hashUnit(`neb${seed}/r${i}`);
    const cx = size * (0.5 + (h1 - 0.5) * 0.66);
    const cy = size * (0.5 + (h2 - 0.5) * 0.66);
    const rad = size * (0.1 + h3 * 0.26);
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, rad);
    g.addColorStop(0, `rgba(255,255,255,${(0.1 + h3 * 0.14).toFixed(3)})`);
    g.addColorStop(0.55, `rgba(255,255,255,${(0.03 + h3 * 0.05).toFixed(3)})`);
    g.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = g;
    ctx.fillRect(cx - rad, cy - rad, rad * 2, rad * 2);
  }

  // Kill the square. Everything past 50% of the half-size fades to nothing.
  ctx.globalCompositeOperation = "destination-in";
  const mask = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  mask.addColorStop(0, "rgba(0,0,0,1)");
  mask.addColorStop(0.5, "rgba(0,0,0,0.85)");
  mask.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = mask;
  ctx.fillRect(0, 0, size, size);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/* ------------------------------------------------------------------ *
 * The glyph atlas
 * ------------------------------------------------------------------ */

const TILE_W = 256;
const TILE_H = 64;
const ATLAS_COLS = 8;
/** 16 rows x 8 columns. Past this the payload has more distinct strings than
 *  one 2048x1024 texture can carry, and the surplus glyphs are DROPPED rather
 *  than pointed at somebody else's label. */
export const MAX_TILES = ATLAS_COLS * 16;

interface GlyphAtlas {
  texture: THREE.Texture;
  /** text -> (uv offset x, uv offset y, uv scale x, uv scale y). */
  tiles: Map<string, THREE.Vector4>;
  /** text -> the glyph's real aspect ratio (width / height), so the quad fits it. */
  aspect: Map<string, number>;
}

/**
 * Every distinct real string in the payload, rendered once into a tiled canvas.
 *
 * Tiles are fixed-size but the text inside them is not, so each tile also
 * records the fraction of its width the string actually occupies — the
 * instanced quad is then scaled to that fraction, which is what keeps
 * "SAFE" from being stretched across the same box as
 * "via env_var:REPORTS…".
 */
function buildGlyphAtlas(texts: string[]): GlyphAtlas {
  const unique = Array.from(new Set(texts)).slice(0, MAX_TILES);
  const rows = Math.max(1, Math.ceil(unique.length / ATLAS_COLS));
  const canvas = document.createElement("canvas");
  canvas.width = TILE_W * ATLAS_COLS;
  canvas.height = TILE_H * rows;
  const ctx = canvas.getContext("2d")!;
  // Space Mono is the page's universal UI voice; the fallbacks are all
  // monospaced too, so a glyph that renders before the webfont lands still
  // reads as terminal output rather than as prose.
  ctx.font = '700 34px "Space Mono", ui-monospace, SFMono-Regular, Menlo, monospace';
  ctx.textBaseline = "middle";
  ctx.fillStyle = "#ffffff";

  const tiles = new Map<string, THREE.Vector4>();
  const aspect = new Map<string, number>();

  unique.forEach((text, i) => {
    const col = i % ATLAS_COLS;
    const row = Math.floor(i / ATLAS_COLS);
    const ox = col * TILE_W;
    const oy = row * TILE_H;
    ctx.fillText(text, ox + 6, oy + TILE_H / 2, TILE_W - 12);
    const used = Math.min(ctx.measureText(text).width + 12, TILE_W);
    const frac = used / TILE_W;
    tiles.set(
      text,
      new THREE.Vector4(
        (col * TILE_W) / canvas.width,
        // CanvasTexture flips on upload, so canvas row `row` lives at
        // v = 1 - (row + 1) * tileHeight.
        1 - ((row + 1) * TILE_H) / canvas.height,
        (frac * TILE_W) / canvas.width,
        TILE_H / canvas.height,
      ),
    );
    aspect.set(text, (frac * TILE_W) / TILE_H);
  });

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  // No mipmaps: at a couple of hundred pixels per glyph the minified levels
  // would only bleed neighbouring tiles into each other.
  texture.generateMipmaps = false;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;

  return { texture, tiles, aspect };
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
 * per-frame CPU bill. The real sandbox produces ~58 motes; this is ~24x that.
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
 * reactive intensity in the scene — jet brightness, Doppler beaming, glow,
 * edge opacity, pulse speed — so a clean account renders calm and a
 * compromised one renders violent, from real data rather than a mood setting.
 */
export function severityOf(results: MirrorResult[]): number {
  if (results.length === 0) return 0;
  return results.filter((r) => r.verdict === "BLOCKED").length / results.length;
}

/**
 * The real verdict mix, as three shares of the scan summing to 1.
 *
 * These are the exact numbers the hero's proportion bar and the stat tiles
 * render. Here they are spent as the accretion disk's radial colour bands: the
 * hero's spectrum bar, revolved. A verdict with no resources in it gets a band
 * of zero width, so the disk cannot imply a finding that isn't there.
 */
export function verdictShares(results: MirrorResult[]): Record<Verdict, number> {
  const n = results.length;
  const of = (v: Verdict) => (n === 0 ? 0 : results.filter((r) => r.verdict === v).length / n);
  return { BLOCKED: of("BLOCKED"), NEEDS_REVIEW: of("NEEDS_REVIEW"), SAFE: of("SAFE") };
}

/* ------------------------------------------------------------------ *
 * The glyph stream
 * ------------------------------------------------------------------ */

/** Long enough for "via env_var:REPORTS_BUC…" to still be a sentence. */
export const GLYPH_MAX_CHARS = 22;
/** ~13 glyphs per resource on the real payload; this is ~24 resources' worth. */
export const MAX_GLYPHS = 320;

/** One real string, ejected from the resource it was read off. */
export interface GlyphToken {
  /** The exact payload string (trimmed, and truncated with an ellipsis if long). */
  text: string;
  /** Index into `results`. */
  owner: number;
  /** The verdict that colours it — for a decision-matrix row, the ROW's verdict. */
  verdict: Verdict;
  /** Owner's real risk_score, normalised. Drives size and brightness. */
  heat: number;
  /** True when this token rides the polar jet instead of the disk. */
  jet: boolean;
  seedA: number;
  seedB: number;
}

/** Collapse whitespace; truncate with an ellipsis rather than silently cutting. */
export function shortenToken(s: string): string {
  const flat = String(s ?? "").replace(/\s+/g, " ").trim();
  if (flat.length <= GLYPH_MAX_CHARS) return flat;
  return `${flat.slice(0, GLYPH_MAX_CHARS - 1)}…`;
}

/**
 * The longest `-`-terminated prefix every scanned resource's name shares.
 *
 * On a real account that is the deployment prefix ("mirror-demo-"), and if it
 * is left in, every glyph in the stream starts with the same twelve characters
 * and the telemetry reads as one repeated word. Stripping it is a real
 * transformation of a real string — nothing is invented, and if the account's
 * names share nothing this returns "" and the full names are used.
 */
export function sharedNamePrefix(results: MirrorResult[]): string {
  const names = results.map((r) => r.node_name).filter((n): n is string => Boolean(n));
  if (names.length < 2) return "";
  let p = names[0];
  for (const n of names) {
    let i = 0;
    while (i < p.length && i < n.length && p[i] === n[i]) i++;
    p = p.slice(0, i);
    if (!p) return "";
  }
  const cut = p.lastIndexOf("-");
  return cut > 2 ? p.slice(0, cut + 1) : "";
}

/**
 * Every real string in the payload, turned into one ejected glyph.
 *
 * The list below is the exhaustive enumeration of the fields `MirrorResult`
 * actually carries — resource id, verdict, risk score, the Cedar decision and
 * each policy id behind it, the reversibility level, the Mirror badge, every
 * blast-radius hop (with its real 90-day invocation count where CloudWatch
 * returned one), every adversarial error/throttle reading, every
 * decision-matrix scenario (coloured by THAT row's verdict, not the
 * resource's), every downstream effect's real `via` edge, and every rollback
 * step. There is no "filler" branch: if the scan returned nothing for a field,
 * no glyph exists for it.
 *
 * Glyphs off a resource Cedar refused ride the polar jets — every third one,
 * so the disk keeps its share of the refusals too.
 */
export function buildGlyphStream(results: MirrorResult[]): GlyphToken[] {
  const out: GlyphToken[] = [];
  const prefix = sharedNamePrefix(results);
  const strip = (s: string) => (prefix && s.includes(prefix) ? s.replace(prefix, "") : s);

  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    const heat = clamp(r.risk_score, 0, 100) / 100;
    const refused = r.verdict === "BLOCKED";
    let k = 0;

    const push = (raw: string | null | undefined, verdict: Verdict = r.verdict) => {
      if (out.length >= MAX_GLYPHS) return;
      const text = shortenToken(raw ?? "");
      if (!text) return;
      out.push({
        text,
        owner: i,
        verdict,
        heat,
        jet: refused && k % 3 === 0,
        seedA: hashUnit(`${r.resource}#g${k}`),
        seedB: hashUnit(`g${k}@${r.resource}`),
      });
      k++;
    };

    push(strip(r.resource));
    push(r.verdict);
    push(`risk ${r.risk_score}`);
    push(r.cedar_decision);
    if (r.reversibility?.level) push(`rev ${r.reversibility.level}`);
    if (r.mirror_score?.badge) push(r.mirror_score.badge);

    for (const reason of r.cedar_reasons ?? []) push(reason);

    for (const b of r.blast_radius ?? []) {
      push(
        typeof b.invocations_90d === "number"
          ? `hop${b.hop} inv ${b.invocations_90d}`
          : `hop${b.hop} ${strip(b.resource)}`,
      );
    }

    for (const a of r.adversarial ?? []) {
      const parts: string[] = [];
      if (typeof a.errors === "number") parts.push(`err ${a.errors}`);
      if (typeof a.throttles === "number") parts.push(`thr ${a.throttles}`);
      push(parts.length > 0 ? `hop${a.hop} ${parts.join(" ")}` : `hop${a.hop} adversarial`);
    }

    for (const row of r.decision_matrix ?? []) push(row.scenario, row.verdict);
    for (const d of r.future_diff?.downstream ?? []) push(`via ${d.via}`);
    for (const s of r.rollback_plan?.steps ?? []) push(s);
  }

  return out;
}

/* ------------------------------------------------------------------ *
 * Nebula
 * ------------------------------------------------------------------ */

/** One cloud per scanned resource, capped so a huge account stays cheap. */
export const MAX_CLOUDS = 24;

export interface NebulaCloud {
  owner: number;
  verdict: Verdict;
  /** Which of the three deterministic cloud textures this one uses. */
  tile: number;
  /** Position in units of the evidence shell radius. Negative z is "behind". */
  x: number;
  y: number;
  z: number;
  scale: number;
  alpha: number;
  drift: number;
}

/**
 * The scan, blurred into gas.
 *
 * One cloud per scanned resource: its size and opacity are how much evidence
 * Mirror holds on that resource (`evidenceCount`), its tint is that resource's
 * verdict, and its position is a deterministic hash of its name. So the
 * background depth is the account too — it is just out of focus. Nothing is
 * padded; a one-resource scan gets one cloud.
 */
export function buildNebula(results: MirrorResult[]): NebulaCloud[] {
  const out: NebulaCloud[] = [];
  for (let i = 0; i < results.length && out.length < MAX_CLOUDS; i++) {
    const r = results[i];
    const h1 = hashUnit(`neb:${r.resource}`);
    const h2 = hashUnit(`${r.resource}:neb`);
    const h3 = hashUnit(`cloud/${r.resource}`);
    const density = Math.min(evidenceCount(r), 14) / 14;
    out.push({
      owner: i,
      verdict: r.verdict,
      tile: Math.floor(h3 * 3) % 3,
      x: (h1 - 0.5) * 3.6,
      y: (h2 - 0.5) * 2.2,
      z: -0.9 - h3 * 2.6,
      scale: 1.45 + density * 1.9,
      alpha: 0.1 + density * 0.16,
      drift: (h1 - 0.5) * 0.055,
    });
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * Shaders
 * ------------------------------------------------------------------ */

/**
 * The accretion disk.
 *
 * Geometry is a flat ring in its own XY plane, laid down by the mesh's own
 * rotation. The vertex stage warps it — a real disk is not a sheet of paper,
 * and the warp is what stops the silhouette from reading as a flat cutout.
 */
const DISK_VERT = /* glsl */ `
  uniform float uTime;
  uniform float uWarp;
  varying vec2 vXY;

  void main() {
    vec3 p = position;
    float r = length(p.xy);
    float a = atan(p.y, p.x);
    p.z += sin(a * 2.0 + uTime * 0.08) * uWarp * r;
    vXY = p.xy;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
  }
`;

/**
 * Four real things are happening in here and nothing else is:
 *
 *  1. Keplerian shear. Angular velocity falls off as r^-1.5, so the inner
 *     material laps the rim — the single cue that separates an accretion disk
 *     from a spinning CD.
 *  2. The verdict bands. `uBandW` is the account's real verdict mix and
 *     `uBandC` the three locked status hues; a band of zero width contributes
 *     nothing, so the colour can never imply a verdict the scan did not return.
 *  3. Doppler beaming. The limb rotating toward the camera is brighter.
 *  4. The cursor. Proximity brightens the gas and twists the filaments — a
 *     real local disturbance in the flow, not an overlay.
 */
const DISK_FRAG = /* glsl */ `
  uniform float uTime;
  uniform float uRIn;
  uniform float uROut;
  uniform float uShear;
  uniform float uBeam;
  uniform float uOpacity;
  uniform float uPointerBoost;
  uniform vec2 uPointer;
  uniform vec3 uBandC[3];
  uniform float uBandW[3];
  varying vec2 vXY;

  void main() {
    float r = length(vXY);
    float t = clamp((r - uRIn) / max(uROut - uRIn, 1e-4), 0.0, 1.0);
    float ang = atan(vXY.y, vXY.x);

    float pd = length(vXY - uPointer);
    float near = exp(-(pd * pd) / max(uRIn * uRIn * 1.3, 1e-4));

    float orbit = ang
      + uTime * uShear / pow(max(r / uRIn, 0.45), 1.5)
      + near * uPointerBoost * 2.4;

    // Filaments: three incommensurable angular frequencies, sheared together.
    float f = 0.55 + 0.45 * sin(orbit * 5.0 + r * 1.7);
    f *= 0.62 + 0.38 * sin(orbit * 11.0 - r * 3.4 + 1.7);
    f = mix(0.40, 1.28, clamp(f, 0.0, 1.0));
    f *= 0.86 + 0.20 * sin(orbit * 27.0 + uTime * 0.7);

    // The verdict bands, cross-faded so the disk grades rather than stripes.
    float x = clamp((t - 0.13) / 0.87, 0.0, 1.0);
    vec3 acc = vec3(0.0);
    float wsum = 0.0;
    float lo = 0.0;
    for (int i = 0; i < 3; i++) {
      float w = uBandW[i];
      if (w <= 0.0) { continue; }
      float c = lo + w * 0.5;
      float d = (x - c) / (w * 0.5 + 0.22);
      float wt = exp(-d * d * 2.0);
      acc += uBandC[i] * wt;
      wsum += wt;
      lo += w;
    }
    vec3 band = wsum > 0.0 ? acc / wsum : vec3(0.55, 0.72, 1.0);

    vec3 hot = mix(vec3(1.0, 0.985, 0.95), vec3(0.55, 0.76, 1.0), smoothstep(0.0, 0.15, t));
    vec3 col = mix(hot, band, smoothstep(0.05, 0.32, t));

    float bright = 0.16 + 1.5 * pow(1.0 - t, 2.0);
    float edge = smoothstep(0.0, 0.05, t) * (1.0 - smoothstep(0.58, 1.0, t));
    float beam = 1.0 + uBeam * sin(ang);

    float a = bright * edge * f * beam * uOpacity * (1.0 + near * uPointerBoost * 0.9);
    a = clamp(a, 0.0, 1.0);
    if (a < 0.004) discard;
    gl_FragColor = vec4(col * (0.8 + 0.55 * bright), a);
  }
`;

/**
 * The glyph stream.
 *
 * Every glyph's whole trajectory lives in the vertex shader — the CPU writes
 * one uniform per frame and nothing else — and the quad is built in VIEW space
 * so the text stays upright and camera-facing no matter how the disk is tilted.
 *
 *   aOrbit = (launch angle, 1/lifetime, phase, rise per unit radius)
 *   aShape = (glyph aspect ratio, jet flag)
 *   aTile  = (atlas uv offset, atlas uv scale)
 */
const GLYPH_VERT = /* glsl */ `
  uniform float uTime;
  uniform float uRIn;
  uniform float uROut;
  uniform float uShear;
  uniform float uJet;
  uniform float uHeight;
  uniform float uOpacity;
  uniform float uPointerBoost;
  uniform vec3 uPointer;

  attribute vec4 aTile;
  attribute vec4 aOrbit;
  attribute vec2 aShape;
  attribute vec3 aColor;

  varying vec2 vUv;
  varying vec3 vColor;
  varying float vAlpha;

  void main() {
    float u = fract(aOrbit.y * uTime + aOrbit.z);

    // In the disk: launched at the inner edge, dragged backwards by the same
    // Keplerian shear the gas obeys, drifting off the midplane as it goes.
    float r = mix(uRIn, uROut, pow(u, 0.72));
    float theta = aOrbit.x - uTime * uShear / pow(max(r / uRIn, 0.5), 1.5);
    vec3 diskP = vec3(cos(theta) * r, aOrbit.w * (r - uRIn), sin(theta) * r);

    // On the jet: straight up or down the disk's own normal, fanning slightly.
    float dir = aOrbit.w >= 0.0 ? 1.0 : -1.0;
    float jr = mix(uRIn * 0.16, uRIn * 0.8, u);
    vec3 jetP = vec3(
      cos(aOrbit.x) * jr,
      dir * mix(uRIn * 0.35, uJet, pow(u, 0.85)),
      sin(aOrbit.x) * jr
    );

    vec3 p = mix(diskP, jetP, aShape.y);

    // The cursor pushes the stream away from itself, with a tight falloff.
    vec3 away = p - uPointer;
    float d2 = dot(away, away);
    p += normalize(away + vec3(1e-4)) * uPointerBoost * uRIn * 0.55
       * exp(-d2 / max(uRIn * uRIn * 1.2, 1e-4));

    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    mv.xy += position.xy * vec2(uHeight * aShape.x, uHeight);
    gl_Position = projectionMatrix * mv;

    vUv = uv * aTile.zw + aTile.xy;
    vColor = aColor;
    vAlpha = sin(3.141592653589793 * u) * uOpacity;
  }
`;

const GLYPH_FRAG = /* glsl */ `
  uniform sampler2D uAtlas;
  varying vec2 vUv;
  varying vec3 vColor;
  varying float vAlpha;

  void main() {
    float m = texture2D(uAtlas, vUv).a;
    float a = m * vAlpha;
    if (a < 0.012) discard;
    gl_FragColor = vec4(vColor, a);
  }
`;

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
   * `shell` — the radius the real dependency structure orbits at — is the
   * anchor, because that is the widest thing on screen and it is what the
   * existing framing (1920 / 1440 / 1024 / 390, at the extreme of pointer
   * parallax plus camera drift) was tuned against. Everything the quasar is
   * made of is then expressed as a fraction of it: the event horizon at
   * shell/3.4, the disk from 1.35 to 2.75 horizons, the glyph stream out to
   * 3.3. So the whole scene scales as one object between breakpoints, and the
   * outermost glyph still lands inside the frame.
   *
   * Horizontally the quasar sits at ~59% of the frame on a landscape viewport:
   * right of centre, because the headline owns the left, but nowhere near the
   * edge. On a portrait viewport there is no right margin — the headline runs
   * the full width — so the bias rotates ninety degrees: it centres
   * horizontally and drops into the lower third. The veil switches axis with
   * it (see GRAPH_CSS). `wide` interpolates so there is no snap at any width.
   */
  const place = useMemo(() => {
    const halfW = viewport.width / 2;
    const halfH = viewport.height / 2;
    const wide = clamp((viewport.width / viewport.height - 0.95) / 0.55, 0, 1);
    const span = Math.min(viewport.width, viewport.height);

    const shell = span * lerp(0.38, 0.478, wide);
    const horizon = shell / 3.4;

    return {
      centerX: lerp(0, halfW * 0.18, wide),
      centerY: lerp(-halfH * 0.34, -halfH * 0.02, wide),
      rx: shell,
      ry: shell * lerp(0.92, 0.78, wide),
      rz: shell,
      shell,
      horizon,
      // The disk hugs the horizon (1.18) rather than standing off it. At the
      // physically-correct innermost stable orbit the gap reads as a second,
      // larger black disc and the silhouette doubles in apparent size.
      diskIn: horizon * 1.18,
      diskOut: horizon * 3.0,
      glyphOut: horizon * 3.2,
      nodeScale: clamp(horizon, 0.6, 1.6),
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
  const horizonGeo = useMemo(() => new THREE.SphereGeometry(1, 64, 48), []);
  const reticleGeo = useMemo(() => new THREE.RingGeometry(0.955, 1, 64), []);
  const glowTex = useMemo(() => makeGlowTexture(), []);
  const rimTex = useMemo(() => makeRimTexture(), []);
  const streakTex = useMemo(() => makeStreakTexture(), []);
  const lensTex = useMemo(() => makeLensTexture(), []);
  const jetTex = useMemo(() => makeJetTexture(), []);
  const nebulaTex = useMemo(() => [0, 1, 2].map((s) => makeNebulaTexture(s)), []);
  useEffect(
    () => () => {
      sphereGeo.dispose();
      horizonGeo.dispose();
      reticleGeo.dispose();
      glowTex.dispose();
      rimTex.dispose();
      streakTex.dispose();
      lensTex.dispose();
      jetTex.dispose();
      nebulaTex.forEach((t) => t.dispose());
    },
    [sphereGeo, horizonGeo, reticleGeo, glowTex, rimTex, streakTex, lensTex, jetTex, nebulaTex],
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
  const share = useMemo(() => verdictShares(results), [results]);
  /**
   * Everything Mirror did NOT wave through — a hard refusal and a hold-for-a-
   * human are different verdicts but the same outcome. This is the same figure
   * the hero prints as "% withheld", spent here as the jets' reach.
   */
  const withheld = share.BLOCKED + share.NEEDS_REVIEW;

  /* ---------------- the quasar ---------------- */

  const quasarRef = useRef<THREE.Group>(null);
  const diskRef = useRef<THREE.Mesh>(null);
  const glyphMeshRef = useRef<THREE.Mesh>(null);
  const jetRef = useRef<THREE.Mesh>(null);
  const nebulaRefs = useRef<(THREE.Sprite | null)[]>([]);
  const coreGlowRef = useRef<THREE.Sprite>(null);
  const photonRef = useRef<THREE.Sprite>(null);
  const lensRef = useRef<THREE.Sprite>(null);

  // The account's dominant verdict, worst-first. Same precedence the
  // kill-switch banner and the stat tiles use.
  const coreColor = useMemo(() => {
    if (layout.nodes.some((n) => n.verdict === "BLOCKED")) return VERDICT_COLOR.BLOCKED;
    if (layout.nodes.some((n) => n.verdict === "NEEDS_REVIEW")) return VERDICT_COLOR.NEEDS_REVIEW;
    return VERDICT_COLOR.SAFE;
  }, [layout.nodes]);

  const diskGeo = useMemo(
    () => new THREE.RingGeometry(place.diskIn, place.diskOut, 168, 26),
    [place.diskIn, place.diskOut],
  );
  useEffect(() => () => diskGeo.dispose(), [diskGeo]);

  const diskMat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: DISK_VERT,
        fragmentShader: DISK_FRAG,
        uniforms: {
          uTime: { value: 0 },
          uRIn: { value: 1 },
          uROut: { value: 2 },
          uWarp: { value: 0.07 },
          uShear: { value: 0.55 },
          uBeam: { value: 0.3 },
          uOpacity: { value: 1 },
          uPointer: { value: new THREE.Vector2(1e4, 1e4) },
          uPointerBoost: { value: 0 },
          uBandC: {
            value: [
              new THREE.Color(VERDICT_COLOR.BLOCKED),
              new THREE.Color(VERDICT_COLOR.NEEDS_REVIEW),
              new THREE.Color(VERDICT_COLOR.SAFE),
            ],
          },
          uBandW: { value: [0, 0, 0] },
        },
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    [],
  );
  useEffect(() => () => diskMat.dispose(), [diskMat]);

  // Disk geometry is rebuilt per viewport, so the shader's radii and the real
  // verdict mix are pushed in rather than baked into the material's defaults.
  useEffect(() => {
    diskMat.uniforms.uRIn.value = place.diskIn;
    diskMat.uniforms.uROut.value = place.diskOut;
    // Severity is the one thing that makes the flow violent: more refusals,
    // more relativistic beaming across the approaching limb.
    diskMat.uniforms.uBeam.value = 0.16 + severity * 0.2;
    diskMat.uniforms.uBandW.value = [share.BLOCKED, share.NEEDS_REVIEW, share.SAFE];
  }, [diskMat, place.diskIn, place.diskOut, severity, share]);

  /* ---------------- the glyph stream ---------------- */

  const glyphs = useMemo(() => buildGlyphStream(results), [results]);

  const atlas = useMemo(
    () => (glyphs.length > 0 ? buildGlyphAtlas(glyphs.map((g) => g.text)) : null),
    [glyphs],
  );
  useEffect(() => () => atlas?.texture.dispose(), [atlas]);

  /**
   * One InstancedBufferGeometry for the whole stream: a unit quad plus five
   * per-glyph attributes, drawn in a single instanced call. A glyph whose
   * string did not fit the atlas is dropped here rather than pointed at
   * somebody else's tile.
   */
  const glyphGeo = useMemo(() => {
    if (!atlas || glyphs.length === 0) return null;
    const drawn = glyphs.filter((g) => atlas.tiles.has(g.text));
    if (drawn.length === 0) return null;

    const quad = new THREE.PlaneGeometry(1, 1);
    const geo = new THREE.InstancedBufferGeometry();
    // Cloned, not shared: disposing the template must not reach into the
    // renderer's buffer cache for attributes this geometry still owns.
    geo.index = quad.index!.clone();
    geo.setAttribute("position", quad.attributes.position.clone());
    geo.setAttribute("uv", quad.attributes.uv.clone());
    geo.instanceCount = drawn.length;

    const tile = new Float32Array(drawn.length * 4);
    const orbit = new Float32Array(drawn.length * 4);
    const shape = new Float32Array(drawn.length * 2);
    const color = new Float32Array(drawn.length * 3);
    const c = new THREE.Color();
    const white = new THREE.Color("#ffffff");

    drawn.forEach((g, i) => {
      const t = atlas.tiles.get(g.text)!;
      tile.set([t.x, t.y, t.z, t.w], i * 4);

      // Launch angle, lifetime, phase, and the drift off the midplane. Every
      // term is a deterministic hash of the owning resource + the record's
      // index within it, so the same scan streams the same way every reload.
      const speed = 0.045 + g.seedA * 0.085 + g.heat * 0.05;
      // Tight against the midplane. Wider than this and the stream stops
      // reading as material leaving a disk and becomes a word cloud.
      const rise = (g.seedB - 0.5) * 0.24;
      orbit.set([g.seedA * Math.PI * 2, speed, g.seedB, rise], i * 4);

      shape.set([atlas.aspect.get(g.text) ?? 4, g.jet ? 1 : 0], i * 2);

      // Verdict hue, lifted toward white so 13px of mono still reads as text,
      // and brightened by the owner's real risk_score.
      c.set(VERDICT_COLOR[g.verdict]).lerp(white, 0.34).multiplyScalar(0.62 + g.heat * 0.5);
      color.set([c.r, c.g, c.b], i * 3);
    });

    geo.setAttribute("aTile", new THREE.InstancedBufferAttribute(tile, 4));
    geo.setAttribute("aOrbit", new THREE.InstancedBufferAttribute(orbit, 4));
    geo.setAttribute("aShape", new THREE.InstancedBufferAttribute(shape, 2));
    geo.setAttribute("aColor", new THREE.InstancedBufferAttribute(color, 3));
    // The quad is assembled in view space, so the geometry's own bounds are
    // meaningless to the culler.
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
    quad.dispose();
    return geo;
  }, [atlas, glyphs]);
  useEffect(() => () => glyphGeo?.dispose(), [glyphGeo]);

  const glyphMat = useMemo(() => {
    if (!atlas) return null;
    return new THREE.ShaderMaterial({
      vertexShader: GLYPH_VERT,
      fragmentShader: GLYPH_FRAG,
      uniforms: {
        uTime: { value: 0 },
        uRIn: { value: 1 },
        uROut: { value: 3 },
        uShear: { value: 0.55 },
        uJet: { value: 1 },
        uHeight: { value: 0.2 },
        uOpacity: { value: 0.8 },
        uPointer: { value: new THREE.Vector3(1e4, 1e4, 1e4) },
        uPointerBoost: { value: 0 },
        uAtlas: { value: atlas.texture },
      },
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
  }, [atlas]);
  useEffect(() => () => glyphMat?.dispose(), [glyphMat]);

  useEffect(() => {
    if (!glyphMat) return;
    glyphMat.uniforms.uRIn.value = place.diskIn * 0.86;
    glyphMat.uniforms.uROut.value = place.glyphOut;
    // ~13px of cap height at 1440 — small enough to read as a terminal feed,
    // large enough that it is unmistakably text rather than dashes.
    glyphMat.uniforms.uHeight.value = place.horizon * 0.15;
    // The jets reach as far as the account withheld. A scan Mirror waved
    // through entirely throws nothing.
    glyphMat.uniforms.uJet.value = place.horizon * (1.4 + withheld * 2.4);
  }, [glyphMat, place.diskIn, place.glyphOut, place.horizon, withheld]);

  /* ---------------- nebula ---------------- */

  const clouds = useMemo(() => buildNebula(results), [results]);
  /**
   * Verdict-tinted, but pulled most of the way to a deep indigo. The status
   * hues mean "this resource's verdict" and a wall of saturated red gas behind
   * the hero would read as page chrome shouting — which the brief explicitly
   * forbids. 38% of the hue is enough for a blocked-heavy account to sit in
   * warmer gas without the nebula ever being mistaken for a finding.
   */
  const cloudColors = useMemo(() => {
    const base = new THREE.Color("#2b3a6b");
    return clouds.map((c) => new THREE.Color(VERDICT_COLOR[c.verdict]).lerp(base, 0.62));
  }, [clouds]);

  const pulseCount = Math.min(layout.edges.length, MAX_PULSES);
  /** Damage propagates faster the more of the account is actually blocked. */
  const pulseRate = PULSE_RATE * (1 + severity * 0.8);

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

  /** Scratch vectors for the per-frame pointer projection. Allocated once. */
  const pointerWorld = useMemo(() => new THREE.Vector3(), []);
  const pointerLocal = useMemo(() => new THREE.Vector3(), []);
  const camLocal = useMemo(() => new THREE.Vector3(), []);

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

    /* ---- the quasar ---- */

    const quasar = quasarRef.current;
    if (quasar) {
      // The cursor tips the disk. Small amplitude, eased, and disabled under
      // reduced motion — but it is the thing that makes the object feel held
      // rather than played back.
      const targetTilt = DISK_TILT + (reduced ? 0 : p.y * DISK_TILT_POINTER);
      const targetYaw = reduced ? 0 : p.x * DISK_TILT_POINTER * 0.7;
      const k = reduced ? 1 : 1 - Math.pow(0.02, dt);
      quasar.rotation.x = lerp(quasar.rotation.x, targetTilt, k);
      quasar.rotation.z = lerp(quasar.rotation.z, targetYaw, k);
    }

    /*
      The cursor, projected onto the scene's own plane and then pushed through
      each object's inverse world matrix. Doing it per-object rather than once
      is what keeps "near the cursor" meaning the same thing in the disk's
      frame (flat, XY) and the stream's (upright, XYZ) while the tilt above is
      still easing — a single shared local point would lag one of them.
    */
    pointerWorld.set(p.x * (viewport.width / 2), -p.y * (viewport.height / 2), 0);
    const boost = reduced ? 0 : 0.9;

    if (diskRef.current) {
      pointerLocal.copy(pointerWorld);
      diskRef.current.worldToLocal(pointerLocal);
      (diskMat.uniforms.uPointer.value as THREE.Vector2).set(pointerLocal.x, pointerLocal.y);
    }
    diskMat.uniforms.uPointerBoost.value = boost;
    diskMat.uniforms.uTime.value = reduced ? 0 : t;
    // The disk is the brightest thing on the page; it has to get out of the
    // way of the sections below exactly as fast as everything else does.
    diskMat.uniforms.uOpacity.value = 1 - scrolled * 0.35;

    if (glyphMat) {
      if (glyphMeshRef.current) {
        pointerLocal.copy(pointerWorld);
        glyphMeshRef.current.worldToLocal(pointerLocal);
        (glyphMat.uniforms.uPointer.value as THREE.Vector3).copy(pointerLocal);
      }
      glyphMat.uniforms.uPointerBoost.value = boost;
      glyphMat.uniforms.uTime.value = reduced ? 0 : t;
      glyphMat.uniforms.uOpacity.value = 0.86 - scrolled * 0.5;
    }

    // The jet is a flat plume, so it has to be turned about its own axis to
    // keep its face to the camera — a sprite would keep the plume vertical on
    // screen and break the moment the disk tilts.
    const jet = jetRef.current;
    if (jet) {
      camLocal.copy(state.camera.position);
      jet.parent?.worldToLocal(camLocal);
      jet.rotation.y = Math.atan2(camLocal.x, camLocal.z);
    }

    // Slow ambient pulse on the halo — the same 8-14s cinematic band as every
    // other glow on the page, never a fast blink. A blocked-heavy account
    // burns brighter at the same cadence.
    if (coreGlowRef.current) {
      const pulse = reduced ? 1 : 0.85 + Math.sin((t * (Math.PI * 2)) / 10) * 0.15;
      coreGlowRef.current.material.opacity = (0.26 + severity * 0.22) * pulse;
    }
    // The photon ring and the lensed limb breathe on their own, slower and
    // offset, so the silhouette never settles into one fixed shape.
    if (photonRef.current) {
      const pulse = reduced ? 1 : 0.86 + Math.sin((t * (Math.PI * 2)) / 13 + 1.1) * 0.14;
      photonRef.current.material.opacity = 0.72 * pulse;
    }
    if (lensRef.current) {
      const pulse = reduced ? 1 : 0.88 + Math.sin((t * (Math.PI * 2)) / 17 + 2.4) * 0.12;
      lensRef.current.material.opacity = (0.4 + severity * 0.2) * pulse;
    }

    // The nebula drifts against itself — each cloud on its own slow period, so
    // the gas keeps reorganising and never reads as a painted backdrop.
    if (!reduced) {
      for (let i = 0; i < clouds.length; i++) {
        const sprite = nebulaRefs.current[i];
        if (!sprite) continue;
        const c = clouds[i];
        sprite.position.x = c.x * place.shell + Math.sin(t * c.drift + c.z) * place.horizon * 0.3;
        sprite.position.y = c.y * place.shell + Math.cos(t * c.drift * 0.8 + c.x) * place.horizon * 0.22;
      }
    }

    /* ---- the evidence ---- */

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

  const horizon = place.horizon;

  return (
    <group position={[place.centerX, place.centerY, 0]}>
      {/*
        The nebula. One soft cloud per scanned resource, far behind everything
        and exempt from the fog (at this depth the fog would simply delete it).
        Additive at a few percent each: it paints colour onto the void without
        ever raising the floor under the hero's type, and the horizon in front
        of it punches a hard black hole straight through the gas.
      */}
      {clouds.map((c, i) => (
        <sprite
          key={`cloud-${c.owner}-${i}`}
          ref={(s) => {
            nebulaRefs.current[i] = s;
          }}
          position={[c.x * place.shell, c.y * place.shell, c.z * place.shell]}
          scale={[c.scale * place.shell, c.scale * place.shell * 0.72, 1]}
        >
          <spriteMaterial
            map={nebulaTex[c.tile]}
            color={cloudColors[i]}
            transparent
            opacity={c.alpha}
            blending={THREE.AdditiveBlending}
            depthWrite={false}
            fog={false}
            toneMapped={false}
          />
        </sprite>
      ))}

      {/*
        Two anamorphic streaks through the quasar's waist, pushed BEHIND the
        horizon so the sphere's depth buffer cuts their middle out — glare
        escaping past an object that swallows it, rather than a flare pasted on
        top. The wide one carries the account's real dominant verdict colour;
        the short one is the inner disk's own blue-white.
      */}
      <sprite
        scale={[horizon * 13, horizon * 0.72, 1]}
        position={[0, horizon * 0.1, -horizon * 1.2]}
      >
        <spriteMaterial
          map={streakTex}
          color={coreColor}
          transparent
          opacity={0.18 + severity * 0.16}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
          fog={false}
          toneMapped={false}
        />
      </sprite>
      <sprite
        scale={[horizon * 7, horizon * 0.3, 1]}
        position={[horizon * 0.2, horizon * 0.44, -horizon * 1.1]}
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

      {/*
        Layered bloom, all of it centred BEHIND the horizon for the same reason
        as the streaks: a halo is light that got past the hole, so its middle
        has to be missing. Three additive falloffs at different radii — a tight
        hot ring of escaping light, the mid halo that carries the account's real
        state, and a wide atmospheric wash that puts colour on the void itself.
      */}
      <sprite scale={[horizon * 3.4, horizon * 3.4, 1]} position={[0, 0, -horizon * 1.05]}>
        <spriteMaterial
          map={glowTex}
          color="#eaf3ff"
          transparent
          opacity={0.16 + severity * 0.1}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
          fog={false}
          toneMapped={false}
        />
      </sprite>
      <sprite
        ref={coreGlowRef}
        scale={[horizon * 7.5, horizon * 7.5, 1]}
        position={[0, 0, -horizon * 1.3]}
      >
        <spriteMaterial
          map={glowTex}
          color={coreColor}
          transparent
          opacity={0.3}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
          fog={false}
          toneMapped={false}
        />
      </sprite>
      <sprite scale={[horizon * 14, horizon * 14, 1]} position={[0, 0, -horizon * 2.2]}>
        <spriteMaterial
          map={glowTex}
          color={coreColor}
          transparent
          opacity={0.13}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
          fog={false}
          toneMapped={false}
        />
      </sprite>

      {/*
        The quasar proper: disk, jets and glyph stream all share one tilted
        frame, so the stream rides the disk's plane and the jets stand on its
        normal no matter how the cursor tips it.
      */}
      <group ref={quasarRef} rotation={[DISK_TILT, 0, 0]}>
        {/*
          The bipolar jet. Length is the real withheld share and brightness the
          real blocked share, so an account Mirror waved through entirely
          throws nothing at all — the jet is a finding, not an ornament.
          Cylindrically billboarded per frame (see the frame loop).
        */}
        {withheld > 0 ? (
          <mesh
            ref={jetRef}
            scale={[
              horizon * (1.4 + withheld * 2.4) * 0.66,
              horizon * (1.4 + withheld * 2.4) * 2,
              1,
            ]}
          >
            <planeGeometry args={[1, 1]} />
            <meshBasicMaterial
              map={jetTex}
              color="#cfe2ff"
              transparent
              opacity={0.14 + severity * 0.55}
              blending={THREE.AdditiveBlending}
              depthWrite={false}
              side={THREE.DoubleSide}
              fog={false}
              toneMapped={false}
            />
          </mesh>
        ) : null}

        {/*
          The accretion disk — the hero's verdict spectrum bar, revolved. Laid
          flat by this rotation; everything else about it is in DISK_FRAG.
        */}
        <mesh ref={diskRef} geometry={diskGeo} material={diskMat} rotation={[-Math.PI / 2, 0, 0]} />

        {/*
          The telemetry. One instanced billboard per real payload string,
          launched from the disk's inner edge and sheared outward — or, for the
          resources Cedar refused, ejected up the jet.
        */}
        {glyphGeo && glyphMat ? (
          <mesh ref={glyphMeshRef} geometry={glyphGeo} material={glyphMat} frustumCulled={false} />
        ) : null}
      </group>

      {/*
        The event horizon.

        Pure #000, unlit, fog-exempt, and the only object in this scene that
        writes depth — which is the entire trick. Nothing is drawn ON it; every
        glow, streak, halo, nebula cloud and far disk limb behind it is culled
        by its silhouette, so what you are looking at is a hole in the light
        rather than a black ball. It is also why 140px of white Unbounded can
        cross the centre of the composition and stay perfectly legible.
      */}
      <mesh geometry={horizonGeo} scale={horizon}>
        <meshBasicMaterial color="#000000" toneMapped={false} fog={false} />
      </mesh>

      {/*
        The photon ring: the last orbit light can hold before it falls in, hard
        against the silhouette. Scaled so the texture's bright annulus (at 93%
        of the sprite's half-size) lands at 1.06 horizons — just clear of the
        sphere, never swallowed by it.
      */}
      <sprite ref={photonRef} scale={[horizon * 2.28, horizon * 2.28, 1]}>
        <spriteMaterial
          map={rimTex}
          color="#dcebff"
          transparent
          opacity={0.72}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
          fog={false}
          toneMapped={false}
        />
      </sprite>

      {/*
        The lensed limb — the disk material behind the hole, bent up over the
        top and under the bottom. Drawn, not traced (see makeLensTexture), and
        billboarded so it always stands vertically against the flat disk.
        Tinted with the account's dominant verdict because that is the light it
        is bending.
      */}
      <sprite ref={lensRef} scale={[horizon * 3.5, horizon * 3.5, 1]}>
        <spriteMaterial
          map={lensTex}
          color={coreColor}
          transparent
          opacity={0.45}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
          fog={false}
          toneMapped={false}
        />
      </sprite>

      {/* Everything below is the evidence, and the evidence is what orbits. */}
      <group ref={groupRef}>
        {layout.nodes.map((nd, i) => {
          const color = VERDICT_COLOR[nd.verdict];
          // Radius is the real dependent count. The resources that would break
          // things are literally the biggest objects on screen.
          const radius = (0.098 + 0.05 * Math.min(nd.dependentCount, 5)) * place.nodeScale;
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
                // real sandbox payload that is three objects out of nine — the
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
    The veil is a RAKING light, not a blanket. These stops are expressed as
    fractions of the same real type metric, so the darkness tracks the
    headline, but it is spent almost entirely on the left column where the type
    actually lives and is gone by the time it reaches the quasar.
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
   The radial term is centred on the quasar (62% / 48%) and opened up, so the
   vignette frames the disk rather than cropping its glow. */
.mirror-graph-vignette {
  position: absolute;
  inset: 0;
  background:
    linear-gradient(to bottom, rgba(10, 10, 10, 0.74) 0, rgba(10, 10, 10, 0) 14%),
    linear-gradient(to top, rgba(10, 10, 10, 0.66) 0, rgba(10, 10, 10, 0) 18%),
    radial-gradient(ellipse 132% 104% at 62% 48%, rgba(10, 10, 10, 0) 44%, rgba(10, 10, 10, 0.74) 100%);
}

/*
  Caustics — the light the quasar throws back onto the void around it.

  Four soft elliptical fields on screen-blend, drifting against each other on a
  26s cycle that shares no factor with the 3D drift periods, so the pattern
  never repeats. The palette is the disk's: hot blue-white through the middle,
  the dominant verdict's warmth at the rim.

  Every stop here is an ellipse with a long fade. A conic gradient was the
  obvious way to get refracted spokes and it is the wrong tool: its stops are
  hard angular edges, and over a lit object they render as opaque pie wedges
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
  lower third the quasar has moved into. It never reaches zero on this axis,
  because on a phone the readout rail sits directly over the disk.
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

      /* The quasar is large enough to dominate the frame, which is exactly
         what the hero wants — but this canvas is `fixed`, so without this it
         stays that bright and that big behind every section all the way to
         the footer, fighting unbacked section text (the legend, the
         account-signal cluster) for contrast. It has no business being
         anything but a faint ambient presence once you're two hero-heights
         past it, so the whole scene (canvas + caustics + vignette; the veil
         already fades on its own, faster, for the hero text itself) recedes
         from full presence to a quiet 6% over that stretch and holds there
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
                are all unlit readout points, and the void swallowing the far
                side of the structure is what makes the shell read as a volume.
                The quasar and the nebula opt out (fog={false} / raw
                ShaderMaterial): the horizon has to stay the darkest thing on
                screen, and fogging it toward #0A0A0A would lift it off black. */}
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
