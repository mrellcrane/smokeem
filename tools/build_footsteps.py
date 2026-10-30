# Build the footstep sounds (step-N, stepMetal-N, stepDirt-N, stepWood-N, stepMud-N) from CC0
# recordings on OpenGameArt (see src/audio/samples/CREDITS.md), shaped to sound like a Spartan's
# boots in Halo: pitched down for weight, low-passed so nothing clicks, a soft sub-thump under
# each, and a faint armor jingle a beat after the heel.
#
# Usage: python3 tools/build_footsteps.py <downloads> src/audio/samples
# Needs numpy and ffmpeg. <downloads> holds the unpacked packs:
#   fant/Fantozzi-footsteps/flac/*.flac   Fantozzi's Footsteps (Grass/Sand & Stone)
#   metal/metal_steps_NN.wav              Metal Footsteps on Concrete
#   armor/footsteps/step_metal*.ogg       Footsteps (Leather, Cloth, Armor)
import os
import subprocess
import sys

import numpy as np

SR = 44100
S = sys.argv[1]
OUT = sys.argv[2]
rng = np.random.default_rng(11)


def load(path):
    raw = subprocess.run(
        ['ffmpeg', '-v', 'error', '-i', path, '-ac', '1', '-ar', str(SR), '-f', 'f32le', '-'],
        capture_output=True,
        check=True,
    ).stdout
    return np.frombuffer(raw, dtype=np.float32).astype(np.float64)


def spectral(x, fn):
    # Apply a gain curve fn(freq) in the frequency domain.
    n = len(x)
    X = np.fft.rfft(x, n * 2)
    f = np.fft.rfftfreq(n * 2, 1 / SR)
    return np.fft.irfft(X * fn(f))[:n]


def lowpass(x, fc, order=2):
    return spectral(x, lambda f: 1 / np.sqrt(1 + (f / fc) ** (2 * order)))


def highpass(x, fc):
    return spectral(x, lambda f: 1 / np.sqrt(1 + (fc / np.maximum(f, 1e-3)) ** 4))


def peak(x, fc, q, gain_db):
    # A soft resonant bump (wood's hollow body).
    g = 10 ** (gain_db / 20) - 1
    return spectral(x, lambda f: 1 + g * np.exp(-0.5 * ((f - fc) / (fc / q)) ** 2))


def repitch(x, ratio):
    # Slower and lower (ratio < 1), by resampling.
    n = int(len(x) / ratio)
    return np.interp(np.arange(n) * ratio, np.arange(len(x)), x)


def trim(x, length):
    # From the first sample above 6% of the peak, for `length` seconds, faded out.
    a = max(0, int(np.argmax(np.abs(x) > np.abs(x).max() * 0.06)) - int(0.002 * SR))
    y = x[a : a + int(length * SR)].copy()
    n = int(0.06 * SR)
    y[-n:] *= 0.5 + 0.5 * np.cos(np.linspace(0, np.pi, n))
    y[: int(0.002 * SR)] *= np.linspace(0, 1, int(0.002 * SR))
    return y


def thump(length, freq, level):
    t = np.arange(int(length * SR)) / SR
    f = freq * (1 + 0.6 * np.exp(-t * 40))
    return level * np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 28) * (1 - np.exp(-t * 900))


def write(name, y):
    y = highpass(y, 35)
    y = y / max(1e-9, np.abs(y).max()) * 10 ** (-3 / 20)
    pcm = (np.clip(y, -1, 1) * 32767).astype('<i2').tobytes()
    # (Everything is low-passed under about 4 kHz, so half the rate loses nothing.)
    subprocess.run(
        ['ffmpeg', '-v', 'error', '-y', '-f', 's16le', '-ar', str(SR), '-ac', '1', '-i', '-', '-ar', '22050', os.path.join(OUT, name + '.wav')],
        input=pcm,
        check=True,
    )
    print(name, f'{len(y) / SR:.2f}s')


def jingle():
    # A faint armor jingle, from a different take each time.
    i = rng.integers(0, 3)
    p = os.path.join(S, 'armor/footsteps', ['step_metal.ogg', 'step_metal (2).ogg', 'step_metal (3).ogg'][i])
    return lowpass(trim(load(p), 0.2), 3500)


def build(name, paths, pitch, lp, thump_hz, thump_lv, jingle_lv, length=0.28, extra=None):
    for i, p in enumerate(paths):
        x = load(os.path.join(S, p))
        x = trim(x, length / pitch + 0.02)
        x = repitch(x, pitch)[: int(length * SR)]
        x = x / np.abs(x).max()
        x = lowpass(x, lp)
        if extra:
            x = extra(x)
        y = x + thump(len(x) / SR, thump_hz, thump_lv)
        j = jingle()
        d = int((0.02 + rng.random() * 0.02) * SR)
        n = min(len(j), len(y) - d)
        y[d : d + n] += jingle_lv * j[:n] / np.abs(j).max()
        write(f'{name}-{i + 1}', y)


F = 'fant/Fantozzi-footsteps/flac/Fantozzi-'
stone = [F + s + '.flac' for s in ('StoneL1', 'StoneR1', 'StoneL2', 'StoneR2')]
sand = [F + s + '.flac' for s in ('SandL1', 'SandR1', 'SandL2', 'SandR2')]
build('step', stone, 0.85, 2600, 70, 0.55, 0.12)
build('stepDirt', sand, 0.85, 2200, 65, 0.5, 0.1)
build('stepMetal', ['metal/metal_steps_%02d.wav' % n for n in (1, 6, 8, 16)], 0.88, 4200, 80, 0.4, 0.14)
build('stepWood', stone, 0.8, 1800, 95, 0.45, 0.1, extra=lambda x: peak(x, 260, 3, 9))
build('stepMud', sand[::-1], 0.7, 1100, 55, 0.6, 0.06, length=0.34)
