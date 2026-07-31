export const RARITIES = ['common', 'rare', 'epic', 'legendary'];

export const RARITY_COLORS = {
  common: '#8a94a6',
  rare: '#3d8bff',
  epic: '#a259ff',
  legendary: '#ffb020',
};

export const RARITY_LABEL = {
  common: 'Común',
  rare: 'Rara',
  epic: 'Épica',
  legendary: 'Legendaria',
};

// Original setting: four factions with their own resource/attribute-gated
// creatures, spells and fortunes, front/back lane placement, and
// Attack/Retaliate/Life combat.
export const FACTIONS = {
  albura: { id: 'albura', name: 'Albura', theme: 'holy', tagline: 'Orden de la luz — defensa y curación' },
  ignara: { id: 'ignara', name: 'Ignara', theme: 'fire', tagline: 'Legión de brasas — agresión y daño directo' },
  umbra: { id: 'umbra', name: 'Umbra', theme: 'shadow', tagline: 'Culto de las sombras — desgaste y reanimación' },
  terra: { id: 'terra', name: 'Terra', theme: 'earth', tagline: 'Clanes de piedra — furia y resistencia bruta' },
  neutral: { id: 'neutral', name: 'Gremio Errante', theme: 'neutral', tagline: 'Mercenarios sin bandera — se unen a cualquier ejército, a un precio mayor' },
};

export const HEROES = [
  { id: 'hero-albura', faction: 'albura', name: 'Elara Lumen', special: { id: 'heal_hero_2', label: 'Luz Sanadora', text: 'Curá 2 de vida a tu héroe.' } },
  { id: 'hero-ignara', faction: 'ignara', name: 'Malgor el Cruel', special: { id: 'damage_enemy_hero_1', label: 'Marca Ardiente', text: 'Hacé 1 de daño al héroe enemigo.' } },
  { id: 'hero-umbra', faction: 'umbra', name: 'Vesper el Pálido', special: { id: 'draw_card', label: 'Presagio', text: 'Robá una carta.' } },
  { id: 'hero-terra', faction: 'terra', name: 'Krag Rompepiedras', special: { id: 'damage_enemy_hero_2', label: 'Grito de Guerra', text: 'Hacé 2 de daño al héroe enemigo.' } },
];

