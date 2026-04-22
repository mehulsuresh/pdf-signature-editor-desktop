# SignCanvas Tauri + Web Setup

The primary SignCanvas product lives at `apps/signcanvas-editor/` and is built with `Tauri + React + TypeScript + Tailwind`.

The original Python app now lives in `legacy/tkinter-app/` and remains available as a migration/reference implementation. The new editor is intended to run both:

- in the browser through Vite
- as a desktop app through Tauri

## Required Tooling

- Node.js 22 LTS
- Rust stable toolchain
- Tauri desktop prerequisites for your platform

Windows install commands that worked in this workspace:

```powershell
winget install OpenJS.NodeJS.LTS
winget install Rustlang.Rustup
rustup default stable
```

If PowerShell blocks `npm.ps1`, use the `cmd` shim instead:

```powershell
npm.cmd run build:web
```

## Workspace Layout

```text
apps/
  signcanvas-editor/
    src/          React editor
    src-tauri/    Tauri shell
```

## Install Dependencies

From the repo root:

```powershell
npm.cmd install
```

## Development

Run the web app:

```powershell
npm.cmd run dev:web
```

Run the desktop app:

```powershell
npm.cmd run dev:desktop
```

## Production Builds

Web build:

```powershell
npm.cmd run build:web
```

Desktop build:

```powershell
npm.cmd run build:desktop
```

The desktop executable and installer output are created under:

```text
apps/signcanvas-editor/src-tauri/target/release/
apps/signcanvas-editor/src-tauri/target/release/bundle/
```

## Cross-Platform Desktop Builds

Windows desktop builds can be created locally from this machine.

macOS and Ubuntu desktop bundles are now configured through GitHub Actions in:

```text
.github/workflows/signcanvas-desktop-builds.yml
```

That workflow runs native builds on:

- `windows-latest`
- `ubuntu-22.04`
- `macos-latest` for Apple Silicon and Intel macOS targets

Artifacts are uploaded from each runner, so the easiest way to get Mac and Linux bundles is to trigger the workflow from GitHub and download the produced artifacts.

## Current Architecture

- `pdf.js` renders the current PDF page into the editor stage.
- A React overlay layer handles selection, dragging, and resizing.
- `pdf-lib` writes signatures and text back into a new exported PDF.
- Signature assets are stored locally:
  - browser: IndexedDB through `localforage`
  - desktop: Tauri app data directory

## Current Scripts

From the repo root:

- `npm.cmd run dev:web`
- `npm.cmd run dev:desktop`
- `npm.cmd run build:web`
- `npm.cmd run build:desktop`
- `npm.cmd run test:web`

## Notes

- The editor is designed around page-at-a-time editing in v1.
- Signature cleanup and tinting are handled in JavaScript with canvas processing.
- The Tauri app currently keeps document logic in the shared web code; Rust is only the desktop shell for now.
