// Darts S.A.M. Copyright (C) 2026 Sam Cramphorn. Free software under the GNU
// AGPL v3: see LICENSE and NOTICE, or https://github.com/SonicSamShop/darts-sam
// SPDX-License-Identifier: AGPL-3.0-only

// Career Mode atmosphere, escalating opponent back-chat, darts slang, and
// mid-throw gamesmanship (coughing). Pure functions: zero DOM, easy to test.

export const ATMOSPHERE = [
  {
    tier: 0,
    venue: 'The Local Backroom',
    vibe: 'Cheeky',
    heat: '🔥',
    crowd: 0.25,
    blurb: 'Pint glasses clinking, friendly pub murmur, light cheek.',
  },
  {
    tier: 1,
    venue: 'County Social Club',
    vibe: 'Lively',
    heat: '🔥🔥',
    crowd: 0.45,
    blurb: 'Bustling club room, sharper back-chat and proper darts slang.',
  },
  {
    tier: 2,
    venue: 'Tour Floor Hall',
    vibe: 'Fierce',
    heat: '🔥🔥🔥',
    crowd: 0.65,
    blurb: 'Tense circuit crowd, deliberate coughs and ruthless sledging.',
  },
  {
    tier: 3,
    venue: 'TV Arena Floor',
    vibe: 'Hostile',
    heat: '🔥🔥🔥🔥',
    crowd: 0.85,
    blurb: 'Roaring arena, cutthroat mind games and fierce pro trash talk.',
  },
  {
    tier: 4,
    venue: 'World Championship Stage',
    vibe: 'Cauldron',
    heat: '🔥🔥🔥🔥🔥',
    crowd: 1.0,
    blurb: 'Electric cauldron, deafening cheers and relentless gamesmanship.',
  },
];

export const tierAtmosphere = tier => ATMOSPHERE[Math.min(ATMOSPHERE.length - 1, Math.max(0, tier | 0))];

// Compute effective intensity level (0..4) for a career match moment.
// Base comes from the career tier (0..4); cup finals or high-level pros can
// nudge intensity up a notch (capped at 4).
export function careerIntensity(career = {}) {
  let base = Number.isFinite(career.tier) ? career.tier : Math.min(4, Math.floor(((career.proLevel ?? 1) - 1) / 3));
  if (career.isFinal && base < 4) base += 1;
  return Math.min(4, Math.max(0, base | 0));
}

