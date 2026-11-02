import Konva from 'konva';
import { BOOTH, CANVAS, COLORS, type Layout, type Rect, type WallId, nearestPanel, panelAt } from './booth';
import { facultyById, textOn } from './event';
import type { Item, Store, TextItem } from './state';
import { clamp, round1 } from './util';

Konva.dragDistance = 3;

const UI_FONT = 'Inter, system-ui, sans-serif';
const MASK_SCREEN = 'rgba(231, 235, 240, 0.9)';
const OUTLINE = '#b4bfcc';
const POST = '#9aa4b1';
const TEXT_ANCHORS = ['top-left', 'top-right', 'bottom-left', 'bottom-right', 'middle-left', 'middle-right'];
const IMAGE_ANCHORS = ['top-left', 'top-right', 'bottom-left', 'bottom-right'];

type ItemNode = Konva.Image | Konva.Text;
type Vec = { x: number; y: number };

export const konvaFont = (family: string) => `"${family}", sans-serif`;
export const fontStyle = (t: TextItem) => `${t.italic ? 'italic ' : ''}${t.bold ? 'bold' : 'normal'}`;

/**
 * The editing canvas. World units are millimetres; the three walls are drawn
 * "unfolded" side by side, each as seen when standing in front of it.
 */
export class BoothCanvas {
  readonly stage: Konva.Stage;
  private readonly bgLayer = new Konva.Layer();
  private readonly contentLayer = new Konva.Layer();
  private readonly overlayLayer = new Konva.Layer({ listening: false });
  private readonly uiLayer = new Konva.Layer();
  private readonly tr: Konva.Transformer;
  private readonly guides = new Konva.Group({ listening: false });
  private readonly nodes = new Map<string, ItemNode>();
  private readonly panelFills = new Map<string, Konva.Rect>();
  private readonly outlines = new Map<string, Konva.Rect>();
  private readonly watermarks = new Konva.Group({ listening: false });
  private readonly labels = new Konva.Group({ listening: false });
  private maskFill = MASK_SCREEN;
  private fitScale = 1;
  /** True once the user has zoomed or panned; until then resizing keeps the whole stand in view. */
  private viewTouched = false;

  onViewChange: () => void = () => {};
  onTextDblClick: (id: string) => void = () => {};

  constructor(
    private readonly container: HTMLDivElement,
    private readonly store: Store,
    readonly layout: Layout,
  ) {
    this.stage = new Konva.Stage({
      container,
      width: container.clientWidth || 800,
      height: container.clientHeight || 600,
      draggable: true,
    });
    this.tr = new Konva.Transformer({
      rotationSnaps: [0, 90, 180, 270],
      rotationSnapTolerance: 4,
      anchorSize: 10,
      anchorCornerRadius: 3,
      anchorStroke: '#2563eb',
      anchorFill: '#ffffff',
      borderStroke: '#2563eb',
      borderStrokeWidth: 1.5,
      keepRatio: true,
      flipEnabled: false,
      ignoreStroke: true,
      boundBoxFunc: (oldBox, newBox) => (Math.abs(newBox.width) < 8 || Math.abs(newBox.height) < 8 ? oldBox : newBox),
    });
    this.uiLayer.add(this.guides, this.tr);
    this.stage.add(this.bgLayer, this.contentLayer, this.overlayLayer, this.uiLayer);

    this.buildBackground();
    this.buildOverlay();
    this.bindEvents();
    this.syncPanels();

    store.on((kind) => {
      if (kind === 'doc') {
        this.syncItems();
        this.syncPanels();
        this.syncSelection();
      } else if (kind === 'exhibitor') this.syncPanels();
      else if (kind === 'selection') this.syncSelection();
      else if (kind === 'hover') this.syncOutlines();
    });

    new ResizeObserver(() => this.resize()).observe(container);
    this.resize();
  }

  // ---------- static drawing ----------

