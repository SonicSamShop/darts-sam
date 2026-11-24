# Tournament: design

2026-11-24. Status: approved by Sam 2026-11-24.

## Why

The PDC World Championship is on TV from mid-December to early January. It is
when people pick darts up at home, and when the app goes into the stores. A
household watching it will want to play "our own Worlds": a knockout between
the people in the room (and a bot or two), on the one board and the one screen
they have. DartCounter users ask for tournaments; Darts S.A.M has nothing for
it today, only single matches.

Sam's words (2026-11-24): "friends and family at home, one board, one screen."
On people being knocked out: "if theyre knocked out and its between 2 bots, it
can be sim'd" — a straight knockout is fine.

What success looks like: on Christmas evening someone sets up a tournament in
about a minute, the app calls up each match in turn, and at the end there is a
winner and a bracket to look back at next year.

## What is there already

- **Matches** (`web/engine.js`, `web/games/x01.js`): X01 with start score
  (301/501/701), double or straight out, legs to win and sets to win. A match is
  `{gameId, players, opts, log, started}`; `compute()` replays the log and gives
  `winner` (a seat index).
- **Starting a match** (`web/screens/start.js`): "Who throws first?" (closest to
  bull or random), then `startMatch(act, order)`. The game screen
  (`web/screens/game.js`) shows Menu / Play again when the match is won.
- **Bots** (`web/bot.js`): 15 levels; a bot seat is a player record with `bot`
  set to its level (`botPlayer(level)` in `web/app.js`). `x01.bot(state, skill,
  random)` picks the bed and `throwAt()` lands the dart, so a whole match can be
  played by bots with no screen at all.
- **Saved data** (`web/sync.js`, `server/db.py`, `server/data_api.py`): offline
  first. Matches go up as full copies with a `seq` (stale saves ignored).
  Boards (2026-11-22) are the latest example of a household record with its own
  table, its own "to send" queue and its own `/api/boards` addresses; the hosted
  site keeps each account's data in its own database file, so a new table goes
  there too.

## Approaches considered

- **A. Its own saved record (picked by Sam).** A `tournaments` table and
  `/api/tournaments` addresses, a "to send" queue in `sync.js` like boards and
  matches. Each match in it is an ordinary saved game. Follows the account to
  every device; finished tournaments are kept. The most work: server, sync and
  the hosted database.
- **B. Kept in a setting.** The current tournament in one synced setting. No
  server change, quickest. Rejected: one at a time, history stuffed into a
  setting, and two screens saving at once lose one of the changes.
- **C. On this device only** (browser storage). Rejected: lost when moving from
  the TV to a phone, no history, against the app's "it follows you" promise.

## Goals

1. **Set up in about a minute:** a name, the players (people and bots), the game
   (X01: start score, out), and how long the matches are, round by round.
2. **Any number from 3 to 16.** The bracket is the next power of two; the gaps
   are byes.
3. **The app runs the evening:** it shows the bracket, says which match is next,
   starts it, reads the winner when it is won, and moves them on.
4. **Bot against bot is played out at once** ("simulated"), with a believable
   score, and shown as such.
5. **Nothing is lost** to a refresh, the tablet sleeping, or moving to another
   screen signed in to the same account.
6. **An ending:** a winner, and finished tournaments listed for looking back.
7. **Every match counts in the stats** as the same match played on its own would.

## Non-goals

- Formats other than a straight knockout: no groups, round robin, double
  elimination, third-place play-off.
- Games other than X01.
- More than one board, or two matches at once.
- Playing against people somewhere else.
- Pairs, teams or handicaps (a starting score per player). Bots at a chosen
  level are the way to even things up for now.
- Seeding by average. The draw is at random.
- Any PDC or World Championship name or look. It is "Tournament".

## Anti-goals

- A tournament that gets stuck: a match quit half way, a player removed, a sync
  clash, must never leave it unable to go on.