// Back-chat & darts slang bank indexed by intensity 0..4 (mild pub cheek -> fierce world-stage sledging).
const LINES = {
  intro: [
    [
      "Pint's on the loser then, mate?",
      "Don't worry, I'll go easy on ya first leg.",
      "Let's have a nice friendly chuck, eh?",
      "Fancy a warm-up, or straight into the arrows?",
    ],
    [
      "Heard you can throw a bit. Let's see it then.",
      "Hope you brought your doubles tonight, pal.",
      "No pub flukes on this oche, mate.",
      "Reckon you'll be buying the next round.",
    ],
    [
      "Long way from the pub league now, sunshine.",
      "Keep your nerve — the wires get real fat up here.",
      "I eat qualifiers for breakfast. Step up.",
      "Hope your arm doesn't go to jelly on the oche.",
    ],
    [
      "You're out of your depth on this floor, pal.",
      "Cameras are on. Try not to embarrass yourself.",
      "Every wire's gonna feel like a brick wall tonight.",
      "Let's make this quick — I've got a semi-final to win.",
    ],
    [
      "Welcome to the big stage. Watch your bottle melt.",
      "This crowd's gonna chew you up if you blink.",
      "Biggest night of your life; Tuesday night for me.",
      "Step up to the oche and show me you belong here.",
    ],
  ],
  cough: [
    [
      "*Ahem!* Sorry mate, dry pint.",
      "*Cough!* Bit dusty by the oche, innit?",
      "*Heh-hem!* Tickle in me throat, carry on.",
    ],
    [
      "*COUGH!* Whoops — crisp went down the wrong way!",
      "*Ahem-hem!* Bit smoky in the club tonight, pal.",
      "*Cough!* Don't let me put ya off now!",
    ],
    [
      "*HACK!* Oh, sorry — did I break your rhythm?",
      "*COUGH! COUGH!* Terrible cold going round the tour.",
      "*AHEM!* Just clearing the pipes, mate. Throw away.",
    ],
    [
      "*COUGH!* Oops, right on your release? My bad, pal.",
      "*AHEM!* Nerves getting to ya, or was that me?",
      "*HACK-COUGH!* Tough crowd in here tonight, innit?",
    ],
    [
      "*COUGH!* Right in the backswing — shame, that.",
      "*AHEM-HEM!* Hear that? That's your bottle cracking.",
      "*HACK!* Dry air under these lights, sunshine!",
    ],
  ],
  playerMiss: [
    [
      "Ooh, bit wide of the parish there, mate!",
      "Bed and breakfast? Classic pub darts!",
      "Aiming for the wallpaper, are we?",
      "Cheers for the charity, pal!",
    ],
    [
      "Bag of nails, that visit!",
      "26? My nan throws heavier than that!",
      "You're allergic to the treble bed, aren't ya?",
      "Keep feeding me visits like that, lovely stuff.",
    ],
    [
      "Proper pub-league chuck, that one!",
      "Where's your grouping gone? All over the shop!",
      "That's a Champagne visit — all fizz, no score.",
      "You're throwing like your flights are on backwards!",
    ],
    [
      "Absolute dross! Is that the best you've got?",
      "Wayward! You're miles off the lipstick tonight.",
      "Gift-wrapped leg, cheers mate!",
      "Pull yourself together or this'll be a whitewash.",
    ],
    [
      "Stage fright! Look at that scattergun rubbish!",
      "You're crumbling under the lights, sunshine!",
      "Bag of nails on the biggest stage — embarrassing!",
      "Pack your case if you're gonna chuck like that!",
    ],
  ],
  playerBust: [
    [
      "Oh no, bust! Maths is hard after two pints, eh?",
      "Too greedy, mate! Back ya go.",
      "Oops! Forgot how to count?",
    ],
    [
      "Busted! Somebody get the chalker a calculator!",
      "Head's gone! Classic bust under pressure.",
      "No score! Thanks for the extra visit, pal.",
    ],
    [
      "Bottled the count! Amateur hour on the oche!",
      "Bust! You're falling apart out here!",
      "That's what panic looks like, mate.",
    ],
    [
      "Busted on TV! That's going on the bloopers reel!",
      "Complete meltdown! Can't even count to tops!",
      "Gift of the century — cheers for throwing it away!",
    ],
    [
      "BUST! The pressure's fried your brain!",
      "Choked it! You've completely lost your head!",
      "Absolute bottle job on the World stage!",
    ],
  ],
  playerGood: [
    [
      "Whoa, steady on! Where'd that come from?",
      "Alright, jammy git — decent arrows!",
      "Fair play, nice bit of lipstick there.",
      "Saved your best darts for me, have ya?",
    ],
    [
      "Jammy! Bet you couldn't do that again.",
      "Alright, alright, keep your hair on!",
      "Good chuck, still gotta hit the double though.",
      "Fluke! Let's see ya back it up next visit.",
    ],
    [
      "Lucky bounce! Don't start celebrating yet.",
      "Big score means nothing if you bottle the out.",
      "Trying to rattle me? Gonna take more than that.",
      "Nice arrows, pal — shame it won't be enough.",
    ],
    [
      "Pure jam! Enjoy it while it lasts.",
      "Flash in the pan. Watch me answer straight back.",
      "Big ton, big deal — let's see your nerve on doubles.",
      "Alright, you've woke me up now. Bad mistake.",
    ],
    [
      "Fluke! One visit doesn't win a World title!",
      "Crowd loves it, I don't care. My throw next.",
      "Throw whatever you want — you'll still blink on tops!",
      "Nice fireworks. Now watch how a champion answers.",
    ],
  ],
  playerOnFinish: [
    [
      "Ooh, on a finish! Don't get shaky now, mate.",
      "Double trouble incoming, I can feel it.",
      "Tops or bust, eh? No pressure!",
    ],
    [
      "Madhouse is calling your name, pal!",
      "Let's see if your arm turns to spaghetti on the double.",
      "Easy to score, hard to check out. Go on then!",
    ],
    [
      "Squeaky bum time! Don't wire it now.",
      "I'm breathing right down your neck — miss and you're done.",
      "Legs are wobbling already, aren't they?",
    ],
    [
      "One slip and I'm taking this leg off you.",
      "Look at that grip — you're terrified of the outer ring!",
      "Bottle it now and the crowd'll eat you alive.",
    ],
    [
      "Whole arena's watching. Don't choke on the double!",
      "Every wire's a mile wide when your bottle goes!",
      "Miss this and I'm burying you. Go on, throw!",
    ],
  ],
  playerCheckout: [
    [
      "Fair play, tidy checkout! Next leg's mine though.",
      "Nice double, mate. Got lucky there!",
      "Pinched that one! I'll have ya next leg.",
    ],
    [
      "Jammy checkout! Won't happen again.",
      "Alright, you nicked one. Watch me step it up.",
      "Tight finish, I'll give ya that. Game on.",
    ],
    [
      "Fluky out! Don't get comfortable, pal.",
      "You got away with murder in that leg!",
      "Enjoy that one — you're not getting another.",
    ],
    [
      "Jammy! I handed you that leg on a plate.",
      "Rattled? Me? Dream on. Watch this next leg.",
      "Stole one against the darts — now the real fight starts.",
    ],
    [
      "You woke the beast now! That's the last leg you see!",
      "Lucky double! Let's see you hold your throw next!",
      "Crowd's roaring for ya — won't save you in the next leg!",
    ],
  ],
  botBig: [
    [
      "Have a bit of that, mate!",
      "Lovely jubbly! Right in the lipstick!",
      "Not bad for a pub player, eh?",
    ],
    [
      "Ton-plus! Follow that if ya can, pal!",
      "Boom! Arrows are singing tonight!",
      "Watch and learn, sunshine!",
    ],
    [
      "Heavy metal! How do you like them apples?",
      "Pure class! You're chasing shadows now!",
      "Right in the bed! Feel the heat yet?",
    ],
    [
      "Surgical! Try living with that scoring!",
      "Bosh! Putting you to the sword out here!",
      "That's pro darts, mate — take notes!",
    ],
    [
      "UNSTOPPABLE! Listen to that roar!",
      "Different level! You can't live with this pace!",
      "Maximum pressure! Step up and try to match it!",
    ],
  ],
  botLeg: [
    [
      "Game shot! Cheers for the leg, mate!",
      "Tidy double! That's one on the chalkboard.",
      "Too slick! Get the pints ready.",
    ],
    [
      "Tops, thank you very much! Too easy!",
      "Clinical! You're gonna have to wake up, pal.",
      "Bang! Another leg in the bag.",
    ],
    [
      "Boom! Put to bed! Can you handle the heat?",
      "Outclassed! Better sharpen those points, mate.",
      "Ice cold on the double. Your turn to sweat.",
    ],
    [
      "Brutal! You didn't even get a look at a double!",
      "That's how you close a leg on the big floor!",
      "Rattled ya! You're running out of legs, pal.",
    ],
    [
      "BOOM! Bow down! This stage belongs to me!",
      "Absolute demolition! You're drowning out here!",
      "Ice in my veins! You've got nothing left!",
    ],
  ],
  matchWin: [
    [
      "Fair play, mate! Pint's on me tonight.",
      "Good darts! You had my number there.",
    ],
    [
      "Alright, you earned that one. Rematch soon, pal.",
      "Jammy git — fair dos, you held your nerve.",
    ],
    [
      "Can't believe I let that slip. Won't happen next time.",
      "Good battle. Enjoy it — I'm coming for you next cup.",
    ],
    [
      "Robbed! You caught me on an off night, that's all.",
      "Fair play... you've got bottle, I'll give you that.",
    ],
    [
      "Unbelievable. Take the crown... for now.",
      "You actually held your nerve under the lights. Respect.",
    ],
  ],
  matchLoss: [
    [
      "Unlucky, mate! Same time next week at the local?",
      "Cheers for the game — mine's a bitter!",
    ],
    [
      "Too sharp for ya tonight, pal! Back to the practice board!",
      "Game, set and pint! Better luck next fixture.",
    ],
    [
      "Out of your league, sunshine! Keep practising your doubles!",
      "Told ya! You're not ready for this tour yet.",
    ],
    [
      "Schooled! Don't bother turning up till you can hit tops!",
      "Levels to this game, pal — and you're a few below.",
    ],
    [
      "THE CROWN STAYS HERE! Come back when you've got the bottle!",
      "Total domination on the World stage! Better luck next season!",
    ],
  ],
};

