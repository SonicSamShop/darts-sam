#!/usr/bin/env python3
"""Generate regional-accent Career Mode banter MP3s from web/banter.js using Kokoro-82M (or Piper)."""
import argparse
import io
import json
import re
import subprocess
import wave
from pathlib import Path

import soundfile as sf

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "web" / "audio" / "banter"

KOKORO_VOICES = {
    "uk_north": ("bm_george", "en-gb-x-gbclan"),
    "scot": ("bm_lewis", "en-gb-scotland"),
    "uk_south": ("bm_daniel", "en-gb-x-rp"),
    "euro": ("im_nicola", "en-gb"),
    "es": ("em_alex", "en-gb"),
    "us": ("am_fenrir", "en-us"),
    "asia": ("jm_kumo", "en-us"),
}

PIPER_VOICES = {
    "uk_north": "en_GB-northern_english_male-medium.onnx",
    "scot": "en_GB-alba-medium.onnx",
    "uk_south": "en_GB-alan-medium.onnx",
    "us": "en_US-ryan-medium.onnx",
}


def load_bank():
    cmd = ["node", "-e", "import('./web/banter.js').then(m => console.log(JSON.stringify(m.BANTER_BANK)))"]
    raw = subprocess.check_output(cmd, cwd=ROOT, text=True)
    return json.loads(raw)


def clean_text(text: str) -> str:
    return re.sub(r"\s+", " ", re.sub(r"\*[^*]+\*", "", text)).strip()


def encode_mp3(wav_bytes: bytes, dest: Path):
    dest.parent.mkdir(parents=True, exist_ok=True)
    subprocess.run(
        [
            "ffmpeg", "-y", "-loglevel", "error",
            "-f", "wav", "-i", "pipe:0",
            "-af", "loudnorm=I=-16:TP=-1.5",
            "-ac", "1", "-ar", "24000", "-c:a", "libmp3lame", "-b:a", "40k",
            str(dest),
        ],
        input=wav_bytes,
        check=True,
    )


def run_kokoro(bank, tiers, accents, models_dir: Path):
    from kokoro_onnx import Kokoro

    kokoro = Kokoro(str(models_dir / "kokoro-v1.0.int8.onnx"), str(models_dir / "voices-v1.0.bin"))
    total = 0
    for accent in accents:
        if accent not in KOKORO_VOICES:
            continue
        voice_name, lang = KOKORO_VOICES[accent]
        for kind, tier_lists in bank.items():
            for t in tiers:
                if t >= len(tier_lists):
                    continue
                for idx, line in enumerate(tier_lists[t]):
                    spoken = clean_text(line)
                    if not spoken:
                        continue
                    samples, sr = kokoro.create(spoken, voice=voice_name, speed=1.02, lang=lang)
                    buf = io.BytesIO()
                    sf.write(buf, samples, sr, format="WAV")
                    encode_mp3(buf.getvalue(), OUT / accent / f"{kind}-{t}-{idx}.mp3")
                    total += 1
        print(f"[kokoro] Generated {accent} ({voice_name}) — total: {total}", flush=True)


def run_piper(bank, tiers, accents, models_dir: Path):
    from piper import PiperVoice

    total = 0
    for accent in accents:
        if accent not in PIPER_VOICES:
            continue
        model_path = models_dir / PIPER_VOICES[accent]
        if not model_path.exists():
            print(f"Skipping {accent}: {model_path} not found")
            continue
        voice = PiperVoice.load(str(model_path))
        for kind, tier_lists in bank.items():
            for t in tiers:
                if t >= len(tier_lists):
                    continue
                for idx, line in enumerate(tier_lists[t]):
                    spoken = clean_text(line)
                    if not spoken:
                        continue
                    buf = io.BytesIO()
                    with wave.open(buf, "wb") as wf:
                        voice.synthesize_wav(spoken, wf)
                    encode_mp3(buf.getvalue(), OUT / accent / f"{kind}-{t}-{idx}.mp3")
                    total += 1
        print(f"[piper] Generated {accent} — total: {total}", flush=True)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--engine", choices=["kokoro", "piper"], default="kokoro")
    ap.add_argument("--models", type=Path, default=None)
    ap.add_argument("--tiers", default="0", help="Comma-separated tier indices (0..4) or 'all'")
    ap.add_argument("--accents", default=",".join(KOKORO_VOICES.keys()))
    args = ap.parse_args()

    tiers = list(range(5)) if args.tiers == "all" else [int(x) for x in args.tiers.split(",")]
    accents = [a.strip() for a in args.accents.split(",") if a.strip()]
    bank = load_bank()

    models_dir = args.models or (Path("/tmp/kokoro-models") if args.engine == "kokoro" else Path("/tmp/piper-voices"))
    if args.engine == "kokoro":
        run_kokoro(bank, tiers, accents, models_dir)
    else:
        run_piper(bank, tiers, accents, models_dir)


if __name__ == "__main__":
    main()
