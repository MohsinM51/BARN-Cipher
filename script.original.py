import tkinter as tk
from tkinter import ttk, messagebox
import textwrap, secrets

# ==============================
# Utilities: text/bit conversions
# ==============================

def text_to_bytes(s: str) -> list[int]:
    return list(s.encode("utf-8"))

def bytes_to_bits(byte_list: list[int]) -> list[int]:
    bits = []
    for b in byte_list:
        for k in range(7, -1, -1):
            bits.append((b >> k) & 1)
    return bits

def bits_to_text(bits: list[int], nbytes: int) -> str:
    usable = bits[: nbytes * 8]
    out = bytearray()
    for i in range(0, len(usable), 8):
        byte = 0
        for k in range(8):
            byte = (byte << 1) | usable[i + k]
        out.append(byte)
    try:
        return out.decode("utf-8", errors="strict")
    except UnicodeDecodeError:
        return out.decode("utf-8", errors="replace")

def parse_key(s: str) -> list[int]:
    msg = "Key must be a comma-separated list of positive integers (e.g., 1,3,2,1)."
    parts = [p.strip() for p in s.split(",") if p.strip() != ""]
    try:
        K = [int(p) for p in parts]
    except ValueError:
        raise ValueError(msg) from None
    if not K or any(k <= 0 for k in K):
        raise ValueError(msg)
    if all(k == 1 for k in K):
        # Paper, Sec. 3: an all-ones key copies the message into consecutive bits.
        raise ValueError("A key of only 1s hides nothing — the message would be copied "
                         "straight into the stream. Use at least one number greater than 1.")
    return K

def char_utf8_bits(ch: str) -> list[str]:
    """8-bit strings for each UTF-8 byte of one character (ASCII = 1 byte)."""
    return [format(b, "08b") for b in ch.encode("utf-8")]

# ===========================
# BARN position plan functions
# ===========================

def positions_for(mu: int, K: list[int]) -> list[int]:
    """
    Compute 0-based positions where each of the mu message bits will be inserted/read.
    pos starts at -1 so that first hop of K[0] lands at index K[0]-1.
    """
    if mu == 0:
        return []
    pos = -1
    plan = []
    k_idx = 0
    for j in range(mu):
        pos += K[k_idx]
        plan.append(pos)
        k_idx = (k_idx + 1) % len(K)
    return plan  # 0-based positions

def stream_length_for(mu: int, K: list[int]) -> int:
    plan = positions_for(mu, K)
    return (plan[-1] + 1) if plan else 0

# =================================
# Visual helpers for the bit display
# =================================

def build_ruler(n: int, line_width: int = 64) -> str:
    """
    Create a simple index ruler: 0..63, 64..127 etc.
    """
    parts = []
    for start in range(0, n, line_width):
        end = min(n, start + line_width)
        parts.append(f"{start:>4}..{end-1:<4}")
    return "\n".join(parts)

def render_bits(text_widget: tk.Text, bits: list[int],
                processed_idx: set[int], current_idx: int|None,
                line_width: int = 64):
    """
    Show bits in fixed-width lines, underline processed indices, highlight current.
    """
    text_widget.config(state="normal")
    text_widget.delete("1.0", "end")

    bit_str = "".join(str(b) for b in bits)
    lines = textwrap.wrap(bit_str, line_width)

    # Insert and remember index mapping: logical bit idx -> (line, column)
    coords = []
    for ln, chunk in enumerate(lines, start=1):
        text_widget.insert("end", chunk + "\n")
        for c, _ in enumerate(chunk):
            coords.append((ln, c))

    # Configure tags
    text_widget.tag_configure("processed", underline=1)
    text_widget.tag_configure("current", background="yellow")

    # Apply processed underlines
    for idx in processed_idx:
        if 0 <= idx < len(coords):
            ln, col = coords[idx]
            text_widget.tag_add("processed", f"{ln}.{col}", f"{ln}.{col+1}")

    # Apply current highlight
    if current_idx is not None and 0 <= current_idx < len(coords):
        ln, col = coords[current_idx]
        text_widget.tag_add("current", f"{ln}.{col}", f"{ln}.{col+1}")

    text_widget.config(state="disabled")

