/** Event details and the list of exhibiting faculties (from the organiser's schedule). */

export const EVENT = {
  name: 'Smotra Sveučilišta u Splitu',
  /** Accusative form, for sentences like "materijale za Smotru…". */
  nameAcc: 'Smotru Sveučilišta u Splitu',
  tagline: 'Upoznavanje s uvjetima upisa, upisima i studiranjem na našim studijima',
  dates: '8. – 11. prosinca 2026.',
  place: 'Kampus – zgrada tri fakulteta, Ruđera Boškovića 33',
  year: 2026,
  /** Address universities send their ZIP to. TODO: fill in before going live. */
  organizerEmail: '',
  /** Most mail servers reject attachments around 20–25 MB; above this we suggest WeTransfer. */
  maxEmailMb: 20,
};

export interface Day {
  id: string;
  label: string;
  short: string;
  color: string;
}

/**
 * Colours are placeholders: the day colours from the printed schedule.
 * Replace each faculty's `color` below with its official colour.
 */
export const DAYS: Day[] = [
  { id: '2026-12-08', label: 'Utorak, 8. prosinca', short: '8. 12.', color: '#a9d08e' },
  { id: '2026-12-09', label: 'Srijeda, 9. prosinca', short: '9. 12.', color: '#8ea9db' },
  { id: '2026-12-10', label: 'Četvrtak, 10. prosinca', short: '10. 12.', color: '#f4b084' },
  { id: '2026-12-11', label: 'Petak, 11. prosinca', short: '11. 12.', color: '#f2b8c6' },
];

export interface Faculty {
  id: string;
  name: string;
  day: string;
  /** Start hour, e.g. "18". */
  hour: string;
  /** Panel colour for every panel of this faculty's stand. */
  color: string;
}

const [D8, D9, D10, D11] = DAYS;

export const FACULTIES: Faculty[] = [
  { id: 'ekonomski', name: 'Ekonomski fakultet', day: D8.id, hour: '18', color: D8.color },
  { id: 'kemijsko-tehnoloski', name: 'Kemijsko-tehnološki fakultet', day: D8.id, hour: '18', color: D8.color },
  { id: 'katolicki-bogoslovni', name: 'Katolički bogoslovni fakultet', day: D8.id, hour: '19', color: D8.color },
  { id: 'fgag', name: 'Fakultet građevinarstva, arhitekture i geodezije', day: D8.id, hour: '19', color: D8.color },

  { id: 'kinezioloski', name: 'Kineziološki fakultet', day: D9.id, hour: '18', color: D9.color },
  { id: 'fesb', name: 'Fakultet elektrotehnike, strojarstva i brodogradnje', day: D9.id, hour: '18', color: D9.color },
  { id: 'pmf', name: 'Prirodoslovno-matematički fakultet', day: D9.id, hour: '18', color: D9.color },
  { id: 'pravni', name: 'Pravni fakultet', day: D9.id, hour: '19', color: D9.color },
  { id: 'umjetnicka-akademija', name: 'Umjetnička akademija', day: D9.id, hour: '19', color: D9.color },
  { id: 'studiji-mora', name: 'Sveučilišni odjel za studije mora', day: D9.id, hour: '19', color: D9.color },

  { id: 'zdravstvene-znanosti', name: 'Fakultet zdravstvenih znanosti', day: D10.id, hour: '18', color: D10.color },
  { id: 'filozofski', name: 'Filozofski fakultet', day: D10.id, hour: '18', color: D10.color },
  { id: 'forenzicke-znanosti', name: 'Fakultet za forenzičke znanosti', day: D10.id, hour: '19', color: D10.color },
  { id: 'pomorski', name: 'Pomorski fakultet', day: D10.id, hour: '19', color: D10.color },

  { id: 'agromediteranski', name: 'Agromediteranski fakultet', day: D11.id, hour: '18', color: D11.color },
  { id: 'medicinski', name: 'Medicinski fakultet', day: D11.id, hour: '18', color: D11.color },
  { id: 'hotelijerstvo-gastronomija', name: 'Sveučilišni studij Hotelijerstvo i gastronomija', day: D11.id, hour: '18', color: D11.color },
  { id: 'strucni-studiji', name: 'Sveučilišni odjel za stručne studije', day: D11.id, hour: '19', color: D11.color },
  { id: 'komunikacija-mediji', name: 'Sveučilišni studij Komunikacija i mediji', day: D11.id, hour: '19', color: D11.color },
];

export function facultyById(id: string | null | undefined): Faculty | undefined {
  return FACULTIES.find((f) => f.id === id);
}

export function dayOf(f: Faculty): Day {
  return DAYS.find((d) => d.id === f.day)!;
}

export function slotLabel(f: Faculty): string {
  const d = dayOf(f);
  return `${d.label} ${EVENT.year}. u ${f.hour} h`;
}

/** Relative luminance (0 = black, 1 = white). */
export function luminance(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
}

/** Readable text colour on a given background. */
export function textOn(bg: string): string {
  return luminance(bg) > 0.35 ? '#0f172a' : '#ffffff';
}

/**
 * Draws the header boards 11 + 12 (one name across both, like the organiser's sketch).
 * `split` is where board 11 ends, as a fraction of the width.
 */
export function drawFascia(c: HTMLCanvasElement, f: Faculty | undefined, split: number) {
  const ctx = c.getContext('2d')!;
  const { width: w, height: h } = c;
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = f?.color ?? '#e5e9ef';
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = 'rgba(15, 23, 42, 0.25)';
  ctx.fillRect(Math.round(w * split) - 1, 0, 2, h);

  const text = (f?.name ?? 'Naziv sastavnice').toUpperCase();
  ctx.fillStyle = f ? textOn(f.color) : '#94a3b8';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const font = (px: number) => `700 ${px}px Montserrat, Inter, sans-serif`;
  const fit = (s: string, max: number) => {
    ctx.font = font(100);
    return Math.min(max, (100 * w * 0.92) / ctx.measureText(s).width);
  };

  const one = fit(text, h * 0.42);
  if (one >= h * 0.3 || !text.includes(' ')) {
    ctx.font = font(one);
    ctx.fillText(text, w / 2, h / 2 + one * 0.04);
    return;
  }
  // Long names: two lines, split at the space closest to the middle.
  const words = text.split(' ');
  let best = 1;
  let bestDiff = Infinity;
  for (let i = 1; i < words.length; i++) {
    const diff = Math.abs(words.slice(0, i).join(' ').length - words.slice(i).join(' ').length);
    if (diff < bestDiff) [best, bestDiff] = [i, diff];
  }
  const lines = [words.slice(0, best).join(' '), words.slice(best).join(' ')];
  const size = Math.min(...lines.map((l) => fit(l, h * 0.34)));
  ctx.font = font(size);
  ctx.fillText(lines[0], w / 2, h / 2 - size * 0.55);
  ctx.fillText(lines[1], w / 2, h / 2 + size * 0.6);
}
