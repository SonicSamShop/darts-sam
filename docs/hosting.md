# Running the hosted site

The hosted site is `python -m server.host`: one address where people sign in
with Google, Apple or a code sent by email and have their own players, games and stats. It needs no cameras
and no OpenCV (`requirements-host.txt`). Nobody plays there without signing in:
a signed-out visitor gets the welcome page (`renderLanding()` in `web/screens/landing.js`),
and their first sign-in makes the account and a first player with their first
name (someone signing in by email is asked for it). This page takes a new
server from nothing to running.

It is written as it was done for the official site, so the commands name
`dartssam.co.uk`. **For a site of your own, put your own names in their
place**, in the commands, in `host.json` and in the `Caddyfile`. The
[NOTICE](../NOTICE) file says what the licence asks of you: show the credit
"Based on Darts S.A.M by Sam Cramphorn" in the app's settings and your
documentation, and if you have changed the code, say so, call it something
other than Darts S.A.M, and give its users your source (`SOURCE` in
`web/app.js` is the link the app shows). Desktop apps you give out should
point at your site, not the official one (`DEFAULT_HOST` in `server/link.py`),
and `REPO` in `tools/fetch_apps.py` is where your site fetches their builds from.

Steps 1 to 4, and step 5's backup and nightly schedule, were followed on
2026-11-16 to put `dartssam.co.uk` on a Google Cloud `e2-micro` running Ubuntu
26.04 LTS. Restoring a backup and step 6 (updating) have only been run on a
laptop; correct this page the first time you do them on the server.

**Every command on this page is run as root.** Log in to the server and type
`sudo -i` first; the prompt then ends in `#`. On Google Cloud, do this as soon
as the browser's SSH window opens: that window logs you in with a key that
lasts a few minutes, and when it runs out `sudo` starts answering "I'm afraid
I can't do that" although the window stays open. A root shell opened before
then keeps working. If it has already happened, close the window and press
**SSH** again.

## What you need

- **A small Linux server that stays on**, with Ubuntu 26.04 LTS (not
  the "Minimal" image). Any of:
  Google Cloud's always-free `e2-micro`, Oracle Cloud's always-free machine, or
  a paid one at about £4 a month. 1 GB of memory is plenty.
- **A domain name** you can point at it.
- **The Google sign-in client** (Google Cloud console → Google Auth Platform →
  Clients). You need its Client ID.

## 1. Point the domain at the server

At your domain's provider (where you bought `dartssam.co.uk`), in its DNS
settings add three **A records**, all with the server's public IP address: one
for the name itself (often written `@`), one for `www` and one for `app`. (The
home page is at `dartssam.co.uk` and the app at `app.dartssam.co.uk`; the same
server answers both.) On the server's
firewall (the cloud provider's network settings), allow ports **80** and
**443** in.

`dartssam.co.uk`'s DNS is at Cloudflare. Set all three records to **DNS only** (the
grey cloud, not the orange "Proxied" one), so that Caddy can fetch its own
certificate and the helpers' long-lived connections go straight to the server.

Check from any machine before going on; all three must print the server's address:

```bash
dig +short dartssam.co.uk www.dartssam.co.uk app.dartssam.co.uk
```

## 2. Install

```bash
apt update
apt install -y python3-venv git sqlite3 caddy
useradd --system --home /opt/dartssam --shell /usr/sbin/nologin dartssam
mkdir -p /opt/dartssam /var/lib/dartssam /etc/dartssam/ssh /var/backups/dartssam
chown dartssam: /opt/dartssam /var/lib/dartssam /etc/dartssam/ssh /var/backups/dartssam
```

```bash
runuser -u dartssam -- git clone https://github.com/SonicSamShop/darts-sam.git /opt/dartssam
runuser -u dartssam -- python3 -m venv /opt/dartssam/.venv
runuser -u dartssam -- /opt/dartssam/.venv/bin/pip install --no-cache-dir -r /opt/dartssam/requirements-host.txt
runuser -u dartssam -- python3 /opt/dartssam/tools/fetch_pyodide.py
```

