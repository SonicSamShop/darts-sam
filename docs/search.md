# Being found on Google

The site does its part by itself (`server/seo.py`, and "Search engines" in
[hosting.md](hosting.md)): a sitemap, one address per page, preview cards, and
pages worded for what people search. What decides where it comes in a search,
though, is mostly outside the site: Google knowing about it, and other sites
linking to it. These are the jobs for that, in order. Each one is done once
unless it says otherwise.

What to aim for first: searches where Darts S.A.M is the best answer, like
"free darts autoscorer", "darts autoscoring webcam", "open source darts
scorer" and "autodarts alternative". Plain "darts autoscorer" comes later, as
links build up.

## 1. Google Search Console (15 minutes)

1. Go to <https://search.google.com/search-console> and sign in with the
   Google account you want to own it.
2. **Add property → Domain**, type `dartssam.co.uk`, then **Continue**.
3. Google shows a TXT record (`google-site-verification=...`). In Cloudflare:
   **dartssam.co.uk → DNS → Records → Add record**, Type **TXT**, Name `@`,
   Content the whole line Google gave, then **Save**.
4. Back in Search Console press **Verify**. If it says not yet, wait ten
   minutes and press it again.
5. **Sitemaps** (left menu): type `sitemap.xml` and press **Submit**.
6. **URL inspection** (search box at the top): paste
   `https://dartssam.co.uk/`, then **Request indexing**. Do the same for
   `https://dartssam.co.uk/compare.html` and
   `https://dartssam.co.uk/autoscoring.html`.

## 2. Bing Webmaster Tools (5 minutes)

Bing also answers for DuckDuckGo, Ecosia and Yahoo. Go to
<https://www.bing.com/webmasters>, sign in, choose **Import from Google Search
Console**, and tick `dartssam.co.uk`.

## 3. Check what the pages say about themselves (5 minutes)

- <https://search.google.com/test/rich-results>: paste
  `https://dartssam.co.uk/`. It should find the **Software App** description.
  A warning that it isn't eligible for a rich result, for want of
  `aggregateRating` or `review`, is expected: Google shows that kind of result
  ("Free", stars) only for apps with ratings, and the site has none to give.
  Never add made-up ones. Once the store listings have real ratings, Google
  can show those instead.
- Paste `https://dartssam.co.uk/` into a WhatsApp chat to yourself. It should
  show the game picture, the title and the one-line description. (Facebook's
  <https://developers.facebook.com/tools/debug/> shows the same, and refreshes
  its copy after a change.)

## 4. The store listings

Use the same words in the Play and App Store listings as on the site, so they
back each other up.

- **Name:** `Darts S.A.M: Darts Autoscorer` (Play allows 30 characters; this
  is 29).
- **Play short description** (80 characters at most): `Free darts scorer
  that scores by itself with webcams, or tap the board. No ads.`
- **App Store subtitle** (30 at most): `Free darts autoscorer`.
- **App Store keywords** (100 characters, commas, no spaces):
  `darts,scorer,autoscore,dartboard,501,cricket,checkout,webcam,camera,counter,stats,practice,free`
- **The long description:** start with the home page's first paragraph. Then
  list the games, the stats and the TV view, and say it is free and open
  source.

## 5. GitHub (2 minutes)

On <https://github.com/SonicSamShop/darts-sam>, press the cog next to **About**:

- **Description:** `Free, open-source darts autoscorer: webcams score every
  dart, or tap the board. Stats, TV view, 14 games.`
- **Website:** `https://dartssam.co.uk`
- **Topics:** `darts`, `dartboard`, `autoscoring`, `darts-scorer`,
  `computer-vision`, `opencv`, `fastapi`, `pwa`

## 6. Links from where darts players are

This is what will move it up for the bigger searches. Post as yourself, as the
person who made it. Say what it does and what it doesn't do yet, and ask for
problems to be reported. Darts communities are friendly to that, and quick to
spot a sales pitch.

- **r/Darts** (Reddit): a post with a short screen recording of a game being
  scored. Draft below.
- **Forums and groups:** Facebook darts groups you're in, your league's
  group or website, and darts forums such as Dartsnutz.
- **The Christmas competition:** a QR code to `dartssam.co.uk` on the
  scoreboard screen or a printed card by the oche.
- **Darts YouTubers** who review scoring setups: a short, friendly email with
  a link and the comparison page.
- **Open-source lists:** a "Show HN" post on Hacker News, and lists such as
  "awesome-selfhosted", once the Windows app has been tried on a real PC.

Draft for r/Darts (change it to sound like you):

> **I made a free darts autoscorer that works with cheap webcams**
>
> I've been building this for my own board: two or three USB webcams round the
> board, and it works out where each dart landed, calls the score and keeps
> stats. No cameras, you can tap the board on your phone instead. It's free,
> no ads, and the code is all on GitHub.
>
> It's not perfect yet: wires and shadows fool it now and then, and I'd love
> to hear where it goes wrong on your board. dartssam.co.uk

## 7. Two to four weeks later

In Search Console:

- **Pages:** the home page, `compare.html` and `autoscoring.html` should say
  **Indexed**. If the home page says "Discovered, currently not indexed",
  request indexing again and give it another week.
- **Performance → Search results → Queries:** the searches the site showed up
  for, with how often and in what position. If "autoscorer" searches show up at
  position 20 to 50, that is the start: more links (step 6) are what move them
  up.

Do steps 6 and 7 again every month or so.