// requirement: minimum attribute level needed (might for creatures, magic for spells, destiny for fortunes)
// placement (creatures only): 'melee' (front row only), 'shooter' (back row only), 'flyer' (either)
export const CARDS = [
  // ---- ALBURA ----
  { id: 'a1', faction: 'albura', name: 'Novicio', rarity: 'common', type: 'creature', cost: 1, requirement: 1, placement: 'melee', atk: 1, retaliate: 1, life: 2, silhouette: 'warrior' },
  { id: 'a2', faction: 'albura', name: 'Guardián Menor', rarity: 'common', type: 'creature', cost: 2, requirement: 2, placement: 'melee', atk: 2, retaliate: 2, life: 3, silhouette: 'knight' },
  { id: 'a3', faction: 'albura', name: 'Sanadora de Alba', rarity: 'common', type: 'creature', cost: 3, requirement: 2, placement: 'shooter', atk: 1, retaliate: 1, life: 3, silhouette: 'archer', ability: { trigger: 'onDeploy', effect: 'heal_hero_2' }, text: 'Al desplegarse: curá 2 a tu héroe.' },
  { id: 'a4', faction: 'albura', name: 'Ala de Luz', rarity: 'rare', type: 'creature', cost: 3, requirement: 3, placement: 'flyer', atk: 3, retaliate: 2, life: 3, silhouette: 'dragon' },
  { id: 'a5', faction: 'albura', name: 'Vengador Sacro', rarity: 'rare', type: 'creature', cost: 4, requirement: 4, placement: 'melee', atk: 4, retaliate: 3, life: 5, silhouette: 'knight' },
  { id: 'a6', faction: 'albura', name: 'Portador de Alba', rarity: 'epic', type: 'creature', cost: 5, requirement: 5, placement: 'melee', atk: 4, retaliate: 4, life: 6, silhouette: 'knight' },
  { id: 'a7', faction: 'albura', name: 'Bendición de Alba', rarity: 'common', type: 'spell', cost: 2, requirement: 2, target: 'ally_creature', effect: 'buff_2_2', value: 2, silhouette: 'heal', text: 'Una criatura aliada gana +2/+2.' },
  { id: 'a8', faction: 'albura', name: 'Favor de Alba', rarity: 'rare', type: 'fortune', cost: 2, requirement: 2, target: 'none', effect: 'draw_2', silhouette: 'heal', text: 'Robá 2 cartas.' },
  { id: 'a9', faction: 'albura', name: 'Toque de Alba', rarity: 'common', type: 'spell', cost: 2, requirement: 2, target: 'ally_creature', effect: 'heal_creature_2', value: 2, silhouette: 'heal', text: 'Una criatura aliada recupera 2 de vida (hasta su máximo).' },
  { id: 'a10', faction: 'albura', name: 'Amanecer Sagrado', rarity: 'rare', type: 'fortune', cost: 3, requirement: 3, target: 'none', effect: 'heal_hero_4', value: 4, silhouette: 'heal', text: 'Curá 4 de vida a tu héroe.' },
  { id: 'a11', faction: 'albura', name: 'Arcángel de Alba', rarity: 'legendary', type: 'creature', cost: 6, requirement: 6, placement: 'flyer', atk: 5, retaliate: 5, life: 7, silhouette: 'phoenix', ability: { trigger: 'onDeploy', effect: 'heal_hero_4' }, text: 'Al desplegarse: curá 4 a tu héroe.' },
  { id: 'a12', faction: 'albura', name: 'Custodio de Alba', rarity: 'common', type: 'creature', cost: 2, requirement: 2, placement: 'shooter', atk: 1, retaliate: 2, life: 4, silhouette: 'wall' },
  { id: 'a13', faction: 'albura', name: 'Escudero de Alba', rarity: 'common', type: 'creature', cost: 1, requirement: 1, placement: 'melee', atk: 1, retaliate: 2, life: 2, silhouette: 'warrior' },
  { id: 'a14', faction: 'albura', name: 'Ballestera de Alba', rarity: 'common', type: 'creature', cost: 2, requirement: 2, placement: 'shooter', atk: 2, retaliate: 1, life: 2, silhouette: 'archer' },
  { id: 'a15', faction: 'albura', name: 'Plegaria Menor', rarity: 'common', type: 'spell', cost: 1, requirement: 1, target: 'ally_creature', effect: 'heal_creature_1', value: 1, silhouette: 'heal', text: 'Una criatura aliada recupera 1 de vida (hasta su máximo).' },
  { id: 'a16', faction: 'albura', name: 'Voto de Alba', rarity: 'common', type: 'fortune', cost: 1, requirement: 1, target: 'none', effect: 'heal_hero_1', value: 1, silhouette: 'heal', text: 'Curá 1 de vida a tu héroe.' },
  { id: 'a17', faction: 'albura', name: 'Caballero Grifo', rarity: 'rare', type: 'creature', cost: 4, requirement: 3, placement: 'flyer', atk: 3, retaliate: 3, life: 4, silhouette: 'dragon' },
  { id: 'a18', faction: 'albura', name: 'Monje de Alba', rarity: 'rare', type: 'creature', cost: 3, requirement: 3, placement: 'melee', atk: 2, retaliate: 2, life: 4, silhouette: 'warrior', ability: { trigger: 'onCombatDamage', effect: 'heal_hero_1' }, text: 'Cuando hace daño en combate: curá 1 a tu héroe.' },
  { id: 'a19', faction: 'albura', name: 'Juicio Menor', rarity: 'rare', type: 'spell', cost: 4, requirement: 4, target: 'enemy_creature', effect: 'debuff_3_3', value: 3, silhouette: 'impact', text: 'Una criatura enemiga pierde -3/-3.' },
  { id: 'a20', faction: 'albura', name: 'Alba Eterna', rarity: 'rare', type: 'fortune', cost: 4, requirement: 4, target: 'none', effect: 'heal_hero_5', value: 5, silhouette: 'heal', text: 'Curá 5 de vida a tu héroe.' },
  { id: 'a21', faction: 'albura', name: 'Justiciera Celeste', rarity: 'epic', type: 'creature', cost: 5, requirement: 5, placement: 'flyer', atk: 4, retaliate: 4, life: 5, silhouette: 'phoenix', ability: { trigger: 'onDeploy', effect: 'heal_hero_3' }, text: 'Al desplegarse: curá 3 a tu héroe.' },
  { id: 'a22', faction: 'albura', name: 'Sanación Mayor', rarity: 'epic', type: 'spell', cost: 5, requirement: 5, target: 'ally_creature', effect: 'heal_creature_4', value: 4, silhouette: 'heal', text: 'Una criatura aliada recupera 4 de vida (hasta su máximo).' },
  { id: 'a23', faction: 'albura', name: 'Bendición del Alba Eterna', rarity: 'epic', type: 'fortune', cost: 5, requirement: 5, target: 'ally_creature', effect: 'buff_3_3', value: 3, silhouette: 'heal', text: 'Una criatura aliada gana +3/+3.' },
  { id: 'a24', faction: 'albura', name: 'Serafín Custodio', rarity: 'legendary', type: 'creature', cost: 6, requirement: 6, placement: 'flyer', atk: 6, retaliate: 5, life: 8, silhouette: 'phoenix', ability: { trigger: 'onDeploy', effect: 'heal_hero_4' }, text: 'Al desplegarse: curá 4 a tu héroe.' },
  { id: 'a25', faction: 'albura', name: 'Concilio de Alba', rarity: 'legendary', type: 'fortune', cost: 6, requirement: 6, target: 'none', effect: 'draw_3', silhouette: 'heal', text: 'Robá 3 cartas.' },
  { id: 'a26', faction: 'albura', name: 'Muro de Alba', rarity: 'common', type: 'creature', cost: 1, requirement: 1, placement: 'melee', atk: 0, retaliate: 3, life: 5, silhouette: 'wall', building: true, text: 'Fortificado: no puede atacar ni moverse.' },

  // ---- IGNARA ----
  { id: 'g1', faction: 'ignara', name: 'Chispa Menor', rarity: 'common', type: 'creature', cost: 1, requirement: 1, placement: 'flyer', atk: 1, retaliate: 0, life: 1, silhouette: 'raven' },
  { id: 'g2', faction: 'ignara', name: 'Bestia de Brasas', rarity: 'common', type: 'creature', cost: 2, requirement: 2, placement: 'melee', atk: 3, retaliate: 1, life: 2, silhouette: 'warrior' },
  { id: 'g3', faction: 'ignara', name: 'Sabueso Ardiente', rarity: 'common', type: 'creature', cost: 2, requirement: 2, placement: 'melee', atk: 2, retaliate: 1, life: 2, silhouette: 'wolf' },
  { id: 'g4', faction: 'ignara', name: 'Susurro de Ceniza', rarity: 'rare', type: 'creature', cost: 3, requirement: 2, placement: 'shooter', atk: 2, retaliate: 1, life: 3, silhouette: 'archer', ability: { trigger: 'onDeploy', effect: 'damage_enemy_hero_1' }, text: 'Al desplegarse: 1 de daño al héroe enemigo.' },
  { id: 'g5', faction: 'ignara', name: 'Guardián de Brasas', rarity: 'rare', type: 'creature', cost: 4, requirement: 4, placement: 'melee', atk: 4, retaliate: 2, life: 4, silhouette: 'wolf' },
  { id: 'g6', faction: 'ignara', name: 'Señor de Ignara', rarity: 'epic', type: 'creature', cost: 5, requirement: 5, placement: 'flyer', atk: 5, retaliate: 3, life: 5, silhouette: 'dragon' },
  { id: 'g7', faction: 'ignara', name: 'Chispa Ardiente', rarity: 'common', type: 'spell', cost: 2, requirement: 2, target: 'enemy_any', effect: 'damage_2', value: 2, silhouette: 'fireball', text: '2 de daño a una criatura o al héroe enemigo.' },
  { id: 'g8', faction: 'ignara', name: 'Furia de Ignara', rarity: 'epic', type: 'spell', cost: 4, requirement: 4, target: 'enemy_hero', effect: 'damage_4_hero', value: 4, silhouette: 'fireball', text: '4 de daño directo al héroe enemigo.' },
  { id: 'g10', faction: 'ignara', name: 'Pacto Ardiente', rarity: 'common', type: 'fortune', cost: 2, requirement: 2, target: 'ally_creature', effect: 'buff_2_2', value: 2, silhouette: 'fireelemental', text: 'Una criatura aliada gana +2/+2.' },
  { id: 'g11', faction: 'ignara', name: 'Chispa del Destino', rarity: 'common', type: 'fortune', cost: 1, requirement: 1, target: 'enemy_any', effect: 'damage_1', value: 1, silhouette: 'fireball', text: '1 de daño a una criatura o al héroe enemigo.' },
  { id: 'g12', faction: 'ignara', name: 'Ancestro Ardiente', rarity: 'legendary', type: 'creature', cost: 6, requirement: 6, placement: 'melee', atk: 7, retaliate: 3, life: 6, silhouette: 'titan', ability: { trigger: 'onDeploy', effect: 'damage_3' }, text: 'Al desplegarse: 3 de daño directo al héroe enemigo.' },
  { id: 'g13', faction: 'ignara', name: 'Arquero de Brasas', rarity: 'rare', type: 'creature', cost: 3, requirement: 3, placement: 'shooter', atk: 3, retaliate: 1, life: 2, silhouette: 'archer' },
  { id: 'g14', faction: 'ignara', name: 'Imp de Ceniza', rarity: 'common', type: 'creature', cost: 1, requirement: 1, placement: 'flyer', atk: 2, retaliate: 0, life: 1, silhouette: 'raven' },
  { id: 'g15', faction: 'ignara', name: 'Recluta de Brasas', rarity: 'common', type: 'creature', cost: 2, requirement: 2, placement: 'melee', atk: 2, retaliate: 1, life: 3, silhouette: 'warrior' },
  { id: 'g16', faction: 'ignara', name: 'Grito de Guerra', rarity: 'common', type: 'spell', cost: 1, requirement: 1, target: 'enemy_any', effect: 'damage_1', value: 1, silhouette: 'fireball', text: '1 de daño a una criatura o al héroe enemigo.' },
  { id: 'g17', faction: 'ignara', name: 'Ofrenda Ardiente', rarity: 'common', type: 'fortune', cost: 1, requirement: 1, target: 'ally_creature', effect: 'buff_1_1', value: 1, silhouette: 'fireelemental', text: 'Una criatura aliada gana +1/+1.' },
  { id: 'g18', faction: 'ignara', name: 'Verdugo de Ceniza', rarity: 'rare', type: 'creature', cost: 3, requirement: 3, placement: 'melee', atk: 3, retaliate: 1, life: 3, silhouette: 'warrior', ability: { trigger: 'onDeploy', effect: 'damage_enemy_hero_1' }, text: 'Al desplegarse: 1 de daño al héroe enemigo.' },
  { id: 'g19', faction: 'ignara', name: 'Jinete de Brasas', rarity: 'rare', type: 'creature', cost: 4, requirement: 4, placement: 'melee', atk: 4, retaliate: 2, life: 3, silhouette: 'wolf' },
  { id: 'g20', faction: 'ignara', name: 'Arquera Infernal', rarity: 'rare', type: 'creature', cost: 3, requirement: 2, placement: 'shooter', atk: 3, retaliate: 1, life: 2, silhouette: 'archer' },
  { id: 'g21', faction: 'ignara', name: 'Estampida Ardiente', rarity: 'rare', type: 'spell', cost: 4, requirement: 4, target: 'enemy_any', effect: 'damage_4', value: 4, silhouette: 'fireball', text: '4 de daño a una criatura o al héroe enemigo.' },
  { id: 'g22', faction: 'ignara', name: 'Pacto de Sangre', rarity: 'rare', type: 'fortune', cost: 4, requirement: 3, target: 'ally_creature', effect: 'buff_3_3', value: 3, silhouette: 'fireelemental', text: 'Una criatura aliada gana +3/+3.' },
  { id: 'g23', faction: 'ignara', name: 'Señor de la Estampida', rarity: 'epic', type: 'creature', cost: 5, requirement: 5, placement: 'melee', atk: 6, retaliate: 2, life: 5, silhouette: 'wolf', ability: { trigger: 'onCombatDamage', effect: 'damage_enemy_hero_1' }, text: 'Cuando hace daño en combate: 1 de daño directo al héroe enemigo.' },
  { id: 'g24', faction: 'ignara', name: 'Tormenta de Ignara', rarity: 'epic', type: 'spell', cost: 5, requirement: 5, target: 'enemy_any', effect: 'damage_5', value: 5, silhouette: 'fireball', text: '5 de daño a una criatura o al héroe enemigo.' },
  { id: 'g25', faction: 'ignara', name: 'Devorador de Cenizas', rarity: 'legendary', type: 'creature', cost: 6, requirement: 6, placement: 'flyer', atk: 6, retaliate: 4, life: 7, silhouette: 'dragon', ability: { trigger: 'onCombatDamage', effect: 'damage_enemy_hero_2' }, text: 'Cuando hace daño en combate: 2 de daño directo al héroe enemigo.' },
  { id: 'g26', faction: 'ignara', name: 'Tormenta Eterna', rarity: 'legendary', type: 'fortune', cost: 6, requirement: 6, target: 'none', effect: 'damage_6_hero', value: 6, silhouette: 'fireball', text: '6 de daño directo al héroe enemigo.' },
  { id: 'g27', faction: 'ignara', name: 'Fragua de Guerra', rarity: 'common', type: 'creature', cost: 1, requirement: 1, placement: 'melee', atk: 0, retaliate: 2, life: 4, silhouette: 'wall', building: true, text: 'Fortificado: no puede atacar ni moverse.' },

  // ---- UMBRA ----
  { id: 'u1', faction: 'umbra', name: 'Hueso Errante', rarity: 'common', type: 'creature', cost: 1, requirement: 1, placement: 'melee', atk: 1, retaliate: 1, life: 1, silhouette: 'warrior' },
  { id: 'u2', faction: 'umbra', name: 'Carne Marchita', rarity: 'common', type: 'creature', cost: 2, requirement: 2, placement: 'melee', atk: 1, retaliate: 1, life: 4, silhouette: 'warrior' },
  { id: 'u3', faction: 'umbra', name: 'Sediento Menor', rarity: 'common', type: 'creature', cost: 2, requirement: 2, placement: 'melee', atk: 2, retaliate: 2, life: 2, silhouette: 'darkknight' },
  { id: 'u4', faction: 'umbra', name: 'Aliento de Umbra', rarity: 'rare', type: 'creature', cost: 3, requirement: 3, placement: 'flyer', atk: 2, retaliate: 1, life: 3, silhouette: 'raven' },
  { id: 'u5', faction: 'umbra', name: 'Caballero Sediento', rarity: 'rare', type: 'creature', cost: 4, requirement: 4, placement: 'melee', atk: 3, retaliate: 2, life: 4, silhouette: 'darkknight', ability: { trigger: 'onCombatDamage', effect: 'heal_hero_1' }, text: 'Cuando hace daño en combate: curá 1 a tu héroe.' },
  { id: 'u6', faction: 'umbra', name: 'Devorador de Huesos', rarity: 'legendary', type: 'creature', cost: 6, requirement: 6, placement: 'flyer', atk: 6, retaliate: 4, life: 6, silhouette: 'dragon' },
  { id: 'u10', faction: 'umbra', name: 'Arquera Espectral', rarity: 'rare', type: 'creature', cost: 3, requirement: 2, placement: 'shooter', atk: 2, retaliate: 1, life: 3, silhouette: 'archer', ability: { trigger: 'onDeploy', effect: 'heal_hero_1' }, text: 'Al desplegarse: curá 1 a tu héroe.' },
  { id: 'u7', faction: 'umbra', name: 'Marchitar', rarity: 'common', type: 'spell', cost: 1, requirement: 1, target: 'enemy_creature', effect: 'debuff_2_2', value: 2, silhouette: 'impact', text: 'Una criatura enemiga pierde -2/-2.' },
  { id: 'u8', faction: 'umbra', name: 'Eco de Umbra', rarity: 'rare', type: 'fortune', cost: 1, requirement: 1, target: 'none', effect: 'reanimate', silhouette: 'necromancer', text: 'Devolvé una criatura al azar de tu cementerio a la mano.' },
  { id: 'u9', faction: 'umbra', name: 'Llamado de la Tumba', rarity: 'epic', type: 'fortune', cost: 3, requirement: 3, target: 'none', effect: 'reanimate_to_play', silhouette: 'necromancer', text: 'Devolvé una criatura al azar de tu cementerio directamente al campo de batalla.' },
  { id: 'u11', faction: 'umbra', name: 'Sentencia de Umbra', rarity: 'epic', type: 'spell', cost: 4, requirement: 4, target: 'enemy_creature', effect: 'destroy_creature', silhouette: 'impact', text: 'Destruye a la criatura enemiga objetivo, sin importar su vida.' },
  { id: 'u12', faction: 'umbra', name: 'Conde Sediento', rarity: 'epic', type: 'creature', cost: 5, requirement: 5, placement: 'melee', atk: 5, retaliate: 3, life: 5, silhouette: 'darkknight', ability: { trigger: 'onCombatDamage', effect: 'heal_hero_2' }, text: 'Cuando hace daño en combate: curá 2 a tu héroe.' },
  { id: 'u13', faction: 'umbra', name: 'Esqueleto Errante', rarity: 'common', type: 'creature', cost: 1, requirement: 1, placement: 'melee', atk: 1, retaliate: 0, life: 2, silhouette: 'warrior' },
  { id: 'u14', faction: 'umbra', name: 'Zombi Menor', rarity: 'common', type: 'creature', cost: 2, requirement: 2, placement: 'melee', atk: 1, retaliate: 1, life: 3, silhouette: 'warrior' },
  { id: 'u15', faction: 'umbra', name: 'Espectro Menor', rarity: 'common', type: 'creature', cost: 1, requirement: 1, placement: 'flyer', atk: 1, retaliate: 0, life: 1, silhouette: 'raven' },
  { id: 'u16', faction: 'umbra', name: 'Susurro de Tumba', rarity: 'common', type: 'spell', cost: 1, requirement: 1, target: 'enemy_creature', effect: 'debuff_1_1', value: 1, silhouette: 'impact', text: 'Una criatura enemiga pierde -1/-1.' },
  { id: 'u17', faction: 'umbra', name: 'Pacto Sombrío', rarity: 'common', type: 'fortune', cost: 1, requirement: 1, target: 'none', effect: 'draw_card', silhouette: 'necromancer', text: 'Robá una carta.' },
  { id: 'u18', faction: 'umbra', name: 'Maldición Débil', rarity: 'common', type: 'spell', cost: 2, requirement: 1, target: 'enemy_any', effect: 'damage_1', value: 1, silhouette: 'impact', text: '1 de daño a una criatura o al héroe enemigo.' },
  { id: 'u19', faction: 'umbra', name: 'Caballero Espectral', rarity: 'rare', type: 'creature', cost: 4, requirement: 4, placement: 'flyer', atk: 3, retaliate: 2, life: 4, silhouette: 'darkknight' },
  { id: 'u20', faction: 'umbra', name: 'Guardián de Huesos', rarity: 'rare', type: 'creature', cost: 3, requirement: 3, placement: 'melee', atk: 2, retaliate: 3, life: 4, silhouette: 'wall' },
  { id: 'u21', faction: 'umbra', name: 'Robo de Vida', rarity: 'rare', type: 'spell', cost: 3, requirement: 3, target: 'enemy_creature', effect: 'damage_3', value: 3, silhouette: 'impact', text: '3 de daño a una criatura enemiga.' },
  { id: 'u22', faction: 'umbra', name: 'Pacto de Sangre Umbría', rarity: 'rare', type: 'fortune', cost: 3, requirement: 3, target: 'ally_creature', effect: 'buff_2_2', value: 2, silhouette: 'necromancer', text: 'Una criatura aliada gana +2/+2.' },
  { id: 'u23', faction: 'umbra', name: 'Señora de las Sombras', rarity: 'epic', type: 'creature', cost: 5, requirement: 5, placement: 'flyer', atk: 5, retaliate: 3, life: 5, silhouette: 'dragon', ability: { trigger: 'onCombatDamage', effect: 'heal_hero_2' }, text: 'Cuando hace daño en combate: curá 2 a tu héroe.' },
  { id: 'u24', faction: 'umbra', name: 'Liche Soberano', rarity: 'legendary', type: 'creature', cost: 6, requirement: 6, placement: 'melee', atk: 6, retaliate: 4, life: 7, silhouette: 'necromancer', ability: { trigger: 'onDeploy', effect: 'reanimate_to_play' }, text: 'Al desplegarse: devolvé una criatura al azar de tu cementerio directamente al campo de batalla.' },
  { id: 'u25', faction: 'umbra', name: 'Corona de la Perdición', rarity: 'legendary', type: 'fortune', cost: 5, requirement: 5, target: 'none', effect: 'draw_3', silhouette: 'necromancer', text: 'Robá 3 cartas.' },
  { id: 'u26', faction: 'umbra', name: 'Tumba Sellada', rarity: 'common', type: 'creature', cost: 1, requirement: 1, placement: 'melee', atk: 0, retaliate: 2, life: 5, silhouette: 'wall', building: true, text: 'Fortificado: no puede atacar ni moverse.' },

  // ---- TERRA (clanes de piedra — orcos, ogros y cíclopes de las cumbres) ----
  { id: 't1', faction: 'terra', name: 'Goblin Merodeador', rarity: 'common', type: 'creature', cost: 1, requirement: 1, placement: 'melee', atk: 2, retaliate: 0, life: 1, silhouette: 'warrior' },
  { id: 't2', faction: 'terra', name: 'Recluta de Clan', rarity: 'common', type: 'creature', cost: 2, requirement: 2, placement: 'melee', atk: 2, retaliate: 2, life: 3, silhouette: 'warrior' },
  { id: 't3', faction: 'terra', name: 'Lancero de Piedra', rarity: 'common', type: 'creature', cost: 2, requirement: 1, placement: 'shooter', atk: 2, retaliate: 1, life: 2, silhouette: 'archer' },
  { id: 't4', faction: 'terra', name: 'Jabalí de Guerra', rarity: 'common', type: 'creature', cost: 2, requirement: 2, placement: 'melee', atk: 3, retaliate: 1, life: 2, silhouette: 'wolf' },
  { id: 't5', faction: 'terra', name: 'Escudo de Clan', rarity: 'common', type: 'creature', cost: 3, requirement: 3, placement: 'melee', atk: 2, retaliate: 3, life: 4, silhouette: 'wall' },
  { id: 't6', faction: 'terra', name: 'Chamán de Piedra', rarity: 'common', type: 'creature', cost: 3, requirement: 2, placement: 'shooter', atk: 2, retaliate: 1, life: 3, silhouette: 'archer', ability: { trigger: 'onDeploy', effect: 'heal_hero_1' }, text: 'Al desplegarse: curá 1 a tu héroe.' },
  { id: 't7', faction: 'terra', name: 'Golpe Certero', rarity: 'common', type: 'spell', cost: 2, requirement: 1, target: 'enemy_any', effect: 'damage_2', value: 2, silhouette: 'impact', text: '2 de daño a una criatura o al héroe enemigo.' },
  { id: 't8', faction: 'terra', name: 'Grito Feroz', rarity: 'common', type: 'spell', cost: 1, requirement: 1, target: 'ally_creature', effect: 'buff_1_1', value: 1, silhouette: 'storm', text: 'Una criatura aliada gana +1/+1.' },
  { id: 't9', faction: 'terra', name: 'Piedra de la Suerte', rarity: 'common', type: 'fortune', cost: 1, requirement: 1, target: 'none', effect: 'draw_card', silhouette: 'storm', text: 'Robá una carta.' },
  { id: 't10', faction: 'terra', name: 'Aliento de Clan', rarity: 'common', type: 'fortune', cost: 2, requirement: 1, target: 'none', effect: 'heal_hero_2', value: 2, silhouette: 'heal', text: 'Curá 2 de vida a tu héroe.' },
  { id: 't11', faction: 'terra', name: 'Ogro de Clan', rarity: 'rare', type: 'creature', cost: 4, requirement: 4, placement: 'melee', atk: 5, retaliate: 2, life: 5, silhouette: 'titan' },
  { id: 't12', faction: 'terra', name: 'Jinete de Jabalí', rarity: 'rare', type: 'creature', cost: 3, requirement: 3, placement: 'melee', atk: 3, retaliate: 2, life: 3, silhouette: 'wolf' },
  { id: 't13', faction: 'terra', name: 'Arrojador de Rocas', rarity: 'rare', type: 'creature', cost: 3, requirement: 2, placement: 'shooter', atk: 3, retaliate: 1, life: 3, silhouette: 'archer' },
  { id: 't14', faction: 'terra', name: 'Guardia Cíclope', rarity: 'rare', type: 'creature', cost: 4, requirement: 4, placement: 'melee', atk: 3, retaliate: 4, life: 5, silhouette: 'golem' },
  { id: 't15', faction: 'terra', name: 'Cazador de las Cumbres', rarity: 'rare', type: 'creature', cost: 4, requirement: 4, placement: 'flyer', atk: 4, retaliate: 2, life: 3, silhouette: 'raven' },
  { id: 't16', faction: 'terra', name: 'Terremoto Menor', rarity: 'rare', type: 'spell', cost: 3, requirement: 3, target: 'enemy_creature', effect: 'debuff_3_3', value: 3, silhouette: 'impact', text: 'Una criatura enemiga pierde -3/-3.' },
  { id: 't17', faction: 'terra', name: 'Furia de Clan', rarity: 'rare', type: 'spell', cost: 3, requirement: 3, target: 'enemy_any', effect: 'damage_4', value: 4, silhouette: 'impact', text: '4 de daño a una criatura o al héroe enemigo.' },
  { id: 't18', faction: 'terra', name: 'Bendición de Piedra', rarity: 'rare', type: 'fortune', cost: 3, requirement: 3, target: 'ally_creature', effect: 'buff_3_3', value: 3, silhouette: 'storm', text: 'Una criatura aliada gana +3/+3.' },
  { id: 't19', faction: 'terra', name: 'Cíclope Ancestral', rarity: 'epic', type: 'creature', cost: 5, requirement: 5, placement: 'melee', atk: 6, retaliate: 3, life: 6, silhouette: 'titan', ability: { trigger: 'onCombatDamage', effect: 'damage_enemy_hero_1' }, text: 'Cuando hace daño en combate: 1 de daño directo al héroe enemigo.' },
  { id: 't20', faction: 'terra', name: 'Behemot de Clan', rarity: 'epic', type: 'creature', cost: 5, requirement: 5, placement: 'melee', atk: 5, retaliate: 4, life: 6, silhouette: 'titan' },
  { id: 't21', faction: 'terra', name: 'Avalancha', rarity: 'epic', type: 'spell', cost: 5, requirement: 5, target: 'enemy_any', effect: 'damage_5', value: 5, silhouette: 'impact', text: '5 de daño a una criatura o al héroe enemigo.' },
  { id: 't22', faction: 'terra', name: 'Furia Ancestral', rarity: 'epic', type: 'fortune', cost: 4, requirement: 4, target: 'ally_creature', effect: 'buff_4_4', value: 4, silhouette: 'storm', text: 'Una criatura aliada gana +4/+4.' },
  { id: 't23', faction: 'terra', name: 'Gran Behemot de Terra', rarity: 'legendary', type: 'creature', cost: 6, requirement: 6, placement: 'melee', atk: 7, retaliate: 4, life: 7, silhouette: 'titan' },
  { id: 't24', faction: 'terra', name: 'Señor de los Clanes', rarity: 'legendary', type: 'creature', cost: 6, requirement: 6, placement: 'melee', atk: 7, retaliate: 4, life: 7, silhouette: 'golem', ability: { trigger: 'onDeploy', effect: 'damage_enemy_hero_2' }, text: 'Al desplegarse: 2 de daño directo al héroe enemigo.' },
  { id: 't25', faction: 'terra', name: 'Grito de Guerra Ancestral', rarity: 'legendary', type: 'fortune', cost: 6, requirement: 6, target: 'none', effect: 'damage_4_hero', value: 4, silhouette: 'storm', text: '4 de daño directo al héroe enemigo.' },
  { id: 't26', faction: 'terra', name: 'Bastión de Piedra', rarity: 'common', type: 'creature', cost: 1, requirement: 1, placement: 'melee', atk: 0, retaliate: 4, life: 6, silhouette: 'wall', building: true, text: 'Fortificado: no puede atacar ni moverse.' },

  // ---- GREMIO ERRANTE (jugables en cualquier mazo, algo más débiles) ----
  { id: 'n1', faction: 'neutral', name: 'Golem de Piedra', rarity: 'common', type: 'creature', cost: 3, requirement: 2, placement: 'melee', atk: 2, retaliate: 1, life: 2, silhouette: 'golem' },
  { id: 'n2', faction: 'neutral', name: 'Titán de Piedra', rarity: 'common', type: 'creature', cost: 5, requirement: 4, placement: 'melee', atk: 4, retaliate: 2, life: 6, silhouette: 'titan' },
  { id: 'n3', faction: 'neutral', name: 'Chispa Errante', rarity: 'common', type: 'spell', cost: 2, requirement: 1, target: 'enemy_any', effect: 'damage_1', value: 1, silhouette: 'storm', text: '1 de daño a una criatura o al héroe enemigo.' },
  { id: 'n4', faction: 'neutral', name: 'Debilidad Errante', rarity: 'common', type: 'spell', cost: 2, requirement: 1, target: 'enemy_creature', effect: 'debuff_1_1', value: 1, silhouette: 'iceguardian', text: 'Una criatura enemiga pierde -1/-1.' },
  { id: 'n5', faction: 'neutral', name: 'Golpe de Suerte', rarity: 'common', type: 'fortune', cost: 2, requirement: 1, target: 'none', effect: 'draw_card', silhouette: 'phoenix', text: 'Robá una carta.' },
  { id: 'n6', faction: 'neutral', name: 'Aliento Vital', rarity: 'common', type: 'fortune', cost: 2, requirement: 1, target: 'none', effect: 'heal_hero_1', silhouette: 'heal', text: 'Curá 1 de vida a tu héroe.' },
  { id: 'n7', faction: 'neutral', name: 'Explorador Errante', rarity: 'common', type: 'creature', cost: 2, requirement: 1, placement: 'melee', atk: 2, retaliate: 1, life: 2, silhouette: 'warrior' },
  { id: 'n8', faction: 'neutral', name: 'Arquero Mercenario', rarity: 'common', type: 'creature', cost: 3, requirement: 2, placement: 'shooter', atk: 2, retaliate: 1, life: 3, silhouette: 'archer' },
  { id: 'n9', faction: 'neutral', name: 'Golpe Errante', rarity: 'common', type: 'spell', cost: 2, requirement: 1, target: 'enemy_any', effect: 'damage_2', value: 2, silhouette: 'storm', text: '2 de daño a una criatura o al héroe enemigo.' },
  { id: 'n10', faction: 'neutral', name: 'Favor Errante', rarity: 'common', type: 'fortune', cost: 2, requirement: 1, target: 'ally_creature', effect: 'buff_1_1', value: 1, silhouette: 'storm', text: 'Una criatura aliada gana +1/+1.' },
  { id: 'n11', faction: 'neutral', name: 'Golem de Guerra', rarity: 'rare', type: 'creature', cost: 5, requirement: 3, placement: 'melee', atk: 4, retaliate: 3, life: 5, silhouette: 'golem' },
  { id: 'n12', faction: 'neutral', name: 'Centinela Alado', rarity: 'rare', type: 'creature', cost: 4, requirement: 3, placement: 'flyer', atk: 3, retaliate: 2, life: 3, silhouette: 'raven' },
  { id: 'n13', faction: 'neutral', name: 'Tormenta Errante', rarity: 'rare', type: 'spell', cost: 4, requirement: 3, target: 'enemy_any', effect: 'damage_4', value: 4, silhouette: 'storm', text: '4 de daño a una criatura o al héroe enemigo.' },
  { id: 'n14', faction: 'neutral', name: 'Pacto del Mercenario', rarity: 'epic', type: 'fortune', cost: 5, requirement: 3, target: 'ally_creature', effect: 'buff_3_3', value: 3, silhouette: 'storm', text: 'Una criatura aliada gana +3/+3.' },
];

for (const card of CARDS) {
  card.theme = FACTIONS[card.faction].theme;
}

export function getCard(id) {
  return CARDS.find((c) => c.id === id);
}

export function getHero(id) {
  return HEROES.find((h) => h.id === id);
}

export function cardsForFaction(faction) {
  return CARDS.filter((c) => c.faction === faction);
}
