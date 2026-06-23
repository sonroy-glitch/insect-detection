"""
main.py — Entry point for the Forest Wildlife Camera Trap.

Starts three concurrent tasks:
  1. Sensor Reader (daemon thread) — reads Arduino serial data
  2. Uploader (daemon thread) — syncs captures to Supabase when online
  3. Capture Manager (main thread) — orchestrates photo capture on trigger

Usage:
    python3 main.py

The program runs indefinitely until killed (Ctrl+C or systemd stop).
"""

import logging
import sys
from queue import Queue
from threading import Thread

import config
from sensor_reader import sensor_loop
from capture_manager import capture_loop
from uploader import upload_loop


def setup_logging():
    """Configure logging to both console and file."""
    log_format = "%(asctime)s [%(levelname)s] %(name)s: %(message)s"
    date_format = "%Y-%m-%d %H:%M:%S"

    handlers = [
        logging.StreamHandler(sys.stdout),
        logging.FileHandler(str(config.LOG_FILE), encoding="utf-8"),
    ]

    logging.basicConfig(
        level=logging.INFO,
        format=log_format,
        datefmt=date_format,
        handlers=handlers,
    )


def main():
    setup_logging()
    logger = logging.getLogger("main")

    logger.info("=" * 60)
    logger.info("  FOREST WILDLIFE CAMERA TRAP — Starting up")
    logger.info("=" * 60)
    logger.info(f"  Serial port  : {config.SERIAL_PORT} @ {config.BAUD_RATE}")
    logger.info(f"  Camera index : {config.CAMERA_INDEX}")
    logger.info(f"  Capture dir  : {config.CAPTURE_DIR}")
    logger.info(f"  Cooldown     : {config.COOLDOWN_SEC}s")
    logger.info(f"  Upload check : every {config.WIFI_CHECK_INTERVAL_SEC}s")
    logger.info(f"  Supabase URL : {'SET' if config.SUPABASE_URL else 'NOT SET'}")
    logger.info("=" * 60)

    # Shared queue between sensor reader and capture manager
    sensor_queue = Queue()

    # ── Start sensor reader thread ──────────────────────────────────────
    # reader_thread = Thread(
    #     target=sensor_loop,
    #     args=(sensor_queue,),
    #     name="SensorReader",
    #     daemon=True,
    # )
    # reader_thread.start()
    logger.info("Sensor reader thread started.")

    # ── Start uploader thread ───────────────────────────────────────────
    upload_thread = Thread(
        target=upload_loop,
        name="Uploader",
        daemon=True,
    )
    upload_thread.start()
    logger.info("Uploader thread started.")

    # ── Run capture manager in main thread (blocking) ───────────────────
    logger.info("Capture manager running. Waiting for sensor triggers...")
    try:
        capture_loop(sensor_queue)
    except KeyboardInterrupt:
        logger.info("Shutdown requested (Ctrl+C). Exiting.")
        sys.exit(0)


if __name__ == "__main__":
    main()
