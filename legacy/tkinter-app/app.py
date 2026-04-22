import io
import tkinter as tk
from dataclasses import dataclass
from pathlib import Path
from tkinter import colorchooser, filedialog, messagebox, ttk
from typing import Optional

import fitz  # PyMuPDF
from PIL import Image, ImageChops, ImageDraw, ImageEnhance, ImageFont, ImageOps, ImageTk


@dataclass
class Placement:
    kind: str
    x0: float
    y0: float
    x1: float
    y1: float
    color: str = "#000000"
    text: str = ""
    font_size: float = 16.0


class SignaturePad(tk.Toplevel):
    def __init__(self, master: tk.Misc, title: str, width: int = 600, height: int = 220):
        super().__init__(master)
        self.title(title)
        self.resizable(False, False)
        self.grab_set()

        self._width = width
        self._height = height
        self._image = Image.new("RGBA", (width, height), (255, 255, 255, 0))
        self._draw = ImageDraw.Draw(self._image)
        self._last_x = None
        self._last_y = None
        self.result = None

        self.columnconfigure(0, weight=1)
        self.rowconfigure(1, weight=1)

        ttk.Label(
            self,
            text="Draw with your mouse. Use Clear to redraw.",
            padding=(10, 8),
        ).grid(row=0, column=0, sticky="w")

        self.canvas = tk.Canvas(self, width=width, height=height, bg="white", cursor="pencil")
        self.canvas.grid(row=1, column=0, padx=10, pady=4)
        self.canvas.bind("<ButtonPress-1>", self._start_stroke)
        self.canvas.bind("<B1-Motion>", self._draw_stroke)
        self.canvas.bind("<ButtonRelease-1>", self._end_stroke)

        button_bar = ttk.Frame(self, padding=10)
        button_bar.grid(row=2, column=0, sticky="ew")
        button_bar.columnconfigure(0, weight=1)

        ttk.Button(button_bar, text="Clear", command=self._clear).pack(side="left")
        ttk.Button(button_bar, text="Cancel", command=self._cancel).pack(side="right")
        ttk.Button(button_bar, text="Save", command=self._save).pack(side="right", padx=(0, 8))

    def _start_stroke(self, event: tk.Event) -> None:
        self._last_x = event.x
        self._last_y = event.y

    def _draw_stroke(self, event: tk.Event) -> None:
        if self._last_x is None or self._last_y is None:
            return
        self.canvas.create_line(
            self._last_x,
            self._last_y,
            event.x,
            event.y,
            fill="black",
            width=3,
            capstyle=tk.ROUND,
            smooth=True,
        )
        self._draw.line((self._last_x, self._last_y, event.x, event.y), fill=(0, 0, 0, 255), width=3)
        self._last_x = event.x
        self._last_y = event.y

    def _end_stroke(self, _event: tk.Event) -> None:
        self._last_x = None
        self._last_y = None

    def _clear(self) -> None:
        self.canvas.delete("all")
        self._image = Image.new("RGBA", (self._width, self._height), (255, 255, 255, 0))
        self._draw = ImageDraw.Draw(self._image)

    def _trim(self, image: Image.Image) -> Image.Image:
        alpha = image.getchannel("A")
        bbox = alpha.getbbox()
        if bbox is None:
            return image.crop((0, 0, 1, 1))
        return image.crop(bbox)

    def _save(self) -> None:
        trimmed = self._trim(self._image)
        if trimmed.size == (1, 1):
            messagebox.showwarning("Nothing drawn", "Please draw before saving.")
            return
        self.result = trimmed
        self.destroy()

    def _cancel(self) -> None:
        self.result = None
        self.destroy()


