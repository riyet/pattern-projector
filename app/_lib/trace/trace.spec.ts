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
