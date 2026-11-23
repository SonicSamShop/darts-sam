# Being found on Google: design

2026-11-23. Agreed with Sam in conversation; the parts marked *(my call)* are
mine and his to overrule.

## Why

Sam wants Darts S.A.M to come up when someone searches Google for things like
"darts autoscorer", and to lead against DartCounter and Autodarts. The release
on both app stores before the Christmas 2026 darts competition is when the most
people will be looking.

Realistic aim: the two rivals have years of links from other sites, and links
count for more than anything on our own pages. So the first targets are the
searches where Darts S.A.M is the best answer and the rivals aren't: **free**
autoscoring, **open source**, **webcams you already own**, "autodarts
alternative". "Darts autoscorer" on its own comes later, as links build up.

## Goals

1. Search engines can find, read and index every public page at
   `dartssam.co.uk`, including the home page.
2. Each page appears at one address only (`dartssam.co.uk`), never twice.
3. The home page says plainly, in words people search for, what Darts S.A.M is:
   a free darts autoscorer that uses cameras, or tapping.
4. Two new pages for searches the rivals own: a comparison with Autodarts and
   DartCounter, and how camera autoscoring works and what you need for it.
5. A link shared on WhatsApp, Facebook or a forum shows a proper card: title,
   one line and a real screenshot.
6. A short list of the jobs only Sam can do (Search Console, store listings,
   posting where darts players talk), with the steps written out.

## Non-goals

- Paid search ads.
- A blog or a stream of articles. Two good pages now; more only if they work.
- Changing the app itself (`app.dartssam.co.uk`) beyond keeping it out of
  search results.
- Trimming the welcome page the app shows signed-out visitors. It stays as it is.

## Anti-goals (it fails if...)

- The pages read like keyword-stuffed or AI-written marketing. They stay plain
  documents in the README's voice (see the November "genuine, not AI" steer):
  no slogan headlines, no tables of ticks, no closing call-to-action slogans.
- Anything said about Autodarts or DartCounter is wrong, out of date or unfair.
  That would be bad for Sam's name and is a legal risk (UK comparative
  advertising has to be accurate and fair).
- Any hidden text or trick aimed at search engines. Google penalises this.
- Signing in, the app, the Android app link (`assetlinks.json`) or analytics
  consent break.
- Self-hosters get `dartssam.co.uk` written into their pages.

## How it works today

- `server/host.py` serves the whole of `web/` at both addresses through
  `WebFiles`, which can add text at the end of each page's `<head>` (it already
  adds the analytics counters, per visitor).
- `web/index.html` is an empty shell. The home page's words are drawn by
  JavaScript (`renderLanding` in `web/screens/landing.js`). Google can run
  JavaScript, but later and less reliably; Bing, link previews and most other
  crawlers see a blank page.
- The other pages (`faq`, `rules`, `download`, `releases`, `opensource`,
  `privacy`) are real HTML with their own title and description. Good.
- There is no `robots.txt`, no sitemap, no canonical address, no preview card
  and no structured data.
- The setting `"home"` holds the home page's address when it differs from the
  app's (`"site"`).

## Approaches considered

1. **Basics only**: robots, sitemap, canonical, preview cards, structured data.
   Quick and needed anyway, but nothing ranks us for "autoscorer".
2. **Basics plus pages written for those searches**: a home page in real HTML
   using the searched-for words, plus two new pages.
3. **Option 2 plus Sam's own off-site jobs**: Search Console, store listings and
   links from darts communities.

**Sam chose 3.** Links from other sites are what will eventually beat the rivals,
and the store listings are being written now anyway.

## The design

### 1. A real home page

- New `web/home.html`: the welcome content written out in HTML (heading, the
  real screenshots with captions, cameras, games, stats and TV, with or without
  cameras), in the same `.site` styles. Its buttons are plain links: "Sign in to
  play" goes to the app's address, "Download" to `download.html`.
