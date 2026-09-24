import io
import os
import sys
import unittest
import wave
from pathlib import Path
from unittest.mock import MagicMock, patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

# Use an in-memory/temp db for tests
os.environ["OP25TAP_DATA_DIR"] = str(ROOT / "tests" / "test_data")

from db import db, init_db, update_event_transcript, wipe
from ingest.audio_recorder import AudioRecorder, pcm_to_wav_bytes
from ingest.whisper_client import WhisperDispatcher


class TestAudioWhisperPipeline(unittest.TestCase):
    def setUp(self):
        wipe()
        init_db()

    def tearDown(self):
        wipe()

    def test_pcm_to_wav_bytes(self):
        # 1 second of 8000Hz 16-bit mono silence (16,000 bytes of zeros)
        pcm_silence = b"\x00" * 16000
        wav_data = pcm_to_wav_bytes(pcm_silence, sample_rate=8000)

        self.assertTrue(wav_data.startswith(b"RIFF"))
        self.assertIn(b"WAVE", wav_data[:16])

        # Verify readable with Python's wave module
        with wave.open(io.BytesIO(wav_data), "rb") as wf:
            self.assertEqual(wf.getnchannels(), 1)
            self.assertEqual(wf.getsampwidth(), 2)
            self.assertEqual(wf.getframerate(), 8000)
            self.assertEqual(wf.getnframes(), 8000)

    def test_db_transcript_update(self):
        c = db()
        cur = c.execute(
            """INSERT INTO events(ts, system_id, site_id, protocol, event_type, from_rid, to_tgid, frequency, duration_ms)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (1000.0, None, None, "APCO-25", "Group Call", 101, 202, 770000000, 2500)
        )
        event_id = cur.lastrowid

        # Initial check
        row = c.execute("SELECT transcript, audio_file FROM events WHERE id=?", (event_id,)).fetchone()
        self.assertIsNone(row["transcript"])
        self.assertIsNone(row["audio_file"])

        # Update with transcript and audio file
        update_event_transcript(event_id, "Engine 4 en route to Main St", audio_file="audio_calls/1.wav")

        row = c.execute("SELECT transcript, audio_file FROM events WHERE id=?", (event_id,)).fetchone()
        self.assertEqual(row["transcript"], "Engine 4 en route to Main St")
        self.assertEqual(row["audio_file"], "audio_calls/1.wav")

    def test_whisper_dispatcher_transcribe_sync(self):
        c = db()
        cur = c.execute(
            """INSERT INTO events(ts, system_id, site_id, protocol, event_type, from_rid, to_tgid, frequency, duration_ms)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (1000.0, None, None, "APCO-25", "Group Call", 101, 202, 770000000, 2500)
        )
        event_id = cur.lastrowid

        callback_mock = MagicMock()
        dispatcher = WhisperDispatcher(
            endpoint_url="http://mock-whisper:8000/v1/audio/transcriptions",
            model="base.en",
            on_transcript=callback_mock,
        )

        dummy_wav = pcm_to_wav_bytes(b"\x00" * 8000)

        # Mock requests.post response
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.json.return_value = {"text": "Medic 12 responding priority one"}

        with patch("requests.post", return_value=mock_response) as mock_post:
            dispatcher._transcribe_sync(event_id, dummy_wav, audio_file="audio_calls/1.wav")

            # Check that requests.post was called with multipart form
            mock_post.assert_called_once()
            _, kwargs = mock_post.call_args
            self.assertIn("files", kwargs)
            self.assertEqual(kwargs["data"]["model"], "base.en")

            # Check DB updated
            row = c.execute("SELECT transcript, audio_file FROM events WHERE id=?", (event_id,)).fetchone()
            self.assertEqual(row["transcript"], "Medic 12 responding priority one")
            self.assertEqual(row["audio_file"], "audio_calls/1.wav")

            # Check callback invoked
            callback_mock.assert_called_once_with(event_id, "Medic 12 responding priority one", "audio_calls/1.wav")

    def test_audio_recorder_call_lifecycle(self):
        c = db()
        cur = c.execute(
            """INSERT INTO events(ts, system_id, site_id, protocol, event_type, from_rid, to_tgid, frequency, duration_ms)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (1000.0, None, None, "APCO-25", "Group Call", 101, 202, 770000000, 2500)
        )
        event_id = cur.lastrowid

        mock_dispatcher = MagicMock()
        recorder = AudioRecorder(
            audio_ws_url="ws://mock:9000",
            whisper_dispatcher=mock_dispatcher,
            retention_hours=1.0,
        )

        # 1. Start call
        recorder.start_call(event_id)

        # 2. Feed 1 second of PCM audio frames (16,000 bytes)
        chunk = b"\x01\x00" * 800  # 1600 bytes
        for _ in range(10):
            recorder._handle_pcm_frame(chunk)

        # 3. End call
        recorder.end_call(event_id)

        # Verify dispatcher was enqueued with WAV bytes
        mock_dispatcher.enqueue_call.assert_called_once()
        args, kwargs = mock_dispatcher.enqueue_call.call_args
        self.assertEqual(args[0], event_id)
        wav_bytes = args[1]
        self.assertTrue(wav_bytes.startswith(b"RIFF"))
        self.assertEqual(kwargs.get("audio_file"), f"audio_calls/{event_id}.wav")

        # Verify WAV file written to disk
        expected_path = recorder.audio_dir / f"{event_id}.wav"
        self.assertTrue(expected_path.exists())
        self.assertGreater(expected_path.stat().st_size, 10000)

        # Playback availability is recorded even if transcription never succeeds
        row = c.execute("SELECT audio_file FROM events WHERE id=?", (event_id,)).fetchone()
        self.assertEqual(row["audio_file"], f"audio_calls/{event_id}.wav")

        # Cleanup test wav
        expected_path.unlink(missing_ok=True)


if __name__ == "__main__":
    unittest.main()