  private buildBackground() {
    for (const p of this.layout.panels) {
      const fill = new Konva.Rect({ x: p.x, y: p.y, width: p.w, height: p.h, fill: '#ffffff' });
      this.panelFills.set(p.id, fill);
      this.bgLayer.add(fill);
      const fs = Math.min(560, p.w * 0.7);
      this.watermarks.add(
        new Konva.Text({
          x: p.x,
          y: p.y + p.h / 2 - fs / 2,
          width: p.w,
          align: 'center',
          text: p.id,
          fontSize: fs,
          fontStyle: 'bold',
          fontFamily: UI_FONT,
          fill: 'rgba(15, 23, 42, 0.06)',
        }),
      );
    }
    this.bgLayer.add(this.watermarks);
  }

  private buildOverlay() {
    // Dims everything outside the printable panels, so overflow is obvious.
    const mask = new Konva.Shape({
      sceneFunc: (ctx) => {
        const c = ctx._context;
        c.beginPath();
        c.rect(-1e5, -1e5, 2e5, 2e5);
        for (const p of this.layout.panels) c.rect(p.x, p.y, p.w, p.h);
        c.fillStyle = this.maskFill;
        c.fill('evenodd');
      },
    });
    this.overlayLayer.add(mask);

    // Aluminium profiles between panels of the same wall.
    for (const w of this.layout.walls) {
      for (let i = 1; i < w.panels.length; i++) {
        const a = w.panels[i - 1];
        this.overlayLayer.add(new Konva.Rect({ x: a.x + a.w, y: 0, width: BOOTH.postWidth, height: BOOTH.wallHeight, fill: POST }));
      }
    }

    for (const p of this.layout.panels) {
      const o = new Konva.Rect({ x: p.x, y: p.y, width: p.w, height: p.h, stroke: OUTLINE, strokeWidth: 1, strokeScaleEnabled: false });
      this.outlines.set(p.id, o);
      this.overlayLayer.add(o);
    }

    this.buildLabels();
    this.overlayLayer.add(this.labels);
  }

  private buildLabels() {
    const g = this.labels;
    const H = BOOTH.wallHeight;
    const { bandY, bandH } = CANVAS;

    for (const w of this.layout.walls) {
      const color = COLORS[w.kind];
      g.add(new Konva.Rect({ x: w.x, y: bandY, width: w.w, height: bandH, fill: color, cornerRadius: 28 }));
      const iw = 180;
      const ih = 124;
      const ix = w.x + 44;
      const iy = bandY + (bandH - ih) / 2;
      this.addWallIcon(ix, iy, iw, ih, w.id);
      const tx = ix + iw + 44;
      g.add(new Konva.Text({ x: tx, y: bandY + 36, text: w.title, fontSize: 88, fontStyle: 'bold', fontFamily: UI_FONT, fill: '#ffffff' }));
      g.add(new Konva.Text({ x: tx, y: bandY + 140, text: w.subtitle, fontSize: 56, fontFamily: UI_FONT, fill: 'rgba(255,255,255,0.88)' }));

      for (const p of w.panels) {
        const cx = p.x + p.w / 2;
        g.add(new Konva.Circle({ x: cx, y: -165, radius: 62, fill: '#ffffff', stroke: color, strokeWidth: 14 }));
        g.add(
          new Konva.Text({
            x: cx - 62,
            y: -227,
            width: 124,
            height: 124,
            align: 'center',
            verticalAlign: 'middle',
            text: p.id,
            fontSize: 72,
            fontStyle: 'bold',
            fontFamily: UI_FONT,
            fill: color,
          }),
        );
        g.add(
          new Konva.Text({
            x: cx - 220,
            y: -84,
            width: 440,
            align: 'center',
            text: `${p.w} × ${p.h} mm`,
            fontSize: 48,
            fontFamily: UI_FONT,
            fill: '#475569',
          }),
        );
      }
    }

    // Corner markers between the unfolded walls.
    for (let i = 1; i < this.layout.walls.length; i++) {
      const a = this.layout.walls[i - 1];
      const b = this.layout.walls[i];
      const gx = (a.x + a.w + b.x) / 2;
      g.add(new Konva.Line({ points: [gx, 0, gx, H], stroke: '#94a3b8', strokeWidth: 1.5, strokeScaleEnabled: false, dash: [40, 34] }));
      g.add(new Konva.Text({ x: gx - 150, y: H + 40, width: 300, align: 'center', text: 'kut 90°', fontSize: 50, fontFamily: UI_FONT, fill: '#64748b' }));
    }

    // Height dimension on the far left.
    const dx = this.layout.walls[0].x - 150;
    const dim = { stroke: '#64748b', strokeWidth: 1.5, strokeScaleEnabled: false };
    g.add(new Konva.Line({ points: [dx, 0, dx, H], ...dim }));
    g.add(new Konva.Line({ points: [dx - 36, 0, dx + 36, 0], ...dim }));
    g.add(new Konva.Line({ points: [dx - 36, H, dx + 36, H], ...dim }));
    g.add(new Konva.Text({ x: dx - 82, y: H / 2 + 190, text: `${H} mm`, rotation: -90, fontSize: 54, fontFamily: UI_FONT, fill: '#475569' }));

    // Floor line under each wall.
    for (const w of this.layout.walls) {
      g.add(new Konva.Rect({ x: w.x - 30, y: H, width: w.w + 60, height: 14, fill: '#94a3b8', cornerRadius: 7 }));
    }
  }

