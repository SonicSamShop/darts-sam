# Darts S.A.M. Copyright (C) 2026 Sam Cramphorn. Free software under the GNU
# AGPL v3: see LICENSE and NOTICE, or https://github.com/SonicSamShop/darts-sam
# SPDX-License-Identifier: AGPL-3.0-only

"""The trial's private pages, for whoever runs the hosted site.

  /admin            every account: set-up, how far along, games, how accurate the cameras were
  /admin/reports    problem reports sent up by people's helpers, with the pictures
  /admin/feedback   what people have written

Plain pages made here, no scripts. Only accounts signed in with a Google
address listed under "admins" in host.json see them; to anyone else these
addresses do not exist (404). Everything a person typed is escaped.
"""
import io
import json
import zipfile
from datetime import datetime, timezone
from html import escape as e

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
                        "reports": len(store.reports(acc["id"]))})
        return out

    @router.get("/admin")
    def home(request: Request):
        admin(request)
        rows = people()

        def accuracy(group):
            kept = sum(p["n"]["kept"] for p in group)
            judged = kept + sum(p["n"]["corrected"] + p["n"]["missed"] for p in group)
            return (kept / judged if judged else None), judged
        overall, judged = accuracy(rows)
        tiles = "".join(f'<div class="tile"><b>{sum(1 for p in rows if p["steps"][i])}</b>{e(name)}</div>'
                        for i, name in enumerate(insight.STEPS))
        tiles += f'<div class="tile"><b>{pct(overall)}</b>Accuracy, {judged} camera darts</div>'
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
            return (f'<tr><td><b>{e(p["nickname"])}</b>{" (admin)" if p["admin"] else ""}</td><td class=steps>{steps}</td>'
                    f'<td>{setup}</td><td class=n title="{games}">{n["games"]}</td><td class=n>{n["darts"]}</td>'
                    f'<td class=n>{n["kept"]}</td><td class=n>{n["corrected"]}</td><td class=n>{n["missed"]}</td>'
                    f'<td class=n><b>{pct(n["accuracy"])}</b></td><td class=n>{n["days_played"]}</td>'
                    f'<td class=n><a href="/admin/reports?who={e(p["id"])}">{p["reports"]}</a></td>'
                    f'<td>{when(p["created"])}</td><td>{when(p["last_seen"])}</td></tr>')
        table = ("<table><tr><th>Who</th><th>Path</th><th>Set-up</th><th class=n>Games</th><th class=n>Darts</th>"
                 "<th class=n>Camera darts kept</th><th class=n>Corrected</th><th class=n>Missed</th><th class=n>Accuracy</th>"
                 "<th class=n>Days played</th><th class=n>Reports</th><th>Joined</th><th>Last signed in</th></tr>"
                 + "".join(row(p) for p in rows) + "</table>")
        legend = ('<p class="muted">Path: ' + " → ".join(insight.STEPS) + ". Kept: camera darts left as scored. Corrected: "
                  "camera darts undone and entered by hand. Missed: darts entered by hand in a game the cameras were "
                  "scoring. Accuracy = kept ÷ (kept + corrected + missed). Times are UTC.</p>")
        cams = (f"<h2>Accuracy by number of cameras</h2><table style='width:auto'><tr><th>Set-up</th><th class=n>People</th>"
                f"<th class=n>Accuracy</th><th class=n>Camera darts</th></tr>{split}</table>") if split else ""
        return page("People", f'<div class="tiles">{tiles}</div>{table}{legend}{cams}')

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
