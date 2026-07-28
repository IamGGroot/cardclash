// Stylized fantasy silhouettes built from primitive SVG shapes.
// Each function takes a palette {base, light, dark, accent} and returns inner SVG markup
// on a 0..100 x 0..100 canvas, feet resting around y=90.
//
// Shading convention: every major shape gets three passes — a dark
// shadow accent on its trailing/lower edge, the mid-tone base fill, and a
// light highlight sliver on its leading/upper edge (light source from
// upper-left, matching the rim-light glow composited in art.js). Kept to
// plain rects/ellipses/simple paths — no <filter> primitives, so this stays
// cheap even with a dozen+ instances on screen at once.

function humanoidBody(c, { armAngle = -20, weaponColor = null, cape = false } = {}) {
  return `
    ${cape ? `
      <path d="M40 46 Q28 66 33 90 L51 79 L47 46 Z" fill="${c.dark}" opacity="0.9"/>
      <path d="M40 46 Q34 62 36 82 L44 76 L43 46 Z" fill="${c.base}" opacity="0.5"/>
    ` : ''}
    <ellipse cx="51" cy="35" rx="9.5" ry="10.5" fill="${c.dark}" opacity="0.5"/>
    <ellipse cx="50" cy="34" rx="9" ry="10" fill="${c.dark}"/>
    <ellipse cx="47.5" cy="31.5" rx="4" ry="4.5" fill="${c.light}" opacity="0.3"/>
    <rect x="40" y="42" width="22" height="28" rx="7" fill="${c.dark}" opacity="0.4"/>
    <rect x="39" y="42" width="22" height="28" rx="7" fill="${c.base}"/>
    <rect x="39" y="42" width="7" height="28" rx="4" fill="${c.light}" opacity="0.22"/>
    <rect x="39" y="54" width="22" height="4.5" fill="${c.dark}" opacity="0.55"/>
    <rect x="30" y="45" width="8" height="20" rx="4" fill="${c.base}"/>
    <ellipse cx="34" cy="47" rx="4.5" ry="3" fill="${c.light}" opacity="0.25"/>
    <rect x="61" y="43" width="8" height="22" rx="4" fill="${c.base}" transform="rotate(${armAngle} 65 54)"/>
    <ellipse cx="65" cy="45" rx="4.5" ry="3" fill="${c.light}" opacity="0.25" transform="rotate(${armAngle} 65 54)"/>
    <rect x="40" y="68" width="9" height="18" rx="3" fill="${c.dark}"/>
    <rect x="52" y="68" width="9" height="18" rx="3" fill="${c.dark}"/>
    <rect x="40" y="83" width="9" height="4" rx="1.5" fill="${c.light}" opacity="0.2"/>
    <rect x="52" y="83" width="9" height="4" rx="1.5" fill="${c.light}" opacity="0.2"/>
    <ellipse cx="50" cy="88" rx="14" ry="2.4" fill="${c.dark}" opacity="0.45"/>
    <ellipse cx="50" cy="34" rx="9" ry="10" fill="${c.light}" opacity="0.22"/>
    ${weaponColor ? `
      <rect x="63" y="14" width="4.5" height="34" rx="2" fill="${weaponColor}" transform="rotate(${armAngle} 65 54)"/>
      <ellipse cx="65.2" cy="16" rx="2.6" ry="3.4" fill="${c.light}" opacity="0.6" transform="rotate(${armAngle} 65 54)"/>
    ` : ''}
  `;
}