  /** Tiny top-down "U" of the stand with the current wall highlighted. */
  private addWallIcon(x: number, y: number, w: number, h: number, active: WallId) {
    const segs: Record<WallId, number[]> = {
      left: [x, y, x, y + h],
      back: [x, y, x + w, y],
      right: [x + w, y, x + w, y + h],
    };
    for (const id of ['left', 'back', 'right'] as WallId[]) {
      const on = id === active;
      this.labels.add(
        new Konva.Line({
          points: segs[id],
          stroke: on ? '#ffffff' : 'rgba(255,255,255,0.35)',
          strokeWidth: on ? 26 : 12,
          lineCap: 'round',
        }),
      );
    }
  }

  // ---------- events ----------

  private bindEvents() {
    const st = this.stage;

    st.on('wheel', (e) => {
      e.evt.preventDefault();
      const ev = e.evt;
      const k = ev.deltaMode === 1 ? 16 : 1;
      if (ev.ctrlKey || ev.metaKey) {
        const p = st.getPointerPosition();
        if (p) this.zoomAt(p, Math.exp(clamp(-ev.deltaY * k * 0.01, -0.3, 0.3)));
      } else {
        this.viewTouched = true;
        st.position({ x: st.x() - ev.deltaX * k, y: st.y() - ev.deltaY * k });
        this.onViewChange();
      }
    });

    st.on('dragmove', (e) => {
      if (e.target === st) this.onViewChange();
    });
    st.on('dragstart', (e) => {
      if (e.target !== st) return;
      this.viewTouched = true;
      this.container.style.cursor = 'grabbing';
    });
    st.on('dragend', (e) => {
      if (e.target === st) this.container.style.cursor = '';
    });

    st.on('mousemove', () => {
      const p = st.getRelativePointerPosition();
      this.store.setHover(p ? (panelAt(this.layout, p.x, p.y)?.id ?? null) : null);
    });
    st.on('mouseleave', () => this.store.setHover(null));

    st.on('click tap', (e) => {
      const target = e.target as Konva.Node;
      if (target.getAttr('itemId') || target.findAncestor('Transformer')) return;
      const p = st.getRelativePointerPosition();
      const panel = p ? panelAt(this.layout, p.x, p.y) : undefined;
      this.store.select(panel ? { type: 'panel', id: panel.id } : null);
    });
  }

  // ---------- items ----------

  private syncItems() {
    const items = this.store.doc.items;
    const ids = new Set(items.map((i) => i.id));
    for (const [id, node] of this.nodes) {
      if (!ids.has(id)) {
        node.destroy();
        this.nodes.delete(id);
      }
    }
    items.forEach((it, index) => {
      let node = this.nodes.get(it.id);
      if (!node) {
        node = this.createNode(it);
        this.nodes.set(it.id, node);
        this.contentLayer.add(node);
      }
      this.applyAttrs(node, it);
      node.zIndex(index);
    });
    this.contentLayer.batchDraw();
  }

