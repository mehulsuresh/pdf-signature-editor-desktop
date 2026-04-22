# Contributing to SignCanvas

Thanks for your interest in contributing. This guide covers the basics for
getting productive quickly.

## Where to work

- **Active product:** [`apps/signcanvas-editor`](apps/signcanvas-editor) — all
  new features and fixes go here.
- **Legacy:** [`legacy/tkinter-app`](legacy/tkinter-app) is archived and
  should not receive new feature work.

## Setup

```bash
npm install
npm test
```

For desktop development (requires the [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/)):

```bash
npm run dev:desktop
```

## Pull request guidelines

- Keep changes focused and reviewable — one concern per PR.
- Run `npm test` before pushing.
- Don't commit build artifacts, screenshots, or personal PDFs (the `.gitignore`
  blocks most of this, but double-check).
- Update docs (`README.md`, `docs/`) when you change build steps, scripts, or
  repo structure.

## Reporting issues

Open an issue at
[github.com/mehulsuresh/pdf-signature-editor-desktop/issues](https://github.com/mehulsuresh/pdf-signature-editor-desktop/issues).
Include your OS, Node version, and repro steps.
