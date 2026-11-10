import { mmToClient, clientToMm } from "@/_lib/trace/units";
import { constrained } from "@/_lib/geometry";
import { exportSvg } from "@/_lib/trace/export-svg";
import { parseDocument, serializeDocument } from "@/_lib/trace/project-file";
import { Point } from "@/_lib/point";
import { flattenPath } from "@/_lib/trace/spline";
import { dist } from "@/_lib/geometry";
import traceReducer, { initialTraceState } from "@/_reducers/traceReducer";
import Matrix from "ml-matrix";
import { useTranslations } from "next-intl";
import { useEffect, useReducer, useRef, useState } from "react";

function download(name: string, text: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

const NUDGE_MM = 0.5;
const NUDGE_FINE_MM = 0.1;
const NUDGE_COARSE_MM = 5;
const HIT_RADIUS_PX = 16;
const MAGNIFIER_RADIUS_PX = 90;
const MAGNIFIER_ZOOM = 3;

const btn =
  "px-2 py-1 rounded border-2 border-black dark:border-white bg-white dark:bg-black text-sm disabled:opacity-40";

/**
 * Trace mode: draws vector geometry stored in millimetres of mat space.
 * The calibration transform is the only link to the screen.
 */
export default function TraceCanvas({
  calibrationTransform,
  onClose,
}: {
  calibrationTransform: Matrix;
  onClose: () => void;
}) {
  const t = useTranslations("TraceCanvas");
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [state, dispatch] = useReducer(traceReducer, initialTraceState());
  const [cursorMm, setCursorMm] = useState<Point | null>(null);
  const [shift, setShift] = useState(false);
  const [tool, setTool] = useState<"line" | "curve" | "edit">("line");
  const [magnifier, setMagnifier] = useState(true);
  const drag = useRef<{ started: boolean } | null>(null);
  const { doc, activePathId, selection } = state;
  const selRef = useRef(selection);
  selRef.current = selection;

  const hitNode = (e: { clientX: number; clientY: number }) => {
    const client = { x: e.clientX, y: e.clientY };
    const visible = new Set(
      doc.layers.filter((l) => l.visible).map((l) => l.id),
    );
    let best: { pathId: string; index: number } | null = null;
    let bestD = HIT_RADIUS_PX;
    for (const path of doc.paths) {
      if (!visible.has(path.layerId)) continue;
      path.nodes.forEach((n, index) => {
        const dd = dist(mmToClient(n, calibrationTransform), client);
        if (dd <= bestD) {
          bestD = dd;
          best = { pathId: path.id, index };
        }
      });
    }
    return best as { pathId: string; index: number } | null;
  };

  const toMm = (e: { clientX: number; clientY: number }): Point => {
    let p = clientToMm({ x: e.clientX, y: e.clientY }, calibrationTransform);
    const active = doc.paths.find((path) => path.id === activePathId);
    if (shift && active) {
      p = constrained(p, active.nodes[active.nodes.length - 1]);
    }
    return p;
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      setShift(e.shiftKey);
      if (e.type !== "keydown") return;
      const target = e.target as HTMLElement;
      if (target.tagName === "INPUT") return;
      const handled = () => {
        e.preventDefault();
        e.stopImmediatePropagation();
      };
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === "z") {
        handled();
        dispatch({ type: e.shiftKey ? "redo" : "undo" });
      } else if (mod && e.key.toLowerCase() === "y") {
        handled();
        dispatch({ type: "redo" });
      } else if (mod) {
        return;
      } else if (e.key === "Enter" || e.key === "Escape") {
        dispatch({ type: "finish_path" });
      } else if (selRef.current) {
        const step = e.altKey
          ? NUDGE_FINE_MM
          : e.shiftKey
            ? NUDGE_COARSE_MM
            : NUDGE_MM;
        const arrows: Record<string, [number, number]> = {
          ArrowLeft: [-step, 0],
          ArrowRight: [step, 0],
          ArrowUp: [0, -step],
          ArrowDown: [0, step],
        };
        if (arrows[e.key]) {
          handled();
          dispatch({
            type: "nudge",
            dx: arrows[e.key][0],
            dy: arrows[e.key][1],
          });
        } else if (e.key === "Delete" || e.key === "Backspace") {
          handled();
          dispatch({ type: "delete_node" });
        } else if (e.key.toLowerCase() === "c") {
          handled();
          dispatch({ type: "toggle_corner" });
        }
      }
    };
    // Capture phase so nudging does not also move the projected pattern.
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("keyup", onKey, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("keyup", onKey, true);
    };
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.strokeStyle = doc.style.color;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    // Thickness is in mm; scale by the local px/mm of the projected mat.
    const o = mmToClient({ x: 0, y: 0 }, calibrationTransform);
    const u = mmToClient({ x: 1, y: 0 }, calibrationTransform);
    ctx.lineWidth = Math.max(
      1,
      doc.style.thickness * Math.hypot(u.x - o.x, u.y - o.y),
    );
    const visible = new Set(
      doc.layers.filter((l) => l.visible).map((l) => l.id),
    );
    const drawAll = () => {
      for (const path of doc.paths) {
        if (!visible.has(path.layerId) || path.nodes.length === 0) continue;
        const pts = flattenPath(path).map((p) =>
          mmToClient(p, calibrationTransform),
        );
        if (path.id === activePathId && cursorMm) {
          pts.push(mmToClient(cursorMm, calibrationTransform));
        }
        ctx.beginPath();
        pts.forEach((p, i) =>
          i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y),
        );
        ctx.stroke();
      }
    };
    drawAll();

    // Node handles: hollow circles, corners as squares, selection filled.
    ctx.save();
    ctx.lineWidth = 2;
    for (const path of doc.paths) {
      if (!visible.has(path.layerId)) continue;
      path.nodes.forEach((n, i) => {
        const c = mmToClient(n, calibrationTransform);
        const sel = selection?.pathId === path.id && selection.index === i;
        ctx.strokeStyle = "#2563eb";
        ctx.fillStyle = sel ? "#2563eb" : "rgba(255,255,255,0.6)";
        ctx.beginPath();
        if (n.corner) ctx.rect(c.x - 5, c.y - 5, 10, 10);
        else ctx.arc(c.x, c.y, 5, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      });
    }
    ctx.restore();

    if (magnifier && cursorMm) {
      const c = mmToClient(cursorMm, calibrationTransform);
      ctx.save();
      ctx.beginPath();
      ctx.arc(c.x, c.y, MAGNIFIER_RADIUS_PX, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(255,255,255,0.9)";
      ctx.fill();
      ctx.clip();
      ctx.translate(c.x, c.y);
      ctx.scale(MAGNIFIER_ZOOM, MAGNIFIER_ZOOM);
      ctx.translate(-c.x, -c.y);
      ctx.lineWidth = ctx.lineWidth / MAGNIFIER_ZOOM;
      drawAll();
      ctx.restore();
      ctx.save();
      ctx.strokeStyle = "#000";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(c.x, c.y, MAGNIFIER_RADIUS_PX, 0, Math.PI * 2);
      ctx.moveTo(c.x - 8, c.y);
      ctx.lineTo(c.x + 8, c.y);
      ctx.moveTo(c.x, c.y - 8);
      ctx.lineTo(c.x, c.y + 8);
      ctx.stroke();
      ctx.restore();
    }
  }, [doc, activePathId, cursorMm, calibrationTransform, selection, magnifier]);

  const importFile = async (file: File | undefined) => {
    if (!file) return;
    try {
      dispatch({ type: "load", doc: parseDocument(await file.text()) });
    } catch {
      alert(t("invalidFile"));
    }
  };

  return (
    <>
      <div
        className="absolute inset-0 cursor-crosshair touch-none"
        onPointerDown={(e) => {
          e.preventDefault();
          const hit = activePathId ? null : hitNode(e);
          if (hit) {
            dispatch({ type: "select", selection: hit });
            drag.current = { started: false };
            e.currentTarget.setPointerCapture(e.pointerId);
          } else if (tool === "edit") {
            dispatch({ type: "select", selection: null });
          } else {
            dispatch({
              type: "add_point",
              point: toMm(e),
              curve: tool === "curve",
            });
          }
        }}
        onPointerMove={(e) => {
          setCursorMm(toMm(e));
          if (drag.current && selection) {
            const point = clientToMm(
              { x: e.clientX, y: e.clientY },
              calibrationTransform,
            );
            dispatch({
              type: "move_node",
              ...selection,
              point,
              record: !drag.current.started,
            });
            drag.current.started = true;
          }
        }}
        onPointerUp={() => (drag.current = null)}
        onPointerCancel={() => (drag.current = null)}
        onDoubleClick={() => dispatch({ type: "finish_path", close: false })}
      >
        <canvas
          ref={canvasRef}
          className="absolute top-0 inset-0 w-full h-full pointer-events-none"
        />
      </div>
      <div className="absolute bottom-2 left-1/2 -translate-x-1/2 flex flex-wrap gap-2 items-center p-2 bg-white/80 dark:bg-black/80 rounded z-50">
        {(["line", "curve", "edit"] as const).map((k) => (
          <button
            key={k}
            className={`${btn} ${tool === k ? "!bg-purple-600 text-white" : ""}`}
            onClick={() => {
              dispatch({ type: "finish_path" });
              setTool(k);
            }}
          >
            {t(`tool_${k}`)}
          </button>
        ))}
        <button
          className={`${btn} ${magnifier ? "!bg-purple-600 text-white" : ""}`}
          onClick={() => setMagnifier(!magnifier)}
        >
          {t("magnifier")}
        </button>
        <button
          className={btn}
          onClick={() => dispatch({ type: "toggle_corner" })}
          disabled={!selection}
        >
          {t("toggleCorner")}
        </button>
        <button
          className={btn}
          onClick={() => dispatch({ type: "delete_node" })}
          disabled={!selection}
        >
          {t("deletePoint")}
        </button>
        <button
          className={btn}
          onClick={() => dispatch({ type: "undo" })}
          disabled={state.past.length === 0}
        >
          {t("undo")}
        </button>
        <button
          className={btn}
          onClick={() => dispatch({ type: "redo" })}
          disabled={state.future.length === 0}
        >
          {t("redo")}
        </button>
        <button
          className={btn}
          onClick={() => dispatch({ type: "finish_path", close: false })}
        >
          {t("finish")}
        </button>
        <button
          className={btn}
          onClick={() => dispatch({ type: "finish_path", close: true })}
        >
          {t("close")}
        </button>
        <label className="text-sm">
          {t("color")}{" "}
          <input
            type="color"
            value={doc.style.color}
            onChange={(e) =>
              dispatch({ type: "set_style", style: { color: e.target.value } })
            }
          />
        </label>
        <label className="text-sm">
          {t("thickness")}{" "}
          <input
            type="number"
            className="w-16 border border-black dark:border-white bg-transparent"
            min={0.1}
            step={0.1}
            value={doc.style.thickness}
            onChange={(e) => {
              const v = parseFloat(e.target.value);
              if (v > 0)
                dispatch({ type: "set_style", style: { thickness: v } });
            }}
          />
        </label>
        <button
          className={btn}
          onClick={() => download("trace.svg", exportSvg(doc), "image/svg+xml")}
        >
          {t("exportSvg")}
        </button>
        <button
          className={btn}
          onClick={() =>
            download("trace.json", serializeDocument(doc), "application/json")
          }
        >
          {t("save")}
        </button>
        <button className={btn} onClick={() => fileRef.current?.click()}>
          {t("open")}
        </button>
        <input
          ref={fileRef}
          type="file"
          accept=".json,application/json"
          className="hidden"
          onChange={(e) => {
            importFile(e.target.files?.[0]);
            e.target.value = "";
          }}
        />
        <button className={btn} onClick={onClose}>
          {t("exit")}
        </button>
      </div>
    </>
  );
}
