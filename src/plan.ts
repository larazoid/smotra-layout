import type { App } from './app';
import { BOOTH, type WallSpec, primaryPanel, wallLength, wallSpec } from './booth';

/**
 * Top-down sketch of the stand. The back wall is clickable; side walls are shown
 * for orientation only (they just take the faculty colour).
 */
export class FloorPlan {
  constructor(
    private readonly el: HTMLElement,
    private readonly app: App,
  ) {
    el.innerHTML = this.svg();
    el.addEventListener('click', (e) => {
      const g = (e.target as Element).closest<SVGElement>('[data-panel]');
      if (g) app.selectPanel(g.dataset.panel!);
    });
    el.addEventListener('mouseover', (e) => {
      const g = (e.target as Element).closest<SVGElement>('[data-panel]');
      app.store.setHover(g?.dataset.panel ?? null);
    });
    el.addEventListener('mouseleave', () => app.store.setHover(null));
    app.store.on((kind) => {
      if (kind !== 'exhibitor') this.highlight();
    });
  }

  private svg(): string {
    const back = wallSpec('back');
    const left = wallSpec('left');
    const right = wallSpec('right');
    const W = wallLength(back);
    const D = Math.max(wallLength(left), wallLength(right));
    const T = 90;
    const c = BOOTH.organizer.counter;
    const parts: string[] = [];

    /** Offsets of each panel along a wall, from its unfolded left edge. */
    const offsets = (spec: WallSpec) => {
      let u = 0;
      return spec.panels.map((p) => {
        const start = u;
        u += p.width + BOOTH.postWidth;
        return { p, start };
      });
    };

    const seg = (id: string, editable: boolean, x1: number, y1: number, x2: number, y2: number, lx: number, ly: number) => {
      const attrs = editable ? ` class="seg-g back" data-panel="${id}"` : ' class="seg-g locked"';
      parts.push(`
        <g${attrs}>
          ${editable ? `<line class="hit" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" />` : ''}
          <line class="seg" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke-width="${T}" />
          <text class="lbl" x="${lx}" y="${ly}">${id}</text>
        </g>`);
    };

    // Back wall runs left → right along the top.
    for (const { p, start } of offsets(back)) seg(p.id, true, start, 0, start + p.width, 0, start + p.width / 2, -170);
    // Left wall: its unfolded left edge is the front of the stand.
    for (const { p, start } of offsets(left)) seg(p.id, false, 0, D - start, 0, D - start - p.width, -190, D - start - p.width / 2);
    // Right wall: its unfolded left edge is the back corner.
    for (const { p, start } of offsets(right)) seg(p.id, false, W, start, W, start + p.width, W + 190, start + p.width / 2);

    const corner = (x: number, y: number) => `<rect class="corner" x="${x - T / 2}" y="${y - T / 2}" width="${T}" height="${T}" />`;

    return `
      <svg viewBox="-340 -330 ${W + 680} ${D + 820}" role="img" aria-label="Tlocrt štanda">
        <rect class="floor" x="0" y="0" width="${W}" height="${D}" />
        <rect class="org" x="${T / 2}" y="${D - c.depth}" width="${c.width}" height="${c.depth}" rx="24" />
        <text class="org-lbl" x="${T / 2 + c.width / 2}" y="${D - c.depth / 2}">pult 9 · 10</text>
        <line class="fascia" x1="0" y1="${D + 70}" x2="${W}" y2="${D + 70}" />
        <text class="org-lbl" x="${W - 520}" y="${D + 210}">natpis 11 · 12</text>
        ${parts.join('')}
        ${corner(0, 0)}${corner(W, 0)}
        <g class="visitor">
          <path d="M ${W / 2} ${D + 420} v -150 m -70 70 l 70 -70 l 70 70" />
          <text x="${W / 2}" y="${D + 430}">posjetitelji</text>
        </g>
      </svg>`;
  }

  private highlight() {
    const { store, canvas, layout } = this.app;
    const sel = store.selection;
    let selected: string | null = sel?.type === 'panel' ? sel.id : null;
    if (sel?.type === 'item') {
      const b = canvas.itemBox(sel.id);
      if (b) selected = primaryPanel(layout, b).id;
    }
    this.el.querySelectorAll<SVGElement>('[data-panel]').forEach((g) => {
      g.classList.toggle('hover', g.dataset.panel === store.hoverPanel);
      g.classList.toggle('sel', g.dataset.panel === selected);
    });
  }
}
