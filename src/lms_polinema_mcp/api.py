"""Local web API and static frontend for LMS Polinema."""

import os
import re
import secrets
from pathlib import Path
from urllib.parse import quote, unquote, urljoin, urlparse

import httpx
from fastapi import FastAPI, HTTPException, Query
from fastapi.responses import FileResponse, JSONResponse, Response

from lms_polinema_mcp import __version__
from lms_polinema_mcp.config import settings
from lms_polinema_mcp.exceptions import (
    AuthenticationError,
    CredentialsNotFoundError,
    LMSError,
    SessionExpiredError,
)
from lms_polinema_mcp.models.assignment import AssignmentDetail, AssignmentSummary, DeadlineItem
from lms_polinema_mcp.models.course import Course
from lms_polinema_mcp.models.material import CourseMaterial
from lms_polinema_mcp.server import (
    _get_authenticated_sessions,
    lms_check_deadlines,
    lms_get_assignment_detail,
    lms_list_assignments,
    lms_list_courses,
    lms_list_materials,
)

MOODLE_HOST = "lmsslc.polinema.ac.id"
MAX_RESOURCE_BYTES = 32 * 1024 * 1024
_REDIRECTS = {301, 302, 303, 307, 308}
_FILENAME_RE = re.compile(r"filename\*?=(?:UTF-8''|\"?)([^\";]+)", re.IGNORECASE)

app = FastAPI(title="LMS Polinema", version=__version__)


class UnsafeResourceURL(ValueError):
    """Raised when a file URL is not an https LMSSLC address."""


def assert_moodle_https_url(url: str) -> str:
    """Return url when it is https on the campus Moodle host, and reject anything else."""
    parsed = urlparse((url or "").strip())
    if (
        parsed.scheme != "https"
        or parsed.hostname != MOODLE_HOST
        or parsed.port not in (None, 443)
        or parsed.username
        or parsed.password
    ):
        raise UnsafeResourceURL("URL di luar LMSSLC tidak diizinkan")
    return url.strip()


def attachment_name(url: str, content_disposition: str | None) -> str:
    """Pick a header-safe download name from Content-Disposition or the URL path."""
    if content_disposition:
        match = _FILENAME_RE.search(content_disposition)
        if match:
            name = unquote(match.group(1)).strip().strip('"')
            if name:
                return _safe_name(name)
    leaf = Path(unquote(urlparse(url).path)).name
    return _safe_name(leaf or "berkas")


def _safe_name(name: str) -> str:
    cleaned = name.replace('"', "").replace("\r", "").replace("\n", "")
    cleaned = cleaned.replace("/", "_").replace("\\", "_").strip()
    return cleaned[:180] or "berkas"


def find_frontend_dist() -> Path | None:
    """Locate the built frontend by walking up from the process and this file."""
    starts = [Path.cwd(), Path(__file__).resolve().parent]
    seen: set[Path] = set()
    for start in starts:
        current = start
        for _ in range(6):
            if current in seen:
                break
            seen.add(current)
            index = current / "frontend" / "dist" / "index.html"
            if index.is_file():
                return index.parent
            if current.parent == current:
                break
            current = current.parent
    return None


def _error_status(exc: LMSError) -> int:
    if isinstance(exc, (AuthenticationError, CredentialsNotFoundError, SessionExpiredError)):
        return 401
    return 502


@app.exception_handler(LMSError)
async def handle_lms_error(_request: object, exc: LMSError) -> JSONResponse:
    return JSONResponse(status_code=_error_status(exc), content={"detail": str(exc)})


def access_required() -> bool:
    """Hosted deploys stay closed unless an access key is configured."""
    return bool(os.environ.get("LMS_POLINEMA_ACCESS_KEY", "")) or bool(os.environ.get("VERCEL"))


def access_granted(request) -> bool:  # type: ignore[no-untyped-def]
    """Compare the header or same-site cookie with the configured access key."""
    expected = os.environ.get("LMS_POLINEMA_ACCESS_KEY", "")
    if not expected:
        return not os.environ.get("VERCEL")
    provided = request.headers.get("x-lms-access-key") or request.cookies.get("lms_access", "")
    if len(provided) != len(expected):
        return False
    return secrets.compare_digest(provided, expected)


@app.middleware("http")
async def api_no_store(request, call_next):  # type: ignore[no-untyped-def]
    protected = request.url.path.startswith("/api") and request.url.path != "/api/health"
    if protected and not access_granted(request):
        if os.environ.get("VERCEL") and not os.environ.get("LMS_POLINEMA_ACCESS_KEY"):
            detail = "Kunci akses belum diatur di server."
        else:
            detail = "Kunci akses salah."
        return JSONResponse(
            status_code=401,
            content={"detail": detail, "code": "access"},
            headers={"Cache-Control": "no-store"},
        )
    response = await call_next(request)
    if request.url.path.startswith("/api"):
        response.headers["Cache-Control"] = "no-store"
    return response


