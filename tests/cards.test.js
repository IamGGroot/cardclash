import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { CARDS, FACTIONS, HEROES, RARITIES, getCard, getHero, cardsForFaction } from '../src/cards.js';

describe('cards data integrity', () => {
  test('every card id is unique', () => {
    const ids = CARDS.map((c) => c.id);
    assert.equal(new Set(ids).size, ids.length);
  });

  test('every card has a valid rarity, type, and faction', () => {
    for (const card of CARDS) {
      assert.ok(RARITIES.includes(card.rarity), `${card.id} has invalid rarity ${card.rarity}`);
      assert.ok(['creature', 'spell', 'fortune'].includes(card.type), `${card.id} has invalid type ${card.type}`);
      assert.ok(FACTIONS[card.faction], `${card.id} has unknown faction ${card.faction}`);
    }
  });

  test('every creature has a valid placement and positive stats', () => {
    for (const card of CARDS.filter((c) => c.type === 'creature')) {
      assert.ok(['melee', 'shooter', 'flyer'].includes(card.placement), `${card.id} has invalid placement`);
      assert.ok(card.atk >= 0, `${card.id} has negative atk`);
      assert.ok(card.retaliate >= 0, `${card.id} has negative retaliate`);
      assert.ok(card.life > 0, `${card.id} must have positive life`);
    }
  });

  test('every spell/fortune has a target', () => {
    for (const card of CARDS.filter((c) => c.type === 'spell' || c.type === 'fortune')) {
      assert.ok(card.target, `${card.id} is missing a target`);
      assert.ok(card.effect, `${card.id} is missing an effect`);
    }
  });

  test('cost and requirement are positive integers', () => {
    for (const card of CARDS) {
      assert.ok(Number.isInteger(card.cost) && card.cost > 0, `${card.id} has invalid cost`);
      assert.ok(Number.isInteger(card.requirement) && card.requirement > 0, `${card.id} has invalid requirement`);
    }
  });

  test('spells gate on magic-shaped requirement, fortunes on destiny, creatures on might (by convention, requirement <= cost)', () => {
    for (const card of CARDS) {
      assert.ok(card.requirement <= card.cost, `${card.id} requirement (${card.requirement}) exceeds cost (${card.cost})`);
    }
  });

  test('theme is derived from faction for every card', () => {
    for (const card of CARDS) {
      assert.equal(card.theme, FACTIONS[card.faction].theme);
    }
  });

  test('getCard finds a known card and returns undefined for unknown ids', () => {
    assert.equal(getCard('a1').name, 'Novicio');
    assert.equal(getCard('does-not-exist'), undefined);
  });

  test('cardsForFaction only returns cards from that faction', () => {
    for (const faction of Object.keys(FACTIONS)) {
      const cards = cardsForFaction(faction);
      assert.ok(cards.length > 0, `${faction} has no cards`);
      assert.ok(cards.every((c) => c.faction === faction));
    }
  });

  test('every playable faction (not neutral) has exactly one hero', () => {
    for (const faction of Object.keys(FACTIONS)) {
      if (faction === 'neutral') continue;
      const heroes = HEROES.filter((h) => h.faction === faction);
      assert.equal(heroes.length, 1, `${faction} should have exactly one hero`);
    }
  });

  test('getHero finds heroes by id', () => {
    const hero = getHero('hero-albura');
    assert.equal(hero.faction, 'albura');
  });

  test('neutral faction has no hero (not directly playable)', () => {
    assert.equal(HEROES.some((h) => h.faction === 'neutral'), false);
  });

  test('rarity gets scarcer per faction: common >= rare >= epic >= legendary', () => {
    for (const faction of Object.keys(FACTIONS)) {
      const counts = { common: 0, rare: 0, epic: 0, legendary: 0 };
      for (const card of cardsForFaction(faction)) counts[card.rarity] += 1;
      assert.ok(counts.common >= counts.rare, `${faction}: commons should be at least as common as rares`);
      assert.ok(counts.rare >= counts.epic, `${faction}: rares should be at least as common as epics`);
      assert.ok(counts.epic >= counts.legendary, `${faction}: epics should be at least as common as legendaries`);
    }
  });

  test('every onDeploy/onCombatDamage ability references a real effect id (non-empty string)', () => {
    for (const card of CARDS.filter((c) => c.ability)) {
      assert.ok(['onDeploy', 'onCombatDamage'].includes(card.ability.trigger), `${card.id} has unknown trigger`);
      assert.ok(typeof card.ability.effect === 'string' && card.ability.effect.length > 0, `${card.id} ability missing effect`);
    }
  });
});
