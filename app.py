"""Vercel entrypoint for the LMS Polinema web app."""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent / "src"))

from lms_polinema_mcp.api import app  # noqa: E402

__all__ = ["app"]
