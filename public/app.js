
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from './config.js';

const $ = id => document.getElementById(id);

const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;'
}[char]));

let db;
let user = null;
let admin = false;

const coverCache = new Map();

const categories = [
  {
    id: 'suggested',
    title: '🏆 Eure Spielwünsche',
    subtitle: 'COMMUNITY FAVORITEN',
    status: 'suggested'
  },
  {
    id: 'playing',
    title: '🟢 Aktuelles Spiel',
    subtitle: 'JETZT IM STREAM',
    status: 'playing'
  },
  {
    id: 'paused',
    title: '⏸️ Pausierte Games',
    subtitle: 'GEHT BALD WEITER',
    status: 'paused'
  },
  {
    id: 'planned',
    title: '🚀 Geplante Games',
    subtitle: 'BALD IM STREAM',
    status: 'planned'
  },
  {
    id: 'played',
    title: '✅ Bereits gespielt',
    subtitle: 'ERFOLGREICH GEZOCKT',
    status: 'played'
  },
  {
    id: 'abandoned',
    title: '❌ Abgebrochene Games',
    subtitle: 'NICHT ZU ENDE GESPIELT',
    status: 'abandoned'
  }
];

const categoryState = new Map();
const categoryElements = new Map();

let allGames = [];
let allSuggestions = [];
let voteCounts = new Map();
let userVotes = new Set();

function notice(message) {
  const el = $('notice');
  if (!el) return;

  el.textContent = message;
  el.style.display = 'block';

  clearTimeout(window.noticeTimer);

  window.noticeTimer = setTimeout(() => {
    el.style.display = 'none';
  }, 5000);
}

function check(result) {
  if (result.error) throw result.error;
  return result.data;
}

function empty(message = 'Hier ist noch Platz für neue Abenteuer 🎮') {
  return `<div class="empty">${esc(message)}</div>`;
}

// SPIELSUCHE MIT IGDB

function setupGameSearch(inputId) {
  const input = $(inputId);
  if (!input || input.closest('.game-search-wrapper')) return;

  const wrapper = document.createElement('div');
  wrapper.className = 'game-search-wrapper';

  input.parentNode.insertBefore(wrapper, input);
  wrapper.appendChild(input);

  const list = document.createElement('div');
  list.className = 'game-search-results';
  list.setAttribute('role', 'listbox');
  list.setAttribute('aria-label', 'Spielvorschläge');
  list.hidden = true;

  wrapper.appendChild(list);

  input.setAttribute('autocomplete', 'off');
  input.setAttribute('aria-autocomplete', 'list');

  let timer;
  let controller;
  let sequence = 0;

  function close() {
    list.replaceChildren();
    list.hidden = true;
    input.setAttribute('aria-expanded', 'false');
  }

  input.addEventListener('input', () => {
    clearTimeout(timer);
    controller?.abort();

    const request = ++sequence;
    const query = input.value.trim();

    close();

    if (query.length < 2) return;

    timer = setTimeout(async () => {
      controller = new AbortController();

      try {
        const response = await fetch(
          `/api/game-cover?search=${encodeURIComponent(query)}`,
          { signal: controller.signal }
        );

        if (!response.ok) throw new Error(`HTTP ${response.status}`);

        const data = await response.json();

        if (request !== sequence || input.value.trim() !== query) return;

        const suggestions = Array.isArray(data.suggestions)
          ? data.suggestions
          : [];

        for (const game of suggestions) {
          if (typeof game.name !== 'string') continue;

          const button = document.createElement('button');
          button.type = 'button';
          button.className = 'game-search-item';
          button.setAttribute('role', 'option');

          if (
            typeof game.cover === 'string' &&
            game.cover.startsWith('https://images.igdb.com/')
          ) {
            const img = document.createElement('img');
            img.src = game.cover;
            img.alt = '';
            img.loading = 'lazy';
            button.appendChild(img);
          }

          const name = document.createElement('span');
          name.textContent = game.name;
          button.appendChild(name);

          button.addEventListener('click', () => {
            input.value = game.name;
            ++sequence;
            clearTimeout(timer);
            controller?.abort();
            close();
            input.focus();
          });

          list.appendChild(button);
        }

        list.hidden = list.childElementCount === 0;
        input.setAttribute('aria-expanded', String(!list.hidden));

      } catch (error) {
        if (error.name !== 'AbortError') {
          console.warn('Spielsuche fehlgeschlagen:', error);
        }
      }
    }, 300);
  });

  input.addEventListener('keydown', event => {
    if (event.key === 'Escape') close();
  });

  document.addEventListener('click', event => {
    if (!wrapper.contains(event.target)) close();
  });
}

