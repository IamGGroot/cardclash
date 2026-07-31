import { CARDS, getCard, getHero, HEROES, FACTIONS, cardsForFaction, RARITY_COLORS, RARITY_LABEL } from './cards.js';
import * as Store from './store.js';
import {
  PACKS,
  GEM_SKUS,
  COIN_SKUS,
  DUST_SKUS,
  WELCOME_OFFER,
  SEASON_PASS_SKU,
  getArenaOffer,
  openPack,
  matchReward,
  AD_REWARD,
  AD_DAILY_LIMIT,
  canWatchAd,
  recordAdWatch,
  adsWatchedToday,
} from './economy.js';
import {
  newGame,
  levelUpAttribute,
  useHeroSpecial,
  playCreature,
  replaceCreature,
  playSpellOrFortune,
  getValidAttackTargets,
  getValidMoveTargets,
  moveCreature,
  attack,
  endTurn,
} from './battle.js';
import { runAiTurnSteps } from './ai.js';
import { runAutoDeckTurn } from './autoDeck.js';
import { FACTION_PERKS, getActiveFactionPerks, countFieldCreaturesByFaction, effectiveAtk, effectiveRetaliate, effectiveLife, effectiveMaxLife } from './factionPerks.js';
import { cardArtSVG, AVATARS } from './art.js';
import * as Missions from './missions.js';
import * as DailyDeals from './dailyDeals.js';
import * as SeasonPass from './seasonPass.js';
import * as Ladder from './ladder.js';
import * as Draft from './draft.js';
import * as Tournament from './tournament.js';
import * as Achievements from './achievements.js';
import * as Stats from './stats.js';
import { sfx, vibrate, setSoundEnabled, isSoundEnabled, setHapticsEnabled, isHapticsEnabled } from './sound.js';
import * as Net from './net.js';

const app = document.getElementById('app');
let save = Store.load();
setSoundEnabled(save.soundEnabled !== false);
setHapticsEnabled(save.vibrationEnabled !== false);
let screen = 'home';
let battle = null;
let deckMode = 'normal'; // 'normal' | 'auto' — which deck (save.deck / save.autoDeck) renderDeckSelect/renderDeckbuilder show
let collectionFactionTab = 'all'; // 'all' or a faction id — which section renderCollection shows
let deckbuilderFactionTab = 'all'; // same idea, for renderDeckbuilder
let lastPackReveal = null;
let revealReturnScreen = 'shop'; // where renderReveal's "Continuar" button goes — draft reveals redirect elsewhere
let pendingPackId = null; // paid-for pack waiting to be dragged open

// ---- Draft mode state (all transient — never persisted to `save`; the
// server is the sole source of truth for an in-progress draft, same as
// `battle` itself is for an in-progress online match) ----
let draftPack = null; // current pack of full card objects offered to this seat, or null between packs
let draftPickCount = 0;
let draftQueueStatus = null; // { waiting, needed } while in the entry queue
let draftPickDeadline = 0; // Date.now() timestamp the current pack's timer expires at, for the countdown bar
let draftPicksSoFar = []; // full card objects picked so far this draft, oldest first — for the hero-pick faction hint
let draftHeroChosen = false;
let tournamentQueueStatus = null; // { waiting, needed } while in the Torneo entry queue

// ---- Bracket status (Draft + Torneo) ----
// Neither mode has its own dedicated "here's what's happening in your pod"
// screen — once a player is done with their own part (drafting/hero pick,
// or just queueing for Torneo) they otherwise just see a bare "esperando"
// spinner with zero visibility into the other 3 seats' semis/final. This
// mirrors that state from the server's draftBracketUpdate/
// tournamentBracketUpdate broadcasts (see server/draftPods.js and
// server/tournamentPods.js) into a floating button + on-demand subscreen,
// visible on any screen except an actual battle. `kind` distinguishes which
// mode's prize/labels to show; cleared once the pod finishes (its final
// broadcast already reflects the resolved final) after a short delay so the
// result is still visible for a moment rather than vanishing instantly.
let bracketStatus = null; // { kind: 'draft'|'tournament', seats, semis, final, startedAt }
let bracketModalOpen = false;
let bracketElapsedTimerId = null;
// Latches true the instant this seat's own prize arrives (see
// bracketPrizeReveal) — the server sends that prize and one more trailing
// bracketUpdate for the same event as two separate messages, and without
// this flag the trailing update would resurrect bracketStatus right after
// bracketPrizeReveal cleared it, leaving the status FAB's timer stuck on
// screen with nothing left to ever clear it again.
let bracketFinishedForMe = false;

let pendingPlacement = null; // { idx, card } while choosing a slot for a creature
let pendingTarget = null; // { idx, card } while choosing a target for a spell/fortune
let pendingReplace = null; // { idx, card, laneIndex, row, oldCard } while confirming a sacrifice-and-replace deploy onto an occupied own slot
let selectedAttacker = null; // { laneIndex, row } while choosing an attack target
let missionsTabExpanded = false; // home screen's side tab, toggled by tap (desktop also gets :hover)
let missionsScreenTab = 'daily'; // which sub-tab the Misiones screen is showing: 'daily' or an Achievements category id
let prevOccupancy = new Set();
let suppressClick = false; // set right after a drag-drop resolves, to swallow the click that follows
let battleMenuOpen = false;
let forfeitConfirmOpen = false;
let endTurnConfirmOpen = false;
let dailyResetTimerId = null;
let openPile = null; // { side, kind } while a graveyard/exile pile modal is open
let profileEditingName = false; // true while the profile screen shows the rename input
let avatarPickerOpen = false; // true while the profile screen shows the avatar grid
let deleteAccountConfirmOpen = false; // true while the profile screen shows the delete-account confirm modal
let playMenuOpen = false; // true while home shows the "vs IA / Online" popup under the battle button
let topMenuOpen = false; // true while the shared topbar's ☰ dropdown (sound/haptics/tutorial) is open
let aiToastEl = null;
let aiToastHideTimer = null;
let p1AutoPlay = false; // true while the player's own side is an Autodeckbuilder deck playing itself

// ---- Online multiplayer state ----
let onlineRoom = null; // { code } once a real match against another player is live
let onlineIntent = null; // { mode: 'quick'|'create'|'join', code? } set right before startOnlineMatch()
let onlineStatus = null; // { kind: 'connecting'|'queued'|'creating'|'waitingCode'|'joining'|'error', message?, code? } drives renderOnlineWaiting
let opponentName = null; // display name for the current online match's opponent — a real username, or the matchmaking bot's random name
let pendingTrophyResult = null; // { trophies, delta } from the most recent online matchEnd, consumed once by endMatch()
let matchDeadline = null; // server timestamp (Date.now()-based) the current online match's 5-minute clock expires at — whoever has more hero HP then wins
let matchTimerIntervalId = null;

// ---- Guided first-battle tutorial coach ----
// Runs on top of a REAL vs-AI match (not a scripted fake one). Each
// milestone is checked against live `battle` state, but once reached it's
// latched in tutorialProgress — battle.js legitimately resets fields like
// heroActionUsed at the start of every turn, so reading them raw on turn 2
// would make the coach think the player still needs to be taught something
// they already did on turn 1. "Attacked" has no state field of its own, so
// it's set directly by the single tap-to-attack call site.
let tutorialCoachActive = false;
let tutorialProgress = null; // { heroAction, deployed, endedTurn, attacked }

function isOnline() {
  return onlineRoom !== null;
}
const AI_STEP_DELAY = 650; // ms an opponent action stays visible before the next one plays

function persist() {
  Store.save(save);
}

// Claim buttons re-render their whole screen (app.innerHTML = ...), which
// resets .screen's scrollTop to 0 — annoying when claiming an item low in a
// long list. Captures/restores the scroll position around the re-render.
function rerenderPreservingScroll(renderFn) {
  const screenEl = document.querySelector('.screen');
  const scrollTop = screenEl ? screenEl.scrollTop : 0;
  renderFn();
  // renderFn replaces the whole app.innerHTML (topbar included), same as
  // the router's render() — so it needs the same post-render rewiring, or
  // the freshly-rebuilt topbar (claim badges, profile chip, ☰ menu) and any
  // tooltips on this screen are left with no listeners at all.
  wireTooltips();
  wireHeader();
  wireCardTilt();
  const nextScreenEl = document.querySelector('.screen');
  if (nextScreenEl) nextScreenEl.scrollTop = scrollTop;
}

function go(next) {
  clearDailyResetTimer();
  screen = next;
  selectedAttacker = null;
  pendingPlacement = null;
  pendingTarget = null;
  pendingReplace = null;
  playMenuOpen = false;
  topMenuOpen = false;
  render();
}

function formatCountdown(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = String(Math.floor(total / 3600)).padStart(2, '0');
  const m = String(Math.floor((total % 3600) / 60)).padStart(2, '0');
  const s = String(total % 60).padStart(2, '0');
  return `${h}:${m}:${s}`;
}

function clearDailyResetTimer() {
  if (dailyResetTimerId) {
    clearInterval(dailyResetTimerId);
    dailyResetTimerId = null;
  }
}

function startDailyResetTimer(elId, onExpire) {
  clearDailyResetTimer();
  const tick = () => {
    const el = document.getElementById(elId);
    if (!el) {
      clearDailyResetTimer();
      return;
    }
    const remaining = Missions.msUntilNextReset();
    if (remaining <= 0) {
      clearDailyResetTimer();
      onExpire();
      return;
    }
    el.textContent = `⏱ ${formatCountdown(remaining)}`;
  };
  tick();
  dailyResetTimerId = setInterval(tick, 1000);
}

// Achievements' one computed (non-`save.stats`) statKey — season pass level
// is already tracked live by seasonPass.js, so achievements.js reads it via
// this override instead of duplicating a counter for it.
function achievementOverrides() {
  return { seasonPassLevel: SeasonPass.getLevel(save) };
}

function totalMissionsClaimable() {
  return Missions.countClaimable(save) + Achievements.countClaimable(save, achievementOverrides());
}

function header() {
  const missionsClaimable = totalMissionsClaimable();
  const spClaimable = SeasonPass.countClaimable(save);
  return `
    <div class="topbar">
      <button class="profile-chip" id="profile-chip" data-tooltip="Perfil y cuenta">
        <span class="profile-chip-avatar">${avatarInnerHtml(save.avatar)}</span>
        <span class="profile-chip-name">${escapeHtml(save.username || 'Jugador')}</span>
      </button>
      <div class="topbar-scroll">
        <div class="currency" data-tooltip="Monedas">🪙 ${save.coins}</div>
        <div class="currency" data-tooltip="Gemas">💎 ${save.gems}</div>
        <div class="currency" data-tooltip="Polvo desencantador">✨ ${save.dust || 0}</div>
        <div class="currency" data-tooltip="Entradas a Draft">🎴 ${save.draftEntries || 0}</div>
        <div class="currency" data-tooltip="Entradas a Torneo">🏆 ${save.tournamentEntries || 0}</div>
        ${
          missionsClaimable
            ? `<button class="topbar-claim-btn" id="topbar-claim-missions" data-tooltip="Tenés misiones para reclamar">🎯<span class="topbar-claim-badge">${missionsClaimable}</span></button>`
            : ''
        }
        ${
          spClaimable
            ? `<button class="topbar-claim-btn" id="topbar-claim-season" data-tooltip="Tenés recompensas del pase para reclamar">🎫<span class="topbar-claim-badge">${spClaimable}</span></button>`
            : ''
        }
      </div>
      <div class="battle-menu-wrap" id="topbar-menu-wrap">
        <button class="battle-menu-btn" id="topbar-menu-btn">☰</button>
        ${
          topMenuOpen
            ? `<div class="battle-menu-dropdown">
                <button class="battle-menu-item" id="topbar-sound-toggle">${isSoundEnabled() ? '🔊 Sonido: activado' : '🔇 Sonido: apagado'}</button>
                <button class="battle-menu-item" id="topbar-haptics-toggle">${isHapticsEnabled() ? '📳 Vibración: activada' : '📴 Vibración: apagada'}</button>
                <button class="battle-menu-item" id="topbar-tutorial">❓ Cómo jugar</button>
                <button class="battle-menu-item" id="topbar-menu-close">✕ Cerrar</button>
              </div>`
            : ''
        }
      </div>
    </div>`;
}

function toggleSound() {
  save.soundEnabled = !isSoundEnabled();
  setSoundEnabled(save.soundEnabled);
  persist();
}

function toggleHaptics() {
  save.vibrationEnabled = !isHapticsEnabled();
  setHapticsEnabled(save.vibrationEnabled);
  persist();
}

// Swaps just the .topbar DOM node in place (not a full screen render) so
// opening/closing the ☰ dropdown never disturbs the current screen's scroll
// position — the same reason claim buttons need their own scroll-preserving
// re-render (see rerenderPreservingScroll).
function rerenderHeader() {
  const topbar = document.querySelector('.topbar');
  if (!topbar) return;
  const wrapper = document.createElement('div');
  wrapper.innerHTML = header();
  const next = wrapper.firstElementChild;
  topbar.replaceWith(next);
  wireHeader();
  wireTooltips(next);
}

function wireHeader() {
  const profileBtn = document.getElementById('profile-chip');
  if (profileBtn) profileBtn.onclick = () => go('profile');

  const missionsClaimBtn = document.getElementById('topbar-claim-missions');
  if (missionsClaimBtn) missionsClaimBtn.onclick = () => go('missions');
  const spClaimBtn = document.getElementById('topbar-claim-season');
  if (spClaimBtn) spClaimBtn.onclick = () => go('seasonPass');

  const menuBtn = document.getElementById('topbar-menu-btn');
  if (menuBtn) {
    menuBtn.onclick = () => {
      topMenuOpen = !topMenuOpen;
      rerenderHeader();
    };
  }
  const closeBtn = document.getElementById('topbar-menu-close');
  if (closeBtn) {
    closeBtn.onclick = () => {
      topMenuOpen = false;
      rerenderHeader();
    };
  }
  const soundBtn = document.getElementById('topbar-sound-toggle');
  if (soundBtn) {
    soundBtn.onclick = () => {
      toggleSound();
      soundBtn.textContent = isSoundEnabled() ? '🔊 Sonido: activado' : '🔇 Sonido: apagado';
    };
  }
  const hapticsBtn = document.getElementById('topbar-haptics-toggle');
  if (hapticsBtn) {
    hapticsBtn.onclick = () => {
      toggleHaptics();
      hapticsBtn.textContent = isHapticsEnabled() ? '📳 Vibración: activada' : '📴 Vibración: apagada';
    };
  }
  const tutorialBtn = document.getElementById('topbar-tutorial');
  if (tutorialBtn) {
    tutorialBtn.onclick = () => {
      topMenuOpen = false;
      go('tutorial');
    };
  }
}

function attrLabel(attr) {
  return attr === 'might' ? 'F' : attr === 'magic' ? 'M' : 'D';
}

function placementIcon(placement, building) {
  if (building) return '🏰';
  return placement === 'melee' ? '🗡' : placement === 'shooter' ? '🏹' : '🪽';
}

function placementLabel(placement, building) {
  if (building) return 'Edificación — fortificado, no ataca ni se mueve';
  return placement === 'melee' ? 'Cuerpo a cuerpo' : placement === 'shooter' ? 'A distancia' : 'Volador';
}

function typeLabel(type) {
  return type === 'creature' ? 'Criatura' : type === 'spell' ? 'Hechizo' : 'Fortuna';
}

