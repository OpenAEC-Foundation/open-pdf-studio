"""Render the English promo from repository screenshots, narration and original music.

Dependencies: Pillow, numpy, imageio-ffmpeg, edge-tts.
Usage: python scripts/promo/render.py [--stills-only] [--skip-voice]
No application source files are modified. Narration text is sent to Edge TTS.
"""
from pathlib import Path
import argparse
import asyncio
import json
import math
import subprocess
import wave

import imageio_ffmpeg
import numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageOps

ROOT = Path(__file__).resolve().parents[2]
BASE = ROOT / 'promo/en'
OUT = BASE / 'output'
ASSETS = BASE / 'assets'
SCENES = json.loads((BASE / 'scenes.json').read_text())
W, H, FPS, SR = 1920, 1080, 24, 48000
TOTAL = sum(s['duration'] for s in SCENES)
FFMPEG = imageio_ffmpeg.get_ffmpeg_exe()
BG, WHITE, MUTED, ORANGE = '#101319', '#f6f4ef', '#a7adb7', '#f39a38'
FONT_DIR = Path('/usr/share/fonts/truetype/dejavu')
FONTS = {}


def font(size, bold=False):
    key = (size, bold)
    if key not in FONTS:
        FONTS[key] = ImageFont.truetype(str(FONT_DIR / ('DejaVuSans-Bold.ttf' if bold else 'DejaVuSans.ttf')), size)
    return FONTS[key]


def ease(x):
    x = max(0, min(1, x))
    return x * x * (3 - 2 * x)


DRAWING = Image.open(ROOT / 'docs/screenshots/drawing-tools.jpg').convert('RGB')
COMPARE = Image.open(ROOT / 'docs/screenshots/pdf-compare.jpg').convert('RGB')
PLATE = Image.new('RGB', (W, H), BG)
d = ImageDraw.Draw(PLATE)
for x in range(0, W, 64):
    d.line((x, 0, x, H), fill='#191e26')
for y in range(0, H, 64):
    d.line((0, y, W, y), fill='#191e26')
d.line((80, 1010, 1840, 1010), fill='#353b45', width=1)


def text(draw, xy, value, size=28, color=WHITE, bold=False):
    draw.text(xy, value, font=font(size, bold), fill=color)


def panel(canvas, source, box, zoom=1, center=(.5, .5)):
    x, y, width, height = [int(v) for v in box]
    # Fit the complete image; use a larger virtual viewport for deliberate detail shots.
    scale = max(width / source.width, height / source.height) * zoom
    sw, sh = width / scale, height / scale
    cx = max(sw / 2, min(source.width - sw / 2, source.width * center[0]))
    cy = max(sh / 2, min(source.height - sh / 2, source.height * center[1]))
    crop = (cx - sw / 2, cy - sh / 2, cx + sw / 2, cy + sh / 2)
    shot = source.resize((width, height), Image.Resampling.BICUBIC, box=crop)
    p = ImageDraw.Draw(canvas)
    p.rectangle((x + 13, y + 17, x + width + 13, y + height + 17), fill='#080a0e')
    canvas.paste(shot, (x, y))
    p.rectangle((x, y, x + width, y + height), outline='#606773', width=1)