- Tournament matches behaving differently from ordinary ones (scoring, calling,
  cameras, stats). A tournament only decides who plays whom, and how long for.
- A busy, decorated bracket. It follows [[ui-genuine-not-ai]]: the plain lines
  of a printed draw sheet in the theme's own lettering, no trophies or confetti.
  The one movement is the winner moving on (below).

## The design

### Where it is

The home screen gets **Tournament** beside the games (a line of its own under
the game list, not a game in the list, since it is not one). With a tournament
going, the home screen's "In progress" part also shows **Back to the
tournament: <name>, <what's next>**.

The Tournament screen has two states: **setting one up** and **one going**
(the bracket). Below either, **Past tournaments**: one line each, name, date,
winner; tapping one shows its finished bracket.

### Setting one up

```
New tournament
  Name        [ Christmas 2026         ]
  Players     Sam  Phil  Mum  Jake  [Bot 5] [Bot 9]  + New
              6 players: 2 byes in round 1
  Game        501 · double out                 [change]
  Matches     Round 1      first to 2 legs     [-][+]
              Semi-finals  first to 2 legs     [-][+]
              Final        first to 3 legs     [-][+]
  [ Draw ]
```

- **Players** are picked like the home screen's chips. Bots need a new picker:
  the home screen has only one computer seat (`BOT`, id 0, at `setup.bot`'s
  level), and a tournament can have several at different levels. Here "+ Bot"
  adds a chip at a level (with the same − / + as the home screen), and each is
  the player record `botPlayer(level)` gives, so two bots at the same level are
  the same player: the second "+ Bot" starts at the next free level.
- **Game**: X01's own options (start, out), using its option list from
  `x01.js`.
- **Matches**: one "first to N legs" per round, named by distance from the final
  (Final, Semi-finals, Quarter-finals, Round 1 / Round 2 before that). Defaults:
  first to 2 legs, first to 3 in the final. **Sets** are left out to keep setup
  short; (my call) a round's length is legs only. The x01 `sets` option stays at
  1.
- **Draw** makes the bracket at random and shows it, with **Redraw** and
  **Start** under it. Nothing is saved until Start.

### The draw and byes

Bracket size is the next power of two at or above the number of players
(3–4 → 4, 5–8 → 8, 9–16 → 16). Players are shuffled; byes are given out so that
no first-round match is bye against bye and they are spread across both halves
(the standard placement: byes go against the top of the shuffled order in
bracket-seed positions). A player with a bye goes through to round 2 with no
match played, shown as "bye".

### One going: the bracket

Sam asked (2026-11-24) for it to look like the printed draw sheet you pin up
at a darts night: rounds as columns left to right, a box per player, square
bracket lines joining each pair to the box they play for in the next round,
and a **Winner** box at the end. Column headings name the rounds (Last 16,
Quarter-finals, Semi-finals, Final, Winner).

```
Christmas 2026 · 501 · double out

Round 1        Semi-finals      Final          Winner
 first to 2     first to 2       first to 3
┌────────┐
│Sam    2│─┐
└────────┘ │ ┌────────┐
┌────────┐ ├─│Sam     │─┐
│Jake   1│─┘ └────────┘ │
└────────┘              │ ┌────────┐
┌────────┐              ├─│        │─┐
│Mum     │─┐ ┌────────┐ │ └────────┘ │
└────────┘ ├─│Mum     │─┘            │  ┌────────┐
   bye    ─┘ └────────┘              ├──│        │
┌────────┐                           │  └────────┘
│Bot 5  2│─┐  simulated              │
...

[ Play Phil v Dad ]                          [Abandon tournament]
```

- Drawn as one inline SVG (or positioned boxes with SVG lines), in the theme's
  own colours and lettering, so it reads in every theme and in dark mode. Box
  height and gap halve-and-centre per round as on the sheet, so every box sits
  midway between the two that feed it.
- Each box shows the name and, once played, the legs won; the loser's box is
  dimmed, the winner's line into the next round is drawn in the theme's accent.
  A bye is an empty, dashed box marked "bye". The next match to play is marked.
