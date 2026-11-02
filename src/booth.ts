/**
 * Booth geometry, colours and print thresholds.
 * All sizes are in millimetres. Change the numbers here if the stand changes.
 */

export type WallId = 'left' | 'back' | 'right';
export type WallKind = 'side' | 'back';

export interface WallSpec {
  id: WallId;
  kind: WallKind;
  title: string;
  subtitle: string;
  /** Panels as seen when standing in front of the wall, from left to right. */
  panels: { id: string; width: number }[];
}

const WALLS: WallSpec[] = [
  {
    id: 'left',
    kind: 'side',
    title: 'BOČNI ZID',
    subtitle: 'lijevo',
    panels: [
      { id: '7', width: 455 },
      { id: '8', width: 455 },
    ],
  },
  {
    id: 'back',
    kind: 'back',
    title: 'STRAŽNJI ZID',
    subtitle: 'nasuprot posjetiteljima',
    panels: [
      { id: '1', width: 40 },
      { id: '2', width: 950 },
      { id: '3', width: 950 },
      { id: '4', width: 950 },
    ],
  },
  {
    id: 'right',
    kind: 'side',
    title: 'BOČNI ZID',
    subtitle: 'desno',
    panels: [
      { id: '5', width: 455 },
      { id: '6', width: 455 },
    ],
  },
];

export const BOOTH = {
  wallHeight: 2350,
  /** Aluminium profile between neighbouring panels. Drawn only, never printed. */
  postWidth: 20,
  walls: WALLS,
  /** Parts made by the organiser. Shown greyed out for context only. */
  organizer: {
    fascia: [
      { id: '11', width: 1940, height: 330 },
      { id: '12', width: 950, height: 330 },
    ],
    counter: { front: '9', side: '10', width: 950, height: 855, depth: 500 },
  },
};

export const PRINT = {
  /** Effective resolution at final print size. */
  dpiGood: 120,
  dpiMin: 75,
  /** Text smaller than this is hard to read from a few metres away. */
  minTextMm: 20,
};

export const COLORS: Record<WallKind | 'organizer', string> = {
  back: '#2563eb',
  side: '#ea580c',
  organizer: '#94a3b8',
};

/** Canvas-only layout constants (mm, in the unfolded wall view). */
export const CANVAS = {
  wallGap: 320,
  bandY: -480,
  bandH: 230,
};

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface PanelLayout extends Rect {
  id: string;
  wall: WallId;
  kind: WallKind;
}

export interface WallLayout extends Rect {
  id: WallId;
  kind: WallKind;
  title: string;
  subtitle: string;
  panels: PanelLayout[];
}

export interface Layout {
  walls: WallLayout[];
  panels: PanelLayout[];
  bounds: Rect;
  wall(id: WallId): WallLayout;
  panel(id: string): PanelLayout | undefined;
}

/** Lays the three walls out side by side ("unfolded"), each as seen from inside the stand. */
export function computeLayout(): Layout {
  const walls: WallLayout[] = [];
  const panels: PanelLayout[] = [];
  let x = 0;
  for (const spec of BOOTH.walls) {
    const start = x;
    const own: PanelLayout[] = [];
    spec.panels.forEach((p, i) => {
      if (i > 0) x += BOOTH.postWidth;
      const panel: PanelLayout = { id: p.id, wall: spec.id, kind: spec.kind, x, y: 0, w: p.width, h: BOOTH.wallHeight };
      own.push(panel);
      panels.push(panel);
      x += p.width;
    });
    walls.push({ id: spec.id, kind: spec.kind, title: spec.title, subtitle: spec.subtitle, x: start, y: 0, w: x - start, h: BOOTH.wallHeight, panels: own });
    x += CANVAS.wallGap;
  }
  const right = x - CANVAS.wallGap + 80;
  const left = -290;
  const top = CANVAS.bandY - 60;
  const bottom = BOOTH.wallHeight + 160;
  return {
    walls,
    panels,
    bounds: { x: left, y: top, w: right - left, h: bottom - top },
    wall: (id) => walls.find((w) => w.id === id)!,
    panel: (id) => panels.find((p) => p.id === id),
  };
}

export function wallName(kind: WallKind, wall: WallId): string {
  if (kind === 'back') return 'Stražnji zid';
  return wall === 'left' ? 'Bočni zid – lijevo' : 'Bočni zid – desno';
}

export function panelAt(layout: Layout, x: number, y: number): PanelLayout | undefined {
  return layout.panels.find((p) => x >= p.x && x <= p.x + p.w && y >= p.y && y <= p.y + p.h);
}

export function nearestPanel(layout: Layout, x: number, y: number): PanelLayout {
  let best = layout.panels[0];
  let bestD = Infinity;
  for (const p of layout.panels) {
    const dx = Math.max(p.x - x, 0, x - (p.x + p.w));
    const dy = Math.max(p.y - y, 0, y - (p.y + p.h));
    const d = dx * dx + dy * dy;
    if (d < bestD) {
      bestD = d;
      best = p;
    }
  }
  return best;
}

export function intersect(a: Rect, b: Rect): Rect | null {
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  const r = Math.min(a.x + a.w, b.x + b.w);
  const btm = Math.min(a.y + a.h, b.y + b.h);
  return r > x && btm > y ? { x, y, w: r - x, h: btm - y } : null;
}

/** Panels a box overlaps, largest overlap first. */
export function panelsTouched(layout: Layout, box: Rect): { panel: PanelLayout; area: number }[] {
  const out: { panel: PanelLayout; area: number }[] = [];
  for (const p of layout.panels) {
    const i = intersect(p, box);
    if (i && i.w * i.h > 1) out.push({ panel: p, area: i.w * i.h });
  }
  return out.sort((a, b) => b.area - a.area);
}

/** The panel an element "belongs" to: the one holding its centre, else the one it overlaps most. */
export function primaryPanel(layout: Layout, box: Rect): PanelLayout {
  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2;
  return panelAt(layout, cx, cy) ?? panelsTouched(layout, box)[0]?.panel ?? nearestPanel(layout, cx, cy);
}
