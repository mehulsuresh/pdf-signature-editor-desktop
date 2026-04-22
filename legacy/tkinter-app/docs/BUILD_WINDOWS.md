# Build Legacy Windows EXE

This guide is only for the legacy Tkinter app in [`../`](..).

## Prerequisites

- Windows 10/11
- Python 3.9+ on `PATH`

## Install Dependencies

From `legacy/tkinter-app`:

```powershell
python -m pip install -r requirements.txt
python -m pip install pyinstaller
```

## Build

```powershell
pyinstaller --noconfirm --clean --windowed --name SignCanvasPDF app.py
```

## Output

- `dist\SignCanvasPDF\SignCanvasPDF.exe`
