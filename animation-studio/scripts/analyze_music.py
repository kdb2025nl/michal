"""Music analysis with librosa + NumPy -> music-analysis.json (beats, onsets, energy, silences)."""
import json, sys
import numpy as np
import librosa


def main(src, dst):
    y, sr = librosa.load(src, sr=22050, mono=True)
    dur = float(len(y) / sr)
    hop = 512
    oenv = librosa.onset.onset_strength(y=y, sr=sr, hop_length=hop)
    tempo, beat_frames = librosa.beat.beat_track(onset_envelope=oenv, sr=sr, hop_length=hop)
    tempo = float(np.atleast_1d(tempo)[0])
    beat_times = librosa.frames_to_time(beat_frames, sr=sr, hop_length=hop)
    onset_frames = librosa.onset.onset_detect(onset_envelope=oenv, sr=sr, hop_length=hop)
    onset_times = librosa.frames_to_time(onset_frames, sr=sr, hop_length=hop)
    omax = float(oenv.max()) or 1.0
    beats = []
    for f, t in zip(beat_frames, beat_times):
        s = float(oenv[min(int(f), len(oenv) - 1)]) / omax
        beats.append({"t": round(float(t), 3), "strength": round(min(1.0, s), 3)})
    rms = librosa.feature.rms(y=y, hop_length=hop)[0]
    times = librosa.frames_to_time(np.arange(len(rms)), sr=sr, hop_length=hop)
    win = 0.5
    energy = []
    t = 0.0
    while t < dur:
        m = (times >= t) & (times < t + win)
        v = float(np.sqrt(np.mean(rms[m] ** 2))) if m.any() else 0.0
        energy.append({"t": round(t, 2), "rms": round(v, 5)})
        t += win
    db = 20 * np.log10(np.maximum(rms, 1e-8))
    silent = db < -50
    silences, start = [], None
    for i, s in enumerate(silent):
        if s and start is None:
            start = times[i]
        if (not s or i == len(silent) - 1) and start is not None:
            end = times[i]
            if end - start >= 0.4:
                silences.append({"start": round(float(start), 2), "end": round(float(end), 2)})
            start = None
    out = {
        "source": src.replace("\\", "/").split("/")[-1], "duration": round(dur, 3), "sampleRate": sr, "bpm": round(tempo, 1),
        "beats": beats, "onsets": [round(float(x), 3) for x in onset_times], "energy": energy, "silences": silences,
        "meanRmsDb": round(float(20 * np.log10(max(np.sqrt(np.mean(y ** 2)), 1e-8))), 2),
        "peak": round(float(np.max(np.abs(y))), 4),
        "librosa": librosa.__version__,
    }
    with open(dst, "w", encoding="utf-8") as f:
        json.dump(out, f, indent=2)
    print(json.dumps({"bpm": out["bpm"], "beats": len(beats), "onsets": len(onset_times)}))


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