# ==================
# Step data structure
# ==================

class Step:
    """
    A single 'teaching' step.
    - title: short heading
    - narration: rich, multi-line explanation for the right panel
    - render: a callable(app) -> None that draws the left panel state for this step
    - undo: a callable() to reverse one encryption/decryption action if needed
    """
    def __init__(self, title, narration, render, undo=None):
        self.title = title
        self.narration = narration
        self.render = render
        self.undo = undo

# =======================
# Controllers (teach mode)
# =======================

class EncryptTeach:
    def __init__(self, app, plaintext: str, key_str: str):
        self.app = app
        self.plaintext = plaintext
        self.key = parse_key(key_str)
        self.bytes = text_to_bytes(plaintext)
        self.msg_bits = bytes_to_bits(self.bytes)
        self.mu = len(self.msg_bits)
        self.plan = positions_for(self.mu, self.key)
        self.P_len = stream_length_for(self.mu, self.key)
        random.seed(42)  # deterministic demo; remove to vary
        self.stream = [random.getrandbits(1) for _ in range(self.P_len)]

        # Teaching state
        self.processed = set()   # indices inserted so far
        self.snapshots = []      # stack of (stream_copy, processed_copy, step_idx) for undo
        self.steps = self._build_steps()
        self.idx = 0

        self.app.set_mode("ENCRYPT – Teaching Mode")
        self._go_to(0)

    # ---- steps ----
    def _build_steps(self) -> list[Step]:
        steps: list[Step] = []

        # Phase A: Characters
        steps.append(Step(
            "Start: Plaintext selected",
            f"We will encrypt the plaintext:\n\n  {self.plaintext!r}\n\n"
            "We’ll break it down character by character, convert to ASCII codes, then to 8-bit binary.",
            lambda a: self._render_intro()
        ))

        for i, ch in enumerate(self.plaintext):
            ascii_code = ord(ch)
            steps.append(Step(
                f"Character {i+1}: {ch!r}",
                f"Character {i+1}: {ch!r}\nASCII (decimal): {ascii_code}\nASCII (hex): 0x{ascii_code:02X}",
                lambda a, c=ch: self._render_char(c)
            ))

        # Phase B: Bytes->Bits per character
        running_bits = []
        for i, b in enumerate(self.bytes):
            bbits = [(b >> k) & 1 for k in range(7, -1, -1)]
            running_bits += bbits
            steps.append(Step(
                f"Byte {i+1}: 0x{b:02X} → bits",
                "Each character is one byte (8 bits). We show its 8-bit representation and "
                "append it to the full message bitstring.",
                lambda a, bits=running_bits.copy(): self._render_message_bits(bits)
            ))

        # Phase C: Key & Plan
        steps.append(Step(
            "Key parsed",
            f"Key K = {self.key}\n\n"
            "BARN rule (encryption): start at index -1, then for each message bit j,\n"
            "advance by the next key element and insert at that new index.\n"
            "We will compute these target positions one by one.",
            lambda a: self._render_plan(None)
        ))

        pos = -1
        k_idx = 0
        for j in range(self.mu):
            hop = self.key[k_idx]
            new_pos = pos + hop
            steps.append(Step(
                f"Plan step {j+1}/{self.mu}: advance by K[{k_idx}]={hop}",
                f"Planning where to place message bit #{j}:\n"
                f"  previous index = {pos}\n"
                f"  hop by K[{k_idx}] = {hop}\n"
                f"  target index i = {new_pos}\n"
                "We’ll highlight this index when inserting.",
                lambda a, cur=new_pos: self._render_plan(cur)
            ))
            pos = new_pos
            k_idx = (k_idx + 1) % len(self.key)

        # Phase D: Encryption steps (inserting bits)
        steps.append(Step(
            "Random stream prepared",
            f"We generated a random stream P of length {self.P_len}.\n"
            "We will now insert each message bit at its planned position (underline = done, yellow = current).",
            lambda a: self._render_stream(None)
        ))

        for j in range(self.mu):
            idx = self.plan[j]
            bit = self.msg_bits[j]

            def do_render(app, i=idx, b=bit, jidx=j):
                self._snapshot()
                # Place/overwrite
                self.stream[i] = b
                self.processed.add(i)
                self._render_stream(i)
                self._narrate(
                    f"Encryption step {jidx+1}/{self.mu}\n"
                    f"Message bit M[{jidx}] = {b}\n"
                    f"Use K[{jidx % len(self.key)}] = {self.key[jidx % len(self.key)]} to land at index i = {i}\n"
                    f"Replace P[i] with M[{jidx}] → underline shows written positions; yellow marks current index."
                )

            def undo():
                # revert to snapshot
                self._restore_snapshot()

            steps.append(Step(
                f"Encrypt insert {j+1}/{self.mu} at i={idx}",
                f"Inserting message bit at position i={idx}.",
                do_render, undo=undo
            ))

        # Phase E: Final cipher
        steps.append(Step(
            "Encryption complete",
            "All bits inserted. The result is the cipher stream below. "
            "Copy it (0/1 string) and the original plaintext length (bytes) to decrypt.",
            lambda a: self._render_stream(None)
        ))

        return steps

    # ---- rendering helpers ----
    def _render_intro(self):
        self._narrate(
            "Goal: Teach the BARN encryption.\n"
            "1) Split plaintext into characters\n"
            "2) Convert to ASCII and then 8-bit binary\n"
            "3) Show BARN key hops and target indices\n"
            "4) Insert bits step-by-step into the random stream"
        )
        self._update_context()
        self._render_empty_stream()

    def _render_char(self, ch: str):
        b = ord(ch)
        bits = [(b >> k) & 1 for k in range(7, -1, -1)]
        self._narrate(
            f"Character: {ch!r}\n"
            f"ASCII decimal: {b}\n"
            f"ASCII hex: 0x{b:02X}\n"
            f"8-bit binary: {''.join(str(x) for x in bits)}"
        )
        self._render_empty_stream()

    def _render_message_bits(self, bits: list[int]):
        msg = "".join(str(x) for x in bits)
        self._narrate(
            "Accumulated message bits so far:\n"
            + " ".join([msg[i:i+8] for i in range(0, len(msg), 8)])
        )
        self._render_empty_stream()

    def _render_plan(self, current: int|None):
        self._update_context()
        fake = [0]*(self.P_len if self.P_len else max(self.plan[-1]+1 if self.plan else 1, 1))
        processed = set()  # only planning, nothing written
        self.app.ruler_var.set(build_ruler(len(fake)))
        render_bits(self.app.bits_text, fake, processed, current)
        # Legend kept

    def _render_stream(self, current: int|None):
        self._update_context()
        self.app.ruler_var.set(build_ruler(len(self.stream)))
        render_bits(self.app.bits_text, self.stream, self.processed, current)

    def _render_empty_stream(self):
        # before stream exists or for neutral screens
        n = max(self.P_len, 1)
        self.app.ruler_var.set(build_ruler(n))
        render_bits(self.app.bits_text, [0]*n, set(), None)

    def _update_context(self):
        self.app.ctx_key_var.set(str(self.key))
        self.app.ctx_mu_var.set(str(self.mu))
        self.app.ctx_streamlen_var.set(str(self.P_len))
        self.app.cipher_var.set("".join(str(b) for b in self.stream))
        self.app.len_bytes_var.set(str(len(self.bytes)))

    # ---- narration + stepping ----
    def _narrate(self, text: str):
        self.app.step_title_var.set(self.steps[self.idx].title)
        self.app.narration_text.config(state="normal")
        self.app.narration_text.delete("1.0", "end")
        self.app.narration_text.insert("end", text)
        self.app.narration_text.config(state="disabled")

    def _snapshot(self):
        self.snapshots.append((
            self.stream.copy(),
            self.processed.copy(),
            self.idx
        ))

    def _restore_snapshot(self):
        if self.snapshots:
            s, p, _ = self.snapshots.pop()
            self.stream = s
            self.processed = p

    def _go_to(self, idx: int):
        self.idx = idx
        step = self.steps[idx]
        # default narration
        self._narrate(step.narration)
        # render
        step.render(self.app)
        self._update_buttons()

    def next(self):
        if self.idx < len(self.steps) - 1:
            self.idx += 1
            self._go_to(self.idx)

    def prev(self):
        # If the current step had an undo, call it first, then move back.
        cur = self.steps[self.idx]
        if cur.undo is not None:
            cur.undo()
        if self.idx > 0:
            self.idx -= 1
            self._go_to(self.idx)

    # expose outputs
    def cipher_bits(self) -> str:
        return "".join(str(b) for b in self.stream)

    def plain_len_bytes(self) -> int:
        return len(self.bytes)

    def _update_buttons(self):
        self.app.prev_btn.config(state=("normal" if self.idx > 0 else "disabled"))
        self.app.next_btn.config(state=("normal" if self.idx < len(self.steps)-1 else "disabled"))


