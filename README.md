# SignCanvas

A local-first PDF signing editor. Sign, initial, date, and fill PDFs on your
own machine — no cloud, no account, no upload. Ships as both a desktop app
(Tauri) and a web app (Vite), from a single React + TypeScript codebase.

## Features

- Local-first: PDFs never leave your machine
- Draw, type, or import signatures and initials
- Reusable signature library (stored locally)
- Typed cursive signature generator with multiple fonts
- Text, date, and color annotations with auto tool-switching
- High-DPI signature export for crisp final PDFs
- PDF rendering via [`pdf.js`](https://mozilla.github.io/pdf.js/), export via [`pdf-lib`](https://pdf-lib.js.org/)
- Native desktop builds for Windows, Linux, macOS (Intel & Apple Silicon)

## Project layout

```
apps/
  signcanvas-editor/   # Main Tauri + React + TypeScript app (actively developed)
legacy/
  tkinter-app/         # Original Python/Tkinter implementation (archived)
docs/
  TAURI_WEB_SETUP.md   # Build and setup notes for the main app
.github/workflows/     # CI for native desktop builds
```

## Requirements

- Node.js 20+
- npm 10+
- For desktop builds: [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/) (Rust toolchain + platform build tools)

## Getting started

```bash
git clone https://github.com/mehulsuresh/pdf-signature-editor-desktop.git
cd pdf-signature-editor-desktop
npm install
```

Run the web app:

```bash
npm run dev:web
```

Run the desktop app:

```bash
npm run dev:desktop
```

Run tests:

```bash
npm test
```

## Building

```bash
npm run build:web       # Static web bundle
npm run build:desktop   # Native desktop binary for your current OS
```

Cross-platform native builds run in CI — see
[`.github/workflows/signcanvas-desktop-builds.yml`](.github/workflows/signcanvas-desktop-builds.yml).

## Releases

Pushing a git tag that starts with `v` (for example `v1.2.3`) triggers
[`release.yml`](.github/workflows/release.yml), which builds installers for
Windows, Linux, and both macOS architectures and attaches them to a **draft
GitHub Release**. Review the draft on the Releases page, then publish it.

```bash
# bump versions in:
#   apps/signcanvas-editor/package.json
#   apps/signcanvas-editor/src-tauri/tauri.conf.json
git commit -am "Release v1.2.3"
git tag v1.2.3
git push origin main --tags
```

## Documentation

- Main app setup and architecture: [`docs/TAURI_WEB_SETUP.md`](docs/TAURI_WEB_SETUP.md)
- Contributing: [`CONTRIBUTING.md`](CONTRIBUTING.md)

## Legacy app

The original Tkinter implementation lives under
[`legacy/tkinter-app`](legacy/tkinter-app). It is **archived and
unmaintained** — kept only for historical reference.

## License

[MIT](LICENSE) © Mehul Suresh
