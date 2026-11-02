import type { App } from './app';
import { BOOTH, type WallSpec, wallLength, wallSpec } from './booth';
import { drawFascia } from './event';
import { clamp } from './util';

/** Simple CSS 3D model of the stand with the walls' current artwork as textures. */
export class Preview3D {
  private readonly modal = document.getElementById('p3d')!;
  private readonly scene = this.modal.querySelector<HTMLElement>('.p3d-scene')!;
  private readonly booth = this.modal.querySelector<HTMLElement>('.p3d-booth')!;
  private ry = -24;
  private rx = -12;

  constructor(private readonly app: App) {
    this.modal.addEventListener('click', (e) => {
      const t = e.target as HTMLElement;
      if (t === this.modal || t.closest('[data-close]')) this.close();
      const v = t.closest<HTMLElement>('[data-view]')?.dataset.view;
      if (v) {
        this.ry = v === 'left' ? -42 : v === 'right' ? 42 : 0;
        this.rx = -12;
        this.apply();
      }
    });
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.isOpen) this.close();
    });

    let last: { x: number; y: number } | null = null;
    this.scene.addEventListener('pointerdown', (e) => {
      last = { x: e.clientX, y: e.clientY };
      this.scene.setPointerCapture(e.pointerId);
      this.scene.classList.add('dragging');
    });
    this.scene.addEventListener('pointermove', (e) => {
      if (!last) return;
      this.ry = clamp(this.ry + (e.clientX - last.x) * 0.35, -65, 65);
      this.rx = clamp(this.rx - (e.clientY - last.y) * 0.2, -40, -2);
      last = { x: e.clientX, y: e.clientY };
      this.apply();
    });
    const end = () => {
      last = null;
      this.scene.classList.remove('dragging');
    };
    this.scene.addEventListener('pointerup', end);
    this.scene.addEventListener('pointercancel', end);
  }

  get isOpen() {
    return !this.modal.hidden;
  }

  open() {
    this.app.store.select(null);
    this.modal.hidden = false;
    this.build();
    this.apply();
  }

  close() {
    this.modal.hidden = true;
    this.booth.replaceChildren();
  }

  private apply() {
    this.booth.style.transform = `rotateX(${this.rx}deg) rotateY(${this.ry}deg)`;
  }

  private build() {
    this.booth.replaceChildren();
    const back = this.app.layout.walls.find((w) => w.id === 'back')!;
    const left = wallSpec('left');
    const right = wallSpec('right');
    const W = back.w;
    const leftLen = wallLength(left);
    const rightLen = wallLength(right);
    const D = Math.max(leftLen, rightLen);
    const H = BOOTH.wallHeight;
    const { fascia, counter } = BOOTH.organizer;
    const fh = fascia[0].height;
    const faculty = this.app.faculty;
    const color = faculty?.color ?? '#ffffff';

    const s = Math.min(0.24, (this.scene.clientWidth * 0.58) / W, (this.scene.clientHeight * 0.62) / (H + fh));
    const texPx = Math.min(0.7, s * 2.5);

    const face = (w: number, h: number, transform: string, cls: string, opts: { img?: string; html?: string } = {}) => {
      const el = document.createElement('div');
      el.className = `p3d-face ${cls}`;
      Object.assign(el.style, { width: `${w}px`, height: `${h}px`, left: `${-w / 2}px`, top: `${-h / 2}px`, transform });
      if (opts.img) el.style.backgroundImage = `url(${opts.img})`;
      if (opts.html) el.innerHTML = opts.html;
      this.booth.append(el);
    };

    const sW = W * s;
    const sD = D * s;
    const sH = H * s;

    face(sW, sD, `translateY(${sH / 2}px) rotateX(90deg)`, 'floor');
    face(sW, sH, `translateZ(${-sD / 2}px)`, 'wall back', { img: this.app.canvas.renderRegion(back, texPx).toDataURL('image/png') });
    face(leftLen * s, sH, `translateX(${-sW / 2}px) rotateY(90deg)`, 'wall side', { img: solidWall(left, color, texPx) });
    face(rightLen * s, sH, `translateX(${sW / 2}px) rotateY(-90deg)`, 'wall side', { img: solidWall(right, color, texPx) });

    // Front posts and the header boards 11 + 12 with the faculty name.
    const postH = (H + fh) * s;
    for (const x of [-sW / 2, sW / 2]) face(4, postH, `translate3d(${x}px, ${-(fh * s) / 2}px, ${sD / 2}px)`, 'post');
    const total = fascia.reduce((n, f) => n + f.width, 0);
    const header = document.createElement('canvas');
    header.width = Math.round(total * texPx);
    header.height = Math.round(fh * texPx);
    drawFascia(header, faculty, fascia[0].width / total);
    face(total * s, fh * s, `translate3d(0px, ${-sH / 2 - (fh * s) / 2}px, ${sD / 2}px)`, 'fascia', { img: header.toDataURL('image/png') });

    // Counter at the front-left corner.
    const cw = counter.width * s;
    const ch = counter.height * s;
    const cd = counter.depth * s;
    const ccx = -sW / 2 + cw / 2;
    const ccy = sH / 2 - ch / 2;
    face(cw, ch, `translate3d(${ccx}px, ${ccy}px, ${sD / 2}px)`, 'org counter', { html: `<span>LOGO SMOTRE<br><small>${counter.front}</small></span>` });
    face(cd, ch, `translate3d(${ccx + cw / 2}px, ${ccy}px, ${sD / 2 - cd / 2}px) rotateY(90deg)`, 'org counter side', { html: `<small>${counter.side}</small>` });
    face(cw, cd, `translate3d(${ccx}px, ${sH / 2 - ch}px, ${sD / 2 - cd / 2}px) rotateX(90deg)`, 'org counter top');
  }
}

/** A side wall: every panel in the faculty colour, with the aluminium profiles between them. */
function solidWall(spec: WallSpec, color: string, px: number): string {
  const c = document.createElement('canvas');
  c.width = Math.round(wallLength(spec) * px);
  c.height = Math.round(BOOTH.wallHeight * px);
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.fillStyle = '#9aa4b1';
  let x = 0;
  spec.panels.forEach((p, i) => {
    if (i > 0) {
      ctx.fillRect(Math.round(x * px), 0, Math.max(1, Math.round(BOOTH.postWidth * px)), c.height);
      x += BOOTH.postWidth;
    }
    x += p.width;
  });
  return c.toDataURL('image/png');
}
