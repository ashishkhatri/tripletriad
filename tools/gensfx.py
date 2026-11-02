#!/usr/bin/env python3
"""
Synthesizes the game's sound effects (all original) to small MP3 files.

Every card set has its own sound kit, so the same event sounds different per set:
  wilds      wood, bells and plucked strings      -> public/sfx/*.mp3 (also the fallback)
  arcane     glass chimes, crystal taps, shimmer   -> public/sfx/arcane/
  starfall   synth bleeps, zaps, servos, echo      -> public/sfx/starfall/
  tidebound  water drops, bubbles, waves, vibes    -> public/sfx/tidebound/
  bloomwild  kalimba, leaf rustles, bird chirps    -> public/sfx/bloomwild/
  hollow     temple bells, gongs, music box, minor -> public/sfx/hollow/

    python3 tools/gensfx.py                 # every kit, every effect
    python3 tools/gensfx.py tidebound       # one kit
    python3 tools/gensfx.py tidebound flip  # one effect of one kit

Needs numpy, scipy and ffmpeg (libmp3lame).
"""
import os, subprocess, sys, tempfile, wave
import numpy as np
from scipy.signal import butter, sosfilt, fftconvolve

SR = 44100
ROOT = os.path.join(os.path.dirname(__file__), '..', 'public', 'sfx')
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
def fade_in(x, n=60):
    n = min(n, len(x)); x[:n] *= np.linspace(0, 1, n); return x
def sweep(f0, f1, d, k=None, curve=35):
    """sine whose pitch glides f0 -> f1 (exponential approach)"""
    tt = t(d)
    f = f1 + (f0 - f1) * np.exp(-tt * curve)
    return np.sin(2 * np.pi * np.cumsum(f) / SR) * (np.exp(-tt * k) if k else 1)
def glide(f0, f1, d):
    """sine with a linear-in-log pitch glide over the whole duration"""
    tt = t(d)
    f = f0 * (f1 / f0) ** (tt / d)
    return np.sin(2 * np.pi * np.cumsum(f) / SR)
def band_sweep(src, lo, hi, up=True, steps=12, q=(0.6, 1.6)):
    out = np.zeros_like(src)
    for s in range(steps):
        a, b = int(len(src) * s / steps), int(len(src) * (s + 1) / steps)
        frac = s / (steps - 1)
        c = lo * (hi / lo) ** (frac if up else 1 - frac)
        out[a:b] = bp(src, max(60, c * q[0]), min(18000, c * q[1]))[a:b]
    return out
def reverb(x, seconds=0.9, wet=0.25, bright=5000, decay=5):
    n = int(seconds * SR)
    ir = rng.standard_normal(n) * np.exp(-np.arange(n) / SR * decay)
    ir = lp(ir, bright); ir /= np.sqrt(np.sum(ir ** 2))
    full = fftconvolve(x, ir)
    y = np.zeros(len(x) + n); y[:len(x)] += x
    w = np.zeros(len(y)); w[:min(len(full), len(y))] = full[:len(y)]
    return y * (1 - wet * 0.3) + w * wet
def echo(x, delay=0.11, fb=0.38, taps=4):
    d = int(delay * SR)
    y = np.zeros(len(x) + d * taps); y[:len(x)] += x
    for k in range(1, taps + 1):
        y[k * d:k * d + len(x)] += lp(x, 6000 - 900 * k) * fb ** k
    return y


