# Security

## Reporting a problem

Please don't open a public issue for a security problem. Report it privately,
either way:

- On GitHub: the repository's **Security** tab → **Report a vulnerability**.
- By email: sonicsamshop@gmail.com

Say what you found, how to make it happen, and what someone could do with it.
A proof of concept helps; please don't try it against other people's accounts
or data on dartssam.co.uk.

This is a one-person project, so a reply can take a few days. You will be told
when it is fixed, and credited in the fix if you would like to be.

## What is covered

- **The hosted site** (`server/host.py`, dartssam.co.uk): sign-in, sessions,
  one account reaching another's data, the admin pages, uploads.
- **The desktop apps and their updates** (`server/release.py`,
  `tools/sign_release.py`): anything that gets an app to install a file that
  wasn't signed as a genuine build.
- **The server at home** (`server/app.py`): a page on another website reaching
  it through its owner's browser (`server/guard.py`), or anything reaching it
  from outside the home network.
- **The line between a home server and the site** (`server/link.py`,
  `server/relay.py`): one person's cameras, darts or reports reaching another
  account.

The fix goes into `main` and the next release of the desktop apps. Older
versions are not patched: the apps offer the newest one when they start.

## What is by design

- The server at home has **no sign-in**. Anyone on the same home network can
  use it, as they can the board. It only answers to the names a home network
  uses, and should not be put on the internet.
- The desktop apps are **not signed by Apple or Microsoft**, so each system
  warns the first time one is opened. Their updates are signed by the project
  itself (see [docs/releasing.md](docs/releasing.md#signed-updates)).
