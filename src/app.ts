import { type PanelLayout, computeLayout, nearestPanel, panelAt, primaryPanel } from './booth';
import { BoothCanvas } from './canvas';
import { type FileEntry, isHeic, isPlaceableImage, loadImageEntry, rawEntry } from './files';
import { computeIssues } from './issues';
import { FloorPlan } from './plan';
import { Preview3D } from './preview3d';
import { Sidebar } from './sidebar';
import { type Doc, type Exhibitor, type ImageItem, type TextItem, FONTS, Store, emptyDoc } from './state';
import { type SavedFile, clearProject, loadProject, saveProject } from './storage';
import { clamp, downloadBlob, round1, toast, uid } from './util';
import { buildZip, readZip } from './zip';

type Vec = { x: number; y: number };

export class App {
  readonly store = new Store();
  readonly layout = computeLayout();
  readonly canvas: BoothCanvas;
  private readonly sidebar: Sidebar;
  private readonly preview: Preview3D;
  private saveTimer = 0;

  constructor() {
    // Canvas subscribes to the store first so the sidebar sees updated element bounds.
    this.canvas = new BoothCanvas(document.getElementById('stage') as HTMLDivElement, this.store, this.layout);
    this.sidebar = new Sidebar(this);
    new FloorPlan(document.getElementById('plan')!, this);
    this.preview = new Preview3D(this);

    this.canvas.onViewChange = () => this.updateZoomLabel();
    this.canvas.onTextDblClick = (id) => {
      this.store.select({ type: 'item', id });
      this.sidebar.focusText();
    };
    this.store.on((kind) => {
      if (kind === 'doc' || kind === 'exhibitor') this.scheduleSave();
      if (kind === 'doc') this.updateUndoButtons();
    });

    this.bindToolbar();
    this.bindExhibitor();
    this.bindDrop();
    this.bindKeys();
    this.loadFonts();
    this.updateUndoButtons();
    void this.restore();
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
    const input = document.getElementById('file-image') as HTMLInputElement;
    input.onchange = () => {
      const files = [...(input.files ?? [])];
      input.value = '';
      if (files.length) void this.addFiles(files, { panelId });
    };
    input.click();
  }

  pickAttachments() {
    const input = document.getElementById('file-attach') as HTMLInputElement;
    input.onchange = () => {
      const files = [...(input.files ?? [])];
      input.value = '';
      for (const f of files) this.addAttachment(f);
      if (files.length) toast(files.length === 1 ? 'Prilog je dodan.' : `Dodano priloga: ${files.length}.`, 'ok');
    };
    input.click();
  }

  addAttachment(file: File) {
    const entry = rawEntry(file, file.name);
    this.store.files.set(entry.id, entry);
    this.store.update((d) => {
      d.attachments.push(entry.id);
    });
  }

  removeAttachment(id: string) {
    this.store.update((d) => {
      d.attachments = d.attachments.filter((a) => a !== id);
    });
  }

