# Cut, layer and master the game's recorded sounds into small mono WAVs.
# Sources are CC0 packs from OpenGameArt (see src/audio/samples/CREDITS.md).
#
# Usage: python3 tools/build_sounds.py <downloads> src/audio/samples
# Needs numpy and ffmpeg. <downloads> holds the unpacked packs:
#   ffsl/x/Prepared SFX Library/...   The Free Firearm Sound Library ("Prepared SFX Library.7z")
#   sg/x/ShotgunSounds/...            Shotgun Reload Sound Effects (shotgunsounds.zip)
#   rl/assaultriflereload1_0.wav      Gun reload sounds
#   rl/gunreload1.wav                 Gun reload sounds
#   bang/x/*.ogg                      25 CC0 bang / firework SFX (25-CC0-bang-sfx.zip)
import os
import subprocess
import sys

import numpy as np

SR = 48000
OUT_SR = 44100
S = sys.argv[1]  # scratchpad dl directory
OUT = sys.argv[2]
L = os.path.join(S, 'ffsl/x/Prepared SFX Library')
rng = np.random.default_rng(7)


def load(path):
    raw = subprocess.run(
        ['ffmpeg', '-v', 'error', '-i', path, '-ac', '1', '-ar', str(SR), '-f', 'f32le', '-'],
        capture_output=True,
        check=True,
    ).stdout
    return np.frombuffer(raw, dtype=np.float32).astype(np.float64)


def onset_near(x, t, search=0.05):
    # Snap to the first sample above 8% of the local peak, searching around t.
    a = int(max(0, t - search) * SR)
    b = int((t + search) * SR)
    seg = np.abs(x[a:b])
    pk = seg.max()
    idx = np.argmax(seg > pk * 0.08)
    return (a + idx) / SR


def cut(x, t0, length, pre=0.003, fade=0.3, fade_in=0.002):
    a = int(max(0, t0 - pre) * SR)
    b = min(len(x), a + int(length * SR))
    y = x[a:b].copy()
    n_in = max(1, int(fade_in * SR))
    y[:n_in] *= np.linspace(0, 1, n_in)
    n_out = int(fade * SR)
    if n_out > 0:
        # Cosine fade so tails die out smoothly.
        y[-n_out:] *= 0.5 + 0.5 * np.cos(np.linspace(0, np.pi, n_out))
    return y


def master(y, peak_db=-1.0):
    # High-pass at ~25 Hz to remove DC and rumble, then fade the edges again.
    y = y - lowpass(y, 25)
    n = int(0.003 * SR)
    y[:n] *= np.linspace(0, 1, n)
    y[-n:] *= np.linspace(1, 0, n)
    pk = np.abs(y).max()
    return y * (10 ** (peak_db / 20) / pk)


def mix(*parts):
    n = max(len(p) for p, _, _ in parts)
    out = np.zeros(n)
    for p, gain_db, offset in parts:
        o = int(offset * SR)
        seg = p[: n - o]
        out[o : o + len(seg)] += seg * 10 ** (gain_db / 20)
    return out


def lowpass(x, hz):
    # One-pole low-pass, applied forwards and backwards (no phase shift).
    a = np.exp(-2 * np.pi * hz / SR)
    y = np.empty_like(x)
    for direction in (1, -1):
        src = x if direction == 1 else y[::-1].copy()
        acc = 0.0
        out = np.empty_like(src)
        for i in range(len(src)):
            acc = (1 - a) * src[i] + a * acc
            out[i] = acc
        if direction == 1:
            y = out
        else:
            y = out[::-1]
    return y


def sub_thump(length, f0=70, f1=32, decay=0.55):
    # A falling sine for the chest-thump that small recordings lack.
    t = np.arange(int(length * SR)) / SR
    f = f1 + (f0 - f1) * np.exp(-t * 6)
    phase = 2 * np.pi * np.cumsum(f) / SR
    env = np.exp(-t / decay) * np.minimum(1, t / 0.004)
    # Fade the last 30% so the sine never stops abruptly.
    n = int(len(t) * 0.3)
    env[-n:] *= 0.5 + 0.5 * np.cos(np.linspace(0, np.pi, n))
    return np.sin(phase) * env


def whoosh(length):
    # Rocket motor: filtered noise that swells, roars, then thins out.
    n = int(length * SR)
    t = np.arange(n) / SR
    noise = rng.standard_normal(n)
    body = lowpass(noise, 900)
    hiss = noise - lowpass(noise, 2500)
    env = np.minimum(1, t / 0.05) * np.exp(-np.maximum(0, t - 0.15) / 0.45)
    crackle = (rng.random(n) < 0.0025) * rng.standard_normal(n) * 3
    return (body * 3.2 + hiss * 0.35 + lowpass(crackle, 3000)) * env