  private createNode(it: Item): ItemNode {
    const id = it.id;
    const node: ItemNode = it.kind === 'image' ? new Konva.Image({ image: undefined }) : new Konva.Text({ wrap: 'word' });
    // Bind through the common base type; the union's overloads don't merge.
    const shape: Konva.Shape = node;
    shape.draggable(true);
    shape.setAttr('itemId', id);

    shape.on('mousedown touchstart', () => {
      if (!(this.store.selection?.type === 'item' && this.store.selection.id === id)) this.store.select({ type: 'item', id });
    });
    shape.on('mouseenter', () => (this.container.style.cursor = 'move'));
    shape.on('mouseleave', () => (this.container.style.cursor = ''));
    shape.on('dragmove', (e) => this.snap(node, !!(e.evt as MouseEvent | undefined)?.altKey));
    shape.on('dragend', () => {
      this.guides.destroyChildren();
      this.uiLayer.batchDraw();
      this.commit(id);
    });
    shape.on('transform', () => {
      if (node instanceof Konva.Text) this.normalizeTextTransform(node);
    });
    shape.on('transformend', () => this.commit(id));
    if (node instanceof Konva.Text) node.on('dblclick dbltap', () => this.onTextDblClick(id));
    return node;
  }

  private applyAttrs(node: ItemNode, it: Item) {
    const base = { x: it.x, y: it.y, rotation: it.rotation, scaleX: 1, scaleY: 1 };
    if (it.kind === 'image' && node instanceof Konva.Image) {
      node.setAttrs({ ...base, width: it.width, height: it.height, image: this.store.files.get(it.fileId)?.display ?? undefined });
    } else if (it.kind === 'text' && node instanceof Konva.Text) {
      node.setAttrs({
        ...base,
        text: it.text || ' ',
        width: it.width,
        fontSize: it.fontSize,
        fontFamily: konvaFont(it.fontFamily),
        fontStyle: fontStyle(it),
        fill: it.fill,
        align: it.align,
        lineHeight: it.lineHeight,
      });
    }
  }

  /** Side handles change the wrap width; corner handles scale the font. */
  private normalizeTextTransform(node: Konva.Text) {
    const anchor = this.tr.getActiveAnchor();
    const sx = node.scaleX();
    const sy = node.scaleY();
    if (anchor === 'middle-left' || anchor === 'middle-right') {
      node.setAttrs({ width: Math.max(20, node.width() * sx), scaleX: 1, scaleY: 1 });
    } else {
      node.setAttrs({ width: Math.max(20, node.width() * sx), fontSize: Math.max(3, node.fontSize() * sy), scaleX: 1, scaleY: 1 });
    }
  }

  private commit(id: string) {
    const node = this.nodes.get(id);
    if (!node) return;
    this.store.update((d) => {
      const it = d.items.find((i) => i.id === id);
      if (!it) return;
      it.x = round1(node.x());
      it.y = round1(node.y());
      it.rotation = round1(node.rotation());
      if (it.kind === 'image') {
        it.width = round1(node.width() * node.scaleX());
        it.height = round1(node.height() * node.scaleY());
      } else if (node instanceof Konva.Text) {
        it.width = round1(node.width() * node.scaleX());
        it.fontSize = round1(node.fontSize() * node.scaleY());
      }
    });
  }

