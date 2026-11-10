import {
  TRACE_FILE_VERSION,
  TraceDocument,
  emptyDocument,
} from "@/_lib/trace/types";

export function serializeDocument(doc: TraceDocument): string {
  return JSON.stringify({ ...doc, version: TRACE_FILE_VERSION }, null, 2);
}

const isNum = (v: unknown): v is number =>
  typeof v === "number" && Number.isFinite(v);

/** Parses and validates a trace project file. Throws on invalid input. */
export function parseDocument(text: string): TraceDocument {
  const raw = JSON.parse(text);
  if (!raw || typeof raw !== "object") throw new Error("Not a trace file");
  if (!isNum(raw.version) || raw.version > TRACE_FILE_VERSION) {
    throw new Error("Unsupported trace file version");
  }
  if (!Array.isArray(raw.layers) || !Array.isArray(raw.paths)) {
    throw new Error("Invalid trace file");
  }
  const base = emptyDocument();
  const layers = raw.layers.map((l: any) => {
    if (typeof l?.id !== "string" || typeof l?.name !== "string") {
      throw new Error("Invalid layer");
    }
    return { id: l.id, name: l.name, visible: l.visible !== false };
  });
  const ids = new Set(layers.map((l: { id: string }) => l.id));
  const paths = raw.paths.map((p: any) => {
    if (
      typeof p?.id !== "string" ||
      !ids.has(p.layerId) ||
      !Array.isArray(p.nodes) ||
      !p.nodes.every((n: any) => isNum(n?.x) && isNum(n?.y))
    ) {
      throw new Error("Invalid path");
    }
    return {
      id: p.id,
      layerId: p.layerId,
      closed: p.closed === true,
      nodes: p.nodes.map((n: any) =>
        n.corner ? { x: n.x, y: n.y, corner: true } : { x: n.x, y: n.y },
      ),
    };
  });
  const style = {
    color:
      typeof raw.style?.color === "string" &&
      /^#[0-9a-fA-F]{6}$/.test(raw.style.color)
        ? raw.style.color
        : base.style.color,
    thickness:
      isNum(raw.style?.thickness) && raw.style.thickness > 0
        ? raw.style.thickness
        : base.style.thickness,
  };
  return { version: TRACE_FILE_VERSION, layers, paths, style };
}