# =====================================================================
# Kits. Each kit supplies the same primitives; the effects further down
# are written once in terms of them.
# =====================================================================
class Wilds:
    """Wood, bells, plucked strings. The original sound set."""
    name = 'wilds'
    room_s, room_wet = 1.2, 0.3
    def mode(self, m): return m
    def tone(self, f, d=1.6, decay=2.2, bright=1.0):
        tt = t(d)
        parts = [(1, 1, 1), (2.0, .5 * bright, 1.6), (2.76, .35 * bright, 2.4), (5.4, .15 * bright, 3.6), (8.9, .06 * bright, 5)]
        return fade_in(sum(a * np.sin(2 * np.pi * f * r * tt) * np.exp(-tt * decay * k) for r, a, k in parts))
    def pluck(self, f, d=0.6, decay=7):
        tt = t(d)
        return fade_in(sum((0.6 ** k) * np.sin(2 * np.pi * (k + 1) * f * tt) * np.exp(-tt * (decay + 4 * k)) for k in range(5)), 40)
    def swish(self, d, lo, hi, up=True):
        return band_sweep(noise(d), lo, hi, up) * np.sin(np.pi * np.clip(t(d) / d, 0, 1)) ** 1.5
    def tick(self, d=0.03, f=3000):
        n = hp(noise(d), f); return n * env_exp(len(n), 120)
    def thump(self, f0=140, f1=60, d=0.22, k=18): return sweep(f0, f1, d, k)
    def glitter(self, d=0.9, count=10, lo=84, hi=100, gain=0.25):
        out = canvas(d + 0.8)
        for _ in range(count):
            place(out, rng.uniform(0, d), self.tone(hz(self.mode(int(rng.integers(lo, hi)))), 0.8, 5, 0.6) * rng.uniform(0.4, 1), gain)
        return out
    def room(self, x, s=None, wet=None):
        return reverb(x, s or self.room_s, self.room_wet if wet is None else wet)

    # -- table-top sounds --
    def pick(self):
        x = canvas(0.16)
        place(x, 0, self.swish(0.12, 1500, 5000) * 0.6)
        place(x, 0, self.tick(0.02, 4000) * 0.5)
        return x
    def place(self):
        x = canvas(0.35)
        place(x, 0, self.thump(160, 70, 0.25, 20) * 0.9)
        place(x, 0, lp(noise(0.06), 3000) * env_exp(int(0.06 * SR), 60) * 0.5)
        place(x, 0.003, self.tick(0.025, 2500) * 0.35)
        return reverb(x, 0.4, 0.15)
    def flip(self):
        x = canvas(0.3)
        place(x, 0, self.swish(0.18, 800, 6000) * 0.8)
        place(x, 0.15, self.tick(0.03, 2000) * 0.7)
        place(x, 0.15, self.thump(220, 110, 0.1, 30) * 0.35)
        return x
    def cancel(self):
        x = canvas(0.25)
        place(x, 0, self.swish(0.2, 5000, 900, up=False) * 0.6)
        place(x, 0.17, self.thump(120, 80, 0.08, 40) * 0.3)
        return x
    def click(self):
        x = canvas(0.08)
        place(x, 0, self.thump(900, 500, 0.05, 80) * 0.4)
        place(x, 0, self.tick(0.015, 3000) * 0.3)
        return x
    def error(self):
        x = canvas(0.35)
        place(x, 0, self.pluck(hz(55), 0.3, 10) * 0.5)
        place(x, 0.08, self.pluck(hz(54), 0.3, 10) * 0.5)
        return x
    def tear(self):
        x = canvas(0.5)
        for k in range(14):
            place(x, k * 0.028 + rng.uniform(0, 0.01), bp(noise(0.03), 1500, 7000) * env_exp(int(0.03 * SR), 90) * rng.uniform(0.4, 1))
        place(x, 0, self.swish(0.45, 600, 3000) * 0.45)
        return x


class Arcane(Wilds):
    """Glass harmonica, crystal taps and shimmering air in a big hall."""
    name = 'arcane'
    room_s, room_wet = 2.0, 0.42
    def tone(self, f, d=1.6, decay=2.2, bright=1.0):
        tt = t(d)
        # glass: few, slightly inharmonic partials, slow swell, gentle chorus
        parts = [(1, 1, 1), (2.32, .32 * bright, 1.8), (4.25, .16 * bright, 2.8), (6.63, .07 * bright, 4)]
        x = sum(a * (np.sin(2 * np.pi * f * r * tt) + 0.6 * np.sin(2 * np.pi * f * r * 1.003 * tt))
                * np.exp(-tt * decay * 0.75 * k) for r, a, k in parts)
        return fade_in(x, int(0.012 * SR))
    def pluck(self, f, d=0.6, decay=7):          # crystal tap
        tt = t(d)
        x = np.sin(2 * np.pi * f * tt) * np.exp(-tt * decay * 0.8) + 0.35 * np.sin(2 * np.pi * f * 3.9 * tt) * np.exp(-tt * decay * 2.5)
        return fade_in(x, 30)
    def swish(self, d, lo, hi, up=True):        # airy, with a faint whistle on top
        x = band_sweep(noise(d), lo * 1.4, min(hi * 1.6, 15000), up, q=(0.8, 1.3)) * 0.8
        x += glide(lo * 1.2 if up else hi * 0.7, hi * 0.7 if up else lo * 1.2, d) * 0.06
        return x * np.sin(np.pi * np.clip(t(d) / d, 0, 1)) ** 2
    def tick(self, d=0.03, f=3000):              # glassy tink
        a = self.pluck(hz(100), 0.08, 40) * 0.6; b = super().tick(d, f * 1.6) * 0.3
        a[:len(b)] += b[:len(a)]
        return a
    def place(self):                              # crystal set on stone
        x = canvas(0.6)
        place(x, 0, self.thump(130, 60, 0.18, 26) * 0.55)
        place(x, 0.002, self.pluck(hz(93), 0.5, 9) * 0.45)
        place(x, 0.002, self.pluck(hz(98), 0.4, 12) * 0.25)
        return reverb(x, 1.2, 0.3)
    def click(self):
        x = canvas(0.2); place(x, 0, self.pluck(hz(96), 0.18, 25) * 0.5); return reverb(x, 0.6, 0.2)
    def error(self):
        x = canvas(0.6)
        place(x, 0, self.tone(hz(61), 0.5, 6, 0.6) * 0.5)
        place(x, 0, self.tone(hz(62), 0.5, 6, 0.6) * 0.5)   # dissonant rub
        return reverb(x, 0.8, 0.25)
    def tear(self):                               # a seal breaking: crackle into a rising shimmer
        x = canvas(0.6)
        for k in range(10):
            place(x, k * 0.03, self.pluck(hz(int(rng.integers(96, 108))), 0.1, 50) * rng.uniform(0.2, 0.5))
        place(x, 0.05, self.swish(0.5, 1500, 9000) * 0.7)
        return x


