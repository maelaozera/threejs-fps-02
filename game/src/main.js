// Emberline: boot and the one loop. A fixed 60 Hz simulation feeds a render at the display
// rate. ?shot=start|play|plant|end with &seed=N sets up a deterministic frame for a capture,
// renders it twice, then freezes it and sets window.__shotReady.
import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { createWorld, SITES, SPAWNS } from './world.js';
import { createInput } from './input.js';
import { createPlayer } from './player.js';
import { createAudio } from './audio.js';
import { WEAPONS, GRENADES, createViewModel, createWeaponState, weaponStep, weaponReady, weaponFire, weaponReload, weaponSpread } from './weapons.js';
import { createCombat } from './combat.js';
import { createBots } from './bots.js';
import { createRounds } from './rounds.js';
import { createHud } from './hud.js';

const FIXED_STEP = 1 / 60;
const params = new URLSearchParams(window.location.search);
const shot = params.get('shot');
const seed = Number.parseInt(params.get('seed') ?? '7', 10) || 7;

function mulberry32(initial) {
  let a = initial;
  return function random() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const random = mulberry32(seed);

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.getElementById('game').appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(PALETTE.canvas);
scene.fog = new THREE.Fog(new THREE.Color(PALETTE.canvas), 26, 70);
const camera = new THREE.PerspectiveCamera(74, window.innerWidth / window.innerHeight, 0.05, 160);
scene.add(camera);

const world = createWorld(scene);
const audio = createAudio();
const combat = createCombat(scene, world, audio);
const hud = createHud(world);
const player = createPlayer(world.colliders, { x: 0, z: 19 });
const bots = createBots(scene, world, combat, audio);
const input = createInput(renderer.domElement, onLockChange);

const raycaster = new THREE.Raycaster();
const direction = new THREE.Vector3();
const eyePos = new THREE.Vector3();
const muzzlePos = new THREE.Vector3();
const aimPoint = new THREE.Vector3();

// --- Player loadout: a primary, a pistol, grenades and armour, all from the buy menu. ---
const loadout = {
  primary: createWeaponState(WEAPONS.rifle),
  pistol: createWeaponState(WEAPONS.pistol),
  current: 'primary',
  view: null,
  grenades: { frag: 0, smoke: 0, flash: 0 },
  grenadeSelected: 'frag',
  armor: false,
};
loadout.view = createViewModel(camera, WEAPONS.rifle);

function currentWeapon() {
  return loadout.current === 'primary' ? loadout.primary : loadout.pistol;
}

function equip(slot) {
  if (slot === loadout.current) return;
  loadout.current = slot;
  const def = currentWeapon().def;
  camera.remove(loadout.view.model, loadout.view.flash, loadout.view.flashLight);
  loadout.view = createViewModel(camera, def);
  hud.setAmmo(currentWeapon().mag, currentWeapon().reserve, def.name);
}

function applyLoadout(rounds) {
  const primaryDef = WEAPONS[rounds.state.loadout.primary];
  loadout.primary = createWeaponState(primaryDef);
  loadout.pistol = createWeaponState(WEAPONS.pistol);
  loadout.current = 'primary';
  camera.remove(loadout.view.model, loadout.view.flash, loadout.view.flashLight);
  loadout.view = createViewModel(camera, primaryDef);
  loadout.grenades = { ...rounds.state.loadout.grenades };
  loadout.armor = rounds.state.loadout.armor;
  player.player.armor = loadout.armor;
  hud.setAmmo(loadout.primary.mag, loadout.primary.reserve, primaryDef.name);
  hud.setGrenades(loadout.grenades, loadout.grenadeSelected);
}

// --- The player as a damageable, so bot shots and frags hit the same way bot shots do. ---
const playerAdapter = {
  alive: true,
  body: player.body,
  name: 'You',
  // Bots call center() with no argument; reuse a dedicated scratch vector so no
  // allocation happens in the per-frame vision checks.
  center(out = playerAdapterTmp) {
    out.set(player.body.position.x, player.body.position.y + 1.1, player.body.position.z);
    return out;
  },
};
const playerAdapterTmp = new THREE.Vector3();
const playerCenterTmp = new THREE.Vector3();
combat.registerDamageable({
  name: 'You',
  meshes: [],
  alive: () => player.player.alive,
  center: () => playerAdapter.center(playerCenterTmp),
  apply: (amount, part) => player.damage(amount, part),
});

let matchStarted = false;
let plantProgress = 0;
let elapsed = 0;
let frozen = false;
let started = false;
let accumulator = 0;
let lastTime = performance.now();
let stepCounter = 0;
let footstepAt = 0;

let buyOpen = false;

function setBuy(open) {
  buyOpen = open;
  hud.showBuy(open);
}

const rounds = createRounds({
  onRoundStart(round) {
    bots.setupRound(round, random);
    const spawn = SPAWNS.vanguard[round % SPAWNS.vanguard.length] ?? SPAWNS.vanguard[0];
    player.reset({ x: spawn[0], z: spawn[1] });
    player.body.yaw = 0; // Facing north (-z), into the yard.
    applyLoadout(rounds);
    plantProgress = 0;
    hud.setHealth(100, loadout.armor);
    hud.setScore(rounds.state.score.vanguard, rounds.state.score.raiders, round);
    hud.setBombStatus(false);
    hud.setProgress(null, null);
    setBuy(true);
    hud.showBanner(`Round ${round}`, 'Buy phase — press B for the shop, Enter to deploy', 3000);
  },
  onPhase(phase) {
    if (phase === 'live') {
      setBuy(false);
      hud.showBanner('Go', 'Plant the charge at Site A or Site B', 2200);
    }
  },
  onPlant(site) {
    audio.plantDone();
    hud.showBanner('Charge planted', `Site ${site} — defend it until it detonates`, 3000);
  },
  onRoundEnd(winner, reason, score) {
    if (winner === 'vanguard') audio.roundWin();
    else audio.roundLose();
    hud.setScore(score.vanguard, score.raiders, rounds.state.round);
    hud.showBanner(
      winner === 'vanguard' ? 'Round won' : 'Round lost',
      `${reason} — ${score.vanguard} : ${score.raiders}`,
      4200,
    );
    if (document.pointerLockElement) document.exitPointerLock();
  },
  onMatchEnd(winner, score) {
    if (winner === 'vanguard') audio.roundWin();
    else audio.roundLose();
    hud.showOverlay(winner === 'vanguard' ? 'matchWin' : 'matchLose', `Final score ${score.vanguard} : ${score.raiders}. Kills ${rounds.state.kills}, deaths ${rounds.state.deaths}.`);
  },
});

function onLockChange(locked) {
  if (shot) return;
  if (locked) {
    started = true;
    audio.ensure();
    audio.startAmbient();
    hud.hideOverlay();
    if (rounds.state.phase === 'buy') setBuy(false);
  } else if (matchStarted && rounds.state.phase === 'live') {
    hud.showOverlay('paused');
  }
}

hud.onPlay(() => {
  if (shot) return;
  if (!matchStarted) {
    matchStarted = true;
    rounds.startMatch();
  } else if (rounds.state.phase === 'matchEnd') {
    rounds.startMatch();
  }
  hud.hideOverlay();
  input.requestLock();
});

hud.buildBuy(
  (kind, id) => {
    const result = rounds.buy(kind, id);
    if (result.ok) {
      audio.buy();
      applyLoadout(rounds);
      hud.setMoney(rounds.state.money);
    } else {
      audio.denied();
    }
    hud.showBanner(result.ok ? 'Purchased' : 'Cannot buy', result.reason, 1600);
  },
  () => {
    rounds.skipBuy();
    setBuy(false);
    input.requestLock();
  },
);

// --- Shooting: the player fires pellets through the combat ray; bots fire the same way. ---
function wallDistance(origin, dir, range) {
  raycaster.set(origin, dir);
  raycaster.far = range;
  const hits = raycaster.intersectObjects(world.shootables, false);
  return hits.length > 0 ? hits[0].distance : Infinity;
}

function rayHitsPlayer(origin, dir, range) {
  const wall = wallDistance(origin, dir, range);
  const chest = playerAdapter.center(new THREE.Vector3());
  const toChest = chest.clone().sub(origin);
  const alongChest = toChest.dot(dir);
  let best = Infinity;
  let part = null;
  if (alongChest > 0 && alongChest < wall) {
    const closest = origin.clone().addScaledVector(dir, alongChest);
    if (closest.distanceTo(chest) < 0.45) { best = alongChest; part = 'torso'; }
  }
  const head = new THREE.Vector3(player.body.position.x, player.body.position.y + 1.52, player.body.position.z);
  const toHead = head.clone().sub(origin);
  const alongHead = toHead.dot(dir);
  if (alongHead > 0 && alongHead < wall && alongHead < best) {
    const closest = origin.clone().addScaledVector(dir, alongHead);
    if (closest.distanceTo(head) < 0.22) { best = alongHead; part = 'head'; }
  }
  return part ? { part, distance: best } : null;
}

function killFeed(killer, victim, headshot) {
  hud.addKillFeed(killer, victim, headshot);
}

function playerShoot() {
  const state = currentWeapon();
  if (!weaponReady(state)) {
    if (state.mag === 0 && state.cooldown === 0) audio.dryFire();
    return;
  }
  if (!weaponFire(state)) return;
  audio.shot(state.def.kind);
  const spread = weaponSpread(state, player.groundSpeed(), input.state.scoped);
  camera.getWorldDirection(direction);
  player.eyePosition(eyePos);
  muzzlePos.copy(eyePos).addScaledVector(direction, 0.6);
  muzzlePos.y -= 0.12;
  for (let pellet = 0; pellet < state.def.pellets; pellet += 1) {
    const dir = direction.clone();
    dir.x += (random() * 2 - 1) * spread;
    dir.y += (random() * 2 - 1) * spread;
    dir.z += (random() * 2 - 1) * spread;
    dir.normalize();
    const hit = combat.firePellet(eyePos, dir, state.def.range);
    const end = hit ? hit.point : eyePos.clone().addScaledVector(dir, state.def.range);
    combat.spawnTracer(muzzlePos, end);
    if (!hit) continue;
    if (hit.target) {
      const bot = hit.target;
      const amount = state.def.damage * (hit.part === 'head' ? state.def.headMult : 1);
      const died = bots.damageBot(bot, amount, hit.part);
      hud.hitMarker(died);
      audio.hit();
      combat.burst(hit.point, hit.normal, 6, 2, 0.4, PALETTE.ember);
      if (died) {
        killFeed('You', bot.name, hit.part === 'head');
        audio.kill();
        rounds.addKillBonus();
        hud.setMoney(rounds.state.money);
        if (bot.carrying) transferCharge(bot);
        checkElimination();
      }
    } else {
      combat.burst(hit.point, hit.normal, 8, 3, 0.5, PALETTE.accent);
    }
  }
  player.recoil(0.009 + random() * 0.004, (random() * 2 - 1) * 0.004);
  hud.setAmmo(state.mag, state.reserve, state.def.name);
  for (const bot of bots.bots) bots.hearShot(bot, player.body.position);
}

function onBotShoot(bot, aim, target) {
  const origin = new THREE.Vector3(bot.body.position.x, bot.body.position.y + bot.body.eye, bot.body.position.z);
  const dir = aim.clone().sub(origin).normalize();
  const def = bot.weapon.def;
  const muzzle = origin.clone().addScaledVector(dir, 0.6);
  const playerHit = rayHitsPlayer(origin, dir, def.range);
  const hit = combat.firePellet(origin, dir, def.range);
  const endPoint = hit ? hit.point : origin.clone().addScaledVector(dir, def.range);
  combat.spawnTracer(muzzle, endPoint);
  const distanceToPlayer = origin.distanceTo(player.body.position);
  if (distanceToPlayer < 26) audio.shot(def.kind);
  else audio.distantShot();
  // The nearest of the bot hit and the player hit is the one the bullet meets first.
  if (hit && hit.target && (!playerHit || hit.distance < playerHit.distance)) {
    const victim = hit.target;
    const amount = def.damage * (hit.part === 'head' ? def.headMult : 1);
    const died = bots.damageBot(victim, amount, hit.part);
    if (died) {
      killFeed(bot.name, victim.name, hit.part === 'head');
      bot.kills += 1;
      if (victim.carrying) transferCharge(victim);
      checkElimination();
    }
  } else if (playerHit && player.player.alive && !shot) {
    // In shot mode the camera never dies: the capture frame stays playable.
    const amount = def.damage * (playerHit.part === 'head' ? def.headMult : 1);
    const died = player.damage(amount, playerHit.part);
    hud.damageFlash();
    audio.hurt();
    hud.setHealth(player.player.health, player.player.armor);
    if (died) {
      killFeed(bot.name, 'You', playerHit.part === 'head');
      onPlayerDeath(bot.name);
    }
  } else if (hit) {
    combat.burst(hit.point, hit.normal, 6, 2.5, 0.4, PALETTE.muted);
  }
  for (const other of bots.bots) {
    if (other !== bot) bots.hearShot(other, bot.body.position);
  }
}

function onFragDamage(entry, amount, part, thrower) {
  const died = entry.apply(amount, part, thrower);
  if (!died) return;
  killFeed(thrower === 'player' ? 'You' : thrower, entry.name ?? 'Unknown', false);
  if (thrower === 'player') {
    rounds.addKillBonus();
    hud.setMoney(rounds.state.money);
  }
  const victim = bots.bots.find((bot) => bot.name === entry.name);
  if (victim && victim.carrying) transferCharge(victim);
  checkElimination();
}

function onFlash(position) {
  audio.flash();
  const now = performance.now() / 1000;
  const eye = player.eyePosition(new THREE.Vector3());
  const toFlash = position.clone().sub(eye);
  const distance = toFlash.length();
  if (distance < 28 && player.player.alive) {
    const wall = wallDistance(eye, toFlash.clone().normalize(), distance);
    camera.getWorldDirection(direction);
    const facing = direction.dot(toFlash.clone().normalize());
    if (wall >= distance && facing > 0.05) {
      const duration = 0.6 + 2.2 * (1 - distance / 28);
      player.player.flashUntil = now + duration;
      hud.flashBlind(duration / 2.8);
    }
  }
  for (const bot of bots.bots) {
    if (!bot.alive) continue;
    const botEye = new THREE.Vector3(bot.body.position.x, bot.body.position.y + bot.body.eye, bot.body.position.z);
    const toBotFlash = position.clone().sub(botEye);
    const botDistance = toBotFlash.length();
    if (botDistance > 28) continue;
    const wall = wallDistance(botEye, toBotFlash.clone().normalize(), botDistance);
    const forward = new THREE.Vector3(-Math.sin(bot.body.yaw), 0, -Math.cos(bot.body.yaw));
    const facing = forward.dot(toBotFlash.clone().normalize());
    if (wall >= botDistance && facing > 0.05) {
      bots.blindBot(bot, now + 0.6 + 2.2 * (1 - botDistance / 28));
    }
  }
}

function transferCharge(fromBot) {
  fromBot.carrying = false;
  if (rounds.state.bomb.planted) return;
  let best = null;
  let bestDistance = Infinity;
  for (const bot of bots.bots) {
    if (bot.team !== 'vanguard' || !bot.alive) continue;
    const distance = bot.body.position.distanceTo(fromBot.body.position);
    if (distance < bestDistance) { bestDistance = distance; best = bot; }
  }
  if (best) {
    best.carrying = true;
    rounds.state.bomb.carrier = best.name;
    hud.showBanner('Charge dropped', `${best.name} picked up the charge`, 2500);
  } else {
    rounds.state.bomb.carrier = null;
  }
}

function onPlayerDeath(killer) {
  rounds.state.deaths += 1;
  if (document.pointerLockElement) document.exitPointerLock();
  if (!rounds.state.bomb.planted) {
    let best = null;
    let bestDistance = Infinity;
    for (const bot of bots.bots) {
      if (bot.team !== 'vanguard' || !bot.alive) continue;
      const distance = bot.body.position.distanceTo(player.body.position);
      if (distance < bestDistance) { bestDistance = distance; best = bot; }
    }
    if (best) {
      best.carrying = true;
      rounds.state.bomb.carrier = best.name;
      hud.showBanner('Charge dropped', `${best.name} picked up the charge`, 2500);
    } else {
      rounds.state.bomb.carrier = null;
    }
  }
  hud.setHealth(0, player.player.armor);
  checkElimination();
}

function checkElimination() {
  if (rounds.state.phase !== 'live') return;
  const vanguardAlive = (player.player.alive ? 1 : 0) + bots.aliveCount('vanguard');
  const raidersAlive = bots.aliveCount('raiders');
  if (raidersAlive === 0) rounds.endRound('vanguard', 'Raiders eliminated');
  else if (vanguardAlive === 0 && !rounds.state.bomb.planted) rounds.endRound('raiders', 'Vanguard eliminated');
}

function throwSelectedGrenade() {
  const kind = loadout.grenadeSelected;
  if ((loadout.grenades[kind] ?? 0) <= 0) {
    audio.denied();
    hud.showBanner('No grenade', `No ${GRENADES[kind].name} left — buy one next round`, 1600);
    return;
  }
  loadout.grenades[kind] -= 1;
  camera.getWorldDirection(direction);
  player.eyePosition(eyePos);
  combat.throwGrenade(kind, eyePos, direction, 'player');
  hud.setGrenades(loadout.grenades, kind);
}

let vanguardList = [playerAdapter];
let raiderList = [];
let wasFiring = false;
let lastBeepAt = 0;
let minimapAt = 0;

const botCtx = {
  get vanguards() { return vanguardList; },
  get raiders() { return raiderList; },
  get bomb() { return rounds.state.bomb; },
  onBotShoot,
  onPlantProgress(bot, fraction) { hud.setProgress(`${bot.name} planting…`, fraction); },
  onPlantDone(bot, site) {
    bot.state = 'advance';
    bot.plantProgress = 0;
    bot.carrying = false;
    hud.setProgress(null, null);
    rounds.plant(site, bot.body.position);
  },
  onDefuseProgress(bot, fraction) { hud.setProgress(`${bot.name} defusing…`, fraction); },
  onDefuseDone(bot) {
    hud.setProgress(null, null);
    rounds.endRound('raiders', `${bot.name} defused the charge`);
  },
};

function rebuildBotLists() {
  vanguardList = [playerAdapter, ...bots.bots.filter((bot) => bot.team === 'vanguard')];
  raiderList = bots.bots.filter((bot) => bot.team === 'raiders');
}

function syncCamera() {
  const body = player.body;
  const eye = player.player.alive ? body.eye : 0.5;
  camera.position.set(body.position.x, body.position.y + eye, body.position.z);
  camera.rotation.set(body.pitch, body.yaw, 0, 'YXZ');
  const targetFov = input.state.scoped && currentWeapon().def.zoom > 1 ? 74 / currentWeapon().def.zoom : 74;
  if (Math.abs(camera.fov - targetFov) > 0.05) {
    camera.fov += (targetFov - camera.fov) * 0.2;
    camera.updateProjectionMatrix();
  }
}

function updatePlant(dt) {
  if (rounds.state.phase !== 'live' || !player.player.alive || rounds.state.bomb.planted || rounds.state.bomb.carrier !== 'player') {
    if (plantProgress > 0) {
      plantProgress = 0;
      hud.setProgress(null, null);
    }
    return;
  }
  let nearSite = null;
  for (const key of ['A', 'B']) {
    const site = SITES[key];
    const distance = Math.hypot(site.center.x - player.body.position.x, site.center.z - player.body.position.z);
    if (distance < site.radius) { nearSite = key; break; }
  }
  if (nearSite && input.held('KeyE')) {
    plantProgress += dt / 3.5;
    hud.setProgress('Planting charge… (hold E)', Math.min(1, plantProgress));
    if (plantProgress >= 1) {
      rounds.plant(nearSite, SITES[nearSite].center);
      plantProgress = 0;
      hud.setProgress(null, null);
    }
  } else if (plantProgress > 0) {
    plantProgress = Math.max(0, plantProgress - dt * 1.5);
    hud.setProgress(plantProgress > 0 ? 'Planting charge… (hold E)' : null, plantProgress > 0 ? plantProgress : null);
  }
}

function step(dt) {
  elapsed += dt;
  stepCounter += 1;
  rounds.tick(dt);
  const phase = rounds.state.phase;
  const playing = phase === 'live' || phase === 'buy';

  if (player.player.alive && playing && (input.state.locked || shot)) {
    player.step(dt, input.state.keys);
    const speed = player.groundSpeed();
    if (speed > 1.5 && player.body.onGround && elapsed > footstepAt) {
      footstepAt = elapsed + 0.38;
      audio.footstep(speed > 4);
    }
  }

  weaponStep(currentWeapon(), dt, loadout.view);
  if (loadout.current === 'primary') weaponStep(loadout.pistol, dt, null);
  else weaponStep(loadout.primary, dt, null);

  if (playing && phase === 'live') {
    bots.step(dt, elapsed, botCtx);
  }

  // --- Player actions, edge-triggered where they must fire once. ---
  if (playing && player.player.alive && (input.state.locked || shot)) {
    if (input.state.firing && (!wasFiring || currentWeapon().def.auto)) playerShoot();
    if (input.consume('KeyR') && weaponReload(currentWeapon())) audio.reload();
    if (input.consume('Digit1')) equip('primary');
    if (input.consume('Digit2')) equip('pistol');
    if (input.consume('Digit4')) {
      const order = ['frag', 'smoke', 'flash'];
      const next = order[(order.indexOf(loadout.grenadeSelected) + 1) % order.length];
      loadout.grenadeSelected = next;
      hud.showBanner('Grenade', GRENADES[next].name, 1200);
    }
    if (input.consume('KeyG')) throwSelectedGrenade();
    if (input.consume('KeyB') && phase === 'buy') {
      // B toggles the shop: open it (releasing the mouse) or close it and re-lock.
      if (buyOpen) {
        setBuy(false);
        input.requestLock();
      } else {
        setBuy(true);
        if (document.pointerLockElement) document.exitPointerLock();
      }
    }
    if (input.consume('Enter') && phase === 'buy') {
      rounds.skipBuy();
      setBuy(false);
      input.requestLock();
    }
  }
  wasFiring = input.state.firing;

  updatePlant(dt);

  // Bomb beeps, quickening as the fuse runs down.
  if (rounds.state.bomb.planted && phase === 'live') {
    const fuse = rounds.state.fuseLeft;
    const gap = Math.max(0.3, fuse / 35);
    if (elapsed - lastBeepAt > gap) {
      lastBeepAt = elapsed;
      audio.beep(fuse < 6);
    }
  }

  combat.step(dt, onFragDamage, onFlash, () => {});
  checkElimination();

  // --- HUD refresh (each setter caches, so unchanged values cost nothing). ---
  hud.setHealth(player.player.health, player.player.armor);
  hud.setAmmo(currentWeapon().mag, currentWeapon().reserve, currentWeapon().def.name);
  hud.setMoney(rounds.state.money);
  hud.setTimer(rounds.state.bomb.planted ? rounds.state.fuseLeft : rounds.state.roundLeft, rounds.state.bomb.planted);
  hud.setScore(rounds.state.score.vanguard, rounds.state.score.raiders, rounds.state.round);
  hud.setAlive((player.player.alive ? 1 : 0) + bots.aliveCount('vanguard'), bots.aliveCount('raiders'));
  hud.setCrosshairSpread(weaponSpread(currentWeapon(), player.groundSpeed(), input.state.scoped));
  hud.setBombStatus(rounds.state.bomb.planted, rounds.state.bomb.site, rounds.state.fuseLeft);
  hud.setGrenades(loadout.grenades, loadout.grenadeSelected);
  if (elapsed - minimapAt > 0.15) {
    minimapAt = elapsed;
    hud.drawMinimap(player.body, bots.bots.filter((bot) => bot.team === 'vanguard'), bots.bots.filter((bot) => bot.team === 'raiders'), elapsed);
  }
}

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min((now - lastTime) / 1000, 0.1);
  lastTime = now;
  if (!frozen) {
    const look = input.takeLook();
    if (input.state.locked || shot) {
      const sensitivity = input.state.scoped ? 0.0012 : 0.0022;
      player.look(look.x, look.y, sensitivity);
    }
    accumulator += dt;
    let steps = 0;
    while (accumulator >= FIXED_STEP && steps < 5) {
      step(FIXED_STEP);
      accumulator -= FIXED_STEP;
      steps += 1;
    }
    if (accumulator > FIXED_STEP * 5) accumulator = 0;
    syncCamera();
  }
  renderer.render(scene, camera);
}

