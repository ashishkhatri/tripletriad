#!/usr/bin/env python3
"""
Renders the original background themes for each card set to seamless MP3 loops in public/music/.
All melodies, harmonies and sounds here are composed and synthesized from scratch.

    python3 tools/genmusic.py            # all songs
    python3 tools/genmusic.py tidebound  # one song

Needs numpy, scipy and ffmpeg (with libmp3lame).
"""
import os, re, subprocess, sys, tempfile, wave
import numpy as np
from scipy.signal import fftconvolve, butter, sosfilt

SR = 44100
ROOT = os.path.join(os.path.dirname(__file__), '..', 'public', 'music')
rng = np.random.default_rng(7)

# ---------------- notes & chords ----------------
NOTE = {'C': 0, 'D': 2, 'E': 4, 'F': 5, 'G': 7, 'A': 9, 'B': 11}
def midi(name):
    m = re.fullmatch(r'([A-G])([#b]?)(-?\d)', name)
    if not m: raise ValueError(name)
    n = NOTE[m[1]] + (1 if m[2] == '#' else -1 if m[2] == 'b' else 0)
    return 12 * (int(m[3]) + 1) + n
def hz(m): return 440.0 * 2 ** ((m - 69) / 12)

QUAL = {'': [0, 4, 7], 'm': [0, 3, 7], 'dim': [0, 3, 6], 'sus2': [0, 2, 7], 'sus4': [0, 5, 7], '7': [0, 4, 7, 10], 'm7': [0, 3, 7, 10], 'maj7': [0, 4, 7, 11], 'add9': [0, 4, 7, 14]}
def chord(name, octave=3):
    m = re.fullmatch(r'([A-G][#b]?)(.*)', name)
    root = midi(m[1] + str(octave))
    return [root + i for i in QUAL[m[2]]]

def parse_line(s):
    """Space-separated steps: note name, '-' to hold the previous note, '.' for rest. '|' is ignored."""
    toks = [t for t in s.split() if t != '|']
    events, i = [], 0
    while i < len(toks):
        t = toks[i]
        if t in ('-', '.'):
            i += 1; continue
        length = 1
        while i + length < len(toks) and toks[i + length] == '-':
            length += 1
        events.append((i, midi(t), length))
        i += length
    return events, len(toks)

# ---------------- instruments ----------------
def t_axis(dur): return np.arange(int(dur * SR)) / SR

def adsr(n, a, d, s, r, sus_len):
    a, d, r = int(a * SR), int(d * SR), int(r * SR)
    env = np.zeros(n)
    sl = max(int(sus_len * SR), a + d)
    env[:a] = np.linspace(0, 1, a, endpoint=False) if a else 1
    env[a:a + d] = np.linspace(1, s, d, endpoint=False) if d else s
    env[a + d:sl] = s
    rel = np.linspace(s, 0, r) if r else np.array([])
    end = min(n, sl + len(rel))
    env[sl:end] = rel[:end - sl]
    return env

def harp(f, dur, vel):
    t = t_axis(2.4)
    x = (np.sin(2 * np.pi * f * t) * np.exp(-t * 2.2)
         + 0.45 * np.sin(2 * np.pi * 2 * f * t) * np.exp(-t * 4)
         + 0.2 * np.sin(2 * np.pi * 3 * f * t) * np.exp(-t * 7)
         + 0.08 * np.sin(2 * np.pi * 4.02 * f * t) * np.exp(-t * 11))
    x[:120] *= np.linspace(0, 1, 120)
    return x * vel * 0.55

def pluck(f, dur, vel):
    t = t_axis(1.0)
    x = sum((0.7 ** k) * np.sin(2 * np.pi * (k + 1) * f * t) * np.exp(-t * (6 + 5 * k)) for k in range(6))
    x[:60] *= np.linspace(0, 1, 60)
    return x * vel * 0.5