- **It fills the screen it is on.** The bracket sizes itself to the space it
  has (its own scaling, not `fit()`, which only shrinks an overflowing view and
  stops at 40%), so on the TV a 16-player draw uses the whole height: about
  67 px a player at 1080 lines, readable from the sofa. Its lettering never goes
  below the theme's small size; where that would happen (a phone with 9–16
  players) the bracket scrolls inside its own area instead (the page itself
  never scrolls sideways) and opens scrolled to the round being played. (My
  call.)

**The animation.** When a result comes in (on returning from a won match, after
a walkover, or when bots are simulated), the bracket is shown as it was, then
the winner's name travels out of their box, along the bracket line, round the
corner and into their box in the next round, which then fills in; the loser's
box dims as it goes. About 0.8 s, eased. Several results at once (two
simulated matches) play one after another, in bracket order. The final's winner
goes into the Winner box, then the winner's screen comes up. It is skipped for
anyone with reduced motion set (`prefers-reduced-motion`), and a tap skips it.
Only results not yet seen on this screen are animated (kept per device, so
opening the bracket again doesn't replay them).
- **Next match** is the first unplayed match in bracket order, round by round.
  The main button plays it. Any other ready match (both players known) can be
  tapped to play it instead.
- Each played match shows the legs won by each player and opens to its
  scorecard, as a game in history does.

### Playing a match

**Play** goes through the usual "Who throws first?" (closest to bull or random,
the last answer lit) and then starts the match with the two players and the
round's options. Today `askFirst`, `openBull`, `randomOrder` and `startMatch`
(`web/screens/start.js`) read the game, players and options from the home
screen's `setup` (`seats()`, `setup.gameId`, `startOpts()`). They change to take
the players, game and options as arguments, with the home screen passing its
own; the tournament must not touch `setup`. The bull screen throws for a
computer only when the next seat is `BOT` (id 0); it changes to throw for any
seat whose player is a bot (a real id from `botPlayer`), or "closest to bull"
would wait for ever on a tournament bot. The match carries `tournament: {id, slot}` (in the match record, see
Saving) so the app knows where its result goes.

When it is won, the game screen shows **Back to the tournament** in place of
Play again (Menu stays). The result is taken when the match is won, not when
the button is pressed, so going to the menu or closing the app doesn't lose it.
Undoing the winning dart (Undo stays on the won screen) takes the result back
while still on that match's screen. **Leaving it fixes the result** (my call:
the simplest rule that never needs a saved match deleted). Bot-against-bot
matches the result makes ready are played out only then, so they never need
undoing.

The final's winner gets a **winner's screen**: their name, "wins Christmas
2026", the final's score, and the bracket below. Score calling says it.

**Quitting a tournament match** (Quit game) leaves the match unplayed; the
bracket offers it again. The quit game is kept or not as the quit question
already decides.

### Bot against bot

When both players in a ready match are bots, it is played out straight away,
dart by dart, with the bots' own `x01.bot()` and `throwAt()`, and saved as an
ordinary match, marked simulated. It shows in the bracket with "simulated" and
its score. This happens as soon as the match becomes ready (at Start for
round 1, or when the second bot arrives in a later round), so the bracket never
waits on it. Its saved log of darts replays it like any match; no seed is needed.

A person against a bot is played on the board as usual.

### Players changing during a tournament

- **Removing a player** who is still in a running tournament is refused, with
  "Sam is still in Christmas 2026. Withdraw them from it first." (My call: the
  app drops removed players from its lists, and one made offline and removed
  before syncing is unknown to the server, so their matches could never save
  and the tournament would stick.) The record keeps names as well as ids, so a
  player removed after a tournament still shows in its bracket.
- **Withdraw** on a player's box gives their next match to the other player
  (shown as "walkover"), for anyone who has to leave.