function escapeAttr(str) {
  return String(str).replace(/&/g, '&amp;').replace(/"/g, '&quot;');
}

function escapeHtml(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function avatarInnerHtml(avatarId) {
  const avatar = AVATARS.find((a) => a.id === avatarId);
  return avatar ? `<img class="avatar-img" src="${avatar.src}" alt="" loading="lazy" />` : '🙂';
}

function cardTooltip(card) {
  const faction = FACTIONS[card.faction];
  const attr = card.type === 'creature' ? 'might' : card.type === 'spell' ? 'magic' : 'destiny';
  const lines = [
    `${card.name} — ${RARITY_LABEL[card.rarity]}`,
    `Facción: ${faction.name}`,
    `Coste: ${card.cost} · Requiere ${attrFullLabel(attr)} ${card.requirement}`,
  ];
  if (card.type === 'creature') {
    lines.push(`Tipo: Criatura (${placementLabel(card.placement, card.building)})`);
    lines.push(`Ataque ${card.atk} · Contraataque ${card.retaliate} · Vida ${card.life}`);
  } else {
    lines.push(`Tipo: ${typeLabel(card.type)}`);
  }
  if (card.text) lines.push(card.text);
  return escapeAttr(lines.join('\n'));
}

function cardVisual(card, extraClasses = '') {
  const color = RARITY_COLORS[card.rarity];
  const isFoil = card.rarity === 'epic' || card.rarity === 'legendary';
  const attr = card.type === 'creature' ? 'might' : card.type === 'spell' ? 'magic' : 'destiny';
  const statsHtml =
    card.type === 'creature'
      ? `<div class="card-stats"><span class="atk">${card.atk}</span><span class="ret">${card.retaliate}</span><span class="life">${card.life}</span></div>${card.text ? `<div class="ability-text">${card.text}</div>` : ''}`
      : `<div class="card-stats spell-tag">${card.text || ''}</div>`;
  return `
    <div class="card rarity-${card.rarity} ${isFoil ? 'foil' : ''} ${extraClasses}" style="--rarity-color:${color}" data-tooltip="${cardTooltip(card)}">
      <div class="card-cost">${card.cost}</div>
      <div class="req-badge req-${attr}">${attrLabel(attr)}${card.requirement}</div>
      <div class="card-art">${cardArtSVG(card)}</div>
      ${isFoil ? '<div class="foil-sheen"></div>' : ''}
      ${card.type === 'creature' ? `<div class="placement-tag">${placementIcon(card.placement, card.building)}</div>` : ''}
      <div class="card-name">${card.name}</div>
      ${statsHtml}
    </div>`;
}

// ---------------- Home / meta screens ----------------

function sortedMissionsForWidget() {
  // Surface ready-to-claim missions first, but otherwise leave catalog order
  // alone — claiming a mission must not bump it out of the visible slots.
  return [...Missions.MISSIONS].sort((a, b) => {
    const aReady = Missions.isMissionComplete(save, a) && !Missions.isMissionClaimed(save, a);
    const bReady = Missions.isMissionComplete(save, b) && !Missions.isMissionClaimed(save, b);
    if (aReady !== bReady) return aReady ? -1 : 1;
    return 0;
  });
}

// Every "one-time, persists until bought" offer the shop can currently
// show, in the same order the shop screen itself lists them — drives the
// floating home-screen buttons so a live offer is never just buried in
// Tienda where the player might not think to look.
function activeShopOffers() {
  const offers = [];
  if (!save.welcomeOfferClaimed) {
    offers.push({ id: 'welcome', icon: '🎁', label: `${WELCOME_OFFER.label} — ${WELCOME_OFFER.priceLabel}` });
  }
  const arenaIdx = Ladder.getArenaIndex(save.trophies || 0);
  if (arenaIdx > 0) {
    const arena = Ladder.ARENAS[arenaIdx];
    if (!(save.claimedArenaOffers || []).includes(arena.id)) {
      const offer = getArenaOffer(arena.id);
      if (offer) offers.push({ id: 'arena', icon: arena.icon || '🏆', label: `${offer.label} — ${offer.priceLabel}` });
    }
  }
  if (!save.draftBundleClaimed) {
    offers.push({ id: 'draft-bundle', icon: '🎴', label: `${Draft.DRAFT_BUNDLE_SKU.label} — ${Draft.DRAFT_BUNDLE_SKU.priceLabel}` });
  }
  if (!save.tournamentBundleClaimed) {
    offers.push({ id: 'tournament-bundle', icon: '🏅', label: `${Tournament.TOURNAMENT_BUNDLE_SKU.label} — ${Tournament.TOURNAMENT_BUNDLE_SKU.priceLabel}` });
  }
  return offers;
}

function homeOfferFabsHtml(offers) {
  return offers
    .map((offer, i) => {
      const side = i % 2 === 0 ? 'left' : 'right';
      const stackIndex = Math.floor(i / 2);
      return `<button class="home-offer-fab home-offer-fab-${side}" style="--stack-index:${stackIndex}" data-offer="${offer.id}" data-tooltip="${escapeHtml(offer.label)}">${offer.icon}</button>`;
    })
    .join('');
}

function renderHome() {
  Ladder.ensureLadderSave(save);
  const claimable = totalMissionsClaimable();
  const dailyClaimable = Missions.countClaimable(save);
  const spClaimable = SeasonPass.countClaimable(save);
  const ladderClaimable = Ladder.countClaimable(save);
  const widgetMissions = sortedMissionsForWidget().slice(0, 3);

  const league = Ladder.getProgressToNextArena(save);
  const spLevel = SeasonPass.getLevel(save);
  const spProgress = SeasonPass.getLevelProgress(save);
  const spPct = Math.round((spProgress.current / spProgress.target) * 100);

  app.innerHTML = `
    ${header()}
    <div class="screen home-screen home-screen-v2">
      <div class="home">
        <h1>Card Clash</h1>
        <p class="tagline">TCG táctico por facciones — combate en carriles.</p>

        <button class="home-pass-banner" id="btn-pass-banner">
          <span class="home-pass-icon">🎫</span>
          <div class="home-pass-info">
            <div class="home-pass-title">Pase de Temporada · Nivel ${spLevel}</div>
            <div class="home-pass-bar"><div class="home-pass-bar-fill" style="width:${spPct}%"></div></div>
          </div>
          ${spClaimable ? `<span class="home-nav-badge">${spClaimable}</span>` : ''}
        </button>

        <button class="home-league-strip" id="btn-league-strip">
          <span class="home-league-icon">${league.current.icon}</span>
          <div class="home-league-info">
            <div class="home-league-name">${league.current.name}</div>
            <div class="home-league-bar"><div class="home-league-bar-fill" style="width:${league.pct}%"></div></div>
          </div>
          <div class="home-league-trophies">🏆 ${save.trophies}</div>
          ${ladderClaimable ? `<span class="home-nav-badge">${ladderClaimable}</span>` : ''}
        </button>
      </div>
    </div>

    ${
      playMenuOpen
        ? `<div class="play-menu-backdrop" id="play-menu-backdrop"></div>
           <div class="play-menu">
             <button class="play-menu-option online" id="play-online" data-tooltip="Emparejamiento online contra otros jugadores por trofeos cercanos. Si no hay nadie disponible, jugás contra un rival de respaldo.">
               <span class="play-menu-icon">⚔️</span>
               <span>Modo Normal</span>
             </button>
             <button class="play-menu-option auto online" id="play-auto-online" data-tooltip="Se juega solo, una carta por turno — mismo emparejamiento online que el Modo Normal.">
               <span class="play-menu-icon">🤖</span>
               <span>Autodeckbuilder</span>
             </button>
             <button class="play-menu-option draft" id="play-draft" data-tooltip="Abrís 3 sobres de 5 cartas y draftás pack-and-pass + una carta gratis del Gremio Errante, luego jugás un torneo de 4 contra tu pod. 1° Sobre Premium + Sobre de Bronce, 2° Sobre de Bronce, 3°/4° carta común.">
               <span class="play-menu-icon">🎴</span>
               <span>Draft${save.draftEntries ? ` (${save.draftEntries} entrada${save.draftEntries === 1 ? '' : 's'})` : ''}</span>
             </button>
             <button class="play-menu-option tournament" id="play-tournament" data-tooltip="Jugás con tu mazo Normal ya armado contra otros 3 jugadores — dos semifinales y una final. Mismos premios que el Draft.">
               <span class="play-menu-icon">🏆</span>
               <span>Torneo${save.tournamentEntries ? ` (${save.tournamentEntries} entrada${save.tournamentEntries === 1 ? '' : 's'})` : ''}</span>
             </button>
           </div>`
        : ''
    }

    <div class="home-bottom-nav">
      <button class="home-nav-item" id="btn-collection">
        <span class="home-nav-icon">🃏</span>
        <span class="home-nav-label">Colección</span>
      </button>
      <button class="home-nav-item" id="btn-shop">
        <span class="home-nav-icon">🛒</span>
        <span class="home-nav-label">Tienda</span>
      </button>
      <button class="home-nav-battle ${playMenuOpen ? 'active' : ''}" id="btn-play" data-tooltip="Jugar">⚔️</button>
      <button class="home-nav-item" id="btn-deck">
        <span class="home-nav-icon">🛠️</span>
        <span class="home-nav-label">Mazos</span>
      </button>
      <button class="home-nav-item" id="btn-missions">
        <span class="home-nav-icon">🎯</span>
        <span class="home-nav-label">Misiones</span>
        ${claimable ? `<span class="home-nav-badge">${claimable}</span>` : ''}
      </button>
      <button class="home-nav-item" id="btn-tournaments">
        <span class="home-nav-icon">🏆</span>
        <span class="home-nav-label">Torneos</span>
        ${bracketStatus?.kind === 'tournament' ? '<span class="home-nav-badge">●</span>' : ''}
      </button>
    </div>

    <button class="ad-watch-fab" id="home-watch-ad" ${canWatchAd(save) ? '' : 'disabled'} data-tooltip="${
    canWatchAd(save)
      ? `Mirar video para ganar ${AD_REWARD.coins} monedas (${adsWatchedToday(save)}/${AD_DAILY_LIMIT} hoy)`
      : `Ya viste el máximo de ${AD_DAILY_LIMIT} anuncios de hoy — volvé mañana`
  }">📺</button>

    ${homeOfferFabsHtml(activeShopOffers())}

    <div class="missions-tab-scrim ${missionsTabExpanded ? 'visible' : ''}" id="missions-tab-scrim"></div>
    <div class="missions-tab-wrap ${missionsTabExpanded ? 'expanded' : ''}" id="missions-tab-wrap">
      <aside class="missions-widget missions-tab-panel">
        <div class="missions-widget-header">
          <h3>🎯 Misiones diarias</h3>
          <div class="missions-widget-header-right">
            <span id="missions-reset-timer" class="missions-widget-timer"></span>
            ${dailyClaimable ? `<span class="missions-widget-badge">${dailyClaimable} para reclamar</span>` : ''}
            <button class="missions-widget-close" id="missions-widget-close" data-tooltip="Cerrar">✕</button>
          </div>
        </div>
        <div id="missions-widget-rows">${widgetMissions.map((m) => missionRowHtml(m, true)).join('')}</div>
        <button class="btn" id="missions-widget-more">Ver todas →</button>
      </aside>
      <button class="missions-tab-handle" id="missions-tab-handle">
        🎯 <span class="missions-tab-handle-label">Misiones</span>${claimable ? `<span class="badge-count">${claimable}</span>` : ''}
      </button>
    </div>`;
  document.getElementById('btn-play').onclick = () => {
    playMenuOpen = !playMenuOpen;
    renderHome();
  };
  document.getElementById('btn-collection').onclick = () => go('collection');
  document.getElementById('btn-deck').onclick = () => go('deckSelect');
  document.getElementById('btn-shop').onclick = () => go('shop');
  document.getElementById('btn-missions').onclick = () => go('missions');
  document.getElementById('btn-tournaments').onclick = () => go('tournaments');
  document.getElementById('btn-league-strip').onclick = () => go('ladder');
  document.getElementById('home-watch-ad').onclick = () => watchAd('home');
  document.querySelectorAll('[data-offer]').forEach((btn) => {
    btn.onclick = () => go('shop');
  });
  const backdrop = document.getElementById('play-menu-backdrop');
  if (backdrop) {
    backdrop.onclick = () => {
      playMenuOpen = false;
      renderHome();
    };
  }
  const playOnlineBtn = document.getElementById('play-online');
  if (playOnlineBtn) {
    playOnlineBtn.onclick = () => {
      playMenuOpen = false;
      playSelectedDeck('online');
    };
  }
  const playAutoOnlineBtn = document.getElementById('play-auto-online');
  if (playAutoOnlineBtn) {
    playAutoOnlineBtn.onclick = () => {
      playMenuOpen = false;
      playSelectedDeck('online', true);
    };
  }
  const playDraftBtn = document.getElementById('play-draft');
  if (playDraftBtn) {
    playDraftBtn.onclick = () => {
      playMenuOpen = false;
      enterDraftFlow();
    };
  }
  const playTournamentBtn = document.getElementById('play-tournament');
  if (playTournamentBtn) {
    playTournamentBtn.onclick = () => {
      playMenuOpen = false;
      enterTournamentFlow();
    };
  }
  document.getElementById('btn-pass-banner').onclick = () => go('seasonPass');
  document.getElementById('missions-widget-more').onclick = () => go('missions');
  // Toggling the tab just flips a CSS class on the existing elements instead
  // of going through renderHome() (a full app.innerHTML replace) — the whole
  // home screen was re-mounting on every open/close before, which replayed
  // every entrance animation (this tab's, the ad FAB's) and looked like the
  // screen was refreshing.
  const setMissionsTabExpanded = (expanded) => {
    missionsTabExpanded = expanded;
    document.getElementById('missions-tab-wrap').classList.toggle('expanded', expanded);
    document.getElementById('missions-tab-scrim').classList.toggle('visible', expanded);
  };
  document.getElementById('missions-tab-handle').onclick = () => setMissionsTabExpanded(!missionsTabExpanded);
  document.getElementById('missions-widget-close').onclick = (e) => {
    e.stopPropagation();
    setMissionsTabExpanded(false);
  };
  document.getElementById('missions-tab-scrim').onclick = () => setMissionsTabExpanded(false);
  wireMissionClaimButtons(refreshHomeMissionsUI);
  startDailyResetTimer('missions-reset-timer', renderHome);
}

function missionRowHtml(mission, compact = false) {
  const progress = Missions.getMissionProgress(save, mission);
  const complete = Missions.isMissionComplete(save, mission);
  const claimed = Missions.isMissionClaimed(save, mission);
  const pct = Math.round((progress / mission.target) * 100);
  const rewardParts = [];
  if (mission.reward.coins) rewardParts.push(`🪙 ${mission.reward.coins}`);
  if (mission.reward.gems) rewardParts.push(`💎 ${mission.reward.gems}`);
  rewardParts.push(`⭐ ${MISSION_XP_BY_DIFFICULTY[mission.difficulty] || 0} XP`);
  return `
    <div class="mission-row ${compact ? 'compact' : ''} ${claimed ? 'claimed' : ''}">
      <div class="mission-row-main">
        <div class="mission-row-title">
          <span class="mission-diff mission-diff-${mission.difficulty}">${Missions.DIFFICULTY_LABEL[mission.difficulty]}</span>
          <strong class="${claimed ? 'mission-title-done' : ''}">${mission.title}</strong>
        </div>
        ${compact ? '' : `<div class="mission-row-text">${mission.text}</div>`}
        <div class="mission-progress-bar"><div class="mission-progress-fill ${complete ? 'complete' : ''}" style="width:${pct}%"></div></div>
        <div class="mission-row-progress-label">${progress}/${mission.target}</div>
      </div>
      <div class="mission-row-side">
        <div class="mission-reward">${rewardParts.join(' ')}</div>
        ${
          claimed
            ? `<span class="mission-claimed-tag">Reclamado ✓</span>`
            : `<button class="btn small mission-claim-btn" data-claim="${mission.id}" ${complete ? '' : 'disabled'}>Reclamar</button>`
        }
      </div>
    </div>`;
}

const MISSION_XP_BY_DIFFICULTY = {
  easy: SeasonPass.XP_REWARDS.missionEasy,
  medium: SeasonPass.XP_REWARDS.missionMedium,
  hard: SeasonPass.XP_REWARDS.missionHard,
};

function wireMissionClaimButtons(rerender) {
  app.querySelectorAll('[data-claim]').forEach((btn) => {
    btn.onclick = () => {
      const mission = Missions.MISSIONS.find((m) => m.id === btn.dataset.claim);
      if (Missions.claimMission(save, btn.dataset.claim)) {
        SeasonPass.addSeasonXp(save, MISSION_XP_BY_DIFFICULTY[mission?.difficulty] || 0);
        Stats.bumpStat(save, 'dailyMissionsClaimedTotal', 1);
        persist();
        sfx.coin();
        vibrate(10);
        rerenderPreservingScroll(rerender);
      }
    };
  });
}

// Updates just the bits of the home screen a mission claim (from the
// floating widget) can change — the widget's own rows/badge, the tab
// handle's badge, the bottom-nav badge, and the topbar's claim badge —
// instead of a full renderHome(). None of the fixed-position elements
// themselves (missions-tab-wrap, ad-watch-fab) get torn down and recreated,
// so their entrance animations never replay.
function refreshHomeMissionsUI() {
  if (screen !== 'home') return;
  rerenderHeader();

  const claimable = totalMissionsClaimable();
  const setBadge = (container, selector, text) => {
    if (!container) return;
    let badge = container.querySelector(selector);
    const className = selector.slice(1);
    if (text) {
      if (!badge) {
        badge = document.createElement('span');
        badge.className = className;
        container.appendChild(badge);
      }
      badge.textContent = text;
    } else if (badge) {
      badge.remove();
    }
  };
  setBadge(document.getElementById('btn-missions'), '.home-nav-badge', claimable || '');
  setBadge(document.getElementById('missions-tab-handle'), '.badge-count', claimable || '');

  const dailyClaimable = Missions.countClaimable(save);
  const headerRight = document.querySelector('.missions-widget-header-right');
  if (headerRight) {
    let widgetBadge = headerRight.querySelector('.missions-widget-badge');
    if (dailyClaimable) {
      if (!widgetBadge) {
        widgetBadge = document.createElement('span');
        widgetBadge.className = 'missions-widget-badge';
        headerRight.insertBefore(widgetBadge, document.getElementById('missions-widget-close'));
      }
      widgetBadge.textContent = `${dailyClaimable} para reclamar`;
    } else if (widgetBadge) {
      widgetBadge.remove();
    }
  }
  const rowsContainer = document.getElementById('missions-widget-rows');
  if (rowsContainer) {
    rowsContainer.innerHTML = sortedMissionsForWidget()
      .slice(0, 3)
      .map((m) => missionRowHtml(m, true))
      .join('');
    wireMissionClaimButtons(refreshHomeMissionsUI);
    wireTooltips(rowsContainer);
  }
}

function missionProgressBarHtml(progress) {
  const pct = progress.target > 0 ? Math.round((progress.current / progress.target) * 100) : 0;
  const complete = progress.current >= progress.target;
  return `<div class="deck-progress-bar"><div class="deck-progress-fill ${complete ? 'complete' : ''}" style="width:${pct}%"></div></div>`;
}

function dailyMissionsTabHtml() {
  const overall = Missions.getOverallProgress(save);
  return `
    <p class="hint">Se reinician cada 12 horas — ¡siempre hay algo nuevo para hacer!</p>
    <div class="deck-progress">
      <div class="deck-progress-label">Progreso del ciclo · ${overall.current}/${overall.target}</div>
      ${missionProgressBarHtml(overall)}
    </div>
    ${Missions.MISSIONS.map((m) => missionRowHtml(m)).join('')}`;
}

// One reward-and-progress row for a permanent achievement — visually the
// same component as a daily mission row (missionRowHtml), just fed from
// achievements.js instead of missions.js and without the season-XP line,
// since achievements are a separate, non-resetting reward track.
function achievementRowHtml(achievement, overrides) {
  const progress = Achievements.getAchievementProgress(save, achievement, overrides);
  const complete = Achievements.isAchievementComplete(save, achievement, overrides);
  const claimed = Achievements.isAchievementClaimed(save, achievement.id);
  const pct = Math.round((progress / achievement.target) * 100);
  const rewardParts = [];
  if (achievement.reward.coins) rewardParts.push(`🪙 ${achievement.reward.coins}`);
  if (achievement.reward.gems) rewardParts.push(`💎 ${achievement.reward.gems}`);
  if (achievement.reward.dust) rewardParts.push(`✨ ${achievement.reward.dust}`);
  if (achievement.reward.draftEntries) rewardParts.push(`🎴 ${achievement.reward.draftEntries}`);
  if (achievement.reward.tournamentEntries) rewardParts.push(`🏆 ${achievement.reward.tournamentEntries}`);
  return `
    <div class="mission-row ${claimed ? 'claimed' : ''}">
      <div class="mission-row-main">
        <div class="mission-row-title">
          <span class="mission-diff mission-diff-${achievement.difficulty}">${Achievements.DIFFICULTY_LABEL[achievement.difficulty]}</span>
          <strong class="${claimed ? 'mission-title-done' : ''}">${achievement.title}</strong>
        </div>
        <div class="mission-row-text">${achievement.text}</div>
        <div class="mission-progress-bar"><div class="mission-progress-fill ${complete ? 'complete' : ''}" style="width:${pct}%"></div></div>
        <div class="mission-row-progress-label">${progress}/${achievement.target}</div>
      </div>
      <div class="mission-row-side">
        <div class="mission-reward">${rewardParts.join(' ') || '—'}</div>
        ${
          claimed
            ? `<span class="mission-claimed-tag">Reclamado ✓</span>`
            : `<button class="btn small mission-claim-btn" data-ach-claim="${achievement.id}" ${complete ? '' : 'disabled'}>Reclamar</button>`
        }
      </div>
    </div>`;
}

// The 5-dot tier strip above each chain's active row — done/ready/locked so
// the whole block-of-5 is visible at a glance, but only the active tier's
// full row (with its own claim button) is ever expanded. This is what makes
// a chain "progressive": tier 4 is invisible-as-a-target until tier 3 is
// claimed, same idea as the trophy road's locked-until-reached tiers.
function chainDotsHtml(tiers, overrides) {
  return `<div class="chain-dots">${tiers
    .map((t) => {
      const claimed = Achievements.isAchievementClaimed(save, t.id);
      const complete = Achievements.isAchievementComplete(save, t, overrides);
      const cls = claimed ? 'done' : complete ? 'ready' : 'locked';
      return `<span class="chain-dot ${cls}" data-tooltip="${escapeHtml(t.title)} — objetivo ${t.target}">${claimed ? '✓' : t.tier}</span>`;
    })
    .join('')}</div>`;
}

function achievementChainCardHtml(tiers, overrides) {
  const active = Achievements.getActiveChainTier(save, tiers[0].chain, overrides);
  return `
    <div class="chain-card">
      ${chainDotsHtml(tiers, overrides)}
      ${achievementRowHtml(active, overrides)}
    </div>`;
}

function achievementSectionTabHtml(categoryId) {
  const overrides = achievementOverrides();
  const cat = Achievements.ACH_SECTIONS[categoryId];
  const chains = Achievements.getSectionChains(categoryId);
  const claimedCount = Achievements.ACHIEVEMENTS.filter((a) => a.category === categoryId && Achievements.isAchievementClaimed(save, a.id)).length;
  const totalCount = chains.reduce((sum, tiers) => sum + tiers.length, 0);
  return `
    <p class="hint">${cat.icon} ${cat.label} — logros permanentes, nunca se reinician. ${claimedCount}/${totalCount} reclamados.</p>
    ${chains.map((tiers) => achievementChainCardHtml(tiers, overrides)).join('')}`;
}

function wireAchievementClaimButtons(rerender) {
  app.querySelectorAll('[data-ach-claim]').forEach((btn) => {
    btn.onclick = () => {
      const res = Achievements.claimAchievement(save, btn.dataset.achClaim, achievementOverrides());
      if (res.ok) {
        persist();
        sfx.coin();
        vibrate(10);
        rerenderPreservingScroll(rerender);
      }
    };
  });
}

function renderMissions() {
  const dailyClaimable = Missions.countClaimable(save);
  const overrides = achievementOverrides();
  const tabsHtml = [
    { id: 'daily', icon: '📅', label: 'Diarias', count: dailyClaimable },
    ...Object.values(Achievements.ACH_SECTIONS).map((cat) => ({
      id: cat.id,
      icon: cat.icon,
      label: cat.label,
      count: Achievements.countClaimableInSection(save, cat.id, overrides),
    })),
  ]
    .map(
      (tab) => `
      <button class="mission-tab ${missionsScreenTab === tab.id ? 'active' : ''}" data-mtab="${tab.id}">
        ${tab.icon} ${tab.label}${tab.count ? `<span class="badge-count">${tab.count}</span>` : ''}
      </button>`
    )
    .join('');
  const contentHtml = missionsScreenTab === 'daily' ? dailyMissionsTabHtml() : achievementSectionTabHtml(missionsScreenTab);
  app.innerHTML = `
    ${header()}
    <div class="screen">
      <div class="screen-header">
        <button class="btn back" id="back">← Volver</button>
        <h2>Misiones</h2>
        ${missionsScreenTab === 'daily' ? '<span id="missions-reset-timer-full" class="missions-widget-timer screen-header-timer"></span>' : ''}
      </div>
      <div class="mission-tabs">${tabsHtml}</div>
      ${contentHtml}
    </div>`;
  document.getElementById('back').onclick = () => go('home');
  app.querySelectorAll('[data-mtab]').forEach((btn) => {
    btn.onclick = () => {
      missionsScreenTab = btn.dataset.mtab;
      renderMissions();
    };
  });
  wireMissionClaimButtons(renderMissions);
  wireAchievementClaimButtons(renderMissions);
  if (missionsScreenTab === 'daily') startDailyResetTimer('missions-reset-timer-full', renderMissions);
}

const TUTORIAL_SECTIONS = [
  { icon: '🎯', title: 'Objetivo', text: 'Bajá la vida del héroe rival a 0 antes de que el tuyo llegue a 0.' },
  {
    icon: '💠',
    title: 'Tu turno',
    text: 'El maná sube +1 por turno y se recarga entero. Robás 1 carta. Elegís una sola acción de héroe: subir un atributo (Fuerza, Magia o Destino) o tu habilidad especial.',
  },
  {
    icon: '🗺️',
    title: 'El campo',
    text: '4 carriles con fila delantera y trasera. Cuerpo a cuerpo va adelante, a distancia atrás, volador en cualquiera. Cada carta pide maná más un nivel mínimo del atributo correspondiente.',
  },
  {
    icon: '🌟',
    title: 'Auras de facción',
    text: 'Si tenés 4 o más criaturas de una misma facción en el campo, se activa su aura pasiva (por ejemplo +1 Ataque para Ignara, o -1 Ataque y Vida rival para Umbra). Podés tener hasta dos auras activas a la vez si combinás facciones en tu mazo.',
  },
  {
    icon: '🗡️',
    title: 'Combate',
    text: 'Tu criatura ataca primero; si la rival sobrevive, contraataca — a distancia nunca recibe contraataque. En vez de atacar, una criatura lista puede moverse a otro casillero libre.',
  },
  {
    icon: '🔄',
    title: 'Reemplazar criatura',
    text: 'Si el campo está lleno o querés sorprender al rival, podés sacrificar una criatura propia para desplegar otra desde tu mano en su lugar, pagando el maná y nivel de atributo de la nueva carta. La sacrificada se pierde para siempre y va directo al cementerio.',
  },
  {
    icon: '💀',
    title: 'Cementerio',
    text: 'Las criaturas que mueren o son sacrificadas van al cementerio. Algunas cartas de Umbra pueden devolver criaturas al azar desde ahí, a la mano o directo al campo.',
  },
];

function renderTutorial() {
  const sectionsHtml = TUTORIAL_SECTIONS.map(
    (s) => `
      <div class="tutorial-card">
        <div class="tutorial-card-icon">${s.icon}</div>
        <div class="tutorial-card-body">
          <h3>${s.title}</h3>
          <p class="tutorial-text">${s.text}</p>
        </div>
      </div>`
  ).join('');
  app.innerHTML = `
    ${header()}
    <div class="screen tutorial-screen">
      <div class="screen-header"><h2>Cómo jugar</h2></div>
      <div class="tutorial-list">${sectionsHtml}</div>
      <button class="tutorial-done-btn" id="tutorial-done">¡Entendido, a jugar! →</button>
    </div>`;
  document.getElementById('tutorial-done').onclick = () => {
    save.tutorialSeen = true;
    persist();
    go('home');
  };
}

function seasonPassRewardHtml(entry, track) {
  const claimed = SeasonPass.isRewardClaimed(save, entry.level, track);
  const claimable = SeasonPass.isRewardClaimable(save, entry.level, track);
  const locked = track === 'premium' && !SeasonPass.isPremiumUnlocked(save);
  const reward = track === 'premium' ? entry.premium : entry.free;
  const parts = [];
  if (reward.coins) parts.push(`🪙${reward.coins}`);
  if (reward.gems) parts.push(`💎${reward.gems}`);
  if (reward.dust) parts.push(`✨${reward.dust}`);
  if (reward.draftEntries) parts.push(`🎴${reward.draftEntries}`);
  if (reward.tournamentEntries) parts.push(`🏆${reward.tournamentEntries}`);
  return `
    <div class="sp-reward ${track} ${claimed ? 'claimed' : ''}">
      <div class="sp-reward-value">${parts.join(' ')}</div>
      ${
        claimed
          ? '<span class="sp-reward-tag">✓</span>'
          : locked
            ? '<span class="sp-reward-tag">🔒</span>'
            : `<button class="btn tiny" data-sp-claim="${entry.level}:${track}" ${claimable ? '' : 'disabled'}>Reclamar</button>`
      }
    </div>`;
}

function renderSeasonPass() {
  const level = SeasonPass.getLevel(save);
  const progress = SeasonPass.getLevelProgress(save);
  const pct = Math.round((progress.current / progress.target) * 100);
  const days = SeasonPass.daysRemaining(save);
  const premiumUnlocked = SeasonPass.isPremiumUnlocked(save);
  const maxLevel = level >= SeasonPass.CONSTANTS.MAX_LEVEL;

  const rowsHtml = SeasonPass.REWARDS.map(
    (entry) => `
    <div class="sp-level-row ${entry.level <= level ? 'reached' : ''} ${entry.level === level ? 'current' : ''}" ${entry.level === level ? 'id="sp-current-row"' : ''}>
      <div class="sp-level-num">${entry.level === level ? '<span class="sp-current-dot"></span>' : ''}${entry.level}</div>
      ${seasonPassRewardHtml(entry, 'free')}
      ${seasonPassRewardHtml(entry, 'premium')}
    </div>`
  ).join('');

  // A teaser of the next 3 premium-only rewards, shown on the unlock banner
  // so "buy premium" has something concrete to sell instead of just a price.
  const previewRewards = SeasonPass.REWARDS.filter((e) => e.level >= level)
    .slice(0, 3)
    .map((e) => {
      const parts = [];
      if (e.premium.coins) parts.push(`🪙${e.premium.coins}`);
      if (e.premium.gems) parts.push(`💎${e.premium.gems}`);
      if (e.premium.dust) parts.push(`✨${e.premium.dust}`);
      if (e.premium.draftEntries) parts.push(`🎴${e.premium.draftEntries}`);
      if (e.premium.tournamentEntries) parts.push(`🏆${e.premium.tournamentEntries}`);
      return `<div class="sp-preview-chip"><span class="sp-preview-level">Nv.${e.level}</span>${parts.join(' ')}</div>`;
    })
    .join('');

  app.innerHTML = `
    ${header()}
    <div class="screen season-pass-screen">
      <div class="screen-header"><button class="btn back" id="back">← Volver</button><h2>Pase de Temporada</h2></div>
      <div class="sp-hero">
        <div class="sp-hero-glow"></div>
        <div class="sp-level-badge">
          <span class="sp-level-badge-label">Nivel</span>
          <span class="sp-level-badge-num">${maxLevel ? '★' : level}</span>
        </div>
        <div class="sp-hero-info">
          <div class="deck-progress">
            <div class="deck-progress-label">${maxLevel ? '¡Nivel máximo alcanzado!' : `${progress.current}/${progress.target} XP`}</div>
            <div class="deck-progress-bar"><div class="deck-progress-fill" style="width:${pct}%"></div></div>
          </div>
          <div class="sp-days-pill">⏳ ${days} día${days === 1 ? '' : 's'} restante${days === 1 ? '' : 's'}</div>
        </div>
      </div>
      ${
        premiumUnlocked
          ? ''
          : `<div class="welcome-offer sp-unlock-offer">
              <div class="welcome-offer-badge">🎫 Pase Premium</div>
              <h3>Desbloqueá la columna Premium</h3>
              <div class="sp-preview-row">${previewRewards}</div>
              <button class="btn primary" id="unlock-premium">Desbloquear por ${SEASON_PASS_SKU.priceLabel}</button>
            </div>`
      }
      <div class="sp-columns-label"><span>Nivel</span><span>🆓 Gratis</span><span>💎 Premium</span></div>
      <div class="sp-levels">${rowsHtml}</div>
    </div>`;
  document.getElementById('back').onclick = () => go('home');
  const currentRow = document.getElementById('sp-current-row');
  if (currentRow) currentRow.scrollIntoView({ block: 'center' });
  const unlockBtn = document.getElementById('unlock-premium');
  if (unlockBtn) {
    // Real-money only, same "compra simulada" mock-purchase convention as
    // the shop's gem/coin/dust SKUs — no gems are ever spent here.
    unlockBtn.onclick = () => {
      const res = SeasonPass.unlockPremium(save);
      if (res.ok) {
        persist();
        sfx.coin();
        renderSeasonPass();
      }
    };
  }
  app.querySelectorAll('[data-sp-claim]').forEach((btn) => {
    btn.onclick = () => {
      const [levelStr, track] = btn.dataset.spClaim.split(':');
      const res = SeasonPass.claimReward(save, Number(levelStr), track);
      if (res.ok) {
        Stats.bumpStat(save, 'seasonRewardsClaimed', 1);
        persist();
        sfx.coin();
        vibrate(10);
        rerenderPreservingScroll(renderSeasonPass);
      }
    };
  });
}

// One node of the trophy road — either a big 'arena' milestone (own icon +
// name, the league itself) or a small 'chest' in between (Clash Royale-style
// filler reward so there's always something close to reach). `isCurrent`
// marks the single nearest unreached tier, which gets a pulsing highlight
// and is what the screen auto-scrolls to on open.
function trophyRoadNodeHtml(tier, isCurrent) {
  const reached = save.trophies >= tier.threshold;
  const claimed = Ladder.isTierClaimed(save, tier.id);
  const claimable = Ladder.isTierClaimable(save, tier.id);
  const rewardParts = [];
  if (tier.reward.coins) rewardParts.push(`🪙${tier.reward.coins}`);
  if (tier.reward.gems) rewardParts.push(`💎${tier.reward.gems}`);
  if (tier.reward.dust) rewardParts.push(`✨${tier.reward.dust}`);
  if (tier.reward.draftEntries) rewardParts.push(`🎴${tier.reward.draftEntries}`);
  if (tier.reward.tournamentEntries) rewardParts.push(`🏆${tier.reward.tournamentEntries}`);
  return `
    <div class="road-node ${tier.kind} ${reached ? 'reached' : 'locked'} ${isCurrent ? 'current' : ''}" ${isCurrent ? 'id="road-current-node"' : ''}>
      <div class="road-node-connector"><div class="road-node-dot">${tier.icon}</div></div>
      <div class="road-node-card">
        <div class="road-node-info">
          <div class="road-node-title">${tier.kind === 'arena' ? tier.name : 'Cofre'}${isCurrent ? '<span class="ladder-current-tag">Próximo</span>' : ''}</div>
          <div class="road-node-threshold">${tier.threshold} 🏆</div>
        </div>
        <div class="road-node-right">
          <div class="road-node-reward">${rewardParts.join(' ') || '—'}</div>
          ${
            claimed
              ? '<span class="sp-reward-tag">✓</span>'
              : reached
                ? `<button class="btn tiny" data-ladder-claim="${tier.id}" ${claimable ? '' : 'disabled'}>Reclamar</button>`
                : '<span class="ladder-arena-lock">🔒</span>'
          }
        </div>
      </div>
    </div>`;
}

// fetchFresh: pulls the server-authoritative trophy count (via REST, no live
// WS connection needed) once when the screen is first opened. Re-renders
// triggered from within this screen (claiming a reward, the fetch itself
// resolving) pass false so they don't keep re-triggering more fetches.
function renderLadder(fetchFresh = true, scrollToCurrent = fetchFresh) {
  Ladder.ensureLadderSave(save);
  const progress = Ladder.getProgressToNextArena(save);
  const nextTier = Ladder.TIERS.find((t) => save.trophies < t.threshold);

  app.innerHTML = `
    ${header()}
    <div class="screen">
      <div class="screen-header"><button class="btn back" id="back">← Volver</button><h2>Liga</h2></div>
      <button class="btn small leaderboard-entry-btn" id="btn-leaderboard">🌐 Ranking global</button>
      <div class="ladder-header">
        <div class="ladder-current-arena">
          <span class="ladder-current-icon">${progress.current.icon}</span>
          <div>
            <div class="ladder-current-name">${progress.current.name}</div>
            <div class="ladder-trophy-count">🏆 ${save.trophies}</div>
          </div>
        </div>
        ${
          progress.next
            ? `<div class="deck-progress">
                <div class="deck-progress-label">${save.trophies - progress.current.threshold}/${progress.next.threshold - progress.current.threshold} 🏆 hasta ${progress.next.name}</div>
                <div class="deck-progress-bar"><div class="deck-progress-fill" style="width:${progress.pct}%"></div></div>
              </div>`
            : '<p class="hint">¡Llegaste a la liga más alta!</p>'
        }
      </div>
      <p class="hint">Los trofeos se ganan y se pierden jugando partidas Online. Subí de trofeos para desbloquear ligas y cofres en el camino — cada uno queda ganado para siempre.</p>
      <div class="trophy-road">${Ladder.TIERS.map((t) => trophyRoadNodeHtml(t, !!nextTier && t.id === nextTier.id)).join('')}</div>
    </div>`;
  document.getElementById('back').onclick = () => go('home');
  document.getElementById('btn-leaderboard').onclick = () => go('leaderboard');
  app.querySelectorAll('[data-ladder-claim]').forEach((btn) => {
    btn.onclick = () => {
      const res = Ladder.claimTierReward(save, btn.dataset.ladderClaim);
      if (res.ok) {
        Stats.bumpStat(save, 'ladderTiersClaimed', 1);
        persist();
        sfx.coin();
        vibrate(10);
        rerenderPreservingScroll(() => renderLadder(false));
      }
    };
  });

  if (scrollToCurrent) {
    // Jump the road to whatever tier is coming up next — with ~50 tiers on
    // the full road the interesting spot is rarely the top of the scroll.
    // Skipped on claim-triggered re-renders, which go through
    // rerenderPreservingScroll and restore the user's own scroll position.
    const currentNode = document.getElementById('road-current-node');
    if (currentNode) currentNode.scrollIntoView({ block: 'center' });
  }

  if (fetchFresh) {
    const seq = nextAccountSyncSeq();
    Net.fetchAccount()
      .then((account) => {
        if (!account || screen !== 'ladder') return;
        syncAccountToSave(account, seq);
        renderLadder(false, true);
      })
      .catch(() => {});
  }
}

function leaderboardRowHtml(entry, isMe) {
  const medal = entry.rank === 1 ? '🥇' : entry.rank === 2 ? '🥈' : entry.rank === 3 ? '🥉' : null;
  return `
    <div class="leaderboard-row ${isMe ? 'is-me' : ''}">
      <span class="leaderboard-rank">${medal || `#${entry.rank}`}</span>
      <span class="leaderboard-name">${escapeHtml(entry.username)}</span>
      <span class="leaderboard-trophies">🏆 ${entry.trophies}</span>
    </div>`;
}

function renderLeaderboard() {
  app.innerHTML = `
    ${header()}
    <div class="screen">
      <div class="screen-header"><button class="btn back" id="back">← Volver</button><h2>Ranking global</h2></div>
      <p class="hint">Los 50 jugadores con más trofeos. Se gana y se pierde jugando partidas Online.</p>
      <div id="leaderboard-list" class="leaderboard-list"><p class="hint">Cargando…</p></div>
    </div>`;
  document.getElementById('back').onclick = () => go('home');

  Net.fetchLeaderboard()
    .then(({ leaderboard, myRank }) => {
      if (screen !== 'leaderboard') return;
      const list = document.getElementById('leaderboard-list');
      if (!list) return;
      if (!leaderboard.length) {
        list.innerHTML = '<p class="hint">Todavía nadie tiene trofeos — ¡sé el primero!</p>';
        return;
      }
      list.innerHTML = leaderboard.map((entry) => leaderboardRowHtml(entry, myRank === entry.rank)).join('');
      if (myRank && myRank > leaderboard.length) {
        list.insertAdjacentHTML('beforeend', `<p class="hint leaderboard-my-rank">Tu posición: #${myRank}</p>`);
      }
    })
    .catch(() => {
      const list = document.getElementById('leaderboard-list');
      if (list) list.innerHTML = '<p class="hint">No se pudo cargar el ranking. ¿Está corriendo el servidor?</p>';
    });
}

