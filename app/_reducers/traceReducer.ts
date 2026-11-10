import { Point } from "@/_lib/point";
import {
  DEFAULT_LAYER_ID,
  TraceDocument,
  TraceNode,
  TraceStyle,
  emptyDocument,
} from "@/_lib/trace/types";

export interface TraceState {
  doc: TraceDocument;
  past: TraceDocument[];
  future: TraceDocument[];
  /** Id of the path currently being drawn, if any. */
  activePathId: string | null;
  selection: { pathId: string; index: number } | null;
}

export type TraceAction =
  | { type: "add_point"; point: Point; curve?: boolean }
  | { type: "select"; selection: TraceState["selection"] }
  | {
      type: "move_node";
      pathId: string;
      index: number;
      point: Point;
      /** Push an undo step (true on the first move of a drag). */
      record: boolean;
    }
  | { type: "nudge"; dx: number; dy: number }
  | { type: "delete_node" }
  | { type: "toggle_corner" }
  | { type: "finish_path"; close?: boolean }
  | { type: "set_style"; style: Partial<TraceStyle> }
  | { type: "load"; doc: TraceDocument }
  | { type: "clear" }
  | { type: "undo" }
  | { type: "redo" };

export function initialTraceState(): TraceState {
  return {
    doc: emptyDocument(),
    past: [],
    future: [],
    activePathId: null,
    selection: null,
  };
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

function withNode(
  doc: TraceDocument,
  pathId: string,
  index: number,
  f: (n: TraceNode) => TraceNode,
): TraceDocument {
  return {
    ...doc,
    paths: doc.paths.map((p) =>
      p.id === pathId
        ? { ...p, nodes: p.nodes.map((n, i) => (i === index ? f(n) : n)) }
        : p,
    ),
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
          {
            id,
            layerId,
            nodes: [node],
            closed: false,
            ...(action.curve ? { curve: true } : {}),
          },
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
    case "select":
      return { ...state, selection: action.selection, activePathId: null };
    case "move_node": {
      const path = state.doc.paths.find((p) => p.id === action.pathId);
      if (!path || !path.nodes[action.index]) return state;
      const doc = withNode(state.doc, action.pathId, action.index, (n) => ({
        ...n,
        x: action.point.x,
        y: action.point.y,
      }));
      return action.record ? commit(state, doc) : { ...state, doc };
    }
    case "nudge": {
      const sel = state.selection;
      if (!sel) return state;
      const node = state.doc.paths.find((p) => p.id === sel.pathId)?.nodes[
        sel.index
      ];
      if (!node) return state;
      return commit(
        state,
        withNode(state.doc, sel.pathId, sel.index, (n) => ({
          ...n,
          x: n.x + action.dx,
          y: n.y + action.dy,
        })),
      );
    }
    case "toggle_corner": {
      const sel = state.selection;
      if (!sel) return state;
      return commit(
        state,
        withNode(state.doc, sel.pathId, sel.index, (n) => {
          const { corner, ...rest } = n;
          return corner ? rest : { ...rest, corner: true };
        }),
      );
    }
    case "delete_node": {
      const sel = state.selection;
      const path = state.doc.paths.find((p) => p.id === sel?.pathId);
      if (!sel || !path) return state;
      const nodes = path.nodes.filter((_, i) => i !== sel.index);
      const paths =
        nodes.length < 2
          ? state.doc.paths.filter((p) => p !== path)
          : state.doc.paths.map((p) =>
              p === path
                ? { ...p, nodes, closed: p.closed && nodes.length > 2 }
                : p,
            );
      return {
        ...commit(state, { ...state.doc, paths }),
        selection: null,
        activePathId: null,
      };
    }
    case "set_style":
      return commit(state, {
        ...state.doc,
        style: { ...state.doc.style, ...action.style },
      });
    case "load":
      return {
        ...commit(state, action.doc),
        activePathId: null,
        selection: null,
      };
    case "clear":
      return {
        ...commit(state, emptyDocument()),
        activePathId: null,
        selection: null,
      };
    case "undo": {
      if (state.past.length === 0) return state;
      const doc = state.past[state.past.length - 1];
      return {
        doc,
        past: state.past.slice(0, -1),
        future: [state.doc, ...state.future],
        activePathId: null,
        selection: null,
      };
    }
    case "redo": {
      if (state.future.length === 0) return state;
      return {
        doc: state.future[0],
        past: [...state.past, state.doc],
        future: state.future.slice(1),
        activePathId: null,
        selection: null,
      };
    }
  }
}