- **Abandon tournament**: asks once, then marks it abandoned. Its played matches
  stay in the stats; it is listed under Past tournaments as "abandoned".

### Saving

A new table, in the same database as everything else (Pi, desktop, each hosted
account's file):

```
CREATE TABLE IF NOT EXISTS tournaments (
  id        TEXT PRIMARY KEY,   -- made up by the app
  seq       INTEGER NOT NULL,   -- goes up with every change; stale saves are ignored
  name      TEXT NOT NULL,
  data      TEXT NOT NULL,      -- JSON: game options, rounds, the bracket (below)
  created   INTEGER NOT NULL,
  finished  INTEGER,            -- NULL while going
  abandoned INTEGER NOT NULL DEFAULT 0,
  winner_id INTEGER REFERENCES players(id)
);
```

`data`:

```
{ opts: {start, out},                 // the X01 options every match uses
  rounds: [{legs}],                   // one per round, first round first
  entrants: [{id, name, bot?}],       // names kept for players removed later
  slots: [                            // every match in the bracket, round by round
    { round, a, b,                    // player ids, null until known; 'bye' for a bye
      match,                          // the saved match's id, once one is started
      winner,                         // player id once decided
      how }                           // 'played' | 'bye' | 'simulated' | 'walkover'
  ] }
```

The whole record goes up as one copy with its `seq`, the way matches do: a
`/api/tournaments/{id}` PUT (stale `seq` ignored), a GET of the list, and a GET
of one. In `sync.js` a `tournaments` list and a `tournamentsq` queue, sent and
fetched back with the rest. Player ids made offline (negative) are remapped in
the tournament as they are in matches.

Each match also records which tournament it belongs to, so a match synced on its
own can be tied back. (Builder: add it to the match's `opts` as
`tournament: {id, slot}`, which needs no change to the `matches` table, unless
something reads `opts` in a way that would break.)

**Two screens at once.** The same household on two screens is unlikely but
possible. Last write wins on the record, but a result is never lost: when the
app loads a tournament it fills in any slot whose saved match is won but whose
`winner` is empty. (Simple, and it makes the match the source of truth for
results.)

### Stats

No change. Tournament matches are ordinary X01 matches and count as such. Simulated
bot matches count only for the bots.

(My call, not asked for: a "Tournaments won" line on a player's stats is easy to
add later; left out.)

### Release notes

A line in `release.json` "unreleased" (see [[release-notes-upkeep]]):
"Tournaments: a knockout for 3 to 16 players, people and bots, on one board."

## In what order

Agreed with Sam 2026-11-24, to be in the stores for the Worlds:

1. **First release:** setting up, the drawn bracket and its animation, people
   and bots, bot against bot played out, saving and synced history, the
   winner's screen, refusing to remove a player who is still in one.
2. **Soon after:** Withdraw and walkover, and filling in results from saved
   matches when two screens change the same tournament (until then, last save
   wins).

## Tests

As boards did: `tests/tournament.test.mjs` for the bracket (sizes 3–16, byes
never meeting, next match, results moving on, undo of a result, withdraw,
simulation finishing with a winner and the right legs), `tests/sync.test.mjs`
for the queue and remapping, `tests/test_db.py` / `tests/test_data_api.py` for
the table and addresses (stale `seq` ignored), and `tests/test_hoststore.py` if
the hosted side needs the table made in existing account files. A click-through
in a headless browser of a 5-player tournament with two bots, to the winner's
screen, before handing over, with screenshots of the bracket at phone, tablet
and TV sizes (and with 16 players on a phone) and of the animation part way.

## Left to the builder

- Where the bracket logic lives (`web/tournament.js` for the pure parts, a
  `web/screens/tournament.js` for the screen, matching the split of
  `engine.js` / `screens/game.js`).
- The exact bye placement, so long as byes never meet and are spread.
- How the game screen knows it is a tournament match (the match's `opts`), and
  where "Back to the tournament" is wired in `app.js`'s click handler.
- Wording, within the README's plain voice.
