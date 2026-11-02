import { PRINT, type Layout, panelsTouched } from './booth';
import type { BoothCanvas } from './canvas';
import type { FileEntry } from './files';
import type { ImageItem, Item, Store } from './state';

export interface Issue {
  level: 'error' | 'warn' | 'info';
  text: string;
  itemId?: string;
}

interface Ctx {
  store: Store;
  canvas: BoothCanvas;
  layout: Layout;
}

/** Resolution of an image at its placed size. Null for vector files. */
export function effectiveDpi(file: FileEntry, it: ImageItem): number | null {
  if (file.vector) return null;
  return Math.round(Math.min(file.pxW / (it.width / 25.4), file.pxH / (it.height / 25.4)));
}

export function dpiLevel(dpi: number | null): 'vector' | 'good' | 'warn' | 'error' {
  if (dpi === null) return 'vector';
  if (dpi >= PRINT.dpiGood) return 'good';
  if (dpi >= PRINT.dpiMin) return 'warn';
  return 'error';
}

export function itemLabel(store: Store, it: Item): string {
  if (it.kind === 'image') return `Slika „${store.files.get(it.fileId)?.name ?? 'slika'}”`;
  const t = it.text.trim().replace(/\s+/g, ' ');
  return `Tekst „${t.length > 24 ? `${t.slice(0, 24)}…` : t || '(prazno)'}”`;
}

export function computeIssues({ store, canvas, layout }: Ctx): Issue[] {
  const out: Issue[] = [];
  for (const it of store.doc.items) {
    const box = canvas.itemBox(it.id);
    if (!box) continue;
    const label = itemLabel(store, it);
    const touched = panelsTouched(layout, box);

    if (touched.length === 0) {
      out.push({ level: 'error', itemId: it.id, text: `${label} je izvan panela i neće biti otisnut.` });
    } else {
      if (touched.length > 1) {
        const ids = touched.map((t) => t.panel.id).join(' i ');
        const walls = new Set(touched.map((t) => t.panel.wall));
        out.push({
          level: 'warn',
          itemId: it.id,
          text:
            walls.size > 1
              ? `${label} prelazi preko kuta štanda (paneli ${ids} su na različitim zidovima).`
              : `${label} prelazi preko spoja panela ${ids} — kroz njega prolazi aluminijski profil.`,
        });
      }
      const inside = touched.reduce((s, t) => s + t.area, 0);
      if (inside < box.w * box.h * 0.98) {
        out.push({ level: 'info', itemId: it.id, text: `${label} djelomično izlazi izvan panela; taj dio neće biti otisnut.` });
      }
    }

    if (it.kind === 'image') {
      const f = store.files.get(it.fileId);
      if (f) {
        const dpi = effectiveDpi(f, it);
        const lvl = dpiLevel(dpi);
        if (lvl === 'error') {
          out.push({ level: 'error', itemId: it.id, text: `${label}: preniska rezolucija (${dpi} dpi). Pošaljite veću datoteku ili smanjite sliku.` });
        } else if (lvl === 'warn') {
          out.push({ level: 'warn', itemId: it.id, text: `${label}: granična rezolucija (${dpi} dpi), otisak može biti blago mutan.` });
        }
      }
    } else {
      if (!it.text.trim()) out.push({ level: 'warn', itemId: it.id, text: 'Prazan tekstni okvir.' });
      else if (it.fontSize < PRINT.minTextMm) {
        out.push({ level: 'info', itemId: it.id, text: `${label} je vrlo malen (${Math.round(it.fontSize)} mm) i bit će teško čitljiv s udaljenosti.` });
      }
    }
  }
  const order = { error: 0, warn: 1, info: 2 };
  return out.sort((a, b) => order[a.level] - order[b.level]);
}