// KATEGORIEN IN DER RICHTIGEN REIHENFOLGE

function setupCategories() {
  const suggested = $('suggested');
  const planned = $('planned');
  const played = $('played');

  if (!suggested || !planned || !played) return;

  const originalSection = suggested.closest('section');
  if (!originalSection) return;

  const container = document.createElement('div');
  container.id = 'gameCategories';

  originalSection.before(container);

  const originalPlannedSection = planned.closest('section');
  const originalPlayedSection = played.closest('section');
  const oldAbandonedSection = $('abandonedSection');

  for (const section of [
    originalSection,
    originalPlannedSection,
    originalPlayedSection,
    oldAbandonedSection
  ]) {
    section?.remove();
  }

  const controls = document.createElement('div');
  controls.className = 'panel';
  controls.style.marginBottom = '28px';

  controls.innerHTML = `
    <span class="eyebrow">GAMEHUB ENTDECKEN</span>
    <h2>🔎 Spiele durchsuchen</h2>
    <div class="gamehub-controls">
      <input
        id="gamehubSearch"
        type="search"
        placeholder="Spielname suchen ..."
        aria-label="Spiele durchsuchen"
      >
      <select id="gamehubSort" aria-label="Spiele sortieren">
        <option value="newest">Neueste zuerst</option>
        <option value="oldest">Älteste zuerst</option>
        <option value="az">Name A bis Z</option>
        <option value="za">Name Z bis A</option>
        <option value="votes">Meiste Stimmen zuerst</option>
      </select>
    </div>
  `;

  container.appendChild(controls);

  for (const category of categories) {
    categoryState.set(category.id, true);

    const section = document.createElement('section');
    section.className = 'gamehub-category';
    section.dataset.category = category.id;

    section.innerHTML = `
      <button
        class="gamehub-category-toggle"
        type="button"
        aria-expanded="true"
        aria-controls="${category.id}"
      >
        <span>
          <span class="eyebrow">${esc(category.subtitle)}</span>
          <span class="gamehub-category-title">
            ${esc(category.title)}
            <span class="gamehub-category-count" id="${category.id}Count">0</span>
          </span>
        </span>
        <span class="gamehub-chevron" aria-hidden="true">⌄</span>
      </button>
      <div id="${category.id}" class="grid"></div>
    `;

    container.appendChild(section);
    categoryElements.set(category.id, section);

    const toggle = section.querySelector('.gamehub-category-toggle');
    const grid = section.querySelector('.grid');

    toggle.addEventListener('click', () => {
      const expanded = !categoryState.get(category.id);
      categoryState.set(category.id, expanded);
      toggle.setAttribute('aria-expanded', String(expanded));
      grid.hidden = !expanded;
      section.classList.toggle('gamehub-collapsed', !expanded);
    });
  }

  $('gamehubSearch').addEventListener('input', renderCategories);
  $('gamehubSort').addEventListener('change', renderCategories);

  const style = document.createElement('style');

  style.textContent = `
    .gamehub-controls {
      display: grid;
      grid-template-columns: minmax(0, 1fr) 220px;
      gap: 12px;
      margin-top: 18px;
    }

    .gamehub-category {
      margin-bottom: 34px;
    }

    .gamehub-category-toggle {
      width: 100%;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 15px;
      padding: 18px 20px;
      margin-bottom: 18px;
      text-align: left;
      color: #f4f0ff;
      background: #171424;
      border: 1px solid #37304a;
      border-radius: 16px;
      cursor: pointer;
    }

    .gamehub-category-toggle:hover {
      border-color: #875bd2;
    }

    .gamehub-category-title {
      display: block;
      font-size: clamp(21px, 4vw, 29px);
      font-weight: 800;
      margin-top: 8px;
    }

    .gamehub-category-count {
      display: inline-block;
      min-width: 32px;
      padding: 3px 9px;
      margin-left: 7px;
      border-radius: 999px;
      background: #392653;
      color: #d9c3ff;
      font-size: 15px;
      vertical-align: middle;
    }

    .gamehub-chevron {
      font-size: 30px;
      color: #b99aff;
      transition: transform .2s;
    }

    .gamehub-collapsed .gamehub-chevron {
      transform: rotate(-90deg);
    }

    .gamehub-category .grid[hidden] {
      display: none !important;
    }

    .gamehub-category .grid {
      margin-bottom: 20px;
    }

    @media (max-width: 600px) {
      .gamehub-controls {
        grid-template-columns: 1fr;
      }

      .gamehub-category-toggle {
        padding: 15px;
      }
    }
  `;

  document.head.appendChild(style);
}

