// Bots: five Raiders who hold the sites and four Vanguard teammates who push with the
// player. Each bot walks a waypoint graph (BFS), holds a position, investigates gunfire it
// hears, and fights with the same hitscan weapons the player uses: a reaction delay, burst
// fire, and an aim error that grows with distance and target speed. Raiders converge on a
// planted charge and try to defuse it; Vanguard bots cover the planter.
import * as THREE from 'three';
import { PALETTE, TEAM_COLORS } from './palette.js';
import { WAYPOINTS, SITES } from './world.js';
import { createBody } from './physics.js';
import { WEAPONS, createWeaponState, weaponStep, weaponReady, weaponFire, weaponSpread } from './weapons.js';

const VANGUARD_NAMES = ['Wren', 'Heron', 'Falcon', 'Kite'];
const RAIDER_NAMES = ['Ember', 'Cinder', 'Ash', 'Flint', 'Soot'];
const REACTION_MIN = 0.28;
const REACTION_MAX = 0.55;
const VISION_RANGE = 46;
const HEAR_RANGE = 32;
const DEFUSE_TIME = 5;
const PLANT_TIME = 3.5;

function buildAdjacency() {
  const adjacency = WAYPOINTS.nodes.map(() => []);
  for (const [a, b] of WAYPOINTS.edges) {
    adjacency[a].push(b);
    adjacency[b].push(a);
  }
  return adjacency;
}
const ADJACENCY = buildAdjacency();

function nearestNode(x, z) {
  let best = 0;
  let bestDistance = Infinity;
  for (let i = 0; i < WAYPOINTS.nodes.length; i += 1) {
    const [nx, nz] = WAYPOINTS.nodes[i];
    const distance = (nx - x) * (nx - x) + (nz - z) * (nz - z);
    if (distance < bestDistance) { bestDistance = distance; best = i; }
  }
  return best;
}

// Breadth-first path over the waypoint graph, returned as a list of node indices.
function findPath(fromNode, toNode) {
  if (fromNode === toNode) return [toNode];
  const previous = new Array(WAYPOINTS.nodes.length).fill(-1);
  const queue = [fromNode];
  previous[fromNode] = fromNode;
  while (queue.length > 0) {
    const current = queue.shift();
    for (const next of ADJACENCY[current]) {
      if (previous[next] !== -1) continue;
      previous[next] = current;
      if (next === toNode) {
        const path = [toNode];
        let node = toNode;
        while (node !== fromNode) {
          node = previous[node];
          path.unshift(node);
        }
        return path;
      }
      queue.push(next);
    }
  }
  return [toNode];
}

function makeBotMesh(team) {
  const group = new THREE.Group();
  const suit = new THREE.MeshStandardMaterial({ color: new THREE.Color(team === 'vanguard' ? '#2e4a4a' : '#4a2e2e'), roughness: 0.8 });
  const accent = new THREE.MeshStandardMaterial({ color: new THREE.Color(TEAM_COLORS[team]), roughness: 0.5, emissive: new THREE.Color(TEAM_COLORS[team]), emissiveIntensity: 0.25 });
  const dark = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.hairline), roughness: 0.7 });

  const legs = new THREE.Group();
  const legL = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.62, 0.2), dark);
  legL.position.set(-0.11, 0.31, 0);
  const legR = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.62, 0.2), dark);
  legR.position.set(0.11, 0.31, 0);
  legs.add(legL, legR);

  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.54, 0.72, 0.32), suit);
  torso.position.y = 1.0;
  const vest = new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.3, 0.36), accent);
  vest.position.y = 1.08;
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.26, 0.26), dark);
  head.position.y = 1.52;
  const visor = new THREE.Mesh(new THREE.BoxGeometry(0.27, 0.08, 0.05), accent);
  visor.position.set(0, 1.54, -0.14);
  const gun = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.09, 0.62), dark);
  gun.position.set(0.28, 1.05, -0.28);

  torso.userData.part = 'torso';
  head.userData.part = 'head';
  group.add(legs, torso, vest, head, visor, gun);
  group.traverse((mesh) => {
    if (mesh.isMesh) { mesh.castShadow = true; }
  });
  return { group, torso, head, legs, legL, legR };
}

