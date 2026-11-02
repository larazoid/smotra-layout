import type { App } from './app';
import { BOOTH, type WallLayout } from './booth';
import { clamp, esc } from './util';

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
    const L = this.app.layout;
    const back = L.wall('back');
    const left = L.wall('left');
    const right = L.wall('right');
    const W = back.w;
    const D = Math.max(left.w, right.w);
    const H = BOOTH.wallHeight;
    const { fascia, counter } = BOOTH.organizer;
    const fh = fascia[0].height;

    const s = Math.min(0.24, (this.scene.clientWidth * 0.58) / W, (this.scene.clientHeight * 0.62) / (H + fh));
    const texPx = Math.min(0.7, s * 2.5);
    const tex = (w: WallLayout) => this.app.canvas.renderRegion(w, texPx).toDataURL('image/png');

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
    face(sW, sH, `translateZ(${-sD / 2}px)`, 'wall back', { img: tex(back) });
    face(left.w * s, sH, `translateX(${-sW / 2}px) rotateY(90deg)`, 'wall side', { img: tex(left) });
    face(right.w * s, sH, `translateX(${sW / 2}px) rotateY(-90deg)`, 'wall side', { img: tex(right) });

    // Front posts and the header boards (made by the organiser).
    const postH = (H + fh) * s;
    for (const x of [-sW / 2, sW / 2]) face(4, postH, `translate3d(${x}px, ${-(fh * s) / 2}px, ${sD / 2}px)`, 'post');
    const total = fascia.reduce((n, f) => n + f.width, 0);
    let fx = -total / 2;
    const name = esc(this.app.store.doc.exhibitor.name.trim());
    for (const f of fascia) {
      const cx = (fx + f.width / 2) * s;
      fx += f.width;
      const label = f.id === '11' && name ? `<b>${name}</b>` : `<span>${f.id}</span>`;
      face(f.width * s, f.height * s, `translate3d(${cx}px, ${-sH / 2 - (f.height * s) / 2}px, ${sD / 2}px)`, 'org fascia', { html: label });
    }

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
