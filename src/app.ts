import { BOOTH, type PanelLayout, computeLayout, nearestPanel, panelAt, primaryPanel } from './booth';
import { BoothCanvas } from './canvas';
import { DAYS, EVENT, FACULTIES, drawFascia, facultyById, slotLabel, textOn } from './event';
import { type FileEntry, isPlaceableImage, loadImageEntry, rawEntry } from './files';
import { computeIssues } from './issues';
import { FloorPlan } from './plan';
import { Preview3D } from './preview3d';
import { SendDialog } from './send';
import { Sidebar } from './sidebar';
import { type Doc, type Exhibitor, type ImageItem, type TextItem, FONTS, Store, emptyDoc, normalizeDoc } from './state';
import { type SavedFile, clearProject, loadProject, saveProject } from './storage';
import { clamp, esc, round1, toast, uid } from './util';
import { buildZip, readZip, zipFilename } from './zip';

type Vec = { x: number; y: number };

export class App {
  readonly store = new Store();
  readonly layout = computeLayout();
  readonly canvas: BoothCanvas;
  private readonly sidebar: Sidebar;
  private readonly preview: Preview3D;
  private readonly sendDialog: SendDialog;
  private readonly welcome = document.getElementById('welcome')!;
  private saveTimer = 0;

  constructor() {
    // Canvas subscribes to the store first so the sidebar sees updated element bounds.
    this.canvas = new BoothCanvas(document.getElementById('stage') as HTMLDivElement, this.store, this.layout);
    this.sidebar = new Sidebar(this);
    new FloorPlan(document.getElementById('plan')!, this);
    this.preview = new Preview3D(this);
    this.sendDialog = new SendDialog(this);

    this.canvas.onViewChange = () => this.updateZoomLabel();
    this.canvas.onTextDblClick = (id) => {
      this.store.select({ type: 'item', id });
      this.sidebar.focusText();
    };
    this.store.on((kind) => {
      if (kind === 'doc' || kind === 'exhibitor') this.scheduleSave();
      if (kind === 'doc') this.updateUndoButtons();
      if (kind === 'exhibitor') this.renderFaculty();
    });

    document.querySelectorAll<HTMLSelectElement>('select.faculty-select').forEach(fillFacultySelect);
    this.bindToolbar();
    this.bindExhibitor();
    this.bindWelcome();
    this.bindDrop();
    this.bindKeys();
    this.loadFonts();
    this.updateUndoButtons();
    this.renderFaculty();
    void this.restore();
  }

  get faculty() {
    return facultyById(this.store.doc.exhibitor.facultyId);
  }

  get modalOpen() {
    return this.preview.isOpen || this.sendDialog.isOpen || !this.welcome.hidden;
  }

  // ---------- adding content ----------

  /** Panel new content goes to: selected panel, else the selected element's panel, else the one in view. */
  targetPanel(): PanelLayout {
    const sel = this.store.selection;
    if (sel?.type === 'panel') return this.layout.panel(sel.id)!;
    if (sel?.type === 'item') {
      const b = this.canvas.itemBox(sel.id);
      if (b) return primaryPanel(this.layout, b);
    }
    const c = this.canvas.viewCenter();
    return panelAt(this.layout, c.x, c.y) ?? this.layout.panel('2')!;
  }

  pickImages(panelId?: string) {
    this.pick('file-image', (files) => void this.addFiles(files, { panelId }));
  }

  pickMaterials() {
    this.pick('file-material', (files) => void this.addMaterials(files));
  }

  private pick(inputId: string, done: (files: File[]) => void) {
    const input = document.getElementById(inputId) as HTMLInputElement;
    input.onchange = () => {
      const files = [...(input.files ?? [])];
      input.value = '';
      if (files.length) done(files);
    };
    input.click();
  }

  /** Material the exhibitor wants on the stand without choosing where. */
  async addMaterials(files: File[], quiet = false) {
    const entries: FileEntry[] = [];
    for (const file of files) {
      // Images get a thumbnail; anything else (PDF, AI, video, HEIC…) is kept as-is.
      const entry = isPlaceableImage(file.name, file.type)
        ? await loadImageEntry(file, file.name).catch(() => rawEntry(file, file.name))
        : rawEntry(file, file.name);
      this.store.files.set(entry.id, entry);
      entries.push(entry);
    }
    if (!entries.length) return;
    this.store.update((d) => {
      d.materials.push(...entries.map((e) => e.id));
    });
    if (!quiet) toast(entries.length === 1 ? `„${entries[0].name}” je dodan u ostale materijale.` : `Dodano u ostale materijale: ${entries.length}.`, 'ok');
  }