def write(name, y):
    path = os.path.join(OUT, f'{name}.wav')
    data = (np.clip(y, -1, 1) * 32767).astype('<i2').tobytes()
    subprocess.run(
        [
            'ffmpeg', '-v', 'error', '-y', '-f', 's16le', '-ar', str(SR), '-ac', '1', '-i', '-',
            '-ar', str(OUT_SR), '-c:a', 'pcm_s16le', path,
        ],
        input=data,
        check=True,
    )
    print(f'{name:14s} {len(y) / SR:5.2f}s  {os.path.getsize(path) // 1024:4d} KB')


os.makedirs(OUT, exist_ok=True)

# Hickory: AK-47 single shots, near the shooter. Four takes for variety.
ak = load(f'{L}/AK-47/C_28P.wav')
for i, t in enumerate([0.610, 3.255, 6.020, 9.155]):
    write(f'shot-{i + 1}', master(cut(ak, onset_near(ak, t), 0.62, fade=0.32)))

# Mesquite: Benelli Nova 12 gauge pump, two takes, plus the pump rack and shell loads.
nova = load(f'{L}/Nova/O_21P.wav')
for i, t in enumerate([0.430, 3.465]):
    shot = cut(nova, onset_near(nova, t), 0.85, fade=0.5)
    write(f'shotgun-{i + 1}', master(mix((shot, 0, 0), (sub_thump(0.5, 90, 45, 0.12), -9, 0))))
rack = load(f'{S}/sg/x/ShotgunSounds/Rack.mp3')
write('pump', master(cut(rack, onset_near(rack, 0.63, 0.1), 0.5, pre=0.01, fade=0.12), -3))
shells = load(f'{S}/sg/x/ShotgunSounds/Shell in Chamber.mp3')
write('shell-1', master(cut(shells, onset_near(shells, 0.51), 0.4, pre=0.01, fade=0.15), -4))
write('shell-2', master(cut(shells, onset_near(shells, 1.07), 0.35, pre=0.01, fade=0.12), -11.5))

# Rifle reload (magazine out, in, charging handle) and the clack of bringing a gun up.
rl = load(f'{S}/rl/assaultriflereload1_0.wav')
write('reload', master(cut(rl, 0.17, 1.39, pre=0, fade=0.2), -3))
gr = load(f'{S}/rl/gunreload1.wav')
write('swap', master(cut(gr, onset_near(gr, 1.275), 0.3, pre=0.01, fade=0.12), -5))

# Explosions: recorded cannon and firework bangs over a synthesized sub-bass thump.
bang = lambda n: load(f'{S}/bang/x/{n}.ogg')
c2, b3, b9, f6 = bang('cannon_02'), bang('bang_03'), bang('bang_09'), bang('fw_06')
boom1 = mix(
    (cut(c2, onset_near(c2, 0.005), 1.8, fade=0.9), 0, 0),
    (cut(b3, onset_near(b3, 0.075), 1.0, fade=0.6), -4, 0.004),
    (sub_thump(1.4, 75, 30, 0.6), -2, 0),
)
write('boom-1', master(boom1))
boom2 = mix(
    (cut(b9, onset_near(b9, 0.0), 1.1, fade=0.6), 0, 0),
    (cut(f6, onset_near(f6, 0.005), 1.4, fade=0.8), -3, 0.006),
    (sub_thump(1.4, 65, 28, 0.65), -2, 0),
)
write('boom-2', master(boom2))

# Smoke Signal launch: a recorded bang for the ignition kick, then a rocket roar.
s1 = load(f'{S}/bang/x/shot_01.ogg')
launch = mix(
    (cut(s1, onset_near(s1, 0.0), 0.45, fade=0.3), -2, 0),
    (whoosh(1.3), -3, 0.02),
    (sub_thump(0.5, 80, 40, 0.18), -6, 0),
)
write('launch', master(cut(launch, 0.0, 1.3, pre=0, fade=0.5)))

# Toothpick: Walther PPQ 9mm pistol. Kindling: Carl Gustav M45 9mm SMG. Cold Smoke: SKS.
for name, path, onsets, length in [
    ('pistol', 'Walther PPQ/X_39P.wav', [1.405, 6.44, 10.66], 0.45),
    ('smg', 'Carl Gustav M45/G_31P.wav', [0.31, 3.5, 6.725], 0.45),
    ('marksman', 'SKS/U_14P.wav', [3.575, 6.755, 10.21], 0.75),
]:
    x = load(f'{L}/{path}')
    for i, t in enumerate(onsets):
        write(f'{name}-{i + 1}', master(cut(x, onset_near(x, t), length, fade=length * 0.5)))

# Pistol reload: the whole short reload (mag out, mag in, slide) from the reload pack.
write('reloadPistol', master(cut(gr, 0.05, 1.5, pre=0, fade=0.15), -4))