function accountWinRatePct() {
  const wins = save.wins || 0;
  const losses = save.losses || 0;
  const total = wins + losses;
  return total ? Math.round((wins / total) * 100) : null;
}

// Renders Google's own Sign-In button into #google-signin-container. Uses
// their hosted button (not a custom-styled one) because that's the
// well-supported way to reliably get an ID token from a direct click — a
// self-triggered One Tap prompt can be silently skipped by the browser.
// No-ops quietly (no button, no error) until both the GIS script has loaded
// and GOOGLE_CLIENT_ID has been filled in — see src/net.js.
function initGoogleSignInButton() {
  const container = document.getElementById('google-signin-container');
  if (!container || !Net.GOOGLE_CLIENT_ID || !window.google?.accounts?.id) return;
  window.google.accounts.id.initialize({
    client_id: Net.GOOGLE_CLIENT_ID,
    callback: handleGoogleCredential,
  });
  window.google.accounts.id.renderButton(container, {
    theme: 'filled_black',
    size: 'large',
    shape: 'pill',
    text: 'signin_with',
    width: 280,
  });
}

function handleGoogleCredential(response) {
  const seq = nextAccountSyncSeq();
  Net.linkGoogleAccount(response.credential)
    .then((account) => {
      syncAccountToSave(account, seq);
      showToast('Cuenta vinculada con Google ✅');
      if (screen === 'profile') renderProfile(false);
    })
    .catch((err) => showToast(err.message || 'No se pudo vincular con Google.'));
}

function renderProfile(fetchFresh = true) {
  const username = save.username || 'Jugador';
  const arena = Ladder.getArena(save.trophies || 0);
  const winRate = accountWinRatePct();
  const token = Net.getToken() || '';

  app.innerHTML = `
    ${header()}
    <div class="screen profile-screen">
      <div class="screen-header"><button class="btn back" id="back">← Volver</button><h2>Perfil</h2></div>
      <div class="profile-card">
        <button class="profile-avatar-lg" id="profile-avatar-btn" data-tooltip="Cambiar foto">
          ${avatarInnerHtml(save.avatar)}
          <span class="profile-avatar-edit-badge">✏️</span>
        </button>
        ${
          avatarPickerOpen
            ? `<div class="avatar-picker">
                ${AVATARS.map(
                  (a) => `<button class="avatar-option ${save.avatar === a.id ? 'selected' : ''}" data-avatar="${a.id}">
                    <img src="${a.src}" alt="" loading="lazy" />
                  </button>`
                ).join('')}
              </div>`
            : ''
        }
        ${
          profileEditingName
            ? `<div class="profile-name-edit">
                <input id="profile-name-input" class="profile-name-input" maxlength="20" autocomplete="off" value="${escapeAttr(username)}">
                <div class="profile-name-edit-actions">
                  <button class="btn small" id="profile-name-save">Guardar</button>
                  <button class="btn small back" id="profile-name-cancel">Cancelar</button>
                </div>
              </div>`
            : `<div class="profile-name-row">
                <span class="profile-name-lg">${escapeHtml(username)}</span>
                <button class="profile-edit-btn" id="profile-edit" data-tooltip="Cambiar nombre">✏️</button>
              </div>`
        }
      </div>
      <div class="profile-stats-grid">
        <div class="profile-stat">
          <span class="profile-stat-icon">${arena.icon}</span>
          <span class="profile-stat-value">${save.trophies || 0}</span>
          <span class="profile-stat-label">${arena.name}</span>
        </div>
        <div class="profile-stat">
          <span class="profile-stat-icon">✅</span>
          <span class="profile-stat-value">${save.wins || 0}</span>
          <span class="profile-stat-label">Victorias</span>
        </div>
        <div class="profile-stat">
          <span class="profile-stat-icon">❌</span>
          <span class="profile-stat-value">${save.losses || 0}</span>
          <span class="profile-stat-label">Derrotas</span>
        </div>
        <div class="profile-stat">
          <span class="profile-stat-icon">📊</span>
          <span class="profile-stat-value">${winRate === null ? '—' : winRate + '%'}</span>
          <span class="profile-stat-label">Efectividad</span>
        </div>
      </div>
      <button class="profile-id-row" id="profile-copy-id" data-tooltip="Copiar ID de cuenta">
        <span class="hint">ID de cuenta: ${token ? escapeHtml(token.slice(0, 8)) + '…' : '—'}</span>
        <span class="profile-copy-icon">📋</span>
      </button>
      <div class="profile-account-section">
        <h3 class="profile-section-title">Cuenta</h3>
        ${
          save.googleLinked
            ? `<div class="profile-google-linked">✅ Vinculado con Google${save.googleEmail ? ` · ${escapeHtml(save.googleEmail)}` : ''}</div>
               <p class="hint">Tu progreso queda guardado en esta cuenta de Google — lo recuperás en cualquier dispositivo.</p>
               <button class="btn small back" id="google-unlink">Desvincular</button>`
            : `<p class="hint">Vinculá tu cuenta con Google para no perder tu progreso si cambiás de dispositivo o borrás los datos del navegador.</p>
               <div id="google-signin-container"></div>`
        }
      </div>
      <button class="profile-friends-btn" id="btn-friends">
        <span>👥 Amigos</span>
        <span class="profile-friends-arrow">→</span>
      </button>
      <div class="profile-danger-section">
        <button class="btn danger small" id="delete-account-btn">Borrar cuenta</button>
        <p class="hint">Borra tu progreso y tu cuenta para siempre. No se puede deshacer.</p>
      </div>
    </div>
    ${
      deleteAccountConfirmOpen
        ? `<div class="modal-overlay" id="delete-account-overlay">
             <div class="modal-box">
               <p>¿Seguro que querés borrar tu cuenta?<br>Perdés tu progreso, mazos, trofeos y amigos para siempre. No se puede deshacer.</p>
               <div class="modal-actions">
                 <button class="btn" id="delete-account-cancel">Cancelar</button>
                 <button class="btn danger" id="delete-account-confirm">Borrar cuenta</button>
               </div>
             </div>
           </div>`
        : ''
    }`;

  document.getElementById('back').onclick = () => {
    profileEditingName = false;
    avatarPickerOpen = false;
    deleteAccountConfirmOpen = false;
    go('home');
  };
  const avatarBtn = document.getElementById('profile-avatar-btn');
  if (avatarBtn) {
    avatarBtn.onclick = () => {
      avatarPickerOpen = !avatarPickerOpen;
      renderProfile(false);
    };
  }
  app.querySelectorAll('[data-avatar]').forEach((el) => {
    el.onclick = () => {
      save.avatar = el.dataset.avatar;
      persist();
      avatarPickerOpen = false;
      sfx.click();
      renderProfile(false);
    };
  });
  const editBtn = document.getElementById('profile-edit');
  if (editBtn) {
    editBtn.onclick = () => {
      profileEditingName = true;
      renderProfile(false);
    };
  }
  const cancelBtn = document.getElementById('profile-name-cancel');
  if (cancelBtn) {
    cancelBtn.onclick = () => {
      profileEditingName = false;
      renderProfile(false);
    };
  }
  const saveBtn = document.getElementById('profile-name-save');
  if (saveBtn) {
    saveBtn.onclick = async () => {
      const input = document.getElementById('profile-name-input');
      const next = input.value.trim();
      if (!next) {
        input.focus();
        return;
      }
      saveBtn.disabled = true;
      const seq = nextAccountSyncSeq();
      try {
        const account = await Net.renameAccount(next);
        syncAccountToSave(account, seq);
        profileEditingName = false;
        renderProfile(false);
      } catch {
        showToast('No se pudo cambiar el nombre. ¿Está corriendo el servidor?');
        saveBtn.disabled = false;
      }
    };
  }
  const copyBtn = document.getElementById('profile-copy-id');
  if (copyBtn && token) {
    copyBtn.onclick = () => {
      navigator.clipboard
        .writeText(token)
        .then(() => showToast('ID de cuenta copiado.'))
        .catch(() => showToast('No se pudo copiar el ID.'));
    };
  }
  if (!save.googleLinked) initGoogleSignInButton();
  const googleUnlinkBtn = document.getElementById('google-unlink');
  if (googleUnlinkBtn) {
    googleUnlinkBtn.onclick = async () => {
      googleUnlinkBtn.disabled = true;
      const seq = nextAccountSyncSeq();
      try {
        const account = await Net.unlinkGoogleAccount();
        syncAccountToSave(account, seq);
        showToast('Cuenta desvinculada de Google.');
        renderProfile(false);
      } catch {
        showToast('No se pudo desvincular. ¿Está corriendo el servidor?');
        googleUnlinkBtn.disabled = false;
      }
    };
  }
  document.getElementById('btn-friends').onclick = () => go('friends');
  document.getElementById('delete-account-btn').onclick = () => {
    deleteAccountConfirmOpen = true;
    renderProfile(false);
  };
  const deleteCancelBtn = document.getElementById('delete-account-cancel');
  if (deleteCancelBtn) {
    deleteCancelBtn.onclick = () => {
      deleteAccountConfirmOpen = false;
      renderProfile(false);
    };
  }
  const deleteConfirmBtn = document.getElementById('delete-account-confirm');
  if (deleteConfirmBtn) {
    deleteConfirmBtn.onclick = async () => {
      deleteConfirmBtn.disabled = true;
      try {
        await Net.deleteAccount();
        Net.clearToken();
        Store.clearSave();
        location.reload();
      } catch {
        showToast('No se pudo borrar la cuenta. ¿Está corriendo el servidor?');
        deleteConfirmBtn.disabled = false;
      }
    };
  }

  if (fetchFresh) {
    const seq = nextAccountSyncSeq();
    Net.fetchAccount()
      .then((account) => {
        if (!account || screen !== 'profile' || profileEditingName) return;
        syncAccountToSave(account, seq);
        renderProfile(false);
      })
      .catch(() => {});
  }
}

function friendRowHtml(friend) {
  return `
    <div class="friend-row">
      <div class="friend-row-info">
        <span class="friend-row-name">${escapeHtml(friend.username)}</span>
        <span class="friend-row-trophies">🏆 ${friend.trophies}</span>
      </div>
      <button class="btn small friend-invite-btn">Crear sala</button>
    </div>`;
}

// Friend codes are just account tokens (see server/accounts.js addFriend) —
// no separate identity system, adding is immediate/mutual, no request step.
// "Crear sala" reuses the exact same private-room flow as the home screen's
// online-create option (see playSelectedDeck('create')); there's no live
// push-invite yet, so the code still has to be shared with the friend
// through some other channel (chat, voice, etc.) — a natural v2 once the
// app keeps a persistent connection for online presence.
function renderFriends() {
  const token = Net.getToken() || '';

  function loadFriends() {
    Net.fetchFriends()
      .then((friends) => {
        if (screen !== 'friends') return;
        const list = document.getElementById('friends-list');
        if (!list) return;
        list.innerHTML = friends.length ? friends.map(friendRowHtml).join('') : '<p class="hint">Todavía no agregaste amigos.</p>';
        app.querySelectorAll('.friend-invite-btn').forEach((btn) => {
          btn.onclick = () => playSelectedDeck('create');
        });
      })
      .catch(() => {
        const list = document.getElementById('friends-list');
        if (list) list.innerHTML = '<p class="hint">No se pudo cargar la lista. ¿Está corriendo el servidor?</p>';
      });
  }

  app.innerHTML = `
    ${header()}
    <div class="screen">
      <div class="screen-header"><button class="btn back" id="back">← Volver</button><h2>Amigos</h2></div>
      <button class="profile-id-row" id="copy-friend-code" data-tooltip="Copiar código completo">
        <span class="hint">Tu código de amigo: ${token ? escapeHtml(token.slice(0, 8)) + '…' : '—'}</span>
        <span class="profile-copy-icon">📋</span>
      </button>
      <p class="hint">Compartiselo a un amigo para que te agregue. Para agregar a alguien, pedile el suyo.</p>
      <div class="friend-add-row">
        <input id="friend-code-input" class="join-code-input" placeholder="Código de tu amigo" autocapitalize="off" autocomplete="off">
        <button class="btn" id="add-friend-btn">Agregar</button>
      </div>
      <div id="friends-list" class="friends-list"><p class="hint">Cargando…</p></div>
      <h3 class="profile-section-title">¿Tenés un código de sala?</h3>
      <p class="hint">Si un amigo te compartió un código con "Crear sala", unite directo acá.</p>
      <div class="friend-add-row">
        <input id="join-room-code-input" class="join-code-input" placeholder="Código de sala" maxlength="5" autocapitalize="characters">
        <button class="btn" id="join-room-code-btn">Unirse</button>
      </div>
    </div>`;

  document.getElementById('back').onclick = () => go('home');
  document.getElementById('copy-friend-code').onclick = () => {
    navigator.clipboard
      .writeText(token)
      .then(() => showToast('Código copiado.'))
      .catch(() => showToast('No se pudo copiar.'));
  };
  document.getElementById('add-friend-btn').onclick = async () => {
    const input = document.getElementById('friend-code-input');
    const code = input.value.trim();
    if (!code) {
      input.focus();
      return;
    }
    try {
      await Net.addFriend(code);
      input.value = '';
      Stats.bumpStat(save, 'friendsAdded', 1);
      persist();
      showToast('Amigo agregado ✅');
      loadFriends();
    } catch (err) {
      showToast(err.message || 'No se pudo agregar.');
    }
  };
  document.getElementById('join-room-code-btn').onclick = () => {
    const input = document.getElementById('join-room-code-input');
    const code = input.value.trim().toUpperCase();
    if (!code) {
      input.focus();
      return;
    }
    joinRoomByCode(code);
  };

  loadFriends();
}

// First-login onboarding: mandatory (no back button) faction choice, then
// grants that faction's 16-card starter deck and drops straight into the
// guided tutorial battle. Reuses the .hero-card grid styling from the
// (otherwise now-vestigial) online hero-select screen below.
function renderFactionPick() {
  const cardsHtml = HEROES.map((hero) => {
    const faction = FACTIONS[hero.faction];
    return `
      <div class="hero-card theme-${faction.theme}" data-faction="${hero.faction}">
        <div class="hero-card-faction">${faction.name}</div>
        <div class="hero-card-name">${hero.name}</div>
        <div class="hero-card-tagline">${faction.tagline}</div>
        <div class="hero-card-special"><strong>${hero.special.label}:</strong> ${hero.special.text}</div>
      </div>`;
  }).join('');
  app.innerHTML = `
    ${header()}
    <div class="screen">
      <div class="screen-header"><h2>Elegí tu facción</h2></div>
      <label class="hint" for="faction-pick-username">Elegí tu nombre de jugador</label>
      <input id="faction-pick-username" class="profile-name-input faction-pick-name-input" maxlength="20" autocomplete="off" placeholder="Ej: DragonSlayer99" value="${escapeAttr(save.username || '')}">
      <p class="hint">Vas a empezar con un mazo básico completo (${Store.CONSTANTS.DECK_SIZE} cartas) de la facción que elijas. Las demás se desbloquean después con sobres — podés cambiar tu mazo principal cuando quieras desde "Mis Mazos".</p>
      <div class="hero-select-grid">${cardsHtml}</div>
    </div>`;
  app.querySelectorAll('.hero-card').forEach((el) => {
    el.onclick = () => {
      const nameInput = document.getElementById('faction-pick-username');
      const username = nameInput.value.trim();
      if (!username) {
        showToast('Ingresá un nombre antes de elegir tu facción.');
        nameInput.focus();
        return;
      }
      const faction = el.dataset.faction;
      Store.grantStarterDeck(save, faction);
      save.selectedFaction = faction;
      save.username = username;
      persist();
      const seq = nextAccountSyncSeq();
      Net.renameAccount(username)
        .then((account) => syncAccountToSave(account, seq))
        .catch(() => {});
      startGuidedTutorialMatch(faction);
    };
  });
}

// Mis Mazos: since a deck can now freely mix cards from every faction (see
// store.js), there's exactly one deck per mode (Normal / 🤖 Auto) instead
// of one per faction — this screen picks the hero (special ability +
// attribute track) that represents that deck in battle, independent of
// which factions its cards actually come from, then hands off to
// renderDeckbuilder() to edit the card list itself.
function renderDeckSelect() {
  const deckKey = deckMode === 'auto' ? 'autoDeck' : 'deck';
  const selectedField = deckMode === 'auto' ? 'selectedAutoFaction' : 'selectedFaction';
  const count = Store.deckCount(save, deckKey);
  const complete = count === Store.CONSTANTS.DECK_SIZE;
  const pct = Math.min(100, Math.round((count / Store.CONSTANTS.DECK_SIZE) * 100));
  const selectedHeroFaction = resolvePlayHero(deckMode === 'auto');
  const heroChips = Object.values(FACTIONS)
    .filter((faction) => HEROES.some((h) => h.faction === faction.id))
    .map((faction) => {
      const hero = HEROES.find((h) => h.faction === faction.id);
      const selected = save[selectedField] ? save[selectedField] === faction.id : selectedHeroFaction === faction.id;
      return `
        <button class="hero-chip theme-${faction.theme} ${selected ? 'selected' : ''}" data-select-hero="${faction.id}" data-tooltip="${escapeAttr(`${hero.name} — ${hero.special.label}: ${hero.special.text}`)}">
          <span class="hero-chip-icon">${FACTION_PERKS[faction.id]?.icon || '⭐'}</span>
          <span class="hero-chip-name">${hero.name}</span>
          <span class="hero-chip-faction">${faction.name}</span>
        </button>`;
    })
    .join('');
  app.innerHTML = `
    ${header()}
    <div class="screen deck-select-screen">
      <div class="screen-header"><button class="btn back" id="back">← Volver</button><h2>Mis Mazos</h2></div>
      <div class="deck-mode-tabs">
        <button class="deck-mode-tab ${deckMode === 'normal' ? 'active' : ''}" data-mode="normal">Normal</button>
        <button class="deck-mode-tab ${deckMode === 'auto' ? 'active' : ''}" data-mode="auto">🤖 Auto</button>
      </div>
      <p class="hint">
        ${
          deckMode === 'auto'
            ? 'Se juega solo, una carta por turno, sin elegir atributos a mano.'
            : `Tu mazo necesita exactamente ${Store.CONSTANTS.DECK_SIZE} cartas (máximo ${Store.CONSTANTS.MAX_COPIES} copias de cada una) para poder jugar — podés mezclar cartas de cualquier facción libremente.`
        }
      </p>
      <h3>Elegí tu héroe</h3>
      <p class="hint">Define tu especial y tus atributos en batalla — no tiene que coincidir con las facciones de tu mazo.</p>
      <div class="hero-chip-row">${heroChips}</div>
      <div class="deck-progress">
        <div class="deck-progress-label">${count}/${Store.CONSTANTS.DECK_SIZE} cartas${complete ? ' · Mazo completo ✓' : ''}</div>
        <div class="deck-progress-bar"><div class="deck-progress-fill ${complete ? 'complete' : ''}" style="width:${pct}%"></div></div>
      </div>
      <p class="hint">🛡️🔥🌑⛰️ Tené 4 o más criaturas de una misma facción en juego para activar su bono — podés tener hasta dos bonos activos a la vez si mezclás facciones.</p>
      <div class="deck-edit-btn-wrap">
        <button class="deck-edit-btn" id="open-deckbuilder">
          <span class="deck-edit-btn-icon">✏️</span>
          <span>Editar mazo</span>
        </button>
      </div>
    </div>`;
  document.getElementById('back').onclick = () => go('home');
  app.querySelectorAll('[data-mode]').forEach((el) => {
    el.onclick = () => {
      deckMode = el.dataset.mode;
      renderDeckSelect();
    };
  });
  document.getElementById('open-deckbuilder').onclick = () => go('deckbuilder');
  app.querySelectorAll('[data-select-hero]').forEach((el) => {
    el.onclick = () => {
      save[selectedField] = el.dataset.selectHero;
      persist();
      renderDeckSelect();
    };
  });
}