  /** Snaps edges/centre of the dragged element to the edges/centre of its panel. */
  private snap(node: ItemNode, disabled: boolean) {
    this.guides.destroyChildren();
    if (disabled) {
      this.uiLayer.batchDraw();
      return;
    }
    const box = node.getClientRect({ relativeTo: this.contentLayer });
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;
    const p = panelAt(this.layout, cx, cy) ?? nearestPanel(this.layout, cx, cy);
    const th = 8 / this.stage.scaleX();
    const bx = closest([p.x, p.x + p.w / 2, p.x + p.w], [box.x, cx, box.x + box.width], th);
    const by = closest([p.y, p.y + p.h / 2, p.y + p.h], [box.y, cy, box.y + box.height], th);
    const guide = { stroke: '#e11d48', strokeWidth: 1, strokeScaleEnabled: false, dash: [30, 24] };
    if (bx) {
      node.x(node.x() + bx.delta);
      this.guides.add(new Konva.Line({ points: [bx.line, p.y, bx.line, p.y + p.h], ...guide }));
    }
    if (by) {
      node.y(node.y() + by.delta);
      this.guides.add(new Konva.Line({ points: [p.x, by.line, p.x + p.w, by.line], ...guide }));
    }
    this.uiLayer.batchDraw();
  }

  // ---------- panels & selection ----------

  /** Every panel takes the faculty colour; exhibitors can't change it. */
  private syncPanels() {
    const color = facultyById(this.store.doc.exhibitor.facultyId)?.color ?? '#ffffff';
    for (const rect of this.panelFills.values()) rect.fill(color);
    const mark = textOn(color) === '#ffffff' ? 'rgba(255, 255, 255, 0.14)' : 'rgba(15, 23, 42, 0.07)';
    for (const t of this.watermarks.getChildren()) (t as Konva.Text).fill(mark);
    this.bgLayer.batchDraw();
  }

  /** Colour of the panels right now (white until a faculty is chosen). */
  panelColor(): string {
    return facultyById(this.store.doc.exhibitor.facultyId)?.color ?? '#ffffff';
  }

  private syncSelection() {
    const sel = this.store.selection;
    const node = sel?.type === 'item' ? this.nodes.get(sel.id) : undefined;
    if (node) {
      this.tr.enabledAnchors(node instanceof Konva.Text ? TEXT_ANCHORS : IMAGE_ANCHORS);
      this.tr.nodes([node]);
    } else {
      this.tr.nodes([]);
    }
    this.uiLayer.batchDraw();
    this.syncOutlines();
  }

  private syncOutlines() {
    const sel = this.store.selection;
    const hover = this.store.hoverPanel;
    for (const p of this.layout.panels) {
      const o = this.outlines.get(p.id)!;
      const color = COLORS[p.kind];
      if (sel?.type === 'panel' && sel.id === p.id) o.setAttrs({ stroke: color, strokeWidth: 3 });
      else if (hover === p.id) o.setAttrs({ stroke: color, strokeWidth: 2 });
      else o.setAttrs({ stroke: OUTLINE, strokeWidth: 1 });
    }
    this.overlayLayer.batchDraw();
  }

  /** Re-measures text once web fonts finish loading. */
  refreshText() {
    for (const node of this.nodes.values()) if (node instanceof Konva.Text) node._setTextData();
    this.contentLayer.batchDraw();
    this.uiLayer.batchDraw();
  }

  // ---------- view ----------

  private resize() {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    if (!w || !h) return;
    this.stage.size({ width: w, height: h });
    if (!this.viewTouched) this.fit(false);
    else this.fitScale = this.scaleFor(this.layout.bounds);
    this.onViewChange();
  }

  private scaleFor(r: Rect, pad = 0.94) {
    return Math.min(this.stage.width() / r.w, this.stage.height() / r.h) * pad;
  }

  private maxScale() {
    return Math.max(this.fitScale * 14, 2.5);
  }

  fit(animate = true) {
    this.viewTouched = false;
    this.fitScale = this.scaleFor(this.layout.bounds);
    this.showRect(this.layout.bounds, this.fitScale, animate);
  }

  focusPanel(id: string) {
    const p = this.layout.panel(id);
    if (!p) return;
    const top = CANVAS.bandY - 40;
    const r = { x: p.x - 260, y: top, w: p.w + 520, h: p.y + p.h + 160 - top };
    this.viewTouched = true;
    this.showRect(r, Math.min(this.scaleFor(r), this.maxScale()), true);
  }