class Starfall(Wilds):
    """Synth bleeps, laser zaps, servo whirs and a space echo."""
    name = 'starfall'
    room_s, room_wet = 0.7, 0.18
    def osc(self, f, tt, shape='square'):
        ph = (f * tt) % 1.0
        if shape == 'saw': return 2 * ph - 1
        if shape == 'tri': return 4 * np.abs(ph - 0.5) - 1
        return np.where(ph < 0.5, 1.0, -1.0)
    def tone(self, f, d=1.6, decay=2.2, bright=1.0):
        tt = t(d)
        x = self.osc(f, tt, 'square') * 0.5 + self.osc(f * 1.004, tt, 'saw') * 0.4
        x = lp(x, min(9000, 1800 + 2500 * bright)) * np.exp(-tt * decay * 1.2)
        return fade_in(x, 40) * 0.8
    def pluck(self, f, d=0.6, decay=7):
        tt = t(d)
        x = lp(self.osc(f, tt, 'square'), 3500) * np.exp(-tt * decay * 1.3)
        return fade_in(x, 20) * 0.7
    def swish(self, d, lo, hi, up=True):        # servo whir: filtered noise + gliding saw
        tt = t(d)
        x = band_sweep(noise(d), lo, hi, up, q=(0.85, 1.2)) * 0.5
        f0, f1 = (lo / 8, hi / 8) if up else (hi / 8, lo / 8)
        f = f0 * (f1 / f0) ** (tt / d)
        x += lp(2 * ((np.cumsum(f) / SR) % 1) - 1, 2500) * 0.18
        return x * np.sin(np.pi * np.clip(tt / d, 0, 1)) ** 1.2
    def tick(self, d=0.03, f=3000):              # digital click
        tt = t(0.012); return self.osc(2200, tt) * np.exp(-tt * 300) * 0.5
    def zap(self, f0, f1, d=0.18):
        tt = t(d); f = f1 + (f0 - f1) * np.exp(-tt * 25)
        ph = np.cumsum(f) / SR
        return lp(np.where(ph % 1 < 0.5, 1.0, -1.0), 6000) * np.exp(-tt * 14)
    def glitter(self, d=0.9, count=10, lo=84, hi=100, gain=0.25):   # data bleeps
        out = canvas(d + 0.4)
        for _ in range(count):
            place(out, rng.uniform(0, d), self.pluck(hz(int(rng.integers(lo, hi))), 0.07, 30), gain * 0.8)
        return out
    def room(self, x, s=None, wet=None):
        return reverb(echo(x, 0.12, 0.35, 4), s or self.room_s, self.room_wet if wet is None else wet)
    def place(self):                              # mag-lock clunk
        x = canvas(0.35)
        place(x, 0, self.thump(180, 50, 0.25, 16) * 0.9)
        place(x, 0, self.zap(1200, 300, 0.08) * 0.25)
        place(x, 0.03, self.tick() * 0.6)
        return echo(x, 0.07, 0.25, 2)
    def flip(self):                               # laser zap
        x = canvas(0.3)
        place(x, 0, self.zap(2400, 250, 0.22) * 0.55)
        place(x, 0, self.swish(0.16, 900, 5000) * 0.4)
        return echo(x, 0.06, 0.3, 2)
    def click(self):
        x = canvas(0.06); place(x, 0, self.pluck(hz(91), 0.05, 40) * 0.5); return x
    def error(self):
        x = canvas(0.4)
        tt = t(0.12)
        for k in range(2): place(x, k * 0.15, lp(self.osc(140, tt, 'saw'), 1600) * 0.6)
        return x
    def tear(self):                               # airlock hiss + power-up
        x = canvas(0.6)
        place(x, 0, hp(noise(0.4), 2500) * env_exp(int(0.4 * SR), 7, 0.02) * 0.4)
        place(x, 0.05, lp(glide(110, 880, 0.45) * np.sign(glide(110, 880, 0.45)), 3000) * np.sin(np.pi * np.clip(t(0.45) / 0.45, 0, 1)) * 0.3)
        return x