// Freeform card browser for the single Normal/Auto deck — grouped by
// faction purely for browsability (same section layout as Colección), not
// because the deck is restricted to one. Adding cards from several
// factions is exactly the point now; deckFactionBreakdown below just tells
// the player how close each faction is to its 4-creature perk threshold.
function renderDeckbuilder() {
  const deckKey = deckMode === 'auto' ? 'autoDeck' : 'deck';
  const deck = save[deckKey];
  const count = Store.deckCount(save, deckKey);
  const pct = Math.min(100, Math.round((count / Store.CONSTANTS.DECK_SIZE) * 100));
  const complete = count === Store.CONSTANTS.DECK_SIZE;
  const breakdown = Store.deckFactionBreakdown(deck);

  const deckPoolSection = (pool, sectionFaction) => {
    const ids = pool.map((c) => c.id).filter((id) => (save.collection[id] || 0) > 0);
    if (!ids.length) return '';
    const itemsHtml = ids
      .map((id) => {
        const card = getCard(id);
        const inDeck = deck[id] || 0;
        const owned = save.collection[id];
        const canAdd = Store.canAddToDeck(save, id, deckKey);
        return `
        <div class="collection-slot deck-slot">
          ${cardVisual(card, inDeck > 0 ? 'in-deck' : '')}
          <div class="deck-stepper">
            <button class="stepper-btn" data-action="remove" data-id="${id}" ${inDeck === 0 ? 'disabled' : ''}>−</button>
            <span class="stepper-count">${inDeck}/${owned}</span>
            <button class="stepper-btn" data-action="add" data-id="${id}" ${canAdd ? '' : 'disabled'}>+</button>
          </div>
        </div>`;
      })
      .join('');
    const inDeckCount = breakdown[sectionFaction.id] || 0;
    const perk = FACTION_PERKS[sectionFaction.id];
    const perkNote = perk ? ` · ${inDeckCount}/4 en el mazo para el bono de ${perk.icon}` : '';
    return `
      <div class="faction-section theme-${sectionFaction.theme}">
        <div class="faction-section-header">
          <h3>${sectionFaction.name}</h3>
          <span class="faction-section-tagline">${sectionFaction.tagline}${perkNote}</span>
        </div>
        <div class="card-grid">${itemsHtml}</div>
      </div>`;
  };

  const sections = Object.values(FACTIONS)
    .filter((faction) => deckbuilderFactionTab === 'all' || deckbuilderFactionTab === faction.id)
    .map((faction) => deckPoolSection(cardsForFaction(faction.id), faction))
    .join('');

  app.innerHTML = `
    ${header()}
    <div class="screen deck-select-screen">
      <div class="screen-header"><button class="btn back" id="back">← Volver</button><h2>Editar mazo${deckMode === 'auto' ? ' 🤖' : ''}</h2></div>
      <div class="deck-progress">
        <div class="deck-progress-label">${count}/${Store.CONSTANTS.DECK_SIZE} cartas${complete ? ' · Mazo completo ✓' : ''}</div>
        <div class="deck-progress-bar"><div class="deck-progress-fill ${complete ? 'complete' : ''}" style="width:${pct}%"></div></div>
      </div>
      <button class="btn auto-build-btn" id="auto-build-deck" data-tooltip="Reemplaza este mazo por uno al azar con cartas que ya tenés">🎲 Autoconstruir mazo</button>
      ${factionTabsHtml(deckbuilderFactionTab)}
      ${sections}
    </div>`;
  document.getElementById('back').onclick = () => go('deckSelect');
  document.getElementById('auto-build-deck').onclick = () => {
    Store.autoBuildDeck(save, deckKey);
    persist();
    sfx.click();
    renderDeckbuilder();
  };
  app.querySelectorAll('[data-faction-tab]').forEach((btn) => {
    btn.onclick = () => {
      deckbuilderFactionTab = btn.dataset.factionTab;
      renderDeckbuilder();
    };
  });
  app.querySelectorAll('[data-action="add"]').forEach((btn) => {
    btn.onclick = () => {
      Store.addToDeck(save, btn.dataset.id, deckKey);
      persist();
      renderDeckbuilder();
    };
  });
  app.querySelectorAll('[data-action="remove"]').forEach((btn) => {
    btn.onclick = () => {
      Store.removeFromDeck(save, btn.dataset.id, deckKey);
      persist();
      renderDeckbuilder();
    };
  });
}

// Shared by Colección and the deckbuilder — a faction filter bar in the
// same tab-pill style as the Misiones screen's category tabs.
function factionTabsHtml(activeTab) {
  const tabs = [{ id: 'all', icon: '🗂️', name: 'Todas' }, ...Object.values(FACTIONS)];
  return `<div class="mission-tabs">${tabs
    .map(
      (f) => `
      <button class="mission-tab ${activeTab === f.id ? 'active' : ''}" data-faction-tab="${f.id}">
        ${f.id === 'all' ? f.icon : FACTION_PERKS[f.id]?.icon || '🃏'} ${f.id === 'all' ? f.name : f.name}
      </button>`
    )
    .join('')}</div>`;
}

function renderCollection() {
  const totalOwned = CARDS.filter((c) => (save.collection[c.id] || 0) > 0).length;
  const totalPct = Math.round((totalOwned / CARDS.length) * 100);
  const excessDust = CARDS.reduce((sum, c) => {
    const excess = (save.collection[c.id] || 0) - Store.CONSTANTS.MAX_COPIES;
    return excess > 0 ? sum + excess * (Store.CONSTANTS.DUST_VALUE[c.rarity] || 0) : sum;
  }, 0);

  const sections = Object.values(FACTIONS)
    .filter((faction) => collectionFactionTab === 'all' || collectionFactionTab === faction.id)
    .map((faction) => {
      const factionCards = cardsForFaction(faction.id);
      const factionOwned = factionCards.filter((c) => (save.collection[c.id] || 0) > 0).length;
      const cardsHtml = factionCards
        .map((card) => {
          const owned = save.collection[card.id] || 0;
          const actionHtml =
            owned > 0
              ? `<button class="btn tiny dust-btn" data-disenchant="${card.id}" data-tooltip="Desencantar por ${Store.CONSTANTS.DUST_VALUE[card.rarity]} de polvo">✨+${Store.CONSTANTS.DUST_VALUE[card.rarity]}</button>`
              : `<button class="btn tiny dust-btn" data-craft="${card.id}" ${(save.dust || 0) < Store.CONSTANTS.CRAFT_COST[card.rarity] ? 'disabled' : ''} data-tooltip="Craftear por ${Store.CONSTANTS.CRAFT_COST[card.rarity]} de polvo">✨${Store.CONSTANTS.CRAFT_COST[card.rarity]}</button>`;
          return `<div class="collection-slot">${cardVisual(card, owned === 0 ? 'locked' : '')}<div class="owned-count">x${owned}</div>${actionHtml}</div>`;
        })
        .join('');
      const perk = FACTION_PERKS[faction.id];
      return `
        <div class="faction-section theme-${faction.theme}">
          <div class="faction-section-header">
            <h3>${faction.name}</h3>
            <span class="faction-section-tagline">${faction.tagline}</span>
            ${perk ? `<span class="faction-section-perk" data-tooltip="${escapeAttr(perk.text)}">${perk.icon} ${perk.name}</span>` : ''}
            <span class="faction-section-progress">${factionOwned}/${factionCards.length}</span>
          </div>
          <div class="card-grid">${cardsHtml}</div>
        </div>`;
    })
    .join('');
  app.innerHTML = `
    ${header()}
    <div class="screen">
      <div class="screen-header"><button class="btn back" id="back">← Volver</button><h2>Colección</h2></div>
      <div class="deck-progress">
        <div class="deck-progress-label">${totalOwned}/${CARDS.length} cartas conseguidas${totalOwned === CARDS.length ? ' · Colección completa ✓' : ''}</div>
        <div class="deck-progress-bar"><div class="deck-progress-fill ${totalOwned === CARDS.length ? 'complete' : ''}" style="width:${totalPct}%"></div></div>
      </div>
      <button class="btn auto-disenchant-btn" id="auto-disenchant" ${excessDust > 0 ? '' : 'disabled'} data-tooltip="Desencanta toda copia por encima de ${Store.CONSTANTS.MAX_COPIES} de cada carta">
        ✨ Desencantar excedentes${excessDust > 0 ? ` (+${excessDust})` : ''}
      </button>
      ${factionTabsHtml(collectionFactionTab)}
      ${sections}
    </div>`;
  document.getElementById('back').onclick = () => go('home');
  app.querySelectorAll('[data-faction-tab]').forEach((btn) => {
    btn.onclick = () => {
      collectionFactionTab = btn.dataset.factionTab;
      renderCollection();
    };
  });
  document.getElementById('auto-disenchant').onclick = () => {
    const res = Store.disenchantExcess(save);
    if (res.cardsAffected > 0) {
      Stats.bumpStat(save, 'dustEarned', res.totalDust);
      persist();
      sfx.coin();
      showToast(`+${res.totalDust} de polvo ✨ (${res.cardsAffected} carta${res.cardsAffected > 1 ? 's' : ''})`);
      rerenderPreservingScroll(renderCollection);
    }
  };
  app.querySelectorAll('[data-disenchant]').forEach((btn) => {
    btn.onclick = () => {
      const res = Store.disenchant(save, btn.dataset.disenchant);
      if (res.ok) {
        Stats.bumpStat(save, 'dustEarned', res.dustGained);
        persist();
        showToast(`+${res.dustGained} de polvo ✨`);
        renderCollection();
      }
    };
  });
  app.querySelectorAll('[data-craft]').forEach((btn) => {
    btn.onclick = () => {
      const res = Store.craft(save, btn.dataset.craft);
      if (res.ok) {
        Stats.bumpStat(save, 'cardsCrafted', 1);
        persist();
        renderCollection();
      } else if (res.reason === 'dust') {
        showToast('No tenés suficiente polvo para craftear esta carta.');
      }
    };
  });
}

const FACTION_PACK_ICON = { albura: '🕊️', ignara: '🔥', umbra: '🌑', terra: '⛰️' };

function renderShop() {
  const gemSkus = GEM_SKUS.map(
    (sku) => `
    <button class="btn sku" data-sku="${sku.id}">
      <span>💎 ${sku.gems}</span><span class="price">${sku.priceLabel}</span>
    </button>`
  ).join('');
  const coinSkus = COIN_SKUS.map(
    (sku) => `
    <button class="btn sku" data-coin-sku="${sku.id}">
      <span>🪙 ${sku.coins}</span><span class="price">${sku.priceLabel}</span>
    </button>`
  ).join('');
  const dustSkus = DUST_SKUS.map(
    (sku) => `
    <button class="btn sku" data-dust-sku="${sku.id}">
      <span>✨ ${sku.dust}</span><span class="price">${sku.priceLabel}</span>
    </button>`
  ).join('');
  const themedPacksHtml = Object.values(FACTIONS)
    .filter((f) => f.id !== 'neutral')
    .map((faction) => {
      const packId = `${faction.id}_pack`;
      const pack = PACKS[packId];
      return `
      <button class="btn pack theme-${faction.theme}" data-buy-pack="${packId}">
        <div class="pack-icon">${FACTION_PACK_ICON[faction.id] || '📦'}</div>
        <div>${pack.label}</div>
        <div class="price">🪙 ${pack.cost}</div>
      </button>`;
    })
    .join('');
  const welcomeOfferHtml = save.welcomeOfferClaimed
    ? ''
    : `
    <div class="welcome-offer">
      <div class="welcome-offer-badge">¡Oferta única!</div>
      <h3>${WELCOME_OFFER.label}</h3>
      <div class="welcome-offer-rewards">🪙 ${WELCOME_OFFER.coins} &nbsp;+&nbsp; 💎 ${WELCOME_OFFER.gems}</div>
      <button class="btn primary" id="buy-welcome-offer">Comprar por ${WELCOME_OFFER.priceLabel}</button>
    </div>`;

  const arenaOfferHtml = (() => {
    const arenaIdx = Ladder.getArenaIndex(save.trophies || 0);
    if (arenaIdx === 0) return ''; // starting arena — everyone begins here, not a milestone
    const arena = Ladder.ARENAS[arenaIdx];
    if ((save.claimedArenaOffers || []).includes(arena.id)) return '';
    const offer = getArenaOffer(arena.id);
    if (!offer) return '';
    return `
    <div class="welcome-offer">
      <div class="welcome-offer-badge">${arena.icon} ¡Subiste de liga!</div>
      <h3>${offer.label}</h3>
      <div class="welcome-offer-rewards">🪙 ${offer.coins} &nbsp;+&nbsp; 💎 ${offer.gems}</div>
      <button class="btn primary" id="buy-arena-offer" data-arena="${arena.id}">Comprar por ${offer.priceLabel}</button>
    </div>`;
  })();

  const draftBundleOfferHtml = save.draftBundleClaimed
    ? ''
    : `
    <div class="welcome-offer">
      <div class="welcome-offer-badge">¡Oferta única!</div>
      <h3>${Draft.DRAFT_BUNDLE_SKU.label}</h3>
      <div class="welcome-offer-rewards">🎴 x${Draft.DRAFT_BUNDLE_SKU.entries}</div>
      <button class="btn primary" id="buy-draft-bundle">Comprar por ${Draft.DRAFT_BUNDLE_SKU.priceLabel}</button>
    </div>`;

  const tournamentBundleOfferHtml = save.tournamentBundleClaimed
    ? ''
    : `
    <div class="welcome-offer">
      <div class="welcome-offer-badge">¡Oferta única!</div>
      <h3>${Tournament.TOURNAMENT_BUNDLE_SKU.label}</h3>
      <div class="welcome-offer-rewards">🏆 x${Tournament.TOURNAMENT_BUNDLE_SKU.entries}</div>
      <button class="btn primary" id="buy-tournament-bundle">Comprar por ${Tournament.TOURNAMENT_BUNDLE_SKU.priceLabel}</button>
    </div>`;

  const dailyDeals = DailyDeals.ensureDailyDeals(save).deals;
  const dailyDealsHtml = dailyDeals
    .map((deal) => {
      const purchased = DailyDeals.isDealPurchased(save, deal.id);
      const priceIcon = deal.currency === 'coins' ? '🪙' : '💎';
      const visual = deal.entryType
        ? `<div class="daily-deal-entry-visual">${deal.entryType === 'draft' ? '🎴' : '🏆'}<span>${
            deal.entryType === 'draft' ? Draft.DRAFT_ENTRY_SKU.label : Tournament.TOURNAMENT_ENTRY_SKU.label
          }</span></div>`
        : cardVisual(getCard(deal.cardId));
      return `
      <div class="daily-deal-slot">
        ${visual}
        <button class="btn ${purchased ? '' : 'primary'} small daily-deal-btn" data-daily-deal="${deal.id}" ${purchased ? 'disabled' : ''}>
          ${purchased ? 'Comprado ✓' : `${priceIcon} ${deal.amount}`}
        </button>
      </div>`;
    })
    .join('');

  app.innerHTML = `
    ${header()}
    <div class="screen">
      <div class="screen-header"><button class="btn back" id="back">← Volver</button><h2>Tienda</h2></div>

      ${welcomeOfferHtml}
      ${arenaOfferHtml}

      <h3>Entradas</h3>
      <p class="hint">Se consumen al entrar a la fila de Draft o Torneo, y se devuelven si cancelás antes de que empiece la partida.</p>
      <div class="sku-grid">
        <button class="btn sku" id="buy-draft-entry">
          <span>🎴 ${Draft.DRAFT_ENTRY_SKU.label}</span><span class="price">${Draft.DRAFT_ENTRY_SKU.priceLabel}</span>
        </button>
        <button class="btn sku" id="buy-tournament-entry">
          <span>🏆 ${Tournament.TOURNAMENT_ENTRY_SKU.label}</span><span class="price">${Tournament.TOURNAMENT_ENTRY_SKU.priceLabel}</span>
        </button>
      </div>
      ${draftBundleOfferHtml}
      ${tournamentBundleOfferHtml}

      <h3>🗓️ Tienda del Día</h3>
      <p class="hint">Tres cartas al azar: común, rara y una premium (normalmente épica, rara vez legendaria). Se renuevan mañana.</p>
      <div class="daily-deal-row">${dailyDealsHtml}</div>

      <h3>Sobres</h3>
      <div class="pack-row">
        <button class="btn pack" id="buy-coin-pack">
          <div class="pack-icon">📦</div>
          <div>${PACKS.coin_pack.label}</div>
          <div class="price">🪙 ${PACKS.coin_pack.cost}</div>
        </button>
        <button class="btn pack" id="buy-gem-pack">
          <div class="pack-icon">🎁</div>
          <div>${PACKS.gem_pack.label}</div>
          <div class="price">💎 ${PACKS.gem_pack.cost}</div>
        </button>
        <button class="btn pack" id="buy-legendary-pack">
          <div class="pack-icon">🏆</div>
          <div>${PACKS.legendary_pack.label}</div>
          <div class="price">💎 ${PACKS.legendary_pack.cost}</div>
        </button>
      </div>

      <h3>Sobres de Facción</h3>
      <p class="hint">Garantizan cartas sólo de esa facción — sin cartas de otra facción ni del Gremio Errante. Por eso cuestan 1.5x el Sobre de Bronce.</p>
      <div class="faction-pack-grid">${themedPacksHtml}</div>

      <button class="btn ad" id="watch-ad" ${canWatchAd(save) ? '' : 'disabled'}>
        📺 ${canWatchAd(save) ? `Ver anuncio → +${AD_REWARD.coins} monedas (${adsWatchedToday(save)}/${AD_DAILY_LIMIT} hoy)` : `Máximo diario alcanzado (${AD_DAILY_LIMIT}/${AD_DAILY_LIMIT})`}
      </button>

      <h3>Monedas (compra simulada)</h3>
      <div class="sku-grid">${coinSkus}</div>

      <h3>Gemas (compra simulada)</h3>
      <p class="hint">Demo de UX de compra. Para producción hay que integrar Stripe / App Store / Google Play Billing.</p>
      <div class="sku-grid">${gemSkus}</div>

      <h3>Polvo (compra simulada)</h3>
      <p class="hint">Precio elevado a propósito: el polvo craftea cartas específicas, así que no reemplaza a los sobres como forma principal de completar la colección.</p>
      <div class="sku-grid">${dustSkus}</div>
    </div>`;
  document.getElementById('back').onclick = () => go('home');
  document.getElementById('buy-coin-pack').onclick = () => tryBuyPack('coin_pack');
  document.getElementById('buy-gem-pack').onclick = () => tryBuyPack('gem_pack');
  document.getElementById('buy-legendary-pack').onclick = () => tryBuyPack('legendary_pack');
  document.getElementById('watch-ad').onclick = () => watchAd();
  const welcomeBtn = document.getElementById('buy-welcome-offer');
  if (welcomeBtn) welcomeBtn.onclick = () => buyWelcomeOffer();
  const arenaOfferBtn = document.getElementById('buy-arena-offer');
  if (arenaOfferBtn) arenaOfferBtn.onclick = () => buyArenaOffer(arenaOfferBtn.dataset.arena);
  const draftBundleBtn = document.getElementById('buy-draft-bundle');
  if (draftBundleBtn) draftBundleBtn.onclick = () => buyDraftBundle();
  const tournamentBundleBtn = document.getElementById('buy-tournament-bundle');
  if (tournamentBundleBtn) tournamentBundleBtn.onclick = () => buyTournamentBundle();
  document.getElementById('buy-draft-entry').onclick = () => buyDraftEntrySku();
  document.getElementById('buy-tournament-entry').onclick = () => buyTournamentEntrySku();
  app.querySelectorAll('[data-sku]').forEach((btn) => {
    btn.onclick = () => mockPurchase(btn.dataset.sku);
  });
  app.querySelectorAll('[data-coin-sku]').forEach((btn) => {
    btn.onclick = () => mockPurchaseCoins(btn.dataset.coinSku);
  });
  app.querySelectorAll('[data-dust-sku]').forEach((btn) => {
    btn.onclick = () => mockPurchaseDust(btn.dataset.dustSku);
  });
  app.querySelectorAll('[data-buy-pack]').forEach((btn) => {
    btn.onclick = () => tryBuyPack(btn.dataset.buyPack);
  });
  app.querySelectorAll('[data-daily-deal]').forEach((btn) => {
    btn.onclick = () => buyDailyDeal(btn.dataset.dailyDeal);
  });
}

function buyDailyDeal(dealId) {
  const result = DailyDeals.buyDeal(save, dealId);
  if (!result.ok) {
    if (result.reason === 'balance') showToast('Saldo insuficiente para esta carta.');
    return;
  }
  Stats.bumpStat(save, 'dailyDealsBought', 1);
  persist();
  sfx.coin();
  renderShop();
}

function tryBuyPack(packId) {
  const pack = PACKS[packId];
  const balance = pack.currency === 'coins' ? save.coins : save.gems;
  if (balance < pack.cost) {
    showToast('Saldo insuficiente. Podés ganar monedas jugando o comprar gemas en la tienda.');
    return;
  }
  if (pack.currency === 'coins') save.coins -= pack.cost;
  else save.gems -= pack.cost;
  Stats.bumpStat(save, 'shopPurchases', 1);
  persist();
  pendingPackId = packId;
  go('packOpen');
}

function buyWelcomeOffer() {
  if (save.welcomeOfferClaimed) return;
  save.coins += WELCOME_OFFER.coins;
  save.gems += WELCOME_OFFER.gems;
  save.welcomeOfferClaimed = true;
  Stats.bumpStat(save, 'shopPurchases', 1);
  persist();
  sfx.coin();
  renderShop();
}

function buyArenaOffer(arenaId) {
  if (!save.claimedArenaOffers) save.claimedArenaOffers = [];
  if (save.claimedArenaOffers.includes(arenaId)) return;
  const offer = getArenaOffer(arenaId);
  if (!offer) return;
  save.coins += offer.coins;
  save.gems += offer.gems;
  save.claimedArenaOffers.push(arenaId);
  Stats.bumpStat(save, 'shopPurchases', 1);
  persist();
  sfx.coin();
  renderShop();
}

function buyDraftEntrySku() {
  save.draftEntries = (save.draftEntries || 0) + 1;
  Stats.bumpStat(save, 'shopPurchases', 1);
  Stats.bumpStat(save, 'entriesBought', 1);
  persist();
  sfx.coin();
  renderShop();
}

function buyTournamentEntrySku() {
  save.tournamentEntries = (save.tournamentEntries || 0) + 1;
  Stats.bumpStat(save, 'shopPurchases', 1);
  Stats.bumpStat(save, 'entriesBought', 1);
  persist();
  sfx.coin();
  renderShop();
}

function buyDraftBundle() {
  if (save.draftBundleClaimed) return;
  save.draftEntries = (save.draftEntries || 0) + Draft.DRAFT_BUNDLE_SKU.entries;
  save.draftBundleClaimed = true;
  Stats.bumpStat(save, 'shopPurchases', 1);
  Stats.bumpStat(save, 'entriesBought', Draft.DRAFT_BUNDLE_SKU.entries);
  persist();
  sfx.coin();
  renderShop();
}

function buyTournamentBundle() {
  if (save.tournamentBundleClaimed) return;
  save.tournamentEntries = (save.tournamentEntries || 0) + Tournament.TOURNAMENT_BUNDLE_SKU.entries;
  save.tournamentBundleClaimed = true;
  Stats.bumpStat(save, 'shopPurchases', 1);
  Stats.bumpStat(save, 'entriesBought', Tournament.TOURNAMENT_BUNDLE_SKU.entries);
  persist();
  sfx.coin();
  renderShop();
}

function renderPackOpen() {
  const pack = PACKS[pendingPackId];
  const isPremium = pack.currency === 'gems';
  app.innerHTML = `
    ${header()}
    <div class="screen pack-open-screen">
      <div class="pack-stage">
        <div class="pack-envelope ${isPremium ? 'premium' : 'bronze'}" id="pack-envelope">
          <div class="pack-shine"></div>
          <div class="pack-icon">${isPremium ? '🎁' : '📦'}</div>
        </div>
      </div>
      <p class="pack-hint">Arrastrá el sobre para abrirlo ✨</p>
    </div>`;

  const envelope = document.getElementById('pack-envelope');
  let opened = false;

  envelope.addEventListener('click', () => {
    if (!opened) {
      opened = true;
      openPendingPack(envelope);
    }
  });

  envelope.addEventListener('pointerdown', (e) => {
    if (opened) return;
    const startX = e.clientX;
    const startY = e.clientY;
    envelope.style.animation = 'none';

    const onMove = (ev) => {
      const dx = ev.clientX - startX;
      const dy = ev.clientY - startY;
      const dist = Math.hypot(dx, dy);
      envelope.style.transform = `translate(${dx * 0.4}px, ${dy * 0.4}px) rotate(${dx * 0.05}deg)`;
      if (!opened && dist > 55) {
        opened = true;
        document.removeEventListener('pointermove', onMove);
        document.removeEventListener('pointerup', onUp);
        envelope.style.animation = '';
        envelope.style.transform = '';
        openPendingPack(envelope);
      }
    };
    const onUp = () => {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      if (!opened) {
        envelope.style.transform = '';
        envelope.style.animation = '';
      }
    };
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
  });
}

