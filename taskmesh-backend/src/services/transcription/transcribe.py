import json
import glob
import os
import shutil
import subprocess
import sys
import tempfile

from faster_whisper import WhisperModel


def find_ffmpeg():
    configured = os.environ.get("FFMPEG_PATH")
    if configured and os.path.isfile(configured):
        return configured

    executable = shutil.which("ffmpeg")
    if executable:
        return executable

    local_app_data = os.environ.get("LOCALAPPDATA")
    if local_app_data:
        pattern = os.path.join(
            local_app_data,
            "Microsoft",
            "WinGet",
            "Packages",
            "Gyan.FFmpeg.Shared_*",
            "ffmpeg-*",
            "bin",
            "ffmpeg.exe",
        )
        matches = glob.glob(pattern)
        if matches:
            return matches[0]

    raise RuntimeError("FFmpeg is not installed or could not be found")


def extract_audio(ffmpeg, media_path, audio_path):
    result = subprocess.run(
        [
            ffmpeg,
            "-hide_banner",
            "-loglevel",
            "error",
            "-nostdin",
            "-y",
            "-i",
            media_path,
            "-map",
            "0:a:0",
            "-vn",
            "-ac",
            "1",
            "-ar",
            "16000",
            "-c:a",
            "pcm_s16le",
            "-f",
            "wav",
            audio_path,
        ],
        capture_output=True,
        text=True,
        timeout=180,
        check=False,
    )
    if result.returncode == 0:
        return

    detail = result.stderr.lower()
    if "matches no streams" in detail or "does not contain any stream" in detail:
        raise RuntimeError("This video has no audio track. Choose a video with speech or upload an audio recording.")
    raise RuntimeError("Could not read audio from this file. Try an MP4, MOV, WebM, WAV, MP3, M4A, OGG, or FLAC recording.")


def main():
    filename = os.path.basename(sys.argv[1]) if len(sys.argv) > 1 else "recording.wav"
    suffix = os.path.splitext(filename)[1] or ".wav"
    with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as media_file:
        path = media_file.name
        while True:
            chunk = sys.stdin.buffer.read(1024 * 1024)
            if not chunk:
                break
            media_file.write(chunk)

    audio_path = None
    try:
        with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as audio_file:
            audio_path = audio_file.name

        extract_audio(find_ffmpeg(), path, audio_path)
        model = WhisperModel(os.environ.get("WHISPER_MODEL", "base"), device="cpu", compute_type="int8")
        segments, _ = model.transcribe(audio_path, vad_filter=True)
        transcript = " ".join(segment.text.strip() for segment in segments).strip()
        if not transcript:
            raise RuntimeError("No speech could be detected in this recording")
        print(json.dumps({"transcript": transcript}, ensure_ascii=True))
    except Exception as error:
        print(json.dumps({"error": str(error)}, ensure_ascii=True))
        raise SystemExit(1)
    finally:
        os.remove(path)
        if audio_path and os.path.exists(audio_path):
            os.remove(audio_path)


if __name__ == "__main__":
    main()