def flute(f, dur, vel):
    n_dur = dur + 0.18
    t = t_axis(n_dur)
    vib = 1 + 0.004 * np.sin(2 * np.pi * 5.2 * t) * np.clip((t - 0.18) / 0.3, 0, 1)
    ph = 2 * np.pi * np.cumsum(f * vib) / SR
    x = np.sin(ph) + 0.18 * np.sin(2 * ph) + 0.06 * np.sin(3 * ph)
    breath = rng.standard_normal(len(t)) * 0.04
    breath = sosfilt(butter(2, [f * 0.8, min(f * 3, 15000)], 'bandpass', fs=SR, output='sos'), breath)
    env = adsr(len(t), 0.07, 0.1, 0.85, 0.16, dur)
    return (x + breath * 3) * env * vel * 0.42

def bell(f, dur, vel):
    t = t_axis(3.2)
    parts = [(1, 1, 1.4), (2.76, 0.45, 2.6), (5.40, 0.22, 4.2), (8.93, 0.10, 6.5), (0.5, 0.18, 1.0)]
    x = sum(a * np.sin(2 * np.pi * f * r * t) * np.exp(-t * d) for r, a, d in parts)
    x[:80] *= np.linspace(0, 1, 80)
    return x * vel * 0.4

def pad(freqs, dur, vel, bright=8):
    t = t_axis(dur + 1.2)
    x = np.zeros(len(t))
    for f in freqs:
        for det in (-0.006, 0.0, 0.0055):
            ff = f * (1 + det)
            for k in range(1, bright + 1):
                x += (1 / k) * np.sin(2 * np.pi * ff * k * t + rng.uniform(0, 6.28)) * (0.75 ** (k - 1))
    env = adsr(len(t), 0.7, 0.4, 0.8, 1.1, dur)
    return x * env * vel * 0.05 / len(freqs)

def bass(f, dur, vel):
    t = t_axis(max(dur, 0.3) + 0.2)
    x = np.sin(2 * np.pi * f * t) + 0.25 * np.sin(2 * np.pi * 2 * f * t) + 0.08 * np.sin(2 * np.pi * 3 * f * t)
    env = adsr(len(t), 0.01, 0.25, 0.55, 0.18, dur)
    return x * env * vel * 0.5

def drum(kind, vel):
    if kind == 'k':   # soft frame drum
        t = t_axis(0.45)
        f = 55 + 70 * np.exp(-t * 22)
        x = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 7)
        return x * vel * 0.8
    if kind == 't':   # higher hand drum
        t = t_axis(0.3)
        f = 150 + 60 * np.exp(-t * 30)
        return np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 12) * vel * 0.45
    if kind == 'h':   # shaker / tambourine tick
        t = t_axis(0.08)
        x = sosfilt(butter(4, 6000, 'highpass', fs=SR, output='sos'), rng.standard_normal(len(t)))
        return x * np.exp(-t * 60) * vel * 0.12
    return np.zeros(1)

INSTR = {'harp': harp, 'pluck': pluck, 'flute': flute, 'bell': bell, 'bass': bass}