function settle(steps) {
  for (let index = 0; index < steps; index += 1) step(FIXED_STEP);
}

function paintTwiceThenReady() {
  let painted = 0;
  function paint() {
    requestAnimationFrame(paint);
    syncCamera();
    renderer.render(scene, camera);
    painted += 1;
    if (painted === 2) {
      window.__shotReady = true;
      frozen = true;
    }
  }
  requestAnimationFrame(paint);
}

function aimAt(point) {
  const body = player.body;
  const dx = point.x - body.position.x;
  const dy = point.y - (body.position.y + body.eye);
  const dz = point.z - body.position.z;
  const length = Math.hypot(dx, dy, dz) || 1;
  body.yaw = Math.atan2(-dx, -dz);
  body.pitch = Math.asin(Math.max(-1, Math.min(1, dy / length)));
  syncCamera();
}

function runShot(name) {
  matchStarted = true;
  rounds.startMatch();
  rebuildBotLists();
  setBuy(false);
  hud.hideOverlay();
  hud.hideBanner();
  const body = player.body;

  if (name === 'start') {
    body.position.set(0, 0, 19);
    body.yaw = 0;
    body.pitch = 0.02;
    settle(20);
    hud.showOverlay('start');
  } else if (name === 'play') {
    rounds.skipBuy();
    // Stage a mid-lane firefight: Raiders pushing the lanes, Vanguard covering mid.
    const raiders = bots.bots.filter((bot) => bot.team === 'raiders');
    const vanguards = bots.bots.filter((bot) => bot.team === 'vanguard');
    const spots = [[-8, 2], [8, 2], [0, -2], [-14, -6], [14, -6]];
    raiders.forEach((bot, index) => {
      bot.body.position.set(spots[index][0], 0, spots[index][1]);
      bot.body.yaw = Math.PI; // Raiders face south, toward the attackers.
    });
    vanguards.forEach((bot, index) => {
      bot.body.position.set(-4 + index * 2.5, 0, 12);
      bot.body.yaw = 0;
    });
    body.position.set(0, 0, 14);
    body.yaw = 0;
    body.pitch = 0;
    settle(90);
    const target = raiders[0];
    aimAt(new THREE.Vector3(target.body.position.x, target.body.position.y + 1.2, target.body.position.z));
    playerShoot();
    settle(2);
  } else if (name === 'plant') {
    rounds.skipBuy();
    rounds.plant('A', SITES.A.center);
    const raiders = bots.bots.filter((bot) => bot.team === 'raiders');
    raiders[0].body.position.set(-14, 0, -6);
    raiders[1].body.position.set(-24, 0, -4);
    raiders[2].body.position.set(-8, 0, -14);
    body.position.set(-15, 0, -8);
    settle(60);
    aimAt(new THREE.Vector3(SITES.A.center.x, 1.2, SITES.A.center.z));
    settle(2);
  } else {
    // end: a round just won — every Raider down in the yard, the scoreboard ahead.
    rounds.state.score = { vanguard: 3, raiders: 1 };
    rounds.state.round = 4;
    rounds.skipBuy();
    const raiders = bots.bots.filter((bot) => bot.team === 'raiders');
    const fallen = [[-6, 2], [6, 4], [-2, -4], [10, -2], [-12, -8]];
    raiders.forEach((bot, index) => {
      bot.alive = false;
      bot.fall = 1;
      bot.body.position.set(fallen[index][0], 0, fallen[index][1]);
      bot.meshes.group.position.set(fallen[index][0], 0, fallen[index][1]);
      bot.meshes.group.rotation.x = -1.45;
    });
    body.position.set(0, 0, 10);
    body.yaw = 0;
    settle(30);
    rounds.endRound('vanguard', 'Raiders eliminated');
    // Re-show the banner with a long hold: the capture's two software renders can take
    // longer than the banner's normal 4.2 s, and the banner is the point of this shot.
    hud.showBanner('Round won', 'Raiders eliminated — 4 : 1', 60000);
    settle(2);
  }

  hud.setScore(rounds.state.score.vanguard, rounds.state.score.raiders, rounds.state.round);
  hud.setAmmo(currentWeapon().mag, currentWeapon().reserve, currentWeapon().def.name);
  hud.setHealth(player.player.health, player.player.armor);
  paintTwiceThenReady();
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

syncCamera();
if (shot) {
  runShot(shot);
} else {
  hud.showOverlay('start');
  requestAnimationFrame(frame);
}

// A small read handle for play-testing and debugging in the browser console: the live
// round state, the player and the bots. It changes nothing about the game itself.
window.__emberline = {
  rounds, player, bots, combat, input, loadout,
  get simTime() { return elapsed; },
  get plantProgress() { return plantProgress; },
};