class Tidebound(Wilds):
    """Water drops, bubbles, wave swells and soft vibraphone."""
    name = 'tidebound'
    room_s, room_wet = 1.4, 0.32
    def tone(self, f, d=1.6, decay=2.2, bright=1.0):   # vibraphone with tremolo
        tt = t(d)
        x = np.sin(2 * np.pi * f * tt) + 0.25 * bright * np.sin(2 * np.pi * f * 4 * tt) * np.exp(-tt * 6)
        x *= np.exp(-tt * decay * 0.8) * (1 - 0.35 * (0.5 + 0.5 * np.sin(2 * np.pi * 5.5 * tt)))
        return fade_in(x, 80)
    def drop(self, f, d=0.12):                   # a bubble: pitch rising fast, quick decay
        tt = t(d); fr = f * (1 + 1.6 * (1 - np.exp(-tt * 40)))
        return np.sin(2 * np.pi * np.cumsum(fr) / SR) * np.exp(-tt * 38) * np.minimum(1, tt * 2000)
    def pluck(self, f, d=0.6, decay=7):          # marimba-ish soft mallet
        tt = t(d)
        return fade_in(np.sin(2 * np.pi * f * tt) * np.exp(-tt * decay) + 0.2 * np.sin(2 * np.pi * f * 4 * tt) * np.exp(-tt * decay * 4), 50)
    def swish(self, d, lo, hi, up=True):        # wave swell: dark rolling noise
        x = band_sweep(noise(d), lo * 0.35, hi * 0.5, up, q=(0.5, 2.0))
        x = lp(x, 4500)
        return x * np.sin(np.pi * np.clip(t(d) / d, 0, 1)) ** 1.2
    def tick(self, d=0.03, f=3000): return self.drop(f / 3, 0.06) * 0.6
    def glitter(self, d=0.9, count=10, lo=84, hi=100, gain=0.25):   # bubbles rising
        out = canvas(d + 0.3)
        for i in range(count):
            place(out, rng.uniform(0, d), self.drop(hz(int(rng.integers(lo - 12, hi - 12))) , 0.1), gain * rng.uniform(0.5, 1.1))
        return out
    def place(self):                              # plop onto wet sand
        x = canvas(0.4)
        place(x, 0, self.thump(140, 60, 0.2, 22) * 0.7)
        place(x, 0, lp(noise(0.08), 1200) * env_exp(int(0.08 * SR), 45) * 0.5)
        place(x, 0.02, self.drop(500, 0.12) * 0.5)
        return reverb(x, 0.5, 0.15)
    def flip(self):                               # splash-turn with a droplet
        x = canvas(0.35)
        place(x, 0, self.swish(0.2, 1500, 7000) * 0.8)
        place(x, 0.16, self.drop(700, 0.1) * 0.6)
        return x
    def click(self):
        x = canvas(0.12); place(x, 0, self.drop(900, 0.08) * 0.6); return x
    def error(self):
        x = canvas(0.45)
        place(x, 0, self.pluck(hz(50), 0.35, 8) * 0.6)
        place(x, 0.1, self.pluck(hz(49), 0.35, 8) * 0.5)
        return x
    def tear(self):                               # a bottle uncorked: pop + fizz of bubbles
        x = canvas(0.6)
        place(x, 0, self.thump(500, 180, 0.08, 40) * 0.6)
        place(x, 0.02, hp(noise(0.5), 3000) * env_exp(int(0.5 * SR), 6) * 0.15)
        place(x, 0.03, self.glitter(0.4, 14, 80, 96, 0.4))
        return x


