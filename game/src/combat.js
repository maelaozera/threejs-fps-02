// Combat: hitscan shots, tracers, impact particles and thrown grenades. Shots are rays
// against the world's shootables and every registered damageable's hit meshes; damage is
// delivered through the damageable's own applyDamage, so the player and the bots share one
// path. Tracers and particles are pooled — nothing is allocated per frame in a firefight.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

const TRACER_COUNT = 24;
const PARTICLE_COUNT = 320;
const SMOKE_DURATION = 12;
const FRAG_RADIUS = 7;
const FRAG_MAX_DAMAGE = 110;

export function createCombat(scene, world, audio) {
  const raycaster = new THREE.Raycaster();
  const damageables = [];
  const grenades = [];
  const smokes = [];
  const tmp = new THREE.Vector3();
  const tmp2 = new THREE.Vector3();

  // --- Tracers: a pool of fading lines from muzzle to hit point. ---
  const tracers = [];
  for (let i = 0; i < TRACER_COUNT; i += 1) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
    const material = new THREE.LineBasicMaterial({ color: new THREE.Color(PALETTE.accent), transparent: true, opacity: 0 });
    const line = new THREE.Line(geometry, material);
    line.frustumCulled = false;
    scene.add(line);
    tracers.push({ line, life: 0 });
  }
  let tracerIndex = 0;

  function spawnTracer(from, to) {
    const tracer = tracers[tracerIndex];
    tracerIndex = (tracerIndex + 1) % TRACER_COUNT;
    const positions = tracer.line.geometry.attributes.position.array;
    positions[0] = from.x; positions[1] = from.y; positions[2] = from.z;
    positions[3] = to.x; positions[4] = to.y; positions[5] = to.z;
    tracer.line.geometry.attributes.position.needsUpdate = true;
    tracer.life = 0.09;
    tracer.line.material.opacity = 0.85;
  }

  // --- Particles: one Points cloud, slots recycled, used for sparks, smoke and blood. ---
  const particleGeometry = new THREE.BufferGeometry();
  const particlePositions = new Float32Array(PARTICLE_COUNT * 3);
  const particleColors = new Float32Array(PARTICLE_COUNT * 3);
  particleGeometry.setAttribute('position', new THREE.BufferAttribute(particlePositions, 3));
  particleGeometry.setAttribute('color', new THREE.BufferAttribute(particleColors, 3));
  const particleMaterial = new THREE.PointsMaterial({ size: 0.09, vertexColors: true, transparent: true, opacity: 0.95, depthWrite: false });
  const points = new THREE.Points(particleGeometry, particleMaterial);
  points.frustumCulled = false;
  scene.add(points);
  const particles = [];
  for (let i = 0; i < PARTICLE_COUNT; i += 1) {
    particles.push({ alive: false, x: 0, y: -100, z: 0, vx: 0, vy: 0, vz: 0, life: 0, maxLife: 1, r: 1, g: 1, b: 1 });
    particlePositions[i * 3 + 1] = -100;
  }
  let particleIndex = 0;

  function spawnParticle(x, y, z, vx, vy, vz, life, r, g, b) {
    const particle = particles[particleIndex];
    particleIndex = (particleIndex + 1) % PARTICLE_COUNT;
    particle.alive = true;
    particle.x = x; particle.y = y; particle.z = z;
    particle.vx = vx; particle.vy = vy; particle.vz = vz;
    particle.life = life; particle.maxLife = life;
    particle.r = r; particle.g = g; particle.b = b;
  }

  function burst(point, normal, count, speed, life, color) {
    const c = new THREE.Color(color);
    for (let i = 0; i < count; i += 1) {
      const angle = Math.random() * Math.PI * 2;
      const up = Math.random() * 0.8 + 0.2;
      spawnParticle(
        point.x, point.y, point.z,
        normal.x * speed * 0.4 + Math.cos(angle) * speed * 0.6,
        up * speed,
        normal.z * speed * 0.4 + Math.sin(angle) * speed * 0.6,
        life * (0.6 + Math.random() * 0.6),
        c.r, c.g, c.b,
      );
    }
  }

  function stepParticles(dt) {
    for (let i = 0; i < PARTICLE_COUNT; i += 1) {
      const particle = particles[i];
      if (!particle.alive) continue;
      particle.life -= dt;
      if (particle.life <= 0) {
        particle.alive = false;
        particlePositions[i * 3 + 1] = -100;
        particleColors[i * 3] = 0; particleColors[i * 3 + 1] = 0; particleColors[i * 3 + 2] = 0;
        continue;
      }
      particle.vy -= 9 * dt;
      particle.x += particle.vx * dt;
      particle.y += particle.vy * dt;
      particle.z += particle.vz * dt;
      if (particle.y < 0.02) { particle.y = 0.02; particle.vy = 0; particle.vx *= 0.6; particle.vz *= 0.6; }
      const fade = particle.life / particle.maxLife;
      particlePositions[i * 3] = particle.x;
      particlePositions[i * 3 + 1] = particle.y;
      particlePositions[i * 3 + 2] = particle.z;
      particleColors[i * 3] = particle.r * fade;
      particleColors[i * 3 + 1] = particle.g * fade;
      particleColors[i * 3 + 2] = particle.b * fade;
    }
    particleGeometry.attributes.position.needsUpdate = true;
    particleGeometry.attributes.color.needsUpdate = true;
  }

  function stepTracers(dt) {
    for (const tracer of tracers) {
      if (tracer.life <= 0) continue;
      tracer.life -= dt;
      tracer.line.material.opacity = Math.max(0, tracer.life / 0.09) * 0.85;
    }
  }

  // --- Shots and damage. ---
  function registerDamageable(entry) {
    damageables.push(entry);
  }

  function allShootables() {
    const list = world.shootables;
    for (const entry of damageables) list.push(...entry.meshes);
    return list;
  }

  // Fires one hitscan pellet. Returns the hit record or null. The caller owns damage and
  // feedback; this function only finds what the ray met first.
  function firePellet(origin, direction, range) {
    raycaster.set(origin, direction);
    raycaster.far = range;
    const hits = raycaster.intersectObjects(allShootables(), false);
    const hit = hits[0] ?? null;
    if (!hit) return null;
    const target = hit.object.userData.damageable ?? null;
    return { point: hit.point, normal: hit.face?.normal ?? tmp2.set(0, 1, 0), target, part: hit.object.userData.part ?? 'body', distance: hit.distance };
  }

  // --- Grenades. ---
  const grenadeGeometry = new THREE.SphereGeometry(0.09, 10, 8);
  const grenadeMaterials = {
    frag: new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.ember), roughness: 0.5, metalness: 0.3 }),
    smoke: new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.muted), roughness: 0.6, metalness: 0.2 }),
    flash: new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.accent), roughness: 0.4, metalness: 0.3 }),
  };

  function throwGrenade(kind, origin, direction, thrower) {
    const mesh = new THREE.Mesh(grenadeGeometry, grenadeMaterials[kind]);
    mesh.position.copy(origin);
    mesh.castShadow = true;
    scene.add(mesh);
    grenades.push({
      kind, mesh, thrower,
      velocity: new THREE.Vector3(direction.x * 13, direction.y * 13 + 3.5, direction.z * 13),
      fuse: kind === 'frag' ? 1.6 : kind === 'flash' ? 1.1 : 1.4,
      bounced: 0,
    });
  }

  function explodeFrag(position, thrower, onDamage) {
    audio.explosion();
    burst(position, new THREE.Vector3(0, 1, 0), 42, 7, 0.9, PALETTE.accent);
    burst(position, new THREE.Vector3(0, 1, 0), 20, 4, 1.2, PALETTE.ember);
    const flash = new THREE.PointLight(new THREE.Color(PALETTE.accent), 120, 18, 1.6);
    flash.position.copy(position);
    scene.add(flash);
    setTimeout(() => scene.remove(flash), 120);
    for (const entry of damageables) {
      if (!entry.alive()) continue;
      const targetPos = entry.center();
      const distance = targetPos.distanceTo(position);
      if (distance > FRAG_RADIUS) continue;
      const damage = Math.round(FRAG_MAX_DAMAGE * (1 - distance / FRAG_RADIUS) + 10);
      onDamage(entry, damage, 'blast', thrower);
    }
  }

  function stepGrenades(dt, onDamage, onFlash, onSmoke) {
    for (let i = grenades.length - 1; i >= 0; i -= 1) {
      const grenade = grenades[i];
      grenade.fuse -= dt;
      grenade.velocity.y -= 12 * dt;
      const next = tmp.copy(grenade.mesh.position).addScaledVector(grenade.velocity, dt);
      if (next.y < 0.1) {
        next.y = 0.1;
        grenade.velocity.y = Math.abs(grenade.velocity.y) * 0.35;
        grenade.velocity.x *= 0.6;
        grenade.velocity.z *= 0.6;
      }
      // Cheap wall bounce: if the next spot is inside a collider, kill that axis' speed.
      const probe = new THREE.Box3().setFromObject(grenade.mesh);
      probe.translate(next.clone().sub(grenade.mesh.position));
      let blocked = false;
      for (const collider of world.colliders) {
        if (probe.intersectsBox(collider)) { blocked = true; break; }
      }
      if (blocked) {
        grenade.velocity.x *= -0.35;
        grenade.velocity.z *= -0.35;
        grenade.velocity.y *= 0.5;
        grenade.bounced += 1;
      } else {
        grenade.mesh.position.copy(next);
      }
      grenade.mesh.rotation.x += dt * 6;
      grenade.mesh.rotation.z += dt * 4;
      if (grenade.fuse > 0 && grenade.bounced < 6) continue;
      scene.remove(grenade.mesh);
      grenades.splice(i, 1);
      const position = grenade.mesh.position.clone();
      if (grenade.kind === 'frag') explodeFrag(position, grenade.thrower, onDamage);
      else if (grenade.kind === 'flash') onFlash(position, grenade.thrower);
      else if (grenade.kind === 'smoke') {
        smokes.push({ center: position.clone(), radius: 4.2, until: performance.now() / 1000 + SMOKE_DURATION });
        onSmoke(position);
        for (let j = 0; j < 26; j += 1) {
          spawnParticle(
            position.x + (Math.random() * 2 - 1) * 3, 0.4 + Math.random() * 2.2, position.z + (Math.random() * 2 - 1) * 3,
            (Math.random() * 2 - 1) * 0.4, 0.35 + Math.random() * 0.3, (Math.random() * 2 - 1) * 0.4,
            2.5 + Math.random() * 2, 0.55, 0.58, 0.62,
          );
        }
      }
    }
    const now = performance.now() / 1000;
    for (let i = smokes.length - 1; i >= 0; i -= 1) {
      if (smokes[i].until < now) smokes.splice(i, 1);
    }
  }

  // Does the segment from eye A to eye B pass through any live smoke cloud?
  function smoked(from, to) {
    const now = performance.now() / 1000;
    for (const smoke of smokes) {
      if (smoke.until < now) continue;
      // Closest approach of the segment to the cloud centre, in the XZ plane.
      const dx = to.x - from.x;
      const dz = to.z - from.z;
      const lengthSq = dx * dx + dz * dz;
      let t = lengthSq === 0 ? 0 : ((smoke.center.x - from.x) * dx + (smoke.center.z - from.z) * dz) / lengthSq;
      t = Math.max(0, Math.min(1, t));
      const cx = from.x + dx * t;
      const cz = from.z + dz * t;
      const distance = Math.hypot(smoke.center.x - cx, smoke.center.z - cz);
      if (distance < smoke.radius) return true;
    }
    return false;
  }

  function step(dt, onDamage, onFlash, onSmoke) {
    stepTracers(dt);
    stepParticles(dt);
    stepGrenades(dt, onDamage, onFlash, onSmoke);
  }

  return {
    registerDamageable, firePellet, spawnTracer, burst, throwGrenade, smoked, step,
    grenadeCount: () => grenades.length,
  };
}
