/* S6: project grid defaults, backward-compatible with flat ui fields. */

export interface GridPrefs {
  spacing: number;
  subdivisions: number;
  show: boolean;
  snap: boolean;
  markers: boolean;
  angleMode: 'constrained' | 'free';
  angleSet: number[];
  angleToleranceDeg: number;
  showOrigin: boolean;
  showRuler: boolean;
  adaptiveZoom: boolean;
  orthogonal: boolean;
}

export const ALLOWED_ANGLES = [0, 45, 60, 90];

function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function numberIn(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

export function normaliseAngleSet(value: unknown): number[] {
  if (!Array.isArray(value)) return ALLOWED_ANGLES.slice();
  const seen = new Set<number>();
  for (const item of value) {
    const angle = Number(item);
    if (ALLOWED_ANGLES.includes(angle)) seen.add(angle);
  }
  if (!seen.has(0)) seen.add(0);
  return ALLOWED_ANGLES.filter((angle) => seen.has(angle));
}

export function gridPrefsFromUi(ui: Record<string, unknown>): GridPrefs {
  const nested = ui.grid && typeof ui.grid === 'object' && !Array.isArray(ui.grid)
    ? ui.grid as Record<string, unknown>
    : {};
  const spacing = numberIn(nested.spacing ?? nested.size ?? ui.grid, 20, 5, 80);
  const subdivisions = Math.round(numberIn(nested.subdivisions ?? ui.gridSubdivisions, 4, 1, 20));
  return {
    spacing,
    subdivisions,
    show: bool(nested.show ?? ui.showGrid, true),
    snap: bool(nested.snap ?? ui.snap, true),
    markers: bool(nested.markers ?? ui.snapMarkers, true),
    angleMode: (nested.angle_mode ?? ui.angleMode) === 'free' ? 'free' : 'constrained',
    angleSet: normaliseAngleSet(nested.angle_set ?? ui.angleSet),
    angleToleranceDeg: numberIn(nested.angle_tolerance_deg ?? ui.angleToleranceDeg, 3, 0.5, 15),
    showOrigin: bool(nested.show_origin ?? ui.showOrigin, true),
    showRuler: bool(nested.show_ruler ?? ui.showRuler, false),
    adaptiveZoom: bool(nested.adaptive_zoom ?? ui.adaptiveZoom, true),
    orthogonal: bool(nested.orthogonal ?? ui.circuitOrthogonal, true),
  };
}

export function gridPrefsPayload(ui: Record<string, unknown>): Record<string, unknown> {
  const prefs = gridPrefsFromUi(ui);
  return {
    size: prefs.spacing,
    spacing: prefs.spacing,
    subdivisions: prefs.subdivisions,
    show: prefs.show,
    snap: prefs.snap,
    markers: prefs.markers,
    angle_mode: prefs.angleMode,
    angle_set: prefs.angleSet.slice(),
    angle_tolerance_deg: prefs.angleToleranceDeg,
    show_origin: prefs.showOrigin,
    show_ruler: prefs.showRuler,
    adaptive_zoom: prefs.adaptiveZoom,
    orthogonal: prefs.orthogonal,
  };
}

export function applyGridPayload(ui: Record<string, unknown>, source: unknown): GridPrefs {
  const nested = source && typeof source === 'object' && !Array.isArray(source)
    ? source as Record<string, unknown>
    : {};
  ui.grid = nested.spacing ?? nested.size;
  ui.gridSubdivisions = nested.subdivisions;
  ui.showGrid = nested.show;
  ui.snap = nested.snap;
  ui.snapMarkers = nested.markers;
  ui.angleMode = nested.angle_mode;
  ui.angleSet = nested.angle_set;
  ui.angleToleranceDeg = nested.angle_tolerance_deg;
  ui.showOrigin = nested.show_origin;
  ui.showRuler = nested.show_ruler;
  ui.adaptiveZoom = nested.adaptive_zoom;
  ui.circuitOrthogonal = nested.orthogonal;
  return gridPrefsFromUi(ui);
}

export function snapToGrid(value: number, prefs: GridPrefs): number {
  const step = prefs.spacing / prefs.subdivisions;
  return Math.round(value / step) * step;
}

export function allowedAngles(prefs: GridPrefs): number[] {
  return prefs.angleMode === 'free' ? [] : prefs.angleSet.slice();
}
