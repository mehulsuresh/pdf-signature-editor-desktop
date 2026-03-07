# Build Windows EXE

## Prerequisites
- Windows 10/11
- Python 3.9+ installed and on PATH

## Install Dependencies

```powershell
python -m pip install -r requirements.txt
python -m pip install pyinstaller
```

## Build

```powershell
pyinstaller --noconfirm --clean --windowed --name SignCanvasPDF app.py
```

## Output

- Executable: `dist\SignCanvasPDF\SignCanvasPDF.exe`

## Optional Portable Zip

```powershell
Compress-Archive -Path .\dist\SignCanvasPDF\* -DestinationPath .\dist\SignCanvasPDF-win64.zip -Force
```
