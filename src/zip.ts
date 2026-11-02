import JSZip from 'jszip';
import type { App } from './app';
import { BOOTH, panelsTouched, primaryPanel, wallName } from './booth';
import { computeIssues, effectiveDpi } from './issues';
import type { Doc, Item } from './state';
import type { SavedFile } from './storage';
import { canvasToBlob, round1, safeFileName, slugify } from './util';

const FORMAT = 'smotra-layout';

interface FileRef {
  path: string;
  name: string;
  type: string;
}

/** Element description for whoever prepares the print files. Positions are relative to the panel. */
function describe(app: App, it: Item, files: Record<string, FileRef>) {
  const box = app.canvas.itemBox(it.id)!;
  const p = primaryPanel(app.layout, box);
  const base = {
    id: it.id,
    type: it.kind,
    panel: p.id,
    wall: p.wall,
    panels_touched: panelsTouched(app.layout, box).map((t) => t.panel.id),
    x_mm: round1(it.x - p.x),
    y_mm: round1(it.y - p.y),
    rotation_deg: round1(it.rotation),
    bounds_mm: { x: round1(box.x - p.x), y: round1(box.y - p.y), w: round1(box.w), h: round1(box.h) },
  };
  if (it.kind === 'image') {
    const f = app.store.files.get(it.fileId)!;
    return {
      ...base,
      width_mm: round1(it.width),
      height_mm: round1(it.height),
      file: files[it.fileId]?.path,
      original_name: f.name,
      pixels: f.vector ? null : [f.pxW, f.pxH],
      dpi_at_print_size: effectiveDpi(f, it),
    };
  }
  return {
    ...base,
    text: it.text,
    font: it.fontFamily,
    font_size_mm: round1(it.fontSize),
    bold: it.bold,
    italic: it.italic,
    color: it.fill,
    align: it.align,
    box_width_mm: round1(it.width),
    line_height: it.lineHeight,
  };
}

function summary(app: App, report: ReturnType<typeof describe>[]): string {
  const ex = app.store.doc.exhibitor;
  const lines: string[] = [];
  lines.push('RASPORED ŠTANDA — SMOTRA', '');
  lines.push(`Izlagač:  ${ex.name}`);
  if (ex.contact) lines.push(`Kontakt:  ${ex.contact}`);
  if (ex.email) lines.push(`E-mail:   ${ex.email}`);
  lines.push(`Izvezeno: ${new Date().toLocaleString('hr-HR')}`, '');
  if (ex.note.trim()) lines.push('Napomena izlagača:', ex.note.trim(), '');
  lines.push('Položaji su u milimetrima, mjereni od gornjeg lijevog kuta panela.');
  lines.push('Rotacija je u smjeru kazaljke na satu, oko gornjeg lijevog kuta elementa.', '');

  for (const w of app.layout.walls) {
    lines.push('='.repeat(60), wallName(w.kind, w.id).toUpperCase(), '='.repeat(60));
    for (const p of w.panels) {
      const bg = app.store.doc.panelBg[p.id] ?? '#ffffff';
      lines.push('', `Panel ${p.id}  (${p.w} × ${p.h} mm)  pozadina: ${bg}`);
      const own = report.filter((r) => r.panel === p.id);
      if (!own.length) lines.push('  — prazno —');
      for (const r of own) {
        const pos = `x ${r.x_mm}, y ${r.y_mm}${r.rotation_deg ? `, rotacija ${r.rotation_deg}°` : ''}`;
        if ('file' in r) {
          const q = r.dpi_at_print_size === null ? 'vektor' : `${r.dpi_at_print_size} dpi`;
          lines.push(`  • Slika „${r.original_name}” → ${r.file}`, `      ${r.width_mm} × ${r.height_mm} mm, ${pos}, ${q}`);
        } else {
          const style = [r.bold && 'bold', r.italic && 'italic'].filter(Boolean).join(' ') || 'regular';
          lines.push(`  • Tekst: ${r.text.replace(/\n/g, ' / ')}`, `      ${r.font} ${style}, ${r.font_size_mm} mm, ${r.color}, poravnanje ${r.align}, okvir ${r.box_width_mm} mm, ${pos}`);
        }
        if (r.panels_touched.length > 1) lines.push(`      ! prelazi na panele: ${r.panels_touched.join(', ')}`);
      }
    }
    lines.push('');
  }

  const issues = computeIssues(app);
  if (issues.length) {
    lines.push('UPOZORENJA', '-'.repeat(60));
    for (const i of issues) lines.push(`  [${i.level === 'error' ? 'GREŠKA' : i.level === 'warn' ? 'PAŽNJA' : 'INFO'}] ${i.text}`);
    lines.push('');
  }
  if (app.store.doc.attachments.length) {
    lines.push('PRILOZI (mapa prilozi/)');
    for (const id of app.store.doc.attachments) lines.push(`  • ${app.store.files.get(id)?.name}`);
  }
  return lines.join('\n');
}

