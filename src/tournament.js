// Torneo mode: 4 players pay to enter with their own already-built Normal
// deck (no drafting, no card picks) and play the same 2-semis-plus-a-final
// bracket as Draft mode, for the same prizes. Shared client/server module —
// see src/bracket.js for the pieces this reuses from Draft.
export { POD_SIZE, seedBracket, drawRandomCommonCard } from './bracket.js';

export const TOURNAMENT_ENTRY_SKU = { id: 'tournament_entry', label: 'Entrada a Torneo', priceLabel: '$3.99' };
