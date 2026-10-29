// Free-for-all rules for one match: the clock, scoring, the kill feed, standings and the
// end-of-match smoked meat ranks (GAME_DESIGN.md "Modes" and "Ranks").
//
// Scoring: a kill is +1; dying by your own hand (your own blast, the fire, falling out) is -1.

export const RANKS = ['Hot Dog', 'Smoked Chicken', 'Pulled Pork', 'Smoked Salmon', 'Brisket', 'Wagyu Burnt Ends'];

const FEED_KEEP = 8;
// The clock beeps every second for the last few.
const COUNTDOWN = 10;

// Performance score 0..1 from finishing place (1 = winner, of `count`) and K/D, then one of
// six equal bands.
export function rankFor(place, count, kills, deaths) {
  const placeScore = count > 1 ? (count - place) / (count - 1) : 1;
  const kd = Math.min(1, kills / Math.max(1, deaths) / 2);
  const score = 0.6 * placeScore + 0.4 * kd;
  return { score, rank: RANKS[Math.min(RANKS.length - 1, Math.floor(score * RANKS.length))] };
}

export function ordinal(n) {
  const t = n % 100;
  if (t >= 11 && t <= 13) return `${n}th`;
  return `${n}${['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}`;
}

export class Match {
  constructor(game, minutes) {
    this.game = game;
    this.length = minutes > 0 ? minutes * 60 : Infinity;
    this.timeLeft = this.length;
    this.over = false;
    // Newest last: { t, killer, victim, how, headshot, self }.
    this.feed = [];
    // Bumped whenever the feed changes, so views only rebuild it then.
    this.feedVersion = 0;
    this.onEnd = null;
  }

  get timed() {
    return Number.isFinite(this.length);
  }

  tick(dt) {
    if (this.over || !this.timed) return;
    const before = Math.ceil(this.timeLeft);
    this.timeLeft = Math.max(0, this.timeLeft - dt);
    const after = Math.ceil(this.timeLeft);
    if (after < before && after > 0 && after <= COUNTDOWN) this.game.sfx.play('tick');
    if (this.timeLeft <= 0) this.end();
  }

  onKill(victim, info) {
    const a = info.attacker;
    const byOther = a && a !== victim && a.kind === 'player';
    if (byOther) {
      a.stats.kills++;
      a.stats.score++;
    } else if (victim.kind === 'player') {
      victim.stats.score--;
    }
    this.feed.push({
      t: this.game.time,
      killer: byOther ? a : null,
      victim,
      how: howText(info, byOther),
      headshot: !!info.headshot && byOther,
    });
    if (this.feed.length > FEED_KEEP) this.feed.shift();
    this.feedVersion++;
  }

  // Everyone who plays (people and bots), best first, with places. Ties on score share a place.
  standings() {
    const list = this.game.players.slice().sort(
      (a, b) =>
        b.stats.score - a.stats.score ||
        b.stats.kills - a.stats.kills ||
        a.stats.deaths - b.stats.deaths ||
        a.id - b.id,
    );
    const count = list.length;
    return list.map((p) => {
      const place = 1 + list.filter((o) => o.stats.score > p.stats.score).length;
      return { player: p, place, ...rankFor(place, count, p.stats.kills, p.stats.deaths) };
    });
  }

  placeOf(player) {
    let place = 1;
    for (const o of this.game.players) if (o.stats.score > player.stats.score) place++;
    return place;
  }

  end() {
    if (this.over) return;
    this.over = true;
    this.timeLeft = Math.min(this.timeLeft, this.length);
    this.game.sfx.play('horn');
    const standings = this.standings();
    this.onEnd?.({ standings, winners: standings.filter((s) => s.place === 1).map((s) => s.player) });
  }
}

function howText(info, byOther) {
  if (byOther) {
    if (info.cause === 'melee') return info.backstab ? 'Tenderizer (back)' : 'Tenderizer';
    return info.weapon?.name ?? 'smoked';
  }
  if (info.cause === 'fire') return 'cooked in the fire';
  if (info.cause === 'fell') return 'fell out';
  if (info.cause === 'explosion') return `own ${info.weapon?.name ?? 'blast'}`;
  return 'smoked';
}

export function clockText(seconds) {
  const s = Math.ceil(seconds);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