export async function buildZip(app: App): Promise<{ blob: Blob; filename: string }> {
  const { store, layout, canvas } = app;
  const slug = slugify(store.doc.exhibitor.name);
  const zip = new JSZip();
  const root = zip.folder(`smotra-${slug}`)!;

  // Original files, untouched.
  const files: Record<string, FileRef> = {};
  const attachments = new Set(store.doc.attachments);
  for (const id of store.usedFileIds()) {
    const f = store.files.get(id);
    if (!f) continue;
    const path = `${attachments.has(id) ? 'prilozi' : 'datoteke'}/${id.slice(0, 6)}-${safeFileName(f.name)}`;
    root.file(path, f.blob);
    files[id] = { path, name: f.name, type: f.type };
  }

  const report = store.doc.items.map((it) => describe(app, it, files));
  root.file(
    'raspored.json',
    JSON.stringify(
      {
        format: FORMAT,
        version: 1,
        exported_at: new Date().toISOString(),
        exhibitor: store.doc.exhibitor,
        units: 'mm',
        booth: {
          wall_height: BOOTH.wallHeight,
          panels: layout.panels.map((p) => ({ id: p.id, wall: p.wall, width: p.w, height: p.h, background: store.doc.panelBg[p.id] ?? '#ffffff' })),
        },
        elements: report,
        files,
        // Used by "Učitaj ZIP" to reopen the layout in the editor.
        doc: store.doc,
      },
      null,
      2,
    ),
  );
  root.file('sazetak.txt', summary(app, report));

  // Preview images (not for print).
  const overview = canvas.renderRegion(layout.bounds, 0.45, { labels: true });
  const flat = document.createElement('canvas');
  flat.width = overview.width;
  flat.height = overview.height;
  const ctx = flat.getContext('2d')!;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, flat.width, flat.height);
  ctx.drawImage(overview, 0, 0);
  root.file('pregled/cijeli-stand.png', await canvasToBlob(flat));
  for (const p of layout.panels) {
    root.file(`pregled/panel-${p.id}.png`, await canvasToBlob(canvas.renderRegion(p, 0.6)));
  }

  const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } });
  return { blob, filename: `smotra-${slug}.zip` };
}

export async function readZip(file: File): Promise<{ doc: Doc; files: SavedFile[] }> {
  const zip = await JSZip.loadAsync(file);
  const entry = Object.values(zip.files).find((f) => !f.dir && /(^|\/)raspored\.json$/.test(f.name));
  if (!entry) throw new Error('raspored.json missing');
  const base = entry.name.slice(0, -'raspored.json'.length);
  const data = JSON.parse(await entry.async('string'));
  if (data.format !== FORMAT || !data.doc) throw new Error('unknown format');

  const files: SavedFile[] = [];
  for (const [id, ref] of Object.entries(data.files as Record<string, FileRef>)) {
    const f = zip.file(base + ref.path);
    if (!f) continue;
    const raw = await f.async('blob');
    files.push({ id, name: ref.name, type: ref.type, blob: new Blob([raw], { type: ref.type }) });
  }
  return { doc: data.doc as Doc, files };
}
