"""Guards for the local UI file proxy."""

import pytest

from lms_polinema_mcp.api import UnsafeResourceURL, assert_moodle_https_url, attachment_name


def test_allows_moodle_https_url():
    url = "https://lmsslc.polinema.ac.id/pluginfile.php/1/mod_assign/intro/tugas.pdf"
    assert assert_moodle_https_url(url) == url


@pytest.mark.parametrize(
    "url",
    [
        "http://lmsslc.polinema.ac.id/pluginfile.php/1",
        "https://evil.example/lmsslc.polinema.ac.id",
        "https://lmsslc.polinema.ac.id.evil.com/file",
        "https://user:pass@lmsslc.polinema.ac.id/file",
        "https://lmsslc.polinema.ac.id:8443/file",
        "file:///etc/passwd",
        "",
    ],
)
def test_rejects_non_moodle_urls(url):
    with pytest.raises(UnsafeResourceURL):
        assert_moodle_https_url(url)


def test_attachment_name_prefers_content_disposition():
    header = "attachment; filename=\"Jobsheet 1.pdf\""
    assert attachment_name("https://lmsslc.polinema.ac.id/pluginfile.php/1/x", header) == "Jobsheet 1.pdf"


def test_attachment_name_strips_header_injection():
    header = 'attachment; filename="rapor.pdf\r\nSet-Cookie: a=b"'
    name = attachment_name("https://lmsslc.polinema.ac.id/draft/x", header)
    assert "\r" not in name
    assert "\n" not in name