class Bloomwild(Wilds):
    """Kalimba, leaf rustles and bird chirps in an open garden."""
    name = 'bloomwild'
    room_s, room_wet = 0.9, 0.22
    def tone(self, f, d=1.6, decay=2.2, bright=1.0):   # kalimba / thumb piano
        tt = t(d)
        x = np.sin(2 * np.pi * f * tt) * np.exp(-tt * decay * 1.1)
        x += 0.3 * bright * np.sin(2 * np.pi * f * 5.4 * tt) * np.exp(-tt * 18)    # metallic tine ping
        x += 0.15 * np.sin(2 * np.pi * f * 2 * tt) * np.exp(-tt * decay * 2)
        return fade_in(x, 30)
    def pluck(self, f, d=0.6, decay=7): return self.tone(f, d, decay * 0.9, 0.8)
    def rustle(self, d, lo=1800, hi=7000, density=90):
        x = canvas(d)
        for _ in range(int(d * density)):
            g = int(rng.integers(int(0.004 * SR), int(0.014 * SR)))
            place(x, rng.uniform(0, d), bp(rng.standard_normal(g), lo, hi) * np.hanning(g) * rng.uniform(0.2, 1))
        return x
    def swish(self, d, lo, hi, up=True):        # leaves brushing
        lo, hi = min(lo, hi), max(lo, hi)
        x = self.rustle(d, max(800, lo), min(9000, hi * 1.2), 160)
        return x * np.sin(np.pi * np.clip(t(d) / d, 0, 1))
    def tick(self, d=0.03, f=3000):              # twig snap
        n = bp(noise(0.02), 1500, 5000); return n * env_exp(len(n), 160)
    def chirp(self, f, d=0.09):
        tt = t(d); fr = f * (1 + 0.6 * np.sin(np.pi * tt / d))
        return np.sin(2 * np.pi * np.cumsum(fr) / SR) * np.sin(np.pi * tt / d) ** 2
    def glitter(self, d=0.9, count=10, lo=84, hi=100, gain=0.25):   # birdsong
        out = canvas(d + 0.3)
        k = 0
        while k < count:
            at = rng.uniform(0, d); f = hz(int(rng.integers(lo, hi)))
            for j in range(int(rng.integers(1, 4))):
                place(out, at + j * 0.07, self.chirp(f * (1 + 0.08 * j), 0.06), gain * 0.7)
                k += 1
        return out
    def place(self):                              # soft thud on moss + leaves
        x = canvas(0.35)
        place(x, 0, self.thump(130, 70, 0.2, 24) * 0.8)
        place(x, 0, self.rustle(0.12, 1500, 6000, 200) * 0.35)
        return reverb(x, 0.4, 0.12)
    def click(self):
        x = canvas(0.12); place(x, 0, self.tone(hz(84), 0.1, 30, 0.5) * 0.5); return x
    def error(self):
        x = canvas(0.4)
        place(x, 0, self.tone(hz(52), 0.3, 12, 0.3) * 0.6)
        place(x, 0.09, self.tone(hz(51), 0.3, 12, 0.3) * 0.6)
        return x
    def tear(self):                               # paper-and-leaf tear, then birds take off
        x = canvas(0.7)
        place(x, 0, self.rustle(0.4, 1200, 7000, 260) * 0.8)
        place(x, 0.3, self.glitter(0.3, 5, 88, 98, 0.5))
        return x


class Hollow(Wilds):
    """Temple bells, gongs, a music box and ghostly wind, in a minor key and a deep hall."""
    name = 'hollow'
    room_s, room_wet = 2.6, 0.45
    def mode(self, m):                            # major -> natural minor (relative to C)
        return m - 1 if m % 12 in (4, 9, 11) else m
    def tone(self, f, d=1.6, decay=2.2, bright=1.0):   # temple bell with beating partials
        tt = t(d * 1.2)
        parts = [(0.5, .5, 0.6), (1, 1, 1), (1.19, .45 * bright, 1.4), (1.56, .3 * bright, 1.8), (2.0, .25 * bright, 2.2), (2.74, .12 * bright, 3)]
        x = sum(a * (np.sin(2 * np.pi * f * r * tt) + 0.5 * np.sin(2 * np.pi * (f * r + 1.3) * tt))
                * np.exp(-tt * decay * 0.6 * k) for r, a, k in parts)
        return fade_in(x, 80)
    def pluck(self, f, d=0.6, decay=7):          # music box tine
        tt = t(d * 1.5)
        x = np.sin(2 * np.pi * f * tt) * np.exp(-tt * decay * 0.6) + 0.3 * np.sin(2 * np.pi * f * 3 * tt) * np.exp(-tt * decay * 2)
        return fade_in(x, 20)
    def swish(self, d, lo, hi, up=True):        # ghostly wind with a resonant moan
        tt = t(d)
        x = band_sweep(noise(d), lo * 0.4, hi * 0.5, up, q=(0.85, 1.18)) * 0.9
        x += glide(lo / 6 if up else hi / 10, hi / 10 if up else lo / 6, d) * 0.05
        return x * np.sin(np.pi * np.clip(tt / d, 0, 1)) ** 1.8
    def tick(self, d=0.03, f=3000):              # temple block
        return sweep(900, 700, 0.06, 70) * 0.6
    def glitter(self, d=0.9, count=10, lo=84, hi=100, gain=0.25):   # music box notes
        out = canvas(d + 1.0)
        for _ in range(count):
            place(out, rng.uniform(0, d), self.pluck(hz(self.mode(int(rng.integers(lo - 5, hi - 5)))), 0.6, 6), gain * rng.uniform(0.4, 0.9))
        return out
    def gong(self, f=hz(38), d=2.5):
        tt = t(d)
        x = sum(a * np.sin(2 * np.pi * f * r * tt + 2 * np.sin(2 * np.pi * 0.7 * tt)) * np.exp(-tt * k)
                for r, a, k in [(1, 1, 1.3), (1.48, .6, 1.8), (2.1, .4, 2.4), (2.9, .25, 3), (4.2, .1, 4)])
        return fade_in(x, int(0.01 * SR))
    def place(self):                              # lacquered wood on a low drum
        x = canvas(0.5)
        place(x, 0, self.thump(110, 45, 0.35, 12) * 0.9)
        place(x, 0, self.tick() * 0.5)
        return reverb(x, 1.0, 0.25)
    def click(self):
        x = canvas(0.15); place(x, 0, self.tick() * 0.6); return reverb(x, 0.6, 0.2)
    def error(self):
        x = canvas(0.8)
        place(x, 0, self.gong(hz(45), 0.7) * 0.4)
        return x
    def tear(self):                               # paper charm torn, a gust of wind
        x = canvas(0.8)
        for k in range(12):
            place(x, k * 0.03 + rng.uniform(0, 0.01), bp(noise(0.03), 1200, 5000) * env_exp(int(0.03 * SR), 90) * rng.uniform(0.3, 0.9))
        place(x, 0.05, self.swish(0.7, 400, 3000) * 0.9)
        return x


