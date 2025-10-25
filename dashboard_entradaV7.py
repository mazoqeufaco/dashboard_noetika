# dashboard_entradaV3.py
import argparse
import tkinter as tk
from tkinter import ttk
from PIL import Image, ImageTk, ImageOps

# ====== CONFIG UI ======
BG_COLOR = "#000000"               # fundo preto
POINT_RADIUS = 8
FONT_LABEL = ("Segoe UI", 13, "bold")
FONT_NUM   = ("Segoe UI", 14, "bold")  # campos (Spinbox) em negrito e maiores
FONT_BTN   = ("Segoe UI", 13, "bold")  # botão Confirma maior
SPIN_INCREMENT = 0.50                  # passo das setinhas (em %)

# Vértices (top,left,right) -> canais. Seu PNG: topo=B, esquerda=R, direita=G
VERTEX_TO_CHANNEL = ("B","R","G")

# Rótulos exibidos
LABELS = {"R": "Custo", "G": "Qualidade", "B": "Prazo"}

# ------------------ Geometria/básico ------------------
def _area(x1,y1, x2,y2, x3,y3):
    return (x2 - x1)*(y3 - y1) - (x3 - x1)*(y2 - y1)

def barycentric(px, py, a, b, c):
    (x1,y1),(x2,y2),(x3,y3) = a,b,c
    denom = _area(x1,y1,x2,y2,x3,y3)
    if abs(denom) < 1e-9:
        return (0.0,0.0,0.0)
    w1 = _area(px,py,x2,y2,x3,y3) / denom    # peso do vértice 'a'
    w2 = _area(px,py,x3,y3,x1,y1) / denom    # peso do vértice 'b'
    w3 = 1.0 - w1 - w2                       # peso do vértice 'c'
    return (w1,w2,w3)

def is_inside_simplex(w1, w2, w3, tol=1e-4):
    return (w1 >= -tol) and (w2 >= -tol) and (w3 >= -tol)

def to_cartesian(w1,w2,w3, a,b,c):
    x = w1*a[0] + w2*b[0] + w3*c[0]
    y = w1*a[1] + w2*b[1] + w3*c[1]
    return (x,y)

def bary_to_rgb(w_top, w_left, w_right, vertex_to_channel):
    """(w_top, w_left, w_right) -> (r,g,b) conforme mapeamento; normaliza."""
    label_idx = {"R":0, "G":1, "B":2}
    out = [0.0, 0.0, 0.0]
    weights = [w_top, w_left, w_right]  # (top,left,right)
    for i, label in enumerate(vertex_to_channel):
        out[label_idx[label]] = weights[i]
    s = max(sum(out), 1e-12)
    return (out[0]/s, out[1]/s, out[2]/s)

# ------------------ Imagem ------------------
def load_triangle_image(path):
    img = Image.open(path).convert("RGBA")
    # Se o PNG tiver fundo branco, tornar branco -> transparente
    r,g,b,a = img.split()
    if ImageOps.invert(a).getbbox() is None:
        gray = ImageOps.grayscale(Image.merge("RGB", (r,g,b)))
        mask_white = gray.point(lambda v: 0 if v < 250 else 255)
        a = ImageOps.invert(mask_white)
        img = Image.merge("RGBA", (r,g,b,a))
    return img

def _extreme_with_band(points, key_index, choose_min=True, band_px=3):
    vals = [p[key_index] for p in points]
    extreme_val = min(vals) if choose_min else max(vals)
    band = [p for p in points if abs(p[key_index] - extreme_val) <= band_px]
    other = 1 - key_index
    if key_index == 1:  # topo: menor y -> preferir x central
        cx = sum(p[0] for p in band)/max(len(band),1)
        best = min(band, key=lambda p: abs(p[0]-cx))
    else:
        best = max(band, key=lambda p: p[1])  # base mais baixa
    return best

