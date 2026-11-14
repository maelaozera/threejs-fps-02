// Rounds and money: a match is first to 5 round wins, at most 9 rounds. Each round opens
// with a 12-second buy phase, then 100 seconds of play. Vanguard wins a round by planting
// the Surge Charge and letting it detonate, or by eliminating the Raiders; Raiders win by
// stopping the plant, defusing it, or running the clock out. Money pays for the next buy.
import { WEAPONS, GRENADES, ARMOR_PRICE } from './weapons.js';

export const START_MONEY = 800;
export const WIN_BONUS = 3250;
export const LOSS_BONUS = 1900;
export const KILL_BONUS = 300;
export const PLANT_BONUS = 300;
export const DEFUSE_BONUS = 300;
export const BUY_SECONDS = 12;
export const ROUND_SECONDS = 100;
export const FUSE_SECONDS = 35;
export const WIN_ROUNDS = 5;
export const MAX_ROUNDS = 9;
export const TEAM_SIZE = 5; // Player plus four Vanguard bots against five Raiders.

export function createRounds(events) {
  const state = {
    phase: 'menu', // menu | buy | live | roundEnd | matchEnd
    round: 1,
    score: { vanguard: 0, raiders: 0 },
    money: START_MONEY,
    kills: 0,
    deaths: 0,
    buyLeft: BUY_SECONDS,
    roundLeft: ROUND_SECONDS,
    fuseLeft: 0,
    roundEndLeft: 0,
    bomb: { planted: false, site: null, position: null, carrier: 'player' },
    loadout: {
      primary: 'rifle',
      grenades: { frag: 0, smoke: 0, flash: 0 },
      armor: false,
    },
    lastReason: '',
  };

  function startMatch() {
    state.score = { vanguard: 0, raiders: 0 };
    state.money = START_MONEY;
    state.kills = 0;
    state.deaths = 0;
    state.round = 1;
    state.loadout = { primary: 'rifle', grenades: { frag: 0, smoke: 0, flash: 0 }, armor: false };
    startRound();
  }

  function startRound() {
    state.bomb = { planted: false, site: null, position: null, carrier: 'player' };
    state.roundLeft = ROUND_SECONDS;
    state.fuseLeft = 0;
    state.buyLeft = BUY_SECONDS;
    state.phase = 'buy';
    events.onRoundStart(state.round);
  }

  function skipBuy() {
    if (state.phase !== 'buy') return;
    state.phase = 'live';
    events.onPhase('live');
  }

  function plant(site, position) {
    state.bomb.planted = true;
    state.bomb.site = site;
    state.bomb.position = position.clone();
    state.fuseLeft = FUSE_SECONDS;
    state.money += PLANT_BONUS;
    events.onPlant(site);
  }

  function endRound(winner, reason) {
    if (state.phase === 'roundEnd' || state.phase === 'matchEnd') return;
    state.lastReason = reason;
    if (winner === 'vanguard') {
      state.score.vanguard += 1;
      state.money += WIN_BONUS;
    } else {
      state.score.raiders += 1;
      state.money += LOSS_BONUS;
    }
    state.phase = 'roundEnd';
    state.roundEndLeft = 4.5;
    events.onRoundEnd(winner, reason, { ...state.score });
  }

  function endMatch() {
    state.phase = 'matchEnd';
    const winner = state.score.vanguard > state.score.raiders ? 'vanguard' : 'raiders';
    events.onMatchEnd(winner, { ...state.score });
  }

  function tick(dt) {
    if (state.phase === 'buy') {
      state.buyLeft -= dt;
      if (state.buyLeft <= 0) skipBuy();
    } else if (state.phase === 'live') {
      state.roundLeft -= dt;
      if (state.bomb.planted) {
        state.fuseLeft -= dt;
        if (state.fuseLeft <= 0) {
          endRound('vanguard', 'Charge detonated at Site ' + state.bomb.site);
          return;
        }
      } else if (state.roundLeft <= 0) {
        endRound('raiders', 'Time expired — the charge never went off');
        return;
      }
    } else if (state.phase === 'roundEnd') {
      state.roundEndLeft -= dt;
      if (state.roundEndLeft <= 0) {
        if (state.score.vanguard >= WIN_ROUNDS || state.score.raiders >= WIN_ROUNDS || state.round >= MAX_ROUNDS) {
          endMatch();
        } else {
          state.round += 1;
          startRound();
        }
      }
    }
  }

  // --- The buy menu: one purchase, one money check, one result string. ---
  function buy(kind, id) {
    if (state.phase !== 'buy') return { ok: false, reason: 'Buy phase is over' };
    if (kind === 'weapon') {
      const def = WEAPONS[id];
      if (!def) return { ok: false, reason: 'Unknown weapon' };
      if (state.money < def.price) return { ok: false, reason: 'Not enough money' };
      if (state.loadout.primary === id) return { ok: false, reason: 'Already owned' };
      state.money -= def.price;
      state.loadout.primary = id;
      return { ok: true, reason: def.name + ' purchased' };
    }
    if (kind === 'grenade') {
      const def = GRENADES[id];
      if (!def) return { ok: false, reason: 'Unknown grenade' };
      if (state.loadout.grenades[id] >= def.max) return { ok: false, reason: 'Carrying the maximum' };
      if (state.money < def.price) return { ok: false, reason: 'Not enough money' };
      state.money -= def.price;
      state.loadout.grenades[id] += 1;
      return { ok: true, reason: def.name + ' purchased' };
    }
    if (kind === 'armor') {
      if (state.loadout.armor) return { ok: false, reason: 'Armour already worn' };
      if (state.money < ARMOR_PRICE) return { ok: false, reason: 'Not enough money' };
      state.money -= ARMOR_PRICE;
      state.loadout.armor = true;
      return { ok: true, reason: 'Vest purchased' };
    }
    return { ok: false, reason: 'Unknown item' };
  }

  function addKillBonus() {
    state.money += KILL_BONUS;
    state.kills += 1;
  }

  return { state, startMatch, startRound, skipBuy, plant, endRound, endMatch, tick, buy, addKillBonus };
}