// SPIELEKARTEN

function card(game, type) {
  const count = voteCounts.get(game.id) || 0;
  const voted = userVotes.has(game.id);

  const labels = {
    suggested: 'SPIELVORSCHLAG',
    playing: 'JETZT AKTUELL',
    paused: 'PAUSIERT',
    planned: 'DEMNÄCHST',
    played: 'GESPIELT',
    abandoned: 'ABGEBROCHEN'
  };

  return `
    <article class="game">
      <div class="game-cover-wrap" style="display:none">
        <img
          class="game-cover"
          data-cover-title="${esc(game.title)}"
          alt="Cover von ${esc(game.title)}"
          loading="lazy"
          style="display:none"
        >
      </div>

      <div class="eyebrow">${labels[type] || 'GAME'}</div>
      <h3>${esc(game.title)}</h3>

      ${game.description
        ? `<p>${esc(game.description)}</p>`
        : ''}

      ${type === 'suggested'
        ? `
          <button
            class="vote ${voted ? 'active' : ''}"
            data-vote="${game.id}"
            type="button"
          >
            💜 ${count} ${voted ? 'Abgestimmt' : 'Stimmen'}
          </button>
        `
        : ''}
    </article>
  `;
}

// AUTOMATISCHE IGDB-COVER

async function getGameCover(title) {
  const key = String(title || '').trim().toLowerCase();

  if (!key) return null;
  if (coverCache.has(key)) return coverCache.get(key);

  try {
    const response = await fetch(
      `/api/game-cover?title=${encodeURIComponent(title)}`
    );

    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const data = await response.json();

    const cover =
      typeof data.cover === 'string' &&
      data.cover.startsWith('https://')
        ? data.cover
        : null;

    coverCache.set(key, cover);
    return cover;

  } catch (error) {
    console.warn('Cover konnte nicht geladen werden:', title, error);
    return null;
  }
}

async function loadGameCovers() {
  const images = [...document.querySelectorAll('img[data-cover-title]')];

  const titles = [
    ...new Set(images.map(img => img.dataset.coverTitle))
  ];

  const results = await Promise.all(
    titles.map(async title => [title, await getGameCover(title)])
  );

  const covers = new Map(results);

  for (const img of images) {
    const cover = covers.get(img.dataset.coverTitle);

    if (!cover || !img.isConnected) continue;

    const wrap = img.closest('.game-cover-wrap');

    img.onload = () => {
      if (!img.isConnected) return;
      img.hidden = false;
      img.style.display = 'block';
      if (wrap) wrap.style.display = 'block';
    };

    img.onerror = () => {
      img.style.display = 'none';
      if (wrap) wrap.style.display = 'none';
    };

    img.src = cover;

    if (img.complete && img.naturalWidth > 0) {
      img.onload();
    }
  }
}

// SORTIEREN UND FILTERN

function sortItems(items, sort, type) {
  const result = [...items];

  if (sort === 'az') {
    result.sort((a, b) => a.title.localeCompare(b.title, 'de'));
  } else if (sort === 'za') {
    result.sort((a, b) => b.title.localeCompare(a.title, 'de'));
  } else if (sort === 'oldest') {
    result.reverse();
  } else if (sort === 'votes' && type === 'suggested') {
    result.sort((a, b) =>
      (voteCounts.get(b.id) || 0) - (voteCounts.get(a.id) || 0)
    );
  }

  return result;
}

function renderCategories() {
  const search = ($('gamehubSearch')?.value || '').trim().toLocaleLowerCase('de');
  const sort = $('gamehubSort')?.value || 'newest';

  const approved = allSuggestions.filter(
    suggestion => suggestion.status === 'approved'
  );

  for (const category of categories) {
    const items = category.id === 'suggested'
      ? approved
      : allGames.filter(game => game.status === category.status);

    const count = $(category.id + 'Count');
    const target = $(category.id);

    if (!target) continue;

    if (count) count.textContent = items.length;

    const filtered = items.filter(game => {
      const text = `${game.title || ''} ${game.description || ''}`
        .toLocaleLowerCase('de');

      return text.includes(search);
    });

    const sorted = sortItems(filtered, sort, category.id);

    target.innerHTML = sorted.length
      ? sorted.map(game => card(game, category.id)).join('')
      : empty(search
          ? 'Keine passenden Spiele gefunden.'
          : 'Hier ist noch Platz für neue Abenteuer 🎮'
        );
  }

  loadGameCovers().catch(console.warn);
  setupVoteButtons();
}

// TWITCH-LOGIN

