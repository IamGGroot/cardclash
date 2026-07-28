import { getSilhouette } from './silhouettes.js';

export const THEMES = {
  fire: { sky: ['#3a0f05', '#ff7a1a'], accent: '#ffcf8a', base: '#8a2a0a', light: '#ffb066', dark: '#3d0f04' },
  ice: { sky: ['#0a1a33', '#7fd0ff'], accent: '#eaffff', base: '#3a6a8a', light: '#dff5ff', dark: '#1b3a52' },
  nature: { sky: ['#0c1f0f', '#5aa844'], accent: '#c8ff9a', base: '#2f5c28', light: '#9fdc7f', dark: '#12280f' },
  shadow: { sky: ['#0a0a14', '#3a1a4a'], accent: '#c896ff', base: '#2a1440', light: '#8a5fc0', dark: '#0a0510' },
  arcane: { sky: ['#0a0a2a', '#5a3ad6'], accent: '#c2ccff', base: '#332a70', light: '#a9b8ff', dark: '#160f3a' },
  holy: { sky: ['#2a1f05', '#ffd873'], accent: '#fff4c2', base: '#8a6a1a', light: '#ffe9a0', dark: '#4a3708' },
  neutral: { sky: ['#151a2b', '#5a6590'], accent: '#dfe4f5', base: '#3c4666', light: '#a7b0d1', dark: '#1a1f33' },
  earth: { sky: ['#1a1408', '#7a6238'], accent: '#e8cf9a', base: '#4a3a1f', light: '#b89a63', dark: '#241c0d' },
};

// Curated real illustrations (see art/CREDITS.md for source/license per
// file) for the archetypes that had a good, style-consistent match. Every
// other silhouette key keeps the procedural SVG path below unchanged.
const PHOTO_ART = {
  warrior: 'art/warrior.jpg',
  knight: 'art/knight.jpg',
  archer: 'art/archer.jpg',
  darkknight: 'art/darkknight.jpg',
  wolf: 'art/wolf.jpg',
  golem: 'art/golem.jpg',
  fireelemental: 'art/fireelemental.jpg',
  fireball: 'art/fireball.jpg',
  raven: 'art/raven.jpg',
  necromancer: 'art/necromancer.jpg',
  dragon: 'art/dragon.jpg',
  storm: 'art/storm.jpg',
  titan: 'art/titan.jpg',
  heal: 'art/heal.jpg',
  impact: 'art/impact.jpg',
  iceguardian: 'art/iceguardian.jpg',
  phoenix: 'art/phoenix.jpg',
  wall: 'art/wall.jpg',
};

// Player-avatar picker options: the subset of PHOTO_ART whose subject is a
// clear portrait/creature that still reads well cropped to a circle (unlike
// pure effect shots such as fireball/impact/heal, or the static wall).
export const AVATARS = [
  'warrior',
  'knight',
  'archer',
  'darkknight',
  'wolf',
  'golem',
  'fireelemental',
  'raven',
  'necromancer',
  'dragon',
  'titan',
  'iceguardian',
  'phoenix',
  'storm',
].map((id) => ({ id, src: PHOTO_ART[id] }));

const PARTICLE_SHAPES = {
  fire: '●',
  ice: '❄',
  nature: '✦',
  shadow: '✦',
  arcane: '✦',
  holy: '✦',
  neutral: '●',
  earth: '●',
};

function particles(theme, id) {
  const positions = [
    [12, 22], [86, 18], [20, 78], [80, 74], [8, 50], [92, 46], [50, 12],
  ];
  const shape = PARTICLE_SHAPES[theme.name] || '●';
  return positions
    .map(([x, y], i) => {
      const size = 2 + ((i * 37 + id) % 3);
      const opacity = 0.25 + ((i * 17 + id) % 40) / 100;
      return `<text x="${x}" y="${y}" font-size="${size + 2}" fill="${theme.accent}" opacity="${opacity.toFixed(2)}" text-anchor="middle">${shape}</text>`;
    })
    .join('');
}

function hashId(id) {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return h % 97;
}

// Every call gets its own id suffix so two simultaneously-rendered copies of
// the same card (2x in hand, or the same card shown in two different grids)
// never collide on <linearGradient>/<radialGradient> ids in the live DOM.
let renderCounter = 0;

export function cardArtSVG(card) {
  const theme = THEMES[card.theme] || THEMES.neutral;
  theme.name = card.theme;

  const photo = PHOTO_ART[card.silhouette];
  if (photo) {
    // Real art already carries its own light/atmosphere, so it skips the
    // sky-gradient/particle compositing built for the flat vector icons —
    // just a faction-color tint (so the same photo reads as "this card's
    // faction" when reused across factions) and a light edge vignette to
    // match the darkened-edge look of the procedural cards.
    return `
    <div class="art-photo">
      <img class="art-img" src="${photo}" alt="" loading="lazy" />
      <div class="art-photo-tint" style="background:${theme.accent}"></div>
      <div class="art-photo-vignette"></div>
    </div>`;
  }

  const uid = `${card.id}-${renderCounter++}`;
  const seed = hashId(card.id);
  const silhouette = getSilhouette(card.silhouette)(theme);

  return `
  <svg viewBox="0 0 100 100" class="art-svg" preserveAspectRatio="xMidYMid slice">
    <defs>
      <linearGradient id="sky-${uid}" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="${theme.sky[0]}"/>
        <stop offset="100%" stop-color="${theme.sky[1]}"/>
      </linearGradient>
      <radialGradient id="glow-${uid}" cx="50%" cy="55%" r="60%">
        <stop offset="0%" stop-color="${theme.accent}" stop-opacity="0.55"/>
        <stop offset="100%" stop-color="${theme.accent}" stop-opacity="0"/>
      </radialGradient>
      <radialGradient id="rim-${uid}" cx="50%" cy="40%" r="26%">
        <stop offset="0%" stop-color="${theme.light}" stop-opacity="0.65"/>
        <stop offset="100%" stop-color="${theme.light}" stop-opacity="0"/>
      </radialGradient>
      <radialGradient id="vig-${uid}" cx="50%" cy="46%" r="72%">
        <stop offset="0%" stop-color="#000" stop-opacity="0"/>
        <stop offset="68%" stop-color="#000" stop-opacity="0"/>
        <stop offset="100%" stop-color="#000" stop-opacity="0.4"/>
      </radialGradient>
    </defs>
    <rect x="0" y="0" width="100" height="100" fill="url(#sky-${uid})"/>
    <circle cx="50" cy="50" r="45" fill="url(#glow-${uid})"/>
    ${particles(theme, seed)}
    <path d="M0 84 Q20 74 38 84 Q55 92 72 82 Q88 76 100 84 L100 100 L0 100 Z" fill="${theme.dark}" opacity="0.6"/>
    <ellipse cx="50" cy="85" rx="24" ry="5" fill="#000" opacity="0.35"/>
    <circle cx="50" cy="42" r="30" fill="url(#rim-${uid})"/>
    <g>${silhouette}</g>
    <rect x="0" y="0" width="100" height="100" fill="url(#vig-${uid})"/>
  </svg>`;
}