@app.get("/api/health")
async def health() -> dict[str, str]:
    """Report that the UI server is up. This does not call the campus LMS."""
    return {"status": "ok", "access": "required" if access_required() else "open"}


@app.get("/api/courses", response_model=list[Course])
async def courses() -> list[Course]:
    """Return enrolled courses for the current semester."""
    return await lms_list_courses()


@app.get("/api/assignments", response_model=list[AssignmentSummary])
async def assignments(course_id: int | None = None) -> list[AssignmentSummary]:
    """Return assignment summaries, optionally for one Moodle course id."""
    return await lms_list_assignments(course_id)


@app.get("/api/assignments/{assignment_id}", response_model=AssignmentDetail)
async def assignment_detail(assignment_id: int) -> AssignmentDetail:
    """Return instructions, attachments, and submission status for one assignment."""
    return await lms_get_assignment_detail(assignment_id)


@app.get("/api/materials/{course_id}", response_model=list[CourseMaterial])
async def materials(course_id: int) -> list[CourseMaterial]:
    """Return material links for one Moodle course id."""
    return await lms_list_materials(course_id)


@app.get("/api/deadlines", response_model=list[DeadlineItem])
async def deadlines() -> list[DeadlineItem]:
    """Return due dates across enrolled courses. This walks every assignment page."""
    return await lms_check_deadlines()


@app.get("/api/resource")
async def resource(url: str = Query(min_length=1)) -> Response:
    """Download one LMSSLC file with the saved student session."""
    try:
        assert_moodle_https_url(url)
    except UnsafeResourceURL as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    moodle_session, _ = await _get_authenticated_sessions()
    try:
        body, media_type, filename = await _fetch_moodle_resource(url, moodle_session)
    except UnsafeResourceURL as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail=f"Gagal mengambil berkas dari Moodle: {exc}") from exc

    return Response(
        content=body,
        media_type=media_type,
        headers={"Content-Disposition": f"inline; filename*=UTF-8''{quote(filename)}"},
    )


async def _fetch_moodle_resource(url: str, moodle_session: str) -> tuple[bytes, str, str]:
    current = assert_moodle_https_url(url)
    async with httpx.AsyncClient(
        cookies={settings.moodle_cookie_name: moodle_session},
        follow_redirects=False,
        verify=settings.http_verify_ssl,
        timeout=60.0,
        headers={"User-Agent": f"Mozilla/5.0 (compatible; lms-polinema-mcp/{__version__})"},
    ) as client:
        for _ in range(5):
            async with client.stream("GET", current) as resp:
                if resp.status_code in _REDIRECTS:
                    location = resp.headers.get("location")
                    if not location:
                        raise HTTPException(status_code=502, detail="Pengalihan Moodle tidak lengkap")
                    current = assert_moodle_https_url(urljoin(current, location))
                    continue
                if resp.status_code >= 400:
                    raise HTTPException(
                        status_code=502,
                        detail=f"Moodle menolak berkas ({resp.status_code})",
                    )
                data = bytearray()
                async for chunk in resp.aiter_bytes():
                    data.extend(chunk)
                    if len(data) > MAX_RESOURCE_BYTES:
                        raise HTTPException(
                            status_code=413,
                            detail="Berkas terlalu besar untuk dibuka dari aplikasi ini",
                        )
                media = resp.headers.get("content-type", "application/octet-stream")
                media_type = media.split(";", 1)[0].strip() or "application/octet-stream"
                return bytes(data), media_type, attachment_name(current, resp.headers.get("content-disposition"))
    raise HTTPException(status_code=502, detail="Terlalu banyak pengalihan")


@app.get("/{full_path:path}")
async def frontend(full_path: str) -> Response:
    """Serve the built UI. Unknown paths fall back to the app shell."""
    dist = find_frontend_dist()
    if dist is None:
        return JSONResponse(
            status_code=503,
            content={
                "detail": "Antarmuka belum dibangun. Dari folder proyek, jalankan: cd frontend && npm install && npm run build"
            },
        )

    if full_path:
        candidate = (dist / full_path).resolve()
        if candidate.is_relative_to(dist.resolve()) and candidate.is_file():
            return FileResponse(candidate)
    return FileResponse(dist / "index.html")


def main() -> None:
    """Start the local UI on localhost."""
    import uvicorn

    port = int(os.environ.get("LMS_POLINEMA_WEB_PORT", "8787"))
    print(f"LMS Polinema UI: http://127.0.0.1:{port}")
    uvicorn.run(app, host="127.0.0.1", port=port, log_level="info")
