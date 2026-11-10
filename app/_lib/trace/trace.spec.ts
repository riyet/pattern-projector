import { exportSvg } from "@/_lib/trace/export-svg";
import { parseDocument, serializeDocument } from "@/_lib/trace/project-file";
import { PX_PER_MM, clientToMm, mmToClient } from "@/_lib/trace/units";
import traceReducer, { initialTraceState } from "@/_reducers/traceReducer";
import { Matrix } from "ml-matrix";

function drawSquare() {
  let s = initialTraceState();
  for (const [x, y] of [
    [10, 10],
    [110, 10],
    [110, 110],
    [10, 110],
  ]) {
    s = traceReducer(s, { type: "add_point", point: { x, y } });
  }
  return traceReducer(s, { type: "finish_path", close: true });
}

test("mm <-> client round trips through a calibration transform", () => {
  const m = new Matrix([
    [1.1, 0.1, 30],
    [0.05, 0.9, 40],
    [0.0001, 0, 1],
  ]);
  const p = { x: 42.5, y: 17.25 };
  const q = clientToMm(mmToClient(p, m), m);
  expect(q.x).toBeCloseTo(p.x, 6);
  expect(q.y).toBeCloseTo(p.y, 6);
  expect(PX_PER_MM * 25.4).toBeCloseTo(96);
});

test("a traced 100 mm square exports as 100 mm in SVG", () => {
  const svg = exportSvg(drawSquare().doc);
  expect(svg).toContain('d="M10 10 L110 10 L110 110 L10 110 Z"');
  // 100 mm square + 5 mm margin each side
  expect(svg).toContain('width="110mm" height="110mm"');
  expect(svg).toContain('viewBox="5 5 110 110"');
});

test("undo and redo", () => {
  let s = drawSquare();
  s = traceReducer(s, { type: "undo" });
  expect(s.doc.paths[0].closed).toBe(false);
  s = traceReducer(s, { type: "redo" });
  expect(s.doc.paths[0].closed).toBe(true);
});

test("project file round trips and rejects bad input", () => {
  const doc = drawSquare().doc;
  expect(parseDocument(serializeDocument(doc))).toEqual(doc);
  expect(() =>
    parseDocument('{"version":99,"layers":[],"paths":[]}'),
  ).toThrow();
  expect(() => parseDocument("[]")).toThrow();
});

import { flattenPath, pathCommands } from "@/_lib/trace/spline";

const curvePath = (nodes: any[], closed = false) => ({
  id: "p",
  layerId: "l",
  nodes,
  closed,
  curve: true,
});

test("spline passes through its nodes and is exported as cubic Beziers", () => {
  const nodes = [
    { x: 0, y: 0 },
    { x: 50, y: 30 },
    { x: 100, y: 0 },
  ];
  const cmds = pathCommands(curvePath(nodes));
  expect(cmds.map((c) => c.type)).toEqual(["M", "C", "C"]);
  const ends = cmds.filter((c) => c.type === "C").map((c: any) => c.p);
  expect(ends).toEqual(nodes.slice(1));
});

test("corner nodes break the spline (no tangent continuity across them)", () => {
  const nodes = [
    { x: 0, y: 0 },
    { x: 40, y: 20 },
    { x: 80, y: 0, corner: true },
    { x: 100, y: 40 },
    { x: 120, y: 0 },
  ];
  const cmds: any[] = pathCommands(curvePath(nodes));
  // incoming handle and outgoing handle at the corner are not collinear
  const inH = cmds[2];
  const outH = cmds[3];
  const a = { x: inH.p.x - inH.c2.x, y: inH.p.y - inH.c2.y };
  const b = { x: outH.c1.x - inH.p.x, y: outH.c1.y - inH.p.y };
  expect(Math.abs(a.x * b.y - a.y * b.x)).toBeGreaterThan(1);
  // smooth node 1 stays tangent-continuous
  const i1 = cmds[1];
  const o1 = cmds[2];
  const a1 = { x: i1.p.x - i1.c2.x, y: i1.p.y - i1.c2.y };
  const b1 = { x: o1.c1.x - i1.p.x, y: o1.c1.y - i1.p.y };
  expect(Math.abs(a1.x * b1.y - a1.y * b1.x)).toBeLessThan(1e-6);
});

test("closed curve with no corners wraps around; flatten ends at start", () => {
  const nodes = [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
    { x: 100, y: 100 },
    { x: 0, y: 100 },
  ];
  const cmds = pathCommands(curvePath(nodes, true));
  expect(cmds.filter((c) => c.type === "C")).toHaveLength(4);
  const flat = flattenPath(curvePath(nodes, true));
  expect(flat[flat.length - 1]).toEqual(nodes[0]);
});

test("select, move, nudge, delete and toggle corner", () => {
  let s = drawSquare();
  const pathId = s.doc.paths[0].id;
  s = traceReducer(s, { type: "select", selection: { pathId, index: 1 } });
  s = traceReducer(s, { type: "nudge", dx: 0.5, dy: -0.1 });
  expect(s.doc.paths[0].nodes[1]).toEqual({ x: 110.5, y: 9.9 });
  s = traceReducer(s, { type: "toggle_corner" });
  expect(s.doc.paths[0].nodes[1].corner).toBe(true);
  s = traceReducer(s, { type: "delete_node" });
  expect(s.doc.paths[0].nodes).toHaveLength(3);
  expect(s.selection).toBeNull();
  s = traceReducer(s, { type: "undo" });
  expect(s.doc.paths[0].nodes).toHaveLength(4);
});
