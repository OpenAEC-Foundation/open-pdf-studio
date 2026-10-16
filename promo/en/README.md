# Open PDF Studio — English promo

A 66-second, 1920 × 1080, 24 fps first cut with English narration, burned-in English captions and an original synthesized music bed.

## Watch

Open `index.html` or `output/open-pdf-studio-promo-en.mp4`. The standalone SRT is in `output/open-pdf-studio-en.srt`. `output/storyboard.jpg` shows all seven scenes.

## Editorial direction

**Your drawings. Your tools. Free and open source.**

Follow the same architectural drawing through opening, measurement, annotation and comparison. Dark graphite, warm orange and generous typography connect the scenes. End with a clear download invitation and the project repository address.

| Time | Scene | On-screen headline |
|---|---|---|
| 00–09.5 | Introduction | Your drawings. Your tools. |
| 09.5–18 | Open | Every detail. In view. |
| 18–28 | Measure | Turn drawings into quantities. |
| 28–37 | Annotate | Make your mark. |
| 37–46.5 | Compare | See what changed. |
| 46.5–57 | Value | No subscription. No watermarks. Open source. |
| 57–66 | Download | Open PDF Studio. Download it free. |

The complete English narration and scene durations are in `scenes.json`.

## Sources and production status

- Uses the existing repository screenshots `docs/screenshots/drawing-tools.jpg` and `docs/screenshots/pdf-compare.jpg`. Their interface is English.
- Camera motion is editorial movement over screenshots, not newly recorded application interaction. This first cut does not demonstrate opening speed, actual clicking, or a completed measurement operation.
- Narration: synthetic British English voice, `en-GB-RyanNeural`, generated through Edge TTS. Only the public promotional text is submitted to that service.
- Music: original programmatic synthesis in `scripts/promo/render.py`; no third-party music sample or stock track.
- Uses a typographic product name; no stock icon is incorporated.
- Claims are based on the repository README. Avoids the old promo plan's obsolete MIT claim and unverified speed claims.
- The older Dutch plan is preserved at `docs/superpowers/plans/2026-07-20-pr-video-1.80.md`.

For a final demonstration-led production, replace the still-image shots with English-interface recordings of scale calibration, a new measurement, a markup and a version comparison. Keep the same narration and timing where practical. The current cut is useful for reviewing voice, rhythm and art direction.

## Rebuild

Requires Python 3.10+ and DejaVu Sans fonts under `/usr/share/fonts/truetype/dejavu` (or change `FONT_DIR` in the renderer).

```sh
python -m pip install -r scripts/promo/requirements.txt
python scripts/promo/render.py
```

`--stills-only` generates storyboard frames without network access or narration. `--skip-voice` reuses existing narration files. Existing narration is cached by scene number: delete the corresponding `assets/voice-NN.mp3` after changing a scene's spoken text. FFmpeg is supplied by `imageio-ffmpeg`.

Large generated audio and video files are ignored by Git but remain available locally. Nothing is published automatically.
