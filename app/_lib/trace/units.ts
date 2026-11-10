import { Matrix, inverse } from "ml-matrix";
import { Point } from "@/_lib/point";
import { transformPoint } from "@/_lib/geometry";
import { CSS_PIXELS_PER_INCH } from "@/_lib/pixels-per-inch";

export const MM_PER_INCH = 25.4;
export const PX_PER_MM = CSS_PIXELS_PER_INCH / MM_PER_INCH;
export const PT_PER_MM = 72 / MM_PER_INCH;

/** Calibrated mat space is in CSS pixels at 96 per inch. */
export function mmToMat(p: Point): Point {
  return { x: p.x * PX_PER_MM, y: p.y * PX_PER_MM };
}

export function matToMm(p: Point): Point {
  return { x: p.x / PX_PER_MM, y: p.y / PX_PER_MM };
}

/** Screen (client) point to mat millimetres, via the calibration transform. */
export function clientToMm(p: Point, calibrationTransform: Matrix): Point {
  return matToMm(transformPoint(p, inverse(calibrationTransform)));
}

/** Mat millimetres to screen (client) point. */
export function mmToClient(p: Point, calibrationTransform: Matrix): Point {
  return transformPoint(mmToMat(p), calibrationTransform);
}
