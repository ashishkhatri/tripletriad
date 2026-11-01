#!/usr/bin/env python3
"""
Synthesizes the game's sound effects (all original) to small MP3 files in public/sfx/.

    python3 tools/gensfx.py          # all
    python3 tools/gensfx.py flip     # one

Needs numpy, scipy and ffmpeg (libmp3lame).
"""
import os, subprocess, sys, tempfile, wave
import numpy as np
from scipy.signal import butter, sosfilt, fftconvolve

SR = 44100
OUT = os.path.join(os.path.dirname(__file__), '..', 'public', 'sfx')
rng = np.random.default_rng(11)

def t(d): return np.arange(int(d * SR)) / SR
def hz(m): return 440.0 * 2 ** ((m - 69) / 12)
def noise(d): return rng.standard_normal(int(d * SR))
def bp(x, lo, hi, order=2): return sosfilt(butter(order, [lo, hi], 'bandpass', fs=SR, output='sos'), x)
def lp(x, f, order=2): return sosfilt(butter(order, f, 'lowpass', fs=SR, output='sos'), x)
def hp(x, f, order=2): return sosfilt(butter(order, f, 'highpass', fs=SR, output='sos'), x)
def env_exp(n, k, attack=0.002):
    tt = np.arange(n) / SR
    e = np.exp(-tt * k)
    a = int(attack * SR)
    if a: e[:a] *= np.linspace(0, 1, a)
    return e
def place(buf, at, sig, gain=1.0):
    i = int(at * SR); j = min(len(buf), i + len(sig))
    buf[i:j] += sig[:j - i] * gain
def canvas(d): return np.zeros(int(d * SR))

# ---- building blocks ----
def bell(f, d=1.6, decay=2.2, bright=1.0):
    tt = t(d)
    parts = [(1, 1, 1), (2.0, .5 * bright, 1.6), (2.76, .35 * bright, 2.4), (5.4, .15 * bright, 3.6), (8.9, .06 * bright, 5)]
    x = sum(a * np.sin(2 * np.pi * f * r * tt) * np.exp(-tt * decay * k) for r, a, k in parts)
    x[:60] *= np.linspace(0, 1, 60)
    return x
def pluck(f, d=0.6, decay=7):
    tt = t(d)
    x = sum((0.6 ** k) * np.sin(2 * np.pi * (k + 1) * f * tt) * np.exp(-tt * (decay + 4 * k)) for k in range(5))
    x[:40] *= np.linspace(0, 1, 40)
    return x
def whoosh(d, lo, hi, sweep_up=True, k=None):
    n = noise(d)
    tt = t(d)
    # sweep a band through the noise in chunks
    out = np.zeros_like(n)
    steps = 12
    for s in range(steps):
        a, b = int(len(n) * s / steps), int(len(n) * (s + 1) / steps)
        frac = s / (steps - 1)
        c = lo * (hi / lo) ** (frac if sweep_up else 1 - frac)
        seg = bp(n, max(80, c * 0.6), min(18000, c * 1.6))[a:b]
        out[a:b] = seg
    shape = np.sin(np.pi * np.clip(tt / d, 0, 1)) ** 1.5
    return out * shape
def thump(f0=140, f1=60, d=0.22, k=18):
    tt = t(d)
    f = f1 + (f0 - f1) * np.exp(-tt * 35)
    return np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-tt * k)
def tick(d=0.03, f=3000):
    n = hp(noise(d), f)
    return n * env_exp(len(n), 120)
def sparkle(d=0.9, count=10, lo=84, hi=100, gain=0.25):
    out = canvas(d + 0.8)
    for _ in range(count):
        m = rng.integers(lo, hi)
        place(out, rng.uniform(0, d), bell(hz(m), 0.8, 5, 0.6) * rng.uniform(0.4, 1), gain)
    return out
def room(x, seconds=0.9, wet=0.25):
    n = int(seconds * SR)
    ir = rng.standard_normal(n) * np.exp(-np.arange(n) / SR * 5)
    ir = lp(ir, 5000); ir /= np.sqrt(np.sum(ir ** 2))
    full = fftconvolve(x, ir)
    y = np.zeros(len(x) + n); y[:len(x)] += x
    w = np.zeros(len(y)); w[:min(len(full), len(y))] = full[:len(y)]
    return y * (1 - wet * 0.3) + w * wet