KITS = {k.name: k() for k in (Wilds, Arcane, Starfall, Tidebound, Bloomwild, Hollow)}


# =====================================================================
# Effects, written once against a kit K
# =====================================================================
def chord(K, notes, spacing=0.06, d=1.8, gain=0.5, bright=1.0):
    x = canvas(d * 1.3 + spacing * len(notes))
    for i, m in enumerate(notes):
        place(x, i * spacing, K.tone(hz(K.mode(m)), d, 2.0, bright), gain)
    return x
def plucks(K, notes, spacing, d=0.6, decay=7, gain=0.5, at=0, x=None):
    for i, m in enumerate(notes):
        place(x, at + i * spacing, K.pluck(hz(K.mode(m)), d, decay), gain)
    return x

def fx_pick(K): return K.pick()
def fx_place(K): return K.place()
def fx_flip(K): return K.flip()
def fx_cancel(K): return K.cancel()
def fx_click(K): return K.click()
def fx_error(K): return K.error()
def fx_same(K): return K.room(chord(K, [79, 79, 86], 0.09, 1.6, 0.45))
def fx_plus(K): return K.room(chord(K, [72, 76, 79, 84], 0.07, 1.6, 0.42))
def fx_combo(K):
    x = chord(K, [84, 88, 91, 96, 100], 0.05, 1.5, 0.38, 1.2)
    place(x, 0.1, K.glitter(0.6, 8, 88, 103, 0.18))
    if K.name == 'hollow': place(x, 0, K.gong(hz(43), 1.8) * 0.25)
    return K.room(x)
def fx_turn(K): return K.room(K.tone(hz(K.mode(81)), 1.0, 3.2, 0.5) * 0.35, 0.9)
def fx_win(K):
    x = canvas(3.2)
    plucks(K, [67, 72, 76, 79], 0.11, 0.6, 7, 0.5, 0, x)
    for m in [72, 76, 79, 84]: place(x, 0.46, K.tone(hz(K.mode(m)), 2.0, 1.4, 0.8), 0.28)
    place(x, 0.5, K.glitter(0.8, 10, 86, 100, 0.12))
    if K.name == 'hollow': place(x, 0.44, K.gong(hz(36), 2.6) * 0.3)
    return K.room(x, K.room_s * 1.3)
def fx_lose(K):
    x = canvas(2.6)
    for i, m in enumerate([69, 65, 62]): place(x, i * 0.22, K.pluck(hz(m), 0.9, 4), 0.5)   # already minor
    for m in [50, 57, 62]: place(x, 0.66, K.tone(hz(m), 1.6, 1.6, 0.3), 0.25)
    return K.room(x, K.room_s * 1.3)
def fx_draw(K):
    x = canvas(2.2)
    plucks(K, [67, 72, 74], 0.13, 0.8, 5, 0.45, 0, x)
    for m in [62, 67, 72]: place(x, 0.4, K.tone(hz(m), 1.4, 1.8, 0.4), 0.22)
    return K.room(x)
def fx_xp(K):
    x = canvas(1.0)
    for i, m in enumerate([88, 91, 95]): place(x, i * 0.07, K.tone(hz(K.mode(m)), 0.5, 7, 0.9), 0.3)
    return K.room(x, 0.6, K.room_wet * 0.7)
def fx_unlock(K):
    x = chord(K, [76, 81, 85, 88], 0.08, 1.8, 0.35, 1.1)
    place(x, 0.3, K.glitter(0.7, 10, 88, 104, 0.14))
    return K.room(x, K.room_s * 1.2)
def fx_wager_win(K):
    x = canvas(1.8)
    place(x, 0, K.swish(0.25, 900, 5000) * 0.5)
    place(x, 0.2, chord(K, [79, 83, 86], 0.06, 1.2, 0.35))
    return K.room(x)
def fx_wager_lose(K):
    x = canvas(1.8)
    place(x, 0, K.swish(0.3, 5000, 700, up=False) * 0.5)
    place(x, 0.25, K.pluck(hz(62), 1.0, 3) * 0.4)
    place(x, 0.25, K.pluck(hz(57), 1.0, 3) * 0.3)
    return K.room(x)
def fx_pack_open(K):
    x = canvas(2.0)
    place(x, 0, K.tear() * 0.8)
    place(x, 0.4, K.glitter(0.7, 12, 84, 100, 0.12))
    place(x, 0.42, K.tone(hz(K.mode(76)), 1.0, 2.5, 0.5) * 0.2)
    return K.room(x)