function openPendingPack(envelope) {
  const packId = pendingPackId;
  envelope.classList.add('tearing');
  spawnPackBurst(envelope);
  setTimeout(() => {
    const cards = openPack(packId);
    Store.addCardsToCollection(save, cards);
    Missions.addMissionProgress(save, 'packsOpened', 1);
    Stats.bumpStat(save, 'packsOpened', 1);
    persist();
    sfx.coin();
    lastPackReveal = cards;
    revealReturnScreen = 'shop';
    pendingPackId = null;
    go('reveal');
  }, 420);
}

function spawnPackBurst(envelope) {
  const rect = envelope.getBoundingClientRect();
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;
  const burst = document.createElement('div');
  burst.className = 'pack-burst';
  burst.style.left = `${cx}px`;
  burst.style.top = `${cy}px`;
  document.body.appendChild(burst);
  for (let i = 0; i < 14; i++) {
    const spark = document.createElement('div');
    spark.className = 'pack-spark';
    const angle = (i / 14) * Math.PI * 2;
    spark.style.setProperty('--dx', `${Math.cos(angle) * 90}px`);
    spark.style.setProperty('--dy', `${Math.sin(angle) * 90}px`);
    burst.appendChild(spark);
  }
  setTimeout(() => burst.remove(), 700);
}

// NOTE: no real ad network is wired up here (that needs an AdMob/Unity Ads
// account + SDK keys the user has to provide) — this plays a timed,
// un-skippable placeholder "ad" screen and only pays out once it's watched
// through, same contract a real rewarded-ad SDK callback would give us, so
// swapping in a real SDK later is just replacing this function's body.
const AD_WATCH_MS = 5000;

function watchAd(returnScreen = 'shop') {
  if (!canWatchAd(save)) {
    showToast(`Ya viste el máximo de ${AD_DAILY_LIMIT} anuncios hoy — volvé mañana.`);
    return;
  }
  let secondsLeft = Math.ceil(AD_WATCH_MS / 1000);
  app.innerHTML = `
    ${header()}
    <div class="screen center">
      <h2>📺 Reproduciendo anuncio…</h2>
      <p class="ad-countdown" id="ad-countdown">${secondsLeft}s</p>
      <p class="hint">(sin SDK de anuncios real conectado todavía — placeholder cronometrado)</p>
    </div>`;
  const countdownEl = document.getElementById('ad-countdown');
  const tick = setInterval(() => {
    secondsLeft -= 1;
    if (countdownEl) countdownEl.textContent = `${Math.max(0, secondsLeft)}s`;
  }, 1000);
  setTimeout(() => {
    clearInterval(tick);
    save.coins += AD_REWARD.coins;
    recordAdWatch(save);
    Missions.addMissionProgress(save, 'adsWatched', 1);
    Stats.bumpStat(save, 'adsWatched', 1);
    Stats.bumpStat(save, 'coinsEarned', AD_REWARD.coins);
    persist();
    sfx.coin();
    go(returnScreen);
  }, AD_WATCH_MS);
}

function mockPurchase(skuId) {
  const sku = GEM_SKUS.find((s) => s.id === skuId);
  save.gems += sku.gems;
  Stats.bumpStat(save, 'shopPurchases', 1);
  persist();
  sfx.coin();
  renderShop();
}

function mockPurchaseCoins(skuId) {
  const sku = COIN_SKUS.find((s) => s.id === skuId);
  save.coins += sku.coins;
  Stats.bumpStat(save, 'shopPurchases', 1);
  persist();
  sfx.coin();
  renderShop();
}

function mockPurchaseDust(skuId) {
  const sku = DUST_SKUS.find((s) => s.id === skuId);
  save.dust = (save.dust || 0) + sku.dust;
  Stats.bumpStat(save, 'shopPurchases', 1);
  persist();
  sfx.coin();
  renderShop();
}

function renderReveal() {
  const cardsHtml = lastPackReveal
    .map((c, i) => {
      const notable = c.rarity === 'epic' || c.rarity === 'legendary' ? 'notable-pull' : '';
      const baseDelay = i * 0.15;
      const delayStyle = notable ? `${baseDelay}s, ${baseDelay + 0.5}s` : `${baseDelay}s`;
      return `<div class="reveal-slot reveal-burst ${notable}" style="animation-delay:${delayStyle};--rarity-color:${RARITY_COLORS[c.rarity]}">${cardVisual(c, 'reveal-card')}</div>`;
    })
    .join('');
  app.innerHTML = `
    ${header()}
    <div class="screen">
      <h2>¡Cartas obtenidas!</h2>
      <div class="reveal-grid">${cardsHtml}</div>
      <button class="btn primary" id="continue">Continuar</button>
    </div>`;
  document.getElementById('continue').onclick = () => go(revealReturnScreen);
}

// ---------------- Draft mode ----------------
// 4 players pay to enter, pack-and-pass through 3 boosters each (+ a free
// 16th neutral card), pick a hero, then the server runs a 3-match bracket
// against their own pod using the exact same 1v1 engine/screens as any
// other online match (renderBattle is entirely unmodified — see
// server/draftPods.js for why). This section only covers the draft-specific
// screens (entry, queue, picking, hero pick) and the prize reveal.

// Gate + consume the entry, then hand off to startDraftEntry — shared by
// the Jugar-menu's Draft button and the Torneos screen's "Nuevo draft"
// button so both go through the exact same paywall/refund contract
// startDraftEntry (and its own failure-path refund) already expects: the
// caller decrements save.draftEntries up front, and startDraftEntry only
// ever gives that back on a genuine failure to actually start.
function enterDraftFlow() {
  if (!save.draftEntries) {
    showToast('No tenés entradas a Draft — comprá una en la Tienda.');
    go('shop');
    return;
  }
  save.draftEntries -= 1;
  Stats.bumpStat(save, 'entriesConsumed', 1);
  persist();
  startDraftEntry();
}

async function startDraftEntry() {
  draftQueueStatus = null;
  draftPack = null;
  draftPicksSoFar = [];
  draftHeroChosen = false;
  bracketStatus = null;
  bracketModalOpen = false;
  bracketFinishedForMe = false;
  screen = 'draftWaiting';
  render();
  try {
    await Net.connect();
  } catch {
    save.draftEntries = (save.draftEntries || 0) + 1;
    persist();
    showToast('No se pudo conectar con el servidor de Draft.');
    go('home');
    return;
  }
  Net.queueDraft();
}

function renderDraftWaiting() {
  const status = draftQueueStatus;
  const message = status ? `Esperando jugadores… (${status.waiting}/${status.needed})` : 'Conectando…';
  app.innerHTML = `
    ${header()}
    <div class="screen center online-waiting">
      <div class="spinner"></div><p>${message}</p>
      <button class="btn" id="cancel-draft">Cancelar</button>
    </div>`;
  document.getElementById('cancel-draft').onclick = () => {
    Net.cancelDraftQueue();
    save.draftEntries = (save.draftEntries || 0) + 1;
    persist();
    go('home');
  };
}

let draftTimerInterval = null;

function armDraftTimerDisplay() {
  clearInterval(draftTimerInterval);
  const tick = () => {
    const fill = document.getElementById('draft-timer-fill');
    if (!fill) {
      clearInterval(draftTimerInterval);
      return;
    }
    const remaining = Math.max(0, draftPickDeadline - Date.now());
    fill.style.width = `${(remaining / Draft.PICK_TIMER_MS) * 100}%`;
    fill.classList.toggle('urgent', remaining < 5000);
  };
  tick();
  draftTimerInterval = setInterval(tick, 200);
}

function renderDraftPick() {
  if (!draftPack) {
    app.innerHTML = `${header()}<div class="screen center"><div class="spinner"></div><p>Esperando el próximo sobre…</p></div>`;
    return;
  }
  const cardsHtml = draftPack.map((card) => `<button class="draft-pick-card" data-pick-id="${card.id}">${cardVisual(card)}</button>`).join('');
  app.innerHTML = `
    ${header()}
    <div class="screen draft-pick-screen">
      <div class="screen-header"><h2>Draft</h2></div>
      <p class="hint">Elegí una carta — el resto pasa a tu vecino. Carta ${draftPickCount + 1}/${Draft.TOTAL_PICKS}</p>
      <div class="draft-timer-bar"><div class="draft-timer-fill" id="draft-timer-fill"></div></div>
      <div class="draft-pack-grid">${cardsHtml}</div>
    </div>`;
  app.querySelectorAll('[data-pick-id]').forEach((el) => {
    el.onclick = () => {
      if (!draftPack) return;
      Net.pickDraftCard(el.dataset.pickId);
      draftPack = null;
      render();
    };
  });
  armDraftTimerDisplay();
}

function renderDraftHeroPick() {
  if (draftHeroChosen) {
    app.innerHTML = `${header()}<div class="screen center"><div class="spinner"></div><p>Esperando a que el resto del pod elija su héroe…</p></div>`;
    return;
  }
  const countByFaction = {};
  for (const card of draftPicksSoFar) countByFaction[card.faction] = (countByFaction[card.faction] || 0) + 1;
  const cardsHtml = HEROES.map((hero) => {
    const faction = FACTIONS[hero.faction];
    return `
      <div class="hero-card theme-${faction.theme}" data-faction="${hero.faction}">
        <div class="hero-card-faction">${faction.name} — ${countByFaction[hero.faction] || 0} carta${(countByFaction[hero.faction] || 0) === 1 ? '' : 's'} drafteada${(countByFaction[hero.faction] || 0) === 1 ? '' : 's'}</div>
        <div class="hero-card-name">${hero.name}</div>
        <div class="hero-card-tagline">${faction.tagline}</div>
        <div class="hero-card-special"><strong>${hero.special.label}:</strong> ${hero.special.text}</div>
      </div>`;
  }).join('');
  app.innerHTML = `
    ${header()}
    <div class="screen">
      <div class="screen-header"><h2>Elegí tu héroe</h2></div>
      <p class="hint">Tu mazo de draft mezcla lo que fuiste pickeando — elegí qué héroe te representa en el torneo (su especial y sus atributos, no tus cartas).</p>
      <div class="hero-select-grid">${cardsHtml}</div>
    </div>`;
  app.querySelectorAll('.hero-card').forEach((el) => {
    el.onclick = () => {
      Net.pickDraftHero(el.dataset.faction);
      draftHeroChosen = true;
      render();
    };
  });
}

// Shared by Draft and Torneo — both award the same shape of prize
// (packs and/or a consolation common card) via the same reveal screen.
// `kind` is only used to log Torneo results into save.tournamentHistory —
// Draft has no history screen (not asked for), so it's left undefined there.
function bracketPrizeReveal(prize, kind) {
  // This seat's part in the bracket is over the moment its prize arrives
  // (a semifinal loser gets theirs immediately; a finalist gets theirs once
  // the final resolves) — nothing more to show in the status subscreen.
  // bracketFinishedForMe latches this: the server sends prize-then-bracket-
  // update as two separate messages for the exact same event (see
  // server/draftPods.js/tournamentPods.js's awardPrize-then-broadcastBracket
  // ordering), and without the latch that trailing update would resurrect
  // bracketStatus right after this clears it — a floating status FAB stuck
  // on screen forever, ticking a timer nothing will ever clear again.
  bracketStatus = null;
  bracketModalOpen = false;
  bracketFinishedForMe = true;
  if (kind === 'tournament') recordTournamentHistory(prize);
  if (prize.commonCard) {
    Store.addCardsToCollection(save, [prize.commonCard]);
    persist();
    lastPackReveal = [prize.commonCard];
    revealReturnScreen = 'home';
    showToast('🎖️ Premio de participación');
    go('reveal');
  } else if (prize.packs) {
    const cards = prize.packs.flatMap((packId) => openPack(packId));
    Store.addCardsToCollection(save, cards);
    persist();
    lastPackReveal = cards;
    revealReturnScreen = 'home';
    showToast('🏆 ¡Ganaste sobres de premio!');
    go('reveal');
  }
}

// Placement is derived straight from the prize shape server/tournamentPods.js
// already sends (see startPod there): 2 packs = champion, 1 pack = runner-up,
// a lone commonCard = a semifinal loss. Newest first, capped so this can't
// grow the save file without bound over a long-lived account.
function recordTournamentHistory(prize) {
  const placement = prize.packs?.length === 2 ? 'champion' : prize.packs?.length === 1 ? 'runnerUp' : 'semifinalist';
  save.tournamentHistory = save.tournamentHistory || [];
  save.tournamentHistory.unshift({ date: new Date().toISOString().slice(0, 10), placement, prize });
  save.tournamentHistory = save.tournamentHistory.slice(0, 20);
}

// ---------------- Torneo mode ----------------
// 4 players pay to enter with their own already-built Normal deck (no
// drafting) and play the same 2-semis-plus-a-final bracket as Draft, for
// the same prizes — server/tournamentPods.js orchestrates it via the same
// startDirectMatch rooms.js uses for every other online match, so
// renderBattle is entirely unmodified here too.

// Same gate-then-consume contract as enterDraftFlow, shared by the
// Jugar-menu's Torneo button and the Torneos screen's "Nuevo torneo" button.
function enterTournamentFlow() {
  if (!isDeckReady(false)) {
    showToast('Completá tu mazo (16 cartas) en "Mis Mazos" antes de entrar a un torneo.');
    go('deckSelect');
    return;
  }
  if (!save.tournamentEntries) {
    showToast('No tenés entradas a Torneo — comprá una en la Tienda.');
    go('shop');
    return;
  }
  save.tournamentEntries -= 1;
  Stats.bumpStat(save, 'entriesConsumed', 1);
  persist();
  startTournamentEntry();
}

async function startTournamentEntry() {
  if (!isDeckReady(false)) {
    save.tournamentEntries = (save.tournamentEntries || 0) + 1;
    persist();
    showToast('Completá tu mazo (16 cartas) en "Mis Mazos" antes de entrar a un torneo.');
    go('deckSelect');
    return;
  }
  const faction = resolvePlayHero(false);
  tournamentQueueStatus = null;
  bracketStatus = null;
  bracketModalOpen = false;
  bracketFinishedForMe = false;
  screen = 'tournamentWaiting';
  render();
  try {
    await Net.connect();
  } catch {
    save.tournamentEntries = (save.tournamentEntries || 0) + 1;
    persist();
    showToast('No se pudo conectar con el servidor de Torneos.');
    go('home');
    return;
  }
  Net.queueTournament(faction, save.deck);
}

function renderTournamentWaiting() {
  const status = tournamentQueueStatus;
  const message = status ? `Esperando jugadores… (${status.waiting}/${status.needed})` : 'Conectando…';
  app.innerHTML = `
    ${header()}
    <div class="screen center online-waiting">
      <div class="spinner"></div><p>${message}</p>
      <button class="btn" id="cancel-tournament">Cancelar</button>
    </div>`;
  document.getElementById('cancel-tournament').onclick = () => {
    Net.cancelTournamentQueue();
    save.tournamentEntries = (save.tournamentEntries || 0) + 1;
    persist();
    go('home');
  };
}

const TOURNAMENT_PLACEMENT_LABEL = {
  champion: '🏆 Campeón',
  runnerUp: '🥈 Subcampeón',
  semifinalist: '🥉 Semifinalista',
};

function tournamentPrizeLabel(prize) {
  if (prize.packs) return prize.packs.map((packId) => PACKS[packId]?.label || packId).join(' + ');
  if (prize.commonCard) return `Carta: ${prize.commonCard.name}`;
  return '';
}

// Home's bottom-nav "Torneos" tab — a lightweight home base for both bracket
// modes (Draft included, since it's the same pack-and-pass-then-bracket
// shape as Torneo, just with drafted cards instead of your own deck): jump
// back into whatever's already in progress (the same live bracket the
// floating status FAB tracks — see bracketStatus), start a fresh Torneo or
// Draft, and browse past Torneo results (save.tournamentHistory, written by
// recordTournamentHistory whenever a tournamentPrize lands — Draft has no
// history log, only asked for Torneo's).
function renderTournaments() {
  const activeKind = bracketStatus?.kind; // 'tournament' | 'draft' | undefined
  const history = save.tournamentHistory || [];
  const activeCardHtml = (label, hint) => `
    <div class="welcome-offer">
      <div class="welcome-offer-badge">⏳ En curso</div>
      <h3>${label}</h3>
      <p class="hint">${hint}</p>
      <button class="btn primary" id="view-bracket-status">Ver estado</button>
    </div>`;
  const entryButtonsHtml = `
    <div class="tournament-entry-buttons">
      <button class="btn primary big" id="new-tournament">🏆 Nuevo torneo${
        save.tournamentEntries ? ` (${save.tournamentEntries} entrada${save.tournamentEntries === 1 ? '' : 's'})` : ''
      }</button>
      <button class="btn primary big" id="new-draft">🎴 Nuevo draft${
        save.draftEntries ? ` (${save.draftEntries} entrada${save.draftEntries === 1 ? '' : 's'})` : ''
      }</button>
    </div>`;
  app.innerHTML = `
    ${header()}
    <div class="screen">
      <div class="screen-header"><button class="btn back" id="back">← Volver</button><h2>🏆 Torneos</h2></div>
      ${
        activeKind === 'tournament'
          ? activeCardHtml('Tenés un torneo activo', 'Tu próxima partida del bracket va a empezar sola apenas esté lista.')
          : activeKind === 'draft'
            ? activeCardHtml('Tenés un draft activo', 'Tu próxima partida del bracket va a empezar sola apenas esté lista.')
            : entryButtonsHtml
      }
      <h3>Historial</h3>
      ${
        history.length
          ? `<div class="tournament-history">${history
              .map(
                (h) => `
              <div class="tournament-history-row">
                <span class="tournament-history-date">${h.date}</span>
                <span class="tournament-history-placement">${TOURNAMENT_PLACEMENT_LABEL[h.placement]}</span>
                <span class="tournament-history-reward">${escapeHtml(tournamentPrizeLabel(h.prize))}</span>
              </div>`
              )
              .join('')}</div>`
          : `<p class="hint">Todavía no jugaste ningún torneo.</p>`
      }
    </div>`;
  document.getElementById('back').onclick = () => go('home');
  const viewBtn = document.getElementById('view-bracket-status');
  if (viewBtn) viewBtn.onclick = () => { bracketModalOpen = true; render(); };
  const newBtn = document.getElementById('new-tournament');
  if (newBtn) newBtn.onclick = () => enterTournamentFlow();
  const newDraftBtn = document.getElementById('new-draft');
  if (newDraftBtn) newDraftBtn.onclick = () => enterDraftFlow();
}

// ---------------- Match lifecycle ----------------

// A deck no longer belongs to a single faction (see store.js) — "which
// faction" now only means which hero (special ability + attribute track)
// represents the player in battle, chosen separately in "Mis Mazos" and
// stored the same way as before (save.selectedFaction/selectedAutoFaction).
// Falls back to whichever faction is best represented in the deck, so a
// player who's never opened the hero picker still gets something sensible.
function resolvePlayHero(auto = false) {
  const field = auto ? 'selectedAutoFaction' : 'selectedFaction';
  if (save[field] && HEROES.some((h) => h.faction === save[field])) return save[field];
  const breakdown = Store.deckFactionBreakdown(save[auto ? 'autoDeck' : 'deck']);
  const best = Object.entries(breakdown)
    .filter(([f]) => f !== 'neutral')
    .sort((a, b) => b[1] - a[1])[0];
  return best ? best[0] : HEROES[0].faction;
}

function isDeckReady(auto = false) {
  return Store.deckCount(save, auto ? 'autoDeck' : 'deck') === Store.CONSTANTS.DECK_SIZE;
}

// The home screen's "Modo Normal"/"Autodeckbuilder" buttons — both are
// online-only now (see startOnlineMatch: matchmaking falls back to a bot
// opponent if no real player turns up within a few seconds, but there's no
// offline-vs-AI mode to fall back to on the client itself anymore).
function playSelectedDeck(mode, auto = false) {
  if (!isDeckReady(auto)) {
    showToast(`Completá tu mazo${auto ? ' 🤖 Auto' : ''} (${Store.CONSTANTS.DECK_SIZE} cartas) en "Mis Mazos" antes de jugar.`);
    deckMode = auto ? 'auto' : 'normal';
    go('deckSelect');
    return;
  }
  const faction = resolvePlayHero(auto);
  onlineIntent = { mode: mode === 'create' ? 'create' : 'quick', auto };
  startOnlineMatch(faction, auto);
}

// Counterpart to the Friends screen's "Crear sala" — joins a private room by
// code using the player's own deck/hero.
function joinRoomByCode(code) {
  if (!isDeckReady(false)) {
    showToast('Completá tu mazo (16 cartas) en "Mis Mazos" antes de jugar.');
    go('deckSelect');
    return;
  }
  onlineIntent = { mode: 'join', code };
  startOnlineMatch(resolvePlayHero(false));
}

function startGuidedTutorialMatch(faction) {
  tutorialCoachActive = true;
  tutorialProgress = { heroAction: false, deployed: false, endedTurn: false, attacked: false };
  startMatch(faction);
}

// Offline, purely local bot match — only used internally by the onboarding
// guided tutorial now (see startGuidedTutorialMatch). Every other "play
// vs someone" path goes through startOnlineMatch: real matchmaking, per
// task requirements, is online-only (with a bot fallback if no human is
// found — see startOnlineMatch/Net.quickMatch).
function startMatch(faction, auto = false) {
  // 'neutral' has no hero (see cards.js) — it must never be picked as the
  // AI's own faction, only mixed into decks as filler.
  const aiFactions = Object.keys(FACTIONS).filter((f) => f !== faction && f !== 'neutral');
  const aiFaction = aiFactions[Math.floor(Math.random() * aiFactions.length)];
  const playerHero = HEROES.find((h) => h.faction === faction);
  const aiHero = HEROES.find((h) => h.faction === aiFaction);
  const aiDeck = Store.buildAiDeck();
  const playerDeck = auto ? save.autoDeck : save.deck;
  battle = newGame(playerDeck, playerHero.id, aiDeck, aiHero.id);
  onlineRoom = null;
  prevOccupancy = new Set();
  selectedAttacker = null;
  pendingPlacement = null;
  pendingTarget = null;
  pendingReplace = null;
  battleMenuOpen = false;
  forfeitConfirmOpen = false;
  endTurnConfirmOpen = false;
  openPile = null;
  p1AutoPlay = auto;
  go('battle');
  if (auto) setTimeout(playAutoDeckTurn, 500);
}

function endMatch(winner) {
  // The guided coach only ever runs on a fresh onboarding match — if that
  // match ends (win, loss, or abandon) before the player reached the coach's
  // own "Entendido" step, mark it done anyway so they're never trapped back
  // into the guided flow on their next battle.
  if (tutorialCoachActive) {
    tutorialCoachActive = false;
    save.guidedTutorialDone = true;
  }
  const trophyResult = pendingTrophyResult;
  pendingTrophyResult = null;
  const wasOnline = !!onlineRoom;
  const wasAutoPlay = p1AutoPlay;
  onlineRoom = null;
  matchDeadline = null;
  p1AutoPlay = false;
  const won = winner === 'p1';
  const reward = matchReward(won);
  save.coins += reward.coins;
  Missions.addMissionProgress(save, 'battles', 1);
  if (won) Missions.addMissionProgress(save, 'wins', 1);
  Missions.addMissionProgress(save, 'heroDamage', battle.stats.heroDamageDealt);
  Missions.addMissionProgress(save, 'creaturesKilled', battle.stats.creaturesKilled);
  Missions.addMissionProgress(save, 'creaturesPlayed', battle.stats.creaturesPlayed);
  Stats.bumpStat(save, 'battles', 1);
  Stats.bumpStat(save, won ? 'wins' : 'losses', 1);
  Stats.bumpStat(save, 'heroDamage', battle.stats.heroDamageDealt);
  Stats.bumpStat(save, 'creaturesKilled', battle.stats.creaturesKilled);
  Stats.bumpStat(save, 'creaturesPlayed', battle.stats.creaturesPlayed);
  Stats.bumpStat(save, 'coinsEarned', reward.coins);
  if (wasOnline && won) Stats.bumpStat(save, 'onlineWins', 1);
  if (wasAutoPlay) Stats.bumpStat(save, 'autoDeckMatches', 1);
  SeasonPass.addSeasonXp(save, won ? SeasonPass.XP_REWARDS.matchWin : SeasonPass.XP_REWARDS.matchLoss);
  if (trophyResult) {
    Ladder.syncTrophies(save, trophyResult.trophies);
    Stats.bumpStatMax(save, 'peakTrophies', save.trophies);
  }
  persist();
  if (won) {
    sfx.win();
    vibrate([0, 40, 40, 40, 80]);
  } else {
    sfx.lose();
    vibrate(60);
  }
  const trophyLine = trophyResult
    ? `<p class="trophy-delta ${trophyResult.delta >= 0 ? 'positive' : 'negative'}">${trophyResult.delta >= 0 ? '+' : ''}${trophyResult.delta} 🏆 (${trophyResult.trophies} total)</p>`
    : '';
  app.innerHTML = `
    ${header()}
    <div class="screen center">
      <h1>${won ? '🏆 ¡Ganaste!' : winner === 'draw' ? '🤝 Empate' : '💀 Perdiste'}</h1>
      <p>+${reward.coins} monedas</p>
      ${trophyLine}
      <button class="btn primary" id="home">Volver al menú</button>
    </div>`;
  document.getElementById('home').onclick = () => go('home');
}

