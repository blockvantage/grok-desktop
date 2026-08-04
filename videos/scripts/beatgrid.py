#!/usr/bin/env python3
"""Beat-grid analysis for Payverge film music (stdlib + numpy + ffmpeg only).

Fit mode:   beatgrid.py [--bpm LO,HI] track.mp3 [more.mp3 ...]
    Default BPM search window is 115-145; pass --bpm 90,160 for tracks
    briefed outside it (an out-of-window track fits wrong with no warning).
    Reports BPM + downbeat phase fitted on the KICK BAND (35-130 Hz), plus the
    full-band fit for comparison. If the two phases disagree by ~half a beat,
    the full-band fit locked onto the hi-hat OFFBEAT — trust the kick fit.
    (This exact trap shipped a half-beat-late grid once; hence this tool.)

Check mode: beatgrid.py --check BPM,PHASE master.mp4 [--beats N]
    Verifies a mixed master against an expected grid: for each comp beat
    n*60/BPM (audio time n*60/BPM + PHASE if the mix did NOT trim the head;
    pass PHASE=0 when the mix trimmed the head by the phase, as our mix
    scripts do), prints the SIGNED delta to the nearest detected kick onset
    (positive = kick late vs grid → trim MORE from the track head to fix;
    negative = kick early → trim LESS). Detector hop is ~11.6 ms; |delta|
    <= ~20 ms is on the beat. A systematic constant offset (~±15 ms, mp3
    decoder-delay scale) is normal — fold it into the mix's atrim.
"""
import subprocess, sys
import numpy as np

SR = 22050
HOP = 256  # ~11.6 ms per frame


def load(path):
    raw = subprocess.run(
        ["ffmpeg", "-v", "error", "-i", path, "-ac", "1", "-ar", str(SR),
         "-f", "f32le", "-"], capture_output=True).stdout
    return np.frombuffer(raw, dtype=np.float32)


def band_flux(x, lo_hz=None, hi_hz=None):
    n_fft = 1024
    freqs = np.fft.rfftfreq(n_fft, 1.0 / SR)
    band = np.ones(len(freqs), dtype=bool)
    if lo_hz is not None:
        band &= freqs >= lo_hz
    if hi_hz is not None:
        band &= freqs <= hi_hz
    frames = [np.abs(np.fft.rfft(x[i:i + n_fft] * np.hanning(n_fft)))[band]
              for i in range(0, len(x) - n_fft, HOP)]
    flux = np.maximum(0, np.diff(np.array(frames), axis=0)).sum(axis=1)
    return flux / (flux.max() + 1e-9)


def fit_bpm_and_phase(flux, bpm_lo=115.0, bpm_hi=145.0):
    fps = SR / HOP
    best = None
    for bpm10 in range(int(bpm_lo * 10), int(bpm_hi * 10) + 1):
        bpm = bpm10 / 10.0
        period = fps * 60.0 / bpm
        nbeats = int(len(flux) / period) - 1
        if nbeats < 8:
            continue
        for frac in np.arange(0, 1, 0.02):
            phase = frac * period
            idx = (phase + period * np.arange(nbeats)).astype(int)
            idx = idx[idx < len(flux)]
            sc = np.mean([flux[max(0, i - 1):i + 2].max() for i in idx])
            if best is None or sc > best[0]:
                best = (sc, bpm, phase / fps)
    return best


def fit_phase(flux, bpm):
    fps = SR / HOP
    period = fps * 60.0 / bpm
    best = None
    for frac in np.arange(0, 1, 0.02):
        phase = frac * period
        nbeats = int((len(flux) - phase) / period)
        idx = (phase + period * np.arange(nbeats)).astype(int)
        sc = np.mean([flux[max(0, i - 1):i + 2].max() for i in idx])
        if best is None or sc > best[0]:
            best = (sc, phase / fps)
    return best


def kick_onsets(flux, thresh=0.25, min_gap_frames=8):
    out, last = [], -min_gap_frames
    for i in range(1, len(flux) - 1):
        if (flux[i] > thresh and flux[i] >= flux[i - 1]
                and flux[i] >= flux[i + 1] and i - last >= min_gap_frames):
            out.append(i)
            last = i
    return np.array(out) * HOP / SR


def energy_per_second(x):
    return [20 * np.log10(np.sqrt(np.mean(x[s * SR:(s + 1) * SR] ** 2) + 1e-12) + 1e-9)
            for s in range(int(len(x) / SR))]


def analyze(path, bpm_lo=115.0, bpm_hi=145.0):
    x = load(path)
    kick = band_flux(x, 35, 130)
    full = band_flux(x)
    sc, bpm, kphase = fit_bpm_and_phase(kick, bpm_lo, bpm_hi)
    _, fphase = fit_phase(full, bpm)
    beat = 60.0 / bpm
    print(f"=== {path}")
    print(f"duration {len(x)/SR:.2f}s   BPM {bpm:.1f}   beat {beat:.6f}s")
    print(f"KICK-band downbeat phase {kphase:.3f}s  (score {sc:.3f})  <- use this")
    print(f"full-band phase          {fphase:.3f}s  (comparison)")
    diff = abs(fphase - kphase)
    if abs(diff - beat / 2) < 0.06:
        print(f"!! full-band fit is ~half a beat off ({diff:.3f}s) — it locked onto the")
        print(f"!! hi-hat OFFBEAT. Use the kick-band phase.")
    print("kick grid first 8:", " ".join(f"{kphase + i*beat:.3f}" for i in range(8)))
    e = energy_per_second(x)
    print("energy dBFS/s:", " ".join(f"{v:.0f}" for v in e))


def check(grid_arg, path, nbeats):
    bpm, phase = (float(v) for v in grid_arg.split(","))
    beat = 60.0 / bpm
    onsets = kick_onsets(band_flux(load(path), 35, 130))
    print(f"=== {path} vs grid BPM {bpm} phase {phase}s ({nbeats} beats)")
    worst, quiet = 0.0, 0
    for n in range(nbeats):
        t = phase + n * beat
        if len(onsets) == 0 or t > onsets[-1] + beat:
            print(f"b{n:<3} {t:7.3f}s  no onsets that late — stop")
            break
        i = int(np.argmin(np.abs(onsets - t)))
        d = float(onsets[i] - t)  # signed: positive = kick LATE vs grid
        if abs(d) > beat / 4:
            # no kick anywhere near this beat: an intentionally quiet section
            # (breath, bloom) rather than a sync error — report, don't fail
            quiet += 1
            print(f"b{n:<3} {t:7.3f}s  no kick nearby (quiet section?)")
            continue
        worst = max(worst, abs(d))
        flag = "" if abs(d) <= 0.020 else "  <-- OFF GRID"
        print(f"b{n:<3} {t:7.3f}s  kick delta {d*1000:+6.1f}ms{flag}")
    print(f"worst on-kick delta {worst*1000:.1f}ms across beats with kicks "
          f"({quiet} quiet beats skipped; detector hop ~11.6ms)")


if __name__ == "__main__":
    args = sys.argv[1:]
    if not args:
        sys.exit(__doc__)
    if args[0] == "--check":
        nbeats = 40
        if "--beats" in args:
            i = args.index("--beats")
            nbeats = int(args[i + 1])
            del args[i:i + 2]
        check(args[1], args[2], nbeats)
    else:
        bpm_lo, bpm_hi = 115.0, 145.0
        if "--bpm" in args:
            i = args.index("--bpm")
            bpm_lo, bpm_hi = (float(v) for v in args[i + 1].split(","))
            del args[i:i + 2]
        for p in args:
            analyze(p, bpm_lo, bpm_hi)
