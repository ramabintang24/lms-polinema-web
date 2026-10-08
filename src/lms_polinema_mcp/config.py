"""Configuration settings for LMS Polinema MCP server."""

import os
from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings


def default_session_dir() -> Path:
    """Use a writable temp dir on Vercel. The deployment filesystem is read-only."""
    if os.environ.get("VERCEL"):
        return Path("/tmp/lms_polinema")
    return Path.home() / ".lms_polinema"


class Settings(BaseSettings):
    """Application settings with environment variable override support."""

    # Institution
    institution_name: str = "Polinema"
    institution_full_name: str = "Politeknik Negeri Malang"

    # SIAKAD authentication portal
    siakad_base_url: str = "https://siakad.polinema.ac.id"

    # SPADA course discovery portal
    spada_base_url: str = "https://slc.polinema.ac.id/spada"
    spada_cookie_name: str = "POLIMASPADA"

    # Moodle LMS
    moodle_base_url: str = "https://lmsslc.polinema.ac.id"
    moodle_cookie_name: str = "MoodleSession"

    # Session and credential storage
    session_dir: Path = Field(default_factory=default_session_dir)
    moodle_session_file: Path | None = None
    spada_session_file: Path | None = None
    credentials_file: Path | None = None

    # HTTP client configuration
    http_timeout: float = 20.0
    # SSL verification is False by default: Polinema servers lack intermediate CA in macOS cert store
    http_verify_ssl: bool = False

    # Cache TTL settings
    course_cache_ttl_seconds: int = 1800  # 30 minutes
    session_cache_ttl_seconds: int = 300  # 5 minutes

    model_config = {"env_prefix": "LMS_POLINEMA_"}

    def model_post_init(self, __context: object) -> None:
        """Initialize default file paths inside session directory."""
        if self.moodle_session_file is None:
            self.moodle_session_file = self.session_dir / "moodle_session.json"
        if self.spada_session_file is None:
            self.spada_session_file = self.session_dir / "spada_session.json"
        if self.credentials_file is None:
            self.credentials_file = self.session_dir / "credentials.json"


settings = Settings()