// ---------------- Online multiplayer ----------------

function renderOnlineWaiting() {
  const status = onlineStatus || { kind: 'connecting' };
  let message = 'Conectando…';
  if (status.kind === 'queued') message = 'Buscando un rival…';
  else if (status.kind === 'creating') message = 'Creando sala…';
  else if (status.kind === 'waitingCode') message = 'Compartí este código con tu rival:';
  else if (status.kind === 'joining') message = 'Uniéndose a la sala…';
  else if (status.kind === 'error') message = status.message;

  app.innerHTML = `
    ${header()}
    <div class="screen center online-waiting">
      ${status.kind === 'error' ? `<p class="online-error">${escapeHtml(message)}</p>` : `<div class="spinner"></div><p>${message}</p>`}
      ${status.kind === 'waitingCode' ? `<div class="room-code">${status.code}</div>` : ''}
      ${status.kind === 'error' ? '<button class="btn primary" id="retry-online">Reintentar</button>' : ''}
      <button class="btn" id="cancel-online">Cancelar</button>
    </div>`;
  document.getElementById('cancel-online').onclick = () => {
    Net.cancelQuickMatch();
    onlineIntent = null;
    onlineStatus = null;
    go('home');
  };
  const retryBtn = document.getElementById('retry-online');
  if (retryBtn) {
    retryBtn.onclick = () => {
      if (lastOnlineFaction) startOnlineMatch(lastOnlineFaction, lastOnlineAuto);
    };
  }
}

let lastOnlineFaction = null; // remembered so the connection-error retry button can replay the same attempt
let lastOnlineAuto = false;

async function startOnlineMatch(faction, auto = false) {
  lastOnlineFaction = faction;
  lastOnlineAuto = auto;
  // The client never drives its own turn when online — the server does
  // (see server/rooms.js's runAutoPlayTurns) — but the UI still needs this
  // to know to gray out the hand/hero controls instead of offering
  // interactions that would just get rejected as "not your turn" once the
  // server plays for you.
  p1AutoPlay = auto;
  const intent = onlineIntent;
  onlineStatus = { kind: 'connecting' };
  screen = 'onlineWaiting';
  render();

  try {
    await Net.connect();
  } catch {
    onlineStatus = { kind: 'error', message: 'No se pudo conectar con el servidor de partidas online. ¿Está corriendo?' };
    render();
    return;
  }

  const deck = auto ? save.autoDeck : save.deck;
  if (intent.mode === 'quick') {
    onlineStatus = { kind: 'queued' };
    Net.quickMatch(faction, deck, auto);
  } else if (intent.mode === 'create') {
    onlineStatus = { kind: 'creating' };
    Net.createRoom(faction, deck, auto);
  } else if (intent.mode === 'join') {
    onlineStatus = { kind: 'joining' };
    Net.joinRoom(intent.code, faction, deck, auto);
  }
  render();
}

// Guards against out-of-order account responses: two account-touching calls
// (e.g. the boot-time fetchAccount and a rename fired moments later) can
// resolve in the opposite order they were sent in, and without this a
// slower, older response arriving last would silently stomp a newer one —
// this is exactly how a freshly-typed onboarding username was getting
// reverted to the server's auto-generated one. Call nextAccountSyncSeq()
// right before firing the request, then pass that value back into
// syncAccountToSave() in the .then() — a response only applies if no newer
// request has been issued since.
let accountSyncSeq = 0;
function nextAccountSyncSeq() {
  return ++accountSyncSeq;
}

// Caches the parts of a server account we display without a live connection
// (topbar name chip, profile stats) into `save`, mirroring the existing
// save.trophies caching so they survive offline/first-paint before any
// network round trip resolves. `seq` is optional — omit it for callers (like
// the live WS 'identified' event) that should always win regardless of
// ordering.
function syncAccountToSave(account, seq) {
  if (!account) return;
  if (seq !== undefined && seq !== accountSyncSeq) return;
  save.username = account.username;
  save.wins = account.wins || 0;
  save.losses = account.losses || 0;
  save.googleLinked = Boolean(account.googleLinked);
  save.googleEmail = account.email || null;
  Ladder.syncTrophies(save, account.trophies);
  Stats.bumpStatMax(save, 'peakTrophies', save.trophies);
  persist();
}

function setupNetListeners() {
  Net.on('identified', (msg) => {
    syncAccountToSave(msg.account);
    if (screen === 'profile') render();
  });
  Net.on('roomCreated', (msg) => {
    onlineStatus = { kind: 'waitingCode', code: msg.code };
    render();
  });
  Net.on('queued', () => {
    onlineStatus = { kind: 'queued' };
    render();
  });
  Net.on('matchStart', (msg) => {
    battle = msg.state;
    onlineRoom = { code: msg.code };
    opponentName = msg.opponentName || null;
    matchDeadline = msg.matchDeadline || null;
    onlineIntent = null;
    onlineStatus = null;
    prevOccupancy = new Set();
    selectedAttacker = null;
    pendingPlacement = null;
    pendingTarget = null;
    pendingReplace = null;
    battleMenuOpen = false;
    forfeitConfirmOpen = false;
    endTurnConfirmOpen = false;
    openPile = null;
    screen = 'battle';
    render();
  });
  Net.on('step', (msg) => {
    if (!onlineRoom) return;
    if (msg.step && msg.step.side === 'p2') animateOpponentStep(msg.step);
    battle = msg.state;
    render();
  });
  Net.on('matchEnd', (msg) => {
    if (!onlineRoom) return;
    pendingTrophyResult = { trophies: msg.trophies, delta: msg.trophyDelta };
    battle = msg.state;
    render(); // renderBattle() finds battle.winner set and routes into endMatch()
  });
  Net.on('opponentDisconnected', (msg) => {
    if (!onlineRoom) return;
    const secs = Math.round((msg.graceMs || 30000) / 1000);
    showAiToast(`Tu rival se desconectó. Si no vuelve en ${secs}s, ganás la partida.`);
  });
  Net.on('opponentReconnected', () => {
    if (!onlineRoom) return;
    showAiToast('Tu rival volvió a conectarse.');
  });
  Net.on('error', (msg) => {
    if (screen === 'onlineWaiting') {
      onlineStatus = { kind: 'error', message: msg.message };
      render();
    } else {
      showAiToast(msg.message);
    }
  });

  Net.on('draftQueued', (msg) => {
    draftQueueStatus = { waiting: msg.waiting, needed: msg.needed };
    if (screen === 'draftWaiting') render();
  });
  Net.on('draftUpdate', (msg) => {
    draftPack = msg.pack;
    draftPickCount = msg.pickCount;
    draftPickDeadline = Date.now() + Draft.PICK_TIMER_MS;
    screen = 'draftPick';
    render();
  });
  Net.on('draftPickConfirmed', (msg) => {
    Store.addCardsToCollection(save, [msg.card]);
    draftPicksSoFar.push(msg.card);
    persist();
  });
  Net.on('draftBonusCard', (msg) => {
    lastPackReveal = [msg.card];
    revealReturnScreen = 'draftHeroPick';
    Store.addCardsToCollection(save, [msg.card]);
    draftPicksSoFar.push(msg.card);
    persist();
    draftPack = null;
    screen = 'reveal';
    render();
  });
  Net.on('draftPrize', (msg) => {
    Stats.bumpStat(save, 'draftsPlayed', 1);
    if (msg.prize?.packs?.includes('gem_pack')) Stats.bumpStat(save, 'draftsWon', 1);
    bracketPrizeReveal(msg.prize);
  });
  Net.on('draftBracketUpdate', (msg) => onBracketUpdate('draft', msg));

  Net.on('tournamentQueued', (msg) => {
    tournamentQueueStatus = { waiting: msg.waiting, needed: msg.needed };
    if (screen === 'tournamentWaiting') render();
  });
  Net.on('tournamentPrize', (msg) => {
    Stats.bumpStat(save, 'tournamentsPlayed', 1);
    if (msg.prize?.packs?.includes('gem_pack')) Stats.bumpStat(save, 'tournamentsWon', 1);
    bracketPrizeReveal(msg.prize, 'tournament');
  });
  Net.on('tournamentBracketUpdate', (msg) => onBracketUpdate('tournament', msg));
}

function onBracketUpdate(kind, msg) {
  if (bracketFinishedForMe) return;
  bracketStatus = {
    kind,
    seats: msg.seats,
    semis: msg.semis,
    final: msg.final,
    startedAt: bracketStatus?.startedAt || Date.now(),
  };
  refreshBracketFab();
}

// ---------------- Battle screen ----------------

function forEachOccupied(state, side, fn) {
  state[side].battlefield.forEach((lane, laneIndex) => {
    if (lane.front) fn(laneIndex, 'front');
    if (lane.back) fn(laneIndex, 'back');
  });
}

function computeHighlights(state) {
  const set = new Set();
  const moveSet = new Set();
  const replaceSet = new Set();
  let face = null;

  if (selectedAttacker) {
    const creature = state.p1.battlefield[selectedAttacker.laneIndex][selectedAttacker.row];
    if (creature) {
      const card = getCard(creature.cardId);
      const options = getValidAttackTargets(state, 'p1', selectedAttacker.laneIndex, card.placement);
      for (const o of options) {
        if (o.type === 'face') face = 'p2';
        else set.add(`p2:${selectedAttacker.laneIndex}:${o.row}`);
      }
      const moveOptions = getValidMoveTargets(state, 'p1', selectedAttacker.laneIndex, selectedAttacker.row, card.placement);
      for (const m of moveOptions) moveSet.add(`p1:${m.laneIndex}:${m.row}`);
    }
  } else if (pendingTarget) {
    const card = pendingTarget.card;
    if (card.target === 'ally_creature') {
      forEachOccupied(state, 'p1', (lane, row) => set.add(`p1:${lane}:${row}`));
    } else if (card.target === 'enemy_creature') {
      forEachOccupied(state, 'p2', (lane, row) => set.add(`p2:${lane}:${row}`));
    } else if (card.target === 'enemy_any') {
      forEachOccupied(state, 'p2', (lane, row) => set.add(`p2:${lane}:${row}`));
      face = 'p2';
    }
  } else if (pendingPlacement) {
    const card = pendingPlacement.card;
    const rows = card.placement === 'melee' ? ['front'] : card.placement === 'shooter' ? ['back'] : ['front', 'back'];
    for (let lane = 0; lane < 4; lane++) {
      for (const row of rows) {
        if (!state.p1.battlefield[lane][row]) set.add(`p1:${lane}:${row}`);
        // A row-legal own slot that's already occupied isn't a normal deploy
        // target, but it IS a valid sacrifice-and-replace target — see
        // onSlotClick's pendingPlacement branch and pendingReplace.
        else replaceSet.add(`p1:${lane}:${row}`);
      }
    }
  }
  return { set, moveSet, replaceSet, face };
}

function slotHtml(state, side, laneIndex, row, highlights) {
  const creature = state[side].battlefield[laneIndex][row];
  const key = `${side}:${laneIndex}:${row}`;
  const isHighlighted = highlights.set.has(key);
  const isMoveTarget = highlights.moveSet.has(key);
  const isReplaceTarget = highlights.replaceSet.has(key);

  if (!creature) {
    return `<div class="lane-slot empty ${isHighlighted ? 'legal-target' : ''} ${isMoveTarget ? 'legal-move-target' : ''}" data-side="${side}" data-lane="${laneIndex}" data-row="${row}"></div>`;
  }

  const card = getCard(creature.cardId);
  const occKey = `${side}:${laneIndex}:${row}:${creature.instanceId}`;
  const isNew = !prevOccupancy.has(occKey);
  const isSelected = side === 'p1' && selectedAttacker && selectedAttacker.laneIndex === laneIndex && selectedAttacker.row === row;
  const canAttackNow = side === 'p1' && creature.canAttack && !pendingPlacement && !pendingTarget && state.active === 'p1' && !p1AutoPlay;

  const atk = effectiveAtk(state, side, creature);
  const ret = effectiveRetaliate(state, side, creature);
  const life = effectiveLife(state, side, creature);
  const maxLife = effectiveMaxLife(state, side, creature);
  const atkClass = statBoostClass(atk, card.atk);
  const retClass = statBoostClass(ret, card.retaliate);
  // Life is compared against the current ceiling, not the raw number shown —
  // otherwise a creature that's simply taken damage (completely normal)
  // would get flagged the same as one actually debuffed by an aura.
  const lifeClass = statBoostClass(maxLife, card.life);

  const tooltipLines = [
    `${card.name} — ${FACTIONS[card.faction].name}`,
    `Tipo: Criatura (${placementLabel(card.placement, card.building)})`,
    `Ataque ${atk} · Contraataque ${ret} · Vida ${life}`,
  ];
  if (atkClass || retClass || lifeClass) {
    tooltipLines.push(`(Base: Ataque ${card.atk} · Contraataque ${card.retaliate} · Vida ${card.life})`);
  }
  if (card.text) tooltipLines.push(card.text);

  // When this creature is selected and its only attack option is the enemy
  // hero (its lane is clear), offer a tap target right on top of it instead
  // of making the player reach across the board to the hero-face icon.
  const showFaceAttackIcon = isSelected && highlights.face === 'p2';

  return `
    <div class="lane-slot occupied ${isHighlighted ? 'legal-target' : ''} ${isReplaceTarget ? 'legal-replace-target' : ''}" data-side="${side}" data-lane="${laneIndex}" data-row="${row}">
      <div class="board-card rarity-${card.rarity} ${canAttackNow ? 'can-attack' : ''} ${isSelected ? 'selected' : ''} ${isNew ? 'card-enter' : ''}" style="--rarity-color:${RARITY_COLORS[card.rarity]}" data-tooltip="${escapeAttr(tooltipLines.join('\n'))}">
        <div class="card-art small">${cardArtSVG(card)}</div>
        <div class="card-stats"><span class="atk ${atkClass}">${atk}</span><span class="ret ${retClass}">${ret}</span><span class="life ${lifeClass}">${life}</span></div>
      </div>
      ${showFaceAttackIcon ? '<button class="face-attack-icon" data-tooltip="Atacar directo al héroe rival">⚔️</button>' : ''}
      ${isReplaceTarget ? '<div class="replace-target-badge" data-tooltip="Sacrificar esta criatura para desplegar la que tenés en la mano">🔄</div>' : ''}
    </div>`;
}

function statBoostClass(effective, base) {
  if (effective > base) return 'stat-buffed';
  if (effective < base) return 'stat-nerfed';
  return '';
}

function battlefieldHtml(state, highlights) {
  const rows = [
    { side: 'p2', row: 'back' },
    { side: 'p2', row: 'front' },
    { side: 'p1', row: 'front' },
    { side: 'p1', row: 'back' },
  ];
  return `<div class="lanes-grid">${rows
    .map(({ side, row }) => `<div class="lane-row">${[0, 1, 2, 3].map((lane) => slotHtml(state, side, lane, row, highlights)).join('')}</div>`)
    .join('')}</div>`;
}

function pileTooltip(label, ids) {
  if (!ids.length) return `${label}\nVacío`;
  return `${label} (${ids.length})\nTocá para ver las cartas`;
}

function pileHtml(kind, icon, label, ids, side) {
  return `
    <div class="pile ${kind}" data-side="${side}" data-kind="${kind}" data-tooltip="${escapeAttr(pileTooltip(label, ids))}">
      <span class="pile-icon">${icon}</span>
      <span class="pile-count">${ids.length}</span>
    </div>`;
}

// A player can have more than one faction perk active at once now that
// decks aren't mono-faction (see store.js) — this renders one pill per
// faction that has at least one creature of it on the field, ordered by
// count so the closest-to-active (or already active) ones lead.
function perkIndicatorsHtml(state, side) {
  const threshold = state.perkThreshold || 4;
  const counts = countFieldCreaturesByFaction(state[side]);
  const entries = Object.values(FACTION_PERKS)
    .filter((perk) => (counts[perk.id] || 0) > 0)
    .sort((a, b) => (counts[b.id] || 0) - (counts[a.id] || 0));
  if (!entries.length) return '<div class="perk-indicator-row"></div>';
  const pills = entries
    .map((perk) => {
      const count = counts[perk.id] || 0;
      const active = count >= threshold;
      const status = active ? 'Activo ahora.' : `Inactivo — tenés ${count}/${threshold} criaturas de esta facción en el campo.`;
      const tooltip = `${perk.name}\n${perk.text}\n${status}`;
      return `
        <div class="perk-indicator ${active ? 'active' : ''}" data-tooltip="${escapeAttr(tooltip)}">
          <span class="perk-indicator-icon">${perk.icon}</span>
          <span class="perk-indicator-count">${count}/${threshold}</span>
        </div>`;
    })
    .join('');
  return `<div class="perk-indicator-row">${pills}</div>`;
}

function perksSidebarHtml(state) {
  return `
    <div class="perks-sidebar">
      ${perkIndicatorsHtml(state, 'p2')}
      ${perkIndicatorsHtml(state, 'p1')}
    </div>`;
}

function pilesHtml(state) {
  return `
    <div class="piles-sidebar">
      <div class="pile-group">
        ${pileHtml('dead-zone', '💀', 'Cementerio', state.p2.discard, 'p2')}
        ${pileHtml('exile-zone', '🌀', 'Exilio', state.p2.exile, 'p2')}
      </div>
      <div class="pile-group">
        ${pileHtml('dead-zone', '💀', 'Cementerio', state.p1.discard, 'p1')}
        ${pileHtml('exile-zone', '🌀', 'Exilio', state.p1.exile, 'p1')}
      </div>
    </div>`;
}

function pileModalHtml(state) {
  if (!openPile) return '';
  const { side, kind } = openPile;
  const ids = kind === 'dead-zone' ? state[side].discard : state[side].exile;
  const label = kind === 'dead-zone' ? 'Cementerio' : 'Exilio';
  const sideLabel = side === 'p1' ? 'tuyo' : 'del rival';
  return `
    <div class="modal-overlay" id="pile-modal-overlay">
      <div class="modal-box pile-modal">
        <div class="pile-modal-header">
          <h3>${label} (${sideLabel}) · ${ids.length}</h3>
          <button class="btn icon" id="pile-modal-close">✕</button>
        </div>
        ${
          ids.length
            ? `<div class="card-grid pile-modal-grid">${ids.map((id) => cardVisual(getCard(id))).join('')}</div>`
            : `<p>Vacío por ahora.</p>`
        }
      </div>
    </div>`;
}

const ATTR_ICONS = { might: '⚔️', magic: '🔮', destiny: '🎲' };

function attrFullLabel(attr) {
  return attr === 'might' ? 'Fuerza' : attr === 'magic' ? 'Magia' : 'Destino';
}

function heroPanelHtml(state, side, highlights) {
  const p = state[side];
  const hero = getHero(p.heroId);
  const isEnemy = side === 'p2';
  const faceHighlight = highlights.face === side ? 'legal-target' : '';
  const busy = pendingPlacement || pendingTarget;

  const heroActionAvailable = state.active === 'p1' && !p.heroActionUsed && !busy && !p1AutoPlay;
  const attrRow = !isEnemy
    ? ['might', 'magic', 'destiny']
        .map((attr) => {
          return `<span class="tip-wrap" data-tooltip="Aumenta ${attrFullLabel(attr)} en 1"><button class="attr-pip ${heroActionAvailable ? 'action-available' : ''}" data-attr="${attr}" ${heroActionAvailable ? '' : 'disabled'}>${ATTR_ICONS[attr]} ${p[attr]}</button></span>`;
        })
        .join('') +
      `<span class="tip-wrap" data-tooltip="${escapeAttr(hero.special.text)}"><button class="btn special-btn ${heroActionAvailable ? 'action-available' : ''}" id="hero-special" ${heroActionAvailable ? '' : 'disabled'}>⭐</button></span>`
    : ['might', 'magic', 'destiny']
        .map((attr) => `<span class="attr-pip readonly" data-tooltip="${attrFullLabel(attr)}: ${p[attr]}">${ATTR_ICONS[attr]} ${p[attr]}</span>`)
        .join('');

  return `
    <div class="hero-panel ${isEnemy ? 'enemy' : 'player'}">
      ${isEnemy && opponentName ? `<div class="opponent-name-badge">${escapeHtml(opponentName)}</div>` : ''}
      <div class="hero-face ${faceHighlight}" data-side="${side}">
        <div class="hp-badge" data-tooltip="Puntos de vida">❤️ ${p.hp}</div>
        <div class="resource-badge" data-tooltip="Recursos disponibles este turno">🔷 ${p.resource}/${p.resourceMax}</div>
        <div class="deck-count" data-tooltip="Cartas restantes en el mazo">🂠 ${p.deck.length}</div>
        <div class="deck-count" data-tooltip="Cartas en la mano">✋ ${p.hand.length}</div>
      </div>
      <div class="attr-row">${attrRow}</div>
    </div>`;
}

function handHtml(state) {
  const isPlayerTurn = state.active === 'p1';
  return state.p1.hand
    .map((cardId, idx) => {
      const card = getCard(cardId);
      const attrValue = card.type === 'creature' ? state.p1.might : card.type === 'spell' ? state.p1.magic : state.p1.destiny;
      const isChosen = (pendingPlacement && pendingPlacement.idx === idx) || (pendingTarget && pendingTarget.idx === idx);
      const playable = isPlayerTurn && !p1AutoPlay && card.cost <= state.p1.resource && attrValue >= card.requirement && (!pendingPlacement && !pendingTarget || isChosen);
      return `<div class="hand-card ${playable ? 'playable' : 'unplayable'} ${isChosen ? 'chosen' : ''}" data-idx="${idx}">${cardVisual(card)}</div>`;
    })
    .join('');
}

function turnLabel(state) {
  if (p1AutoPlay) return state.active === 'p1' ? '🤖 Jugando tu turno…' : 'Turno rival…';
  if (pendingPlacement) return 'Elegí una casilla';
  if (pendingTarget) return 'Elegí un objetivo';
  if (selectedAttacker) return 'Atacá o movete a otra casilla';
  return state.active === 'p1' ? 'Tu turno' : 'Turno rival…';
}

function updateOccupancy(state) {
  const next = new Set();
  for (const side of ['p1', 'p2']) {
    state[side].battlefield.forEach((lane, laneIndex) => {
      for (const row of ['front', 'back']) {
        const c = lane[row];
        if (c) next.add(`${side}:${laneIndex}:${row}:${c.instanceId}`);
      }
    });
  }
  prevOccupancy = next;
}

function countReadyCreatures(player) {
  let count = 0;
  for (const lane of player.battlefield) {
    if (lane.front && lane.front.canAttack) count++;
    if (lane.back && lane.back.canAttack) count++;
  }
  return count;
}

function battleMenuHtml() {
  return `
    <div class="battle-menu-wrap">
      <button class="battle-menu-btn" id="battle-menu-btn">☰</button>
      ${
        battleMenuOpen
          ? `<div class="battle-menu-dropdown">
               ${onlineRoom ? `<div class="battle-menu-online-badge">🌐 Partida online · Sala ${onlineRoom.code}</div>` : ''}
               <button class="battle-menu-item" id="battle-sound-toggle">${isSoundEnabled() ? '🔊 Sonido: activado' : '🔇 Sonido: apagado'}</button>
               <button class="battle-menu-item" id="battle-haptics-toggle">${isHapticsEnabled() ? '📳 Vibración: activada' : '📴 Vibración: apagada'}</button>
               <button class="battle-menu-item danger" id="forfeit-btn">🏳️ Abandonar partida</button>
               <button class="battle-menu-item" id="close-menu-btn">✕ Cerrar</button>
             </div>`
          : ''
      }
    </div>
    ${
      forfeitConfirmOpen
        ? `<div class="modal-overlay" id="forfeit-overlay">
             <div class="modal-box">
               <p>¿Seguro que querés abandonar la partida?<br>Se cuenta como derrota.</p>
               <div class="modal-actions">
                 <button class="btn" id="forfeit-cancel">Cancelar</button>
                 <button class="btn danger" id="forfeit-confirm">Abandonar</button>
               </div>
             </div>
           </div>`
        : ''
    }
    ${
      endTurnConfirmOpen
        ? `<div class="modal-overlay" id="end-turn-overlay">
             <div class="modal-box">
               <p>Che, ${endTurnWarningText()}. ¿Termino el turno igual?</p>
               <div class="modal-actions">
                 <button class="btn" id="end-turn-cancel">Cancelar</button>
                 <button class="btn primary" id="end-turn-confirm">Terminar turno</button>
               </div>
             </div>
           </div>`
        : ''
    }
    ${
      pendingReplace
        ? `<div class="modal-overlay" id="replace-overlay">
             <div class="modal-box">
               <p>¿Sacrificar a <strong>${escapeHtml(pendingReplace.oldCard.name)}</strong> para desplegar a <strong>${escapeHtml(pendingReplace.card.name)}</strong> en su lugar?<br>Se pierde para siempre — va directo al cementerio.</p>
               <div class="modal-actions">
                 <button class="btn" id="replace-cancel">Cancelar</button>
                 <button class="btn danger" id="replace-confirm">Reemplazar</button>
               </div>
             </div>
           </div>`
        : ''
    }`;
}