// Pick a banter entry { text, idx } for a given event and intensity (0..4).
// Avoids repeating `lastText` when possible.
export function pickBanterEntry(kind, intensity = 0, { lastText = '', random = Math.random } = {}) {
  const bank = LINES[kind];
  if (!bank) return { text: '', idx: -1 };
  const lvl = Math.min(bank.length - 1, Math.max(0, intensity | 0));
  const pool = bank[lvl];
  if (!pool?.length) return { text: '', idx: -1 };
  const indices = pool.map((_, i) => i);
  const choices = pool.length > 1 && lastText ? indices.filter(i => pool[i] !== lastText) : indices;
  const idx = choices[Math.floor(random() * choices.length)] ?? 0;
  return { text: pool[idx], idx };
}

// Pick a banter line for a given event and intensity (0..4).
export function pickBanter(kind, intensity = 0, opts = {}) {
  return pickBanterEntry(kind, intensity, opts).text;
}

// Map a pro's country code to one of our bundled neural-TTS regional accent packs.
export function accentFor(country = '', proId = '') {
  const c = String(country || '').toUpperCase();
  if (c === 'GB-SCT') return 'scot';
  if (c === 'US' || c === 'CA') return 'us';
  if (c === 'ES') return 'es';
  if (c === 'JP' || c === 'PH') return 'asia';
  if (['DE', 'NL', 'BE', 'AT', 'PL', 'SE'].includes(c)) return 'euro';
  if (c === 'GB-ENG' || c === 'GB-WLS' || c === 'GB-NIR') {
    const n = parseInt(String(proId).replace(/\D/g, ''), 10) || 0;
    return n % 3 === 0 ? 'uk_south' : 'uk_north';
  }
  return 'uk_south';
}