export const SILHOUETTES = {
  warrior: (c) => humanoidBody(c, { armAngle: -35, weaponColor: c.accent }),

  knight: (c) => `
    ${humanoidBody(c, { armAngle: -10 })}
    <ellipse cx="33" cy="56" rx="9.5" ry="15" fill="${c.dark}" opacity="0.5"/>
    <ellipse cx="34" cy="55" rx="9" ry="14" fill="${c.accent}" opacity="0.9"/>
    <ellipse cx="31.5" cy="51" rx="3" ry="6" fill="${c.light}" opacity="0.35"/>
    <ellipse cx="34" cy="55" rx="9" ry="14" fill="none" stroke="${c.dark}" stroke-width="1.5"/>
    <circle cx="34" cy="49" r="1.6" fill="${c.light}" opacity="0.8"/>
  `,

  archer: (c) => `
    ${humanoidBody(c, { armAngle: -60 })}
    <path d="M66 22 Q82 44 66 66" fill="none" stroke="${c.dark}" stroke-width="3.5" opacity="0.4"/>
    <path d="M66 24 Q80 44 66 64" fill="none" stroke="${c.accent}" stroke-width="2.5"/>
    <line x1="66" y1="24" x2="66" y2="64" stroke="${c.light}" stroke-width="1" opacity="0.7"/>
    <line x1="52" y1="44" x2="70" y2="44" stroke="${c.light}" stroke-width="0.8" opacity="0.5"/>
  `,

  darkknight: (c) => `
    ${humanoidBody(c, { armAngle: -35, weaponColor: c.accent, cape: true })}
    <path d="M42 24 L58 24 L54 34 L50 30 L46 34 Z" fill="${c.dark}" opacity="0.85"/>
  `,

  wolf: (c) => `
    <ellipse cx="52" cy="76" rx="34" ry="5" fill="${c.dark}" opacity="0.35"/>
    <path d="M74 54 Q92 44 90 26 Q80 44 70 58 Z" fill="${c.dark}"/>
    <path d="M76 50 Q86 42 86 30 Q80 42 73 52 Z" fill="${c.base}" opacity="0.6"/>
    <rect x="26" y="50" width="48" height="24" rx="11" fill="${c.dark}" opacity="0.35"/>
    <rect x="26" y="48" width="48" height="24" rx="11" fill="${c.base}"/>
    <rect x="26" y="48" width="48" height="7" rx="4" fill="${c.light}" opacity="0.22"/>
    <ellipse cx="22" cy="50" rx="14" ry="12" fill="${c.base}"/>
    <ellipse cx="19" cy="46" rx="6" ry="5" fill="${c.light}" opacity="0.28"/>
    <path d="M10 50 L24 44 L24 58 Z" fill="${c.base}"/>
    <path d="M10 50 L24 44 L24 50 Z" fill="${c.light}" opacity="0.3"/>
    <path d="M14 40 L10 24 L22 38 Z" fill="${c.dark}"/>
    <path d="M26 38 L26 22 L34 38 Z" fill="${c.dark}"/>
    <rect x="30" y="72" width="7" height="16" rx="2" fill="${c.dark}"/>
    <rect x="44" y="74" width="7" height="16" rx="2" fill="${c.dark}"/>
    <rect x="58" y="72" width="7" height="16" rx="2" fill="${c.dark}"/>
    <rect x="68" y="74" width="7" height="16" rx="2" fill="${c.dark}"/>
    <circle cx="18" cy="46" r="1.8" fill="${c.accent}"/>
    <circle cx="18" cy="46" r="3.2" fill="${c.accent}" opacity="0.3"/>
    <ellipse cx="50" cy="54" rx="24" ry="6" fill="${c.light}" opacity="0.22"/>
    <path d="M30 58 Q50 64 70 58" fill="none" stroke="${c.dark}" stroke-width="1.5" opacity="0.4"/>
  `,

  golem: (c) => `
    <ellipse cx="50" cy="88" rx="30" ry="4.5" fill="${c.dark}" opacity="0.4"/>
    <rect x="32" y="30" width="36" height="34" rx="4" fill="${c.dark}" opacity="0.3"/>
    <rect x="31" y="29" width="36" height="34" rx="4" fill="${c.base}"/>
    <rect x="31" y="29" width="10" height="34" rx="4" fill="${c.light}" opacity="0.2"/>
    <rect x="41" y="42" width="4" height="14" fill="${c.dark}" opacity="0.5"/>
    <rect x="54" y="46" width="4" height="12" fill="${c.dark}" opacity="0.5"/>
    <rect x="22" y="40" width="12" height="26" rx="4" fill="${c.dark}"/>
    <rect x="22" y="40" width="4" height="26" rx="2" fill="${c.light}" opacity="0.18"/>
    <rect x="66" y="40" width="12" height="26" rx="4" fill="${c.dark}"/>
    <rect x="34" y="64" width="13" height="22" rx="3" fill="${c.dark}"/>
    <rect x="34" y="80" width="13" height="6" rx="2" fill="${c.light}" opacity="0.15"/>
    <rect x="53" y="64" width="13" height="22" rx="3" fill="${c.dark}"/>
    <rect x="53" y="80" width="13" height="6" rx="2" fill="${c.light}" opacity="0.15"/>
    <rect x="38" y="17" width="24" height="16" rx="3" fill="${c.dark}" opacity="0.3"/>
    <rect x="37" y="16" width="24" height="16" rx="3" fill="${c.base}"/>
    <rect x="37" y="16" width="24" height="5" rx="2" fill="${c.light}" opacity="0.25"/>
    <circle cx="44" cy="26" r="2.6" fill="${c.accent}"/>
    <circle cx="44" cy="26" r="4.4" fill="${c.accent}" opacity="0.28"/>
    <circle cx="56" cy="26" r="2.6" fill="${c.accent}"/>
    <circle cx="56" cy="26" r="4.4" fill="${c.accent}" opacity="0.28"/>
    <rect x="31" y="29" width="36" height="8" fill="${c.light}" opacity="0.18"/>
  `,

  wall: (c) => `
    <ellipse cx="50" cy="88" rx="36" ry="4" fill="${c.dark}" opacity="0.35"/>
    <rect x="15" y="33" width="70" height="53" rx="4" fill="${c.dark}" opacity="0.3"/>
    <rect x="16" y="34" width="68" height="52" rx="4" fill="${c.base}"/>
    ${[0, 1, 2].map((row) => [0, 1, 2, 3].map((col) => `<rect x="${20 + col * 16 + (row % 2 === 0 ? 0 : 8)}" y="${40 + row * 16}" width="14" height="12" rx="1.5" fill="${row % 2 === col % 2 ? c.dark : c.light}" opacity="${row % 2 === col % 2 ? 0.35 : 0.28}"/>`).join('')).join('')}
    <rect x="16" y="34" width="68" height="7" fill="${c.light}" opacity="0.32"/>
    <rect x="16" y="80" width="68" height="6" fill="${c.dark}" opacity="0.4"/>
    <circle cx="24" cy="80" r="2" fill="${c.accent}" opacity="0.7"/>
    <circle cx="76" cy="80" r="2" fill="${c.accent}" opacity="0.7"/>
  `,

  fireelemental: (c) => `
    <ellipse cx="50" cy="86" rx="20" ry="4" fill="${c.dark}" opacity="0.4"/>
    <path d="M50 12 Q68 34 59 51 Q78 47 69 68 Q60 92 50 92 Q40 92 31 68 Q22 47 41 51 Q32 34 50 12Z" fill="${c.dark}" opacity="0.5"/>
    <path d="M50 14 Q66 34 58 50 Q76 46 68 66 Q60 90 50 90 Q40 90 32 66 Q24 46 42 50 Q34 34 50 14Z" fill="${c.base}"/>
    <path d="M50 30 Q58 42 54 52 Q64 50 60 62 Q56 76 50 76 Q44 76 40 62 Q36 50 46 52 Q42 42 50 30Z" fill="${c.accent}" opacity="0.85"/>
    <path d="M50 34 Q54 42 52 50 Q58 48 56 58 Q53 68 50 68" fill="none" stroke="${c.light}" stroke-width="1.4" opacity="0.6"/>
    <circle cx="44" cy="58" r="2.4" fill="#fff"/>
    <circle cx="56" cy="58" r="2.4" fill="#fff"/>
    <ellipse cx="50" cy="20" rx="6" ry="9" fill="${c.light}" opacity="0.35"/>
  `,

  fireball: (c) => `
    <circle cx="50" cy="55" r="21" fill="${c.dark}" opacity="0.4"/>
    <circle cx="50" cy="55" r="20" fill="${c.base}"/>
    <circle cx="47" cy="51" r="7" fill="${c.light}" opacity="0.3"/>
    <circle cx="50" cy="55" r="12" fill="${c.accent}"/>
    <circle cx="47" cy="51" r="4" fill="#fff" opacity="0.55"/>
    <path d="M50 18 Q57 33 50 44 Q43 33 50 18Z" fill="${c.accent}"/>
    <path d="M50 18 Q53 30 50 38" fill="none" stroke="${c.light}" stroke-width="1.2" opacity="0.6"/>
    <path d="M29 33 Q40 41 40 52 Q29 47 29 33Z" fill="${c.light}" opacity="0.75"/>
    <path d="M71 33 Q60 41 60 52 Q71 47 71 33Z" fill="${c.light}" opacity="0.75"/>
  `,

  iceguardian: (c) => `
    <ellipse cx="50" cy="88" rx="18" ry="3.6" fill="${c.dark}" opacity="0.35"/>
    <path d="M50 10 L63 34 L50 30 L37 34 Z" fill="${c.accent}"/>
    <path d="M50 10 L55 26 L50 24 Z" fill="${c.light}" opacity="0.6"/>
    <path d="M32 34 L68 34 L60 90 L40 90 Z" fill="${c.dark}" opacity="0.4"/>
    <path d="M32 33 L68 33 L60 89 L40 89 Z" fill="${c.base}"/>
    <path d="M40 33 L60 33 L55 89 L45 89 Z" fill="${c.light}" opacity="0.5"/>
    <path d="M45 40 L48 40 L44 82 L41 82 Z" fill="#fff" opacity="0.35"/>
    <path d="M24 44 L32 33 L30 54 Z" fill="${c.accent}"/>
    <path d="M76 44 L68 33 L70 54 Z" fill="${c.accent}"/>
    <circle cx="45" cy="46" r="2" fill="#fff"/>
    <circle cx="55" cy="46" r="2" fill="#fff"/>
    <circle cx="45" cy="46" r="3.6" fill="${c.accent}" opacity="0.3"/>
    <circle cx="55" cy="46" r="3.6" fill="${c.accent}" opacity="0.3"/>
  `,

  raven: (c) => `
    <ellipse cx="50" cy="80" rx="22" ry="4" fill="${c.dark}" opacity="0.3"/>
    <path d="M50 40 Q30 44 16 60 Q32 56 40 58 Q26 66 22 78 Q38 68 46 62 Q50 74 50 86 Q54 74 58 62 Q66 68 82 78 Q78 66 64 58 Q72 56 88 60 Q74 44 50 40Z" fill="${c.dark}" opacity="0.5"/>
    <path d="M50 38 Q30 42 16 58 Q32 54 40 56 Q26 64 22 76 Q38 66 46 60 Q50 72 50 84 Q54 72 58 60 Q66 66 82 76 Q78 64 64 56 Q72 54 88 58 Q74 42 50 38Z" fill="${c.base}"/>
    <path d="M50 38 Q40 40 32 48 Q40 44 46 48" fill="none" stroke="${c.light}" stroke-width="1.4" opacity="0.4"/>
    <ellipse cx="50" cy="44" rx="7" ry="6" fill="${c.dark}"/>
    <ellipse cx="48" cy="42" rx="2.6" ry="2.2" fill="${c.light}" opacity="0.3"/>
    <path d="M50 42 L58 44 L50 47Z" fill="${c.accent}"/>
    <circle cx="52" cy="43" r="1.3" fill="${c.accent}"/>
    <circle cx="52" cy="43" r="2.2" fill="${c.accent}" opacity="0.3"/>
  `,

  necromancer: (c) => `
    <ellipse cx="50" cy="87" rx="20" ry="3.6" fill="${c.dark}" opacity="0.35"/>
    <path d="M38 42 Q50 30 62 42 L69 88 L31 88 Z" fill="${c.dark}" opacity="0.35"/>
    <path d="M38 41 Q50 29 62 41 L68 87 L32 87 Z" fill="${c.base}"/>
    <path d="M38 41 Q44 34 50 32 L48 87 L36 87 Z" fill="${c.light}" opacity="0.2"/>
    <ellipse cx="50" cy="35" rx="8" ry="9" fill="${c.dark}"/>
    <ellipse cx="47.5" cy="32.5" rx="3" ry="3.4" fill="${c.light}" opacity="0.28"/>
    <circle cx="46" cy="34" r="1.6" fill="${c.accent}"/>
    <circle cx="46" cy="34" r="2.8" fill="${c.accent}" opacity="0.3"/>
    <circle cx="54" cy="34" r="1.6" fill="${c.accent}"/>
    <circle cx="54" cy="34" r="2.8" fill="${c.accent}" opacity="0.3"/>
    <rect x="68" y="18" width="3.5" height="60" fill="${c.dark}" opacity="0.5" transform="rotate(10 70 50)"/>
    <rect x="68" y="18" width="3.5" height="60" fill="${c.light}" opacity="0.75" transform="rotate(10 70 50)"/>
    <circle cx="72" cy="18" r="4.8" fill="${c.accent}"/>
    <circle cx="72" cy="18" r="7.5" fill="${c.accent}" opacity="0.28"/>
    <path d="M38 41 Q50 29 62 41" fill="none" stroke="${c.light}" stroke-width="1.5" opacity="0.4"/>
  `,

  dragon: (c) => `
    <ellipse cx="50" cy="82" rx="30" ry="5" fill="${c.dark}" opacity="0.3"/>
    <path d="M20 70 Q30 40 50 38 Q70 40 82 62 L74 60 Q78 74 70 84 Q66 72 58 70 L60 82 Q50 76 46 66 L40 78 Q36 68 36 60 Q26 64 20 70Z" fill="${c.dark}" opacity="0.4"/>
    <path d="M19 69 Q29 39 49 37 Q69 39 81 61 L73 59 Q77 73 69 83 Q65 71 57 69 L59 81 Q49 75 45 65 L39 77 Q35 67 35 59 Q25 63 19 69Z" fill="${c.base}"/>
    <path d="M19 69 Q26 46 40 40 Q34 52 33 62" fill="none" stroke="${c.light}" stroke-width="1.6" opacity="0.35"/>
    <path d="M49 37 Q57 25 69 29 Q63 33 61 39 Q55 35 49 37Z" fill="${c.dark}"/>
    <path d="M49 37 Q54 29 62 30 Q58 33 57 37 Q53 35 49 37Z" fill="${c.light}" opacity="0.3"/>
    <circle cx="65" cy="33" r="1.8" fill="${c.accent}"/>
    <circle cx="65" cy="33" r="3.2" fill="${c.accent}" opacity="0.35"/>
    <path d="M29 45 L13 33 L25 49 Z" fill="${c.dark}" opacity="0.9"/>
    <path d="M39 41 L27 25 L37 45 Z" fill="${c.dark}" opacity="0.9"/>
    <path d="M29 45 L21 39 L25 49 Z" fill="${c.light}" opacity="0.25"/>
    <path d="M49 37 Q39 41 35 59" fill="none" stroke="${c.light}" stroke-width="1.5" opacity="0.35"/>
    <path d="M56 66 Q60 72 58 80" fill="none" stroke="${c.accent}" stroke-width="1.4" opacity="0.5"/>
  `,

  storm: (c) => `
    <ellipse cx="50" cy="34" rx="30" ry="14" fill="${c.dark}" opacity="0.35"/>
    <ellipse cx="49" cy="33" rx="29" ry="13" fill="${c.base}"/>
    <ellipse cx="40" cy="28" rx="12" ry="6" fill="${c.light}" opacity="0.22"/>
    <ellipse cx="34" cy="30" rx="16" ry="11" fill="${c.dark}" opacity="0.3"/>
    <ellipse cx="33" cy="29" rx="15" ry="10" fill="${c.base}"/>
    <ellipse cx="66" cy="30" rx="16" ry="11" fill="${c.dark}" opacity="0.3"/>
    <ellipse cx="65" cy="29" rx="15" ry="10" fill="${c.base}"/>
    <path d="M46 44 L36 64 L48 62 L38 88 L62 56 L50 58 L58 44 Z" fill="${c.dark}" opacity="0.5"/>
    <path d="M45 43 L35 63 L47 61 L37 87 L61 55 L49 57 L57 43 Z" fill="${c.accent}"/>
    <path d="M49 57 L57 43 L52 43 L47 52 Z" fill="${c.light}" opacity="0.5"/>
  `,

  phoenix: (c) => `
    <ellipse cx="50" cy="84" rx="18" ry="4" fill="${c.dark}" opacity="0.3"/>
    <path d="M50 26 Q30 30 22 52 Q34 46 40 52 Q26 58 22 76 Q38 68 46 60 Q48 76 50 88 Q52 76 54 60 Q62 68 78 76 Q74 58 60 52 Q66 46 78 52 Q70 30 50 26Z" fill="${c.dark}" opacity="0.4"/>
    <path d="M50 25 Q29 29 21 51 Q33 45 39 51 Q25 57 21 75 Q37 67 45 59 Q47 75 50 87 Q52 75 54 59 Q61 67 78 75 Q74 57 59 51 Q65 45 78 51 Q69 29 50 25Z" fill="${c.base}"/>
    <path d="M50 30 Q36 34 30 50 Q38 46 42 50 Q34 54 32 66 Q42 60 47 56 Q49 68 50 78 Q51 68 53 56 Q58 60 68 66 Q66 54 58 50 Q62 46 70 50 Q64 34 50 30Z" fill="${c.accent}" opacity="0.9"/>
    <path d="M50 32 Q40 38 36 48 Q40 46 43 49" fill="none" stroke="${c.light}" stroke-width="1.3" opacity="0.55"/>
    <ellipse cx="50" cy="38" rx="6" ry="7" fill="${c.dark}"/>
    <circle cx="48" cy="37" r="1.3" fill="#fff"/>
    <circle cx="48" cy="37" r="2.4" fill="${c.accent}" opacity="0.4"/>
  `,

  titan: (c) => `
    <ellipse cx="50" cy="90" rx="32" ry="4.5" fill="${c.dark}" opacity="0.4"/>
    <rect x="28" y="26" width="44" height="42" rx="5" fill="${c.dark}" opacity="0.3"/>
    <rect x="27" y="25" width="44" height="42" rx="5" fill="${c.base}"/>
    <rect x="27" y="25" width="12" height="42" rx="5" fill="${c.light}" opacity="0.2"/>
    <rect x="16" y="36" width="14" height="32" rx="5" fill="${c.dark}"/>
    <rect x="16" y="36" width="5" height="32" rx="2.5" fill="${c.light}" opacity="0.18"/>
    <rect x="70" y="36" width="14" height="32" rx="5" fill="${c.dark}"/>
    <rect x="30" y="68" width="16" height="24" rx="3" fill="${c.dark}"/>
    <rect x="30" y="86" width="16" height="6" rx="2" fill="${c.light}" opacity="0.15"/>
    <rect x="54" y="68" width="16" height="24" rx="3" fill="${c.dark}"/>
    <path d="M36 25 L30 8 L44 21Z" fill="${c.dark}" opacity="0.4"/>
    <path d="M35 24 L29 7 L43 20Z" fill="${c.accent}"/>
    <path d="M64 25 L70 8 L58 21Z" fill="${c.dark}" opacity="0.4"/>
    <path d="M65 24 L71 7 L59 20Z" fill="${c.accent}"/>
    <circle cx="42" cy="42" r="3.2" fill="${c.accent}"/>
    <circle cx="42" cy="42" r="5.4" fill="${c.accent}" opacity="0.28"/>
    <circle cx="58" cy="42" r="3.2" fill="${c.accent}"/>
    <circle cx="58" cy="42" r="5.4" fill="${c.accent}" opacity="0.28"/>
    <rect x="27" y="25" width="44" height="9" fill="${c.light}" opacity="0.18"/>
    <path d="M33 55 L67 55" stroke="${c.dark}" stroke-width="2" opacity="0.3"/>
  `,

  heal: (c) => `
    <ellipse cx="50" cy="76" rx="20" ry="4" fill="${c.dark}" opacity="0.25"/>
    <path d="M50 20 Q63 30 63 45 Q63 61 50 73 Q37 61 37 45 Q37 30 50 20Z" fill="${c.dark}" opacity="0.4"/>
    <path d="M50 20 Q62 30 62 44 Q62 60 50 72 Q38 60 38 44 Q38 30 50 20Z" fill="${c.base}" opacity="0.9"/>
    <path d="M50 20 Q44 28 41 38" fill="none" stroke="${c.light}" stroke-width="1.4" opacity="0.4"/>
    <rect x="46" y="34" width="8" height="26" rx="2" fill="${c.dark}" opacity="0.3"/>
    <rect x="46" y="33" width="8" height="26" rx="2" fill="${c.accent}"/>
    <rect x="37" y="42" width="26" height="8" rx="2" fill="${c.dark}" opacity="0.3"/>
    <rect x="37" y="41" width="26" height="8" rx="2" fill="${c.accent}"/>
    <rect x="47.4" y="34.5" width="1.6" height="24" fill="#fff" opacity="0.6"/>
    <circle cx="50" cy="45" r="26" fill="none" stroke="${c.light}" stroke-width="1" opacity="0.3"/>
    <circle cx="50" cy="45" r="19" fill="none" stroke="${c.light}" stroke-width="0.7" opacity="0.22"/>
  `,

  impact: (c) => `
    <circle cx="50" cy="52" r="19" fill="${c.dark}" opacity="0.35"/>
    <circle cx="50" cy="52" r="18" fill="${c.base}"/>
    <path d="M50 14 L57 40 L44 40 Z" fill="${c.dark}" opacity="0.3"/>
    <path d="M50 13 L56 39 L44 39 Z" fill="${c.accent}"/>
    <path d="M50 90 L57 64 L44 64 Z" fill="${c.dark}" opacity="0.3"/>
    <path d="M50 91 L56 65 L44 65 Z" fill="${c.accent}"/>
    <path d="M14 52 L40 46 L40 58 Z" fill="${c.dark}" opacity="0.3"/>
    <path d="M13 52 L40 45 L40 59 Z" fill="${c.accent}"/>
    <path d="M86 52 L60 46 L60 58 Z" fill="${c.dark}" opacity="0.3"/>
    <path d="M87 52 L60 45 L60 59 Z" fill="${c.accent}"/>
    <circle cx="50" cy="52" r="9" fill="${c.light}"/>
    <circle cx="47" cy="49" r="3" fill="#fff" opacity="0.6"/>
  `,
};

export function getSilhouette(key) {
  return SILHOUETTES[key] || SILHOUETTES.impact;
}
