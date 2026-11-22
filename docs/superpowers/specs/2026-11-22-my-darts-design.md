# My darts: design

2026-11-22. Status: approved by Sam, 2026-11-22 ("Yes, perfect"), including the trial event and the thresholds; build now, compare included.

## Why

Players change darts and rarely know whether it helped. The app already knows
which set each game was thrown with, so it can tell them. That is useful on its
own, with nothing to sell.

It also comes up because Sam wondered (2026-11-22) about working with dart
brands later: "you play well with this weight and barrel, try these". We agreed
**not to do that until there is evidence** that players record more than one set
and that the figures show real differences between sets. This round builds the
honest feature. It also shows, from the trial, whether that evidence turns up
(see "How we will know", below).

## What is there already

Built and working (`server/db.py` `dart_sets`, `web/sync.js`, `web/screens/playerspanel.js`,
`web/screens/home.js`, `web/screens/stats.js`):

- A player has **sets of darts**: a name and, if given, a weight in grams.
- On Play, a player with more than one set picks which one they're throwing
  (`match_players.darts`).
- A set can be **put away**: it leaves Play, and its stats are kept.
- Stats has a **Darts** table: darts thrown, games, won, first and last used.
  Tapping a set, or the Darts picker, limits every stat to that set.
- It syncs like everything else: the Pi at home, the hosted account, offline.

What is missing:

1. Anything about the darts beyond name and weight.
2. A way to **compare** sets side by side. Today you pick one set, look, pick the
   other, look again.
3. Any warning that a small number of darts proves nothing.

## What this round adds

### 1. Details of a set (all optional)

In the player's card, under the name and grams, a **More details** line opens
these fields:

| Field         | Kind                                                   |
|---------------|--------------------------------------------------------|
| Brand         | free text ("Target", "Winmau", "Unicorn"...)           |
| Tungsten      | 80 / 85 / 90 / 95 / 97 %, or not known                 |
| Barrel shape  | straight / torpedo / bomb / scalloped / other          |
| Grip          | smooth / light / medium / heavy                        |
| Shaft         | short / in-between / medium / long                     |
| Flight        | standard / slim / kite / pear / small / other          |
| Notes         | free text, one line ("new points March", "Phil's spares") |

The name stays the player's own label for the set. Nothing is required. A set
with no details works exactly as it does now. Brand is free text: no list of
models, no logos. A list would need upkeep and would look like an endorsement.

The Play chips stay as they are (name and grams). The card shows a short line
under the name: "Target · 95% · straight · medium grip".

### 2. Sets side by side

The Darts table on Stats gets performance columns next to the use columns:

| Darts         | Darts thrown | Games | 3-dart average (X01) | Checkout rate | Trebles hit |
|---------------|--------------|-------|----------------------|---------------|-------------|
| Red 23g       | 4,210        | 61    | 48.3                 | 11.2%         | 6.1%        |
| Blue 21g      | 380          | 6     | *not enough yet*     | *not enough yet* | *not enough yet* |

- **3-dart average** and **checkout rate** come from X01 games, worked out by the
  same code as the X01 tiles (`web/stats.js`). **Trebles hit** is trebles per
  dart, from every game that has single darts (not typed visits).
- With a game picked at the top, the columns are for that game only, as now.

### 3. "Not enough yet"

A figure is shown only once a set has enough behind it:

- 3-dart average: at least 300 X01 darts (about 100 visits).
- Checkout rate: at least 50 darts at a double.
- Trebles hit: at least 300 single darts.

Below that the cell says *not yet* ("not enough yet" wrapped onto three lines on a phone), and the note under the table says how
many more darts it needs ("Blue 21g: about 220 more X01 darts"). The table never
names a winner or says one set is "better". It shows the figures and lets the
player judge. Darts form changes week to week, so a crowned "best set" would
often be wrong.

(The thresholds are a first guess. They can be changed later in one place.)

## How it is built

- **Storage.** One new column, `dart_sets.details TEXT` (JSON, NULL when empty),
  holding the fields above. It is JSON rather than a column per field because
  nothing queries the fields and more may come. The column is added on start-up
  the same way older databases are brought up to date now (see the change made
  in `6b889d5` for account databases), on the Pi, the desktop and every hosted
  account.
- **Checking.** `save_darts` (Python) and `checkDarts` (`web/sync.js`) accept only
  the known keys and values, cap free text (brand 40 characters, notes 120), and
  drop empty fields. Both sides check the same things, as they do for grams.
- **Sync.** The darts record gains `details`. `DartsIn` in `data_api.py` gains the
  field. Older apps that don't know it ignore it. A newer app saving through an
  older server loses the details, which is acceptable (they are optional).
- **Comparison.** One stats call, not one per set. `_history` puts each match's
  set id on the match it returns. The Stats screen groups X01 matches by set
  and runs the existing X01 sums on each group. Trebles per set come from
  `_gear`, which already groups by set (one more `SUM` in its throws query).
- **Tests.** `tests/test_db.py`: details saved, checked, rejected when wrong,
  kept through an update, column added to an old database. `tests/sync.test.mjs`:
  the same checks on the app side, and details survive offline then sync.
  A test for the "not enough yet" thresholds and the per-set grouping.
- **Release notes.** One line in `release.json` "unreleased": "Darts can now have
  their details recorded, and the Stats page compares your sets side by side."

## How we will know

The trial already records how the app is used (`events` on the hosted site).
Add one event, sent at most once a week per account, holding **counts only**:
how many players have two or more sets, and how many of those sets have passed
the "not enough yet" line. No brands, weights or details leave the account.

*As built (2026-11-22):* no event. Each hosted account's games are already in
its own database on the site, which the trial's admin page reads
(`server/insight.py`). So it counts there instead: `sets`, and `comparing`
(players with two or more sets that each have 300 single darts). Nothing new is
sent from the app and nothing new is stored, so the privacy page did not need to
change. The admin page shows a "Sets of darts" column and a "Players with 2+ sets
to compare" tile.

If, after the Christmas comp, few players have two sets with enough darts, the
idea of dart recommendations stops there. If many do, then decide whether
recommendations are worth doing and whether "no ads" covers clearly marked ones.

## Non-goals (this round)

- Recommending darts, links to shops, brand partners, affiliate codes.
- A catalogue of dart models, pictures of darts, brand logos.
- Comparing your sets with other players'.
- Details per individual dart, or changing details part-way through a game.
- Telling a player which set is best.

## Anti-goals

- Nothing on the page that reads as an advert, now or "for later".
- Passing anything about a player's darts to anyone outside their account.

## Open questions for Sam

1. Are the fields right? Anything a club player would expect that is missing
   (point type, barrel length, weight of the whole dart compared with the barrel only)?
2. Is the trial event acceptable? It is counts only, but it is new. If yes, the
   privacy page gets a sentence about it.
3. The thresholds (300 darts / 50 at a double): fine as a start?
4. Before or after the Christmas release? Suggest after: it's not needed for the
   comp, and the store builds should not change late.
