// Autodeckbuilder: a side that plays itself. Same rules as a normal match —
// same hero, same attribute gates, same combat — except nobody chooses hero
// actions or which card to play: the hero action is picked automatically
// (see ai.js's chooseHeroAction), and at most one card (creature preferred,
// falling back to a spell/fortune) is cast per turn if the mana is there.
// Shared by both the client (vs AI, or the local side of an online match
// with an autoplay deck) and the server (the other side of an online match
// when it's also autoplaying) — same convention as battle.js/ai.js.
import { chooseHeroAction, castSpellsAndFortunesSteps, deployCreaturesSteps, runAttacksSteps } from './ai.js';

export function* runAutoDeckTurnSteps(state, side) {
  const heroStep = chooseHeroAction(state, side);
  if (heroStep) yield heroStep;
  if (state.winner) return;

  // Exactly one card this turn: try to deploy a creature first (board
  // presence is what actually wins fights), and only reach for a
  // spell/fortune if no creature in hand was playable this turn.
  const deployGen = deployCreaturesSteps(state, side);
  const deployed = deployGen.next();
  if (!deployed.done) {
    yield deployed.value;
  } else {
    const spellGen = castSpellsAndFortunesSteps(state, side);
    const cast = spellGen.next();
    if (!cast.done) yield cast.value;
  }
  if (state.winner) return;

  yield* runAttacksSteps(state, side);
}

// Convenience wrapper for callers that just want the whole turn applied at
// once, without observing individual steps (mirrors ai.js's runAiTurn).
export function runAutoDeckTurn(state, side) {
  for (const _step of runAutoDeckTurnSteps(state, side)) {
    // draining the generator applies every step synchronously
  }
}