  removeMaterial(id: string) {
    this.store.update((d) => {
      d.materials = d.materials.filter((m) => m !== id);
    });
  }

  /** Places images on the back wall. Files that can't be shown there go to "Ostali materijali". */
  async addFiles(list: File[], opts: { panelId?: string; at?: Vec } = {}) {
    const added: string[] = [];
    const other: File[] = [];
    for (const file of list) {
      if (!isPlaceableImage(file.name, file.type)) {
        other.push(file);
        continue;
      }
      let entry: FileEntry;
      try {
        entry = await loadImageEntry(file, file.name);
      } catch {
        other.push(file);
        continue;
      }
      this.store.files.set(entry.id, entry);

      let panel: PanelLayout;
      let centre: Vec | null = null;
      if (opts.panelId) panel = this.layout.panel(opts.panelId)!;
      else if (opts.at) {
        const hit = panelAt(this.layout, opts.at.x, opts.at.y);
        panel = hit ?? nearestPanel(this.layout, opts.at.x, opts.at.y);
        if (hit) centre = opts.at;
      } else panel = this.targetPanel();

      const aspect = entry.pxW / entry.pxH;
      let w = panel.w * 0.7;
      let h = w / aspect;
      if (h > panel.h * 0.35) {
        h = panel.h * 0.35;
        w = h * aspect;
      }
      const offset = added.length * 50;
      const cx = (centre?.x ?? panel.x + panel.w / 2) + offset;
      const cy = (centre?.y ?? panel.y + panel.h * 0.3) + offset;
      const item: ImageItem = {
        id: uid(),
        kind: 'image',
        fileId: entry.id,
        x: round1(cx - w / 2),
        y: round1(cy - h / 2),
        width: round1(w),
        height: round1(h),
        rotation: 0,
      };
      this.store.update((d) => {
        d.items.push(item);
      });
      added.push(item.id);
    }
    if (added.length) this.store.select({ type: 'item', id: added[added.length - 1] });
    if (other.length) {
      await this.addMaterials(other, true);
      const names = other.map((f) => `„${f.name}”`).join(', ');
      toast(`${names} ne može se prikazati na zidu, pa je dodano u ostale materijale.`);
    }
  }

  addText(panelId?: string) {
    const p = panelId ? this.layout.panel(panelId)! : this.targetPanel();
    const item: TextItem = {
      id: uid(),
      kind: 'text',
      text: 'Vaš tekst',
      fontFamily: FONTS[0],
      fontSize: round1(clamp(p.w * 0.1, 30, 110)),
      bold: true,
      italic: false,
      fill: textOn(this.canvas.panelColor()),
      align: 'center',
      width: round1(Math.max(p.w * 0.84, 30)),
      lineHeight: 1.15,
      rotation: 0,
      x: round1(p.x + p.w * 0.08),
      y: round1(p.y + p.h * 0.12),
    };
    this.store.update((d) => {
      d.items.push(item);
    });
    this.store.select({ type: 'item', id: item.id });
    this.sidebar.focusText(true);
  }

  // ---------- element actions ----------

  deleteItem(id: string) {
    this.store.update((d) => {
      d.items = d.items.filter((i) => i.id !== id);
    });
    this.store.select(null);
  }

  duplicate(id: string) {
    const it = this.store.item(id);
    if (!it) return;
    const copy = { ...structuredClone(it), id: uid(), x: it.x + 40, y: it.y + 40 };
    this.store.update((d) => {
      d.items.splice(d.items.findIndex((i) => i.id === id) + 1, 0, copy);
    });
    this.store.select({ type: 'item', id: copy.id });
  }

