"""Sending the sign-in email.

The host sends one kind of email: the code (and link) someone asked for to
sign in with. It goes through Resend (resend.com), over https, because cloud
servers are not allowed to send mail themselves.
"""
import html
import json
import urllib.request

RESEND = "https://api.resend.com/emails"


class NotSent(Exception):
    pass


def sign_in_message(code: str, link: str, minutes: int) -> dict:
    """What the email says: {"subject", "text", "html"}."""
    spaced = f"{code[:3]} {code[3:]}"
    text = (f"Your Darts S.A.M sign-in code is {spaced}\n\n"
            f"Type it into Darts S.A.M, or open this link on the device you want to play on:\n{link}\n\n"
            f"It works once, for the next {minutes} minutes. If you didn't ask for it, ignore this email: "
            "nobody can sign in without it.\n")
    page = (f'<p>Your Darts S.A.M sign-in code is</p><p style="font-size:32px;font-weight:bold;letter-spacing:4px">{spaced}</p>'
            f'<p>Type it into Darts S.A.M, or <a href="{html.escape(link)}">sign in on this device</a>.</p>'
            f"<p>It works once, for the next {minutes} minutes. If you didn't ask for it, ignore this email: "
            "nobody can sign in without it.</p>")
    return {"subject": f"{spaced} is your Darts S.A.M sign-in code", "text": text, "html": page}


def sender(settings: dict):
    """send(to, message) for the host's settings, or None where sending is not
    set up. settings["email"]: {"resend_key", "from"}. With "dev" on and no
    key, the email is printed on the terminal instead, to try it on a laptop."""
    email = settings.get("email") or {}
    key, sent_from = email.get("resend_key"), email.get("from")
    if key and sent_from:
        def send(to: str, message: dict):
            # A plain "Python-urllib" caller is turned away by the service's front door.
            ask = urllib.request.Request(RESEND, data=json.dumps({"from": sent_from, "to": [to], **message}).encode(), headers={
                "Authorization": f"Bearer {key}", "Content-Type": "application/json", "User-Agent": "dartssam-host"})
            try:
                with urllib.request.urlopen(ask, timeout=10):
                    pass
            except Exception as e:  # refused, or not reached
                raise NotSent(str(e))
        return send
    if settings.get("dev"):
        return lambda to, message: print(f"--- email to {to} ---\n{message['text']}", flush=True)
    return None