  private showRect(r: Rect, s: number, animate: boolean) {
    const x = (this.stage.width() - r.w * s) / 2 - r.x * s;
    const y = (this.stage.height() - r.h * s) / 2 - r.y * s;
    if (animate) {
      this.stage.to({
        x,
        y,
        scaleX: s,
        scaleY: s,
        duration: 0.25,
        easing: Konva.Easings.EaseInOut,
        onUpdate: () => this.onViewChange(),
        onFinish: () => this.onViewChange(),
      });
    } else {
      this.stage.setAttrs({ x, y, scaleX: s, scaleY: s });
      this.onViewChange();
    }
  }

  zoomAt(pt: Vec, factor: number) {
    this.viewTouched = true;
    const st = this.stage;
    const old = st.scaleX();
    const next = clamp(old * factor, this.fitScale * 0.35, this.maxScale());
    const wx = (pt.x - st.x()) / old;
    const wy = (pt.y - st.y()) / old;
    st.setAttrs({ scaleX: next, scaleY: next, x: pt.x - wx * next, y: pt.y - wy * next });
    this.onViewChange();
  }

  zoomBy(factor: number) {
    this.zoomAt({ x: this.stage.width() / 2, y: this.stage.height() / 2 }, factor);
  }

  zoomPercent() {
    return Math.round((this.stage.scaleX() / this.fitScale) * 100);
  }

  viewCenter(): Vec {
    const s = this.stage.scaleX();
    return { x: (this.stage.width() / 2 - this.stage.x()) / s, y: (this.stage.height() / 2 - this.stage.y()) / s };
  }

  worldFromClient(clientX: number, clientY: number): Vec {
    const r = this.container.getBoundingClientRect();
    const s = this.stage.scaleX();
    return { x: (clientX - r.left - this.stage.x()) / s, y: (clientY - r.top - this.stage.y()) / s };
  }

  /** Axis-aligned bounds of an element in mm (accounts for rotation). */
  itemBox(id: string): Rect | null {
    const node = this.nodes.get(id);
    if (!node) return null;
    const r = node.getClientRect({ relativeTo: this.contentLayer });
    return { x: r.x, y: r.y, w: r.width, h: r.height };
  }

  /**
   * Renders a world rectangle to a bitmap without selection, hover outlines or
   * watermarks. Everything outside panels is painted white.
   */
  renderRegion(r: Rect, pxPerMm: number, opts: { labels?: boolean } = {}): HTMLCanvasElement {
    const st = this.stage;
    const prev = { s: st.scaleX(), x: st.x(), y: st.y() };
    this.uiLayer.visible(false);
    this.watermarks.visible(false);
    this.labels.visible(!!opts.labels);
    // Overview keeps plain grey panel edges; single panels and 3D textures get none.
    this.outlines.forEach((o) => o.setAttrs({ visible: !!opts.labels, stroke: OUTLINE, strokeWidth: 1 }));
    this.maskFill = '#ffffff';
    st.setAttrs({ scaleX: pxPerMm, scaleY: pxPerMm, x: 0, y: 0 });
    try {
      return st.toCanvas({
        x: r.x * pxPerMm,
        y: r.y * pxPerMm,
        width: Math.max(1, Math.round(r.w * pxPerMm)),
        height: Math.max(1, Math.round(r.h * pxPerMm)),
        pixelRatio: 1,
      });
    } finally {
      st.setAttrs({ scaleX: prev.s, scaleY: prev.s, x: prev.x, y: prev.y });
      this.uiLayer.visible(true);
      this.watermarks.visible(true);
      this.labels.visible(true);
      this.outlines.forEach((o) => o.visible(true));
      this.syncOutlines();
      this.maskFill = MASK_SCREEN;
      st.batchDraw();
    }
  }
}

function closest(targets: number[], edges: number[], threshold: number) {
  let best: { delta: number; line: number } | null = null;
  let min = threshold;
  for (const t of targets) {
    for (const e of edges) {
      const d = t - e;
      if (Math.abs(d) < min) {
        min = Math.abs(d);
        best = { delta: d, line: t };
      }
    }
  }
  return best;
}