async function login() {
  const result = await db.auth.signInWithOAuth({
    provider: 'twitch',
    options: {
      redirectTo: window.location.origin + window.location.pathname
    }
  });

  check(result);
}

async function refreshAuth() {
  const result = await db.auth.getUser();

  if (
    result.error &&
    result.error.name !== 'AuthSessionMissingError'
  ) {
    throw result.error;
  }

  user = result.data.user || null;
  admin = false;

  if (user) {
    const adminResult = await db.rpc('is_gamehub_admin');
    admin = check(adminResult) === true;
  }

  const account = $('account');
  account.replaceChildren();

  if (user) {
    const name = document.createElement('span');

    name.textContent =
      '👾 ' +
      (
        user.user_metadata?.full_name ||
        user.user_metadata?.name ||
        user.email ||
        'Twitch-User'
      ) +
      ' ';

    const button = document.createElement('button');
    button.className = 'secondary';
    button.textContent = 'Logout';

    button.onclick = async () => {
      try {
        check(await db.auth.signOut());
        await refreshAuth();
        await load();
      } catch (error) {
        notice(error.message);
      }
    };

    account.append(name, button);

  } else {
    const button = document.createElement('button');
    button.className = 'primary';
    button.textContent = 'Mit Twitch anmelden';

    button.onclick = () => {
      login().catch(error => notice(error.message));
    };

    account.append(button);
  }

  $('adminSection')?.classList.toggle('hidden', !admin);
}

// ABSTIMMUNGEN

function setupVoteButtons() {
  document.querySelectorAll('[data-vote]').forEach(button => {
    button.onclick = async () => {
      if (!user) {
        notice('Bitte zuerst mit Twitch anmelden.');
        return;
      }

      const id = Number(button.dataset.vote);
      button.disabled = true;

      try {
        if (userVotes.has(id)) {
          check(
            await db.from('votes')
              .delete()
              .eq('suggestion_id', id)
              .eq('user_id', user.id)
          );
        } else {
          check(
            await db.from('votes')
              .insert({
                suggestion_id: id,
                user_id: user.id
              })
          );
        }

        await load();

      } catch (error) {
        notice(error.message);
        button.disabled = false;
      }
    };
  });
}

// ADMIN-VERWALTUNG

function setupAdmin() {
  if (!admin) return;

  $('adminSuggestions').innerHTML = allSuggestions.length
    ? allSuggestions.map(suggestion => `
        <div class="adminrow">
          <span>
            <b>${esc(suggestion.title)}</b>
            <small>(${esc(suggestion.status)})</small>
          </span>

          <div>
            <button data-suggestion="${suggestion.id}" data-sstatus="approved">
              Freigeben
            </button>
            <button data-suggestion="${suggestion.id}" data-sstatus="rejected">
              Ablehnen
            </button>
            <button data-suggestion="${suggestion.id}" data-sstatus="pending">
              Zurückstellen
            </button>
            <button class="danger" data-sdelete="${suggestion.id}">
              Löschen
            </button>
          </div>
        </div>
      `).join('')
    : empty();

  $('adminGames').innerHTML = allGames.length
    ? allGames.map(game => `
        <div class="adminrow">
          <span>
            <b>${esc(game.title)}</b>
            <small>(${esc(game.status)})</small>
          </span>

          <div>
            <button data-game="${game.id}" data-gstatus="playing">
              🟢 Aktuell
            </button>
            <button data-game="${game.id}" data-gstatus="paused">
              ⏸️ Pausiert
            </button>
            <button data-game="${game.id}" data-gstatus="planned">
              🚀 Geplant
            </button>
            <button data-game="${game.id}" data-gstatus="played">
              ✅ Gespielt
            </button>
            <button data-game="${game.id}" data-gstatus="abandoned">
              ❌ Abgebrochen
            </button>
            <button class="danger" data-gdelete="${game.id}">
              Löschen
            </button>
          </div>
        </div>
      `).join('')
    : empty();

  document.querySelectorAll('[data-sstatus]').forEach(button => {
    button.onclick = async () => {
      try {
        check(
          await db.from('suggestions')
            .update({ status: button.dataset.sstatus })
            .eq('id', Number(button.dataset.suggestion))
        );

        await load();
      } catch (error) {
        notice(error.message);
      }
    };
  });

  document.querySelectorAll('[data-sdelete]').forEach(button => {
    button.onclick = async () => {
      if (!confirm('Vorschlag wirklich löschen?')) return;

      try {
        check(
          await db.from('suggestions')
            .delete()
            .eq('id', Number(button.dataset.sdelete))
        );

        await load();
      } catch (error) {
        notice(error.message);
      }
    };
  });

  document.querySelectorAll('[data-gstatus]').forEach(button => {
    button.onclick = async () => {
      const id = Number(button.dataset.game);
      const status = button.dataset.gstatus;
      const game = allGames.find(item => item.id === id);

      if (!game) return;

      const update = { status };

      if (status === 'abandoned') {
        const answer = prompt(
          'Warum wurde das Spiel abgebrochen? (optional)',
          game.description || ''
        );

        if (answer === null) return;
        update.description = answer.trim();
      }

      try {
        check(
          await db.from('games')
            .update(update)
            .eq('id', id)
        );

        await load();
      } catch (error) {
        notice(error.message);
      }
    };
  });

  document.querySelectorAll('[data-gdelete]').forEach(button => {
    button.onclick = async () => {
      if (!confirm('Spiel wirklich löschen?')) return;

      try {
        check(
          await db.from('games')
            .delete()
            .eq('id', Number(button.dataset.gdelete))
        );

        await load();
      } catch (error) {
        notice(error.message);
      }
    };
  });
}

