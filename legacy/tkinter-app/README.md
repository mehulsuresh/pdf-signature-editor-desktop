# Legacy Tkinter App (Archived)

> **Status: archived, unmaintained.**
> This is the original Windows-first Tkinter + Python implementation of
> SignCanvas. It is preserved here for reference and historical comparison
> only. **No new features, bug fixes, or support.**
>
> The actively developed product lives in
> [`apps/signcanvas-editor`](../../apps/signcanvas-editor) and is what you
> almost certainly want.

## Why it's still here

- Parity reference while the Tauri/React rewrite matures
- Reproducible old Windows builds for anyone who depended on them
- Historical record of how SignCanvas started

## Running it (at your own risk)

```bash
python -m venv .venv

# Windows:
.venv\Scripts\activate
# macOS / Linux:
source .venv/bin/activate

pip install -r requirements.txt
python app.py
```

## Building the Windows binary

See [`docs/BUILD_WINDOWS.md`](docs/BUILD_WINDOWS.md).
