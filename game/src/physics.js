// Shared body physics: an axis-aligned capsule (a box probe) pushed through the world's
// colliders one axis at a time, so walls never swallow a mover and corners slide. The
// player and every bot use the same mover; only the wish direction differs.
import * as THREE from 'three';

const RADIUS = 0.34;
const GRAVITY = 20;

export function createBody(colliders, spawn, opts = {}) {
  const body = {
    position: new THREE.Vector3(spawn.x, 0, spawn.z),
    velocity: new THREE.Vector3(),
    yaw: opts.yaw ?? 0,
    pitch: 0,
    eye: opts.eye ?? 1.6,
    height: opts.height ?? 1.72,
    crouchHeight: opts.crouchHeight ?? 1.12,
    onGround: true,
    crouching: false,
    walkSpeed: opts.walkSpeed ?? 5.2,
    crouchSpeed: opts.crouchSpeed ?? 2.4,
    accel: opts.accel ?? 42,
  };
  const probe = new THREE.Box3();

  function overlaps(x, y, z, height, lift) {
    probe.min.set(x - RADIUS, y + lift, z - RADIUS);
    probe.max.set(x + RADIUS, y + height - lift, z + RADIUS);
    for (let index = 0; index < colliders.length; index += 1) {
      if (probe.intersectsBox(colliders[index])) return colliders[index];
    }
    return null;
  }

  // wishX/wishZ is a unit (or zero) horizontal direction in world space. jump and crouch
  // are booleans. Returns nothing; body.position and body.velocity are updated in place.
  function step(dt, wishX, wishZ, jump, crouch) {
    if (crouch && !body.crouching) {
      body.crouching = true;
      body.height = body.crouchHeight;
    } else if (!crouch && body.crouching && !overlaps(body.position.x, body.position.y, body.position.z, 1.72, 0.02)) {
      body.crouching = false;
      body.height = 1.72;
    }
    const eyeTarget = body.crouching ? 1.02 : 1.6;
    body.eye += (eyeTarget - body.eye) * Math.min(1, dt * 12);

    const speed = body.crouching ? body.crouchSpeed : body.walkSpeed;
    const blend = Math.min(1, ((body.onGround ? body.accel : 9) * dt) / speed);
    body.velocity.x += (wishX * speed - body.velocity.x) * blend;
    body.velocity.z += (wishZ * speed - body.velocity.z) * blend;
    if (body.onGround && wishX === 0 && wishZ === 0) {
      const damp = Math.max(0, 1 - 9 * dt);
      body.velocity.x *= damp;
      body.velocity.z *= damp;
    }
    if (jump && body.onGround) {
      body.velocity.y = 6.2;
      body.onGround = false;
    }
    body.velocity.y -= GRAVITY * dt;

    const nextX = body.position.x + body.velocity.x * dt;
    if (!overlaps(nextX, body.position.y, body.position.z, body.height, 0.04)) body.position.x = nextX;
    else body.velocity.x = 0;
    const nextZ = body.position.z + body.velocity.z * dt;
    if (!overlaps(body.position.x, body.position.y, nextZ, body.height, 0.04)) body.position.z = nextZ;
    else body.velocity.z = 0;

    body.position.y += body.velocity.y * dt;
    body.onGround = false;
    const hit = overlaps(body.position.x, body.position.y, body.position.z, body.height, 0);
    if (hit && body.velocity.y <= 0) {
      body.position.y = hit.max.y;
      body.velocity.y = 0;
      body.onGround = true;
    } else if (hit) {
      body.position.y = hit.min.y - body.height;
      body.velocity.y = 0;
    }
    if (body.position.y < 0) {
      body.position.y = 0;
      body.velocity.y = 0;
      body.onGround = true;
    }
    body.velocity.y = Math.max(-30, body.velocity.y);
  }

  function groundSpeed() {
    return Math.hypot(body.velocity.x, body.velocity.z);
  }

  return { body, step, groundSpeed, overlaps };
}
