# Darts S.A.M. Copyright (C) 2026 Sam Cramphorn. Free software under the GNU
# AGPL v3: see LICENSE and NOTICE, or https://github.com/SonicSamShop/darts-sam
# SPDX-License-Identifier: AGPL-3.0-only

"""The trial's private pages, for whoever runs the hosted site.

  /admin            every account: set-up, how far along, games, how accurate the cameras were;
                    sorted and filtered from the address, e.g. /admin?sort=games&dir=desc&setup=paired
  /admin/reports    problem reports sent up by people's helpers, with the pictures
  /admin/feedback   what people have written

Plain pages made here, no scripts. Only accounts signed in with a Google
address listed under "admins" in host.json see them; to anyone else these
addresses do not exist (404). Everything a person typed is escaped.
"""
import io
import json
import time
import zipfile
from datetime import datetime, timezone
from html import escape as e
from urllib.parse import urlencode

from fastapi import APIRouter, HTTPException, Request, Response
from fastapi.responses import FileResponse, HTMLResponse

from . import build, insight, reportsync

STYLE = """
body { font: 15px/1.45 system-ui, sans-serif; margin: 0; background: #f6f5f1; color: #1c1c1c; }
header { background: #1c1c1c; color: #fff; padding: 10px 20px; display: flex; gap: 22px; align-items: baseline; }
header a { color: #fff; } header b { font-size: 18px; }
main { padding: 16px 20px 60px; max-width: 1280px; }
table { border-collapse: collapse; width: 100%; background: #fff; }
th, td { text-align: left; padding: 6px 10px; border-bottom: 1px solid #e3e0d8; vertical-align: top; }
th { font-size: 12px; text-transform: uppercase; letter-spacing: .04em; color: #666; }
td.n, th.n { text-align: right; font-variant-numeric: tabular-nums; }
.steps { white-space: nowrap; }
.steps span { display: inline-block; width: 12px; height: 12px; border-radius: 50%; background: #d8d4c8; margin-right: 3px; }
.steps span.on { background: #2e7d4f; }
.tiles { display: flex; gap: 12px; flex-wrap: wrap; margin: 0 0 18px; }
.tile { background: #fff; padding: 10px 14px; min-width: 120px; }
.tile b { display: block; font-size: 24px; }
.muted { color: #777; } .quote { white-space: pre-wrap; }
figure { display: inline-block; margin: 0 10px 14px 0; max-width: 400px; vertical-align: top; }
figure img { max-width: 100%; display: block; } figcaption { font-size: 13px; color: #555; }
h1 { font-size: 22px; } h2 { font-size: 17px; margin-top: 26px; }
th a { color: inherit; text-decoration: none; } th a:hover { text-decoration: underline; } th a.on { color: #1c1c1c; }
form.filter { display: flex; gap: 10px 16px; flex-wrap: wrap; align-items: end; margin: 0 0 12px; }
form.filter label { display: flex; flex-direction: column; font-size: 12px; color: #666; gap: 2px; }
form.filter input, form.filter select, form.filter button { font: inherit; padding: 4px 6px; }
"""

# The pages have no scripts, so the browser is told to run none: if something a
# person sent ever gets through unescaped, it still can't do anything.
CSP = "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'"
HEADERS = {"Cache-Control": "no-store", "Content-Security-Policy": CSP, "X-Content-Type-Options": "nosniff"}


def when(ms) -> str:
    if not ms:
        return "–"
    t = datetime.fromtimestamp(ms / 1000, timezone.utc)
    return f"{t.day} {t:%b %Y %H:%M}"  # not %-d: Windows has no such format


def pct(x) -> str:
    return "–" if x is None else f"{x * 100:.1f}%"


def page(title: str, body: str) -> HTMLResponse:
    return HTMLResponse(f"""<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex">
<title>{e(title)} · Darts S.A.M trial</title><style>{STYLE}</style></head><body>
<header><b>Darts S.A.M trial</b><a href="/admin">People</a><a href="/admin/reports">Reports</a>
<a href="/admin/feedback">Feedback</a><a href="/">The app</a><span style="margin-left:auto;color:#aaa">Version {e(build.label())}</span></header><main><h1>{e(title)}</h1>{body}</main></body></html>""",
                        headers=HEADERS)


