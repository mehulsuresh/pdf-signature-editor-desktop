import tempfile
import time
from pathlib import Path
import sys

import fitz
import tkinter as tk
from PIL import Image, ImageDraw, ImageGrab

sys.path.append(str(Path(__file__).resolve().parents[1]))
import app as app_module


class Event:
    def __init__(self, x: int, y: int):
        self.x = x
        self.y = y


def make_stamp(text: str, width: int, height: int) -> Image.Image:
    image = Image.new("RGBA", (width, height), (255, 255, 255, 0))
    draw = ImageDraw.Draw(image)
    draw.line((12, height // 2, width - 12, height // 2), fill=(0, 0, 0, 255), width=5)
    draw.text((16, 14), text, fill=(0, 0, 0, 255))
    return image


def capture_window(root: tk.Tk, output_path: Path) -> None:
    root.update_idletasks()
    root.update()
    time.sleep(0.25)
    x = root.winfo_rootx()
    y = root.winfo_rooty()
    w = root.winfo_width()
    h = root.winfo_height()
    shot = ImageGrab.grab(bbox=(x, y, x + w, y + h))
    shot.save(output_path)


def main() -> None:
    screenshots_dir = Path("docs") / "screenshots"
    screenshots_dir.mkdir(parents=True, exist_ok=True)

    with tempfile.TemporaryDirectory() as temp_dir:
        sample_pdf = Path(temp_dir) / "sample.pdf"
        doc = fitz.open()
        page = doc.new_page(width=595, height=842)
        page.insert_text((72, 84), "SignCanvas PDF Demo")
        page.insert_text((72, 116), "Features: draw signature, initials, text, zoom, move, resize.")
        doc.save(sample_pdf)
        doc.close()

        root = tk.Tk()
        root.geometry("1280x900+60+40")
        app = app_module.PdfSigningApp(root)

        app.doc = fitz.open(str(sample_pdf))
        app.pdf_path = str(sample_pdf)
        app.page_index = 0
        app.stamps["signature"] = make_stamp("SIGNATURE", 360, 140)
        app.stamps["initials"] = make_stamp("INIT", 200, 100)
        app._render_page()

        app.active_tool.set("signature")
        app.on_canvas_press(Event(280, 300))
        app.active_tool.set("initials")
        app.on_canvas_press(Event(450, 480))
        app.active_tool.set("text")
        app.text_var.set("Approved by SignCanvas")
        app.text_size_var.set("18")
        app.on_canvas_press(Event(300, 650))
        app.active_tool.set("select")
        app.selected_index = 1
        app._refresh_overlays()
        capture_window(root, screenshots_dir / "main-editor.png")

        app.zoom_in()
        app.zoom_in()
        app.selected_index = 0
        app._refresh_overlays()
        capture_window(root, screenshots_dir / "zoom-and-resize.png")

        if app.doc is not None:
            app.doc.close()
        root.destroy()


if __name__ == "__main__":
    main()
