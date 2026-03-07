# SignCanvas PDF

Draw signatures and initials, drop them anywhere in a PDF, add text boxes, and export a clean signed copy.

## Why This App
- Fast local signing workflow
- No cloud upload required
- Precise placement with move + resize controls
- Reuses your last initials/signature size for quicker repeated signing

## Screenshots

### Main Editor
![Main editor](docs/screenshots/main-editor.png)

### Zoom + Resize Workflow
![Zoom and resize](docs/screenshots/zoom-and-resize.png)

## Features
- Open any PDF
- Draw and save `signature` and `initials`
- Place signatures/initials with one click
- Move items with drag-and-drop
- Resize signatures/initials from the bottom-right handle area
- Add text boxes with configurable size
- Zoom controls:
  - `Zoom +`, `Zoom -`, `Fit`
  - `Ctrl + Mouse Wheel`
  - `Ctrl + +`, `Ctrl + -`, `Ctrl + 0`
- Save output as a new signed PDF

## Quick Start

```powershell
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
python app.py
```

## Usage
1. Click `Open PDF`.
2. Draw your signature and initials.
3. Choose `Place Signature`, `Place Initials`, or `Place Text`.
4. Click on the page to place.
5. Switch to `Select/Move` to edit:
   - drag item to move
   - drag near bottom-right corner to resize signature/initials
   - press `Delete` to remove selected item
6. Click `Save Signed PDF`.

## Build EXE (Windows)
- Full guide: [docs/BUILD_WINDOWS.md](docs/BUILD_WINDOWS.md)

Quick command:

```powershell
python -m pip install pyinstaller
pyinstaller --noconfirm --clean --windowed --name SignCanvasPDF app.py
```

Output:
- `dist\SignCanvasPDF\SignCanvasPDF.exe`

## CI Build
- GitHub Actions workflow included: `.github/workflows/windows-build.yml`
- On every push to `main`, it builds a Windows EXE and uploads it as an artifact.

## Project Structure
- `app.py` - desktop app UI and PDF signing logic
- `requirements.txt` - runtime dependencies
- `docs/BUILD_WINDOWS.md` - EXE build instructions
- `scripts/capture_screenshots.py` - screenshot generator

## Notes
- Local stamp files are stored as `signature_stamp.png` and `initials_stamp.png` (ignored by git).
- For legal workflows, always verify final placement in the exported PDF before sharing.
