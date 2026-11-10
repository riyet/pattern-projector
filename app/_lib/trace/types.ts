/** All trace geometry is in millimetres of mat space (origin at the mat grid's top left). */
export interface TraceNode {
  x: number;
  y: number;
  /** Corner nodes break the spline; smooth nodes (default) do not. */
  corner?: boolean;
}

export interface TraceLayer {
  id: string;
  name: string;
  visible: boolean;
}

export interface TracePath {
  id: string;
  layerId: string;
  nodes: TraceNode[];
  closed: boolean;
}

export interface TraceStyle {
  color: string;
  /** Line thickness in millimetres. */
  thickness: number;
}

export const TRACE_FILE_VERSION = 1;

export interface TraceDocument {
  version: number;
  layers: TraceLayer[];
  paths: TracePath[];
  style: TraceStyle;
}

export const DEFAULT_LAYER_ID = "layer-1";

export function emptyDocument(): TraceDocument {
  return {
    version: TRACE_FILE_VERSION,
    layers: [{ id: DEFAULT_LAYER_ID, name: "Layer 1", visible: true }],
    paths: [],
    style: { color: "#ff0000", thickness: 0.5 },
  };
}