def fx_reveal(K, level):
    x = canvas(3.0)
    place(x, 0, K.flip() * 0.8)
    base = {1: [79], 2: [79, 84], 3: [76, 79, 84], 4: [72, 76, 79, 84, 88], 5: [67, 72, 76, 79, 84, 88, 91]}[level]
    place(x, 0.14, chord(K, base, 0.05 if level < 5 else 0.06, 1.6 + 0.2 * level, 0.3 + 0.03 * level, 0.8 + 0.1 * level))
    if level >= 4: place(x, 0.2, K.glitter(0.6 + 0.3 * (level - 4), 10 + 8 * (level - 4), 86, 104, 0.12))
    if level == 5:
        if K.name == 'hollow': place(x, 0.16, K.gong(hz(36), 2.6) * 0.35)
        else:
            for m in [43, 50]: place(x, 0.16, K.tone(hz(m), 2.0, 1.2, 0.2) * 0.3)
    return K.room(x, K.room_s * 1.3)

# ---- storms: an elemental core (same in every kit) wrapped in the kit's own instruments and room ----
def crackle(d, density=60, lo=1200, hi=7000):
    x = canvas(d)
    for _ in range(int(d * density)):
        g = int(rng.integers(int(0.002 * SR), int(0.009 * SR)))
        place(x, rng.uniform(0, d), bp(rng.standard_normal(g), lo, hi) * np.hanning(g) * rng.uniform(0.2, 1))
    return x
def roar(d, lo=60, hi=900):
    tt = t(d)
    x = band_sweep(noise(d), lo, hi, True, q=(0.7, 1.5)) * 0.6
    x += lp(sweep(140, 55, d, 1.2) * (1 + 0.5 * np.sin(2 * np.pi * 23 * tt)), 900) * 0.6
    return x * np.sin(np.pi * np.clip(tt / d, 0, 1)) ** 0.8
def fx_storm_warn(K):
    x = canvas(2.2)
    place(x, 0, lp(noise(1.6), 500) * np.sin(np.pi * np.clip(t(1.6) / 1.6, 0, 1)) ** 2 * 0.5)       # rumble swell
    for i, m in enumerate([50, 53, 57]): place(x, 0.15 + i * 0.12, K.tone(hz(m), 1.6, 1.6, 0.4), 0.3)  # ominous minor
    place(x, 0.5, K.swish(0.9, 300, 2500) * 0.3)
    return K.room(x, K.room_s * 1.2)
def fx_storm_fire(K):
    x = canvas(1.6)
    place(x, 0, roar(0.5, 200, 3000) * 0.5)
    place(x, 0.05, crackle(1.1, 90) * 0.8)
    place(x, 0.0, K.thump(120, 50, 0.4, 8) * 0.5)
    place(x, 0.2, K.tone(hz(52), 1.0, 2.5, 0.4) * 0.15)
    return K.room(x, K.room_s * 0.8)
def fx_storm_tide(K):
    x = canvas(1.6)
    w = lp(noise(1.1), 2500) * np.sin(np.pi * np.clip(t(1.1) / 1.1, 0, 1)) ** 1.5
    place(x, 0, w * 0.9)
    place(x, 0.5, hp(noise(0.6), 3000) * env_exp(int(0.6 * SR), 5) * 0.25)     # foam hiss
    for k in range(6): place(x, 0.55 + k * 0.06, Tidebound().drop(hz(int(rng.integers(70, 90))), 0.1) * 0.3)
    place(x, 0.1, K.swish(0.6, 400, 3000) * 0.3)
    return K.room(x)
def fx_storm_wind(K):
    x = canvas(1.6)
    tt = t(1.3)
    w = band_sweep(noise(1.3), 300, 2500, True, steps=16, q=(0.85, 1.2)) * (0.6 + 0.4 * np.sin(2 * np.pi * 3 * tt))
    place(x, 0, w * np.sin(np.pi * tt / 1.3) * 0.9)
    place(x, 0.1, glide(300, 900, 1.0) * np.sin(np.pi * np.clip(t(1.0), 0, 1)) * 0.06)
    place(x, 0.9, K.tick() * 0.4)
    return K.room(x)
def fx_storm_lightning(K):
    x = canvas(2.2)
    place(x, 0, hp(noise(0.08), 1500) * env_exp(int(0.08 * SR), 30, 0.0005) * 1.0)   # crack
    place(x, 0.02, crackle(0.25, 200, 2000, 9000) * 0.7)
    place(x, 0.1, lp(noise(1.8), 300) * env_exp(int(1.8 * SR), 2.2, 0.05) * 1.1)     # thunder roll
    place(x, 0.05, K.thump(90, 35, 0.6, 5) * 0.6)
    return K.room(x, K.room_s * 1.2)
