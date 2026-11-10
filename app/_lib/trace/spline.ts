import { Point } from "@/_lib/point";
import { TraceNode, TracePath } from "@/_lib/trace/types";

export type PathCommand =
  | { type: "M" | "L"; p: Point }
  | { type: "C"; c1: Point; c2: Point; p: Point }
  | { type: "Z" };

const ALPHA = 0.5;

function d(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/**
 * Centripetal Catmull-Rom (alpha 0.5) segment P1->P2 as a cubic Bezier,
 * using P0 and P3 as neighbours (Yuksel et al.).
 */
export function catmullRomSegment(
  p0: Point,
  p1: Point,
  p2: Point,
  p3: Point,
): { c1: Point; c2: Point } {
  const d1 = Math.pow(d(p0, p1), ALPHA);
  const d2 = Math.pow(d(p1, p2), ALPHA);
  const d3 = Math.pow(d(p2, p3), ALPHA);
  const d1s = d1 * d1;
  const d2s = d2 * d2;
  const d3s = d3 * d3;
  let c1 = p1;
  let c2 = p2;
  if (d1 > 1e-9 && d2 > 1e-9) {
    const k = 3 * d1 * (d1 + d2);
    c1 = {
      x: (d1s * p2.x - d2s * p0.x + (2 * d1s + 3 * d1 * d2 + d2s) * p1.x) / k,
      y: (d1s * p2.y - d2s * p0.y + (2 * d1s + 3 * d1 * d2 + d2s) * p1.y) / k,
    };
  } else if (d2 > 1e-9) {
    c1 = { x: p1.x + (p2.x - p1.x) / 3, y: p1.y + (p2.y - p1.y) / 3 };
  }
  if (d3 > 1e-9 && d2 > 1e-9) {
    const k = 3 * d3 * (d3 + d2);
    c2 = {
      x: (d3s * p1.x - d2s * p3.x + (2 * d3s + 3 * d3 * d2 + d2s) * p2.x) / k,
      y: (d3s * p1.y - d2s * p3.y + (2 * d3s + 3 * d3 * d2 + d2s) * p2.y) / k,
    };
  } else if (d2 > 1e-9) {
    c2 = { x: p2.x - (p2.x - p1.x) / 3, y: p2.y - (p2.y - p1.y) / 3 };
  }
  return { c1, c2 };
}

function reflect(a: Point, about: Point): Point {
  return { x: 2 * about.x - a.x, y: 2 * about.y - a.y };
}

/** Open spline through pts; end tangents come from reflected phantom points. */
function openSection(pts: Point[]): PathCommand[] {
  const out: PathCommand[] = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = i > 0 ? pts[i - 1] : reflect(pts[i + 1], pts[i]);
    const p3 = i + 2 < pts.length ? pts[i + 2] : reflect(pts[i], pts[i + 1]);
    const { c1, c2 } =
      pts.length === 2
        ? {
            c1: {
              x: pts[0].x + (pts[1].x - pts[0].x) / 3,
              y: pts[0].y + (pts[1].y - pts[0].y) / 3,
            },
            c2: {
              x: pts[1].x - (pts[1].x - pts[0].x) / 3,
              y: pts[1].y - (pts[1].y - pts[0].y) / 3,
            },
          }
        : catmullRomSegment(p0, pts[i], pts[i + 1], p3);
    out.push({ type: "C", c1, c2, p: pts[i + 1] });
  }
  return out;
}

const pt = (n: TraceNode): Point => ({ x: n.x, y: n.y });

/**
 * Converts a path to drawing commands in mm. Straight paths use lines; curve
 * paths use a centripetal Catmull-Rom spline that breaks at corner nodes.
 */
export function pathCommands(path: TracePath): PathCommand[] {
  const nodes = path.nodes;
  if (nodes.length === 0) return [];
  const start = pt(nodes[0]);
  const cmds: PathCommand[] = [{ type: "M", p: start }];
  if (!path.curve || nodes.length < 3) {
    for (const n of nodes.slice(1)) cmds.push({ type: "L", p: pt(n) });
    if (path.closed) cmds.push({ type: "Z" });
    return cmds;
  }
  if (path.closed) {
    const firstCorner = nodes.findIndex((n) => n.corner);
    if (firstCorner < 0) {
      const n = nodes.length;
      const P = (i: number) => pt(nodes[((i % n) + n) % n]);
      for (let i = 0; i < n; i++) {
        const { c1, c2 } = catmullRomSegment(
          P(i - 1),
          P(i),
          P(i + 1),
          P(i + 2),
        );
        cmds.push({ type: "C", c1, c2, p: P(i + 1) });
      }
      cmds.push({ type: "Z" });
      return cmds;
    }
    // Rotate to begin at a corner, then treat as open ending on that corner.
    const rotated = [
      ...nodes.slice(firstCorner),
      ...nodes.slice(0, firstCorner),
    ];
    const loop = [...rotated, rotated[0]];
    return [{ type: "M", p: pt(loop[0]) }, ...sections(loop), { type: "Z" }];
  }
  return [cmds[0], ...sections(nodes)];
}

function sections(nodes: TraceNode[]): PathCommand[] {
  const out: PathCommand[] = [];
  let from = 0;
  for (let i = 1; i < nodes.length; i++) {
    if (nodes[i].corner || i === nodes.length - 1) {
      out.push(...openSection(nodes.slice(from, i + 1).map(pt)));
      from = i;
    }
  }
  return out;
}

function bezierAt(
  p0: Point,
  c1: Point,
  c2: Point,
  p1: Point,
  t: number,
): Point {
  const u = 1 - t;
  const a = u * u * u;
  const b = 3 * u * u * t;
  const c = 3 * u * t * t;
  const e = t * t * t;
  return {
    x: a * p0.x + b * c1.x + c * c2.x + e * p1.x,
    y: a * p0.y + b * c1.y + c * c2.y + e * p1.y,
  };
}

/** Polyline approximation in mm (so it can be projected through the perspective transform). */
export function flattenPath(path: TracePath, steps = 16): Point[] {
  const out: Point[] = [];
  let cur: Point = { x: 0, y: 0 };
  let first: Point | null = null;
  for (const c of pathCommands(path)) {
    if (c.type === "M" || c.type === "L") {
      out.push(c.p);
      cur = c.p;
      first = first ?? c.p;
    } else if (c.type === "C") {
      for (let i = 1; i <= steps; i++) {
        out.push(bezierAt(cur, c.c1, c.c2, c.p, i / steps));
      }
      cur = c.p;
    } else if (first) {
      out.push(first);
    }
  }
  return out;
}
