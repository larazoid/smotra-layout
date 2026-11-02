import type { App } from './app';
import { BOOTH, type PanelLayout, primaryPanel } from './booth';

/** Top-down sketch of the stand. Click a wall segment to jump to that panel. */
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
    const L = this.app.layout;
    const back = L.wall('back');
    const left = L.wall('left');
    const right = L.wall('right');
    const W = back.w;
    const D = Math.max(left.w, right.w);
    const T = 90;
    const c = BOOTH.organizer.counter;
    const parts: string[] = [];

    const seg = (p: PanelLayout, x1: number, y1: number, x2: number, y2: number, lx: number, ly: number) => {
      parts.push(`
        <g class="seg-g ${p.kind}" data-panel="${p.id}">
          <line class="hit" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" />
          <line class="seg" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke-width="${T}" />
          <text class="lbl" x="${lx}" y="${ly}">${p.id}</text>
        </g>`);
    };

    // Back wall runs left → right along the top.
    for (const p of back.panels) {
      const a = p.x - back.x;
      seg(p, a, 0, a + p.w, 0, a + p.w / 2, -170);
    }
    // Left wall: its unfolded left edge is the front of the stand.
    for (const p of left.panels) {
      const u = p.x - left.x;
      seg(p, 0, D - u, 0, D - u - p.w, -190, D - u - p.w / 2);
    }
    // Right wall: its unfolded left edge is the back corner.
    for (const p of right.panels) {
      const u = p.x - right.x;
      seg(p, W, u, W, u + p.w, W + 190, u + p.w / 2);
    }

    const corner = (x: number, y: number) => `<rect class="corner" x="${x - T / 2}" y="${y - T / 2}" width="${T}" height="${T}" />`;
    const vx = -340;
    const vw = W + 680;
    const vy = -330;
    const vh = D + 820;

    return `
      <svg viewBox="${vx} ${vy} ${vw} ${vh}" role="img" aria-label="Tlocrt štanda">
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
