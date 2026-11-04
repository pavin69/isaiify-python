import math
import struct
import wave
import os

OUTPUT_DIR = os.path.join(os.path.dirname(__file__), "static", "audio")
os.makedirs(OUTPUT_DIR, exist_ok=True)

SAMPLE_RATE = 22050  # 22.05kHz keeps file size small (~200KB) and crisp

def create_song_audio(filename, notes, bpm=120, duration_seconds=12, style="synth"):
    filepath = os.path.join(OUTPUT_DIR, filename)
    num_samples = int(SAMPLE_RATE * duration_seconds)
    beat_samples = int(SAMPLE_RATE * (60.0 / bpm))
    
    with wave.open(filepath, 'w') as f:
        f.setnchannels(1)
        f.setsampwidth(2)
        f.setframerate(SAMPLE_RATE)
        
        frames = bytearray()
        for i in range(num_samples):
            t = i / SAMPLE_RATE
            note_idx = int(i / beat_samples) % len(notes)
            freq = notes[note_idx]
            
            # Note envelope (decay)
            note_pos = (i % beat_samples) / beat_samples
            envelope = math.exp(-3.0 * note_pos)
            
            # Melodic tone with harmonics
            val = 0.4 * math.sin(2 * math.pi * freq * t) * envelope
            val += 0.15 * math.sin(4 * math.pi * freq * t) * envelope
            
            # Subtle rhythm kick / percussion on beat
            if (i % beat_samples) < 1500:
                kick_t = (i % beat_samples) / SAMPLE_RATE
                val += 0.35 * math.sin(2 * math.pi * 65 * kick_t) * math.exp(-20 * kick_t)
            
            # Clamp to 16-bit signed integer
            int_val = int(max(-32767, min(32767, val * 30000)))
            frames.extend(struct.pack('<h', int_val))
            
        f.writeframes(frames)
    print(f"Generated: {filename}")

if __name__ == "__main__":
    # Notes in Hz (C4=261.6, D4=293.6, E4=329.6, F4=349.2, G4=392.0, A4=440.0, B4=493.8, C5=523.2)
    # Tamil Songs
    create_song_audio("naa_ready.wav", [220, 220, 261, 293, 330, 293, 261, 220], bpm=135, duration_seconds=15)
    create_song_audio("hukum.wav", [164, 164, 196, 220, 246, 220, 196, 164], bpm=130, duration_seconds=15)
    create_song_audio("marakkuma_nenjam.wav", [261, 293, 329, 392, 440, 392, 329, 293], bpm=90, duration_seconds=15)
    create_song_audio("arabic_kuthu.wav", [293, 330, 370, 440, 494, 440, 370, 330], bpm=140, duration_seconds=15)
    create_song_audio("adiye.wav", [330, 392, 440, 494, 523, 494, 440, 392], bpm=95, duration_seconds=15)

    # English Songs
    create_song_audio("blinding_lights.wav", [349, 349, 392, 440, 523, 440, 392, 349], bpm=171, duration_seconds=15)
    create_song_audio("starboy.wav", [220, 261, 293, 330, 392, 330, 293, 261], bpm=186, duration_seconds=15)
    create_song_audio("shape_of_you.wav", [277, 330, 370, 415, 370, 330, 277, 247], bpm=96, duration_seconds=15)
    create_song_audio("as_it_was.wav", [329, 370, 440, 494, 554, 494, 440, 370], bpm=174, duration_seconds=15)
    create_song_audio("cruel_summer.wav", [293, 370, 440, 494, 587, 494, 440, 370], bpm=170, duration_seconds=15)
    print("All audio files ready!")
