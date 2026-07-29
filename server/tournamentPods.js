// Torneo pod lifecycle: 4 players queue with their own already-built Normal
// deck (no drafting), then play the same 2-semis-plus-a-final bracket as
// Draft mode, for the same prizes — via rooms.js's startDirectMatch, the
// exact same 1v1 engine/protocol as any other online match. No
// perkThreshold override here (unlike Draft): these are the player's own
// normal 16-card decks, so the normal 4-creature aura threshold applies.
// Parallel to server/draftPods.js, much shorter since there's no picking
// phase — a queued entry already has everything a bracket match needs.
import { validateDeck, startDirectMatch } from './rooms.js';
import { POD_SIZE, seedBracket, drawRandomCommonCard } from '../src/tournament.js';

function send(ws, message) {
  if (ws && ws.readyState === ws.OPEN) ws.send(JSON.stringify(message));
}

const tournamentQueue = []; // [{ ws, token, faction, deck }]

export function queueTournamentEntry({ ws, token, faction, deck }) {
  if (!validateDeck(deck)) return { error: 'Mazo inválido.' };
  if (tournamentQueue.some((e) => e.token === token)) return {};
  tournamentQueue.push({ ws, token, faction, deck });
  if (tournamentQueue.length >= POD_SIZE) {
    startPod(tournamentQueue.splice(0, POD_SIZE));
  } else {
    send(ws, { type: 'tournamentQueued', waiting: tournamentQueue.length, needed: POD_SIZE });
  }
  return {};
}

export function cancelTournamentQueue(ws) {
  const idx = tournamentQueue.findIndex((e) => e.ws === ws);
  if (idx !== -1) tournamentQueue.splice(idx, 1);
}

function startPod(seats) {
  const { semis } = seedBracket([0, 1, 2, 3]);
  const semiResults = [null, null];
  semis.forEach(([i, j], semiIndex) => {
    startBracketMatch(seats, i, j, (winnerSeat, loserSeat) => {
      semiResults[semiIndex] = { winner: winnerSeat, loser: loserSeat };
      awardPrize(seats, loserSeat, { commonCard: drawRandomCommonCard() });
      if (semiResults.every((r) => r)) {
        startBracketMatch(seats, semiResults[0].winner, semiResults[1].winner, (finalWinner, finalLoser) => {
          awardPrize(seats, finalWinner, { packs: ['gem_pack', 'coin_pack'] });
          awardPrize(seats, finalLoser, { packs: ['coin_pack'] });
        });
      }
    });
  });
}

function startBracketMatch(seats, seatA, seatB, onDone) {
  const a = seats[seatA];
  const b = seats[seatB];
  startDirectMatch(
    { ws: a.ws, token: a.token, faction: a.faction, deck: a.deck, autoPlay: false },
    { ws: b.ws, token: b.token, faction: b.faction, deck: b.deck, autoPlay: false },
    {
      onFinished: (winnerSide) => {
        const winnerSeat = winnerSide === 'p1' ? seatA : seatB;
        const loserSeat = winnerSide === 'p1' ? seatB : seatA;
        onDone(winnerSeat, loserSeat);
      },
    }
  );
}

function awardPrize(seats, seatIndex, prize) {
  send(seats[seatIndex].ws, { type: 'tournamentPrize', prize });
}

// No special mid-queue recovery beyond dropping the queue entry — once in
// the bracket, rooms.js's own handleDisconnect (registered independently
// per match via startDirectMatch/attachPlayer) already covers it.
export function handleTournamentDisconnect(ws) {
  cancelTournamentQueue(ws);
}

export function tournamentStats() {
  return { tournamentQueued: tournamentQueue.length };
}
