import type { App } from './app';
import { type PanelLayout, primaryPanel, wallName } from './booth';
import { dpiLevel, effectiveDpi, computeIssues, itemLabel } from './issues';
import { FONTS, type ImageItem, type Item, type TextItem } from './state';
import { esc, formatBytes, normHex, round1 } from './util';
import { facultyById } from './event';

const SWATCHES = ['#ffffff', '#f1f5f9', '#0f172a', '#1e3a8a', '#2563eb', '#0e7490', '#15803d', '#b91c1c', '#c2410c', '#ca8a04', '#7c3aed', '#be185d'];

const DPI_TEXT = {
  vector: 'Vektorska datoteka — oštra u svakoj veličini',
  good: 'Odlična kvaliteta za tisak',
  warn: 'Granična kvaliteta — moguće blago zamućenje',
  error: 'Preniska rezolucija — otisak će biti mutan',
};

/** Right-hand column: properties of the selection, other materials and checks. */
export class Sidebar {
  private readonly props = document.getElementById('props')!;
  private readonly issuesEl = document.getElementById('issues')!;
  private readonly materialsEl = document.getElementById('materials')!;
  /** Panel the X/Y fields are measured from, fixed while the fields are being edited. */
  private propsPanel: PanelLayout | null = null;

  constructor(private readonly app: App) {
    app.store.on((kind) => {
      if (kind === 'selection') this.renderProps();
      if (kind === 'exhibitor' && app.store.selection?.type === 'panel') this.renderProps();
      if (kind === 'doc') {
        this.refreshProps();
        this.renderIssues();
        this.renderMaterials();
      }
    });
    this.bindProps();
    this.issuesEl.addEventListener('click', (e) => {
      const li = (e.target as HTMLElement).closest<HTMLElement>('[data-item]');
      if (li) this.app.store.select({ type: 'item', id: li.dataset.item! });
    });
    this.materialsEl.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>('[data-remove]');
      if (b) this.app.removeMaterial(b.dataset.remove!);
    });
    this.bindMaterialsDrop();
    this.renderProps();
    this.renderIssues();
    this.renderMaterials();
  }

  focusText(selectAll = false) {
    requestAnimationFrame(() => {
      const ta = this.props.querySelector('textarea');
      ta?.focus();
      if (selectAll) ta?.select();
    });
  }

  // ---------- properties ----------

  private refreshProps() {
    const a = document.activeElement;
    if (a && this.props.contains(a) && a.matches('input, textarea, select')) this.updateLive();
    else this.renderProps();
  }

  private renderProps() {
    const sel = this.app.store.selection;
    this.propsPanel = null;
    if (sel?.type === 'panel') {
      const p = this.app.layout.panel(sel.id);
      if (p) return void (this.props.innerHTML = this.panelHtml(p));
    }
    const it = this.app.store.selectedItem;
    if (it) {
      const box = this.app.canvas.itemBox(it.id);
      this.propsPanel = box ? primaryPanel(this.app.layout, box) : null;
      this.props.innerHTML = it.kind === 'image' ? this.imageHtml(it) : this.textHtml(it);
      return;
    }
    this.props.innerHTML = `
      <div class="empty">
        <div class="empty-icon" aria-hidden="true">↖</div>
        <h2>Ništa nije odabrano</h2>
        <p>Kliknite panel ili element na platnu, ili odaberite zid na tlocrtu.</p>
      </div>`;
  }

  /** Updates read-only bits while the user is typing in a field. */
  private updateLive() {
    const it = this.app.store.selectedItem;
    const dpiEl = this.props.querySelector('[data-live="dpi"]');
    if (dpiEl && it?.kind === 'image') dpiEl.outerHTML = this.dpiHtml(it);
    const syncHex = (sel: string, val: string) => {
      const el = this.props.querySelector<HTMLInputElement>(sel);
      if (el && document.activeElement !== el) el.value = val;
    };
    if (it?.kind === 'text') {
      syncHex('[data-f="fill"]', it.fill);
      syncHex('[data-f="fillHex"]', it.fill);
    }
  }

  private head(kind: string, title: string, sub = '') {
    return `<div class="props-head"><span class="kind">${kind}</span><h2>${title}</h2>${sub ? `<p>${sub}</p>` : ''}</div>`;
  }

  private panelHtml(p: PanelLayout) {
    const faculty = facultyById(this.app.store.doc.exhibitor.facultyId);
    const items = this.app.store.doc.items.filter((it) => {
      const b = this.app.canvas.itemBox(it.id);
      return b && primaryPanel(this.app.layout, b).id === p.id;
    });
    const narrow = p.w < 100 ? `<p class="note">Ovaj panel je vrlo uzak (${p.w} mm). Najbolje mu odgovara boja ili okomiti tekst.</p>` : '';
    return `
      <div class="props-head">
        <span class="wall-chip ${p.kind}">${wallName(p.kind, p.wall)}</span>
        <h2>Panel ${p.id}</h2>
        <p>${p.w} × ${p.h} mm (širina × visina)</p>
      </div>
      ${narrow}
      <div class="btn-col">
        <button class="btn primary-soft" data-a="add-image">+ Slika ili logo na ovaj panel</button>
        <button class="btn primary-soft" data-a="add-text">+ Tekst na ovaj panel</button>
      </div>
      <div class="field">
        <span>Boja panela</span>
        ${
          faculty
            ? `<div class="locked-color"><i style="--c:${faculty.color}"></i><span>Boja sastavnice (${faculty.color}). Svi paneli štanda su u ovoj boji i ne mijenja se.</span></div>`
            : '<p class="muted">Odaberite sastavnicu (lijevo gore) — paneli će dobiti njezinu boju.</p>'
        }
      </div>
      <div class="field">
        <span>Elementi na ovom panelu</span>
        ${
          items.length
            ? `<ul class="item-list">${items.map((it) => `<li><button data-select="${it.id}">${esc(itemLabel(this.app.store, it))}</button></li>`).join('')}</ul>`
            : '<p class="muted">Još nema elemenata.</p>'
        }
      </div>`;
  }

  private colorHtml(field: 'fill', value: string) {
    return `
      <div class="swatches">
        ${SWATCHES.map((c) => `<button class="swatch${c === value ? ' on' : ''}" style="--c:${c}" data-swatch="${c}" data-target="${field}" title="${c}"></button>`).join('')}
      </div>
      <div class="color-row">
        <input type="color" data-f="${field}" value="${value}" aria-label="Odabir boje" />
        <input type="text" data-f="${field}Hex" value="${value}" maxlength="7" spellcheck="false" aria-label="Boja (HEX)" />
      </div>`;
  }

  private posHtml(it: Item) {
    const p = this.propsPanel;
    if (!p) return '';
    return `
      <div class="row2">
        <label class="field"><span>X od lijevog ruba</span><span class="unit"><input type="number" step="1" data-f="x" value="${round1(it.x - p.x)}" /><i>mm</i></span></label>
        <label class="field"><span>Y od vrha</span><span class="unit"><input type="number" step="1" data-f="y" value="${round1(it.y - p.y)}" /><i>mm</i></span></label>
      </div>
      <p class="muted small">Mjereno od panela ${p.id} (${wallName(p.kind, p.wall).toLowerCase()}).</p>
      <label class="field"><span>Rotacija</span><span class="unit"><input type="number" step="1" data-f="rotation" value="${round1(it.rotation)}" /><i>°</i></span></label>`;
  }

  private commonButtons() {
    return `
      <div class="btn-grid">
        <button class="btn" data-a="centre-x">Centriraj vodoravno</button>
        <button class="btn" data-a="centre-y">Centriraj okomito</button>
        <button class="btn" data-a="front">Pomakni naprijed</button>
        <button class="btn" data-a="back">Pomakni natrag</button>
        <button class="btn" data-a="dup">Dupliciraj</button>
        <button class="btn danger" data-a="delete">Obriši</button>
      </div>`;
  }

  private dpiHtml(it: ImageItem) {
    const f = this.app.store.files.get(it.fileId);
    if (!f) return '<div data-live="dpi"></div>';
    const dpi = effectiveDpi(f, it);
    const lvl = dpiLevel(dpi);
    const value = dpi === null ? 'vektor' : `${dpi} dpi`;
    return `<div class="dpi ${lvl}" data-live="dpi"><b>${value}</b><span>${DPI_TEXT[lvl]}</span></div>`;
  }

  private imageHtml(it: ImageItem) {
    const f = this.app.store.files.get(it.fileId);
    const meta = f ? (f.vector ? `SVG · ${formatBytes(f.blob.size)}` : `${f.pxW} × ${f.pxH} px · ${formatBytes(f.blob.size)}`) : '';
    return `
      ${this.head('Slika', esc(f?.name ?? 'Slika'), meta)}
      ${f?.url ? `<div class="thumb"><img src="${f.url}" alt="" /></div>` : ''}
      ${this.dpiHtml(it)}
      <div class="row2">
        <label class="field"><span>Širina</span><span class="unit"><input type="number" min="1" step="1" data-f="width" value="${round1(it.width)}" /><i>mm</i></span></label>
        <label class="field"><span>Visina</span><span class="unit"><input type="number" min="1" step="1" data-f="height" value="${round1(it.height)}" /><i>mm</i></span></label>
      </div>
      ${this.posHtml(it)}
      <div class="btn-grid">
        <button class="btn" data-a="cover" title="Slika prekriva cijeli panel; višak se odreže">Popuni panel</button>
        <button class="btn" data-a="contain" title="Cijela slika stane u panel">Smjesti u panel</button>
      </div>
      ${this.commonButtons()}`;
  }

  private textHtml(it: TextItem) {
    const opt = (v: string, label: string, cur: string) => `<option value="${v}"${v === cur ? ' selected' : ''}>${label}</option>`;
    const toggle = (a: string, on: boolean, label: string, title: string) =>
      `<button class="toggle${on ? ' on' : ''}" data-a="${a}" title="${title}" aria-pressed="${on}">${label}</button>`;
    return `
      ${this.head('Tekst', 'Tekst')}
      <label class="field"><span>Sadržaj</span><textarea data-f="text" rows="3">${esc(it.text)}</textarea></label>
      <label class="field"><span>Font</span><select data-f="fontFamily">${FONTS.map((f) => opt(f, f, it.fontFamily)).join('')}</select></label>
      <div class="row2">
        <label class="field"><span>Veličina slova</span><span class="unit"><input type="number" min="1" step="1" data-f="fontSize" value="${round1(it.fontSize)}" /><i>mm</i></span></label>
        <label class="field"><span>Širina okvira</span><span class="unit"><input type="number" min="5" step="1" data-f="width" value="${round1(it.width)}" /><i>mm</i></span></label>
      </div>
      <div class="field">
        <span>Stil i poravnanje</span>
        <div class="toggles">
          ${toggle('bold', it.bold, '<b>B</b>', 'Podebljano')}
          ${toggle('italic', it.italic, '<i>I</i>', 'Kurziv')}
          <span class="sep"></span>
          ${toggle('align-left', it.align === 'left', 'Lijevo', 'Poravnaj lijevo')}
          ${toggle('align-center', it.align === 'center', 'Sredina', 'Centriraj')}
          ${toggle('align-right', it.align === 'right', 'Desno', 'Poravnaj desno')}
        </div>
      </div>
      <div class="field"><span>Boja teksta</span>${this.colorHtml('fill', it.fill)}</div>
      ${this.posHtml(it)}
      ${this.commonButtons()}`;
  }

  private bindProps() {
    const onField = (e: Event) => {
      const el = e.target as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
      if (el.dataset.f) this.onField(el.dataset.f, el.value);
    };
    this.props.addEventListener('input', onField);
    this.props.addEventListener('change', onField);
    this.props.addEventListener('click', (e) => {
      const t = e.target as HTMLElement;
      const sw = t.closest<HTMLElement>('[data-swatch]');
      if (sw) return this.onField(sw.dataset.target!, sw.dataset.swatch!);
      const sel = t.closest<HTMLElement>('[data-select]');
      if (sel) return this.app.store.select({ type: 'item', id: sel.dataset.select! });
      const a = t.closest<HTMLElement>('[data-a]')?.dataset.a;
      if (a) this.onAction(a);
    });
  }

  private onField(f: string, raw: string) {
    const store = this.app.store;
    const sel = store.selection;
    if (!sel) return;

    if (sel.type === 'panel') return;

    const num = parseFloat(raw.replace(',', '.'));
    const finite = Number.isFinite(num);
    const p = this.propsPanel;
    store.update((d) => {
      const it = d.items.find((i) => i.id === sel.id);
      if (!it) return;
      if (f === 'x' && finite && p) it.x = round1(p.x + num);
      else if (f === 'y' && finite && p) it.y = round1(p.y + num);
      else if (f === 'rotation' && finite) it.rotation = num;
      else if (it.kind === 'image') {
        if (!(finite && num > 0)) return;
        const ratio = it.width / it.height;
        if (f === 'width') Object.assign(it, { width: num, height: round1(num / ratio) });
        if (f === 'height') Object.assign(it, { height: num, width: round1(num * ratio) });
      } else {
        if (f === 'text') it.text = raw;
        else if (f === 'fontFamily') it.fontFamily = raw;
        else if (f === 'fontSize' && finite && num > 0) it.fontSize = num;
        else if (f === 'width' && finite && num > 0) it.width = num;
        else if (f === 'fill' || f === 'fillHex') {
          const c = normHex(raw);
          if (c) it.fill = c;
        }
      }
    }, `${f}:${sel.id}`);
  }

  private onAction(a: string) {
    const app = this.app;
    const sel = app.store.selection;
    if (!sel) return;
    if (sel.type === 'panel') {
      if (a === 'add-image') app.pickImages(sel.id);
      if (a === 'add-text') app.addText(sel.id);
      return;
    }
    const id = sel.id;
    const setText = (fn: (t: TextItem) => void) =>
      app.store.update((d) => {
        const t = d.items.find((i) => i.id === id);
        if (t?.kind === 'text') fn(t);
      });
    switch (a) {
      case 'cover':
      case 'contain':
        return app.fitImage(id, a);
      case 'centre-x':
        return app.centre(id, 'x');
      case 'centre-y':
        return app.centre(id, 'y');
      case 'front':
        return app.reorder(id, 1);
      case 'back':
        return app.reorder(id, -1);
      case 'dup':
        return app.duplicate(id);
      case 'delete':
        return app.deleteItem(id);
      case 'bold':
        return setText((t) => (t.bold = !t.bold));
      case 'italic':
        return setText((t) => (t.italic = !t.italic));
      case 'align-left':
      case 'align-center':
      case 'align-right':
        return setText((t) => (t.align = a.slice(6) as TextItem['align']));
    }
  }

  // ---------- checks & materials ----------

  private renderIssues() {
    const issues = computeIssues(this.app);
    if (!this.app.store.doc.items.length) {
      this.issuesEl.innerHTML = '<p class="muted">Dodajte slike i tekst — ovdje ćete vidjeti upozorenja o kvaliteti i položaju.</p>';
      return;
    }
    if (!issues.length) {
      this.issuesEl.innerHTML = '<p class="all-ok">✓ Sve izgleda spremno za tisak.</p>';
      return;
    }
    this.issuesEl.innerHTML = `<ul class="issues">${issues
      .map((i) => `<li class="${i.level}"${i.itemId ? ` data-item="${i.itemId}"` : ''}>${esc(i.text)}</li>`)
      .join('')}</ul>`;
  }

  private renderMaterials() {
    const ids = this.app.store.doc.materials;
    const count = document.getElementById('materials-count');
    if (count) count.textContent = ids.length ? String(ids.length) : '';
    if (!ids.length) {
      this.materialsEl.innerHTML = '';
      return;
    }
    this.materialsEl.innerHTML = `<ul class="materials">${ids
      .map((id) => {
        const f = this.app.store.files.get(id);
        if (!f) return '';
        const ext = (f.name.split('.').pop() ?? '').slice(0, 4).toUpperCase();
        const preview = f.url ? `<img src="${f.url}" alt="" />` : `<span class="ext">${esc(ext || 'FILE')}</span>`;
        return `<li title="${esc(f.name)}">
          <div class="mat-thumb">${preview}</div>
          <div class="mat-meta"><span>${esc(f.name)}</span><small>${formatBytes(f.blob.size)}</small></div>
          <button class="icon-btn small" data-remove="${id}" title="Ukloni" aria-label="Ukloni ${esc(f.name)}">✕</button>
        </li>`;
      })
      .join('')}</ul>`;
  }

  private bindMaterialsDrop() {
    const zone = document.getElementById('materials-drop')!;
    zone.addEventListener('click', () => this.app.pickMaterials());
    const hasFiles = (e: DragEvent) => !!e.dataTransfer && [...e.dataTransfer.types].includes('Files');
    zone.addEventListener('dragover', (e) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      e.dataTransfer!.dropEffect = 'copy';
      zone.classList.add('over');
    });
    zone.addEventListener('dragleave', () => zone.classList.remove('over'));
    zone.addEventListener('drop', (e) => {
      e.preventDefault();
      zone.classList.remove('over');
      const files = [...(e.dataTransfer?.files ?? [])];
      if (files.length) void this.app.addMaterials(files);
    });
  }

}
