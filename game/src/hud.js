// The DOM HUD: health and armour bars, ammo, money, the round timer and score, the alive
// counts, the kill feed, the buy menu, the minimap and every overlay. It never touches the
// simulation; main.js pushes numbers in and reads callbacks out.
import { WEAPONS, GRENADES, ARMOR_PRICE } from './weapons.js';

const COPY = {
  start: {
    title: 'Emberline',
    copy: 'Kestrel Yard, dusk. Plant the Surge Charge at Site A (Depot) or Site B (Crane) — or eliminate every Raider. First to 5 rounds takes the match.',
    action: 'Deploy',
  },
  paused: {
    title: 'Emberline',
    copy: 'Paused. Click to resume the round.',
    action: 'Resume',
  },
  roundWin: {
    title: 'Round won',
    copy: '',
    action: 'Next round',
  },
  roundLose: {
    title: 'Round lost',
    copy: '',
    action: 'Next round',
  },
  matchWin: {
    title: 'Match won',
    copy: 'Vanguard takes Kestrel Yard.',
    action: 'Play again',
  },
  matchLose: {
    title: 'Match lost',
    copy: 'The Raiders hold Kestrel Yard.',
    action: 'Play again',
  },
};

export function createHud(world) {
  const $ = (id) => document.getElementById(id);
  const overlay = $('overlay');
  const overlayTitle = $('overlay-title');
  const overlayCopy = $('overlay-copy');
  const playButton = $('play');
  const buyPanel = $('buy');
  const buyList = $('buy-list');
  const buyMoney = $('buy-money');
  const banner = $('banner');
  const bannerTitle = $('banner-title');
  const bannerSub = $('banner-sub');
  const healthFill = $('health-fill');
  const healthValue = $('health-value');
  const armorFill = $('armor-fill');
  const armorRow = $('armor-row');
  const ammoMag = $('ammo-mag');
  const ammoReserve = $('ammo-reserve');
  const weaponName = $('weapon-name');
  const moneyValue = $('money-value');
  const timerValue = $('timer-value');
  const scoreValue = $('score-value');
  const aliveVanguard = $('alive-vanguard');
  const aliveRaiders = $('alive-raiders');
  const roundValue = $('round-value');
  const killfeed = $('killfeed');
  const crosshair = $('crosshair');
  const hitmarker = $('hitmarker');
  const damageVignette = $('damage-vignette');
  const flashOverlay = $('flash-overlay');
  const bombStatus = $('bomb-status');
  const bombLabel = $('bomb-label');
  const bombTimer = $('bomb-timer');
  const progressWrap = $('progress-wrap');
  const progressLabel = $('progress-label');
  const progressFill = $('progress-fill');
  const grenadeSlots = $('grenades');
  const minimap = $('minimap');
  const minimapCtx = minimap.getContext('2d');

  let hitTimer = 0;
  let bannerTimer = 0;
  let lastAmmo = '';
  let lastHealth = -1;
  let lastMoney = -1;
  let lastTimer = '';
  let lastScore = '';
  let lastAlive = '';

  function setAmmo(mag, reserve, name) {
    const key = `${mag}/${reserve}/${name}`;
    if (key === lastAmmo) return;
    lastAmmo = key;
    ammoMag.textContent = String(mag);
    ammoReserve.textContent = `/ ${reserve}`;
    weaponName.textContent = name;
  }

  function setHealth(health, armor) {
    const value = Math.max(0, Math.round(health));
    if (value === lastHealth) return;
    lastHealth = value;
    healthValue.textContent = String(value);
    healthFill.style.width = `${value}%`;
    healthFill.classList.toggle('low', value <= 30);
    armorRow.style.display = armor ? 'flex' : 'none';
    armorFill.style.width = armor ? '100%' : '0%';
  }

  function setMoney(value) {
    if (value === lastMoney) return;
    lastMoney = value;
    moneyValue.textContent = `$${value}`;
    buyMoney.textContent = `$${value}`;
  }

  function setTimer(seconds, planted) {
    const text = `${Math.max(0, Math.ceil(seconds))}`;
    const key = `${text}${planted ? 'p' : ''}`;
    if (key === lastTimer) return;
    lastTimer = key;
    timerValue.textContent = `0:${text.padStart(2, '0')}`;
    timerValue.classList.toggle('planted', planted);
  }

  function setScore(vanguard, raiders, round) {
    const key = `${vanguard}-${raiders}-${round}`;
    if (key === lastScore) return;
    lastScore = key;
    scoreValue.textContent = `${vanguard} : ${raiders}`;
    roundValue.textContent = `Round ${round}`;
  }

  function setAlive(vanguard, raiders) {
    const key = `${vanguard}-${raiders}`;
    if (key === lastAlive) return;
    lastAlive = key;
    aliveVanguard.textContent = '●'.repeat(vanguard) + '○'.repeat(5 - vanguard);
    aliveRaiders.textContent = '●'.repeat(raiders) + '○'.repeat(5 - raiders);
  }

  function setCrosshairSpread(spread) {
    const gap = 4 + Math.min(18, spread * 260);
    crosshair.style.setProperty('--gap', `${gap.toFixed(1)}px`);
  }

  function hitMarker(killed) {
    hitmarker.classList.add('on');
    hitmarker.classList.toggle('kill', killed);
    clearTimeout(hitTimer);
    hitTimer = setTimeout(() => hitmarker.classList.remove('on', 'kill'), 110);
  }

  function damageFlash() {
    damageVignette.classList.add('on');
    setTimeout(() => damageVignette.classList.remove('on'), 180);
  }

  function flashBlind(strength) {
    flashOverlay.style.opacity = String(Math.min(1, strength));
    setTimeout(() => { flashOverlay.style.opacity = '0'; }, 900);
  }

  function addKillFeed(killer, victim, headshot) {
    const entry = document.createElement('div');
    entry.className = 'killfeed-entry';
    entry.textContent = `${killer}  ✕  ${victim}${headshot ? '  ◉' : ''}`;
    killfeed.prepend(entry);
    while (killfeed.children.length > 4) killfeed.removeChild(killfeed.lastChild);
    setTimeout(() => entry.remove(), 6000);
  }

  function showBanner(title, sub, holdMs = 2600) {
    bannerTitle.textContent = title;
    bannerSub.textContent = sub;
    banner.hidden = false;
    clearTimeout(bannerTimer);
    bannerTimer = setTimeout(() => { banner.hidden = true; }, holdMs);
  }

  function hideBanner() {
    banner.hidden = true;
  }

  function showOverlay(mode, detail = '') {
    const text = COPY[mode];
    overlayTitle.textContent = text.title;
    overlayCopy.textContent = detail || text.copy;
    playButton.textContent = text.action;
    overlay.hidden = false;
    playButton.focus();
  }

  function hideOverlay() {
    overlay.hidden = true;
  }

  function showBuy(show) {
    buyPanel.hidden = !show;
  }

  function setBombStatus(planted, site, seconds) {
    if (!planted) {
      bombStatus.hidden = true;
      return;
    }
    bombStatus.hidden = false;
    bombLabel.textContent = `Charge planted — Site ${site}`;
    bombTimer.textContent = `${Math.max(0, Math.ceil(seconds))}s`;
  }

  function setProgress(label, fraction) {
    if (fraction === null) {
      progressWrap.hidden = true;
      return;
    }
    progressWrap.hidden = false;
    progressLabel.textContent = label;
    progressFill.style.width = `${Math.round(fraction * 100)}%`;
  }

  function setGrenades(inventory, selected) {
    const parts = [];
    for (const key of Object.keys(GRENADES)) {
      const count = inventory[key] ?? 0;
      parts.push(`${count > 0 ? '●' : '○'} ${GRENADES[key].name.split(' ')[0]} ×${count}`);
    }
    grenadeSlots.textContent = parts.join('   ');
    grenadeSlots.classList.toggle('has', Object.values(inventory).some((count) => count > 0));
  }

  // --- Buy menu: built once from the weapon tables, refreshed on money change. ---
  function buildBuy(onBuy, onDeploy) {
    buyList.innerHTML = '';
    const rows = [];
    for (const def of Object.values(WEAPONS)) {
      if (def.price === 0) continue;
      rows.push({ kind: 'weapon', id: def.id, label: `${def.name} — ${def.damage} dmg · ${def.mag} rounds`, price: def.price });
    }
    rows.push({ kind: 'armor', id: 'armor', label: 'Kevlar Vest — halves body damage', price: ARMOR_PRICE });
    for (const def of Object.values(GRENADES)) {
      rows.push({ kind: 'grenade', id: def.id, label: `${def.name} (max ${def.max})`, price: def.price });
    }
    for (const row of rows) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'buy-row';
      button.innerHTML = `<span>${row.label}</span><b>$${row.price}</b>`;
      button.addEventListener('click', () => onBuy(row.kind, row.id));
      buyList.appendChild(button);
    }
    const deploy = document.createElement('button');
    deploy.type = 'button';
    deploy.className = 'buy-deploy';
    deploy.textContent = 'Deploy  ⏎';
    deploy.addEventListener('click', onDeploy);
    buyList.appendChild(deploy);
  }

  // --- Minimap: walls and sites from the world, dots for both teams. ---
  function drawMinimap(player, teammates, enemies, time) {
    const size = minimap.width;
    const scale = size / 58;
    const toX = (x) => size / 2 + x * scale;
    const toY = (z) => size / 2 + z * scale;
    minimapCtx.clearRect(0, 0, size, size);
    minimapCtx.fillStyle = 'rgba(20, 23, 28, 0.82)';
    minimapCtx.fillRect(0, 0, size, size);
    minimapCtx.fillStyle = '#4a525e';
    for (const wall of world.minimapWalls) {
      minimapCtx.fillRect(toX(wall.x - wall.w / 2), toY(wall.z - wall.d / 2), Math.max(1, wall.w * scale), Math.max(1, wall.d * scale));
    }
    minimapCtx.font = 'bold 11px system-ui, sans-serif';
    minimapCtx.textAlign = 'center';
    minimapCtx.fillStyle = '#35b5a6';
    minimapCtx.fillText('A', toX(-20), toY(-13) + 4);
    minimapCtx.fillStyle = '#e05a3a';
    minimapCtx.fillText('B', toX(20), toY(-13) + 4);
    const dot = (x, z, color, radius) => {
      minimapCtx.fillStyle = color;
      minimapCtx.beginPath();
      minimapCtx.arc(toX(x), toY(z), radius, 0, Math.PI * 2);
      minimapCtx.fill();
    };
    for (const enemy of enemies) {
      if (!enemy.alive) continue;
      if (time - enemy.lastSeenAt > 4) continue;
      dot(enemy.body.position.x, enemy.body.position.z, '#e05a3a', 3);
    }
    for (const mate of teammates) {
      if (!mate.alive) continue;
      dot(mate.body.position.x, mate.body.position.z, '#35b5a6', 3);
    }
    // The player is a triangle pointing where they look.
    const px = toX(player.position.x);
    const py = toY(player.position.z);
    minimapCtx.fillStyle = '#e8e4d8';
    minimapCtx.beginPath();
    minimapCtx.moveTo(px + Math.sin(-player.yaw) * 6, py + Math.cos(-player.yaw) * 6);
    minimapCtx.lineTo(px + Math.sin(-player.yaw + 2.5) * 4, py + Math.cos(-player.yaw + 2.5) * 4);
    minimapCtx.lineTo(px + Math.sin(-player.yaw - 2.5) * 4, py + Math.cos(-player.yaw - 2.5) * 4);
    minimapCtx.closePath();
    minimapCtx.fill();
  }

  return {
    setAmmo, setHealth, setMoney, setTimer, setScore, setAlive, setCrosshairSpread,
    hitMarker, damageFlash, flashBlind, addKillFeed, showBanner, hideBanner,
    showOverlay, hideOverlay, showBuy, buildBuy, setBombStatus, setProgress, setGrenades,
    drawMinimap,
    onPlay(handler) { playButton.addEventListener('click', handler); },
  };
}
