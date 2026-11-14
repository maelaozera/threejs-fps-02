// The player: a body from the shared physics, a health pool, and the look/recoil that
// turns mouse movement into a camera. Movement is acceleration-based with crouch and jump;
// spread punishes firing on the move, so stopping to aim pays.
import * as THREE from 'three';
import { createBody } from './physics.js';

export function createPlayer(colliders, spawn) {
  const mover = createBody(colliders, spawn, { walkSpeed: 5.2 });
  const body = mover.body;
  const player = {
    health: 100,
    armor: false,
    alive: true,
    flashUntil: 0,
    lastDamageAt: -100,
  };

  function look(dx, dy, sensitivity = 0.0022) {
    body.yaw -= dx * sensitivity;
    body.pitch = Math.max(-1.45, Math.min(1.45, body.pitch - dy * sensitivity));
  }

  function recoil(pitchKick, yawKick) {
    body.pitch = Math.min(1.45, body.pitch + pitchKick);
    body.yaw += yawKick;
  }

  function step(dt, keys) {
    const crouching = keys.has('ControlLeft') || keys.has('ControlRight') || keys.has('KeyC');
    const forward = (keys.has('KeyW') ? 1 : 0) - (keys.has('KeyS') ? 1 : 0);
    const strafe = (keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0);
    let wishX = 0;
    let wishZ = 0;
    if (forward || strafe) {
      const sin = Math.sin(body.yaw);
      const cos = Math.cos(body.yaw);
      const length = Math.hypot(-sin * forward + cos * strafe, -cos * forward - sin * strafe);
      wishX = (-sin * forward + cos * strafe) / length;
      wishZ = (-cos * forward - sin * strafe) / length;
    }
    mover.step(dt, wishX, wishZ, keys.has('Space'), crouching);
  }

  function eyePosition(out) {
    out.set(body.position.x, body.position.y + body.eye, body.position.z);
    return out;
  }

  function center(out) {
    out.set(body.position.x, body.position.y + 1.1, body.position.z);
    return out;
  }

  function damage(amount, part) {
    if (!player.alive) return false;
    let final = amount;
    if (player.armor && part !== 'head') final *= 0.5;
    player.health -= final;
    player.lastDamageAt = performance.now() / 1000;
    if (player.health > 0) return false;
    player.health = 0;
    player.alive = false;
    return true;
  }

  function reset(spawn) {
    body.position.set(spawn.x, 0, spawn.z);
    body.velocity.set(0, 0, 0);
    body.yaw = 0;
    body.pitch = 0;
    player.health = 100;
    player.alive = true;
    player.flashUntil = 0;
  }

  return {
    body, mover, player,
    step, look, recoil, eyePosition, center, damage, reset,
    groundSpeed: () => mover.groundSpeed(),
  };
}
