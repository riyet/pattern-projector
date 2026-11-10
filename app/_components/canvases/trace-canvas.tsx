import { mmToClient, clientToMm } from "@/_lib/trace/units";
import { constrained } from "@/_lib/geometry";
import { exportSvg } from "@/_lib/trace/export-svg";
import { parseDocument, serializeDocument } from "@/_lib/trace/project-file";
import { Point } from "@/_lib/point";
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
  const { doc, activePathId } = state;

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
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        dispatch({ type: e.shiftKey ? "redo" : "undo" });
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "y") {
        e.preventDefault();
        dispatch({ type: "redo" });
      } else if (e.key === "Enter" || e.key === "Escape") {
        dispatch({ type: "finish_path" });
      }
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("keyup", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("keyup", onKey);
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
    for (const path of doc.paths) {
      if (!visible.has(path.layerId) || path.nodes.length === 0) continue;
      const pts = path.nodes.map((n) => mmToClient(n, calibrationTransform));
      if (path.id === activePathId && cursorMm) {
        pts.push(mmToClient(cursorMm, calibrationTransform));
      }
      ctx.beginPath();
      pts.forEach((p, i) =>
        i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y),
      );
      if (path.closed) ctx.closePath();
      ctx.stroke();
    }
  }, [doc, activePathId, cursorMm, calibrationTransform]);

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
          dispatch({ type: "add_point", point: toMm(e) });
        }}
        onPointerMove={(e) => setCursorMm(toMm(e))}
        onDoubleClick={() => dispatch({ type: "finish_path", close: false })}
      >
        <canvas
          ref={canvasRef}
          className="absolute top-0 inset-0 w-full h-full pointer-events-none"
        />
      </div>
      <div className="absolute bottom-2 left-1/2 -translate-x-1/2 flex flex-wrap gap-2 items-center p-2 bg-white/80 dark:bg-black/80 rounded z-50">
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