def render_frame(index, t, captions=None):
    s = SCENES[index]
    progress = t / s['duration']
    entry = ease(t / .7)
    canvas = PLATE.copy()
    d = ImageDraw.Draw(canvas)
    text(d, (80, 38), 'OPEN PDF STUDIO', 23, WHITE, True)
    text(d, (1574, 38), 'OPENAEC / FILM 01', 19, MUTED)
    d.rectangle((80, 93, 135, 97), fill=ORANGE)
    y = int(235 + (1 - entry) * 28)
    layout = s['layout']
    if layout in ('hero', 'measure', 'annotate'):
        text(d, (80, y - 70), s['eyebrow'], 21, ORANGE, True)
        size = 64 if layout == 'measure' else 76
        for j, line in enumerate(s['title']):
            text(d, (76, y + j * 92), line, size, WHITE, True)
        # Keep text inside its column with intentional two-line details.
        details = {'hero':['Free and open source.'],
                   'measure':['Set the scale.', 'Measure lengths and areas.'],
                   'annotate':['Dimensions. Shapes.', 'Hatches. Notes.']}[layout]
        for j, line in enumerate(details):
            text(d, (80, y + 225 + j * 43), line, 27, MUTED)
        if layout == 'hero':
            panel(canvas, DRAWING, (735, 193, 1105, 660), 1 + .025 * progress)
        elif layout == 'measure':
            panel(canvas, DRAWING, (775, 180, 1065, 690), 1.30 + .10 * progress, (.50, .67))
        else:
            panel(canvas, DRAWING, (735, 180, 1105, 690), 1.5 + .09 * progress, (.37, .39))
        d = ImageDraw.Draw(canvas)
        text(d, (80, 824), 'OPEN  /  MEASURE  /  ANNOTATE  /  COMPARE', 17, MUTED)
    elif layout in ('wide', 'compare'):
        text(d, (80, 133), s['eyebrow'], 21, ORANGE, True)
        title = 'Every detail. In view.' if layout == 'wide' else s['title'][0]
        text(d, (77, 169), title, 59, WHITE, True)
        text(d, (1120, 192), s['detail'] if layout == 'compare' else 'Built for technical drawings.', 25, MUTED)
        if layout == 'wide':
            panel(canvas, DRAWING, (240, 279, 1440, 630), 1.00 + .03 * progress, (.5, .43))
        else:
            panel(canvas, COMPARE, (305, 276, 1310, 654), 1.0 + .02 * progress, (.55, .47))
    elif layout == 'manifesto':
        text(d, (80, 175), s['eyebrow'], 22, ORANGE, True)
        for j, line in enumerate(s['title']):
            a = ease((t - j * .55) / .6)
            color = tuple(int(int(WHITE[k:k+2], 16) * a + int(BG[k:k+2],16) * (1-a)) for k in (1,3,5))
            text(d, (76 + int((1-a)*25), 258 + j * 145), line, 101, ORANGE if j == 2 and a > .95 else color, True)
        text(d, (83, 781), s['detail'], 30, MUTED)
        d.line((1510, 276, 1790, 276, 1790, 785, 1510, 785, 1510, 276), fill='#434b58', width=2)
        d.line((1532, 755, 1758, 529, 1532, 305), fill=ORANGE, width=3)
    else:
        text(d, (80, 180), s['eyebrow'], 22, ORANGE, True)
        text(d, (73, 254), s['title'][0], 125, WHITE, True)
        text(d, (73, 396), s['title'][1], 125, WHITE, True)
        d.rectangle((82, 602, 555, 684), fill=ORANGE)
        text(d, (113, 619), 'Download it free.', 36, BG, True)
        text(d, (82, 745), 'github.com/OpenAEC-Foundation/', 27, MUTED)
        text(d, (82, 786), 'open-pdf-studio', 31, WHITE, True)
        panel(canvas, DRAWING, (1110, 280, 730, 460), 1.04, (.54, .5))
    d = ImageDraw.Draw(canvas)
    text(d, (80, 1030), 'FREE & OPEN SOURCE', 18, MUTED)
    text(d, (1650, 1030), f'{index+1:02d} / {len(SCENES):02d}', 18, MUTED)
    elapsed = sum(v['duration'] for v in SCENES[:index]) + t
    d.rectangle((80, 1010, 80 + int(1760 * elapsed / TOTAL), 1013), fill=ORANGE)
    if captions:
        active = next((c for c in captions if c['start'] <= elapsed < c['end']), None)
        if active:
            words = active['text'].split()
            lines, line = [], ''
            for word in words:
                candidate = (line + ' ' + word).strip()
                if d.textlength(candidate, font=font(29)) > 1510:
                    lines.append(line)
                    line = word
                else:
                    line = candidate
            lines.append(line)
            top = 980 - 40 * len(lines)
            d.rectangle((165, top - 10, 1755, 985), fill='#080a0e')
            for j, line in enumerate(lines):
                length = d.textlength(line, font=font(29))
                text(d, ((W-length)/2, top+j*40), line, 29)
    fade = 1
    if index == 0:
        fade = ease(t / .65)
    if index == len(SCENES) - 1:
        fade *= ease((s['duration']-t) / .85)
    if fade < 1:
        canvas = Image.blend(Image.new('RGB', (W,H), BG), canvas, fade)
    return canvas


async def narrate():
    import edge_tts
    for i, s in enumerate(SCENES):
        path = ASSETS / f'voice-{i:02d}.mp3'
        if path.exists() and path.stat().st_size > 1000:
            continue
        print(f'Narration {i+1}/{len(SCENES)}', flush=True)
        await asyncio.wait_for(edge_tts.Communicate(s['voice'], 'en-GB-RyanNeural', rate='+0%').save(str(path)), timeout=50)