def detect_vertices(img, alpha_threshold=8):
    a = img.split()[-1]
    w,h = img.size
    pix = a.load()
    pts = [(x,y) for y in range(h) for x in range(w) if pix[x,y] >= alpha_threshold]
    if not pts:
        return (w//2,0),(0,h-1),(w-1,h-1)
    top    = _extreme_with_band(pts, key_index=1, choose_min=True,  band_px=2)
    left   = _extreme_with_band(pts, key_index=0, choose_min=True,  band_px=2)
    right  = _extreme_with_band(pts, key_index=0, choose_min=False, band_px=2)
    return top, left, right

# ------------------ App ------------------
class RGBTriangleApp(tk.Tk):
    def __init__(self, img_path, debug=False):
        super().__init__()
        self.title("Clique sobre o triângulo para definir sua prioridade")

        # Corrige DPI (Windows)
        try:
            self.tk.call('tk', 'scaling', 1.0)
        except Exception:
            pass

        self.debug = debug
        self.src_img_orig = load_triangle_image(img_path)

        # ---- Fit automático na tela (mantém ponta e controles à vista) ----
        scr_h = self.winfo_screenheight()
        controls_h = 190
        pad_top, pad_bottom = 10, 10
        max_canvas_h = max(300, scr_h - controls_h - 80)
        max_img_h = max_canvas_h - (pad_top + pad_bottom)

        scale = 1.0
        if self.src_img_orig.height > max_img_h:
            scale = max_img_h / self.src_img_orig.height
        new_w = int(self.src_img_orig.width * scale)
        new_h = int(self.src_img_orig.height * scale)
        self.src_img = self.src_img_orig.resize((new_w, new_h), Image.LANCZOS)

        self.canvas_pad_top = pad_top
        self.canvas_pad_bottom = pad_bottom
        self.canvas_h = new_h + pad_top + pad_bottom
        self.window_w = max(600, new_w + 40)

        self.geometry(f"{self.window_w}x{self.canvas_h + controls_h}")
        self.resizable(True, True)

        # Canvas
        self.canvas = tk.Canvas(self, width=self.window_w, height=self.canvas_h,
                                bg=BG_COLOR, highlightthickness=0)
        self.canvas.pack(side=tk.TOP, fill=tk.BOTH)

        self.img_tk = ImageTk.PhotoImage(self.src_img)
        self.img_x = (self.window_w - new_w) // 2
        self.img_y = self.canvas_pad_top
        self.canvas.create_image(self.img_x, self.img_y, image=self.img_tk, anchor="nw")

        # Vértices (na imagem já redimensionada)
        top, left, right = detect_vertices(self.src_img)
        self.V_top   = (top[0]  + self.img_x, top[1]  + self.img_y)
        self.V_left  = (left[0] + self.img_x, left[1] + self.img_y)
        self.V_right = (right[0]+ self.img_x, right[1]+ self.img_y)

        if self.debug:
            for (x,y),name in [(self.V_top,"top"),(self.V_left,"left"),(self.V_right,"right")]:
                self.canvas.create_oval(x-4,y-4,x+4,y+4, fill="#fff")
                self.canvas.create_text(x+10,y, text=name, fill="#fff", anchor="w")

        # ---------- Controles ----------
        frm = ttk.Frame(self)
        frm.pack(fill=tk.X, padx=16, pady=10)
        self.option_add("*TLabel*Font", FONT_LABEL)
        self.option_add("*Spinbox*Font", FONT_NUM)

        self.r_var = tk.StringVar(value="33.33")
        self.g_var = tk.StringVar(value="33.33")
        self.b_var = tk.StringVar(value="33.33")

        def make_box(parent, label, var, color, col):
            box = ttk.Frame(parent)
            ttk.Label(box, text=label).pack(side=tk.LEFT)
            spin = tk.Spinbox(
                box, from_=0.0, to=100.0, increment=SPIN_INCREMENT,
                textvariable=var, width=8, justify="right",
                format="%.2f", wrap=False, state="normal"
            )
            spin.pack(side=tk.LEFT, padx=8)
            ttk.Label(box, text="%").pack(side=tk.LEFT)
            sw = tk.Canvas(box, width=22, height=22, highlightthickness=1, highlightbackground="#777")
            sw.create_rectangle(1,1,21,21, fill=color, outline="")
            sw.pack(side=tk.LEFT, padx=10)
            box.grid(row=0, column=col, padx=10)
            return spin

        # Custo=R, Qualidade=G, Prazo=B
        self.spin_r = make_box(frm, LABELS["R"], self.r_var, "#ff6b6b", 0)
        self.spin_g = make_box(frm, LABELS["G"], self.g_var, "#51cf66", 1)
        self.spin_b = make_box(frm, LABELS["B"], self.b_var, "#4dabf7", 2)

        # Botão Confirma maior
        self.confirm_btn = ttk.Button(self, text="Confirma", command=self.confirm)
        self.confirm_btn.pack(pady=8)
        style = ttk.Style(self)
        style.configure("TButton", font=FONT_BTN, padding=8)

        # Estado/marcador
        self.current_rgb = (1/3, 1/3, 1/3)
        self.point_id = None
        self.update_point_from_rgb()

        # Eventos
        self.canvas.bind("<Button-1>", self.on_click)
        for sp in (self.spin_r, self.spin_g, self.spin_b):
            sp.bind("<Return>", self.on_spin_commit)
            sp.bind("<FocusOut>", self.on_spin_commit)
            sp.bind("<<Increment>>", self.on_spin_commit)
            sp.bind("<<Decrement>>", self.on_spin_commit)

    # ---------- Helpers de UI ----------
    def _read_percents(self):
        def f(s):
            try: return max(0.0, min(100.0, float(str(s).replace(",", "."))))
            except: return 0.0
        return f(self.r_var.get()), f(self.g_var.get()), f(self.b_var.get())

    def _write_percents(self, rP, gP, bP):
        self.r_var.set(f"{rP:.2f}")
        self.g_var.set(f"{gP:.2f}")
        self.b_var.set(f"{bP:.2f}")

    def _rebalance(self, focus_key, new_value):
        """
        Rebalanceia mantendo proporção dos outros dois.
        focus_key in {"R","G","B"}; new_value é em % (0..100).
        """
        rP, gP, bP = self._read_percents()
        # Normaliza base para evitar drift
        s = rP + gP + bP
        if s <= 0:
            rP = gP = bP = 33.3333
            s = 100.0
        rP, gP, bP = rP/s*100.0, gP/s*100.0, bP/s*100.0

        # Aplica novo valor ao foco
        new_value = max(0.0, min(100.0, new_value))
        if focus_key == "R":
            rem_old = gP + bP
            if rem_old <= 1e-9:
                gP = bP = (100.0 - new_value)/2.0
            else:
                scale = (100.0 - new_value) / rem_old
                gP *= scale; bP *= scale
            rP = new_value
        elif focus_key == "G":
            rem_old = rP + bP
            if rem_old <= 1e-9:
                rP = bP = (100.0 - new_value)/2.0
            else:
                scale = (100.0 - new_value) / rem_old
                rP *= scale; bP *= scale
            gP = new_value
        else:  # "B"
            rem_old = rP + gP
            if rem_old <= 1e-9:
                rP = gP = (100.0 - new_value)/2.0
            else:
                scale = (100.0 - new_value) / rem_old
                rP *= scale; gP *= scale
            bP = new_value

        # Corrige arredondamento para fechar em 100.00
        total = rP + gP + bP
        if abs(total - 100.0) > 0.001:
            # joga o erro no maior dos não-focados para estabilizar
            if focus_key != "R": rP *= 100.0/total
            if focus_key != "G": gP *= 100.0/total
            if focus_key != "B": bP *= 100.0/total

        self._write_percents(rP, gP, bP)
        # Atualiza ponto
        self.set_rgb((rP/100.0, gP/100.0, bP/100.0), update_entries=False, move_point=True)

    # ----- Eventos dos Spinbox -----
    def on_spin_commit(self, e=None):
        # Descobre qual spin disparou
        widget = e.widget if e is not None else None
        focus_key = "R" if widget is self.spin_r else ("G" if widget is self.spin_g else "B")
        rP, gP, bP = self._read_percents()
        new_val = {"R": rP, "G": gP, "B": bP}[focus_key]
        self._rebalance(focus_key, new_val)

    # ----- Evento de clique no triângulo -----
    def on_click(self, ev):
        a,b,c = self.V_top, self.V_left, self.V_right
        w_top, w_left, w_right = barycentric(ev.x, ev.y, a, b, c)

        if not is_inside_simplex(w_top, w_left, w_right):
            # Fora do triângulo → zera e não move o marcador
            self._write_percents(0.00, 0.00, 0.00)
            return

        r, g, b = bary_to_rgb(w_top, w_left, w_right, VERTEX_TO_CHANNEL)
        self.set_rgb((r, g, b), update_entries=True, move_point=True)

    # ----- Estado/UI -----
    def set_rgb(self, rgb, update_entries=False, move_point=False):
        r,g,b = rgb  # já normalizado
        self.current_rgb = (r,g,b)
        if update_entries:
            self._write_percents(r*100.0, g*100.0, b*100.0)
        if move_point:
            self.update_point_from_rgb()

    def update_point_from_rgb(self):
        a,b,c = self.V_top, self.V_left, self.V_right
        label_to_val = {"R":self.current_rgb[0], "G":self.current_rgb[1], "B":self.current_rgb[2]}
        w_top  = label_to_val[VERTEX_TO_CHANNEL[0]]
        w_left = label_to_val[VERTEX_TO_CHANNEL[1]]
        w_right= label_to_val[VERTEX_TO_CHANNEL[2]]
        x,y = to_cartesian(w_top, w_left, w_right, a, b, c)

        if self.point_id is not None:
            self.canvas.delete(self.point_id)
        self.point_id = self.canvas.create_oval(
            x-POINT_RADIUS, y-POINT_RADIUS, x+POINT_RADIUS, y+POINT_RADIUS,
            fill="#ffffff", outline="#000000", width=2
        )

    # ----- Diálogo de confirmação (Ok / Redefinir) -----
    def confirm_dialog(self, r, g, b):
        """
        Retorna True se usuário clicar Ok; False em Redefinir/fechar.
        """
        top = tk.Toplevel(self)
        top.title("Confirmar prioridades")
        top.transient(self)
        top.grab_set()
        top.resizable(False, False)

        # Mensagem formatada
        msg = (
            "Suas prioridades de seleção da solução:\n\n"
            f"{r*100:.2f}% de peso para custo anual,\n"
            f"{g*100:.2f}% de qualidade (aderência a seus requisitos) e\n"
            f"{b*100:.2f}% para prazo."
        )
        lbl = ttk.Label(top, text=msg, justify="left", font=("Segoe UI", 11))
        lbl.pack(padx=16, pady=16)

        btns = ttk.Frame(top)
        btns.pack(pady=10)

        result = {"ok": False}
        def on_ok():
            result["ok"] = True
            top.destroy()
        def on_cancel():
            result["ok"] = False
            top.destroy()

        ok_btn = ttk.Button(btns, text="Ok", command=on_ok)
        reset_btn = ttk.Button(btns, text="Redefinir", command=on_cancel)
        ok_btn.pack(side=tk.LEFT, padx=8)
        reset_btn.pack(side=tk.LEFT, padx=8)

        # tecla Enter = Ok, Esc = Redefinir
        top.bind("<Return>", lambda _e: on_ok())
        top.bind("<Escape>", lambda _e: on_cancel())

        # Centraliza sobre a janela principal
        self.update_idletasks()
        x = self.winfo_rootx() + (self.winfo_width()//2 - top.winfo_reqwidth()//2)
        y = self.winfo_rooty() + (self.winfo_height()//2 - top.winfo_reqheight()//2)
        top.geometry(f"+{x}+{y}")

        top.wait_window()
        return result["ok"]

    # ----- Botão Confirma -----
    def confirm(self):
        r,g,b = self.current_rgb
        if self.confirm_dialog(r,g,b):
            # Envia números puros (0..1) apenas se usuário confirmou
            print(f"(r,g,b) puros -> ({r:.6f}, {g:.6f}, {b:.6f})")
            try:
                self.on_confirm_next_applet(r,g,b)
            except AttributeError:
                pass
        else:
            # Usuário escolheu Redefinir — não envia
            pass

    def on_confirm_next_applet(self, r,g,b):
        # Plugue aqui (HTTP/pipe/etc.)
        pass

# ------------------ Main ------------------
if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("--img", default="triangulo rgb soma 1.png")
    p.add_argument("--debug", action="store_true")
    args = p.parse_args()
    app = RGBTriangleApp(args.img, debug=args.debug)
    app.mainloop()
