// Emberline: the look plan, in one place. A dusk container yard: cold blue-grey steel,
// warm amber hazard light, teal for Vanguard, ember red for Raiders. Every colour in the
// game and the CSS is one of these names; lighting makes the shades in between.
export const PALETTE = {
  canvas: '#191d24',
  surface: '#232830',
  hairline: '#333a45',
  ink: '#e8e4d8',
  muted: '#8d97a3',
  accent: '#f0a830',
  teal: '#35b5a6',
  ember: '#e05a3a',
  sky: '#2a3140',
  ground: '#20242c',
  crate: '#4a4238',
  containerA: '#7a5a34',
  containerB: '#3e5a6b',
  containerC: '#6b3e3e',
};

export function shade(name) {
  return PALETTE[name];
}

// Team colours, kept with the palette so the HUD, the minimap and the bot models agree.
export const TEAM_COLORS = {
  vanguard: PALETTE.teal,
  raiders: PALETTE.ember,
};