def audio_and_captions():
    total_samples = int(TOTAL * SR)
    voice = np.zeros(total_samples, dtype=np.float32)
    captions, start = [], 0
    for i, s in enumerate(SCENES):
        raw = subprocess.check_output([FFMPEG, '-v', 'error', '-i', str(ASSETS/f'voice-{i:02d}.mp3'), '-f', 'f32le', '-ac', '1', '-ar', str(SR), '-'])
        data = np.frombuffer(raw, np.float32)
        duration = len(data)/SR
        if duration > s['duration'] - .7:
            raise ValueError(f'Scene {i}: voice {duration:.2f}s exceeds slot; extend scene duration.')
        offset = start + .35
        begin = round(offset * SR)
        voice[begin:begin+len(data)] = data
        # Scene-level captions follow the spoken duration, with readable line wrapping.
        captions.append({'start':offset, 'end':offset+duration, 'text':s['voice']})
        start += s['duration']
    # An original restrained synth bed: four chords, soft plucks and a low pulse.
    ts = np.arange(total_samples, dtype=np.float32)/SR
    music = np.zeros(total_samples, dtype=np.float32)
    chords = [[57,60,64,67],[53,57,60,64],[48,55,60,64],[55,59,62,67]]
    for bar in range(math.ceil(TOTAL/5)):
        begin, end = int(bar*5*SR), min(total_samples,int((bar+1)*5*SR))
        local = np.arange(end-begin,dtype=np.float32)/SR
        env = np.minimum(local/.7,1)*np.minimum((5-local)/.8,1)
        chord = chords[bar%4]
        for note in chord:
            hz = 440*2**((note-69)/12)
            music[begin:end] += .018*np.sin(2*np.pi*hz*local)*env
        for beat in range(8):
            a = begin+round(beat*.625*SR)
            b = min(total_samples,a+round(1.0*SR))
            if b<=a: continue
            local2 = np.arange(b-a,dtype=np.float32)/SR
            hz = 440*2**((chord[beat%4]+12-69)/12)
            music[a:b] += .026*np.sin(2*np.pi*hz*local2)*np.exp(-6*local2)*np.minimum(local2/.012,1)
    fade = np.minimum(ts/1.5,1)*np.minimum((TOTAL-ts)/2,1)
    music *= fade
    # Constant low bed beneath the voice; keep generous headroom.
    mix = voice*.95 + music*.62
    peak = float(np.max(np.abs(mix)))
    if peak>.95: mix *= .95/peak
    with wave.open(str(ASSETS/'soundtrack.wav'),'wb') as f:
        f.setnchannels(2); f.setsampwidth(2); f.setframerate(SR)
        f.writeframes(np.repeat((mix*32767).astype('<i2')[:,None],2,axis=1).tobytes())
    (ASSETS/'captions.json').write_text(json.dumps(captions,indent=2))
    def stamp(t):
        ms = round(t*1000)
        return f'{ms//3600000:02}:{ms//60000%60:02}:{ms//1000%60:02},{ms%1000:03}'
    (OUT/'open-pdf-studio-en.srt').write_text('\n\n'.join(f"{i+1}\n{stamp(c['start'])} --> {stamp(c['end'])}\n{c['text']}" for i,c in enumerate(captions))+'\n')
    return captions


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--stills-only',action='store_true')
    parser.add_argument('--skip-voice',action='store_true')
    args = parser.parse_args()
    OUT.mkdir(parents=True,exist_ok=True); ASSETS.mkdir(parents=True,exist_ok=True)
    if not args.stills_only:
        if not args.skip_voice: asyncio.run(narrate())
        captions = audio_and_captions()
    else:
        captions = None
    sheet = Image.new('RGB',(960*2,540*4),BG)
    for i,s in enumerate(SCENES):
        frame = render_frame(i, min(3,s['duration']/2), captions)
        frame.save(OUT/f'scene-{i+1:02d}.jpg',quality=90)
        sheet.paste(frame.resize((960,540)),((i%2)*960,(i//2)*540))
    sheet.save(OUT/'storyboard.jpg',quality=90)
    render_frame(0,3).save(OUT/'poster.jpg',quality=95)
    if args.stills_only: return
    cmd = [FFMPEG,'-y','-v','warning','-f','rawvideo','-vcodec','rawvideo','-pix_fmt','rgb24','-s',f'{W}x{H}','-r',str(FPS),'-i','-',
           '-i',str(ASSETS/'soundtrack.wav'),'-c:v','libx264','-preset','fast','-crf','20','-pix_fmt','yuv420p',
           '-c:a','aac','-b:a','192k','-movflags','+faststart','-t',str(TOTAL),str(OUT/'open-pdf-studio-promo-en.mp4')]
    with subprocess.Popen(cmd,stdin=subprocess.PIPE) as proc:
        for i,s in enumerate(SCENES):
            print(f'Rendering scene {i+1}/{len(SCENES)}',flush=True)
            for frame_no in range(round(s['duration']*FPS)):
                proc.stdin.write(render_frame(i,frame_no/FPS,captions).tobytes())
        proc.stdin.close()
        if proc.wait(): raise RuntimeError('FFmpeg failed')
    print(OUT/'open-pdf-studio-promo-en.mp4',flush=True)


if __name__ == '__main__':
    main()
