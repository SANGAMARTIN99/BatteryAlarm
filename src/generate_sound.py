#!/usr/bin/env python3
"""
Generate a pleasant battery alarm chime sound (OGG format).
Uses scipy/numpy if available, otherwise generates a basic WAV and converts.
Run this script once during development to regenerate the sound file.
"""

import struct
import math
import wave
import os
import subprocess
import sys

SAMPLE_RATE = 44100
OUTPUT_WAV  = os.path.join(os.path.dirname(__file__), '..', 'sounds', 'battery-alarm.wav')
OUTPUT_OGG  = os.path.join(os.path.dirname(__file__), '..', 'sounds', 'battery-alarm.ogg')

def generate_chime_wave():
    """
    Generate a warm, pleasant chime: three ascending tones with fade-in/fade-out.
    Frequencies: C5 (523.25 Hz), E5 (659.25 Hz), G5 (783.99 Hz)
    Each tone: 0.35s with 0.05s fade-in and 0.1s fade-out.
    Gap between tones: 0.1s.
    """
    tones = [523.25, 659.25, 783.99]
    tone_duration   = 0.45   # seconds per tone
    gap_duration    = 0.08   # seconds between tones
    fade_in_frac    = 0.08   # fraction of tone used for fade-in
    fade_out_frac   = 0.25   # fraction of tone used for fade-out

    samples = []

    for freq in tones:
        n_samples = int(SAMPLE_RATE * tone_duration)
        fade_in_n  = int(n_samples * fade_in_frac)
        fade_out_n = int(n_samples * fade_out_frac)

        for i in range(n_samples):
            # Base sine wave
            t = i / SAMPLE_RATE
            value = math.sin(2 * math.pi * freq * t)

            # Add 2nd and 3rd harmonic for warmth
            value += 0.3 * math.sin(2 * math.pi * freq * 2 * t)
            value += 0.1 * math.sin(2 * math.pi * freq * 3 * t)

            # Envelope
            if i < fade_in_n:
                env = i / fade_in_n
            elif i >= n_samples - fade_out_n:
                env = (n_samples - i) / fade_out_n
            else:
                env = 1.0

            samples.append(value * env * 0.4)  # 0.4 = master volume

        # Gap (silence)
        gap_n = int(SAMPLE_RATE * gap_duration)
        samples.extend([0.0] * gap_n)

    # Normalize
    peak = max(abs(s) for s in samples)
    if peak > 0:
        samples = [s / peak * 0.85 for s in samples]

    # Convert to 16-bit PCM
    pcm = []
    for s in samples:
        clamped = max(-1.0, min(1.0, s))
        pcm.append(int(clamped * 32767))

    return pcm

def write_wav(pcm_samples, path):
    """Write 16-bit mono WAV file."""
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with wave.open(path, 'w') as wav:
        wav.setnchannels(1)      # Mono
        wav.setsampwidth(2)      # 16-bit
        wav.setframerate(SAMPLE_RATE)
        data = struct.pack(f'<{len(pcm_samples)}h', *pcm_samples)
        wav.writeframes(data)
    print(f'WAV written: {path}')

def convert_to_ogg(wav_path, ogg_path):
    """Convert WAV to OGG using ffmpeg or oggenc."""
    for tool, args in [
        ('ffmpeg', ['-y', '-i', wav_path, '-c:a', 'libvorbis', '-q:a', '5', ogg_path]),
        ('oggenc', ['-q', '5', '-o', ogg_path, wav_path]),
        ('avconv', ['-y', '-i', wav_path, '-c:a', 'libvorbis', '-q:a', '5', ogg_path]),
    ]:
        try:
            result = subprocess.run(
                [tool, *args],
                check=True,
                capture_output=True
            )
            print(f'OGG written via {tool}: {ogg_path}')
            return True
        except (subprocess.CalledProcessError, FileNotFoundError):
            continue

    print('Warning: Could not convert to OGG (install ffmpeg or oggenc).')
    print(f'Keeping WAV file at: {wav_path}')
    return False

if __name__ == '__main__':
    print('Generating battery alarm chime...')
    pcm = generate_chime_wave()
    write_wav(pcm, OUTPUT_WAV)
    converted = convert_to_ogg(OUTPUT_WAV, OUTPUT_OGG)
    if converted and os.path.exists(OUTPUT_OGG):
        os.remove(OUTPUT_WAV)  # Clean up intermediate WAV
        print('Done! Sound file ready.')
    else:
        # Rename WAV to OGG as fallback (paplay can handle WAV too)
        import shutil
        shutil.copy2(OUTPUT_WAV, OUTPUT_OGG)
        print('Done! (Using WAV format with .ogg extension as fallback)')