  async addFiles(list: File[], opts: { panelId?: string; at?: Vec } = {}) {
    const added: string[] = [];
    for (const file of list) {
      if (isHeic(file.name, file.type)) {
        toast(`„${file.name}” je HEIC fotografija koju preglednik ne može prikazati. Spremite je kao JPG pa pokušajte ponovno.`, 'error');
        continue;
      }
      if (!isPlaceableImage(file.name, file.type)) {
        this.addAttachment(file);
        toast(`„${file.name}” je dodan kao prilog (ne može se prikazati na platnu).`);
        continue;
      }
      let entry: FileEntry;
      try {
        entry = await loadImageEntry(file, file.name);
      } catch {
        toast(`Datoteku „${file.name}” nije moguće otvoriti kao sliku. Pokušajte s JPG ili PNG.`, 'error');
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
      fill: '#0f172a',
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
      d.items.splice(d.items.indexOf(d.items.find((i) => i.id === id)!) + 1, 0, copy);
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

  setPanelBg(panelId: string, color: string | null, historyKey?: string) {
    this.store.update((d) => {
      if (color && color !== '#ffffff') d.panelBg[panelId] = color;
      else delete d.panelBg[panelId];
    }, historyKey);
  }

  selectPanel(id: string) {
    this.store.select({ type: 'panel', id });
    this.canvas.focusPanel(id);
  }

  // ---------- project ----------

  async exportZip() {
    const name = this.store.doc.exhibitor.name.trim();
    if (!name) {
      toast('Prije preuzimanja upišite naziv ustanove (lijevo gore).', 'error');
      document.getElementById('ex-name')?.focus();
      return;
    }
    if (!this.store.doc.items.length) {
      toast('Raspored je prazan. Dodajte barem jednu sliku ili tekst.', 'error');
      return;
    }
    const errors = computeIssues(this).filter((i) => i.level === 'error').length;
    if (errors && !confirm(`Broj ozbiljnih upozorenja: ${errors} (npr. preniska rezolucija ili element izvan panela).\n\nSvejedno preuzeti ZIP?`)) return;

    const btn = document.getElementById('btn-export') as HTMLButtonElement;
    btn.disabled = true;
    btn.dataset.label = btn.textContent ?? '';
    btn.textContent = 'Pripremam…';
    try {
      const { blob, filename } = await buildZip(this);
      downloadBlob(blob, filename);
      toast(`Preuzeto: ${filename}. Pošaljite tu datoteku organizatoru.`, 'ok');
    } catch (e) {
      console.error(e);
      toast('Izrada ZIP-a nije uspjela. Pokušajte ponovno.', 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = btn.dataset.label ?? 'Preuzmi ZIP';
    }
  }

  async importZip(file: File) {
    if ((this.store.doc.items.length || this.store.doc.exhibitor.name) && !confirm('Učitavanje će zamijeniti trenutni raspored. Nastaviti?')) return;
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
    if (!confirm('Obrisati cijeli raspored i početi ispočetka?\n\nOvo se ne može poništiti. Ako želite sačuvati rad, prvo preuzmite ZIP.')) return;
    this.store.replace(emptyDoc(), new Map());
    this.fillExhibitor();
    void clearProject().catch(() => {});
    this.canvas.fit();
  }

  private async loadProjectData(doc: Doc, saved: SavedFile[]) {
    const imageIds = new Set(doc.items.flatMap((i) => (i.kind === 'image' ? [i.fileId] : [])));
    const files = new Map<string, FileEntry>();
    for (const f of saved) {
      const blob = f.type && !f.blob.type ? new Blob([f.blob], { type: f.type }) : f.blob;
      if (imageIds.has(f.id)) {
        const entry = await loadImageEntry(blob, f.name, f.id).catch(() => null);
        if (entry) files.set(f.id, entry);
      } else {
        files.set(f.id, rawEntry(blob, f.name, f.id));
      }
    }
    doc.items = doc.items.filter((i) => i.kind !== 'image' || files.has(i.fileId));
    doc.attachments = doc.attachments.filter((id) => files.has(id));
    doc.exhibitor = { ...emptyDoc().exhibitor, ...doc.exhibitor };
    this.store.replace(doc, files);
    this.fillExhibitor();
    this.canvas.fit(false);
  }

  private async restore() {
    try {
      const saved = await loadProject();
      if (!saved || (!saved.doc.items.length && !saved.doc.exhibitor.name)) return;
      await this.loadProjectData(saved.doc, saved.files);
      toast('Nastavljate s rasporedom spremljenim u ovom pregledniku.');
    } catch (e) {
      console.warn('Restore failed', e);
    }
  }

  private scheduleSave() {
    clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => void this.save(), 700);
  }

  private async save() {
    const status = document.getElementById('save-status')!;
    const used = this.store.usedFileIds();
    const files: SavedFile[] = [];
    for (const id of used) {
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
    on('btn-export', () => void this.exportZip());
    on('btn-load', () => {
      const input = document.getElementById('file-zip') as HTMLInputElement;
      input.onchange = () => {
        const f = input.files?.[0];
        input.value = '';
        if (f) void this.importZip(f);
      };
      input.click();
    });
  }

  private updateZoomLabel() {
    document.getElementById('btn-zoom-fit')!.textContent = `${this.canvas.zoomPercent()}%`;
  }

  private updateUndoButtons() {
    (document.getElementById('btn-undo') as HTMLButtonElement).disabled = !this.store.canUndo;
    (document.getElementById('btn-redo') as HTMLButtonElement).disabled = !this.store.canRedo;
  }

  private bindExhibitor() {
    document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('[data-ex]').forEach((el) => {
      el.addEventListener('input', () => this.store.setExhibitor(el.dataset.ex as keyof Exhibitor, el.value));
    });
  }

  private fillExhibitor() {
    document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('[data-ex]').forEach((el) => {
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
      const files = [...(e.clipboardData?.files ?? [])];
      if (!files.length) return;
      e.preventDefault();
      void this.addFiles(files);
    });
  }

  private bindKeys() {
    window.addEventListener('keydown', (e) => {
      if ((e.target as HTMLElement).closest?.('input, textarea, select, [contenteditable]')) return;
      if (this.preview.isOpen) return;
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
    void Promise.all(loads).then(() => this.canvas.refreshText());
    document.fonts.addEventListener('loadingdone', () => this.canvas.refreshText());
  }
}