# ---- effects ----
def sfx_pick():          # lifting a card: short paper slide + light tick
    x = canvas(0.16)
    place(x, 0, whoosh(0.12, 1500, 5000) * 0.6)
    place(x, 0.0, tick(0.02, 4000) * 0.5)
    return x
def sfx_place():         # card set down on wood
    x = canvas(0.35)
    place(x, 0, thump(160, 70, 0.25, 20) * 0.9)
    place(x, 0, lp(noise(0.06), 3000) * env_exp(int(0.06 * SR), 60) * 0.5)
    place(x, 0.003, tick(0.025, 2500) * 0.35)
    return room(x, 0.4, 0.15)
def sfx_flip():          # card flipping over
    x = canvas(0.3)
    place(x, 0, whoosh(0.18, 800, 6000) * 0.8)
    place(x, 0.15, tick(0.03, 2000) * 0.7)
    place(x, 0.15, thump(220, 110, 0.1, 30) * 0.35)
    return x
def sfx_cancel():        # card slides back to hand
    x = canvas(0.25)
    place(x, 0, whoosh(0.2, 5000, 900, sweep_up=False) * 0.6)
    place(x, 0.17, thump(120, 80, 0.08, 40) * 0.3)
    return x
def chord_chime(notes, spacing=0.06, d=1.8, gain=0.5, bright=1.0):
    x = canvas(d + spacing * len(notes))
    for i, m in enumerate(notes):
        place(x, i * spacing, bell(hz(m), d, 2.0, bright), gain)
    return x
def sfx_same():          # bright matching chime: two identical notes, then the fifth
    x = chord_chime([79, 79, 86], 0.09, 1.6, 0.45)
    return room(x, 1.2, 0.3)
def sfx_plus():          # rising arpeggio
    x = chord_chime([72, 76, 79, 84], 0.07, 1.6, 0.42)
    return room(x, 1.2, 0.3)
def sfx_combo():         # cascading run + sparkle
    x = chord_chime([84, 88, 91, 96, 100], 0.05, 1.5, 0.38, 1.2)
    place(x, 0.1, sparkle(0.6, 8, 88, 103, 0.18))
    return room(x, 1.3, 0.3)
def sfx_turn():          # soft single bell
    return room(bell(hz(81), 1.0, 3.2, 0.5) * 0.35, 0.9, 0.3)
def sfx_win():           # short fanfare: plucked arpeggio into a bright chord
    x = canvas(2.6)
    for i, m in enumerate([67, 72, 76, 79]):
        place(x, i * 0.11, pluck(hz(m), 0.6) * 0.5)
    for m in [72, 76, 79, 84]:
        place(x, 0.46, bell(hz(m), 2.0, 1.4, 0.8) * 0.28)
    place(x, 0.5, sparkle(0.8, 10, 86, 100, 0.12))
    return room(x, 1.6, 0.35)
def sfx_lose():          # falling minor phrase, low
    x = canvas(2.2)
    for i, m in enumerate([69, 65, 62]):
        place(x, i * 0.22, pluck(hz(m), 0.9, 4) * 0.5)
    for m in [50, 57, 62]:
        place(x, 0.66, bell(hz(m), 1.6, 1.6, 0.3) * 0.25)
    return room(x, 1.6, 0.35)
def sfx_draw():          # suspended, unresolved
    x = canvas(1.8)
    for i, m in enumerate([67, 72, 74]):
        place(x, i * 0.13, pluck(hz(m), 0.8, 5) * 0.45)
    for m in [62, 67, 72]:
        place(x, 0.4, bell(hz(m), 1.4, 1.8, 0.4) * 0.22)
    return room(x, 1.4, 0.3)
def sfx_xp():            # coin-like ticks climbing
    x = canvas(0.9)
    for i, m in enumerate([88, 91, 95]):
        place(x, i * 0.07, bell(hz(m), 0.5, 7, 0.9) * 0.3)
    return room(x, 0.6, 0.2)
def sfx_unlock():        # a pack unlocked
    x = chord_chime([76, 81, 85, 88], 0.08, 1.8, 0.35, 1.1)
    place(x, 0.3, sparkle(0.7, 10, 88, 104, 0.14))
    return room(x, 1.5, 0.35)
def sfx_wager_win():
    x = canvas(1.4)
    place(x, 0, whoosh(0.25, 900, 5000) * 0.5)
    place(x, 0.2, chord_chime([79, 83, 86], 0.06, 1.2, 0.35))
    return room(x, 1.0, 0.3)
