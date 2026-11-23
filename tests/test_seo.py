# Darts S.A.M. Copyright (C) 2026 Sam Cramphorn. Free software under the GNU
# AGPL v3: see LICENSE and NOTICE, or https://github.com/SonicSamShop/darts-sam
# SPDX-License-Identifier: AGPL-3.0-only

"""What search engines and link previews are given (server/seo.py). Run: python -m tests.test_seo"""
import json
import sys
import tempfile
from pathlib import Path

sys.modules["cv2"] = None    # the host must not need OpenCV…
sys.modules["numpy"] = None  # …or numpy

from fastapi.testclient import TestClient  # noqa: E402

from server import host, seo  # noqa: E402

BASE = {"google_client_id": "client-123", "dev": True}
SPLIT = {**BASE, "site": "https://app.darts.example", "home": "https://darts.example"}


def main():
    with tempfile.TemporaryDirectory() as tmp:
        app = host.create(Path(tmp) / "split", SPLIT)
        front = TestClient(app, base_url="https://darts.example")
        appc = TestClient(app, base_url="https://app.darts.example")
        stray = TestClient(app, base_url="http://203.0.113.9")

        # / at the home address is home.html, with its head lines; at the app address it is the app
        r = front.get("/")
        assert r.status_code == 200 and "free darts autoscorer" in r.text.lower() and 'id="signin"' in r.text, r.text[:300]
        assert '<link rel="canonical" href="https://darts.example/">' in r.text
        assert '<meta property="og:image" content="https://darts.example/shots/share.jpg">' in r.text
        assert '"@type": "SoftwareApplication"' in r.text and '"price": "0"' in r.text
        ld = r.text.split('<script type="application/ld+json">')[1].split("</script>")[0]
        json.loads(ld)  # valid JSON
        assert "x-robots-tag" not in r.headers
        r = appc.get("/")
        assert '<div id="app"></div>' in r.text and r.headers["x-robots-tag"] == "noindex"
        assert '<link rel="canonical" href="https://darts.example/">' in r.text  # the app's copy points home
        assert "SoftwareApplication" not in r.text
        r = stray.get("/")
        assert r.headers["x-robots-tag"] == "noindex" and '<div id="app"></div>' in r.text

        # every other page: canonical at the home address, preview lines from its own title and description
        r = front.get("/faq.html")
        assert '<link rel="canonical" href="https://darts.example/faq.html">' in r.text
        assert '<meta property="og:title" content="Darts S.A.M · questions and answers">' in r.text
        assert 'property="og:description"' in r.text and 'name="twitter:card" content="summary_large_image"' in r.text
        assert appc.get("/faq.html").headers["x-robots-tag"] == "noindex"
        assert front.get("/index.html").text.count('rel="canonical" href="https://darts.example/"') == 1

        # robots and sitemap
        r = front.get("/robots.txt")
        assert r.status_code == 200 and r.headers["content-type"].startswith("text/plain"), r.headers
        assert "User-agent: *\nAllow: /" in r.text and "Sitemap: https://darts.example/sitemap.xml" in r.text
        r = appc.get("/robots.txt")
        assert r.status_code == 200 and "Sitemap" not in r.text
        r = front.get("/sitemap.xml")
        assert r.status_code == 200 and r.headers["content-type"].startswith("application/xml"), r.headers
        for page in seo.PAGES:
            assert f"<loc>https://darts.example/{page}</loc>" in r.text, page
            assert page == "" or (host.WEB / page).is_file(), page  # no page listed that isn't there
        assert appc.get("/sitemap.xml").status_code == 404

        # "Open the app" from the home page
        r = front.get("/play", follow_redirects=False)
        assert r.status_code == 302 and r.headers["location"] == "https://app.darts.example/", r.headers

        # one address: nothing hidden, / is still the app, canonical at "site"
        one = TestClient(host.create(Path(tmp) / "one", {**BASE, "site": "https://darts.example"}),
                         base_url="https://darts.example")
        r = one.get("/")
        assert '<div id="app"></div>' in r.text and "x-robots-tag" not in r.headers
        assert '<link rel="canonical" href="https://darts.example/">' in r.text
        assert "Sitemap: https://darts.example/sitemap.xml" in one.get("/robots.txt").text
        assert one.get("/play", follow_redirects=False).headers["location"] == "https://darts.example/"

        # head() on its own: no page text gives no preview lines, and odd characters are escaped
        s = seo.Search(Path(tmp), "https://a.example", "https://h.example")
        at_home = {"path": "/nothere.html", "headers": [(b"host", b"h.example")]}
        assert s.head(at_home) == '<link rel="canonical" href="https://h.example/nothere.html">\n', s.head(at_home)
        (Path(tmp) / "odd.html").write_text('<title>A "b" <c> & d</title>')
        assert '&quot;b&quot; &lt;c&gt; &amp; d' in s.head({"path": "/odd.html", "headers": [(b"host", b"h.example")]})
    print("seo: ok")


if __name__ == "__main__":
    main()
