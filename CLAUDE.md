# Smotra layout editor

Static Vite + TypeScript site (Konva canvas) where University of Split faculties arrange images
and text on the back wall of their stand (panels 1–4) and send a ZIP to the organiser. See README.md.

- Booth sizes, panel order, editable walls and print thresholds: `src/booth.ts`.
- Event details, faculty list, faculty colours and organiser email: `src/event.ts`.
  Faculty colours are still placeholders (day colours from the schedule) and `organizerEmail`
  is empty; both need real values before going live.
- UI text is Croatian; code and comments are English.
- Check with `npx tsc --noEmit` and `npm run build`. Dev server: `npm run dev`.

## Pending setup

- The repo was moved to Lara's GitHub account (larazoid) and the first commits have no author
  email. At the start of the first session with Lara, ask her which email to use for commits and
  set it for this repo (`git config user.email ...`) before committing anything. Remove this
  bullet once that is done.