export function banterClipUrl(accent, kind, intensity, idx) {
  if (!accent || !kind || idx < 0) return '';
  const lvl = Math.min(4, Math.max(0, intensity | 0));
  return `audio/banter/${accent}/${kind}-${lvl}-${idx}.mp3`;
}

export const BANTER_BANK = LINES;

// Decide whether and when (ms) the opponent coughs during the player's visit.
// Higher intensity and being on a checkout make a distracting cough more likely
// and quicker to happen. Returns { willCough, delayMs }.
export function coughPlan(intensity = 0, { onFinish = false, random = Math.random } = {}) {
  const lvl = Math.min(4, Math.max(0, intensity | 0));
  // Probability per visit: 18% in Pub League up to 62% in World Championship (+18% on a finish).
  const baseProb = [0.18, 0.28, 0.40, 0.52, 0.62][lvl];
  const prob = Math.min(0.85, baseProb + (onFinish ? 0.18 : 0));
  const willCough = random() < prob;
  // Delay between 1.8s and ~6.5s so it catches the player mid-aim / between darts.
  const minMs = [2800, 2400, 2000, 1700, 1400][lvl];
  const spanMs = [3800, 3400, 3000, 2600, 2200][lvl];
  const delayMs = Math.round(minMs + random() * spanMs);
  return { willCough, delayMs, prob };
}
