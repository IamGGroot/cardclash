// Torneo pod lifecycle: 4 players queue with their own already-built Normal
// deck (no drafting), then play the same 2-semis-plus-a-final bracket as
// Draft mode, for the same prizes — via rooms.js's startDirectMatch, the
// exact same 1v1 engine/protocol as any other online match. No
// perkThreshold override here (unlike Draft): these are the player's own
// normal 16-card decks, so the normal 4-creature aura threshold applies.
// Parallel to server/draftPods.js, much shorter since there's no picking
// phase — a queued entry already has everything a bracket match needs.
import { validateDeck, startDirectMatch, createBotOpponent, displayNameFor } from './rooms.js';
import { POD_SIZE, seedBracket, drawRandomCommonCard } from '../src/tournament.js';
import { env } from './env.js';

function send(ws, message) {
  if (ws && ws.readyState === ws.OPEN) ws.send(JSON.stringify(message));
}

// Same "wait a bit for real opponents, then fall back to bots" shape as
// Quick Match's QUICK_MATCH_BOT_TIMEOUT_MS / server/draftPods.js's own pod
// timeout — a lone (or short-handed) Torneo queue fills its remaining seats
// with bots instead of leaving the player waiting indefinitely.
const POD_BOT_TIMEOUT_MS = Number(env('TOURNAMENT_POD_BOT_TIMEOUT_MS', '5000'));

const tournamentQueue = []; // [{ ws, token, faction, deck }]
let tournamentQueueBotTimer = null;

export function queueTournamentEntry({ ws, token, faction, deck }) {
  if (!validateDeck(deck)) return { error: 'Mazo inválido.' };
  if (tournamentQueue.some((e) => e.token === token)) return {};
  tournamentQueue.push({ ws, token, faction, deck });
  if (tournamentQueue.length >= POD_SIZE) {
    clearTimeout(tournamentQueueBotTimer);
    tournamentQueueBotTimer = null;
    startPod(tournamentQueue.splice(0, POD_SIZE));
  } else {
    send(ws, { type: 'tournamentQueued', waiting: tournamentQueue.length, needed: POD_SIZE });
    if (!tournamentQueueBotTimer) tournamentQueueBotTimer = setTimeout(fillTournamentQueueWithBots, POD_BOT_TIMEOUT_MS);
  }
  return {};
}

// Fires POD_BOT_TIMEOUT_MS after the first entry joins an under-strength
// queue — a bot's faction/deck come straight from rooms.js's own Quick Match
// bot factory, so a Torneo bot opponent is built exactly the same way.
function fillTournamentQueueWithBots() {
  tournamentQueueBotTimer = null;
  if (tournamentQueue.length === 0) return; // everyone cancelled in the meantime
  const entries = tournamentQueue.splice(0, tournamentQueue.length);
  while (entries.length < POD_SIZE) {
    const bot = createBotOpponent(false);
    entries.push({ ws: bot.ws, token: bot.token, faction: bot.faction, deck: bot.deck, isBot: true, botName: bot.botName });
  }
  startPod(entries);
}

export function cancelTournamentQueue(ws) {
  const idx = tournamentQueue.findIndex((e) => e.ws === ws);
  if (idx !== -1) tournamentQueue.splice(idx, 1);
  if (tournamentQueue.length === 0 && tournamentQueueBotTimer) {
    clearTimeout(tournamentQueueBotTimer);
    tournamentQueueBotTimer = null;
  }
}

// Broadcasts the pod's whole bracket shape/progress to every seat (real ws
// only — send() no-ops for bots) — drives the client's floating
// bracket-status button + subscreen, same as server/draftPods.js's own
// broadcastBracket, since the 2 seats not currently in a live match
// otherwise have no visibility into what's happening in their pod.
function broadcastBracket(seats, bracket) {
  const payload = {
    type: 'tournamentBracketUpdate',
    seats: seats.map((seat) => ({ name: displayNameFor(seat), isBot: Boolean(seat.isBot) })),
    semis: bracket.semis,
    final: bracket.final,
  };
  for (const seat of seats) send(seat.ws, payload);
}

function startPod(seats) {
  const { semis } = seedBracket([0, 1, 2, 3]);
  const bracket = { semis: semis.map(([i, j]) => ({ players: [i, j], winner: null })), final: null };
  broadcastBracket(seats, bracket);

  const semiResults = [null, null];
  semis.forEach(([i, j], semiIndex) => {
    startBracketMatch(seats, bracket, i, j, bracket.semis[semiIndex], (winnerSeat, loserSeat) => {
      semiResults[semiIndex] = { winner: winnerSeat, loser: loserSeat };
      bracket.semis[semiIndex].winner = winnerSeat;
      awardPrize(seats, loserSeat, { commonCard: drawRandomCommonCard() });
      if (semiResults.every((r) => r)) {
        bracket.final = { players: [semiResults[0].winner, semiResults[1].winner], winner: null };
      }
      broadcastBracket(seats, bracket);
      if (semiResults.every((r) => r)) {
        startBracketMatch(seats, bracket, semiResults[0].winner, semiResults[1].winner, bracket.final, (finalWinner, finalLoser) => {
          bracket.final.winner = finalWinner;
          awardPrize(seats, finalWinner, { packs: ['gem_pack', 'coin_pack'] });
          awardPrize(seats, finalLoser, { packs: ['coin_pack'] });
          broadcastBracket(seats, bracket);
        });
      }
    });
  });
}

// `bracketEntry` is the exact semis[i]/final object this match corresponds
// to — stamping its deadline directly (rather than searching bracket by seat
// pair) works identically for both semis and the final.
function startBracketMatch(seats, bracket, seatA, seatB, bracketEntry, onDone) {
  const a = seats[seatA];
  const b = seats[seatB];
  startDirectMatch(
    { ws: a.ws, token: a.token, faction: a.faction, deck: a.deck, autoPlay: false, isBot: a.isBot, botName: a.botName },
    { ws: b.ws, token: b.token, faction: b.faction, deck: b.deck, autoPlay: false, isBot: b.isBot, botName: b.botName },
    {
      onStarted: (room) => {
        bracketEntry.deadline = room.matchDeadline;
        broadcastBracket(seats, bracket);
      },
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