class TypedSignatureDialog(tk.Toplevel):
    def __init__(
        self,
        master: tk.Misc,
        font_options: dict[str, Optional[str]],
        title: str = "Typed Signature",
        default_text: str = "Your Name",
        field_label: str = "Name",
    ):
        super().__init__(master)
        self.title(title)
        self.resizable(False, False)
        self.grab_set()

        self.font_options = font_options
        self.name_var = tk.StringVar(value=default_text)
        self.style_var = tk.StringVar(value=next(iter(font_options.keys())))
        self.size_var = tk.StringVar(value="96")
        self.result = None

        frame = ttk.Frame(self, padding=12)
        frame.grid(row=0, column=0, sticky="nsew")
        frame.columnconfigure(1, weight=1)

        ttk.Label(frame, text=field_label).grid(row=0, column=0, sticky="w", padx=(0, 8), pady=(0, 6))
        ttk.Entry(frame, textvariable=self.name_var, width=32).grid(row=0, column=1, sticky="ew", pady=(0, 6))

        ttk.Label(frame, text="Style").grid(row=1, column=0, sticky="w", padx=(0, 8), pady=(0, 6))
        ttk.Combobox(
            frame,
            textvariable=self.style_var,
            state="readonly",
            values=list(font_options.keys()),
            width=28,
        ).grid(row=1, column=1, sticky="ew", pady=(0, 6))

        ttk.Label(frame, text="Font Size").grid(row=2, column=0, sticky="w", padx=(0, 8), pady=(0, 6))
        ttk.Spinbox(frame, from_=40, to=200, textvariable=self.size_var, width=8).grid(row=2, column=1, sticky="w", pady=(0, 6))

        ttk.Label(
            frame,
            text="Tip: script fonts vary by machine; use Draw Signature if you want full control.",
        ).grid(row=3, column=0, columnspan=2, sticky="w", pady=(0, 8))

        actions = ttk.Frame(frame)
        actions.grid(row=4, column=0, columnspan=2, sticky="ew")
        actions.columnconfigure(0, weight=1)
        ttk.Button(actions, text="Cancel", command=self._cancel).pack(side="right")
        ttk.Button(actions, text="Create", command=self._create).pack(side="right", padx=(0, 8))

    def _cancel(self) -> None:
        self.result = None
        self.destroy()

    def _resolve_font(self, font_path: Optional[str], font_size: int) -> ImageFont.ImageFont:
        if font_path:
            try:
                return ImageFont.truetype(font_path, font_size)
            except Exception:
                pass
        for fallback in ("arial.ttf", "segoeui.ttf", "calibri.ttf"):
            try:
                return ImageFont.truetype(fallback, font_size)
            except Exception:
                continue
        return ImageFont.load_default()

    def _create(self) -> None:
        text = self.name_var.get().strip()
        if not text:
            messagebox.showwarning("Missing Name", "Please enter text for the signature.")
            return

        try:
            font_size = int(float(self.size_var.get()))
        except ValueError:
            font_size = 96
        font_size = min(max(font_size, 40), 220)

        font_name = self.style_var.get()
        font_path = self.font_options.get(font_name)
        try:
            font = self._resolve_font(font_path, font_size)
        except Exception as exc:
            messagebox.showerror("Font Error", f"Could not use selected style:\n{exc}")
            return

        probe = Image.new("RGBA", (10, 10), (255, 255, 255, 0))
        probe_draw = ImageDraw.Draw(probe)
        bbox = probe_draw.textbbox((0, 0), text, font=font)
        if bbox is None:
            messagebox.showwarning("No Text", "Unable to create signature image from text.")
            return

        width = max(1, bbox[2] - bbox[0])
        height = max(1, bbox[3] - bbox[1])
        pad_x = max(16, width // 12)
        pad_y = max(12, height // 7)

        image = Image.new("RGBA", (width + pad_x * 2, height + pad_y * 2), (255, 255, 255, 0))
        draw = ImageDraw.Draw(image)
        draw.text((pad_x - bbox[0], pad_y - bbox[1]), text, font=font, fill=(0, 0, 0, 255))

        alpha = image.getchannel("A")
        tight_bbox = alpha.getbbox()
        self.result = image.crop(tight_bbox) if tight_bbox else image
        self.destroy()


class PdfSigningApp:
    STAMP_FILES = {
        "signature": Path("signature_stamp.png"),
        "initials": Path("initials_stamp.png"),
    }

    HANDLE_SIZE_PX = 18
    MIN_ZOOM = 0.35
    MAX_ZOOM = 4.0
    ZOOM_STEP = 1.15
    APP_TITLE = "SignCanvas PDF"
    EXPORT_STAMP_DPI = 300
    MAX_EXPORT_STAMP_DIM = 4096
    PALETTE = {
        "bg": "#F5F1E8",
        "panel": "#FCFAF6",
        "panel_alt": "#F0E7D8",
        "stroke": "#D7C8B3",
        "text": "#211A17",
        "muted": "#6D645B",
        "accent": "#B85C38",
        "accent_dark": "#954728",
        "accent_soft": "#F6DDD0",
        "canvas_bg": "#E8DED0",
        "canvas_panel": "#FFFDF9",
        "white": "#FFFFFF",
    }
    INK_COLORS = {
        "Black": "#000000",
        "Blue": "#1D4ED8",
        "Navy": "#0F172A",
        "Green": "#166534",
        "Red": "#B91C1C",
        "Purple": "#6D28D9",
        "Custom": "#000000",
    }

    def __init__(self, root: tk.Tk):
        self.root = root
        self.root.title(self.APP_TITLE)
        self.root.geometry("1400x940")
        self.root.minsize(1180, 820)
        self.root.configure(bg=self.PALETTE["bg"])

        self.pdf_path = None
        self.doc = None
        self.page_index = 0
        self.page_scale = 1.0
        self.zoom_factor = 1.0
        self.current_photo = None
        self.canvas_image_id = None

        self.page_placements = {}
        self.stamps = {"signature": None, "initials": None}
        self.last_stamp_sizes = {"signature": None, "initials": None}
        self.overlay_tk_images = []
        self.overlay_canvas_ids = []
        self.overlay_text_ids = []
        self.available_signature_fonts = self._find_signature_fonts()
        self.stamp_preview_labels = {}
        self.stamp_status_labels = {}
        self.stamp_preview_images = {}
        self.mode_buttons = {}
        self.sidebar_canvas = None
        self.sidebar_window_id = None

        self.active_tool = tk.StringVar(value="signature")
        self.last_place_tool = "signature"
        self.text_var = tk.StringVar(value="Approved")
        self.text_size_var = tk.StringVar(value="16")
        self.ink_color_name_var = tk.StringVar(value="Black")
        self.ink_color_hex = self.INK_COLORS["Black"]
        self.status_var = tk.StringVar(value="Open a PDF, then place signature/initials/text.")
        self.document_name_var = tk.StringVar(value="No PDF loaded yet")
        self.document_meta_var = tk.StringVar(value="Open a file to start placing signatures and text.")
        self.page_info_var = tk.StringVar(value="Page 0 / 0")
        self.zoom_info_var = tk.StringVar(value="Zoom 100%")
        self.selection_summary_var = tk.StringVar(value="Nothing selected yet.")

        self.selected_index: Optional[int] = None
        self.drag_mode = None
        self.drag_offset_x = 0.0
        self.drag_offset_y = 0.0
        self.selection_rect_id = None
        self.resize_handle_id = None

        self.active_tool.trace_add("write", self._on_active_tool_changed)
        self._configure_theme()
        self._build_ui()
        self._load_saved_stamps()
        self._update_document_summary()
        self._update_selection_summary()
        self._update_mode_buttons()
        self._update_ink_swatch()
        self._render_page()

    def _configure_theme(self) -> None:
        style = ttk.Style()
        try:
            style.theme_use("clam")
        except tk.TclError:
            pass

        style.configure(".", background=self.PALETTE["bg"], foreground=self.PALETTE["text"], font=("Segoe UI", 10))
        style.configure("App.TFrame", background=self.PALETTE["bg"])
        style.configure("Card.TFrame", background=self.PALETTE["panel"])
        style.configure("SidebarCard.TFrame", background=self.PALETTE["panel_alt"])
        style.configure("Inset.TFrame", background=self.PALETTE["panel"])
        style.configure(
            "Title.TLabel",
            background=self.PALETTE["panel"],
            foreground=self.PALETTE["text"],
            font=("Segoe UI Semibold", 11),
        )
        style.configure(
            "SidebarTitle.TLabel",
            background=self.PALETTE["panel_alt"],
            foreground=self.PALETTE["text"],
            font=("Segoe UI Semibold", 11),
        )
        style.configure("Body.TLabel", background=self.PALETTE["panel"], foreground=self.PALETTE["text"], font=("Segoe UI", 10))
        style.configure(
            "SidebarBody.TLabel",
            background=self.PALETTE["panel_alt"],
            foreground=self.PALETTE["text"],
            font=("Segoe UI", 10),
        )
        style.configure("Muted.TLabel", background=self.PALETTE["panel"], foreground=self.PALETTE["muted"], font=("Segoe UI", 9))
        style.configure(
            "SidebarMuted.TLabel",
            background=self.PALETTE["panel_alt"],
            foreground=self.PALETTE["muted"],
            font=("Segoe UI", 9),
        )
        style.configure(
            "Primary.TButton",
            background=self.PALETTE["accent"],
            foreground=self.PALETTE["white"],
            borderwidth=0,
            focusthickness=0,
            padding=(14, 10),
            font=("Segoe UI Semibold", 10),
        )
        style.map(
            "Primary.TButton",
            background=[("active", self.PALETTE["accent_dark"])],
            foreground=[("disabled", "#F2E8E3")],
        )
        style.configure(
            "Secondary.TButton",
            background=self.PALETTE["panel_alt"],
            foreground=self.PALETTE["text"],
            borderwidth=1,
            padding=(12, 9),
            relief="flat",
            font=("Segoe UI", 10),
        )
        style.map("Secondary.TButton", background=[("active", "#E7D8C4")])
        style.configure("Tool.TButton", background=self.PALETTE["panel"], foreground=self.PALETTE["text"], padding=(10, 8), relief="flat")
        style.map("Tool.TButton", background=[("active", "#F3E5D8")])
        style.configure(
            "TEntry",
            fieldbackground=self.PALETTE["white"],
            foreground=self.PALETTE["text"],
            bordercolor=self.PALETTE["stroke"],
            insertcolor=self.PALETTE["text"],
            padding=6,
        )
        style.configure(
            "TCombobox",
            fieldbackground=self.PALETTE["white"],
            background=self.PALETTE["white"],
            foreground=self.PALETTE["text"],
            bordercolor=self.PALETTE["stroke"],
            arrowsize=14,
            padding=5,
        )
        style.configure(
            "TSpinbox",
            fieldbackground=self.PALETTE["white"],
            foreground=self.PALETTE["text"],
            bordercolor=self.PALETTE["stroke"],
            arrowsize=14,
            padding=5,
        )

    def _make_mode_button(self, parent: tk.Misc, label: str, value: str, row: int, column: int) -> None:
        button = tk.Button(
            parent,
            text=label,
            command=lambda: self.active_tool.set(value),
            relief="flat",
            bd=0,
            cursor="hand2",
            font=("Segoe UI Semibold", 10),
            padx=14,
            pady=12,
            activeforeground=self.PALETTE["text"],
        )
        button.grid(row=row, column=column, sticky="nsew", padx=4, pady=4)
        self.mode_buttons[value] = button

    def _sync_sidebar_scrollregion(self, _event: tk.Event = None) -> None:
        if self.sidebar_canvas is None:
            return
        self.sidebar_canvas.configure(scrollregion=self.sidebar_canvas.bbox("all"))

    def _resize_sidebar_window(self, event: tk.Event) -> None:
        if self.sidebar_canvas is None or self.sidebar_window_id is None:
            return
        self.sidebar_canvas.itemconfigure(self.sidebar_window_id, width=event.width)

    def _on_sidebar_mouse_wheel(self, event: tk.Event) -> str:
        if self.sidebar_canvas is None:
            return "break"
        delta = getattr(event, "delta", 0)
        num = getattr(event, "num", 0)
        wheel_up = delta > 0 or num == 4
        wheel_down = delta < 0 or num == 5
        if wheel_up:
            self.sidebar_canvas.yview_scroll(-3, "units")
        elif wheel_down:
            self.sidebar_canvas.yview_scroll(3, "units")
        return "break"

    def _build_ui(self) -> None:
        main = ttk.Frame(self.root, style="App.TFrame", padding=18)
        main.pack(fill="both", expand=True)
        main.columnconfigure(1, weight=1)
        main.rowconfigure(0, weight=1)

        sidebar_shell = tk.Frame(main, bg=self.PALETTE["bg"], bd=0, highlightthickness=0, width=354)
        sidebar_shell.grid(row=0, column=0, sticky="nsw", padx=(0, 18))
        sidebar_shell.grid_propagate(False)
        sidebar_shell.rowconfigure(0, weight=1)
        sidebar_shell.columnconfigure(0, weight=1)

        self.sidebar_canvas = tk.Canvas(sidebar_shell, bg=self.PALETTE["bg"], width=354, highlightthickness=0, bd=0)
        self.sidebar_canvas.grid(row=0, column=0, sticky="nsew")
        sidebar_scrollbar = ttk.Scrollbar(sidebar_shell, orient="vertical", command=self.sidebar_canvas.yview)
        sidebar_scrollbar.grid(row=0, column=1, sticky="ns")
        self.sidebar_canvas.configure(yscrollcommand=sidebar_scrollbar.set)

        sidebar = ttk.Frame(self.sidebar_canvas, style="App.TFrame")
        sidebar.columnconfigure(0, weight=1)
        self.sidebar_window_id = self.sidebar_canvas.create_window((0, 0), window=sidebar, anchor="nw")
        sidebar.bind("<Configure>", self._sync_sidebar_scrollregion)
        self.sidebar_canvas.bind("<Configure>", self._resize_sidebar_window)
        self.sidebar_canvas.bind("<MouseWheel>", self._on_sidebar_mouse_wheel)
        self.sidebar_canvas.bind("<Button-4>", self._on_sidebar_mouse_wheel)
        self.sidebar_canvas.bind("<Button-5>", self._on_sidebar_mouse_wheel)

        hero = tk.Frame(sidebar, bg=self.PALETTE["accent"], bd=0, highlightthickness=0)
        hero.grid(row=0, column=0, sticky="ew", pady=(0, 14))
        tk.Label(
            hero,
            text="SignCanvas PDF",
            bg=self.PALETTE["accent"],
            fg=self.PALETTE["white"],
            font=("Georgia", 22, "bold"),
            anchor="w",
        ).pack(fill="x", padx=18, pady=(16, 4))
        tk.Label(
            hero,
            text="A warmer, calmer signing workspace for clean local PDF edits.",
            bg=self.PALETTE["accent"],
            fg="#F9EDE6",
            font=("Segoe UI", 10),
            justify="left",
            wraplength=290,
            anchor="w",
        ).pack(fill="x", padx=18, pady=(0, 14))

        document_card = ttk.Frame(sidebar, style="SidebarCard.TFrame", padding=14)
        document_card.grid(row=1, column=0, sticky="ew", pady=(0, 12))
        document_card.columnconfigure(0, weight=1)
        ttk.Label(document_card, text="Document", style="SidebarTitle.TLabel").grid(row=0, column=0, sticky="w")
        ttk.Label(
            document_card,
            textvariable=self.document_name_var,
            style="SidebarBody.TLabel",
            font=("Segoe UI Semibold", 12),
            wraplength=285,
        ).grid(row=1, column=0, sticky="ew", pady=(8, 3))
        ttk.Label(
            document_card,
            textvariable=self.document_meta_var,
            style="SidebarMuted.TLabel",
            wraplength=285,
            justify="left",
        ).grid(row=2, column=0, sticky="ew", pady=(0, 12))
        document_actions = ttk.Frame(document_card, style="SidebarCard.TFrame")
        document_actions.grid(row=3, column=0, sticky="ew")
        document_actions.columnconfigure(0, weight=1)
        document_actions.columnconfigure(1, weight=1)
        ttk.Button(document_actions, text="Open PDF", command=self.open_pdf, style="Primary.TButton").grid(row=0, column=0, sticky="ew", padx=(0, 6))
        ttk.Button(document_actions, text="Save Signed PDF", command=self.save_signed_pdf, style="Secondary.TButton").grid(row=0, column=1, sticky="ew", padx=(6, 0))

        asset_card = ttk.Frame(sidebar, style="SidebarCard.TFrame", padding=14)
        asset_card.grid(row=2, column=0, sticky="ew", pady=(0, 12))
        asset_card.columnconfigure(0, weight=1)
        ttk.Label(asset_card, text="Signature Assets", style="SidebarTitle.TLabel").grid(row=0, column=0, sticky="w")
        ttk.Label(
            asset_card,
            text="Create your signature once, then reuse it across every page.",
            style="SidebarMuted.TLabel",
            wraplength=285,
            justify="left",
        ).grid(row=1, column=0, sticky="ew", pady=(6, 12))

        for row_index, kind in enumerate(("signature", "initials"), start=2):
            item_frame = ttk.Frame(asset_card, style="Inset.TFrame", padding=10)
            item_frame.grid(row=row_index, column=0, sticky="ew", pady=(0, 10))
            item_frame.columnconfigure(1, weight=1)
            preview = tk.Label(
                item_frame,
                text="Not ready yet",
                justify="center",
                bg=self.PALETTE["white"],
                fg=self.PALETTE["muted"],
                width=16,
                height=4,
                highlightthickness=1,
                highlightbackground=self.PALETTE["stroke"],
                font=("Segoe UI", 9),
            )
            preview.grid(row=0, column=0, rowspan=3, sticky="nw", padx=(0, 12))
            title = "Signature" if kind == "signature" else "Initials"
            ttk.Label(item_frame, text=title, style="Title.TLabel").grid(row=0, column=1, sticky="w")
            status_label = ttk.Label(
                item_frame,
                text="Missing",
                style="Muted.TLabel",
                wraplength=150,
                justify="left",
            )
            status_label.grid(row=1, column=1, sticky="w", pady=(2, 10))

            button_row = ttk.Frame(item_frame, style="Card.TFrame")
            button_row.grid(row=2, column=1, sticky="ew")
            if kind == "signature":
                ttk.Button(button_row, text="Draw", command=lambda k=kind: self.draw_stamp(k), style="Tool.TButton").pack(side="left")
                ttk.Button(button_row, text="Type", command=self.type_signature, style="Tool.TButton").pack(side="left", padx=(6, 0))
                ttk.Button(button_row, text="Import", command=self.import_signature_png, style="Tool.TButton").pack(side="left", padx=(6, 0))
            else:
                ttk.Button(button_row, text="Draw", command=lambda k=kind: self.draw_stamp(k), style="Tool.TButton").pack(side="left")
                ttk.Button(button_row, text="Type", command=self.type_initials, style="Tool.TButton").pack(side="left", padx=(6, 0))

            self.stamp_preview_labels[kind] = preview
            self.stamp_status_labels[kind] = status_label

        mode_card = ttk.Frame(sidebar, style="SidebarCard.TFrame", padding=14)
        mode_card.grid(row=3, column=0, sticky="ew", pady=(0, 12))
        mode_card.columnconfigure(0, weight=1)
        ttk.Label(mode_card, text="Placement Mode", style="SidebarTitle.TLabel").grid(row=0, column=0, sticky="w")
        ttk.Label(
            mode_card,
            text="Choose what you want to place, then click directly on the page.",
            style="SidebarMuted.TLabel",
            wraplength=285,
            justify="left",
        ).grid(row=1, column=0, sticky="ew", pady=(6, 10))
        mode_grid = tk.Frame(mode_card, bg=self.PALETTE["panel_alt"], bd=0, highlightthickness=0)
        mode_grid.grid(row=2, column=0, sticky="ew")
        mode_grid.grid_columnconfigure(0, weight=1)
        mode_grid.grid_columnconfigure(1, weight=1)
        self._make_mode_button(mode_grid, "Place Signature", "signature", 0, 0)
        self._make_mode_button(mode_grid, "Place Initials", "initials", 0, 1)
        self._make_mode_button(mode_grid, "Place Text", "text", 1, 0)
        self._make_mode_button(mode_grid, "Select / Move", "select", 1, 1)

        text_card = ttk.Frame(sidebar, style="SidebarCard.TFrame", padding=14)
        text_card.grid(row=4, column=0, sticky="ew", pady=(0, 12))
        text_card.columnconfigure(0, weight=1)
        ttk.Label(text_card, text="Text And Ink", style="SidebarTitle.TLabel").grid(row=0, column=0, sticky="w", columnspan=2)
        ttk.Label(text_card, text="Text", style="SidebarMuted.TLabel").grid(row=1, column=0, sticky="w", pady=(8, 4))
        ttk.Entry(text_card, textvariable=self.text_var).grid(row=2, column=0, columnspan=2, sticky="ew")
        ttk.Label(text_card, text="Text Size", style="SidebarMuted.TLabel").grid(row=3, column=0, sticky="w", pady=(10, 4))
        ttk.Spinbox(text_card, from_=8, to=96, textvariable=self.text_size_var, width=8).grid(row=4, column=0, sticky="w")
        ttk.Label(text_card, text="Ink", style="SidebarMuted.TLabel").grid(row=5, column=0, sticky="w", pady=(12, 4))
        ink_row = ttk.Frame(text_card, style="SidebarCard.TFrame")
        ink_row.grid(row=6, column=0, columnspan=2, sticky="ew")
        ink_row.columnconfigure(1, weight=1)
        self.ink_swatch = tk.Label(
            ink_row,
            width=2,
            bg=self.ink_color_hex,
            relief="flat",
            bd=0,
            highlightthickness=1,
            highlightbackground=self.PALETTE["stroke"],
        )
        self.ink_swatch.grid(row=0, column=0, padx=(0, 8), sticky="ns")
        self.ink_color_combo = ttk.Combobox(
            ink_row,
            textvariable=self.ink_color_name_var,
            state="readonly",
            values=list(self.INK_COLORS.keys()),
            width=12,
        )
        self.ink_color_combo.grid(row=0, column=1, sticky="ew")
        self.ink_color_combo.bind("<<ComboboxSelected>>", self.on_ink_color_change)
        ttk.Button(text_card, text="Choose Custom Ink", command=self.pick_custom_ink_color, style="Secondary.TButton").grid(
            row=7, column=0, columnspan=2, sticky="ew", pady=(8, 0)
        )

        cleanup_row = ttk.Frame(text_card, style="SidebarCard.TFrame")
        cleanup_row.grid(row=8, column=0, columnspan=2, sticky="ew", pady=(12, 0))
        cleanup_row.columnconfigure(0, weight=1)
        cleanup_row.columnconfigure(1, weight=1)
        ttk.Button(cleanup_row, text="Delete Selected", command=self.delete_selected, style="Tool.TButton").grid(row=0, column=0, sticky="ew", padx=(0, 6))
        ttk.Button(cleanup_row, text="Clear This Page", command=self.clear_page_items, style="Tool.TButton").grid(row=0, column=1, sticky="ew", padx=(6, 0))

        tips_card = ttk.Frame(sidebar, style="SidebarCard.TFrame", padding=14)
        tips_card.grid(row=5, column=0, sticky="ew")
        tips_card.columnconfigure(0, weight=1)
        ttk.Label(tips_card, text="Helpful Flow", style="SidebarTitle.TLabel").grid(row=0, column=0, sticky="w")
        ttk.Label(
            tips_card,
            text="1. Open a PDF\n2. Create a signature or initials\n3. Click the page to place\n4. Switch to Select / Move to fine-tune\n5. Save a clean signed copy",
            style="SidebarMuted.TLabel",
            justify="left",
            wraplength=285,
        ).grid(row=1, column=0, sticky="ew", pady=(8, 10))
        ttk.Label(
            tips_card,
            text="Shortcuts: Delete removes the selected item. Ctrl + mouse wheel zooms. Ctrl + 0 fits the page.",
            style="SidebarMuted.TLabel",
            justify="left",
            wraplength=285,
        ).grid(row=2, column=0, sticky="ew")

        content = ttk.Frame(main, style="App.TFrame")
        content.grid(row=0, column=1, sticky="nsew")
        content.columnconfigure(0, weight=1)
        content.rowconfigure(1, weight=1)

        header_card = ttk.Frame(content, style="Card.TFrame", padding=16)
        header_card.grid(row=0, column=0, sticky="ew", pady=(0, 14))
        header_card.columnconfigure(1, weight=1)
        ttk.Label(header_card, text="Editor Workspace", style="Title.TLabel").grid(row=0, column=0, sticky="w")
        ttk.Label(
            header_card,
            text="Everything happens directly on the page: place, drag, resize, then export.",
            style="Muted.TLabel",
        ).grid(row=1, column=0, sticky="w", pady=(4, 14))

        chip_row = ttk.Frame(header_card, style="Card.TFrame")
        chip_row.grid(row=0, column=1, rowspan=2, sticky="e")
        self.page_label = tk.Label(
            chip_row,
            textvariable=self.page_info_var,
            bg=self.PALETTE["accent_soft"],
            fg=self.PALETTE["accent_dark"],
            font=("Segoe UI Semibold", 10),
            padx=12,
            pady=6,
        )
        self.page_label.pack(side="left", padx=(0, 8))
        self.zoom_label = tk.Label(
            chip_row,
            textvariable=self.zoom_info_var,
            bg="#EFE6D8",
            fg=self.PALETTE["text"],
            font=("Segoe UI Semibold", 10),
            padx=12,
            pady=6,
        )
        self.zoom_label.pack(side="left")

        controls = ttk.Frame(header_card, style="Card.TFrame")
        controls.grid(row=2, column=0, columnspan=2, sticky="ew")
        controls.columnconfigure(0, weight=1)

        controls_top = ttk.Frame(controls, style="Card.TFrame")
        controls_top.grid(row=0, column=0, sticky="w")
        ttk.Button(controls_top, text="Prev Page", command=self.prev_page, style="Secondary.TButton").pack(side="left")
        ttk.Button(controls_top, text="Next Page", command=self.next_page, style="Secondary.TButton").pack(side="left", padx=(8, 0))
        ttk.Separator(controls_top, orient="vertical").pack(side="left", fill="y", padx=12)
        ttk.Button(controls_top, text="Zoom -", command=self.zoom_out, style="Tool.TButton").pack(side="left")
        ttk.Button(controls_top, text="Zoom +", command=self.zoom_in, style="Tool.TButton").pack(side="left", padx=(6, 0))
        ttk.Button(controls_top, text="Fit Page", command=self.zoom_fit, style="Tool.TButton").pack(side="left", padx=(6, 0))

        ttk.Label(
            controls,
            textvariable=self.selection_summary_var,
            style="Muted.TLabel",
            wraplength=860,
            justify="left",
        ).grid(row=1, column=0, sticky="ew", pady=(12, 0))

        canvas_shell = ttk.Frame(content, style="Card.TFrame", padding=16)
        canvas_shell.grid(row=1, column=0, sticky="nsew")
        canvas_shell.columnconfigure(0, weight=1)
        canvas_shell.rowconfigure(2, weight=1)

        ttk.Label(
            canvas_shell,
            text="Click to place items. Drag to move them. Grab the lower-right corner of a signature or initials block to resize.",
            style="Body.TLabel",
            wraplength=900,
            justify="left",
        ).grid(row=0, column=0, sticky="ew")
        self.status_banner = tk.Label(
            canvas_shell,
            textvariable=self.status_var,
            anchor="w",
            justify="left",
            bg=self.PALETTE["accent_soft"],
            fg=self.PALETTE["text"],
            font=("Segoe UI", 10),
            padx=12,
            pady=10,
            wraplength=900,
        )
        self.status_banner.grid(row=1, column=0, sticky="ew", pady=(12, 14))

        canvas_frame = tk.Frame(
            canvas_shell,
            bg=self.PALETTE["canvas_bg"],
            bd=0,
            highlightthickness=1,
            highlightbackground=self.PALETTE["stroke"],
        )
        canvas_frame.grid(row=2, column=0, sticky="nsew")
        canvas_frame.rowconfigure(0, weight=1)
        canvas_frame.columnconfigure(0, weight=1)

        self.canvas = tk.Canvas(canvas_frame, bg=self.PALETTE["canvas_bg"], highlightthickness=0, bd=0)
        self.canvas.grid(row=0, column=0, sticky="nsew")

        ybar = ttk.Scrollbar(canvas_frame, orient="vertical", command=self.canvas.yview)
        ybar.grid(row=0, column=1, sticky="ns")
        xbar = ttk.Scrollbar(canvas_frame, orient="horizontal", command=self.canvas.xview)
        xbar.grid(row=1, column=0, sticky="ew")
        self.canvas.configure(yscrollcommand=ybar.set, xscrollcommand=xbar.set)
        self.canvas.bind("<Button-1>", self.on_canvas_press)
        self.canvas.bind("<B1-Motion>", self.on_canvas_drag)
        self.canvas.bind("<ButtonRelease-1>", self.on_canvas_release)
        self.canvas.bind("<MouseWheel>", self.on_mouse_wheel)
        self.canvas.bind("<Shift-MouseWheel>", self.on_mouse_wheel)
        self.canvas.bind("<Control-MouseWheel>", self.on_mouse_wheel)
        self.canvas.bind("<Button-4>", self.on_mouse_wheel)
        self.canvas.bind("<Button-5>", self.on_mouse_wheel)
        self.canvas.bind("<Shift-Button-4>", self.on_mouse_wheel)
        self.canvas.bind("<Shift-Button-5>", self.on_mouse_wheel)
        self.canvas.bind("<Control-Button-4>", self.on_mouse_wheel)
        self.canvas.bind("<Control-Button-5>", self.on_mouse_wheel)
        self.root.bind("<Delete>", self.delete_selected)
        self.root.bind("<Control-plus>", lambda _e: self.zoom_in())
        self.root.bind("<Control-equal>", lambda _e: self.zoom_in())
        self.root.bind("<Control-minus>", lambda _e: self.zoom_out())
        self.root.bind("<Control-0>", lambda _e: self.zoom_fit())

    def _update_mode_buttons(self) -> None:
        active_tool = self.active_tool.get()
        for value, button in self.mode_buttons.items():
            is_active = value == active_tool
            button.configure(
                bg=self.PALETTE["accent"] if is_active else self.PALETTE["white"],
                fg=self.PALETTE["white"] if is_active else self.PALETTE["text"],
                activebackground=self.PALETTE["accent_dark"] if is_active else "#F3E6D7",
            )

    def _update_document_summary(self) -> None:
        if self.doc is None or self.pdf_path is None:
            self.document_name_var.set("No PDF loaded yet")
            self.document_meta_var.set("Open a file to start placing signatures and text.")
            self.page_info_var.set("Page 0 / 0")
            self.zoom_info_var.set("Zoom 100%")
            return

        total_items = sum(len(items) for items in self.page_placements.values())
        current_items = len(self._current_page_items())
        self.document_name_var.set(Path(self.pdf_path).name)
        self.document_meta_var.set(f"{self.doc.page_count} pages | {total_items} total items | {current_items} on this page")
        self.page_info_var.set(f"Page {self.page_index + 1} / {self.doc.page_count}")
        self.zoom_info_var.set(f"Zoom {int(self.zoom_factor * 100)}%")

    def _update_ink_swatch(self) -> None:
        if hasattr(self, "ink_swatch"):
            self.ink_swatch.configure(bg=self.ink_color_hex)

    def _make_stamp_preview_image(self, stamp: Image.Image) -> Image.Image:
        preview = Image.new("RGBA", (180, 88), self.PALETTE["white"])
        draw = ImageDraw.Draw(preview)
        border = self._parse_hex_color(self.PALETTE["stroke"])
        draw.rounded_rectangle((0, 0, 179, 87), radius=16, outline=border, width=1, fill=self.PALETTE["white"])
        tinted = self._tint_stamp(stamp, self.ink_color_hex).copy()
        tinted.thumbnail((145, 56), Image.Resampling.LANCZOS)
        offset_x = (preview.width - tinted.width) // 2
        offset_y = (preview.height - tinted.height) // 2
        preview.alpha_composite(tinted, (offset_x, offset_y))
        return preview

    def _update_stamp_previews(self) -> None:
        for kind, label in self.stamp_preview_labels.items():
            stamp = self.stamps.get(kind)
            status_label = self.stamp_status_labels[kind]
            if stamp is None:
                label.configure(image="", text="Not ready yet", compound="center")
                self.stamp_preview_images[kind] = None
                hint = "Create one to unlock one-click placement."
            else:
                preview_image = ImageTk.PhotoImage(self._make_stamp_preview_image(stamp))
                self.stamp_preview_images[kind] = preview_image
                label.configure(image=preview_image, text="", compound="center")
                hint = "Saved locally and ready to place."
            status_label.configure(text=hint)

    def _update_selection_summary(self) -> None:
        if self.doc is None:
            self.selection_summary_var.set("Open a PDF to start building your signed version.")
            return

        items = self._current_page_items()
        if self.selected_index is None or not (0 <= self.selected_index < len(items)):
            self.selection_summary_var.set(f"{len(items)} item(s) on this page. Choose a mode, then click anywhere on the page.")
            return

        item = items[self.selected_index]
        width = item.x1 - item.x0
        height = item.y1 - item.y0
        label = item.kind.title()
        self.selection_summary_var.set(f"Selected {label} | {int(width)} x {int(height)} pt | drag to move or refine placement.")

    def _show_empty_state(self) -> None:
        self.root.update_idletasks()
        width = max(self.canvas.winfo_width(), 900)
        height = max(self.canvas.winfo_height(), 640)
        self.canvas.delete("all")
        self.canvas.configure(scrollregion=(0, 0, width, height))

        panel_width = min(620, width - 100)
        panel_height = 290
        x0 = (width - panel_width) / 2
        y0 = (height - panel_height) / 2
        x1 = x0 + panel_width
        y1 = y0 + panel_height

        self.canvas.create_rectangle(0, 0, width, height, fill=self.PALETTE["canvas_bg"], outline="")
        self.canvas.create_rectangle(x0, y0, x1, y1, fill=self.PALETTE["canvas_panel"], outline=self.PALETTE["stroke"], width=2)
        self.canvas.create_text(
            width / 2,
            y0 + 52,
            text="Open a PDF to begin",
            fill=self.PALETTE["text"],
            font=("Georgia", 24, "bold"),
        )
        self.canvas.create_text(
            width / 2,
            y0 + 102,
            text="This workspace is ready for signatures, initials, and approval text.\nBring in a PDF and the page will appear here.",
            fill=self.PALETTE["muted"],
            font=("Segoe UI", 12),
            justify="center",
        )
        self.canvas.create_text(
            width / 2,
            y0 + 184,
            text="Suggested flow",
            fill=self.PALETTE["accent_dark"],
            font=("Segoe UI Semibold", 12),
        )
        self.canvas.create_text(
            width / 2,
            y0 + 228,
            text="1. Open your PDF\n2. Create a signature or initials\n3. Click the page to place items\n4. Drag to adjust and save",
            fill=self.PALETTE["text"],
            font=("Segoe UI", 11),
            justify="center",
        )

    def _load_saved_stamps(self) -> None:
        for kind, path in self.STAMP_FILES.items():
            if path.exists():
                try:
                    self.stamps[kind] = Image.open(path).convert("RGBA")
                except Exception:
                    self.stamps[kind] = None
        self._set_status_for_missing_stamps()
        self._update_stamp_previews()

    def _save_stamp_to_disk(self, kind: str) -> None:
        stamp = self.stamps[kind]
        if stamp is None:
            return
        stamp.save(self.STAMP_FILES[kind], format="PNG")

    def _set_status_for_missing_stamps(self) -> None:
        missing = [k for k, v in self.stamps.items() if v is None]
        if missing:
            names = " and ".join(name.title() for name in missing)
            self.status_var.set(f"{names} not ready yet. Create them from the sidebar, then click on the page to place them.")
        else:
            self.status_var.set("Everything is ready. Choose a placement mode, click the page, then drag to fine-tune.")
        self._update_stamp_previews()

    def draw_stamp(self, kind: str) -> None:
        pad = SignaturePad(self.root, f"Draw {kind.title()}")
        self.root.wait_window(pad)
        if pad.result is None:
            return
        self.stamps[kind] = pad.result
        self._save_stamp_to_disk(kind)
        self.active_tool.set(kind)
        self.status_var.set(f"{kind.title()} saved. Click anywhere on the page to place it.")
        self._update_stamp_previews()
        self._render_page()

    def type_signature(self) -> None:
        dialog = TypedSignatureDialog(
            self.root,
            self.available_signature_fonts,
            title="Typed Signature",
            default_text="Your Name",
            field_label="Name",
        )
        self.root.wait_window(dialog)
        if dialog.result is None:
            return
        self.stamps["signature"] = dialog.result
        self._save_stamp_to_disk("signature")
        self.active_tool.set("signature")
        self.status_var.set("Typed signature saved. Click on the page to place it.")
        self._update_stamp_previews()
        self._render_page()

    def type_initials(self) -> None:
        dialog = TypedSignatureDialog(
            self.root,
            self.available_signature_fonts,
            title="Typed Initials",
            default_text="YS",
            field_label="Initials",
        )
        self.root.wait_window(dialog)
        if dialog.result is None:
            return
        self.stamps["initials"] = dialog.result
        self._save_stamp_to_disk("initials")
        self.active_tool.set("initials")
        self.status_var.set("Typed initials saved. Click on the page to place them.")
        self._update_stamp_previews()
        self._render_page()

    def import_signature_png(self) -> None:
        path = filedialog.askopenfilename(
            title="Import Signature PNG",
            filetypes=[("PNG files", "*.png"), ("Image files", "*.png;*.jpg;*.jpeg;*.webp;*.bmp"), ("All files", "*.*")],
        )
        if not path:
            return
        try:
            imported = Image.open(path).convert("RGBA")
            processed = self._process_imported_signature(imported)
        except Exception as exc:
            messagebox.showerror("Import Failed", f"Could not import signature image:\n{exc}")
            return
        if processed is None:
            messagebox.showwarning("Import Failed", "Could not detect signature strokes. Try a darker image.")
            return

        self.stamps["signature"] = processed
        self._save_stamp_to_disk("signature")
        self.active_tool.set("signature")
        self.status_var.set("Signature imported and cleaned up. Click on the page to place it.")
        self._update_stamp_previews()
        self._render_page()

    def on_ink_color_change(self, _event: tk.Event = None) -> None:
        color_name = self.ink_color_name_var.get()
        if color_name == "Custom":
            self.pick_custom_ink_color()
            return
        self.ink_color_hex = self.INK_COLORS.get(color_name, "#000000")
        self._apply_color_to_selected_item()
        self._update_ink_swatch()
        self._update_stamp_previews()
        self.status_var.set(f"Ink color set to {color_name}. New placements will use it.")

    def pick_custom_ink_color(self) -> None:
        chosen = colorchooser.askcolor(color=self.ink_color_hex, title="Choose Ink Color", parent=self.root)
        if not chosen or not chosen[1]:
            return
        self.ink_color_hex = chosen[1]
        self.ink_color_name_var.set("Custom")
        self._apply_color_to_selected_item()
        self._update_ink_swatch()
        self._update_stamp_previews()
        self.status_var.set(f"Custom ink selected: {self.ink_color_hex}")

    def _on_active_tool_changed(self, *_args) -> None:
        tool = self.active_tool.get()
        if tool in ("signature", "initials", "text"):
            self.last_place_tool = tool
        self._update_mode_buttons()
        self._update_selection_summary()

    def _find_signature_fonts(self) -> dict[str, Optional[str]]:
        fonts_dir = Path("C:/Windows/Fonts")
        candidates = {
            "Segoe Script": ["segoesc.ttf", "segoescb.ttf"],
            "Lucida Handwriting": ["lhandw.ttf"],
            "Brush Script MT": ["brushsci.ttf", "BRUSHSCI.TTF"],
            "French Script": ["FRSCRIPT.TTF", "frscript.ttf"],
            "Segoe Print": ["segoepr.ttf", "segoeprb.ttf"],
            "Calibri Italic": ["calibrii.ttf"],
            "Arial Italic": ["ariali.ttf"],
        }
        discovered: dict[str, Optional[str]] = {}
        for name, files in candidates.items():
            font_path = None
            for filename in files:
                probe = fonts_dir / filename
                if probe.exists():
                    font_path = str(probe)
                    break
            if font_path:
                discovered[name] = font_path
        discovered["System Default"] = None
        return discovered

    def _parse_hex_color(self, value: str) -> tuple[int, int, int]:
        color = value.strip().lstrip("#")
        if len(color) != 6:
            return (0, 0, 0)
        try:
            return (int(color[0:2], 16), int(color[2:4], 16), int(color[4:6], 16))
        except ValueError:
            return (0, 0, 0)

    def _fitz_color(self, color_hex: str) -> tuple[float, float, float]:
        r, g, b = self._parse_hex_color(color_hex)
        return (r / 255.0, g / 255.0, b / 255.0)

    def _process_imported_signature(self, image: Image.Image) -> Optional[Image.Image]:
        rgb = image.convert("RGB")

        # Estimate white background by taking the minimum channel, then invert to isolate ink.
        r, g, b = rgb.split()
        min_rgb = ImageChops.darker(ImageChops.darker(r, g), b)
        darkness = ImageOps.invert(min_rgb)

        # Build alpha mask from darkness with soft thresholding.
        low = 10
        scale = 255.0 / 90.0
        alpha = darkness.point(lambda p: 0 if p < low else min(255, int((p - low) * scale)))
        alpha = ImageEnhance.Contrast(alpha).enhance(1.45)

        # Boost legibility while preserving original stroke hue.
        boosted = ImageEnhance.Contrast(rgb).enhance(1.45)
        boosted = ImageEnhance.Color(boosted).enhance(1.2)
        boosted = ImageEnhance.Brightness(boosted).enhance(0.82)

        out = boosted.convert("RGBA")
        out.putalpha(alpha)

        bbox = out.getchannel("A").getbbox()
        if bbox is None:
            return None

        trimmed = out.crop(bbox)
        # Ensure tiny imports are still usable.
        if trimmed.width < 8 or trimmed.height < 8:
            return None
        return trimmed

    def _tint_stamp(self, stamp: Image.Image, color_hex: str) -> Image.Image:
        r, g, b = self._parse_hex_color(color_hex)
        alpha = stamp.getchannel("A")
        tinted = Image.new("RGBA", stamp.size, (r, g, b, 255))
        tinted.putalpha(alpha)
        return tinted

    def _apply_color_to_selected_item(self) -> None:
        if self.doc is None or self.selected_index is None:
            return
        items = self._current_page_items()
        if not (0 <= self.selected_index < len(items)):
            return
        item = items[self.selected_index]
        item.color = self.ink_color_hex
        self._refresh_overlays()

    def _sync_ink_controls_with_color(self, color_hex: str) -> None:
        normalized = color_hex.lower()
        self.ink_color_hex = normalized
        for name, value in self.INK_COLORS.items():
            if name == "Custom":
                continue
            if value.lower() == normalized:
                self.ink_color_name_var.set(name)
                self._update_ink_swatch()
                self._update_stamp_previews()
                return
        self.ink_color_name_var.set("Custom")
        self._update_ink_swatch()
        self._update_stamp_previews()

    def _close_document(self) -> None:
        if self.doc is not None:
            self.doc.close()
        self.doc = None
        self.pdf_path = None
        self.page_index = 0
        self.zoom_factor = 1.0
        self.page_scale = 1.0
        self.page_placements = {}
        self.selected_index = None
        self.drag_mode = None
        self.current_photo = None
        self.canvas_image_id = None
        self.canvas.delete("all")
        self.status_var.set("Open a PDF to start signing.")
        self._update_document_summary()
        self._update_selection_summary()
        self._show_empty_state()

    def open_pdf(self) -> None:
        path = filedialog.askopenfilename(
            title="Select PDF",
            filetypes=[("PDF files", "*.pdf"), ("All files", "*.*")],
        )
        if not path:
            return
        self._close_document()
        try:
            self.doc = fitz.open(path)
        except Exception as exc:
            messagebox.showerror("Open failed", f"Could not open PDF:\n{exc}")
            return
        if self.doc.page_count == 0:
            messagebox.showerror("Invalid PDF", "This PDF has no pages.")
            self._close_document()
            return
        self.pdf_path = path
        self.page_index = 0
        self.zoom_factor = 1.0
        self.page_placements = {}
        self.selected_index = None
        self.status_var.set("PDF loaded. Choose a placement mode and click on the page.")
        self._render_page()

    def _fit_scale_for_page(self, page_rect: fitz.Rect) -> float:
        self.root.update_idletasks()
        available_w = max(self.canvas.winfo_width() - 30, 600)
        available_h = max(self.canvas.winfo_height() - 30, 600)
        sx = available_w / page_rect.width
        sy = available_h / page_rect.height
        return min(sx, sy, 2.0)

    def _set_zoom(self, zoom_factor: float) -> None:
        clamped = min(max(zoom_factor, self.MIN_ZOOM), self.MAX_ZOOM)
        if abs(clamped - self.zoom_factor) < 0.0001:
            return
        self.zoom_factor = clamped
        self._render_page()

    def zoom_in(self) -> None:
        if self.doc is None:
            return
        self._set_zoom(self.zoom_factor * self.ZOOM_STEP)

    def zoom_out(self) -> None:
        if self.doc is None:
            return
        self._set_zoom(self.zoom_factor / self.ZOOM_STEP)

    def zoom_fit(self) -> None:
        if self.doc is None:
            return
        self._set_zoom(1.0)

    def on_mouse_wheel(self, event: tk.Event) -> str:
        if self.doc is None:
            return "break"
        # Bit mask for Control key in Tk event.state.
        ctrl_pressed = (getattr(event, "state", 0) & 0x0004) != 0
        shift_pressed = (getattr(event, "state", 0) & 0x0001) != 0
        delta = getattr(event, "delta", 0)
        num = getattr(event, "num", 0)
        wheel_up = delta > 0 or num == 4
        wheel_down = delta < 0 or num == 5

        if ctrl_pressed:
            if wheel_up:
                self.zoom_in()
            elif wheel_down:
                self.zoom_out()
            return "break"

        if shift_pressed:
            if wheel_up:
                self.canvas.xview_scroll(-1, "units")
            elif wheel_down:
                self.canvas.xview_scroll(1, "units")
            return "break"

        if wheel_up:
            self.canvas.yview_scroll(-3, "units")
        elif wheel_down:
            self.canvas.yview_scroll(3, "units")
        return "break"

    def _current_page_items(self) -> list[Placement]:
        return self.page_placements.setdefault(self.page_index, [])

    def _render_page(self) -> None:
        self.canvas.delete("all")
        self.overlay_canvas_ids.clear()
        self.overlay_tk_images.clear()
        self.overlay_text_ids.clear()
        self.selection_rect_id = None
        self.resize_handle_id = None
        self.canvas_image_id = None
        if self.doc is None:
            self._update_document_summary()
            self._update_selection_summary()
            self._show_empty_state()
            return

        page = self.doc.load_page(self.page_index)
        fit_scale = self._fit_scale_for_page(page.rect)
        self.page_scale = fit_scale * self.zoom_factor
        matrix = fitz.Matrix(self.page_scale, self.page_scale)
        pix = page.get_pixmap(matrix=matrix, alpha=False)
        mode = "RGB" if pix.n < 4 else "RGBA"
        image = Image.frombytes(mode, [pix.width, pix.height], pix.samples)
        self.current_photo = ImageTk.PhotoImage(image)

        self.canvas_image_id = self.canvas.create_image(0, 0, anchor="nw", image=self.current_photo)
        self.canvas.configure(scrollregion=(0, 0, pix.width, pix.height))
        self._update_document_summary()
        self._update_selection_summary()
        self._draw_overlays_for_page()

    def _clear_overlay_visuals(self) -> None:
        for item_id in self.overlay_canvas_ids:
            self.canvas.delete(item_id)
        self.overlay_canvas_ids.clear()
        self.overlay_tk_images.clear()
        self.overlay_text_ids.clear()
        if self.selection_rect_id is not None:
            self.canvas.delete(self.selection_rect_id)
            self.selection_rect_id = None
        if self.resize_handle_id is not None:
            self.canvas.delete(self.resize_handle_id)
            self.resize_handle_id = None

    def _refresh_overlays(self) -> None:
        if self.doc is None or self.canvas_image_id is None:
            return
        self._clear_overlay_visuals()
        self._draw_overlays_for_page()
        self._update_document_summary()
        self._update_selection_summary()

    def _draw_overlays_for_page(self) -> None:
        items = self._current_page_items()
        if self.selected_index is not None and not (0 <= self.selected_index < len(items)):
            self.selected_index = None

        for idx, placement in enumerate(items):
            x0 = placement.x0 * self.page_scale
            y0 = placement.y0 * self.page_scale
            x1 = placement.x1 * self.page_scale
            y1 = placement.y1 * self.page_scale

            if placement.kind in ("signature", "initials"):
                stamp = self.stamps.get(placement.kind)
                if stamp is None:
                    continue
                tinted_stamp = self._tint_stamp(stamp, placement.color)
                display_stamp = tinted_stamp.resize((max(1, int(x1 - x0)), max(1, int(y1 - y0))), Image.Resampling.LANCZOS)
                tk_stamp = ImageTk.PhotoImage(display_stamp)
                self.overlay_tk_images.append(tk_stamp)
                image_id = self.canvas.create_image(x0, y0, anchor="nw", image=tk_stamp)
                self.overlay_canvas_ids.append(image_id)
            else:
                display_font_size = max(8, int(placement.font_size * self.page_scale))
                text_id = self.canvas.create_text(
                    x0,
                    y0,
                    anchor="nw",
                    text=placement.text,
                    fill=placement.color,
                    font=("Arial", display_font_size),
                )
                self.overlay_text_ids.append(text_id)
                self.overlay_canvas_ids.append(text_id)

            if idx == self.selected_index:
                self.selection_rect_id = self.canvas.create_rectangle(
                    x0,
                    y0,
                    x1,
                    y1,
                    outline=self.PALETTE["accent"],
                    width=2,
                    dash=(4, 3),
                )
                self.overlay_canvas_ids.append(self.selection_rect_id)
                if placement.kind in ("signature", "initials"):
                    hs = self.HANDLE_SIZE_PX / 2
                    self.resize_handle_id = self.canvas.create_rectangle(
                        x1 - hs,
                        y1 - hs,
                        x1 + hs,
                        y1 + hs,
                        fill=self.PALETTE["accent"],
                        outline=self.PALETTE["accent_dark"],
                        width=1,
                    )
                    self.overlay_canvas_ids.append(self.resize_handle_id)

    def _canvas_to_pdf(self, event: tk.Event) -> tuple[float, float]:
        return self.canvas.canvasx(event.x) / self.page_scale, self.canvas.canvasy(event.y) / self.page_scale

    def _point_inside_page(self, x_pdf: float, y_pdf: float) -> bool:
        if self.doc is None:
            return False
        rect = self.doc.load_page(self.page_index).rect
        return rect.x0 <= x_pdf <= rect.x1 and rect.y0 <= y_pdf <= rect.y1

    def _hit_test(self, x_pdf: float, y_pdf: float) -> Optional[int]:
        items = self._current_page_items()
        for idx in range(len(items) - 1, -1, -1):
            p = items[idx]
            if p.x0 <= x_pdf <= p.x1 and p.y0 <= y_pdf <= p.y1:
                return idx
        return None

    def _over_resize_handle(self, placement: Placement, x_pdf: float, y_pdf: float) -> bool:
        width = max(1e-6, placement.x1 - placement.x0)
        height = max(1e-6, placement.y1 - placement.y0)
        tol = max(10.0, (self.HANDLE_SIZE_PX * 1.25) / self.page_scale)
        on_handle = (placement.x1 - tol) <= x_pdf <= (placement.x1 + tol) and (placement.y1 - tol) <= y_pdf <= (placement.y1 + tol)
        in_corner_zone = x_pdf >= (placement.x0 + width * 0.6) and y_pdf >= (placement.y0 + height * 0.6)
        return on_handle or in_corner_zone

    def _make_default_rect(self, page_rect: fitz.Rect, click_x_pdf: float, click_y_pdf: float, kind: str) -> fitz.Rect:
        stamp = self.stamps[kind]
        aspect = stamp.height / max(1, stamp.width)

        cached_size = self.last_stamp_sizes.get(kind)
        if cached_size is not None:
            width, height = cached_size
            scale_to_fit = min(
                1.0,
                (page_rect.width * 0.95) / max(width, 1e-6),
                (page_rect.height * 0.95) / max(height, 1e-6),
            )
            width *= scale_to_fit
            height *= scale_to_fit
        else:
            width = page_rect.width * (0.28 if kind == "signature" else 0.16)
            height = width * aspect

        x0 = max(page_rect.x0, min(click_x_pdf - width / 2, page_rect.x1 - width))
        y0 = max(page_rect.y0, min(click_y_pdf - height / 2, page_rect.y1 - height))
        return fitz.Rect(x0, y0, x0 + width, y0 + height)

    def _make_text_rect(self, page_rect: fitz.Rect, click_x_pdf: float, click_y_pdf: float, text: str, font_size: float) -> fitz.Rect:
        width = max(page_rect.width * 0.10, (font_size * 0.55 * max(1, len(text))) + 18)
        height = max(font_size * 1.6, 20)
        x0 = max(page_rect.x0, min(click_x_pdf - width / 2, page_rect.x1 - width))
        y0 = max(page_rect.y0, min(click_y_pdf - height / 2, page_rect.y1 - height))
        return fitz.Rect(x0, y0, x0 + width, y0 + height)

    def _place_active_item(self, x_pdf: float, y_pdf: float) -> None:
        if self.doc is None:
            return
        page_rect = self.doc.load_page(self.page_index).rect
        tool = self.active_tool.get()
        items = self._current_page_items()

        if tool in ("signature", "initials"):
            stamp = self.stamps.get(tool)
            if stamp is None:
                self.status_var.set(f"{tool.title()} is not ready yet. Create it from the sidebar first.")
                return
            rect = self._make_default_rect(page_rect, x_pdf, y_pdf, tool)
            items.append(
                Placement(
                    kind=tool,
                    x0=rect.x0,
                    y0=rect.y0,
                    x1=rect.x1,
                    y1=rect.y1,
                    color=self.ink_color_hex,
                )
            )
            self.last_stamp_sizes[tool] = (rect.width, rect.height)
            self.selected_index = len(items) - 1
            self.status_var.set(f"{tool.title()} placed. Drag it to move, or use the lower-right handle to resize.")
            self.active_tool.set("select")
            self._refresh_overlays()
            return

        if tool == "text":
            text = self.text_var.get().strip()
            if not text:
                self.status_var.set("Add some text in the sidebar before placing a text box.")
                return
            try:
                font_size = float(self.text_size_var.get())
            except ValueError:
                font_size = 16.0
                self.text_size_var.set("16")
            font_size = min(max(font_size, 8.0), 96.0)
            rect = self._make_text_rect(page_rect, x_pdf, y_pdf, text, font_size)
            items.append(
                Placement(
                    kind="text",
                    x0=rect.x0,
                    y0=rect.y0,
                    x1=rect.x1,
                    y1=rect.y1,
                    color=self.ink_color_hex,
                    text=text,
                    font_size=font_size,
                )
            )
            self.selected_index = len(items) - 1
            self.status_var.set("Text placed. Drag it to the perfect spot.")
            self.active_tool.set("select")
            self._refresh_overlays()

    def on_canvas_press(self, event: tk.Event) -> None:
        if self.doc is None:
            self.status_var.set("Open a PDF first, then this canvas becomes interactive.")
            return
        x_pdf, y_pdf = self._canvas_to_pdf(event)
        if not self._point_inside_page(x_pdf, y_pdf):
            return

        tool = self.active_tool.get()
        if tool != "select":
            self.drag_mode = None
            self._place_active_item(x_pdf, y_pdf)
            return

        hit_idx = self._hit_test(x_pdf, y_pdf)
        self.selected_index = hit_idx
        self.drag_mode = None
        if hit_idx is not None:
            item = self._current_page_items()[hit_idx]
            self._sync_ink_controls_with_color(item.color)
            if item.kind in ("signature", "initials") and self._over_resize_handle(item, x_pdf, y_pdf):
                self.drag_mode = "resize"
                self.status_var.set("Resizing the selected stamp.")
            else:
                self.drag_mode = "move"
                self.drag_offset_x = x_pdf - item.x0
                self.drag_offset_y = y_pdf - item.y0
                self.status_var.set("Moving the selected item.")
        else:
            self.status_var.set("Nothing selected. Click an item to edit it, or choose a placement mode.")
        self._refresh_overlays()

    def on_canvas_drag(self, event: tk.Event) -> None:
        if self.doc is None or self.selected_index is None or self.drag_mode is None:
            return
        items = self._current_page_items()
        if not (0 <= self.selected_index < len(items)):
            return
        x_pdf, y_pdf = self._canvas_to_pdf(event)
        page_rect = self.doc.load_page(self.page_index).rect
        placement = items[self.selected_index]

        if self.drag_mode == "move":
            width = placement.x1 - placement.x0
            height = placement.y1 - placement.y0
            new_x0 = min(max(page_rect.x0, x_pdf - self.drag_offset_x), page_rect.x1 - width)
            new_y0 = min(max(page_rect.y0, y_pdf - self.drag_offset_y), page_rect.y1 - height)
            placement.x0 = new_x0
            placement.y0 = new_y0
            placement.x1 = new_x0 + width
            placement.y1 = new_y0 + height
            self._refresh_overlays()
            return

        if self.drag_mode == "resize" and placement.kind in ("signature", "initials"):
            min_width = page_rect.width * 0.03
            aspect = (placement.y1 - placement.y0) / max(1e-6, placement.x1 - placement.x0)
            target_w = max(min_width, x_pdf - placement.x0)
            target_h = max(min_width * aspect, y_pdf - placement.y0)
            new_w = max(target_w, target_h / max(aspect, 1e-6))
            new_h = new_w * aspect

            max_w = page_rect.x1 - placement.x0
            max_h = page_rect.y1 - placement.y0
            if new_w > max_w:
                new_w = max_w
                new_h = new_w * aspect
            if new_h > max_h:
                new_h = max_h
                new_w = new_h / max(aspect, 1e-6)

            placement.x1 = placement.x0 + max(min_width, new_w)
            placement.y1 = placement.y0 + max(min_width * aspect, new_h)
            self._refresh_overlays()

    def on_canvas_release(self, _event: tk.Event) -> None:
        if self.drag_mode == "resize" and self.selected_index is not None:
            items = self._current_page_items()
            if 0 <= self.selected_index < len(items):
                item = items[self.selected_index]
                if item.kind in ("signature", "initials"):
                    self.last_stamp_sizes[item.kind] = (item.x1 - item.x0, item.y1 - item.y0)
        self.drag_mode = None

    def delete_selected(self, _event: tk.Event = None) -> None:
        if self.doc is None or self.selected_index is None:
            return
        items = self._current_page_items()
        if 0 <= self.selected_index < len(items):
            del items[self.selected_index]
            self.selected_index = None
            self.status_var.set("Selected item deleted.")
            self._refresh_overlays()

    def clear_page_items(self) -> None:
        if self.doc is None:
            return
        self.page_placements[self.page_index] = []
        self.selected_index = None
        self.status_var.set("Cleared all items from the current page.")
        self._refresh_overlays()

    def prev_page(self) -> None:
        if self.doc is None:
            return
        if self.page_index > 0:
            if self.active_tool.get() == "select":
                self.active_tool.set(self.last_place_tool)
            self.page_index -= 1
            self.selected_index = None
            self.drag_mode = None
            self._render_page()

    def next_page(self) -> None:
        if self.doc is None:
            return
        if self.page_index < self.doc.page_count - 1:
            if self.active_tool.get() == "select":
                self.active_tool.set(self.last_place_tool)
            self.page_index += 1
            self.selected_index = None
            self.drag_mode = None
            self._render_page()

    def _stamp_to_png_bytes(self, stamp: Image.Image, placement: Placement) -> bytes:
        # Convert PDF points to export pixels at higher DPI for sharper output.
        px_per_point = self.EXPORT_STAMP_DPI / 72.0
        width = max(1, int((placement.x1 - placement.x0) * px_per_point))
        height = max(1, int((placement.y1 - placement.y0) * px_per_point))

        # Prevent runaway memory usage for very large placements.
        scale_limit = min(
            1.0,
            self.MAX_EXPORT_STAMP_DIM / max(width, 1),
            self.MAX_EXPORT_STAMP_DIM / max(height, 1),
        )
        if scale_limit < 1.0:
            width = max(1, int(width * scale_limit))
            height = max(1, int(height * scale_limit))

        tinted = self._tint_stamp(stamp, placement.color)
        resized = tinted.resize((width, height), Image.Resampling.LANCZOS)
        output = io.BytesIO()
        resized.save(output, format="PNG")
        return output.getvalue()

    def save_signed_pdf(self) -> None:
        if self.doc is None or self.pdf_path is None:
            messagebox.showwarning("No PDF", "Open a PDF first.")
            return
        save_path = filedialog.asksaveasfilename(
            title="Save Signed PDF",
            defaultextension=".pdf",
            filetypes=[("PDF files", "*.pdf")],
            initialfile=f"{Path(self.pdf_path).stem}_signed.pdf",
        )
        if not save_path:
            return

        try:
            signed_doc = fitz.open(self.pdf_path)
            for page_idx, items in self.page_placements.items():
                if not items:
                    continue
                page = signed_doc.load_page(page_idx)
                for item in items:
                    rect = fitz.Rect(item.x0, item.y0, item.x1, item.y1)
                    if item.kind in ("signature", "initials"):
                        stamp = self.stamps.get(item.kind)
                        if stamp is None:
                            continue
                        png_bytes = self._stamp_to_png_bytes(stamp, item)
                        page.insert_image(
                            rect,
                            stream=png_bytes,
                            overlay=True,
                            keep_proportion=False,
                        )
                    elif item.kind == "text":
                        page.insert_text(
                            fitz.Point(item.x0, item.y0 + item.font_size),
                            item.text,
                            fontsize=item.font_size,
                            fontname="helv",
                            color=self._fitz_color(item.color),
                        )

            signed_doc.save(save_path, deflate=True)
            signed_doc.close()
        except Exception as exc:
            messagebox.showerror("Save failed", f"Could not save signed PDF:\n{exc}")
            return

        self.status_var.set(f"Signed PDF saved to {save_path}")
        messagebox.showinfo("Success", f"Saved signed PDF:\n{save_path}")


def main() -> None:
    app_root = tk.Tk()
    PdfSigningApp(app_root)
    app_root.mainloop()


if __name__ == "__main__":
    main()
