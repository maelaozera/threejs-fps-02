
// Weapons: five guns and three grenades, one table both the player and the bots buy from.
// Damage is per body hit; a head shot multiplies it. Spread grows with movement and with
// sustained fire, so stopping to aim pays. Every gun has a view model built from boxes.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

export const WEAPONS = {
  pistol: {
    id: 'pistol', name: 'P9 Kestrel', kind: 'pistol', price: 0, damage: 30, headMult: 2.2,
    mag: 12, reserve: 36, rate: 0.16, reload: 1.4, auto: false, pellets: 1,
    spreadStill: 0.006, spreadMove: 0.03, range: 60, zoom: 1,
  },
  smg: {
    id: 'smg', name: 'VEX-9', kind: 'smg', price: 1500, damage: 21, headMult: 2,
    mag: 30, reserve: 120, rate: 0.075, reload: 1.8, auto: true, pellets: 1,
    spreadStill: 0.009, spreadMove: 0.045, range: 55, zoom: 1,
  },
  rifle: {
    id: 'rifle', name: 'AR-77 Longshot', kind: 'rifle', price: 2700, damage: 33, headMult: 2.5,
    mag: 30, reserve: 90, rate: 0.1, reload: 2.1, auto: true, pellets: 1,
    spreadStill: 0.003, spreadMove: 0.028, range: 80, zoom: 1.25,
  },
  sniper: {
    id: 'sniper', name: 'DUSK-50', kind: 'sniper', price: 4750, damage: 92, headMult: 2.2,
    mag: 5, reserve: 15, rate: 1.15, reload: 3.0, auto: false, pellets: 1,
    spreadStill: 0.0008, spreadMove: 0.05, range: 100, zoom: 2.6,
  },
  shotgun: {
    id: 'shotgun', name: 'BR-12 Breacher', kind: 'shotgun', price: 1700, damage: 12, headMult: 1.8,
    mag: 6, reserve: 24, rate: 0.85, reload: 2.6, auto: false, pellets: 8,
    spreadStill: 0.016, spreadMove: 0.05, range: 30, zoom: 1,
  },
};

export const GRENADES = {
  frag: { id: 'frag', name: 'Frag Charge', price: 300, max: 2 },
  smoke: { id: 'smoke', name: 'Smoke Canister', price: 300, max: 2 },
  flash: { id: 'flash', name: 'Flash Cell', price: 200, max: 2 },
};

export const ARMOR_PRICE = 650;
export const ARMOR_REDUCTION = 0.5; // Armoured targets take half damage from body hits.

// A low-poly view model: receiver, barrel, stock and grip in the yard's palette, plus a
// muzzle flash plane and a point light that fires for one frame of light.
export function createViewModel(camera, def) {
  const dark = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.hairline), roughness: 0.65, metalness: 0.25 });
  const metal = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.ink), roughness: 0.45, metalness: 0.4 });
  const accent = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.accent), roughness: 0.5, metalness: 0.2 });

  const model = new THREE.Group();
  const scale = def.kind === 'sniper' ? 1.25 : def.kind === 'shotgun' ? 1.1 : 1;
  const receiver = new THREE.Mesh(new THREE.BoxGeometry(0.09 * scale, 0.1, 0.42 * scale), metal);
  const barrel = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.045, 0.42 * scale), dark);
  barrel.position.set(0, 0.025, -0.4 * scale);
  const stock = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.08, 0.22), dark);
  stock.position.set(0, -0.02, 0.3);
  const grip = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.12, 0.07), accent);
  grip.position.set(0, -0.09, 0.12);
  model.add(receiver, barrel, stock, grip);
  if (def.kind === 'sniper') {
    const scope = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.22, 10), dark);
    scope.rotation.x = Math.PI / 2;
    scope.position.set(0, 0.09, -0.05);
    model.add(scope);
  }
  if (def.kind === 'shotgun') {
    const pump = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.06, 0.18), accent);
    pump.position.set(0, -0.03, -0.3);
    model.add(pump);
  }
  model.position.set(0.24, -0.2, -0.42);
  camera.add(model);

  const flash = new THREE.Mesh(
    new THREE.PlaneGeometry(0.2, 0.2),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.accent), transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide }),
  );
  flash.position.set(0.24, -0.18, -0.98);
  flash.visible = false;
  camera.add(flash);

  const flashLight = new THREE.PointLight(new THREE.Color(PALETTE.accent), 0, 6);
  flashLight.position.set(0.24, -0.16, -0.6);
  camera.add(flashLight);

  return { model, flash, flashLight };
}

// One weapon instance: magazine, cooldown, reload timer and recoil state. main.js and the
// bots share this shape; only the view model is player-only.
export function createWeaponState(def) {
  return {
    def,
    mag: def.mag,
    reserve: def.reserve,
    cooldown: 0,
    reloadLeft: 0,
    flashLeft: 0,
    kick: 0,
    bloom: 0,
  };
}

export function weaponStep(state, dt, view) {
  state.cooldown = Math.max(0, state.cooldown - dt);
  state.flashLeft = Math.max(0, state.flashLeft - dt);
  state.bloom = Math.max(0, state.bloom - dt * 0.045);
  state.kick += (0 - state.kick) * Math.min(1, dt * 14);
  if (view) {
    view.model.position.z = -0.42 + state.kick;
    view.model.rotation.x = state.kick * 2.2;
    view.flash.visible = state.flashLeft > 0;
    view.flash.rotation.z = state.flashLeft * 30;
    view.flashLight.intensity = state.flashLeft > 0 ? 18 : 0;
    if (state.reloadLeft > 0) {
      view.model.rotation.x = -0.55 * Math.min(1, (state.def.reload - state.reloadLeft) * 2);
    }
  }
  if (state.reloadLeft > 0) {
    state.reloadLeft = Math.max(0, state.reloadLeft - dt);
    if (state.reloadLeft === 0) {
      const need = state.def.mag - state.mag;
      const take = Math.min(need, state.reserve);
      state.mag += take;
      state.reserve -= take;
    }
  }
}

export function weaponReady(state) {
  return state.mag > 0 && state.cooldown === 0 && state.reloadLeft === 0;
}

export function weaponFire(state) {
  if (state.mag <= 0) return false;
  state.mag -= 1;
  state.cooldown = state.def.rate;
  state.flashLeft = 0.06;
  state.kick = state.def.kind === 'sniper' ? 0.09 : state.def.kind === 'shotgun' ? 0.08 : 0.05;
  state.bloom = Math.min(0.05, state.bloom + (state.def.kind === 'smg' ? 0.006 : 0.004));
  return true;
}

export function weaponReload(state) {
  if (state.reloadLeft > 0 || state.mag === state.def.mag || state.reserve === 0) return false;
  state.reloadLeft = state.def.reload;
  return true;
}

export function weaponSpread(state, speed, scoped) {
  const def = state.def;
  const moving = Math.min(1, speed / 5.2) * def.spreadMove;
  const scopedFactor = scoped ? 0.35 : 1;
  return (def.spreadStill + moving + state.bloom) * scopedFactor;
}
