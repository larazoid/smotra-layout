# Raspored štanda (Smotra)

A small web app where each university arranges logos, photos and text on its own
stand panels (1–8) and sends the result to the organiser as one ZIP file.

- Walls are shown "unfolded": left side wall (7, 8), back wall (1–4), right side wall (5, 6),
  each as seen when standing in front of it. A floor plan and a 3D preview show which is which.
- Everything is measured in millimetres, so the app can warn when an image is too low-resolution
  for its printed size.
- Work is autosaved in the visitor's browser (IndexedDB). Nothing is uploaded anywhere.

## What the organiser receives

`smotra-<ustanova>.zip` contains:

| Path | What |
| --- | --- |
| `sazetak.txt` | Human-readable list of every element per panel, with positions in mm |
| `raspored.json` | The same data for tools, plus the editor state |
| `datoteke/` | Original image files, untouched |
| `prilozi/` | Extra files (AI, PDF, EPS…) the university attached |
| `pregled/` | Preview PNGs of the whole stand and each panel (not for print) |

Open a ZIP with **Učitaj ZIP** to see the layout in the editor.

## Changing the stand

All sizes, panel order, colours and print thresholds live in `src/booth.ts`.

## Running and deploying

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # static site in dist/
```

`dist/` is a plain static site (relative paths), so it can be uploaded to Netlify,
GitHub Pages or any web host.