class DecryptTeach:
    def __init__(self, app, cipher_bits: str, key_str: str, nbytes: int):
        self.app = app
        self.key = parse_key(key_str)
        self.stream = [1 if ch == "1" else 0 for ch in cipher_bits if ch in "01"]
        self.nbytes = int(nbytes)
        self.mu = self.nbytes * 8
        self.plan = positions_for(self.mu, self.key)
        if not self.plan or self.plan[-1] >= len(self.stream):
            raise ValueError("Cipher stream too short for the given key and plaintext length.")
        self.extracted = []   # bits read so far
        self.read_idx = set()
        self.snapshots = []
        self.steps = self._build_steps()
        self.idx = 0

        self.app.set_mode("DECRYPT – Teaching Mode")
        self._go_to(0)

    def _build_steps(self) -> list[Step]:
        steps: list[Step] = []

        steps.append(Step(
            "Start: Cipher chosen",
            "We will decrypt the cipher stream using the same key and the original plaintext length (bytes).\n"
            "First, we’ll revisit the plan (positions) so we know where to read bits.",
            lambda a: self._render_stream(None)
        ))

        # Plan steps
        steps.append(Step(
            "Key parsed",
            f"Key K = {self.key}\nWe’ll compute the same index plan used for encryption.",
            lambda a: self._render_plan(None)
        ))

        pos = -1
        k_idx = 0
        for j in range(self.mu):
            hop = self.key[k_idx]
            new_pos = pos + hop
            steps.append(Step(
                f"Plan step {j+1}/{self.mu}: advance by K[{k_idx}]={hop}",
                f"For message bit #{j} we hop by {hop} to index i = {new_pos}. We will read from this index.",
                lambda a, cur=new_pos: self._render_plan(cur)
            ))
            pos = new_pos
            k_idx = (k_idx + 1) % len(self.key)

        # Extraction steps
        steps.append(Step(
            "Begin extraction",
            "Now we read bits from the planned indices in order. Underline = already read; yellow = current index.",
            lambda a: self._render_stream(None)
        ))

        for j in range(self.mu):
            i = self.plan[j]

            def do_render(app, idx=i, jidx=j):
                self._snapshot()
                bit = self.stream[idx]
                self.extracted.append(bit)
                self.read_idx.add(idx)
                self._render_stream(idx)
                # Build ASCII preview
                preview = ""
                if len(self.extracted) >= 8:
                    # show last full byte as ASCII (if printable)
                    last_byte = 0
                    for k in range(8):
                        last_byte = (last_byte << 1) | self.extracted[-8 + k]
                    ch = chr(last_byte) if 32 <= last_byte <= 126 else f"\\x{last_byte:02X}"
                    preview = f"  (just formed byte: 0x{last_byte:02X} → {ch})"

                self._narrate(
                    f"Decryption step {jidx+1}/{self.mu}\n"
                    f"Read bit at i={idx}: {self.stream[idx]} and append to message bits.{preview}\n"
                    f"Extracted so far (bit length): {len(self.extracted)}"
                )

            def undo():
                self._restore_snapshot()

            steps.append(Step(
                f"Read {j+1}/{self.mu} at i={i}",
                f"Reading from position i={i}.",
                do_render, undo=undo
            ))

        # Final text
        steps.append(Step(
            "Decryption complete",
            "We have all bits. Reassemble bytes and decode to text below.",
            lambda a: self._render_done()
        ))

        return steps

    # -- render helpers --
    def _render_plan(self, cur: int|None):
        self._update_context()
        fake = [0]*len(self.stream)
        self.app.ruler_var.set(build_ruler(len(fake)))
        render_bits(self.app.bits_text, fake, set(), cur)

    def _render_stream(self, cur: int|None):
        self._update_context()
        self.app.ruler_var.set(build_ruler(len(self.stream)))
        render_bits(self.app.bits_text, self.stream, self.read_idx, cur)

    def _render_done(self):
        self._render_stream(None)
        text = bits_to_text(self.extracted, self.nbytes)
        self.app.plaintext_out_var.set(text)
        self._narrate(
            "Reassembled all bits into bytes and decoded as UTF-8.\n"
            f"Plaintext: {text!r}"
        )

    def _update_context(self):
        self.app.ctx_key_var.set(str(self.key))
        self.app.ctx_mu_var.set(str(self.mu))
        self.app.ctx_streamlen_var.set(str(len(self.stream)))
        self.app.cipher_var.set("".join(str(b) for b in self.stream))
        self.app.len_bytes_var.set(str(self.nbytes))

    # -- narration/stepping --
    def _narrate(self, text: str):
        self.app.step_title_var.set(self.steps[self.idx].title)
        self.app.narration_text.config(state="normal")
        self.app.narration_text.delete("1.0", "end")
        self.app.narration_text.insert("end", text)
        self.app.narration_text.config(state="disabled")

    def _snapshot(self):
        self.snapshots.append((
            self.extracted.copy(),
            self.read_idx.copy(),
            self.idx
        ))

    def _restore_snapshot(self):
        if self.snapshots:
            ex, rd, _ = self.snapshots.pop()
            self.extracted = ex
            self.read_idx = rd

    def _go_to(self, idx: int):
        self.idx = idx
        step = self.steps[idx]
        self._narrate(step.narration)
        step.render(self.app)
        self._update_buttons()

    def next(self):
        if self.idx < len(self.steps) - 1:
            self.idx += 1
            self._go_to(self.idx)

    def prev(self):
        cur = self.steps[self.idx]
        if cur.undo is not None:
            cur.undo()
        if self.idx > 0:
            self.idx -= 1
            self._go_to(self.idx)

    def _update_buttons(self):
        self.app.prev_btn.config(state=("normal" if self.idx > 0 else "disabled"))
        self.app.next_btn.config(state=("normal" if self.idx < len(self.steps)-1 else "disabled"))