function endTurnWarningText() {
  const parts = [];
  if (!battle.p1.heroActionUsed) parts.push('no usaste tu acción de héroe (subir un atributo o tu especial)');
  const readyCreatures = countReadyCreatures(battle.p1);
  if (readyCreatures > 0) parts.push(`tenés ${readyCreatures} criatura${readyCreatures > 1 ? 's' : ''} que todavía puede${readyCreatures > 1 ? 'n' : ''} actuar`);
  return parts.join(' y ');
}

function tutorialCoachStepInfo(state) {
  if (!tutorialCoachActive || !tutorialProgress) return null;

  // Latch each milestone the first time it's true — heroActionUsed and an
  // empty battlefield are both things that legitimately recur every turn as
  // normal play (heroActionUsed resets each turn, a board can empty out),
  // so re-checking the raw field on turn 2+ would wrongly send the player
  // back to a lesson they already completed on turn 1.
  if (!tutorialProgress.heroAction && state.p1.heroActionUsed) tutorialProgress.heroAction = true;
  if (!tutorialProgress.deployed && state.p1.battlefield.some((lane) => lane.front || lane.back)) tutorialProgress.deployed = true;
  if (!tutorialProgress.endedTurn && state.turn > 1) tutorialProgress.endedTurn = true;

  // Hero action first: every starter card needs at least level 1 in its
  // attribute (Fuerza/Magia/Destino), and that attribute starts at 0 —
  // nothing in hand is legal to deploy until it's leveled up once.
  if (!tutorialProgress.heroAction) {
    return { text: '👉 Empezá por tu acción de héroe: subí un atributo (Fuerza, Magia o Destino) o usá tu especial — lo necesitás para poder jugar tus cartas.' };
  }
  if (!tutorialProgress.deployed) {
    return { text: '👉 Ahora arrastrá una carta de criatura de tu mano a una casilla libre del campo para desplegarla.' };
  }
  // Check whose turn it is before endedTurn: state.turn only increments once
  // play returns to p1 (see battle.js endTurn), so right after the player
  // taps ⏭️ it's still turn 1 with active==='p2' — must show the AI-is-
  // playing message then, not loop back to "end your turn".
  if (state.active === 'p2') {
    return { text: '🤖 La IA está jugando su turno — mirá cómo responde.' };
  }
  if (!tutorialProgress.endedTurn) {
    return { text: '👉 Perfecto. Ahora terminá tu turno tocando el botón ⏭️.' };
  }
  if (!tutorialProgress.attacked) {
    return { text: '👉 Es tu turno otra vez. Tocá tu criatura lista y elegí un objetivo para atacar.' };
  }
  return { text: '✅ ¡Ya sabés lo básico! Seguí jugando para ganar la partida.', final: true };
}

function formatMatchClock(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `⏱ ${m}:${String(s).padStart(2, '0')}`;
}

// Online matches only (matchDeadline is null for the offline guided
// tutorial) — ticks the turn-indicator's countdown once a second without a
// full render, same self-clearing-when-the-element-is-gone pattern as
// armDraftTimerDisplay. The server is the sole authority on when time is
// actually up (see rooms.js's armMatchTimer); this is display-only.
function armMatchTimerDisplay() {
  clearInterval(matchTimerIntervalId);
  matchTimerIntervalId = null;
  if (!matchDeadline) return;
  const tick = () => {
    const el = document.getElementById('battle-match-timer');
    if (!el || !matchDeadline) {
      clearInterval(matchTimerIntervalId);
      matchTimerIntervalId = null;
      return;
    }
    const remainingMs = matchDeadline - Date.now();
    el.textContent = formatMatchClock(remainingMs);
    el.classList.toggle('urgent', remainingMs <= 30000);
  };
  tick();
  matchTimerIntervalId = setInterval(tick, 1000);
}

function renderBattle() {
  if (battle.winner) {
    endMatch(battle.winner);
    return;
  }
  const state = battle;
  const isPlayerTurn = state.active === 'p1';
  const highlights = computeHighlights(state);
  const hasUnusedActions = isPlayerTurn && !p1AutoPlay && (!state.p1.heroActionUsed || countReadyCreatures(state.p1) > 0);
  const coachStep = tutorialCoachStepInfo(state);

  app.innerHTML = `
    <div class="battle">
      ${battleMenuHtml()}
      ${heroPanelHtml(state, 'p2', highlights)}
      <div class="battlefield-row">
        ${pilesHtml(state)}
        ${battlefieldHtml(state, highlights)}
        ${perksSidebarHtml(state)}
        <button class="btn end-turn ${hasUnusedActions ? 'has-warning' : ''}" id="end-turn" data-tooltip="Fin de turno" ${isPlayerTurn && !pendingPlacement && !pendingTarget && !p1AutoPlay ? '' : 'disabled'}>
          ⏭️${hasUnusedActions ? '<span class="end-turn-warning-dot"></span>' : ''}
        </button>
      </div>
      <div class="turn-indicator ${coachStep ? 'coach-active' : ''}">
        ${
          coachStep
            ? `<div class="tutorial-coach-banner">
                <span>${coachStep.text}</span>
                ${coachStep.final ? '<button class="btn small primary" id="tutorial-coach-done">Entendido</button>' : ''}
              </div>`
            : `${turnLabel(state)} · Turno ${state.turn}${matchDeadline ? `<span class="battle-match-timer" id="battle-match-timer" data-tooltip="Si el tiempo se agota, gana quien tenga más vida"></span>` : ''}`
        }
      </div>
      ${heroPanelHtml(state, 'p1', highlights)}
      <div class="hand">${handHtml(state)}</div>
      ${pileModalHtml(state)}
    </div>`;

  updateOccupancy(state);
  armMatchTimerDisplay();

  const endBtn = document.getElementById('end-turn');
  if (endBtn) endBtn.onclick = onEndTurn;
  const coachDoneBtn = document.getElementById('tutorial-coach-done');
  if (coachDoneBtn) {
    coachDoneBtn.onclick = () => {
      tutorialCoachActive = false;
      save.guidedTutorialDone = true;
      persist();
      renderBattle();
    };
  }

  const menuBtn = document.getElementById('battle-menu-btn');
  if (menuBtn) menuBtn.onclick = () => { battleMenuOpen = !battleMenuOpen; render(); };
  const closeMenuBtn = document.getElementById('close-menu-btn');
  if (closeMenuBtn) closeMenuBtn.onclick = () => { battleMenuOpen = false; render(); };
  const battleSoundBtn = document.getElementById('battle-sound-toggle');
  if (battleSoundBtn) battleSoundBtn.onclick = () => { toggleSound(); render(); };
  const battleHapticsBtn = document.getElementById('battle-haptics-toggle');
  if (battleHapticsBtn) battleHapticsBtn.onclick = () => { toggleHaptics(); render(); };
  const forfeitBtn = document.getElementById('forfeit-btn');
  if (forfeitBtn) forfeitBtn.onclick = () => { battleMenuOpen = false; forfeitConfirmOpen = true; render(); };
  const forfeitCancelBtn = document.getElementById('forfeit-cancel');
  if (forfeitCancelBtn) forfeitCancelBtn.onclick = () => { forfeitConfirmOpen = false; render(); };
  const forfeitConfirmBtn = document.getElementById('forfeit-confirm');
  if (forfeitConfirmBtn) forfeitConfirmBtn.onclick = onForfeit;
  const endTurnCancelBtn = document.getElementById('end-turn-cancel');
  if (endTurnCancelBtn) endTurnCancelBtn.onclick = () => { endTurnConfirmOpen = false; render(); };
  const endTurnConfirmBtn = document.getElementById('end-turn-confirm');
  if (endTurnConfirmBtn) endTurnConfirmBtn.onclick = doEndTurn;
  const replaceCancelBtn = document.getElementById('replace-cancel');
  if (replaceCancelBtn) replaceCancelBtn.onclick = cancelReplace;
  const replaceConfirmBtn = document.getElementById('replace-confirm');
  if (replaceConfirmBtn) replaceConfirmBtn.onclick = confirmReplace;

  app.querySelectorAll('.pile').forEach((el) => {
    el.onclick = () => { openPile = { side: el.dataset.side, kind: el.dataset.kind }; render(); };
  });
  const pileModalClose = document.getElementById('pile-modal-close');
  if (pileModalClose) pileModalClose.onclick = () => { openPile = null; render(); };
  const pileModalOverlay = document.getElementById('pile-modal-overlay');
  if (pileModalOverlay) {
    pileModalOverlay.onclick = (e) => {
      if (e.target === pileModalOverlay) { openPile = null; render(); }
    };
  }

  app.querySelectorAll('.hand-card').forEach((el) => {
    const idx = Number(el.dataset.idx);
    el.onclick = () => onHandCardClick(idx);
    wireHandCardDrag(el, idx);
  });
  app.querySelectorAll('.lane-slot').forEach((el) => {
    el.onclick = () => onSlotClick(el.dataset.side, Number(el.dataset.lane), el.dataset.row, el);
    if (el.dataset.side === 'p1' && el.classList.contains('occupied')) {
      wireBoardCreatureDrag(el, Number(el.dataset.lane), el.dataset.row);
    }
  });
  app.querySelectorAll('.hero-face').forEach((el) => {
    el.onclick = () => onFaceClick(el.dataset.side, el);
  });
  app.querySelectorAll('.face-attack-icon').forEach((el) => {
    el.onclick = (e) => {
      e.stopPropagation();
      if (battle.active !== 'p1' || battle.winner || !selectedAttacker || p1AutoPlay) return;
      const attackerCreature = battle.p1.battlefield[selectedAttacker.laneIndex][selectedAttacker.row];
      if (!attackerCreature) return;
      const card = getCard(attackerCreature.cardId);
      const options = getValidAttackTargets(battle, 'p1', selectedAttacker.laneIndex, card.placement);
      if (options.some((o) => o.type === 'face')) resolveAttack(selectedAttacker, { type: 'face' });
    };
  });
  app.querySelectorAll('.attr-pip[data-attr]').forEach((el) => {
    el.onclick = () => onLevelUp(el.dataset.attr);
  });
  const specialBtn = document.getElementById('hero-special');
  if (specialBtn) specialBtn.onclick = onUseSpecial;
}

function isPositiveEffect(effect) {
  return effect.startsWith('buff_') || effect.startsWith('heal_');
}

function spellFloatingText(card) {
  if (card.effect === 'destroy_creature') return '💀';
  if (isPositiveEffect(card.effect)) return `+${card.value}`;
  return `-${card.value}`;
}

function showToast(message) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = message;
  document.body.appendChild(el);
  requestAnimationFrame(() => el.classList.add('visible'));
  setTimeout(() => {
    el.classList.remove('visible');
    setTimeout(() => el.remove(), 250);
  }, 2200);
}

function spawnFloatingNumber(anchorEl, text, isHeal) {
  if (!anchorEl) return;
  const rect = anchorEl.getBoundingClientRect();
  const el = document.createElement('div');
  el.className = 'floating-number ' + (isHeal ? 'heal' : 'damage');
  el.textContent = text;
  el.style.left = rect.left + rect.width / 2 + 'px';
  el.style.top = rect.top + 'px';
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 900);
}

function effectIsHeal(effectId) {
  return effectId.startsWith('heal_');
}

function effectDisplay(effectId) {
  const match = effectId.match(/_(\d+)$/);
  const amount = match ? match[1] : '';
  return `${effectIsHeal(effectId) ? '+' : '-'}${amount}`;
}

function isLegalPlacementSlot(card, laneIndex, row) {
  const legalRows = card.placement === 'melee' ? ['front'] : card.placement === 'shooter' ? ['back'] : ['front', 'back'];
  return legalRows.includes(row) && !battle.p1.battlefield[laneIndex][row];
}

function isLegalSpellTarget(card, side) {
  if (card.target === 'ally_creature') return side === 'p1';
  if (card.target === 'enemy_creature') return side === 'p2';
  if (card.target === 'enemy_any') return side === 'p2';
  return false;
}

function onHandCardClick(idx) {
  if (suppressClick) {
    suppressClick = false;
    return;
  }
  if (battle.active !== 'p1' || battle.winner || p1AutoPlay) return;
  if (pendingPlacement && pendingPlacement.idx === idx) {
    pendingPlacement = null;
    render();
    return;
  }
  if (pendingTarget && pendingTarget.idx === idx) {
    pendingTarget = null;
    render();
    return;
  }
  if (pendingPlacement || pendingTarget) return;

  const cardId = battle.p1.hand[idx];
  const card = getCard(cardId);
  const attrValue = card.type === 'creature' ? battle.p1.might : card.type === 'spell' ? battle.p1.magic : battle.p1.destiny;
  if (card.cost > battle.p1.resource || attrValue < card.requirement) return;

  if (card.type === 'creature') {
    pendingPlacement = { idx, card };
    selectedAttacker = null;
    render();
    return;
  }

  if (card.target === 'none') {
    if (isOnline()) Net.sendAction({ kind: 'spell', handIdx: idx, target: undefined });
    else playSpellOrFortune(battle, 'p1', idx, undefined);
    sfx.cast();
    vibrate(10);
    render();
  } else if (card.target === 'enemy_hero') {
    const heroEl = document.querySelector('.hero-panel.enemy .hero-face');
    spawnFloatingNumber(heroEl, `-${card.value}`, false);
    if (isOnline()) Net.sendAction({ kind: 'spell', handIdx: idx, target: undefined });
    else playSpellOrFortune(battle, 'p1', idx, undefined);
    sfx.cast();
    vibrate(10);
    render();
  } else {
    pendingTarget = { idx, card };
    selectedAttacker = null;
    render();
  }
}

const DRAG_THRESHOLD = 10;

