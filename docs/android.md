# The Android app (Google Play)

The Android app is the hosted site, `https://app.dartssam.co.uk`, in a window of
its own. Google calls this a **Trusted Web Activity**: a small Android app
that opens the site in Chrome, full screen, with no address bar. Nothing in
the app has its own code. When the site is updated, the Android app has the
update at once, so a new version on Google Play is only needed to change the
app's name, icon or colours.

Chrome shows the site without an address bar only when the site says the app
is its own. It does that at `/.well-known/assetlinks.json`, which the host
serves from the `"android"` setting (step 3). Without it the app still works,
with a bar along the top.

Package name: **`uk.co.dartssam.app`**. It can never be changed once the app
is on Google Play.

## 1. Make the app package

The simplest way is PWABuilder, a free Microsoft website that runs Google's own
tool (Bubblewrap) for you.

1. Open [pwabuilder.com](https://www.pwabuilder.com), type
   `https://app.dartssam.co.uk` and press **Start**.
2. Press **Package for stores**, then **Generate Package** under **Android**.
3. Under **All settings**, fill in:

   | Setting | Value |
   |---|---|
   | Package ID | `uk.co.dartssam.app` |
   | App name | `Darts S.A.M` |
   | Launcher name | `Darts S.A.M` |
   | App version | `1.0.0` |
   | App version code | `1` |
   | Host | `app.dartssam.co.uk` |
   | Start URL | `/` |
   | Theme colour, Background colour | `#2b1b11` (both, from the site) |
   | Display mode | Standalone |
   | Notifications | off |
   | Location delegation | off |
   | Google Play billing | off |
   | Fallback behaviour | Custom Tabs |
   | Signing key | **Create new** (fill in your name; organisation can be your name too) |

4. Press **Download**. The zip has:
   - `Darts S.A.M.aab`: the file you upload to Google Play.
   - `Darts S.A.M.apk`: the same app to install on your own phone to try first.
   - `signing.keystore` and `signing-key-info.txt`: the key and its passwords.
   - `assetlinks.json`: the key's fingerprint, for step 3.

**Keep `signing.keystore` and `signing-key-info.txt` safe**: put them in your
password manager or a private backup, not in this repo and not anywhere public.
Every new version has to be signed with this key. (Because Google Play keeps
its own key too, a lost key can be replaced by asking Google, but that takes
days.)

If you'd rather build on this Mac: `npm i -g @bubblewrap/cli`, then
`bubblewrap init --manifest https://app.dartssam.co.uk/manifest.json` in an
empty folder outside the repo (it offers to download the Java and Android
tools it needs; answer with the values in the table), then `bubblewrap build`.

## 2. Try it on your phone

Before uploading, copy the `.apk` to an Android phone and open it (Android asks
you to allow installing from that app once). Check:

- It opens full screen on the sign-in page.
- **Signing in with Google works**, and with email.
- A game plays, and the phone camera (Beta) asks for the camera and scores.

Until step 3 is done, a bar with the site's address shows along the top. That
is expected.

## 3. Tell the site about the app

Google signs the app with its own key when it puts it on Google Play, so the
site has to name two fingerprints: your key's and Google's.

1. Yours is in the zip's `assetlinks.json`, after `"sha256_cert_fingerprints"`:
   32 pairs like `AB:CD:EF:...`.
2. Google's is in Play Console once the first `.aab` is uploaded:
   **Test and release → Setup → App signing**, "App signing key certificate",
   **SHA-256 certificate fingerprint**.
3. On the server, in `/etc/dartssam/host.json`, add:

   ```json
   "android": {"package": "uk.co.dartssam.app",
               "fingerprints": ["AB:CD:...your key...", "12:34:...Google's key..."]},
   ```

   and restart the site: `systemctl restart dartssam-host`. (The site won't
   start if a fingerprint is mistyped: `journalctl -u dartssam-host -n 20` says
   which.)
4. Check from anywhere:
   `curl -s https://app.dartssam.co.uk/.well-known/assetlinks.json`
   shows both fingerprints.

Close the app on the phone and open it again: the address bar is gone.

## 4. Google Play Console

Once the account is verified, **Create app**: name `Darts S.A.M`, language
English (United Kingdom), **App**, **Free**. Then the **Set up your app** list
on the dashboard, with these answers.

### Privacy policy
`https://app.dartssam.co.uk/privacy.html`

### App access
"All or some functionality is restricted". Instructions:

> Sign in is needed. Use "Continue with Google" with any Google account, or
> "Continue with email" with any email address (a code is emailed to it).
> The account is made the first time you sign in. To try a game without a
> dartboard, press Start, then tap the board where a dart landed.

### Ads
No.

### Content rating
Category: **Utility, Productivity, Communication or Other**. No to everything
(no violence, no gambling or simulated gambling, no user-to-user chat, no
sharing location, no purchases). Expect **PEGI 3 / Everyone**.

### Target audience
Ages **13–15, 16–17 and 18 and over**. Not under 13 (the privacy page says so;
choosing under 13 brings in Google's Families rules).

### Data safety
- Does the app collect or share user data? **Yes.**
- Is all data encrypted in transit? **Yes.**
- Can people ask for their data to be deleted? **Yes.**
  Deletion URL: `https://app.dartssam.co.uk/privacy.html#delete`
- Data shared with third parties: **none** (Google Cloud, Google Analytics and
  the email service act for Darts S.A.M, which Google counts as not sharing).

Collected (none of it is sold, none is used for adverts):

| Data type | Required or optional | Why |
|---|---|---|
| Personal info → **Name** (first name from Google or Apple) | Required | App functionality, Account management |
| Personal info → **Email address** (email sign-in only; kept scrambled) | Optional | Account management |
| Personal info → **User IDs** (Google's or Apple's number for the account) | Required | Account management |
| Photos and videos → **Photos** (board pictures in problem reports, and with achievements if allowed) | Optional | App functionality, Analytics |
| App activity → **App interactions** (which screens are used, if Google Analytics is allowed) | Optional | Analytics |
| App activity → **Other user-generated content** (players, games, scores, feedback, report notes) | Required | App functionality |
| Location → **Approximate location** (country or region, from visit counting) | Optional | Analytics |
| Device or other IDs (Google Analytics' cookie, if allowed) | Optional | Analytics |

The camera's video is worked on on the phone and is not collected; only the
pictures above leave it.

### Government apps, financial features, health
No to each.

### Store listing

**App name:** Darts S.A.M

**Short description** (80 characters at most):

> Free darts scorer and stats. Tap the board, or let a camera count the darts.

**Full description:**

> Darts S.A.M (Scoring Assisted Marker) keeps score for your darts so nobody
> has to do sums at the oche.
>
> • Tap the board where each dart landed, or type each visit's score.
> • A caller reads out every score in the device's own voice.
> • 501 and 301, Cricket, Killer, Shanghai, Around the Clock, and practice
>   games like Bob's 27 and 121 Checkout, with a computer opponent at 15
>   levels.
> • Stats for every player: 3-dart and first-9 averages, doubles, trebles,
>   a heat map of where your darts land, and achievements.
> • The same games and stats on every phone, tablet and TV you sign in on.
> • Camera scoring: point your phone's camera at the board and it scores the
>   darts by itself (Beta). Or connect USB cameras to a computer by the board
>   with the free desktop app.
>
> Free, with no adverts and nothing to buy. Darts S.A.M is open source:
> github.com/SonicSamShop/darts-sam

**App icon:** `web/icon-512.png`
**Feature graphic:** `docs/play/feature-graphic.png` (1024×500)
**Phone screenshots:** `docs/play/phone-*.jpg` (1080×2160), in their number
order. Retake them if the screens change (see the screenshots recipe used for
`web/shots`).

**Category:** Sports. **Contact email:** sonicsamshop@gmail.com. **Website:**
`https://dartssam.co.uk`.

## 5. Closed test, then production

A personal developer account has to run a closed test before it may publish:
**at least 12 testers, opted in for 14 days in a row**.

1. **Test and release → Testing → Closed testing → Create track.** Upload the
   `.aab`, and add the testers' Google account email addresses (an email
   list).
2. Copy the **opt-in link** and send it to the testers. Each one opens it,
   presses "Become a tester", then installs from Google Play. They must stay
   opted in for the 14 days; using it now and then helps.
3. Do step 3 above (Google's fingerprint) straight after the first upload.
4. Keep notes as the test goes: what testers said and what you changed.
   **Apply for production** (on the dashboard, after the 14 days) asks for
   exactly that.
5. Once production access is granted: **Production → Create new release**,
   the same `.aab`, roll out. Review usually takes from one day to a week.

## A new version of the Android app

Only needed to change the name, icon, colours or package settings. Build again
with the **same signing key** (PWABuilder: Signing key → Use mine, with the
`.keystore` and passwords), version code one higher (`2`, `3`, ...), and upload
it as a new release.