# ============
# Main UI App
# ============

class App(tk.Tk):
    def __init__(self):
        super().__init__()
        self.title("BARN Cipher – Teaching Mode")
        self.geometry("1120x720")

        # --- top bar ---
        top = ttk.Frame(self)
        top.pack(side="top", fill="x", padx=12, pady=10)

        self.title_lbl = ttk.Label(top, text="BARN cipher", font=("Helvetica", 20, "bold"))
        self.title_lbl.pack(side="left")

        self.mode_lbl = ttk.Label(top, text="— (choose Encrypt or Decrypt)")
        self.mode_lbl.pack(side="left", padx=16)

        btns = ttk.Frame(top)
        btns.pack(side="right")
        ttk.Button(btns, text="Encrypt", command=self.open_encrypt).pack(side="left", padx=4)
        ttk.Button(btns, text="Decrypt", command=self.open_decrypt).pack(side="left", padx=4)

        # --- main split ---
        main = ttk.Frame(self)
        main.pack(fill="both", expand=True, padx=12, pady=6)

        # left: ruler + bits + legend
        left = ttk.Frame(main)
        left.pack(side="left", fill="both", expand=True)

        ttk.Label(left, text="Index ruler (per line)").pack(anchor="w")
        self.ruler_var = tk.StringVar(value="")
        self.ruler = tk.Text(left, height=4, width=20, font=("Courier New", 10))
        self.ruler.pack(fill="x")
        self.ruler.insert("end", "")
        self.ruler.config(state="disabled")

        ttk.Label(left, text="Bit stream view (random/cipher)").pack(anchor="w", pady=(6,0))
        self.bits_text = tk.Text(left, wrap="none", font=("Courier New", 13), height=20)
        self.bits_text.pack(fill="both", expand=True)

        legend = ttk.Frame(left)
        legend.pack(fill="x", pady=6)
        ttk.Label(legend, text="Legend: ").pack(side="left")
        ttk.Label(legend, text="underline = processed").pack(side="left", padx=8)
        ttk.Label(legend, text="yellow = current index").pack(side="left", padx=8)

        # right: narration + controls + context + outputs
        right = ttk.Frame(main, width=360)
        right.pack(side="left", fill="y", padx=(10,0))

        self.step_title_var = tk.StringVar(value="")
        ttk.Label(right, textvariable=self.step_title_var, font=("Helvetica", 14, "bold")).pack(anchor="w")

        self.narration_text = tk.Text(right, height=14, wrap="word")
        self.narration_text.pack(fill="x", pady=6)
        self.narration_text.config(state="disabled")

        ctrls = ttk.Frame(right)
        ctrls.pack(fill="x", pady=6)
        self.prev_btn = ttk.Button(ctrls, text="⏪ Previous", command=self.on_prev, state="disabled")
        self.prev_btn.pack(side="left", expand=True, fill="x", padx=(0,6))
        self.next_btn = ttk.Button(ctrls, text="Next ▶", command=self.on_next, state="disabled")
        self.next_btn.pack(side="left", expand=True, fill="x")

        ttk.Separator(right).pack(fill="x", pady=8)

        # context
        ttk.Label(right, text="Context").pack(anchor="w")
        ctx = ttk.Frame(right)
        ctx.pack(fill="x", pady=(2,8))
        ttk.Label(ctx, text="Key K:").grid(row=0, column=0, sticky="w")
        ttk.Label(ctx, text="Message bits μ:").grid(row=1, column=0, sticky="w")
        ttk.Label(ctx, text="Stream length |P|:").grid(row=2, column=0, sticky="w")
        self.ctx_key_var = tk.StringVar(value="-")
        self.ctx_mu_var = tk.StringVar(value="-")
        self.ctx_streamlen_var = tk.StringVar(value="-")
        ttk.Label(ctx, textvariable=self.ctx_key_var).grid(row=0, column=1, sticky="w")
        ttk.Label(ctx, textvariable=self.ctx_mu_var).grid(row=1, column=1, sticky="w")
        ttk.Label(ctx, textvariable=self.ctx_streamlen_var).grid(row=2, column=1, sticky="w")

        ttk.Separator(right).pack(fill="x", pady=8)

        # outputs
        ttk.Label(right, text="Outputs").pack(anchor="w")
        out = ttk.Frame(right)
        out.pack(fill="x", pady=(2,2))
        ttk.Label(out, text="Cipher bits (for decrypt):").grid(row=0, column=0, sticky="w")
        self.cipher_var = tk.StringVar()
        ttk.Entry(out, textvariable=self.cipher_var).grid(row=0, column=1, sticky="we")
        ttk.Label(out, text="Plaintext length (bytes):").grid(row=1, column=0, sticky="w")
        self.len_bytes_var = tk.StringVar()
        ttk.Entry(out, textvariable=self.len_bytes_var).grid(row=1, column=1, sticky="we")

        ttk.Label(out, text="Decrypted plaintext:").grid(row=2, column=0, sticky="w", pady=(6,0))
        self.plaintext_out_var = tk.StringVar()
        ttk.Entry(out, textvariable=self.plaintext_out_var).grid(row=2, column=1, sticky="we")

        right.columnconfigure(0, weight=0)
        right.columnconfigure(1, weight=1)

        self.controller = None

    # -- top-level actions --
    def set_mode(self, text: str):
        self.mode_lbl.config(text=f"— {text}")

    def on_next(self):
        if self.controller:
            self.controller.next()

    def on_prev(self):
        if self.controller:
            self.controller.prev()

    def open_encrypt(self):
        dlg = tk.Toplevel(self)
        dlg.title("Encrypt — Provide inputs")
        dlg.grab_set()

        ttk.Label(dlg, text="Plaintext:").grid(row=0, column=0, sticky="w", padx=8, pady=8)
        txt_var = tk.StringVar(value="HELLO")
        ttk.Entry(dlg, textvariable=txt_var, width=48).grid(row=0, column=1, padx=8, pady=8)

        ttk.Label(dlg, text="Key (comma-separated positive integers):").grid(row=1, column=0, sticky="w", padx=8, pady=8)
        key_var = tk.StringVar(value="1,3,2,1")
        ttk.Entry(dlg, textvariable=key_var, width=48).grid(row=1, column=1, padx=8, pady=8)

        def start():
            try:
                plaintext = txt_var.get()
                if not plaintext:
                    raise ValueError("Plaintext cannot be empty.")
                # Validate key
                parse_key(key_var.get())
                self.controller = EncryptTeach(self, plaintext, key_var.get())
                self.prev_btn.config(state="normal")
                self.next_btn.config(state="normal")
                dlg.destroy()
            except Exception as e:
                messagebox.showerror("Input error", str(e))

        ttk.Button(dlg, text="Start Teaching Mode", command=start).grid(row=2, column=0, columnspan=2, pady=10)

    def open_decrypt(self):
        dlg = tk.Toplevel(self)
        dlg.title("Decrypt — Provide inputs")
        dlg.grab_set()

        ttk.Label(dlg, text="Cipher bits (0/1 string):").grid(row=0, column=0, sticky="w", padx=8, pady=8)
        ciph_var = tk.StringVar()
        ttk.Entry(dlg, textvariable=ciph_var, width=64).grid(row=0, column=1, padx=8, pady=8)

        ttk.Label(dlg, text="Key (comma-separated positive integers):").grid(row=1, column=0, sticky="w", padx=8, pady=8)
        key_var = tk.StringVar(value="1,3,2,1")
        ttk.Entry(dlg, textvariable=key_var, width=64).grid(row=1, column=1, padx=8, pady=8)

        ttk.Label(dlg, text="Plaintext length (bytes):").grid(row=2, column=0, sticky="w", padx=8, pady=8)
        nbytes_var = tk.StringVar(value="5")
        ttk.Entry(dlg, textvariable=nbytes_var, width=16).grid(row=2, column=1, sticky="w", padx=8, pady=8)

        def start():
            try:
                ciph = ciph_var.get().strip()
                if not ciph or any(ch not in "01" for ch in ciph):
                    raise ValueError("Cipher must be a 0/1 string.")
                parse_key(key_var.get())
                nbytes = int(nbytes_var.get())
                if nbytes <= 0:
                    raise ValueError("Plaintext length must be positive.")
                self.controller = DecryptTeach(self, ciph, key_var.get(), nbytes)
                self.prev_btn.config(state="normal")
                self.next_btn.config(state="normal")
                dlg.destroy()
            except Exception as e:
                messagebox.showerror("Input error", str(e))

        ttk.Button(dlg, text="Start Teaching Mode", command=start).grid(row=3, column=0, columnspan=2, pady=10)


if __name__ == "__main__":
    App().mainloop()