# The People table's columns: (sort key, heading, numeric?, value to sort by).
# Sorting and filtering are done here from the address (?sort=games&dir=desc&q=ann),
# so the page still needs no script.
COLUMNS = [
    ("who", "Who", False, lambda p: (p["nickname"] or "").lower()),
    ("path", "Path", False, lambda p: sum(p["steps"])),
    ("setup", "Set-up", False, lambda p: None if not p["helper"] else (p["helper"]["cameras"] or 0)),
    ("games", "Games", True, lambda p: p["n"]["games"]),
    ("darts", "Darts", True, lambda p: p["n"]["darts"]),
    ("kept", "Camera darts kept", True, lambda p: p["n"]["kept"]),
    ("corrected", "Corrected", True, lambda p: p["n"]["corrected"]),
    ("missed", "Missed", True, lambda p: p["n"]["missed"]),
    ("accuracy", "Accuracy", True, lambda p: p["n"]["accuracy"]),
    ("days", "Days played", True, lambda p: p["n"]["days_played"]),
    ("sets", "Sets of darts", True, lambda p: (p["n"]["comparing"], p["n"]["sets"])),
    ("time", "Time played", True, lambda p: p["n"]["played_ms"]),
    ("reports", "Reports", True, lambda p: p["reports"]),
    ("joined", "Joined", False, lambda p: p["created"]),
    ("signins", "Sign-ins", True, lambda p: p["signins"]),
    ("last", "Last signed in", False, lambda p: p["last_seen"]),
]
SORTS = {key: value for key, _, _, value in COLUMNS}
SETUPS = {"": "Anyone", "none": "No cameras", "paired": "Has cameras", "connected": "Connected now",
          "1": "1 camera", "2": "2 cameras", "3": "3 cameras", "4": "4+ cameras"}
SEEN = {"": "Any time", "1": "Last 24 hours", "7": "Last 7 days", "30": "Last 30 days", "old": "Over 30 days ago"}


def sort_rows(rows: list[dict], sort: str, desc: bool) -> list[dict]:
    """Sorted by one column; people with nothing in it always go last."""
    value = SORTS.get(sort)
    if not value:
        return rows
    have = [p for p in rows if value(p) is not None]
    return sorted(have, key=value, reverse=desc) + [p for p in rows if value(p) is None]


def filter_rows(rows: list[dict], q: str, setup: str, reached: str, seen: str, now_ms: int) -> list[dict]:
    q = q.strip().lower()

    def keep(p):
        h = p["helper"]
        if q and q not in (p["nickname"] or "").lower():
            return False
        if setup == "none" and h:
            return False
        if setup == "paired" and not h:
            return False
        if setup == "connected" and not p["connected"]:
            return False
        if setup in ("1", "2", "3") and not (h and h["cameras"] == int(setup)):
            return False
        if setup == "4" and not (h and (h["cameras"] or 0) >= 4):
            return False
        if reached.isdigit() and int(reached) < len(insight.STEPS):
            if not p["steps"][int(reached)]:
                return False
        if seen:
            ago = now_ms - (p["last_seen"] or 0)
            if seen == "old" and ago <= 30 * 86400000:
                return False
            if seen.isdigit() and ago > int(seen) * 86400000:
                return False
        return True
    return [p for p in rows if keep(p)]


def options(choices: dict, chosen: str) -> str:
    return "".join(f'<option value="{e(k)}"{" selected" if k == chosen else ""}>{e(v)}</option>' for k, v in choices.items())