- At the home address the server sends `home.html` for `/`. At the app address
  `/` is the app as now. With no separate home address (a laptop, a self-hoster
  with one address) nothing changes. *(my call: a separate static page rather
  than rendering the JavaScript page on the server. It's simpler and works with
  no JavaScript at all. The cost is two copies of the welcome wording, the page
  and `renderLanding`, until someone trims the app's copy.)*
- Wording: the title becomes something like "Darts S.A.M · free darts
  autoscorer with webcams" and the heading names what it is in those words.
  The words "autoscorer", "autoscoring", "free" and "webcam" each appear where a
  person would naturally say them, never piled up. **Sam approves the final
  wording.**

### 2. One address per page

- At the app address every response carries `X-Robots-Tag: noindex`, so its
  copies of the pages stay out of search results. *(my call: a header, not
  blocking in `robots.txt`. Blocked pages can still appear as bare links, and a
  crawler can't see a noindex on a page it isn't allowed to fetch.)*
- Every page gets `<link rel="canonical" href="<home>/<page>">`, added by the
  server alongside the counters, so the address comes from settings, not from
  the file. *(my call: injected, for self-hosters.)*
- `www.dartssam.co.uk` already redirects (Caddy). Check it is a permanent (301)
  redirect.

### 3. robots.txt and sitemap

- `/robots.txt`, served by the server: allow everything, plus a `Sitemap:` line
  at the home address. At the app address, allow everything (see section 2).
- `/sitemap.xml` at the home address: the home page and each public page,
  built from one list in `host.py`. The app address doesn't serve one.

### 4. Preview cards and structured data

- Each public page states its own `og:title`, `og:description` and
  `twitter:card` in the file. The server adds `og:url`, `og:image` and
  `og:type`, because these need full addresses.
- One shared picture, `web/shots/share.jpg` (1200×630, JPEG for the widest
  support), cut from a real screenshot. *(my call: the game screen,
  `shots/game.webp`.)*
- On the home page only, a JSON-LD `SoftwareApplication` block: name,
  description, price 0 (GBP), the platforms (web, Mac, Windows, Linux, and
  Android/iOS once they're out), the app's address and the screenshot. It's
  added by the server for the full addresses. This is what lets Google show
  "Free" next to the result.

### 5. The two new pages

Both are plain `.site` documents, linked from the home page and the site footer
(`FOOT_PLACES`) so crawlers and people can reach them.

- **`compare.html`: "Darts S.A.M, Autodarts and DartCounter".** In prose, for
  each: what it is, what you need to buy, what it costs, what it does well, and
  where Darts S.A.M differs (free, open source, ordinary webcams, the TV view,
  no adverts). It's fair about where the rivals
  are ahead (Autodarts's accuracy and community, DartCounter's online play and
  size). Every claim about them is checked against their own sites when the page
  is written, links to its source, and the page shows "Checked on <date>". It
  says the names are their owners' trademarks. No ticks or scorecard. **Sam
  reads and approves it before it goes live.**
- **`autoscoring.html`: "How camera autoscoring works, and what you need".**
  How the webcams find a dart and where it landed, in the README's plain terms.
  What to buy (two or three USB webcams, mounts, a computer near the board, with
  rough costs), how to set it up, and what to expect from accuracy. It links to
  `download.html` and the FAQ.

### 6. Sam's own jobs: `docs/search.md`

Steps written for Sam to follow, each one short:

- Google Search Console: add `dartssam.co.uk` as a domain property, verify it
  with a TXT record at Cloudflare, submit the sitemap, and ask for the home page
  to be indexed. The same for Bing Webmaster Tools, which can import from
  Google.
- Store listings: the words to use in the Play and App Store title, short
  description and keywords, matching the site.
- Links: the GitHub repo's description, website and topics; a launch post on
  r/Darts and darts forums (written honestly as the person who made it); asking
  darts YouTubers and club sites. Draft text Sam can change.
- What to look at after 2 to 4 weeks in Search Console (which searches show the
  site, and where it sits), and what to do if nothing has happened.

### Checks

- Tests in `tests/test_host.py`:
  - `robots.txt` at both addresses
  - the sitemap lists the pages at the home address, and the app address has none
  - the noindex header at the app address only
  - the canonical and `og:` lines are added with the configured home address
  - `/` at the home address sends `home.html`
  - with one address, everything behaves as before
- By hand:
  - `home.html` in all five themes and at phone width
  - the page read with JavaScript off
  - Google's Rich Results Test and a share-preview checker, once deployed

## Constraints

- Other sessions commit to `main` in this folder at the same time, and there are
  uncommitted changes in `server/host.py`, `tests/test_host.py`, `web/faq.html`
  and `web/privacy.html` right now. Commit from a private index. Don't sweep
  those changes up.
- Deployment is Sam's: the server pulls from the public repo.
- Before Christmas, so keep to what's above.

## Left to the builder

- The exact page list in the sitemap, and its `lastmod` (the file's date is fine).
- How `home.html` shares styles and screenshots with `renderLanding`, as long as
  it looks the same.
- The exact wording of both new pages and the home page, for Sam to approve.
- A release-notes line, only if something here is player-facing.