// DATEN LADEN

async function load() {
  const [gamesResult, suggestionsResult] = await Promise.all([
    db.from('games')
      .select('id,title,description,status')
      .order('created_at', { ascending: false }),

    db.from('suggestions')
      .select('id,title,description,status,user_id')
      .order('created_at', { ascending: false })
  ]);

  allGames = check(gamesResult) || [];
  allSuggestions = check(suggestionsResult) || [];

  const approvedIds = allSuggestions
    .filter(suggestion => suggestion.status === 'approved')
    .map(suggestion => suggestion.id);

  let votes = [];

  if (approvedIds.length) {
    const votesResult = await db.from('votes')
      .select('suggestion_id,user_id')
      .in('suggestion_id', approvedIds);

    votes = check(votesResult) || [];
  }

  voteCounts = new Map();
  userVotes = new Set();

  for (const vote of votes) {
    voteCounts.set(
      vote.suggestion_id,
      (voteCounts.get(vote.suggestion_id) || 0) + 1
    );

    if (user && vote.user_id === user.id) {
      userVotes.add(vote.suggestion_id);
    }
  }

  renderCategories();
  setupAdmin();
}

// FORMULAR: SPIEL VORSCHLAGEN

$('suggestForm')?.addEventListener('submit', async event => {
  event.preventDefault();

  if (!user) {
    notice('Bitte zuerst mit Twitch anmelden.');
    return;
  }

  try {
    check(
      await db.from('suggestions').insert({
        title: $('title').value.trim(),
        description: $('description').value.trim(),
        user_id: user.id
      })
    );

    event.target.reset();
    notice('Dein Vorschlag wartet auf Freigabe! 💜');
    await load();

  } catch (error) {
    notice(error.message);
  }
});

// FORMULAR: NEUES ADMIN-SPIEL

function setupAdminStatusOptions() {
  const select = $('gameStatus');
  if (!select) return;

  select.innerHTML = `
    <option value="playing">🟢 Aktuelles Spiel</option>
    <option value="paused">⏸️ Pausiert</option>
    <option value="planned" selected>🚀 Geplant</option>
    <option value="played">✅ Gespielt</option>
    <option value="abandoned">❌ Abgebrochen</option>
  `;
}

$('gameForm')?.addEventListener('submit', async event => {
  event.preventDefault();

  if (!admin) return;

  try {
    check(
      await db.from('games').insert({
        title: $('gameTitle').value.trim(),
        description: $('gameDescription').value.trim(),
        status: $('gameStatus').value
      })
    );

    event.target.reset();
    notice('Spiel hinzugefügt! 💜');
    await load();

  } catch (error) {
    notice(error.message);
  }
});

// START

(async () => {
  setupCategories();
  setupGameSearch('title');
  setupGameSearch('gameTitle');
  setupAdminStatusOptions();

  if (
    !SUPABASE_PUBLISHABLE_KEY ||
    SUPABASE_PUBLISHABLE_KEY.startsWith('HIER_')
  ) {
    notice('Bitte den Supabase-Key in public/config.js eintragen.');
    $('account').textContent = 'Konfiguration fehlt';
    return;
  }

  try {
    db = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);

    await refreshAuth();
    await load();

    db.auth.onAuthStateChange(() => {
      setTimeout(async () => {
        try {
          await refreshAuth();
          await load();
        } catch (error) {
          notice(error.message);
        }
      }, 0);
    });

  } catch (error) {
    console.error(error);
    notice(error.message);
  }
})();