def make_router(store, relay, account) -> APIRouter:
    """account(request) -> the signed-in account or None."""
    router = APIRouter()

    def admin(request: Request):
        who = account(request)
        if not who or not who["admin"]:
            raise HTTPException(404, "Not Found")

    def people() -> list[dict]:
        out = []
        for acc in store.accounts():
            helper = store.helper(acc["id"])
            n = insight.numbers(store.account_db(acc["id"]), store.count_events(acc["id"], "correction"))
            calibrated = sum(1 for ev in store.events(acc["id"], "calibrated") if ev["detail"].get("ok"))
            out.append({**acc, "helper": helper, "connected": relay.connected(acc["id"]), "n": n,
                        "steps": insight.steps(acc, helper, n, calibrated),
                        # signing up signs you in; sign-ins after that were only counted from 1.4 on
                        "signins": store.count_events(acc["id"], "signup") + store.count_events(acc["id"], "signin"),
                        "reports": len(store.reports(acc["id"]))})
        return out

    @router.get("/admin")
    def home(request: Request, q: str = "", setup: str = "", reached: str = "", seen: str = "",
             sort: str = "", dir: str = ""):
        admin(request)
        everyone = people()
        setup = setup if setup in SETUPS else ""
        seen = seen if seen in SEEN else ""
        sort = sort if sort in SORTS else ""
        desc = dir == "desc"
        rows = sort_rows(filter_rows(everyone, q, setup, reached, seen, int(time.time() * 1000)), sort, desc)
        filters = {k: v for k, v in (("q", q.strip()), ("setup", setup), ("reached", reached), ("seen", seen)) if v}

        def accuracy(group):
            kept = sum(p["n"]["kept"] for p in group)
            judged = kept + sum(p["n"]["corrected"] + p["n"]["missed"] for p in group)
            return (kept / judged if judged else None), judged
        overall, judged = accuracy(rows)
        tiles = "".join(f'<div class="tile"><b>{sum(1 for p in rows if p["steps"][i])}</b>{e(name)}</div>'
                        for i, name in enumerate(insight.STEPS))
        tiles += f'<div class="tile"><b>{pct(overall)}</b>Accuracy, {judged} camera darts</div>'
        tiles += f'<div class="tile"><b>{sum(p["signins"] for p in rows)}</b>Sign-ins</div>'
        tiles += (f'<div class="tile"><b>{sum(p["n"]["comparing"] for p in rows)}</b>Players with 2+ sets to compare,'
                  f' {sum(p["n"]["sets"] for p in rows)} sets</div>')
        by_cams = {}
        for p in rows:
            if p["helper"] and p["helper"]["cameras"] is not None:
                by_cams.setdefault(p["helper"]["cameras"], []).append(p)
        split = "".join(f"<tr><td>{e(str(cams))} camera{'s' if cams != 1 else ''}</td><td class=n>{len(group)}</td>"
                        f"<td class=n>{pct(accuracy(group)[0])}</td><td class=n>{accuracy(group)[1]}</td></tr>"
                        for cams, group in sorted(by_cams.items()))

        def row(p):
            h, n = p["helper"], p["n"]
            setup = "no cameras" if not h else (
                f'{e(str(h["cameras"] if h["cameras"] is not None else "?"))} cameras ({e(str(h["calibrated"] or 0))} calibrated), '
                f'{e(str(h["platform"] or "?"))}{", connected now" if p["connected"] else ""}')
            steps = "".join(f'<span class="{"on" if on else ""}" title="{e(name)}"></span>' for on, name in zip(p["steps"], insight.STEPS))
            games = ", ".join(f"{e(g)} {c}" for g, c in n["by_game"].items())
            comparing = f' ({n["comparing"]} comparing)' if n["comparing"] else ""
            return (f'<tr><td><b>{e(p["nickname"])}</b>{" (admin)" if p["admin"] else ""}</td><td class=steps>{steps}</td>'
                    f'<td>{setup}</td><td class=n title="{games}">{n["games"]}</td><td class=n>{n["darts"]}</td>'
                    f'<td class=n>{n["kept"]}</td><td class=n>{n["corrected"]}</td><td class=n>{n["missed"]}</td>'
                    f'<td class=n><b>{pct(n["accuracy"])}</b></td><td class=n>{n["days_played"]}</td>'
                    f'<td class=n>{n["sets"]}{comparing}</td>'
                    f'<td class=n>{n["played_ms"] // 3600000}h {n["played_ms"] // 60000 % 60:02d}m</td>'
                    f'<td class=n><a href="/admin/reports?who={e(p["id"])}">{p["reports"]}</a></td>'
                    f'<td>{when(p["created"])}</td><td class=n>{p["signins"]}</td><td>{when(p["last_seen"])}</td></tr>')
        def heading(key, name, numeric, _):
            # a click sorts by the column; a second click turns it round. Numbers start biggest first.
            on = key == sort
            down = (not desc) if on else (numeric or key in ("joined", "last", "path", "setup"))
            link = "/admin?" + urlencode({**filters, "sort": key, "dir": "desc" if down else "asc"})
            mark = (" ▼" if desc else " ▲") if on else ""
            return f'<th{" class=n" if numeric else ""}><a href="{e(link)}"{" class=on" if on else ""}>{e(name)}{mark}</a></th>'
        table = ("<table><tr>" + "".join(heading(*c) for c in COLUMNS) + "</tr>"
                 + "".join(row(p) for p in rows) + "</table>") if rows else '<p class="muted">Nobody matches.</p>'
        steps_choice = {"": "Anywhere"} | {str(i): name for i, name in enumerate(insight.STEPS) if i}
        hidden = "".join(f'<input type="hidden" name="{k}" value="{e(v)}">' for k, v in (("sort", sort), ("dir", dir)) if sort)
        form = (f'<form class="filter" method="get" action="/admin">'
                f'<label>Name<input type="search" name="q" value="{e(q.strip())}"></label>'
                f'<label>Set-up<select name="setup">{options(SETUPS, setup)}</select></label>'
                f'<label>Got as far as<select name="reached">{options(steps_choice, reached)}</select></label>'
                f'<label>Last signed in<select name="seen">{options(SEEN, seen)}</select></label>'
                f'{hidden}<button type="submit">Filter</button>'
                + (f'<span class="muted">Showing {len(rows)} of {len(everyone)} · <a href="/admin">Clear</a></span>'
                   if filters or sort else "")
                + "</form>")
        legend = ('<p class="muted">Path: ' + " → ".join(insight.STEPS) + ". Kept: camera darts left as scored. Corrected: "
                  "camera darts undone and entered by hand. Missed: darts entered by hand in a game the cameras were "
                  "scoring. Accuracy = kept ÷ (kept + corrected + missed). Time played: every game from its start to its winning "
                  "(or, if not finished, last) dart. Sign-ins: times they signed in, sign-up included; staying signed in "
                  "(90 days on a device) is not a new one, and sign-ins before version 1.4 were not counted. Times are UTC.</p>")
        cams = (f"<h2>Accuracy by number of cameras</h2><table style='width:auto'><tr><th>Set-up</th><th class=n>People</th>"
                f"<th class=n>Accuracy</th><th class=n>Camera darts</th></tr>{split}</table>") if split else ""
        return page("People", f'<div class="tiles">{tiles}</div>{form}{table}{legend}{cams}')

    @router.get("/admin/feedback")
    def feedback(request: Request):
        admin(request)
        rows = "".join(
            f'<tr><td>{when(f["ts"])}</td><td><b>{e(f["nickname"])}</b></td><td class=quote>{e(f["text"])}</td>'
            f'<td class=muted>{e(json.dumps(f["detail"]))}</td></tr>' for f in store.feedback())
        return page("Feedback", f"<table><tr><th>When</th><th>Who</th><th>What they said</th><th>From</th></tr>{rows}</table>"
                    if rows else '<p class="muted">Nothing yet.</p>')

    @router.get("/admin/reports")
    def reports(request: Request, who: str | None = None):
        admin(request)
        rows = "".join(
            f'<tr><td>{when(r["ts"])}</td><td><b>{e(r["nickname"])}</b></td>'
            f'<td><a href="/admin/reports/{r["account_id"]}/{e(r["id"])}">{e(r["summary"] or r["id"])}</a></td>'
            f'<td>{e(r["expected"])}</td><td class=quote>{e(r["note"])}</td><td class=n>{r["bytes"] / 2**20:.1f} MB</td></tr>'
            for r in store.reports(who))
        return page("Problem reports", "<table><tr><th>Received</th><th>Who</th><th>What the cameras decided</th>"
                    f"<th>Should have been</th><th>Their note</th><th class=n>Size</th></tr>{rows}</table>"
                    '<p class="muted">Kept for 60 days.</p>' if rows else '<p class="muted">None yet.</p>')

    def folder_of(account_id: str, report_id: str):
        try:
            folder = store.report_folder(account_id, report_id)
        except ValueError:
            raise HTTPException(404, "Not Found")
        if store.report(account_id, report_id) is None or not folder.is_dir():
            raise HTTPException(404, "Not Found")
        return folder

    @router.get("/admin/reports/{account_id}/{report_id}")
    def report(request: Request, account_id: str, report_id: str):
        admin(request)
        folder = folder_of(account_id, report_id)
        row = store.report(account_id, report_id)
        try:
            r = json.loads((folder / "report.json").read_text())
        except (OSError, ValueError):
            r = {}
        base = f"/admin/reports/{account_id}/{e(report_id)}"

        def part(p):
            if not isinstance(p, dict):
                return ""
            lines, cams = p.get("lines") or [], list((p.get("cameras") or {}).values())
            pics = "".join(
                f'<figure><a href="{base}/{e(str(c.get("seen")))}"><img src="{base}/{e(str(c.get("seen")))}" alt=""></a>'
                f'<figcaption>{e(str(lines[i]) if i < len(lines) else "")}</figcaption></figure>'
                for i, c in enumerate(cams) if isinstance(c, dict) and reportsync.SAFE_FILE.match(str(c.get("seen"))))
            return f'<h2>{e(str(p.get("summary", "")))}</h2>{pics}'
        app = r.get("app") or {}
        said = (f'<p><b>Should have been:</b> {e(row["expected"]) or "<span class=muted>not said</span>"}<br>'
                f'<b>Their note:</b> <span class=quote>{e(row["note"]) or "<span class=muted>none</span>"}</span></p>')
        context = (f'<p class="muted">{e(row["nickname"])} · received {when(row["ts"])} · game {e(str(app.get("game", "?")))} · '
                   f'the app showed this visit as {e(json.dumps([d.get("label") for d in app.get("visit") or [] if isinstance(d, dict)]))} · '
                   f'<a href="{base}/download.zip">Download everything</a> (for <code>python -m server.replay</code>)</p>')
        looks = r.get("looks") if isinstance(r.get("looks"), list) else []
        body = said + context + "".join(part(p) for p in reversed(looks)) + part(r.get("now"))
        body += ('<p class="muted">Red is what changed in the picture, green is the board as the calibration has it, yellow '
                 "the line of the dart, the cyan ring that camera's tip, and the magenta cross what was scored. Newest first.</p>")
        return page(f"Report {report_id}", body)

    @router.get("/admin/reports/{account_id}/{report_id}/download.zip")
    def download(request: Request, account_id: str, report_id: str):
        admin(request)
        folder = folder_of(account_id, report_id)
        data = io.BytesIO()
        with zipfile.ZipFile(data, "w", zipfile.ZIP_STORED) as z:
            for p in sorted(folder.iterdir()):
                if p.is_file() and reportsync.SAFE_FILE.match(p.name):
                    z.write(p, f"{report_id}/{p.name}")
        return Response(data.getvalue(), media_type="application/zip",
                        headers={"Content-Disposition": f'attachment; filename="{report_id}.zip"'})

    @router.get("/admin/reports/{account_id}/{report_id}/{name}")
    def report_file(request: Request, account_id: str, report_id: str, name: str):
        admin(request)
        folder = folder_of(account_id, report_id)
        if not reportsync.SAFE_FILE.match(name) or not (folder / name).is_file():
            raise HTTPException(404, "Not Found")
        return FileResponse(folder / name, headers={"Cache-Control": "private, max-age=3600"})

    return router
