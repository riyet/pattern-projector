import { TraceDocument, TracePath } from "@/_lib/trace/types";

const MARGIN_MM = 5;

function fmt(n: number): string {
  return String(Math.round(n * 1000) / 1000);
}

function escapeAttr(s: string): string {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

function pathData(path: TracePath): string {
  const parts = path.nodes.map(
    (n, i) => `${i === 0 ? "M" : "L"}${fmt(n.x)} ${fmt(n.y)}`,
  );
  if (path.closed) parts.push("Z");
  return parts.join(" ");
}

/** Exports at true scale: user units are millimetres and width/height are in mm. */
export function exportSvg(doc: TraceDocument): string {
  const nodes = doc.paths.flatMap((p) => p.nodes);
  let minX = 0;
  let minY = 0;
  let maxX = 100;
  let maxY = 100;
  if (nodes.length > 0) {
    minX = Math.min(...nodes.map((n) => n.x)) - MARGIN_MM;
    minY = Math.min(...nodes.map((n) => n.y)) - MARGIN_MM;
    maxX = Math.max(...nodes.map((n) => n.x)) + MARGIN_MM;
    maxY = Math.max(...nodes.map((n) => n.y)) + MARGIN_MM;
  }
  const w = maxX - minX;
  const h = maxY - minY;
  const groups = doc.layers
    .filter((l) => l.visible)
    .map((layer) => {
      const paths = doc.paths
        .filter((p) => p.layerId === layer.id && p.nodes.length > 1)
        .map((p) => `    <path d="${pathData(p)}"/>`)
        .join("\n");
      return `  <g id="${escapeAttr(layer.id)}" inkscape:label="${escapeAttr(layer.name)}" inkscape:groupmode="layer">\n${paths}\n  </g>`;
    })
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape" width="${fmt(w)}mm" height="${fmt(h)}mm" viewBox="${fmt(minX)} ${fmt(minY)} ${fmt(w)} ${fmt(h)}">
<g fill="none" stroke="${escapeAttr(doc.style.color)}" stroke-width="${fmt(doc.style.thickness)}" stroke-linecap="round" stroke-linejoin="round">
${groups}
</g>
</svg>
`;
}