The last line fetches Python for the browser (about 27 MB, not kept in git), which
phones use to score with their own camera ([People's cameras](#peoples-cameras)).

If you run from a private fork instead, give the server a read-only
[deploy key](https://docs.github.com/en/authentication/connecting-to-github-with-ssh/managing-deploy-keys)
and clone over ssh with it.

## 3. Settings

```bash
cp /opt/dartssam/host.example.json /etc/dartssam/host.json
nano /etc/dartssam/host.json
```

- `"google_client_id"`: the Client ID.
- `"apple_client_id"`: the Services ID for "Sign in with Apple" (see below).
  Leave it `""` and the welcome page has no Apple button.
- `"site"`: the app's address, `https://app.dartssam.co.uk`. People sign in and
  play here, and the link in a sign-in email leads here.
- `"home"`: the home page's address, `https://dartssam.co.uk`. It always shows
  the welcome page, whoever is looking, and its buttons lead to the app. Leave
  it out (or make it the same as `"site"`) to have one address for both.
- `"email"`: for signing in by email (see below). Leave `"resend_key"` as `""`
  and the welcome page has no email button.
- `"admins"`: the Google email addresses of the people who run the site. The
  address is only compared at sign-in; it is not stored.
- `"dev"`: leave `false`. (`true` is for a laptop: it lets the sign-in cookie
  travel over plain http.)

In the Google Cloud console, open the client and add `https://app.dartssam.co.uk` (the app's address, where the sign-in buttons are) under
**Authorised JavaScript origins**.

### Signing in by email

Someone without a Google account types their email address, is sent a 6-digit
code and a link, and signs in with either. The server may not send mail itself
(cloud providers block it), so the email goes through [Resend](https://resend.com),
which is free for a few thousand emails a month.

1. Make an account at resend.com.
2. **Domains → Add Domain**, `dartssam.co.uk`. It lists a few DNS records (TXT
   and MX). Add each one in Cloudflare (DNS → Records → Add record) exactly as
   shown, with the proxy switched off (grey cloud, "DNS only") where Cloudflare
   offers the choice. Back in Resend press **Verify**; it can take a few minutes
   to turn green.
3. **API Keys → Create API Key**, permission "Sending access". Copy the key
   (it starts `re_`, and is shown once). Treat it like a password: it goes in
   `host.json` on the server and nowhere else.
4. In `/etc/dartssam/host.json` set:

   ```json
   "site": "https://app.dartssam.co.uk",
   "email": {"resend_key": "re_...", "from": "\"Darts S.A.M\" <signin@dartssam.co.uk>"},
   ```

   and restart the site (`systemctl restart dartssam-host`).

The welcome page now has **Continue with email**. Try it with your own address;
if nothing arrives, look in spam, then at Resend's **Emails** page, which shows
each one and what became of it. The address someone types is used to send that
one email and is not stored; the site keeps only a fingerprint of it, to know
them next time.

### Sign in with Apple

This needs a paid Apple Developer account. At
[developer.apple.com/account](https://developer.apple.com/account) → Certificates,
Identifiers & Profiles → Identifiers:

1. Make an **App ID** (type App), for example `uk.co.dartssam`, and tick **Sign
   in with Apple** in its capabilities.
2. Make a **Services ID**, for example `uk.co.dartssam.web`. Tick **Sign in with
   Apple**, press **Configure**, choose the App ID from step 1 as the primary
   App ID, and add:
   - Domains and subdomains: `app.dartssam.co.uk`
   - Return URLs: `https://app.dartssam.co.uk`
3. Put the Services ID in `host.json` as `"apple_client_id"` and restart the
   site (`systemctl restart dartssam-host`).

No key or secret is needed: the site only checks the token Apple signs. Apple
does not allow `localhost`, so its button cannot be tried on a laptop.

### Counting visitors

The pages can carry Cloudflare Web Analytics' counter: free, no cookies, and a
dashboard of visits, pages, where people came from and their countries. It only
counts from the day it is switched on.

1. In the Cloudflare dashboard, **Analytics & Logs → Web Analytics → Add a site**.
   Type `dartssam.co.uk` and carry on. Because the DNS records are "DNS only",
   it offers a JavaScript snippet to paste instead of setting itself up.
2. From that snippet copy only the token: the letters and numbers after
   `"token": "` (it looks like `0123456789abcdef0123456789abcdef`).
3. In `/etc/dartssam/host.json` add `"analytics_token": "<the token>",` and
   restart the site (`systemctl restart dartssam-host`).

The site adds the counter to every page it sends, on both addresses; the app's
own files and the desktop app never carries it. Visits show in Cloudflare
under Web Analytics after a few minutes, and can be split by address there.

### Google Analytics

Google Analytics shows more than Cloudflare's counter: which of the app's
screens people use (the app is one page, so Cloudflare sees it as one) and
whether they come back. It sets cookies, so each person is asked first: a bar
at the foot of the page, "Allow" or "No thanks" (`web/consent.js`). Google's
script is only fetched after "Allow". The answer covers both addresses and is
asked again after six months; the privacy page has a button to change it.

1. At [analytics.google.com](https://analytics.google.com), make an account and
   a property (Admin → Create → Property). Time zone United Kingdom.
2. Add a **Web** data stream for `https://dartssam.co.uk`. One stream counts
   both addresses (reports split them by "Hostname").
3. In the stream, under **Enhanced measurement**, open the settings (the cog)
   and switch off **Page changes based on browser history events**. The app
   says which screen is showing itself; left on, Google counts each screen a
   second time under an address it cannot read.
4. Admin → Data collection and modification → **Data retention**: two months
   is what the privacy page says. Leave it there, or change both.
5. Copy the stream's **Measurement ID** (`G-` and ten letters and numbers).
6. Find your own addresses, so your visits are not counted: open
   `https://ifconfig.me` at home (and on any other connection you use, like
   your phone on mobile data, though those change). For an IPv6 address
   (it has colons) take its first four groups and add `::/64`, as home IPv6
   addresses change within that range.
7. In `/etc/dartssam/host.json` add:

   ```json
   "google_analytics_id": "G-XXXXXXXXXX",
   "analytics_skip_ips": ["81.2.69.142", "2a00:23c8:1234:5678::/64"],
   ```

   and restart the site (`systemctl restart dartssam-host`).

Pages sent to an address in `analytics_skip_ips` carry neither Google's
question nor Cloudflare's counter. (Caddy passes the visitor's address on in
`X-Forwarded-For`; the site only believes that header from this machine.) To
check: `curl -s https://dartssam.co.uk/faq.html | grep -c consent.js` from home
prints `0`, and the same on mobile data prints `1`. If your home address
changes, update the list.

In Google Analytics, **Reports → Engagement → Pages and screens** lists the
site's pages (`/faq.html`, `/download.html`) and the app's screens (`/menu`,
`/stats`, `/settings/players`, `/game/501`, `/cameras`); `/` is the welcome
page. Only the kind of screen is sent, never names, scores or which game.

### Search engines

Nothing to set. With `"home"` and `"site"` at different addresses, search
engines are asked to list the home address only: everything at the app's
address says `X-Robots-Tag: noindex`, each page names its home-address copy
(`<link rel="canonical">`), and `/robots.txt` points to `/sitemap.xml` at the
home address. Every page carries a preview card for links shared in chats and
posts, with the picture `web/shots/share.jpg` (all in `server/seo.py`).
[search.md](search.md) is what to do outside the site to be found:
Search Console, the store listings, links.

### The Android app

The Google Play app opens this site without an address bar only once the site
names the app's signing keys, at `/.well-known/assetlinks.json`. Add
`"android": {"package": "uk.co.dartssam.app", "fingerprints": [...]}` to
`/etc/dartssam/host.json`: [android.md](android.md), step 3, says where the
fingerprints come from. Left out, that address answers 404.

App store reviewers can't be emailed a sign-in code, so `"review": {"email":
"...", "code": "123456"}` lets that one address sign in with that fixed code
(and sends it nothing): [android.md](android.md), "App access", has the rest.

## 4. Start it

```bash
cp /opt/dartssam/dartssam-host.service /etc/systemd/system/
systemctl enable --now dartssam-host
sleep 5; curl -s localhost:8000/api/me; echo     # {"hosted":true, … "account":null}
```

(A small server takes a few seconds to start it. If the last line prints
nothing, run it again; if it still prints nothing, `journalctl -u
dartssam-host -e --no-pager | tail -30` says why.)

Then the front door. Copy the Caddyfile (it names `dartssam.co.uk` and `app.dartssam.co.uk`: for a site of
your own, change them to your names first) and reload:

```bash
cp /opt/dartssam/Caddyfile /etc/caddy/Caddyfile
systemctl reload caddy
```

Caddy fetches the https certificate by itself within a minute. Open
`https://dartssam.co.uk` (the home page), press **Open the app** and sign in at
`https://app.dartssam.co.uk`.

## 5. Backups

Everything the site keeps is in `/var/lib/dartssam`: `host.db` (accounts and
sign-ins), `accounts/<id>/darts.db` (each account's games) and
`reports/<id>/` (the problem reports people sent). The backup is of the
databases and the board pictures kept beside them (`accounts/<id>/darts.photos/`,
taken when a dart earns an achievement). It leaves the reports out: they are
big, and deleted after 60 days.

```bash
runuser -u dartssam -- /opt/dartssam/tools/backup.sh
# /var/backups/dartssam/dartssam-2026-11-23_031500.tar.gz: 12 databases checked, 4 pictures
```

It writes a dated `.tar.gz` to `/var/backups/dartssam` and keeps the newest 14.
Each new file is unpacked again and every database in it checked, so a backup
that couldn't be restored is found the night it is made; anything wrong and it
stops with a message. Run it every night, its messages going to the system log:

```bash
echo '15 3 * * * dartssam /opt/dartssam/tools/backup.sh 2>&1 | logger -t dartssam-backup' | tee /etc/cron.d/dartssam-backup
```

`journalctl -t dartssam-backup` shows what each night's run said.

**A backup that only exists on the server is lost with the server.** After
making the file the script runs `/etc/dartssam/after-backup`, if there is one,
with the file's name: make that a small program that sends it somewhere else.
For example, with [rclone](https://rclone.org) set up for the `dartssam` user:

```bash
printf '#!/bin/sh\nrclone copy "$1" remote:dartssam-backups\n' > /etc/dartssam/after-backup
chmod 755 /etc/dartssam/after-backup
```

### Restoring

Check the file first (any backup, including one fetched back from elsewhere):

```bash
/opt/dartssam/tools/backup.sh --check /var/backups/dartssam/dartssam-DATE.tar.gz
```

```bash
systemctl stop dartssam-host
mv /var/lib/dartssam /var/lib/dartssam.old
tar -xzf /var/backups/dartssam/dartssam-DATE.tar.gz -C /var/lib
chown -R dartssam: /var/lib/dartssam
systemctl start dartssam-host
```

(The archive holds one folder called `dartssam`, so unpacking it in `/var/lib`
puts it back where it was.)

### Being told

Two free services email you when something is wrong, so you don't have to look.

**The site is down, or its disk nearly full.** `https://app.dartssam.co.uk/api/health`
answers `{"ok":true}` while all is well, and fails (503) when the disk has less
than 2 GB free or the accounts' database won't open. A full disk stops games
being saved and backups being made. (`"disk_low_mb"` in `host.json` moves the
line; it is 2048 if left out.) Have a checker look at it every few minutes:

1. Make a free account at [uptimerobot.com](https://uptimerobot.com).
2. **New monitor**: type **HTTP(s)**, URL `https://app.dartssam.co.uk/api/health`,
   every 5 minutes, alerts to your email.
3. It shows **Up** within a few minutes. It emails when the site stops
   answering, or answers 503, and again when it is back.

If it emails about the disk, `df -h /var/lib/dartssam` and
`du -sh /var/lib/dartssam/* /var/backups/dartssam` show what has filled it.

**A night's backup failed, or never ran.** The backup script tells
[healthchecks.io](https://healthchecks.io) each time it finishes with nothing wrong
(after `after-backup`, if there is one, has sent the file away too). Healthchecks
emails when a day goes by without hearing from it.

1. Make a free account at healthchecks.io. Add a check called `Darts S.A.M backup`:
   **Period** 1 day, **Grace time** 2 hours.
2. Copy its ping address (`https://hc-ping.com/` and a long code). It is like a
   password: whoever has it could say a backup went well.
3. On the server, put it in a file only the site's user can read, and run a backup:

   ```bash
   install -o dartssam -g dartssam -m 600 /dev/null /etc/dartssam/backup-ping
   nano /etc/dartssam/backup-ping      # paste the address, Ctrl+O, Enter, Ctrl+X
   runuser -u dartssam -- /opt/dartssam/tools/backup.sh
   ```

   The check on healthchecks.io turns green. If it emails later, `journalctl -t
   dartssam-backup` says what the last run said.

## 6. Updating

```bash
cd /opt/dartssam && runuser -u dartssam -- git pull
runuser -u dartssam -- .venv/bin/pip install --no-cache-dir -r requirements-host.txt
runuser -u dartssam -- python3 tools/fetch_pyodide.py
systemctl restart dartssam-host
```

`fetch_pyodide.py` only downloads anything when its pinned version has changed.

If the update changed the `Caddyfile`, copy it over again and reload Caddy:

```bash
cp /opt/dartssam/Caddyfile /etc/caddy/Caddyfile && caddy validate --config /etc/caddy/Caddyfile && systemctl reload caddy
```

Open apps notice the new files and reload themselves when no game is being played.

To check which code is running: `curl -s https://app.dartssam.co.uk/version.json`
gives `"release"` (release.json's version), `"build"` (the number of commits)
and `"commit"`; the admin pages show the same at the top right, and
`journalctl -u dartssam-host | grep "Darts S.A.M site"` shows it for each
restart. It is worked out when the site starts, so it only changes after the
restart above.

## The trial's admin pages

`https://app.dartssam.co.uk/admin`, for the Google addresses under `"admins"` in
`/etc/dartssam/host.json` (restart the service after changing it, then sign
out and in again: the address is checked at sign-in). To anyone else the pages
do not exist. Admins also get a link at the bottom of **Settings → Account**.

- **People:** each account's set-up, how far along the trial's path it is,
  games, and how accurate the cameras were: camera darts kept, corrected by
  hand, and missed.
- **Reports:** problem reports sent up by people's helpers, with the cameras'
  pictures and what the person said should have happened. "Download
  everything" gives a zip to unpack into `data/reports/` on your own machine
  and run `python -m server.replay` on. Reports are deleted after 60 days.
- **Feedback:** what people wrote in Settings → Account.

Problem reports are big (20 to 50 MB each, mostly pictures). Each account may
keep 1 GB; watch the server's disk with `df -h /var/lib/dartssam`.

## People's cameras

**A phone's own camera (Beta).** A phone can score with its own camera, all
inside its browser: the site sends it Python for the browser from
`web/vision/pyodide/` (put there by `tools/fetch_pyodide.py`) and the vision code
from `server/` at `/vision/py/`. The site does no vision work and gets no pictures,
except a problem report the player chooses to send (`POST /api/phone/reports/<id>`,
signed in, packed and limited like a paired computer's). Without the fetched
files the app simply doesn't offer it.

**Cameras at home.** The site itself has no cameras. Someone with cameras runs the ordinary server
at home (it knows the site's address), pairs it once with a code
([setup.md](setup.md#using-your-cameras-with-the-hosted-site)), and it then stays
connected to the site. Nothing needs opening on their router: the connection
goes out from their home. The site keeps these connections in memory, so after
a restart every helper reconnects by itself within half a minute.

## The apps to download

`https://dartssam.co.uk/download.html` offers the Mac, Windows and Linux apps (the
welcome page and **Cameras** link to it). It only offers the files
that are in `/opt/dartssam/downloads` on the server, under exactly these names;
one that is missing shows "Coming soon":

| File | For |
|---|---|
| `DartsSAM-arm64.dmg` | Mac, Apple silicon |
| `DartsSAM-x86_64.dmg` | Mac, Intel |
| `DartsSAM.exe` | Windows |
| `DartsSAM-linux-x86_64.tar.gz` | Linux, 64-bit Intel and AMD |

The server fetches them from GitHub by itself: `tools/fetch_apps.py` asks for
the newest Mac, Windows and Linux builds from `main` and fetches any whose
**version** is newer than the file in the folder. GitHub only builds when the
version in `release.json` goes up (or when a build is started by hand, which
is not given out) (see [releasing.md](releasing.md)). It also writes `releases.json` in the folder: each file's version and
what changed, which the desktop apps ask about when they start. Set it up once:

1. Make a token that can only read this repository's builds. On GitHub: your
   picture → **Settings → Developer settings → Personal access tokens →
   Fine-grained tokens → Generate new token**. **Repository access**: Only
   select repositories → `darts-sam`. **Permissions → Repository permissions →
   Actions**: Read-only. Copy the token (it starts `github_pat_`, and is shown
   once). Treat it like a password: it goes in the file below and nowhere else.
2. On the server, put it in a file only the site's user can read, and try it:

   ```bash
   install -o dartssam -g dartssam -m 600 /dev/null /etc/dartssam/github-token
   nano /etc/dartssam/github-token      # paste the token, Ctrl+O, Enter, Ctrl+X
   runuser -u dartssam -- python3 /opt/dartssam/tools/fetch_apps.py
   ls -lh /opt/dartssam/downloads
   ```

   The first run prints one "fetched version ..." line for each app (about
   a minute). A run with nothing new prints nothing.
3. Run it every ten minutes:

   ```bash
   echo '*/10 * * * * dartssam python3 /opt/dartssam/tools/fetch_apps.py 2>&1 | logger -t dartssam-apps' | tee /etc/cron.d/dartssam-apps
   ```

From then on a release pushed to `main` is on the download page about a
quarter of an hour later (GitHub takes about five minutes to build), and the
desktop apps already out there offer it the next time they start. `journalctl -t
dartssam-apps -e` shows what it fetched and anything that went wrong. If a
fetch fails, the file that is there stays. The token runs out on the date you
chose when making it (a year at most): make a new one and paste it into the
same file. GitHub keeps a build for 14 days; the file on the server stays
after that.

By hand instead: **Actions → the latest Mac / Windows / Linux run → Artifacts** (each
comes as a `.zip`: unzip it on your own computer first), **Upload file** in the
browser SSH window, then `mv /home/*/DartsSAM* /opt/dartssam/downloads/` and
`chown -R dartssam: /opt/dartssam/downloads`.

No restart is needed: the page shows a file, with its size and build date, as
soon as it is there. The folder is not part of the code or the backups. To
keep the files somewhere else, set `"downloads": "/some/folder"` in
`host.json`, restart the service, and add `--to /some/folder` to the two
`fetch_apps.py` commands above.

## Looking after it

- `systemctl status dartssam-host` and `journalctl -u dartssam-host -e` show
  whether it is running and what it last said.
- To remove someone's data yourself: they can do it in **Settings → Account →
  Delete my account**; that deletes their row in `host.db` and their folder
  under `accounts/`.

## Trying it on a laptop

```bash
pip install -r requirements-host.txt
cp host.example.json host.json       # set the client id, and "dev": true
python -m server.host                # http://localhost:8000
```

Google's button only works on addresses listed in the client's **Authorised
JavaScript origins**; add `http://localhost` and `http://localhost:8000`.

With `"dev": true` and no `"resend_key"`, a sign-in email is not sent but
printed in the terminal the host is running in, so signing in by email can be
tried with any address.