def sfx_wager_lose():
    x = canvas(1.4)
    place(x, 0, whoosh(0.3, 5000, 700, sweep_up=False) * 0.5)
    place(x, 0.25, pluck(hz(62), 1.0, 3) * 0.4)
    place(x, 0.25, pluck(hz(57), 1.0, 3) * 0.3)
    return room(x, 1.0, 0.3)
def sfx_pack_open():     # paper tearing then a shimmer
    x = canvas(1.6)
    tear = canvas(0.45)
    for k in range(14):  # rapid crackles
        place(tear, k * 0.028 + rng.uniform(0, 0.01), bp(noise(0.03), 1500, 7000) * env_exp(int(0.03 * SR), 90) * rng.uniform(0.4, 1))
    place(x, 0, tear * 0.8)
    place(x, 0, whoosh(0.45, 600, 3000) * 0.35)
    place(x, 0.4, sparkle(0.7, 12, 84, 100, 0.12))
    place(x, 0.42, bell(hz(76), 1.0, 2.5, 0.5) * 0.2)
    return room(x, 1.2, 0.3)
def reveal(level):       # grander for rarer cards
    x = canvas(2.4)
    place(x, 0, sfx_flip() * 0.8)
    base = {1: [79], 2: [79, 84], 3: [76, 79, 84], 4: [72, 76, 79, 84, 88], 5: [67, 72, 76, 79, 84, 88, 91]}[level]
    place(x, 0.14, chord_chime(base, 0.05 if level < 5 else 0.06, 1.6 + 0.2 * level, 0.3 + 0.03 * level, 0.8 + 0.1 * level))
    if level >= 4: place(x, 0.2, sparkle(0.6 + 0.3 * (level - 4), 10 + 8 * (level - 4), 86, 104, 0.12))
    if level == 5:
        for m in [43, 50]: place(x, 0.16, bell(hz(m), 2.0, 1.2, 0.2) * 0.3)
    return room(x, 1.6, 0.35)
def sfx_click():         # small wooden UI click
    x = canvas(0.08)
    place(x, 0, thump(900, 500, 0.05, 80) * 0.4)
    place(x, 0, tick(0.015, 3000) * 0.3)
    return x
def sfx_error():
    x = canvas(0.35)
    place(x, 0, pluck(hz(55), 0.3, 10) * 0.5)
    place(x, 0.08, pluck(hz(54), 0.3, 10) * 0.5)
    return x

EFFECTS = {
    'pick': sfx_pick, 'place': sfx_place, 'flip': sfx_flip, 'cancel': sfx_cancel,
    'same': sfx_same, 'plus': sfx_plus, 'combo': sfx_combo, 'turn': sfx_turn,
    'win': sfx_win, 'lose': sfx_lose, 'draw': sfx_draw,
    'xp': sfx_xp, 'unlock': sfx_unlock, 'wager-win': sfx_wager_win, 'wager-lose': sfx_wager_lose,
    'pack-open': sfx_pack_open, 'click': sfx_click, 'error': sfx_error,
    **{f'reveal-{l}': (lambda l=l: reveal(l)) for l in range(1, 6)},
}

def finish(x):
    x = x / (np.max(np.abs(x)) + 1e-9) * 0.9
    # trim trailing silence
    thr = 10 ** (-60 / 20)
    nz = np.where(np.abs(x) > thr)[0]
    x = x[: (nz[-1] + int(0.02 * SR)) if len(nz) else len(x)]
    fade = min(len(x), int(0.01 * SR))
    x[-fade:] *= np.linspace(1, 0, fade)
    return x

def write(name, x):
    os.makedirs(OUT, exist_ok=True)
    pcm = (np.clip(x, -1, 1) * 32767).astype('<i2')
    with tempfile.NamedTemporaryFile(suffix='.wav', delete=False) as tmp:
        with wave.open(tmp.name, 'wb') as w:
            w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR); w.writeframes(pcm.tobytes())
        path = os.path.join(OUT, f'{name}.mp3')
        subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-i', tmp.name, '-codec:a', 'libmp3lame', '-b:a', '96k', path], check=True)
    os.unlink(tmp.name)
    return path

def main():
    only = sys.argv[1] if len(sys.argv) > 1 else None
    for name, fn in EFFECTS.items():
        if only and name != only: continue
        x = finish(fn())
        p = write(name, x)
        print(f'{name:12s} {len(x) / SR:4.2f}s {os.path.getsize(p) // 1024:3d} KB')

if __name__ == '__main__':
    main()