def fx_storm_frost(K):
    x = canvas(1.8)
    place(x, 0, hp(noise(0.9), 4000) * np.sin(np.pi * np.clip(t(0.9) / 0.9, 0, 1)) * 0.25)
    for k in range(12): place(x, 0.15 + k * 0.05 + rng.uniform(0, 0.02), Arcane().pluck(hz(int(rng.integers(96, 110))), 0.15, 30) * rng.uniform(0.15, 0.4))
    place(x, 0.7, crackle(0.25, 120, 3000, 9000) * 0.5)   # ice setting
    place(x, 0.2, K.tone(hz(86), 1.2, 3, 0.6) * 0.15)
    return K.room(x, K.room_s * 1.1)
def fx_storm_quake(K):
    x = canvas(1.8)
    tt = t(1.2)
    place(x, 0, lp(noise(1.2), 160) * (0.7 + 0.3 * np.sin(2 * np.pi * 9 * tt)) * np.sin(np.pi * tt / 1.2) ** 0.7 * 1.6)
    for k in range(5): place(x, 0.1 + k * 0.18, K.thump(90, 40, 0.3, 10) * rng.uniform(0.4, 0.8))
    place(x, 0.3, crackle(0.8, 50, 400, 3000) * 0.5)
    return K.room(x, K.room_s * 0.7)
def fx_storm_dragon(K):
    x = canvas(2.4)
    for k in range(5):   # wingbeats
        place(x, 0.05 + k * 0.3, lp(noise(0.22), 700) * np.sin(np.pi * np.clip(t(0.22) / 0.22, 0, 1)) ** 2 * 0.8)
    place(x, 0.35, roar(1.1, 80, 1500) * 0.9)
    place(x, 0.7, crackle(0.9, 80) * 0.5)
    place(x, 0.4, K.tone(hz(45), 1.6, 1.4, 0.3) * 0.2)
    return K.room(x, K.room_s * 1.2)
def fx_ward(K):
    x = chord(K, [74, 81, 86], 0.03, 1.2, 0.35, 1.2)
    place(x, 0, K.swish(0.35, 4000, 800, up=False) * 0.35)
    place(x, 0, K.thump(300, 150, 0.12, 30) * 0.4)
    return K.room(x)

EFFECTS = {
    'pick': fx_pick, 'place': fx_place, 'flip': fx_flip, 'cancel': fx_cancel,
    'same': fx_same, 'plus': fx_plus, 'combo': fx_combo, 'turn': fx_turn,
    'win': fx_win, 'lose': fx_lose, 'draw': fx_draw,
    'xp': fx_xp, 'unlock': fx_unlock, 'wager-win': fx_wager_win, 'wager-lose': fx_wager_lose,
    'pack-open': fx_pack_open, 'click': fx_click, 'error': fx_error,
    **{f'reveal-{l}': (lambda K, l=l: fx_reveal(K, l)) for l in range(1, 6)},
    'storm-warn': fx_storm_warn, 'storm-fire': fx_storm_fire, 'storm-tide': fx_storm_tide, 'storm-wind': fx_storm_wind,
    'storm-lightning': fx_storm_lightning, 'storm-frost': fx_storm_frost, 'storm-quake': fx_storm_quake,
    'storm-dragon': fx_storm_dragon, 'ward': fx_ward,
}

def finish(x):
    x = x / (np.max(np.abs(x)) + 1e-9) * 0.9
    thr = 10 ** (-60 / 20)
    nz = np.where(np.abs(x) > thr)[0]
    x = x[: (nz[-1] + int(0.02 * SR)) if len(nz) else len(x)]
    fade = min(len(x), int(0.01 * SR))
    x[-fade:] *= np.linspace(1, 0, fade)
    return x

def write(folder, name, x):
    os.makedirs(folder, exist_ok=True)
    pcm = (np.clip(x, -1, 1) * 32767).astype('<i2')
    with tempfile.NamedTemporaryFile(suffix='.wav', delete=False) as tmp:
        with wave.open(tmp.name, 'wb') as w:
            w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR); w.writeframes(pcm.tobytes())
        path = os.path.join(folder, f'{name}.mp3')
        subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-i', tmp.name, '-codec:a', 'libmp3lame', '-b:a', '96k', path], check=True)
    os.unlink(tmp.name)
    return path

def main():
    kits = [sys.argv[1]] if len(sys.argv) > 1 else list(KITS)
    only = sys.argv[2] if len(sys.argv) > 2 else None
    for kname in kits:
        K = KITS[kname]
        folder = ROOT if kname == 'wilds' else os.path.join(ROOT, kname)
        for name, fn in EFFECTS.items():
            if only and name != only: continue
            x = finish(fn(K))
            p = write(folder, name, x)
            print(f'{kname:10s} {name:12s} {len(x) / SR:4.2f}s {os.path.getsize(p) // 1024:3d} KB')

if __name__ == '__main__':
    main()