// A drag starting on a hand card is ambiguous until it moves: mostly
// vertical means "play this card" (the original gesture), mostly
// horizontal means "scroll the hand" (so a wide hand can be swiped through
// without needing to land precisely on the thin scrollbar). The direction
// is decided once, the first time the movement clears DRAG_THRESHOLD, and
// the card stays put with .hand-card { touch-action: none } so the browser
// never takes the gesture over mid-drag and leaves this handler hanging.
function wireHandCardDrag(el, idx) {
  el.addEventListener('pointerdown', (e) => {
    const cardId = battle.p1.hand[idx];
    const card = getCard(cardId);
    const canPlay =
      battle.active === 'p1' &&
      !battle.winner &&
      !pendingPlacement &&
      !pendingTarget &&
      !p1AutoPlay &&
      card.type === 'creature' &&
      card.cost <= battle.p1.resource &&
      battle.p1.might >= card.requirement;

    const handEl = el.closest('.hand');
    const startX = e.clientX;
    const startY = e.clientY;
    let lastX = e.clientX;
    let mode = null; // null (undecided) | 'scroll' | 'play' | 'none'
    let ghost = null;
    let hoverSlot = null;

    const onMove = (ev) => {
      const dx = ev.clientX - startX;
      const dy = ev.clientY - startY;
      if (!mode) {
        if (Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
        if (Math.abs(dx) > Math.abs(dy)) {
          mode = 'scroll';
        } else if (canPlay) {
          mode = 'play';
          pendingPlacement = { idx, card };
          render();
          ghost = document.createElement('div');
          ghost.className = 'drag-ghost';
          ghost.innerHTML = cardArtSVG(card);
          document.body.appendChild(ghost);
        } else {
          mode = 'none';
        }
      }
      if (mode === 'scroll') {
        if (handEl) handEl.scrollLeft -= ev.clientX - lastX;
        lastX = ev.clientX;
        return;
      }
      if (mode !== 'play') return;
      ghost.style.left = `${ev.clientX}px`;
      ghost.style.top = `${ev.clientY}px`;
      const under = document.elementFromPoint(ev.clientX, ev.clientY);
      const slot = under && under.closest('.lane-slot.legal-target, .lane-slot.legal-replace-target');
      if (hoverSlot && hoverSlot !== slot) hoverSlot.classList.remove('drag-hover');
      if (slot) slot.classList.add('drag-hover');
      hoverSlot = slot;
    };

    const cleanup = () => {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      document.removeEventListener('pointercancel', onCancel);
    };

    const onUp = () => {
      cleanup();
      if (mode === 'scroll') {
        suppressClick = true;
        return;
      }
      if (mode !== 'play') return;
      if (ghost) ghost.remove();
      if (hoverSlot) {
        hoverSlot.classList.remove('drag-hover');
        const lane = Number(hoverSlot.dataset.lane);
        const row = hoverSlot.dataset.row;
        if (hoverSlot.classList.contains('legal-replace-target')) {
          // Destructive — dropping onto an occupied slot opens the same
          // confirm modal the tap flow uses instead of resolving right away.
          const occupant = battle.p1.battlefield[lane][row];
          pendingPlacement = null;
          pendingReplace = { idx, card, laneIndex: lane, row, oldCard: getCard(occupant.cardId) };
        } else {
          pendingPlacement = null;
          if (isOnline()) Net.sendAction({ kind: 'deploy', handIdx: idx, laneIndex: lane, row });
          else playCreature(battle, 'p1', idx, lane, row);
          sfx.deploy();
          vibrate(10);
        }
      } else {
        pendingPlacement = null;
      }
      suppressClick = true;
      render();
    };

    const onCancel = () => {
      cleanup();
      if (ghost) ghost.remove();
      if (hoverSlot) hoverSlot.classList.remove('drag-hover');
      if (mode === 'play') pendingPlacement = null;
      render();
    };

    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
    document.addEventListener('pointercancel', onCancel);
  });
}

// Dragging a ready creature onto an enemy target attacks it (creature or
// face); dragging it onto an empty own-side slot repositions it instead —
// one gesture covers both actions, replacing the old tap-then-tap flow.
function wireBoardCreatureDrag(el, laneIndex, row) {
  el.addEventListener('pointerdown', (e) => {
    // A tap on the face-attack icon is its own click interaction, not a
    // drag start — letting this handler grab it too means its pointerup
    // unconditionally clears selectedAttacker (see onUp below) before the
    // icon's own click handler ever runs, so the tap silently does nothing.
    if (e.target.closest('.face-attack-icon')) return;
    if (battle.active !== 'p1' || battle.winner || pendingPlacement || pendingTarget || p1AutoPlay) return;
    const creature = battle.p1.battlefield[laneIndex][row];
    if (!creature || !creature.canAttack) return;
    const card = getCard(creature.cardId);

    const startX = e.clientX;
    const startY = e.clientY;
    let dragging = false;
    let ghost = null;
    let hoverTarget = null;

    const onMove = (ev) => {
      const dx = ev.clientX - startX;
      const dy = ev.clientY - startY;
      if (!dragging) {
        if (Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
        dragging = true;
        selectedAttacker = { laneIndex, row };
        render();
        ghost = document.createElement('div');
        ghost.className = 'drag-ghost';
        ghost.innerHTML = cardArtSVG(card);
        document.body.appendChild(ghost);
      }
      ghost.style.left = `${ev.clientX}px`;
      ghost.style.top = `${ev.clientY}px`;
      const under = document.elementFromPoint(ev.clientX, ev.clientY);
      const slot = under && under.closest('.lane-slot.legal-target, .lane-slot.legal-move-target');
      const face = !slot && under && under.closest('.hero-face.legal-target');
      const target = slot || face;
      if (hoverTarget && hoverTarget !== target) hoverTarget.classList.remove('drag-hover');
      if (target) target.classList.add('drag-hover');
      hoverTarget = target;
    };

    const onUp = () => {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      selectedAttacker = null;
      if (!dragging) return;
      if (ghost) ghost.remove();
      if (hoverTarget) {
        hoverTarget.classList.remove('drag-hover');
        if (hoverTarget.classList.contains('hero-face')) {
          resolveAttack({ laneIndex, row }, { type: 'face' });
        } else if (hoverTarget.classList.contains('legal-target')) {
          resolveAttack({ laneIndex, row }, { type: 'creature', row: hoverTarget.dataset.row });
        } else if (hoverTarget.classList.contains('legal-move-target')) {
          const toLane = Number(hoverTarget.dataset.lane);
          const toRow = hoverTarget.dataset.row;
          if (isOnline()) Net.sendAction({ kind: 'move', fromLane: laneIndex, fromRow: row, toLane, toRow });
          else moveCreature(battle, 'p1', laneIndex, row, toLane, toRow);
          sfx.click();
          vibrate(10);
        }
      }
      suppressClick = true;
      render();
    };

    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
  });
}

function resolveAttack(attackerPos, target) {
  const attacker = battle.p1.battlefield[attackerPos.laneIndex][attackerPos.row];
  const attackerEl = document.querySelector(
    `.lane-slot[data-side="p1"][data-lane="${attackerPos.laneIndex}"][data-row="${attackerPos.row}"] .board-card`
  );
  if (attackerEl) attackerEl.classList.add('lunge');
  sfx.attack();
  vibrate(15);

  let defender = null;
  let targetEl = null;
  if (target.type === 'face') {
    targetEl = document.querySelector('.hero-panel.enemy .hero-face');
  } else {
    defender = battle.p2.battlefield[attackerPos.laneIndex][target.row];
    targetEl = document.querySelector(
      `.lane-slot[data-side="p2"][data-lane="${attackerPos.laneIndex}"][data-row="${target.row}"] .board-card`
    );
  }
  if (targetEl) {
    targetEl.classList.add('hit-flash');
    spawnFloatingNumber(targetEl, `-${attacker.atk}`, false);
  }

  const attackerCard = getCard(attacker.cardId);
  const willRetaliate = defender && defender.life > attacker.atk && attackerCard.placement !== 'shooter';
  selectedAttacker = null;

  setTimeout(() => {
    if (isOnline()) {
      // Server is authoritative — send the intent and let the incoming
      // 'step' broadcast apply the real result (see Net.on('step', ...)).
      Net.sendAction({ kind: 'attack', laneIndex: attackerPos.laneIndex, row: attackerPos.row, target });
      return;
    }
    const res = attack(battle, 'p1', attackerPos.laneIndex, attackerPos.row, target);
    if (tutorialProgress) tutorialProgress.attacked = true;
    if (willRetaliate && attackerEl) {
      spawnFloatingNumber(attackerEl, `-${defender.retaliate}`, false);
    }
    if (res.attackerAbility) {
      const heroEl = document.querySelector('.hero-panel.player .hero-face');
      if (heroEl) {
        heroEl.classList.add('hit-flash');
        spawnFloatingNumber(heroEl, effectDisplay(res.attackerAbility), effectIsHeal(res.attackerAbility));
        effectIsHeal(res.attackerAbility) ? sfx.heal() : sfx.damage();
      }
    }
    if (res.defenderAbility) {
      const enemyHeroEl = document.querySelector('.hero-panel.enemy .hero-face');
      if (enemyHeroEl) {
        enemyHeroEl.classList.add('hit-flash');
        spawnFloatingNumber(enemyHeroEl, effectDisplay(res.defenderAbility), effectIsHeal(res.defenderAbility));
        effectIsHeal(res.defenderAbility) ? sfx.heal() : sfx.damage();
      }
    }
    render();
  }, 260);
}

function onSlotClick(side, laneIndex, row, el) {
  if (battle.active !== 'p1' || battle.winner || p1AutoPlay) return;

  if (pendingPlacement) {
    if (side !== 'p1') return;
    const occupant = battle.p1.battlefield[laneIndex][row];
    if (occupant) {
      const legalRows =
        pendingPlacement.card.placement === 'melee' ? ['front'] : pendingPlacement.card.placement === 'shooter' ? ['back'] : ['front', 'back'];
      if (!legalRows.includes(row)) return;
      pendingReplace = { idx: pendingPlacement.idx, card: pendingPlacement.card, laneIndex, row, oldCard: getCard(occupant.cardId) };
      pendingPlacement = null;
      render();
      return;
    }
    if (!isLegalPlacementSlot(pendingPlacement.card, laneIndex, row)) return;
    const idx = pendingPlacement.idx;
    pendingPlacement = null;
    if (isOnline()) Net.sendAction({ kind: 'deploy', handIdx: idx, laneIndex, row });
    else playCreature(battle, 'p1', idx, laneIndex, row);
    sfx.deploy();
    vibrate(10);
    render();
    return;
  }

  if (pendingTarget) {
    const creature = battle[side].battlefield[laneIndex][row];
    if (!creature || !isLegalSpellTarget(pendingTarget.card, side)) return;
    const card = pendingTarget.card;
    const idx = pendingTarget.idx;
    const targetEl = el.querySelector('.board-card') || el;
    targetEl.classList.add('hit-flash');
    spawnFloatingNumber(targetEl, spellFloatingText(card), isPositiveEffect(card.effect));
    sfx.cast();
    vibrate(10);
    const target = { side, laneIndex, row };
    pendingTarget = null;
    setTimeout(() => {
      if (isOnline()) Net.sendAction({ kind: 'spell', handIdx: idx, target });
      else playSpellOrFortune(battle, 'p1', idx, target);
      render();
    }, 260);
    return;
  }

  if (side === 'p1') {
    const creature = battle.p1.battlefield[laneIndex][row];

    if (!creature) {
      // tapping an empty own-side slot: resolve as a move if one is pending
      if (!selectedAttacker) return;
      const mover = battle.p1.battlefield[selectedAttacker.laneIndex][selectedAttacker.row];
      if (!mover) return;
      const moverCard = getCard(mover.cardId);
      const moveOptions = getValidMoveTargets(battle, 'p1', selectedAttacker.laneIndex, selectedAttacker.row, moverCard.placement);
      const isValidMove = moveOptions.some((m) => m.laneIndex === laneIndex && m.row === row);
      if (!isValidMove) return;
      const from = selectedAttacker;
      selectedAttacker = null;
      if (isOnline()) Net.sendAction({ kind: 'move', fromLane: from.laneIndex, fromRow: from.row, toLane: laneIndex, toRow: row });
      else moveCreature(battle, 'p1', from.laneIndex, from.row, laneIndex, row);
      render();
      return;
    }

    if (!creature.canAttack) return;
    if (selectedAttacker && selectedAttacker.laneIndex === laneIndex && selectedAttacker.row === row) {
      selectedAttacker = null;
      render();
      return;
    }
    const card = getCard(creature.cardId);
    const options = getValidAttackTargets(battle, 'p1', laneIndex, card.placement);
    const moveOptions = getValidMoveTargets(battle, 'p1', laneIndex, row, card.placement);
    if (options.length === 1 && options[0].type === 'face' && moveOptions.length === 0) {
      resolveAttack({ laneIndex, row }, { type: 'face' });
      return;
    }
    selectedAttacker = { laneIndex, row };
    render();
    return;
  }

  // side === 'p2': attempting to attack this slot
  if (!selectedAttacker || laneIndex !== selectedAttacker.laneIndex) return;
  const attackerCreature = battle.p1.battlefield[selectedAttacker.laneIndex][selectedAttacker.row];
  if (!attackerCreature) return;
  const card = getCard(attackerCreature.cardId);
  const options = getValidAttackTargets(battle, 'p1', selectedAttacker.laneIndex, card.placement);
  const match = options.find((o) => o.type === 'creature' && o.row === row);
  if (!match) return;
  resolveAttack(selectedAttacker, { type: 'creature', row });
}

// Sacrificing a creature is irreversible (no refund of its mana or the card
// itself — it's gone to the discard pile for good), so unlike a normal
// deploy this always goes through an explicit confirm step instead of
// resolving the instant a legal slot is tapped/dropped on.
function confirmReplace() {
  if (!pendingReplace) return;
  const { idx, laneIndex, row } = pendingReplace;
  pendingReplace = null;
  if (isOnline()) Net.sendAction({ kind: 'replace', handIdx: idx, laneIndex, row });
  else replaceCreature(battle, 'p1', laneIndex, row, idx);
  sfx.deploy();
  vibrate([10, 30, 10]);
  render();
}

function cancelReplace() {
  pendingReplace = null;
  render();
}

function onFaceClick(side, el) {
  if (battle.active !== 'p1' || battle.winner || p1AutoPlay) return;

  if (pendingTarget) {
    if (side !== 'p2' || pendingTarget.card.target !== 'enemy_any') return;
    const card = pendingTarget.card;
    spawnFloatingNumber(el, `-${card.value}`, false);
    const idx = pendingTarget.idx;
    pendingTarget = null;
    setTimeout(() => {
      if (isOnline()) Net.sendAction({ kind: 'spell', handIdx: idx, target: undefined });
      else playSpellOrFortune(battle, 'p1', idx, undefined);
      render();
    }, 260);
    return;
  }

  if (selectedAttacker && side === 'p2') {
    const attackerCreature = battle.p1.battlefield[selectedAttacker.laneIndex][selectedAttacker.row];
    if (!attackerCreature) return;
    const card = getCard(attackerCreature.cardId);
    const options = getValidAttackTargets(battle, 'p1', selectedAttacker.laneIndex, card.placement);
    if (options.some((o) => o.type === 'face')) {
      resolveAttack(selectedAttacker, { type: 'face' });
    }
  }
}

function onLevelUp(attr) {
  if (battle.active !== 'p1' || battle.winner || pendingPlacement || pendingTarget || p1AutoPlay) return;
  if (isOnline()) Net.sendAction({ kind: 'levelUp', attr });
  else levelUpAttribute(battle, 'p1', attr);
  render();
}

function onUseSpecial() {
  if (battle.active !== 'p1' || battle.winner || pendingPlacement || pendingTarget || p1AutoPlay) return;
  const hero = getHero(battle.p1.heroId);
  if (hero.special.id === 'heal_hero_2') {
    spawnFloatingNumber(document.querySelector('.hero-panel.player .hero-face'), '+2', true);
  } else if (hero.special.id === 'damage_enemy_hero_1') {
    spawnFloatingNumber(document.querySelector('.hero-panel.enemy .hero-face'), '-1', false);
  }
  if (isOnline()) Net.sendAction({ kind: 'special' });
  else useHeroSpecial(battle, 'p1', hero.special.id);
  render();
}

function onEndTurn() {
  if (battle.active !== 'p1' || pendingPlacement || pendingTarget || p1AutoPlay) return;

  const heroActionPending = !battle.p1.heroActionUsed;
  const readyCreatures = countReadyCreatures(battle.p1);
  if (heroActionPending || readyCreatures > 0) {
    endTurnConfirmOpen = true;
    render();
    return;
  }

  doEndTurn();
}

function doEndTurn() {
  endTurnConfirmOpen = false;
  selectedAttacker = null;
  sfx.click();
  if (isOnline()) {
    Net.sendAction({ kind: 'endTurn' });
    render();
    return;
  }
  endTurn(battle);
  render();
  if (battle.active === 'p2' && !battle.winner) {
    setTimeout(playAiTurn, 500);
  } else if (battle.active === 'p1' && !battle.winner && p1AutoPlay) {
    setTimeout(playAutoDeckTurn, 500);
  }
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function showAiToast(message) {
  if (!aiToastEl) {
    aiToastEl = document.createElement('div');
    aiToastEl.className = 'toast ai-toast';
    document.body.appendChild(aiToastEl);
  }
  aiToastEl.textContent = message;
  aiToastEl.classList.remove('visible');
  // force reflow so re-adding 'visible' restarts the fade-in even if it's already showing
  void aiToastEl.offsetWidth;
  aiToastEl.classList.add('visible');
  clearTimeout(aiToastHideTimer);
  aiToastHideTimer = setTimeout(() => {
    if (aiToastEl) aiToastEl.classList.remove('visible');
  }, AI_STEP_DELAY + 300);
}

function hideAiToast() {
  clearTimeout(aiToastHideTimer);
  if (aiToastEl) {
    aiToastEl.remove();
    aiToastEl = null;
  }
}

// Applies the visual/audio feedback for one already-mutated opponent step —
// the bot's own turn (from ai.js's generator) and a real online opponent's
// moves (relayed by the server) both funnel through here, since both
// produce identically-shaped step descriptors (see src/actions.js). Called
// right before render(), while the DOM still reflects the pre-step state.
function animateOpponentStep(step) {
  if (step.type === 'levelUp') {
    showAiToast(`El rival sube ${attrFullLabel(step.attr)}`);
  } else if (step.type === 'special') {
    const heroEl = document.querySelector('.hero-panel.enemy .hero-face');
    if (heroEl) heroEl.classList.add('hit-flash');
    showAiToast('El rival usa su habilidad especial');
  } else if (step.type === 'deploy') {
    sfx.deploy();
    vibrate(10);
    showAiToast(`El rival juega ${step.card.name}`);
  } else if (step.type === 'replace') {
    sfx.deploy();
    vibrate([10, 30, 10]);
    showAiToast(`El rival sacrifica a ${step.oldCard.name} y despliega a ${step.card.name}`);
  } else if (step.type === 'move') {
    sfx.click();
    showAiToast(`El rival reposiciona ${step.card.name}`);
  } else if (step.type === 'spell') {
    const targetEl = step.target
      ? document.querySelector(
          `.lane-slot[data-side="${step.target.side}"][data-lane="${step.target.laneIndex}"][data-row="${step.target.row}"] .board-card`
        )
      : document.querySelector('.hero-panel.player .hero-face');
    if (targetEl) {
      targetEl.classList.add('hit-flash');
      spawnFloatingNumber(targetEl, spellFloatingText(step.card), isPositiveEffect(step.card.effect));
    }
    sfx.cast();
    vibrate(10);
    showAiToast(`El rival lanza ${step.card.name}`);
  } else if (step.type === 'attack') {
    const attackerEl = document.querySelector(
      `.lane-slot[data-side="p2"][data-lane="${step.laneIndex}"][data-row="${step.row}"] .board-card`
    );
    if (attackerEl) attackerEl.classList.add('lunge');
    sfx.attack();
    vibrate(15);

    const isFace = step.target.type === 'face';
    const targetEl = isFace
      ? document.querySelector('.hero-panel.player .hero-face')
      : document.querySelector(
          `.lane-slot[data-side="p1"][data-lane="${step.laneIndex}"][data-row="${step.target.row}"] .board-card`
        );
    if (targetEl) {
      targetEl.classList.add('hit-flash');
      spawnFloatingNumber(targetEl, `-${step.attackerAtk}`, false);
    }
    if (step.retaliateDamage > 0 && attackerEl) {
      spawnFloatingNumber(attackerEl, `-${step.retaliateDamage}`, false);
    }
    if (isFace) {
      sfx.damage();
      vibrate([10, 30, 15]);
    }
    if (step.res.attackerAbility) {
      const enemyHeroEl = document.querySelector('.hero-panel.enemy .hero-face');
      if (enemyHeroEl) {
        enemyHeroEl.classList.add('hit-flash');
        spawnFloatingNumber(enemyHeroEl, effectDisplay(step.res.attackerAbility), effectIsHeal(step.res.attackerAbility));
      }
    }
    if (step.res.defenderAbility) {
      const heroEl = document.querySelector('.hero-panel.player .hero-face');
      if (heroEl) {
        heroEl.classList.add('hit-flash');
        spawnFloatingNumber(heroEl, effectDisplay(step.res.defenderAbility), effectIsHeal(step.res.defenderAbility));
      }
    }
    showAiToast(`El rival ataca con ${step.card.name}`);
  }
}

async function playAiTurn() {
  for (const step of runAiTurnSteps(battle)) {
    animateOpponentStep(step);
    render();
    await wait(AI_STEP_DELAY);
    if (battle.winner) break;
  }
  hideAiToast();
  if (!battle.winner) endTurn(battle);
  render();
  // Autodeckbuilder vs IA: once the AI's turn ends, play is back on p1 —
  // if that's an autoplaying deck, its turn has to be driven the same way
  // the AI's was, since no human is going to tap anything. (playAiTurn only
  // ever runs in a local match, so isOnline() is always false here in
  // practice — checked anyway for the same reason as in playAutoDeckTurn.)
  if (!battle.winner && !isOnline() && battle.active === 'p1' && p1AutoPlay) {
    setTimeout(playAutoDeckTurn, 500);
  }
}

// Plays the player's own side automatically for Autodeckbuilder — same
// per-step engine calls as playAiTurn, just applied to 'p1' and capped at
// one card via autoDeck.js instead of ai.js's unrestricted hand-dump.
async function playAutoDeckTurn() {
  if (battle.winner) return;
  showAiToast('🤖 Autodeckbuilder jugando tu turno…');
  await wait(AI_STEP_DELAY);
  if (!battle.winner) runAutoDeckTurn(battle, 'p1');
  hideAiToast();
  if (!battle.winner) endTurn(battle);
  render();
  if (battle.winner || isOnline()) return;
  // This whole client-side chain only drives a *local* p1 auto vs IA match
  // — in an online match the server owns turn order for both sides (see
  // server/autoPlay.js), so isOnline() bails out above instead of racing it.
  if (battle.active === 'p2') {
    setTimeout(playAiTurn, 500);
  } else if (battle.active === 'p1' && p1AutoPlay) {
    setTimeout(playAutoDeckTurn, 500);
  }
}

function onForfeit() {
  forfeitConfirmOpen = false;
  endTurnConfirmOpen = false;
  if (isOnline()) {
    Net.sendAction({ kind: 'forfeit' });
    return;
  }
  battle.winner = 'p2';
  render();
}

// ---------------- Router ----------------

export function render() {
  if (screen === 'home') renderHome();
  else if (screen === 'factionPick') renderFactionPick();
  else if (screen === 'deckSelect') renderDeckSelect();
  else if (screen === 'deckbuilder') renderDeckbuilder();
  else if (screen === 'collection') renderCollection();
  else if (screen === 'missions') renderMissions();
  else if (screen === 'tournaments') renderTournaments();
  else if (screen === 'seasonPass') renderSeasonPass();
  else if (screen === 'ladder') renderLadder();
  else if (screen === 'leaderboard') renderLeaderboard();
  else if (screen === 'friends') renderFriends();
  else if (screen === 'profile') renderProfile();
  else if (screen === 'tutorial') renderTutorial();
  else if (screen === 'shop') renderShop();
  else if (screen === 'packOpen') renderPackOpen();
  else if (screen === 'reveal') renderReveal();
  else if (screen === 'onlineWaiting') renderOnlineWaiting();
  else if (screen === 'draftWaiting') renderDraftWaiting();
  else if (screen === 'draftPick') renderDraftPick();
  else if (screen === 'draftHeroPick') renderDraftHeroPick();
  else if (screen === 'tournamentWaiting') renderTournamentWaiting();
  else if (screen === 'battle') renderBattle();
  wireTooltips();
  wireHeader();
  renderAttackArrows();
  refreshBracketFab();
  if (screen !== 'battle') wireCardTilt();
}

// ---------------- Bracket status (Draft + Torneo) ----------------
// Appended as a sibling of #app (like renderAttackArrows' SVG overlay) so it
// survives every screen's full app.innerHTML replace instead of needing to
// be re-declared inside each one — visible on any screen except an actual
// battle, since that's the one place a player already has full context.

function formatElapsed(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function startBracketElapsedTimer() {
  stopBracketElapsedTimer();
  bracketElapsedTimerId = setInterval(() => {
    const el = document.getElementById('bracket-status-fab-timer');
    if (!el || !bracketStatus) {
      stopBracketElapsedTimer();
      return;
    }
    el.textContent = formatElapsed(Date.now() - bracketStatus.startedAt);
    // Only present while the status modal is open (see bracketMatchRowHtml)
    // — an empty NodeList the rest of the time is a harmless no-op.
    document.querySelectorAll('.bracket-match-clock').forEach((clockEl) => {
      const deadline = Number(clockEl.dataset.deadline);
      if (deadline) clockEl.textContent = ` · ${formatMatchClock(deadline - Date.now())}`;
    });
  }, 1000);
}

function stopBracketElapsedTimer() {
  if (bracketElapsedTimerId) {
    clearInterval(bracketElapsedTimerId);
    bracketElapsedTimerId = null;
  }
}

function refreshBracketFab() {
  const shouldShow = bracketStatus !== null && screen !== 'battle';
  let fab = document.getElementById('bracket-status-fab');
  if (!shouldShow) {
    if (fab) fab.remove();
    stopBracketElapsedTimer();
    const modal = document.getElementById('bracket-status-modal');
    if (modal) modal.remove();
    return;
  }
  if (!fab) {
    fab = document.createElement('button');
    fab.id = 'bracket-status-fab';
    fab.className = 'bracket-status-fab';
    fab.onclick = () => {
      bracketModalOpen = !bracketModalOpen;
      refreshBracketFab();
    };
    document.body.appendChild(fab);
    startBracketElapsedTimer();
  }
  const kindIcon = bracketStatus.kind === 'draft' ? '🎴' : '🏆';
  fab.innerHTML = `${kindIcon}<span class="bracket-status-fab-timer" id="bracket-status-fab-timer">${formatElapsed(Date.now() - bracketStatus.startedAt)}</span>`;
  renderBracketModal();
}

function bracketSeatLabel(seat) {
  if (!seat) return '?';
  return `${seat.isBot ? '🤖 ' : ''}${escapeHtml(seat.name)}`;
}

function bracketMatchRowHtml(label, match, seats) {
  if (!match) {
    return `
      <div class="bracket-match pending">
        <span class="bracket-match-label">${label}</span>
        <span class="bracket-match-status">Por definir</span>
      </div>`;
  }
  const [a, b] = match.players;
  const isLive = match.winner == null;
  const status = isLive ? 'En juego…' : `${bracketSeatLabel(seats[match.winner])} ganó`;
  // Live only, and only once rooms.js has actually armed the match's 5-minute
  // timer (a brand-new match can be live for a moment before its own
  // matchStart — and this deadline with it — has round-tripped back here).
  const clockHtml =
    isLive && match.deadline
      ? `<span class="bracket-match-clock" data-deadline="${match.deadline}"> · ${formatMatchClock(match.deadline - Date.now())}</span>`
      : '';
  return `
    <div class="bracket-match ${isLive ? 'live' : 'done'}">
      <span class="bracket-match-label">${label}</span>
      <span class="bracket-match-players">${bracketSeatLabel(seats[a])} <em>vs</em> ${bracketSeatLabel(seats[b])}</span>
      <span class="bracket-match-status">${status}${clockHtml}</span>
    </div>`;
}

function renderBracketModal() {
  let modal = document.getElementById('bracket-status-modal');
  if (!bracketModalOpen) {
    if (modal) modal.remove();
    return;
  }
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'bracket-status-modal';
    modal.className = 'bracket-status-modal';
    document.body.appendChild(modal);
  }
  const { kind, seats, semis, final } = bracketStatus;
  modal.innerHTML = `
    <div class="bracket-status-backdrop" id="bracket-status-backdrop"></div>
    <div class="bracket-status-panel">
      <div class="bracket-status-header">
        <h3>${kind === 'draft' ? '🎴 Estado del Draft' : '🏆 Estado del Torneo'}</h3>
        <button class="bracket-status-close" id="bracket-status-close">✕</button>
      </div>
      <div class="bracket-status-seats">${seats.map((s) => `<div class="bracket-status-seat">${bracketSeatLabel(s)}</div>`).join('')}</div>
      <div class="bracket-status-matches">
        ${bracketMatchRowHtml('Semifinal 1', semis[0], seats)}
        ${bracketMatchRowHtml('Semifinal 2', semis[1], seats)}
        ${bracketMatchRowHtml('Final', final, seats)}
      </div>
    </div>`;
  const close = () => {
    bracketModalOpen = false;
    refreshBracketFab();
  };
  document.getElementById('bracket-status-close').onclick = close;
  document.getElementById('bracket-status-backdrop').onclick = close;
}

function renderAttackArrows() {
  const existing = document.getElementById('attack-arrows');
  if (existing) existing.remove();
  if (screen !== 'battle' || !battle || !selectedAttacker) return;

  const mover = battle.p1.battlefield[selectedAttacker.laneIndex][selectedAttacker.row];
  if (!mover) return;
  const card = getCard(mover.cardId);
  const options = getValidAttackTargets(battle, 'p1', selectedAttacker.laneIndex, card.placement);
  const creatureTargets = options.filter((o) => o.type === 'creature');
  if (creatureTargets.length === 0) return;

  const attackerEl = document.querySelector(
    `.lane-slot[data-side="p1"][data-lane="${selectedAttacker.laneIndex}"][data-row="${selectedAttacker.row}"]`
  );
  if (!attackerEl) return;
  const aRect = attackerEl.getBoundingClientRect();
  const ax = aRect.left + aRect.width / 2;
  const ay = aRect.top + aRect.height / 2;

  const svgNS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(svgNS, 'svg');
  svg.setAttribute('id', 'attack-arrows');
  svg.setAttribute('class', 'attack-arrows-overlay');

  const defs = document.createElementNS(svgNS, 'defs');
  defs.innerHTML =
    '<marker id="arrowhead" markerWidth="8" markerHeight="8" refX="6" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8 Z" fill="#ff5b5b"/></marker>';
  svg.appendChild(defs);

  for (const t of creatureTargets) {
    const targetEl = document.querySelector(`.lane-slot[data-side="p2"][data-lane="${selectedAttacker.laneIndex}"][data-row="${t.row}"]`);
    if (!targetEl) continue;
    const tRect = targetEl.getBoundingClientRect();
    const tx = tRect.left + tRect.width / 2;
    const ty = tRect.top + tRect.height / 2;
    const line = document.createElementNS(svgNS, 'line');
    line.setAttribute('x1', ax);
    line.setAttribute('y1', ay);
    line.setAttribute('x2', tx);
    line.setAttribute('y2', ty);
    line.setAttribute('class', 'attack-arrow-line');
    line.setAttribute('marker-end', 'url(#arrowhead)');
    svg.appendChild(line);
  }

  document.body.appendChild(svg);
}

let tooltipLayer = null;

function ensureTooltipLayer() {
  if (!tooltipLayer) {
    tooltipLayer = document.createElement('div');
    tooltipLayer.id = 'tooltip-layer';
    document.body.appendChild(tooltipLayer);
  }
  return tooltipLayer;
}

function showTooltip(anchorEl, text) {
  const layer = ensureTooltipLayer();
  layer.textContent = text;
  layer.classList.add('visible');
  const rect = anchorEl.getBoundingClientRect();
  const layerRect = layer.getBoundingClientRect();
  let top = rect.top - layerRect.height - 8;
  if (top < 4) top = Math.min(window.innerHeight - layerRect.height - 4, rect.bottom + 8);
  let left = rect.left + rect.width / 2 - layerRect.width / 2;
  left = Math.max(4, Math.min(left, window.innerWidth - layerRect.width - 4));
  layer.style.top = `${top}px`;
  layer.style.left = `${left}px`;
}

function hideTooltip() {
  if (tooltipLayer) tooltipLayer.classList.remove('visible');
}

// Tilt-on-hover "holo" effect for static card grids (collection/shop/
// deckbuilder/etc). Deliberately not called for the battle screen — hand
// cards there are already owned by wireHandCardDrag's pointerdown/pointermove
// drag, and this only activates for real mice anyway (touch never sees it).
function wireCardTilt() {
  if (!window.matchMedia('(hover: hover) and (pointer: fine)').matches) return;
  document.querySelectorAll('.card').forEach((el) => {
    el.classList.add('tilt-armed');
    el.addEventListener('pointermove', (e) => {
      const rect = el.getBoundingClientRect();
      const px = (e.clientX - rect.left) / rect.width - 0.5;
      const py = (e.clientY - rect.top) / rect.height - 0.5;
      el.style.setProperty('--tilt-y', `${(px * 14).toFixed(2)}deg`);
      el.style.setProperty('--tilt-x', `${(-py * 14).toFixed(2)}deg`);
      el.style.setProperty('--glow-x', `${((px + 0.5) * 100).toFixed(1)}%`);
      el.style.setProperty('--glow-y', `${((py + 0.5) * 100).toFixed(1)}%`);
    });
    el.addEventListener('pointerleave', () => {
      el.style.setProperty('--tilt-y', '0deg');
      el.style.setProperty('--tilt-x', '0deg');
    });
  });
}

// `scope` lets rerenderHeader() rebind only the freshly-swapped topbar node
// instead of the whole document (which would double-bind every other
// tooltip still on screen). Reads el.dataset.tooltip live on each event
// rather than capturing it once, so a button that changes its own tooltip
// text without a full re-render (rare now, but cheap to keep correct) still
// shows the current text.
function wireTooltips(scope = document) {
  scope.querySelectorAll('[data-tooltip]').forEach((el) => {
    el.addEventListener('mouseenter', () => showTooltip(el, el.dataset.tooltip));
    el.addEventListener('mouseleave', hideTooltip);
    el.addEventListener(
      'touchstart',
      () => {
        showTooltip(el, el.dataset.tooltip);
        clearTimeout(el._tooltipTimer);
        el._tooltipTimer = setTimeout(hideTooltip, 1800);
      },
      { passive: true }
    );
  });
}

function trackLoginDay() {
  const today = new Date().toISOString().slice(0, 10);
  Stats.ensureStats(save);
  if (save.stats.lastLoginDate === today) return;
  save.stats.lastLoginDate = today;
  Stats.bumpStat(save, 'loginDays', 1);
  persist();
}

export function init() {
  setupNetListeners();
  trackLoginDay();
  if (!save.selectedFaction) {
    // Brand-new save: nothing owned yet, no faction chosen — onboarding
    // handles both the starter deck grant and the guided first battle, so
    // it supersedes the old static tutorial screen for these players.
    screen = 'factionPick';
  } else if (!save.tutorialSeen) {
    screen = 'tutorial';
  }
  render();
  // Populate the topbar name chip ASAP without forcing the player through an
  // online match first — same offline-tolerant fire-and-forget pattern as
  // renderLadder's fetchAccount call. Sequence-guarded (see
  // nextAccountSyncSeq) so this can never stomp a rename the player makes
  // (e.g. on the onboarding screen) while this request is still in flight.
  const seq = nextAccountSyncSeq();
  Net.fetchAccount()
    .then((account) => {
      if (!account) return;
      // Only worth a second full render if the server actually disagrees
      // with what's already on screen (e.g. synced from another device) —
      // otherwise this fired on every single app load and re-rendered home
      // a moment after the first paint for no visible reason, replaying
      // every entrance animation (topbar badges, missions tab, ad FAB).
      const changed = account.username !== save.username || (account.trophies || 0) !== (save.trophies || 0);
      syncAccountToSave(account, seq);
      if (changed && (screen === 'home' || screen === 'profile')) render();
    })
    .catch(() => {});
}
