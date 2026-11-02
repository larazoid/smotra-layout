import { uid } from './util';

export interface FileEntry {
  id: string;
  name: string;
  type: string;
  /** The original bytes, exported untouched for print. */
  blob: Blob;
  /** Pixel size (for SVG: viewBox size). 0 for non-images. */
  pxW: number;
  pxH: number;
  vector: boolean;
  /** Screen version drawn on the canvas (downscaled if huge). Null for attachments. */
  display: HTMLImageElement | HTMLCanvasElement | null;
  /** Object URL for thumbnails. Empty for attachments. */
  url: string;
}

const MAX_DISPLAY_PX = 3000;
const PLACEABLE = /\.(png|jpe?g|webp|gif|svg|avif|bmp)$/i;

const MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  svg: 'image/svg+xml',
  avif: 'image/avif',
  bmp: 'image/bmp',
  pdf: 'application/pdf',
  ai: 'application/postscript',
  eps: 'application/postscript',
};

export function mimeFromName(name: string): string {
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  return MIME[ext] ?? 'application/octet-stream';
}

export function isPlaceableImage(name: string, type: string): boolean {
  return PLACEABLE.test(name) || /^image\/(png|jpeg|webp|gif|svg\+xml|avif|bmp)$/.test(type);
}

export function isHeic(name: string, type: string): boolean {
  return /\.(heic|heif)$/i.test(name) || /heic|heif/i.test(type);
}

function withType(blob: Blob, name: string): Blob {
  return blob.type ? blob : new Blob([blob], { type: mimeFromName(name) });
}

// Uses onload rather than img.decode(): decode() can stall while the page isn't on screen
// (e.g. restoring autosave in a background tab).
function loadImg(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('image failed to load'));
    img.src = url;
  });
}

/** Loads a raster or SVG image. Throws if the browser cannot decode it. */
export async function loadImageEntry(source: Blob, name: string, id = uid()): Promise<FileEntry> {
  const blob = withType(source, name);
  if (blob.type === 'image/svg+xml' || /\.svg$/i.test(name)) return loadSvg(blob, name, id);

  const url = URL.createObjectURL(blob);
  const img = await loadImg(url);
  const pxW = img.naturalWidth;
  const pxH = img.naturalHeight;
  if (!pxW || !pxH) throw new Error('empty image');

  let display: HTMLImageElement | HTMLCanvasElement = img;
  const longest = Math.max(pxW, pxH);
  if (longest > MAX_DISPLAY_PX) {
    const k = MAX_DISPLAY_PX / longest;
    const c = document.createElement('canvas');
    c.width = Math.round(pxW * k);
    c.height = Math.round(pxH * k);
    const ctx = c.getContext('2d')!;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, 0, 0, c.width, c.height);
    display = c;
  }
  return { id, name, type: blob.type, blob, pxW, pxH, vector: false, display, url };
}

async function loadSvg(blob: Blob, name: string, id: string): Promise<FileEntry> {
  const text = await blob.text();
  const doc = new DOMParser().parseFromString(text, 'image/svg+xml');
  const svg = doc.documentElement;
  if (svg.nodeName.toLowerCase() !== 'svg') throw new Error('not an svg');

  // Work out the intrinsic size from viewBox or width/height.
  const vb = svg.getAttribute('viewBox')?.split(/[\s,]+/).map(Number);
  let vw = vb && vb.length === 4 ? vb[2] : parseFloat(svg.getAttribute('width') ?? '');
  let vh = vb && vb.length === 4 ? vb[3] : parseFloat(svg.getAttribute('height') ?? '');
  if (!(vw > 0) || !(vh > 0)) {
    vw = 1000;
    vh = 1000;
  }
  if (!vb) svg.setAttribute('viewBox', `0 0 ${vw} ${vh}`);

  // Give it an explicit size so every browser can rasterise it sharply.
  const k = 2400 / Math.max(vw, vh);
  const W = Math.round(vw * k);
  const H = Math.round(vh * k);
  svg.setAttribute('width', String(W));
  svg.setAttribute('height', String(H));
  const sized = new Blob([new XMLSerializer().serializeToString(svg)], { type: 'image/svg+xml' });
  const url = URL.createObjectURL(sized);
  const img = await loadImg(url);

  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  c.getContext('2d')!.drawImage(img, 0, 0, W, H);
  return { id, name, type: 'image/svg+xml', blob, pxW: vw, pxH: vh, vector: true, display: c, url };
}

export function rawEntry(source: Blob, name: string, id = uid()): FileEntry {
  const blob = withType(source, name);
  return { id, name, type: blob.type, blob, pxW: 0, pxH: 0, vector: false, display: null, url: '' };
}