# ---------------- songs (original compositions) ----------------
SONGS = {
    # Bright adventuring tune in D dorian.
    'wilds': dict(
        title='Over the Wild Ridge', bpm=100, sub=2, steps=8,
        chords=['Dm', 'C', 'G', 'Dm', 'F', 'C', 'G', 'A'],
        lead='flute', lead2='harp',
        melody='''D5 - A4 - F4 G4 A4 - | G4 - E4 - C5 - B4 A4 | B4 - D5 - G4 - A4 B4 | A4 - - - . . D4 E4 |
                  F4 - A4 - C5 - D5 C5 | E5 - D5 C5 G4 - . . | D5 - B4 G4 A4 - B4 D5 | C#5 - A4 - E4 - - -''',
        arp='harp', arp_pat=[0, 1, 2, 3, 2, 1, 2, 1], arp_oct=3,
        bass='R . . . F . R .', drums='k . h . k t h .', pad=True),
    # Stately, mysterious court theme in A minor.
    'arcane': dict(
        title='The Archmage’s Court', bpm=78, sub=2, steps=8,
        chords=['Am', 'F', 'Dm', 'E', 'Am', 'G', 'F', 'E'],
        lead='bell', lead2='flute',
        melody='''E5 - - - A4 - C5 - | F5 - E5 - C5 - A4 - | D5 - - F5 E5 - D5 - | B4 - - - G#4 - - - |
                  A4 - C5 - E5 - A5 - | G5 - F5 E5 D5 - B4 - | C5 - A4 - F5 - E5 D5 | E5 - - - - - . .''',
        arp='harp', arp_pat=[0, 2, 1, 2, 3, 2, 1, 2], arp_oct=3,
        bass='R . . . . . . .', drums='', pad=True),
    # Spacious, shimmering theme in F lydian.
    'starfall': dict(
        title='Lights Beyond the Sky', bpm=92, sub=2, steps=8,
        chords=['F', 'G', 'Em', 'Am', 'F', 'G', 'C', 'Cadd9'],
        lead='bell', lead2='pluck',
        melody='''C5 . F5 . G5 - A5 - | B5 - A5 - G5 . D5 . | E5 - - - G5 - B4 - | C5 - - - - - . . |
                  A5 . G5 . F5 . E5 . | D5 - B4 - G4 - B4 D5 | E5 - G5 - C6 - B5 - | G5 - - - - - . .''',
        arp='pluck', arp_pat=[0, 1, 2, 3, 0, 1, 2, 3], arp_oct=4,
        bass='R . R . R . R .', drums='k . . h . . h .', pad=True),
    # Rolling sea song in E minor, lilting three-beat feel.
    'tidebound': dict(
        title='Song of the Tidewaters', bpm=76, sub=2, steps=6,
        chords=['Em', 'C', 'G', 'D', 'Em', 'Am', 'B', 'Em'],
        lead='flute', lead2='bell',
        melody='''B4 - E5 - G5 F#5 | E5 - - - D5 C5 | B4 - D5 - G5 - | F#5 - E5 - D5 - |
                  E5 - G5 - B5 - | A5 - G5 - E5 - | F#5 - D#5 - B4 - | E5 - - - - .''',
        arp='harp', arp_pat=[0, 1, 2, 3, 2, 1], arp_oct=3,
        bass='R . . F . .', drums='k . . t . .', pad=True),
    # Playful woodland dance in G major.
    'bloomwild': dict(
        title='Dance of the Greenwood', bpm=116, sub=2, steps=8,
        chords=['G', 'C', 'D', 'G', 'Em', 'C', 'D', 'G'],
        lead='flute', lead2='pluck',
        melody='''G4 B4 D5 B4 G5 - D5 - | E5 - C5 E5 G5 - E5 - | F#5 - A5 F#5 D5 - A4 - | B4 - G4 - . . D5 . |
                  E5 G5 B5 G5 E5 - B4 - | C5 - E5 - G5 F#5 E5 - | D5 - F#5 - A5 G5 F#5 E5 | G5 - - - . . . .''',
        arp='pluck', arp_pat=[0, 2, 1, 2, 0, 2, 1, 2], arp_oct=3,
        bass='R . . . F . . .', drums='k . h . k . h h', pad=False),
    # Eerie music-box lullaby in B minor.
    'hollow': dict(
        title='Lanterns in the Hollow', bpm=64, sub=2, steps=8,
        chords=['Bm', 'G', 'Em', 'F#', 'Bm', 'D', 'Em', 'F#'],
        lead='bell', lead2='flute',
        melody='''F#5 - D5 - B4 - C#5 D5 | B4 - - - G4 - - - | G5 - F#5 - E5 - B4 - | A#4 - - - C#5 - - - |
                  D5 - F#5 - B5 - A5 - | F#5 - - E5 D5 - A4 - | G5 - E5 - C#5 - A#4 - | B4 - - - - - . .''',
        arp='harp', arp_pat=[0, None, 2, None, 1, None, 2, None], arp_oct=3,
        bass='R . . . . . . .', drums='', pad=True),
}

# ---------------- renderer ----------------
def reverb_ir(seconds=2.4, damp=3000):
    n = int(seconds * SR)
    t = np.arange(n) / SR
    irs = []
    for _ in range(2):
        x = rng.standard_normal(n) * np.exp(-t * 3.2)
        x = sosfilt(butter(2, damp, 'lowpass', fs=SR, output='sos'), x)
        x[:int(0.012 * SR)] = 0
        irs.append(x / np.sqrt(np.sum(x ** 2)))
    return irs