  reorder(id: string, dir: 1 | -1) {
    this.store.update((d) => {
      const i = d.items.findIndex((x) => x.id === id);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= d.items.length) return;
      [d.items[i], d.items[j]] = [d.items[j], d.items[i]];
    });
  }

  nudge(id: string, dx: number, dy: number) {
    this.store.update((d) => {
      const it = d.items.find((i) => i.id === id);
      if (!it) return;
      it.x = round1(it.x + dx);
      it.y = round1(it.y + dy);
    }, `nudge:${id}`);
  }

  centre(id: string, axis: 'x' | 'y') {
    const box = this.canvas.itemBox(id);
    if (!box) return;
    const p = primaryPanel(this.layout, box);
    this.store.update((d) => {
      const it = d.items.find((i) => i.id === id);
      if (!it) return;
      if (axis === 'x') it.x = round1(it.x + (p.x + p.w / 2 - (box.x + box.w / 2)));
      else it.y = round1(it.y + (p.y + p.h / 2 - (box.y + box.h / 2)));
    });
  }

  /** cover: fill the whole panel (may crop); contain: fit inside with a margin. */
  fitImage(id: string, mode: 'cover' | 'contain') {
    const box = this.canvas.itemBox(id);
    const it = this.store.item(id);
    if (!box || it?.kind !== 'image') return;
    const p = primaryPanel(this.layout, box);
    const aspect = it.width / it.height;
    const panelAspect = p.w / p.h;
    let w: number;
    let h: number;
    if (mode === 'cover') {
      if (panelAspect > aspect) [w, h] = [p.w, p.w / aspect];
      else [w, h] = [p.h * aspect, p.h];
    } else if (panelAspect > aspect) [w, h] = [p.h * 0.9 * aspect, p.h * 0.9];
    else [w, h] = [p.w * 0.9, (p.w * 0.9) / aspect];
    this.store.update((d) => {
      const t = d.items.find((i) => i.id === id);
      if (t?.kind !== 'image') return;
      Object.assign(t, { width: round1(w), height: round1(h), rotation: 0, x: round1(p.x + (p.w - w) / 2), y: round1(p.y + (p.h - h) / 2) });
    });
  }

  selectPanel(id: string) {
    this.store.select({ type: 'panel', id });
    this.canvas.focusPanel(id);
  }

  // ---------- project ----------

  /** Checks before sending. Returns false (and tells the user why) when something is missing. */
  readyToSend(): boolean {
    if (!this.faculty) {
      toast('Najprije odaberite svoju sastavnicu (lijevo gore).', 'error');
      document.getElementById('ex-faculty')?.focus();
      return false;
    }
    if (!this.store.doc.items.length && !this.store.doc.materials.length) {
      toast('Još nema ništa za poslati. Dodajte slike ili tekst na zid, ili učitajte ostale materijale.', 'error');
      return false;
    }
    const errors = computeIssues(this).filter((i) => i.level === 'error').length;
    if (errors && !confirm(`Broj ozbiljnih upozorenja: ${errors} (npr. preniska rezolucija ili element izvan panela).\n\nSvejedno nastaviti?`)) return false;
    return true;
  }

  makeZip() {
    this.store.select(null);
    return buildZip(this);
  }

  zipFilename() {
    return zipFilename(this);
  }

  async importZip(file: File) {
    if ((this.store.doc.items.length || this.store.doc.materials.length) && !confirm('Učitavanje će zamijeniti trenutni raspored. Nastaviti?')) return;
    try {
      const { doc, files } = await readZip(file);
      await this.loadProjectData(doc, files);
      toast('Raspored je učitan.', 'ok');
    } catch (e) {
      console.error(e);
      toast('Ovo nije ispravna ZIP datoteka rasporeda.', 'error');
    }
  }

  reset() {
    if (!confirm('Obrisati cijeli raspored i početi ispočetka?\n\nOvo se ne može poništiti. Ako želite sačuvati rad, prvo ga pošaljite ili preuzmite.')) return;
    this.store.replace(emptyDoc(), new Map());
    this.fillExhibitor();
    void clearProject().catch(() => {});
    this.canvas.fit();
    this.openWelcome();
  }

  private async loadProjectData(raw: Doc, saved: SavedFile[]) {
    const doc = normalizeDoc(raw);
    const imageIds = new Set(doc.items.flatMap((i) => (i.kind === 'image' ? [i.fileId] : [])));
    const files = new Map<string, FileEntry>();
    for (const f of saved) {
      const blob = f.type && !f.blob.type ? new Blob([f.blob], { type: f.type }) : f.blob;
      if (imageIds.has(f.id) || isPlaceableImage(f.name, f.type)) {
        const entry = await loadImageEntry(blob, f.name, f.id).catch(() => null);
        if (entry) files.set(f.id, entry);
        else if (!imageIds.has(f.id)) files.set(f.id, rawEntry(blob, f.name, f.id));
      } else {
        files.set(f.id, rawEntry(blob, f.name, f.id));
      }
    }
    doc.items = doc.items.filter((i) => i.kind !== 'image' || files.has(i.fileId));
    doc.materials = doc.materials.filter((id) => files.has(id));
    if (!facultyById(doc.exhibitor.facultyId)) doc.exhibitor.facultyId = '';
    this.store.replace(doc, files);
    this.fillExhibitor();
    this.canvas.fit(false);
  }

  private async restore() {
    try {
      const saved = await loadProject();
      const doc = saved && normalizeDoc(saved.doc);
      if (saved && doc && (doc.items.length || doc.materials.length || doc.exhibitor.facultyId)) {
        await this.loadProjectData(doc, saved.files);
        if (doc.items.length || doc.materials.length) toast('Nastavljate s rasporedom spremljenim u ovom pregledniku.');
      }
    } catch (e) {
      console.warn('Restore failed', e);
    }
    if (!this.faculty) this.openWelcome();
  }

  private scheduleSave() {
    clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => void this.save(), 700);
  }

  private async save() {
    const status = document.getElementById('save-status')!;
    const files: SavedFile[] = [];
    for (const id of this.store.usedFileIds()) {
      const f = this.store.files.get(id);
      if (f) files.push({ id: f.id, name: f.name, type: f.type, blob: f.blob });
    }
    try {
      await saveProject({ doc: structuredClone(this.store.doc), files, savedAt: Date.now() });
      status.textContent = 'Spremljeno u pregledniku';
      status.classList.remove('err');
    } catch {
      status.textContent = 'Automatsko spremanje nije dostupno';
      status.classList.add('err');
    }
  }

  // ---------- faculty ----------

  setFaculty(id: string) {
    if (!facultyById(id) || id === this.store.doc.exhibitor.facultyId) return;
    this.store.setExhibitor('facultyId', id);
    this.fillExhibitor();
  }

  private renderFaculty() {
    const f = this.faculty;
    const info = document.getElementById('faculty-info')!;
    info.innerHTML = f
      ? `<div class="slot"><span class="dot" style="--c:${f.color}"></span><span><b>Vaš termin:</b> ${esc(slotLabel(f))}</span></div>`
      : '<p class="hint">Odabirom sastavnice postavljaju se boja svih panela i natpis iznad štanda.</p>';
    const c = document.getElementById('fascia-preview') as HTMLCanvasElement;
    const total = BOOTH.organizer.fascia.reduce((n, x) => n + x.width, 0);
    drawFascia(c, f, BOOTH.organizer.fascia[0].width / total);
    document.getElementById('brand-faculty')!.textContent = f ? f.name : EVENT.dates;
  }

  private openWelcome() {
    const sel = document.getElementById('welcome-faculty') as HTMLSelectElement;
    sel.value = this.store.doc.exhibitor.facultyId;
    (document.getElementById('welcome-start') as HTMLButtonElement).disabled = !sel.value;
    this.welcome.hidden = false;
    sel.focus();
  }

  private bindWelcome() {
    const sel = document.getElementById('welcome-faculty') as HTMLSelectElement;
    const start = document.getElementById('welcome-start') as HTMLButtonElement;
    sel.addEventListener('change', () => (start.disabled = !sel.value));
    start.addEventListener('click', () => {
      if (!sel.value) return;
      this.setFaculty(sel.value);
      this.welcome.hidden = true;
    });
  }

  // ---------- wiring ----------

  private bindToolbar() {
    // Toolbar buttons shouldn't keep keyboard focus, or Space would repeat the last action.
    document.querySelector('.topbar')!.addEventListener('mousedown', (e) => {
      if ((e.target as HTMLElement).closest('button')) e.preventDefault();
    });
    const on = (id: string, fn: () => void) => document.getElementById(id)!.addEventListener('click', fn);
    on('btn-image', () => this.pickImages());
    on('btn-text', () => this.addText());
    on('btn-undo', () => this.store.undo());
    on('btn-redo', () => this.store.redo());
    on('btn-zoom-in', () => this.canvas.zoomBy(1.25));
    on('btn-zoom-out', () => this.canvas.zoomBy(0.8));
    on('btn-zoom-fit', () => this.canvas.fit());
    on('btn-3d', () => this.preview.open());
    on('btn-new', () => this.reset());
    on('btn-send', () => this.sendDialog.open());
    on('btn-load', () => this.pick('file-zip', ([f]) => void this.importZip(f)));
  }

  private updateZoomLabel() {
    document.getElementById('btn-zoom-fit')!.textContent = `${this.canvas.zoomPercent()}%`;
  }

  private updateUndoButtons() {
    (document.getElementById('btn-undo') as HTMLButtonElement).disabled = !this.store.canUndo;
    (document.getElementById('btn-redo') as HTMLButtonElement).disabled = !this.store.canRedo;
  }

  private bindExhibitor() {
    document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>('[data-ex]').forEach((el) => {
      const field = el.dataset.ex as keyof Exhibitor;
      el.addEventListener(el instanceof HTMLSelectElement ? 'change' : 'input', () => {
        if (field === 'facultyId') this.setFaculty(el.value);
        else this.store.setExhibitor(field, el.value);
      });
    });
  }

  private fillExhibitor() {
    document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>('[data-ex]').forEach((el) => {
      el.value = this.store.doc.exhibitor[el.dataset.ex as keyof Exhibitor] ?? '';
    });
  }

  private bindDrop() {
    const wrap = document.querySelector('.stage-wrap') as HTMLElement;
    const hasFiles = (e: DragEvent) => !!e.dataTransfer && [...e.dataTransfer.types].includes('Files');
    let depth = 0;
    // Stop the browser from opening files dropped anywhere else on the page.
    window.addEventListener('dragover', (e) => e.preventDefault());
    window.addEventListener('drop', (e) => e.preventDefault());
    wrap.addEventListener('dragenter', (e) => {
      if (!hasFiles(e)) return;
      depth++;
      wrap.classList.add('dropping');
    });
    wrap.addEventListener('dragleave', () => {
      depth = Math.max(0, depth - 1);
      if (!depth) wrap.classList.remove('dropping');
    });
    wrap.addEventListener('dragover', (e) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      e.dataTransfer!.dropEffect = 'copy';
      const p = this.canvas.worldFromClient(e.clientX, e.clientY);
      this.store.setHover(panelAt(this.layout, p.x, p.y)?.id ?? null);
    });
    wrap.addEventListener('drop', (e) => {
      e.preventDefault();
      depth = 0;
      wrap.classList.remove('dropping');
      const files = [...(e.dataTransfer?.files ?? [])];
      if (files.length) void this.addFiles(files, { at: this.canvas.worldFromClient(e.clientX, e.clientY) });
    });

    window.addEventListener('paste', (e) => {
      if ((e.target as HTMLElement).closest?.('input, textarea, select')) return;
      if (this.modalOpen) return;
      const files = [...(e.clipboardData?.files ?? [])];
      if (!files.length) return;
      e.preventDefault();
      void this.addFiles(files);
    });
  }

  private bindKeys() {
    window.addEventListener('keydown', (e) => {
      if ((e.target as HTMLElement).closest?.('input, textarea, select, [contenteditable]')) return;
      if (this.modalOpen) return;
      const mod = e.metaKey || e.ctrlKey;
      const key = e.key.toLowerCase();
      if (mod && key === 'z') {
        e.preventDefault();
        if (e.shiftKey) this.store.redo();
        else this.store.undo();
        return;
      }
      if (mod && key === 'y') {
        e.preventDefault();
        this.store.redo();
        return;
      }
      if (e.key === 'Escape') {
        this.store.select(null);
        return;
      }
      const it = this.store.selectedItem;
      if (!it) return;
      if (mod && key === 'd') {
        e.preventDefault();
        this.duplicate(it.id);
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        this.deleteItem(it.id);
      } else if (e.key.startsWith('Arrow')) {
        e.preventDefault();
        const step = e.shiftKey ? 10 : 1;
        const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
        const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
        this.nudge(it.id, dx, dy);
      }
    });
  }

  private loadFonts() {
    const sample = 'AaČčĆćĐđŠšŽž';
    const loads = FONTS.flatMap((f) => [`400 40px "${f}"`, `700 40px "${f}"`].map((spec) => document.fonts.load(spec, sample).catch(() => [])));
    const refresh = () => {
      this.canvas.refreshText();
      this.renderFaculty();
    };
    void Promise.all(loads).then(refresh);
    document.fonts.addEventListener('loadingdone', refresh);
  }
}

/** Fills a <select> with the faculties, grouped by day. */
function fillFacultySelect(sel: HTMLSelectElement) {
  const groups = DAYS.map((d) => {
    const opts = FACULTIES.filter((f) => f.day === d.id)
      .map((f) => `<option value="${f.id}">${esc(f.name)} · ${f.hour} h</option>`)
      .join('');
    return `<optgroup label="${esc(d.label)}">${opts}</optgroup>`;
  });
  sel.innerHTML = `<option value="" disabled selected hidden>Odaberite sastavnicu…</option>${groups.join('')}`;
}
