# Darts S.A.M. Copyright (C) 2026 Sam Cramphorn. Free software under the GNU
# AGPL v3: see LICENSE and NOTICE, or https://github.com/SonicSamShop/darts-sam
# SPDX-License-Identifier: AGPL-3.0-only

"""What the hosted site tells search engines and link previews.

With the home page at an address of its own ("home" in host.json) and the app at
another ("site"), the same files are at both. Search engines are asked to list
the home address only: every response at any other address says
"X-Robots-Tag: noindex", and every page names its home-address copy as the one
to list (<link rel="canonical">). At the home address, / is web/home.html, the
welcome page written out in plain HTML, not the app.

Every page also gets a preview card (og: and twitter: lines, taken from its own
<title> and description, with the picture web/shots/share.jpg), and the home
page a short description of the app for Google (JSON-LD), so a result can say
it is free. Addresses come from the settings, never from the files: a site of
your own gets its own.

With one address for both (no "home"), / stays the app and nothing is hidden.
"""
import html
import json
import re
from functools import cache
from pathlib import Path
from urllib.parse import urlsplit

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import RedirectResponse, Response

# The pages in the sitemap, the home page ("") first.
PAGES = ["", "autoscoring.html", "compare.html", "faq.html", "rules.html",
         "download.html", "releases.html", "opensource.html", "privacy.html"]
FRONT = ("", "index.html", "home.html")  # the names the home page goes by
PICTURE = "shots/share.jpg"


@cache
def _texts(file: Path) -> tuple[str, str]:
    """A page's title and description, read once ("" for a page without them)."""
    try:
        page = file.read_text(encoding="utf-8")
    except (OSError, UnicodeDecodeError):
        return "", ""
    title = re.search(r"<title>(.*?)</title>", page, re.S)
    desc = re.search(r'<meta name="description" content="([^"]*)"', page)
    return (html.unescape(title.group(1).strip()) if title else "",
            html.unescape(desc.group(1)) if desc else "")


class Search:
    """web: the folder of pages. site: the app's address. home: the home page's
    address, or None when the home page is at the app's."""

    def __init__(self, web: Path, site: str, home: str | None):
        self.web, self.site, self.home = web, site.rstrip("/"), (home or "").rstrip("/") or None
        self.base = self.home or self.site  # the address search engines are told to list
        self.home_host = urlsplit(self.home).netloc if self.home else None

    def at_home(self, scope) -> bool:
        """Whether a request is for the home address (always true with one address)."""
        if not self.home:
            return True
        host = dict(scope.get("headers") or []).get(b"host", b"").decode("latin-1")
        return host == self.home_host

    def install(self, app: FastAPI) -> None:
        @app.middleware("http")
        async def search_engines(request: Request, call_next):
            home = self.at_home(request.scope)
            if self.home and home and request.scope["path"] == "/":
                request.scope["path"] = "/home.html"
            response = await call_next(request)
            if not home:
                response.headers["X-Robots-Tag"] = "noindex"
            return response

        @app.get("/robots.txt")
        def robots(request: Request):
            text = "User-agent: *\nAllow: /\n"
            if self.at_home(request.scope):
                text += f"Sitemap: {self.base}/sitemap.xml\n"
            return Response(text, media_type="text/plain")

        @app.get("/sitemap.xml")
        def sitemap(request: Request):
            if not self.at_home(request.scope):
                raise HTTPException(404, "The sitemap is at the home page's address.")
            urls = "".join(f"<url><loc>{html.escape(self.base)}/{page}</loc></url>\n" for page in PAGES)
            return Response('<?xml version="1.0" encoding="UTF-8"?>\n'
                            f'<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n{urls}</urlset>\n',
                            media_type="application/xml")

        @app.get("/play")
        def play():
            """"Open the app" on the home page: the app is at the app's address."""
            return RedirectResponse(self.site + "/", status_code=302)

    def head(self, scope) -> str:
        """The lines put at the end of a page's <head>."""
        page = str(scope.get("path") or "/").lstrip("/")
        front = page in FRONT
        if front:
            page = ""
        url = f"{self.base}/{page}"
        e = lambda s: html.escape(s, quote=True)  # noqa: E731
        lines = [f'<link rel="canonical" href="{e(url)}">']
        name = (("home.html" if self.home and self.at_home(scope) else "index.html") if front else page)
        file = (self.web / name).resolve()
        title, desc = _texts(file) if file.suffix == ".html" and file.is_relative_to(self.web.resolve()) else ("", "")
        if title:
            picture = f"{self.base}/{PICTURE}"
            lines += [f'<meta property="og:title" content="{e(title)}">',
                      f'<meta property="og:description" content="{e(desc)}">',
                      f'<meta property="og:url" content="{e(url)}">',
                      f'<meta property="og:image" content="{e(picture)}">',
                      '<meta property="og:type" content="website">',
                      '<meta property="og:site_name" content="Darts S.A.M">',
                      '<meta name="twitter:card" content="summary_large_image">']
            if front and self.at_home(scope):
                about = {"@context": "https://schema.org", "@type": "SoftwareApplication", "name": "Darts S.A.M",
                         "applicationCategory": "SportsApplication", "operatingSystem": "Web, Windows, macOS, Linux",
                         "description": desc, "url": f"{self.base}/", "image": picture,
                         "offers": {"@type": "Offer", "price": "0", "priceCurrency": "GBP"}}
                ld = json.dumps(about, indent=1, ensure_ascii=False).replace("</", "<\\/")
                lines.append(f'<script type="application/ld+json">\n{ld}\n</script>')
        return "".join(line + "\n" for line in lines)
