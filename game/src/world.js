// Kestrel Yard: an original dusk container yard, 56 x 44 m. Vanguard (the player's team)
// spawns south and pushes north through three lanes — West Alley, Mid Stack and East Yard
// — to plant the Surge Charge at Site A (the Depot, west) or Site B (the Crane, east).
// Raiders hold the sites. Every box is a collider and a bullet stop; crates are low enough
// to crouch behind, containers split sightlines, and the mid stack forces a choice of lane.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

export const SITES = {
  A: { name: 'Depot', center: new THREE.Vector3(-20, 0, -13), radius: 4.5 },
  B: { name: 'Crane', center: new THREE.Vector3(20, 0, -13), radius: 4.5 },
};

export const SPAWNS = {
  vanguard: [
    [-6, 18], [0, 19], [6, 18], [-12, 16], [12, 16],
  ],
  raiders: [
    [-20, -17], [-8, -18], [0, -19], [8, -18], [20, -17],
  ],
};

// Waypoint graph the bots walk: nodes are (x, z), edges are pairs of node indices.
export const WAYPOINTS = {
  nodes: [
    [-6, 18], [0, 19], [6, 18], [-12, 16], [12, 16], // 0-4 attacker spawn
    [-14, 8], [0, 10], [14, 8], // 5-7 south lanes
    [-16, 0], [-8, 2], [8, 2], [16, 0], // 8-11 mid lanes
    [-20, -6], [0, -2], [20, -6], // 12-14 north approach
    [-20, -13], [20, -13], // 15-16 sites A, B
    [-8, -14], [8, -14], // 17-18 defender mid
    [-24, -4], [24, -4], // 19-20 far flanks
    [-14, -16], [14, -16], // 21-22 defender back
    [0, -18], [-26, 10], [26, 10], // 23-25 back / south flanks
  ],
  edges: [
    [0, 5], [1, 6], [2, 7], [3, 5], [4, 7], [0, 1], [1, 2], [3, 0], [2, 4],
    [5, 8], [6, 9], [6, 10], [7, 11], [5, 9], [7, 10],
    [8, 12], [9, 13], [10, 13], [11, 14], [8, 19], [11, 20],
    [12, 15], [14, 16], [12, 17], [14, 18], [13, 17], [13, 18],
    [15, 21], [16, 22], [17, 21], [18, 22], [17, 23], [18, 23],
    [19, 12], [20, 14], [19, 24], [20, 25], [5, 24], [7, 25],
    [9, 12], [10, 14], [6, 13], [8, 9], [10, 11], [21, 23], [22, 23],
  ],
};