export function createBots(scene, world, combat, audio) {
  const raycaster = new THREE.Raycaster();
  raycaster.far = 60;
  const bots = [];
  const tmp = new THREE.Vector3();

  function hasLineOfSight(from, to) {
    if (combat.smoked(from, to)) return false;
    tmp.copy(to).sub(from);
    const distance = tmp.length();
    if (distance > VISION_RANGE) return false;
    tmp.normalize();
    raycaster.set(from, tmp);
    raycaster.far = distance;
    const hits = raycaster.intersectObjects(world.shootables, false);
    return hits.length === 0;
  }

  function spawnBot(team, name, spawn, weaponId, role) {
    const meshes = makeBotMesh(team);
    meshes.group.position.set(spawn[0], 0, spawn[1]);
    scene.add(meshes.group);
    const mover = createBody(world.colliders, { x: spawn[0], z: spawn[1] }, { walkSpeed: 4.6 });
    const bot = {
      team, name, role, weaponId,
      body: mover.body,
      mover,
      meshes,
      weapon: createWeaponState(WEAPONS[weaponId]),
      health: 100,
      armor: false,
      alive: true,
      state: 'advance',
      site: role === 'defendA' ? 'A' : role === 'defendB' ? 'B' : null,
      holdNode: null,
      path: [],
      pathIndex: 0,
      target: null,
      lastSeen: null,
      lastSeenAt: -100,
      reactionAt: 0,
      burstLeft: 0,
      burstGap: 0,
      strafeDir: 1,
      strafeAt: 0,
      investigatePos: null,
      investigateUntil: 0,
      defuseProgress: 0,
      plantProgress: 0,
      carrying: false,
      walkPhase: Math.random() * 6,
      fall: 0,
      flashUntil: 0,
      kills: 0,
    };
    meshes.torso.userData.damageable = bot;
    meshes.head.userData.damageable = bot;
    bot.hitMeshes = [meshes.torso, meshes.head];
    bot.center = () => tmp.set(bot.body.position.x, bot.body.position.y + 1.1, bot.body.position.z);
    bot.isAlive = () => bot.alive;
    combat.registerDamageable({ name: bot.name, meshes: bot.hitMeshes, alive: () => bot.alive, center: () => bot.center(), apply: (amount, part, shooter) => damageBot(bot, amount, part, shooter) });
    bots.push(bot);
    return bot;
  }

  function damageBot(bot, amount, part, shooter) {
    if (!bot.alive) return false;
    // amount already carries the attacker's head-shot multiplier; armour halves body hits.
    let final = amount;
    if (bot.armor && part !== 'head') final *= 0.5;
    bot.health -= final;
    if (bot.health > 0) return false;
    bot.health = 0;
    bot.alive = false;
    bot.fall = 0;
    if (bot.carrying) bot.carrying = false;
    return true;
  }

  // --- Team setup for a round. ---
  function setupRound(roundNumber, random) {
    // Clear old bots from the scene.
    for (const bot of bots) scene.remove(bot.meshes.group);
    bots.length = 0;
    const vanguardLoadouts = ['rifle', 'rifle', 'smg', 'shotgun'];
    const raiderLoadouts = ['rifle', 'rifle', 'smg', 'sniper', 'shotgun'];
    const raiderRoles = ['defendA', 'defendA', 'defendB', 'defendB', 'roam'];
    for (let i = 0; i < 4; i += 1) {
      const bot = spawnBot('vanguard', VANGUARD_NAMES[i], { x: -6 + i * 4, z: 18 }, vanguardLoadouts[i], 'attack');
      bot.site = random() < 0.55 ? 'A' : 'B';
      bot.holdNode = bot.site === 'A' ? 12 : 14;
    }
    for (let i = 0; i < 5; i += 1) {
      const spawn = { x: -20 + i * 10, z: -17 };
      const bot = spawnBot('raiders', RAIDER_NAMES[i], spawn, raiderLoadouts[i], raiderRoles[i]);
      bot.holdNode = raiderRoles[i] === 'defendA' ? 15 : raiderRoles[i] === 'defendB' ? 16 : 13;
      bot.path = findPath(nearestNode(bot.body.position.x, bot.body.position.z), bot.holdNode);
      bot.pathIndex = 0;
      bot.state = 'hold';
    }
    return bots;
  }

  // Can this bot see the enemy right now? FOV, range, smoke and a ray through the map.
  function canSee(bot, enemy, time) {
    const eye = new THREE.Vector3(bot.body.position.x, bot.body.position.y + bot.body.eye, bot.body.position.z);
    const target = enemy.center();
    const distance = eye.distanceTo(target);
    if (distance > VISION_RANGE) return false;
    const dx = target.x - eye.x;
    const dz = target.z - eye.z;
    const angleTo = Math.atan2(-dx, -dz);
    let diff = angleTo - bot.body.yaw;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    if (Math.abs(diff) > 1.15 && distance > 4) return false;
    if (!hasLineOfSight(eye, target)) return false;
    return true;
  }

  function hearShot(bot, position) {
    if (!bot.alive) return;
    const distance = Math.hypot(position.x - bot.body.position.x, position.z - bot.body.position.z);
    if (distance > HEAR_RANGE) return;
    if (bot.state === 'engage' || bot.state === 'defuse') return;
    bot.investigatePos = position.clone();
    bot.investigateUntil = performance.now() / 1000 + 4;
    if (bot.state === 'hold' || bot.state === 'advance') bot.state = 'investigate';
  }

  function blindBot(bot, until) {
    bot.flashUntil = Math.max(bot.flashUntil, until);
  }

  function stepBot(bot, dt, time, ctx) {
    const body = bot.body;
    if (!bot.alive) {
      bot.fall = Math.min(1, bot.fall + dt / 0.4);
      bot.meshes.group.rotation.x = -bot.fall * 1.45;
      return;
    }
    weaponStep(bot.weapon, dt, null);
    const blinded = time < bot.flashUntil;

    // --- Perception: the nearest enemy this bot can actually see. ---
    const enemies = bot.team === 'vanguard' ? ctx.raiders : ctx.vanguards;
    let visible = null;
    let visibleDistance = Infinity;
    if (!blinded) {
      for (const enemy of enemies) {
        if (!enemy.alive) continue;
        if (!canSee(bot, enemy, time)) continue;
        const distance = bot.body.position.distanceTo(enemy.center());
        if (distance < visibleDistance) { visibleDistance = distance; visible = enemy; }
      }
    }
    if (visible) {
      if (bot.target !== visible) {
        bot.target = visible;
        bot.reactionAt = time + REACTION_MIN + Math.random() * (REACTION_MAX - REACTION_MIN);
        bot.burstLeft = 0;
      }
      bot.lastSeen = visible.center().clone();
      bot.lastSeenAt = time;
    } else if (bot.target && time - bot.lastSeenAt > 1.2) {
      bot.target = null;
    }

    // --- Fight: bursts with gaps, aim error from distance, target speed and movement. ---
    let wishX = 0;
    let wishZ = 0;
    let facingYaw = body.yaw;
    if (bot.target && visible && time >= bot.reactionAt && weaponReady(bot.weapon)) {
      if (bot.burstLeft <= 0) {
        bot.burstLeft = bot.weaponId === 'sniper' ? 1 : 3 + Math.floor(Math.random() * 3);
        bot.burstGap = 0;
      }
      if (bot.burstGap <= 0 && bot.burstLeft > 0) {
        const target = bot.target;
        const aim = target.center().clone();
        const targetSpeed = target.body ? Math.hypot(target.body.velocity.x, target.body.velocity.z) : 0;
        const error = 0.012 + visibleDistance * 0.0011 + targetSpeed * 0.006 + bot.mover.groundSpeed() * 0.004;
        aim.x += (Math.random() * 2 - 1) * error * visibleDistance;
        aim.y += (Math.random() * 2 - 1) * error * visibleDistance * 0.6;
        aim.z += (Math.random() * 2 - 1) * error * visibleDistance;
        // One in seven aimed shots goes for the head.
        if (Math.random() < 0.14) aim.y = target.center().y + 0.42;
        ctx.onBotShoot(bot, aim, target);
        weaponFire(bot.weapon);
        bot.burstLeft -= 1;
        bot.burstGap = bot.weapon.def.rate * (bot.weaponId === 'sniper' ? 4 : 1);
        if (bot.burstLeft <= 0) bot.burstGap = 0.5 + Math.random() * 0.7;
      } else {
        bot.burstGap -= dt;
      }
      // Strafe while fighting so the bot is not a still target.
      if (time > bot.strafeAt) {
        bot.strafeAt = time + 0.7 + Math.random() * 0.8;
        bot.strafeDir = Math.random() < 0.5 ? -1 : 1;
      }
      const dx = bot.target.center().x - body.position.x;
      const dz = bot.target.center().z - body.position.z;
      facingYaw = Math.atan2(-dx, -dz);
      const strafeX = Math.cos(facingYaw) * bot.strafeDir;
      const strafeZ = -Math.sin(facingYaw) * bot.strafeDir;
      wishX = strafeX * 0.5;
      wishZ = strafeZ * 0.5;
    } else if (bot.burstGap > 0) {
      bot.burstGap -= dt;
    }

    // --- Objectives: plant, defuse, converge, investigate, hold. ---
    const bomb = ctx.bomb;
    let goalNode = bot.holdNode;
    if (bot.team === 'raiders') {
      if (bomb.planted) {
        goalNode = bomb.site === 'A' ? 15 : 16;
        const bombPos = bomb.position;
        const distanceToBomb = Math.hypot(bombPos.x - body.position.x, bombPos.z - body.position.z);
        if (distanceToBomb < 2.6 && !visible) {
          bot.state = 'defuse';
          bot.defuseProgress += dt;
          ctx.onDefuseProgress(bot, bot.defuseProgress / DEFUSE_TIME);
          if (bot.defuseProgress >= DEFUSE_TIME) ctx.onDefuseDone(bot);
          wishX = 0; wishZ = 0;
        } else {
          bot.state = 'advance';
        }
      } else if (bot.state === 'investigate' && bot.investigatePos && time < bot.investigateUntil) {
        goalNode = nearestNode(bot.investigatePos.x, bot.investigatePos.z);
      } else if (bot.state === 'investigate') {
        bot.state = 'hold';
        goalNode = bot.holdNode;
      }
    } else {
      // Vanguard: push the chosen site; the carrier plants, the rest cover.
      if (bomb.planted) {
        goalNode = bomb.site === 'A' ? 15 : 16;
      } else if (bot.carrying) {
        const site = SITES[bot.site];
        const distanceToSite = Math.hypot(site.center.x - body.position.x, site.center.z - body.position.z);
        if (distanceToSite < 3.2 && !visible) {
          bot.state = 'plant';
          bot.plantProgress += dt;
          ctx.onPlantProgress(bot, bot.plantProgress / PLANT_TIME);
          if (bot.plantProgress >= PLANT_TIME) ctx.onPlantDone(bot, bot.site);
          wishX = 0; wishZ = 0;
        } else {
          goalNode = bot.site === 'A' ? 15 : 16;
        }
      } else if (bot.state === 'investigate' && bot.investigatePos && time < bot.investigateUntil) {
        goalNode = nearestNode(bot.investigatePos.x, bot.investigatePos.z);
      } else {
        goalNode = bot.site === 'A' ? 12 : 14;
      }
    }

    // --- Walk the path when not fighting or working the objective. ---
    const workingObjective = bot.state === 'plant' || bot.state === 'defuse';
    if (!visible && !workingObjective) {
      const currentNode = nearestNode(body.position.x, body.position.z);
      if (bot.path.length === 0 || bot.path[bot.path.length - 1] !== goalNode) {
        bot.path = findPath(currentNode, goalNode);
        bot.pathIndex = 0;
      }
      if (bot.pathIndex < bot.path.length) {
        const [nx, nz] = WAYPOINTS.nodes[bot.path[bot.pathIndex]];
        const dx = nx - body.position.x;
        const dz = nz - body.position.z;
        const distance = Math.hypot(dx, dz);
        if (distance < 0.9) {
          bot.pathIndex += 1;
        } else {
          wishX = dx / distance;
          wishZ = dz / distance;
          facingYaw = Math.atan2(-wishX, -wishZ);
        }
      }
    }

    // --- Move, face, animate. ---
    bot.mover.step(dt, wishX, wishZ, false, false);
    let yawDiff = facingYaw - body.yaw;
    while (yawDiff > Math.PI) yawDiff -= Math.PI * 2;
    while (yawDiff < -Math.PI) yawDiff += Math.PI * 2;
    body.yaw += yawDiff * Math.min(1, dt * 10);
    const speed = bot.mover.groundSpeed();
    bot.walkPhase += dt * speed * 1.6;
    const swing = Math.sin(bot.walkPhase) * Math.min(1, speed / 4) * 0.5;
    bot.meshes.legL.rotation.x = swing;
    bot.meshes.legR.rotation.x = -swing;
    bot.meshes.group.position.set(body.position.x, body.position.y, body.position.z);
    bot.meshes.group.rotation.y = body.yaw;
    bot.meshes.group.rotation.x = 0;
  }

  function step(dt, time, ctx) {
    for (const bot of bots) stepBot(bot, dt, time, ctx);
  }

  function aliveCount(team) {
    return bots.filter((bot) => bot.team === team && bot.alive).length;
  }

  return { bots, setupRound, step, hearShot, blindBot, aliveCount, hasLineOfSight, nearestNode, damageBot };
}
