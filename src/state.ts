import type { FileEntry } from './files';

export interface Exhibitor {
  name: string;
  contact: string;
  email: string;
  note: string;
}

interface ItemBase {
  id: string;
  /** Top-left corner in the unfolded wall view, mm. Rotation is around this point, clockwise. */
  x: number;
  y: number;
  rotation: number;
}

export interface ImageItem extends ItemBase {
  kind: 'image';
  fileId: string;
  width: number;
  height: number;
}

export interface TextItem extends ItemBase {
  kind: 'text';
  text: string;
  fontFamily: string;
  /** Font size in mm. */
  fontSize: number;
  bold: boolean;
  italic: boolean;
  fill: string;
  align: 'left' | 'center' | 'right';
  /** Wrapping width in mm. */
  width: number;
  lineHeight: number;
}

export type Item = ImageItem | TextItem;

export interface Doc {
  exhibitor: Exhibitor;
  items: Item[];
  /** Panel id → background colour. */
  panelBg: Record<string, string>;
  /** File ids of extra files (AI, PDF, …) sent along but not placed. */
  attachments: string[];
}

export type Selection = { type: 'item' | 'panel'; id: string } | null;
export type ChangeKind = 'doc' | 'selection' | 'hover' | 'exhibitor';

export const FONTS = ['Montserrat', 'Inter', 'Roboto', 'Open Sans', 'Oswald', 'Playfair Display', 'Merriweather', 'Arial', 'Georgia'];

export function emptyDoc(): Doc {
  return { exhibitor: { name: '', contact: '', email: '', note: '' }, items: [], panelBg: {}, attachments: [] };
}

export class Store {
  doc: Doc = emptyDoc();
  files = new Map<string, FileEntry>();
  selection: Selection = null;
  hoverPanel: string | null = null;

  private listeners = new Set<(kind: ChangeKind) => void>();
  private past: string[] = [];
  private future: string[] = [];
  private lastKey: string | undefined;
  private lastTime = 0;

  on(fn: (kind: ChangeKind) => void) {
    this.listeners.add(fn);
  }

  private emit(kind: ChangeKind) {
    this.listeners.forEach((fn) => fn(kind));
  }

  /**
   * Change the layout. Calls with the same historyKey in quick succession
   * (typing, nudging) collapse into one undo step.
   */
  update(mutate: (doc: Doc) => void, historyKey?: string) {
    const now = performance.now();
    const coalesce = historyKey !== undefined && historyKey === this.lastKey && now - this.lastTime < 1500;
    if (!coalesce) {
      this.past.push(this.snapshot());
      if (this.past.length > 100) this.past.shift();
      this.future = [];
    }
    this.lastKey = historyKey;
    this.lastTime = now;
    mutate(this.doc);
    this.emit('doc');
  }

  get canUndo() {
    return this.past.length > 0;
  }

  get canRedo() {
    return this.future.length > 0;
  }

  undo() {
    const prev = this.past.pop();
    if (prev === undefined) return;
    this.future.push(this.snapshot());
    this.applySnapshot(prev);
  }

  redo() {
    const next = this.future.pop();
    if (next === undefined) return;
    this.past.push(this.snapshot());
    this.applySnapshot(next);
  }

  private snapshot(): string {
    const { items, panelBg, attachments } = this.doc;
    return JSON.stringify({ items, panelBg, attachments });
  }

  private applySnapshot(s: string) {
    const d = JSON.parse(s) as Pick<Doc, 'items' | 'panelBg' | 'attachments'>;
    this.doc.items = d.items;
    this.doc.panelBg = d.panelBg;
    this.doc.attachments = d.attachments;
    this.lastKey = undefined;
    if (this.selection?.type === 'item' && !this.item(this.selection.id)) this.selection = null;
    this.emit('doc');
    this.emit('selection');
  }

  replace(doc: Doc, files: Map<string, FileEntry>) {
    this.doc = doc;
    this.files = files;
    this.past = [];
    this.future = [];
    this.selection = null;
    this.emit('doc');
    this.emit('selection');
    this.emit('exhibitor');
  }

  setExhibitor(field: keyof Exhibitor, value: string) {
    this.doc.exhibitor[field] = value;
    this.emit('exhibitor');
  }

  select(sel: Selection) {
    if (sel?.type === this.selection?.type && sel?.id === this.selection?.id) return;
    this.selection = sel;
    this.emit('selection');
  }

  setHover(id: string | null) {
    if (id === this.hoverPanel) return;
    this.hoverPanel = id;
    this.emit('hover');
  }

  item(id: string): Item | undefined {
    return this.doc.items.find((i) => i.id === id);
  }

  get selectedItem(): Item | undefined {
    return this.selection?.type === 'item' ? this.item(this.selection.id) : undefined;
  }

  /** File ids referenced by placed images or attachments. */
  usedFileIds(): Set<string> {
    const ids = new Set(this.doc.attachments);
    for (const it of this.doc.items) if (it.kind === 'image') ids.add(it.fileId);
    return ids;
  }
}