def add(buf, start, sig, pan=0.0, gain=1.0):
    i = int(start * SR)
    if i >= buf.shape[1]: return
    j = min(buf.shape[1], i + len(sig))
    l, r = np.cos((pan + 1) * np.pi / 4), np.sin((pan + 1) * np.pi / 4)
    buf[0, i:j] += sig[:j - i] * l * gain
    buf[1, i:j] += sig[:j - i] * r * gain

def render(song):
    step = 60 / song['bpm'] / song['sub']
    bar = step * song['steps']
    nbars = len(song['chords'])
    passes = 2
    total = bar * nbars * passes
    tail = 4.0
    dry = np.zeros((2, int((total + tail) * SR)))
    mel, mel_len = parse_line(song['melody'])
    assert mel_len == song['steps'] * nbars, f"{song['title']}: melody has {mel_len} steps, expected {song['steps'] * nbars}"
    bass_pat = song['bass'].split()
    drum_pat = song['drums'].split() if song['drums'] else []

    for p in range(passes):
        base = p * bar * nbars
        for b, cname in enumerate(song['chords']):
            t0 = base + b * bar
            tones = chord(cname, song['arp_oct'])
            ext = tones + [tones[0] + 12, tones[1] + 12]
            # arpeggio
            for s, idx in enumerate(song['arp_pat']):
                if idx is None: continue
                m = ext[idx % len(ext)]
                v = 0.55 if s % 2 == 0 else 0.4
                add(dry, t0 + s * step, INSTR[song['arp']](hz(m), step, v), pan=-0.35 + 0.1 * (s % 3))
            # pad
            if song['pad']:
                add(dry, t0, pad([hz(x) for x in chord(cname, 3)], bar, 0.9), pan=0.0)
            # bass
            root = chord(cname, 2)[0]
            for s, tok in enumerate(bass_pat):
                if tok == '.': continue
                m = root + (7 if tok == 'F' else 0)
                add(dry, t0 + s * step, bass(hz(m), step * 2, 0.75), pan=0.0)
            # drums (second pass a little fuller)
            for s, tok in enumerate(drum_pat):
                if tok == '.': continue
                if p == 0 and tok == 'h' and s % 4 == 3: continue
                add(dry, t0 + s * step, drum(tok, 0.8), pan=0.15 if tok == 'h' else 0.0)
        # melody: first pass lead, second pass lead2 doubled with lead an octave down quietly
        for s, m, ln in mel:
            t = base + s * step
            if p == 0:
                add(dry, t, INSTR[song['lead']](hz(m), ln * step, 0.8), pan=0.2)
            else:
                add(dry, t, INSTR[song['lead2']](hz(m), ln * step, 0.75), pan=0.25)
                add(dry, t, INSTR[song['lead']](hz(m - 12), ln * step, 0.4), pan=-0.15)

    irL, irR = reverb_ir()
    wetL = fftconvolve(dry[0], irL)[:dry.shape[1]]
    wetR = fftconvolve(dry[1], irR)[:dry.shape[1]]
    mix = dry * 0.82 + np.vstack([wetL, wetR]) * 0.42

    # seamless loop: fold the tail back onto the start
    n = int(total * SR)
    out = mix[:, :n].copy()
    tail_part = mix[:, n:]
    out[:, :tail_part.shape[1]] += tail_part
    out = np.tanh(out / np.max(np.abs(out)) * 1.3) / np.tanh(1.3) * 0.89
    return out, total

def write_mp3(name, audio):
    os.makedirs(ROOT, exist_ok=True)
    pcm = (np.clip(audio.T, -1, 1) * 32767).astype('<i2')
    with tempfile.NamedTemporaryFile(suffix='.wav', delete=False) as tmp:
        with wave.open(tmp.name, 'wb') as w:
            w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR); w.writeframes(pcm.tobytes())
        path = os.path.join(ROOT, f'{name}.mp3')
        subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-i', tmp.name, '-codec:a', 'libmp3lame', '-b:a', '128k', path], check=True)
    os.unlink(tmp.name)
    return path

def main():
    only = sys.argv[1] if len(sys.argv) > 1 else None
    for name, song in SONGS.items():
        if only and name != only: continue
        audio, secs = render(song)
        path = write_mp3(name, audio)
        print(f'{name:10s} {song["title"]:28s} {secs:5.1f}s  {os.path.getsize(path) // 1024} KB')

if __name__ == '__main__':
    main()