export function createWorld(scene) {
  const group = new THREE.Group();
  scene.add(group);

  const materials = {};
  for (const name of Object.keys(PALETTE)) {
    materials[name] = new THREE.MeshStandardMaterial({
      color: new THREE.Color(PALETTE[name]),
      roughness: name === 'accent' || name === 'ink' ? 0.55 : 0.92,
      metalness: name === 'hairline' || name === 'surface' ? 0.25 : 0.03,
    });
  }
  // The two site plates glow so a player reads the objective at a glance.
  const plateA = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.teal), emissive: new THREE.Color(PALETTE.teal), emissiveIntensity: 0.55, roughness: 0.6 });
  const plateB = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.ember), emissive: new THREE.Color(PALETTE.ember), emissiveIntensity: 0.55, roughness: 0.6 });

  const colliders = [];
  const shootables = [];
  const minimapWalls = [];

  function box(width, height, depth, x, y, z, material, minimap = true) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), materials[material]);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    colliders.push(new THREE.Box3().setFromObject(mesh));
    shootables.push(mesh);
    if (minimap) minimapWalls.push({ x, z, w: width, d: depth });
    return mesh;
  }

  // Ground and perimeter: a yard closed on four sides, open to a dusk sky.
  box(57, 0.4, 45, 0, -0.2, 0, 'ground');
  box(0.6, 5, 45, -28.3, 2.5, 0, 'surface');
  box(0.6, 5, 45, 28.3, 2.5, 0, 'surface');
  box(57, 5, 0.6, 0, 2.5, -22.3, 'surface');
  box(57, 5, 0.6, 0, 2.5, 22.3, 'surface');

  // Mid Stack: two tall containers with a gap between them, the yard's central decision.
  box(7, 2.6, 2.6, -5.4, 1.3, 0, 'containerA');
  box(7, 2.6, 2.6, -5.4, 3.9, 0, 'containerB');
  box(7, 2.6, 2.6, 5.4, 1.3, 0, 'containerB');
  box(7, 2.6, 2.6, 5.4, 3.9, 0, 'containerC');

  // West Alley and East Yard cover: crates to crouch behind, barrels to peek over.
  box(2.2, 1.1, 2.2, -14, 0.55, 6, 'crate');
  box(2.2, 1.1, 2.2, -16, 0.55, -2, 'crate');
  box(1.4, 1.0, 1.4, -10, 0.5, -6, 'crate');
  box(2.2, 1.1, 2.2, 14, 0.55, 6, 'crate');
  box(2.2, 1.1, 2.2, 16, 0.55, -2, 'crate');
  box(1.4, 1.0, 1.4, 10, 0.5, -6, 'crate');
  box(3.4, 1.1, 1.2, -8, 0.55, 12, 'crate');
  box(3.4, 1.1, 1.2, 8, 0.55, 12, 'crate');
  box(1.2, 1.1, 3.4, -24, 0.55, 6, 'hairline');
  box(1.2, 1.1, 3.4, 24, 0.55, 6, 'hairline');

  // Site A, the Depot: a low U-shaped wall, a container roof edge and crate cover.
  box(1.0, 2.4, 9, -25, 1.2, -13, 'surface');
  box(9, 2.4, 1.0, -20.5, 1.2, -17.5, 'surface');
  box(6, 2.6, 2.6, -23, 1.3, -9, 'containerA');
  box(2.2, 1.1, 2.2, -17, 0.55, -15, 'crate');
  box(2.2, 1.1, 2.2, -22, 0.55, -11, 'crate');

  // Site B, the Crane: four legs, a crossbeam overhead and a container stack.
  box(1.0, 7, 1.0, 17, 3.5, -16, 'hairline');
  box(1.0, 7, 1.0, 23, 3.5, -16, 'hairline');
  box(1.0, 7, 1.0, 17, 3.5, -10, 'hairline');
  box(1.0, 7, 1.0, 23, 3.5, -10, 'hairline');
  box(8, 1.0, 1.4, 20, 7.2, -13, 'accent');
  box(6, 2.6, 2.6, 24, 1.3, -18, 'containerC');
  box(2.2, 1.1, 2.2, 17, 0.55, -15, 'crate');
  box(2.2, 1.1, 2.2, 22, 0.55, -11, 'crate');

  // North back line and south spawn cover.
  box(4, 1.1, 1.2, -4, 0.55, -18, 'crate');
  box(4, 1.1, 1.2, 4, 0.55, -18, 'crate');
  box(2.4, 1.1, 1.2, -2, 0.55, 15, 'crate');
  box(2.4, 1.1, 1.2, 2, 0.55, 15, 'crate');

  // Site plates: glowing floor pads marking where the charge goes.
  for (const [key, material] of [['A', plateA], ['B', plateB]]) {
    const site = SITES[key];
    const plate = new THREE.Mesh(new THREE.CylinderGeometry(site.radius - 0.6, site.radius - 0.6, 0.06, 24), material);
    plate.position.set(site.center.x, 0.03, site.center.z);
    plate.receiveShadow = true;
    group.add(plate);
    const beacon = new THREE.Mesh(
      new THREE.CylinderGeometry(0.5, 1.6, 9, 12, 1, true),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(key === 'A' ? PALETTE.teal : PALETTE.ember), transparent: true, opacity: 0.07, side: THREE.DoubleSide, depthWrite: false }),
    );
    beacon.position.set(site.center.x, 4.5, site.center.z);
    group.add(beacon);
  }

  // Light: a low amber sun from the west, a cool dusk fill, and a hemisphere sky gradient.
  const sky = new THREE.HemisphereLight(new THREE.Color(PALETTE.sky), new THREE.Color(PALETTE.ground), 0.85);
  scene.add(sky);

  const sun = new THREE.DirectionalLight(new THREE.Color(PALETTE.accent), 2.4);
  sun.position.set(-24, 16, 10);
  sun.target.position.set(4, 0, -4);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -32;
  sun.shadow.camera.right = 32;
  sun.shadow.camera.top = 26;
  sun.shadow.camera.bottom = -26;
  sun.shadow.camera.far = 80;
  sun.shadow.bias = -0.0006;
  scene.add(sun, sun.target);

  const fill = new THREE.DirectionalLight(new THREE.Color(PALETTE.containerB), 0.5);
  fill.position.set(18, 12, 14);
  scene.add(fill);

  // Two warm yard lamps over the sites so the objective reads at a glance.
  for (const site of Object.values(SITES)) {
    const lamp = new THREE.PointLight(new THREE.Color(PALETTE.accent), 22, 16, 1.8);
    lamp.position.set(site.center.x, 5.5, site.center.z);
    scene.add(lamp);
  }

  return { colliders, shootables, group, minimapWalls };
}
