// State goes over the wire "mirrored" so each client always sees itself as
// p1 and the opponent as p2 — exactly the convention the existing
// single-player client already renders (it was built around a local player
// vs. an AI on p2). That lets the online battle screen reuse the entire
// rendering/animation layer unmodified; only how actions are dispatched and
// how state arrives differs.
//
// Sanitizing the opponent's hand/deck contents here (not just relying on the
// client not to render them) matters because the payload is inspectable in
// devtools — the server must simply never send information the viewer isn't
// allowed to see.

function cloneBattlefield(bf) {
  return bf.map((lane) => ({ front: lane.front ? { ...lane.front } : null, back: lane.back ? { ...lane.back } : null }));
}

function clonePlayer(p) {
  return {
    ...p,
    hand: [...p.hand],
    deck: [...p.deck],
    discard: [...p.discard],
    exile: [...p.exile],
    battlefield: cloneBattlefield(p.battlefield),
  };
}

export function cloneState(state) {
  return { ...state, p1: clonePlayer(state.p1), p2: clonePlayer(state.p2), stats: { ...state.stats } };
}

function flipSide(s) {
  return s === 'p1' ? 'p2' : s === 'p2' ? 'p1' : s;
}

export function viewFor(state, viewerSide) {
  const cloned = cloneState(state);
  // Every field that names a side ('active' turn owner, 'winner') has to be
  // re-expressed in the viewer's own p1-is-always-me terms, not just the
  // battlefield — otherwise the losing player's client still reads
  // winner === 'p1' as true and shows a victory screen for a match they lost.
  const mirrored =
    viewerSide === 'p2'
      ? { ...cloned, active: flipSide(cloned.active), winner: flipSide(cloned.winner), p1: cloned.p2, p2: cloned.p1 }
      : cloned;
  // Hide the opponent's actual card ids — counts are all the UI ever needs.
  mirrored.p2 = { ...mirrored.p2, hand: mirrored.p2.hand.map(() => null), deck: mirrored.p2.deck.map(() => null) };
  return mirrored;
}

// Re-expresses a step descriptor (see src/actions.js) from `viewerSide`'s
// point of view, so after mirroring `step.side === 'p1'` always means "I did
// this" and `'p2'` always means "the opponent did this", regardless of which
// canonical side actually acted.
export function mirrorStep(step, viewerSide) {
  if (!step || viewerSide !== 'p2') return step;
  const mirrored = { ...step, side: flipSide(step.side) };
  if (mirrored.target && mirrored.target.side) {
    mirrored.target = { ...mirrored.target, side: flipSide(mirrored.target.side) };
  }
  return mirrored;
}
