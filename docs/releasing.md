# Releasing a new version

The desktop app's version, and what changed in each one, are in
`release.json`. As changes go in, a line for each one a player would notice
goes in `"unreleased"`. To release, say 1.1: set `"version"` to `"1.1"`, move
the `"unreleased"` lines into `"notes"` under `"1.1"`, empty `"unreleased"`, and
push to `main`. GitHub builds the apps (named with the version, such as
`DartsSAM-windows-1.1`), the server puts them on the download page
(`tools/fetch_apps.py`), and each desktop app that starts after that offers the
new version with its notes, and downloads it if asked (`server/release.py`).

Pushes that don't change the version build no apps. (Every pull request and
every push to `main` still runs the tests: `.github/workflows/tests.yml`.) To
check that the apps still build without releasing, start a build by hand: **Actions → Mac /
Windows / Linux → Run workflow**. The server ignores it because its version
isn't new. GitHub keeps each build for 14 days.

Putting the builds on a site's download page is in
[hosting.md](hosting.md#the-apps-to-download).

## Signed updates

The apps only install an update that GitHub signed when it built it, so a site
that was broken into can't push anything else to them. Set this up once:

1. `pip install cryptography`, then `python tools/sign_release.py new-key`.
2. It writes the public key to `release-key.pub`: commit it. Every build carries it.
3. It prints the private key once. In GitHub open **Settings → Secrets and
   variables → Actions → New repository secret**, name it `RELEASE_SIGNING_KEY`
   and paste the key in. Keep it nowhere else; anyone who has it can sign updates.

Each build is then signed (`*.sig` next to the app in its GitHub build), the
server passes the signature on, and the app checks it before opening the file.
A build with no signature is put on the download page as usual, but the apps
don't offer it as an update.

**If you fork this:** the `release-key.pub` in the repository is the official
app's, and the site the apps ask is the official one. Until you change both,
an app you build asks that site and is offered the official app as its update.
Your own builds can't be signed with the official key's private half, so:
delete `release-key.pub` and make a key of your own (step 1; `new-key` refuses
while the old file is there), and point the apps at your own site
(`DEFAULT_HOST` in `server/link.py`). With no `release-key.pub` at all, an app
offers no updates.

To try the offer without building: run the site, then the app on another port
with `DARTSSAM_UPDATES=1 python -m server.app --port 8001 --host http://127.0.0.1:8000`.
In the site's `downloads` folder put any file under your computer's download
name, and a `releases.json` saying it is a newer version, such as:

```json
{"DartsSAM-arm64.dmg": {"version": "9.9", "notes": {"9.9": ["Trying the offer."]}, "sha256": "00", "signature": "00"}}
```

The app then offers it. **Update** itself only goes through for a build that
was really signed.
