import { Point } from "@/_lib/point";
import {
  DEFAULT_LAYER_ID,
  TraceDocument,
  TraceStyle,
  emptyDocument,
} from "@/_lib/trace/types";

export interface TraceState {
  doc: TraceDocument;
  past: TraceDocument[];
  future: TraceDocument[];
  /** Id of the path currently being drawn, if any. */
  activePathId: string | null;
}

export type TraceAction =
  | { type: "add_point"; point: Point }
  | { type: "finish_path"; close?: boolean }
  | { type: "set_style"; style: Partial<TraceStyle> }
  | { type: "load"; doc: TraceDocument }
  | { type: "clear" }
  | { type: "undo" }
  | { type: "redo" };

export function initialTraceState(): TraceState {
  return { doc: emptyDocument(), past: [], future: [], activePathId: null };
}

const MAX_HISTORY = 200;

function commit(state: TraceState, doc: TraceDocument): TraceState {
  return {
    ...state,
    doc,
    past: [...state.past, state.doc].slice(-MAX_HISTORY),
    future: [],
  };
}

export default function traceReducer(
  state: TraceState,
  action: TraceAction,
): TraceState {
  switch (action.type) {
    case "add_point": {
      const node = { x: action.point.x, y: action.point.y };
      const active = state.doc.paths.find((p) => p.id === state.activePathId);
      if (active) {
        return commit(state, {
          ...state.doc,
          paths: state.doc.paths.map((p) =>
            p === active ? { ...p, nodes: [...p.nodes, node] } : p,
          ),
        });
      }
      const layerId =
        state.doc.layers.find((l) => l.visible)?.id ?? DEFAULT_LAYER_ID;
      const id = `path-${Date.now().toString(36)}-${state.doc.paths.length}`;
      const next = commit(state, {
        ...state.doc,
        paths: [
          ...state.doc.paths,
          { id, layerId, nodes: [node], closed: false },
        ],
      });
      return { ...next, activePathId: id };
    }
    case "finish_path": {
      const active = state.doc.paths.find((p) => p.id === state.activePathId);
      if (!active) return state;
      if (active.nodes.length < 2) {
        // A lone point is not a segment; discard it.
        return {
          ...state,
          doc: {
            ...state.doc,
            paths: state.doc.paths.filter((p) => p !== active),
          },
          past: state.past.slice(0, -1),
          activePathId: null,
        };
      }
      const closed = action.close === true && active.nodes.length > 2;
      const next = closed
        ? commit(state, {
            ...state.doc,
            paths: state.doc.paths.map((p) =>
              p === active ? { ...p, closed: true } : p,
            ),
          })
        : state;
      return { ...next, activePathId: null };
    }
    case "set_style":
      return commit(state, {
        ...state.doc,
        style: { ...state.doc.style, ...action.style },
      });
    case "load":
      return { ...commit(state, action.doc), activePathId: null };
    case "clear":
      return { ...commit(state, emptyDocument()), activePathId: null };
    case "undo": {
      if (state.past.length === 0) return state;
      const doc = state.past[state.past.length - 1];
      return {
        doc,
        past: state.past.slice(0, -1),
        future: [state.doc, ...state.future],
        activePathId: null,
      };
    }
    case "redo": {
      if (state.future.length === 0) return state;
      return {
        doc: state.future[0],
        past: [...state.past, state.doc],
        future: state.future.slice(1),
        activePathId: null,
      };
    }
  }
}
