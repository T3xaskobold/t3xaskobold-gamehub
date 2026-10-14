
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from './config.js';

const $ = id => document.getElementById(id);

const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;'
}[c]));

let db;
let user = null;
let admin = false;

let allGames = [];
let allSuggestions = [];
let voteCounts = new Map();
let userVotes = new Set();

const coverCache = new Map();

const categoryConfig = [
  { id: 'paused', title: 'Pausiert', icon: '⏸️' },
  { id: 'planned', title: 'Geplant', icon: '🚀' },
  { id: 'played', title: 'Gespielt', icon: '✅' },
  { id: 'abandoned', title: 'Abgebrochen', icon: '❌' }
];

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

function statusLabel(status) {
  return ({
    playing: '🟢 Aktuell',
    paused: '⏸️ Pausiert',
    planned: '🚀 Geplant',
    played: '✅ Gespielt',
    abandoned: '❌ Abgebrochen'
  })[status] || status;
}

// AUTOMATISCHE IGDB-SPIELSUCHE

function setupGameSearch(inputId) {
  const input = $(inputId);
  if (!input || input.closest('.game-search-wrapper')) return;

  const wrapper = document.createElement('div');
  wrapper.className = 'game-search-wrapper';

  input.parentNode.insertBefore(wrapper, input);
  wrapper.appendChild(input);

  const list = document.createElement('div');
  list.className = 'game-search-results';
  list.hidden = true;
  wrapper.appendChild(list);

  input.autocomplete = 'off';

  let timer;
  let controller;
  let requestId = 0;

  function close() {
    list.replaceChildren();
    list.hidden = true;
  }

  input.addEventListener('input', () => {
    clearTimeout(timer);
    controller?.abort();
    close();

    const query = input.value.trim();
    const currentId = ++requestId;

    if (query.length < 2) return;

    timer = setTimeout(async () => {
      controller = new AbortController();

      try {
        const response = await fetch(
          `/api/game-cover?search=${encodeURIComponent(query)}`,
          { signal: controller.signal }
        );

        if (!response.ok) {
          throw new Error('Spielsuche fehlgeschlagen');
        }

        const data = await response.json();
        if (currentId !== requestId) return;

        const suggestions = Array.isArray(data.suggestions)
          ? data.suggestions
          : [];

        for (const game of suggestions) {
          if (typeof game.name !== 'string') continue;

          const button = document.createElement('button');
          button.type = 'button';
          button.className = 'game-search-item';

          if (
            typeof game.cover === 'string' &&
            game.cover.startsWith('https://')
          ) {
            const img = document.createElement('img');
            img.src = game.cover;
            img.alt = '';
            img.loading = 'lazy';
            button.appendChild(img);
          }

          const text = document.createElement('span');
          text.textContent = game.name;
          button.appendChild(text);

          button.addEventListener('click', () => {
            input.value = game.name;
            ++requestId;
            controller?.abort();
            close();
            input.focus();
          });

          list.appendChild(button);
        }

        list.hidden = list.childElementCount === 0;

      } catch (error) {
        if (error.name !== 'AbortError') {
          console.warn('IGDB-Suche:', error);
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

// VIER GROSSE LILA KATEGORIE-KACHELN

function setupCategoryTiles() {
  const sections = [
    $('pausedSection'),
    $('plannedSection'),
    $('playedSection'),
    $('abandonedSection')
  ];

  if (sections.some(section => !section)) return;

  const tileGrid = document.createElement('div');
  tileGrid.className = 'category-tile-grid';
  tileGrid.id = 'categoryTileGrid';

  sections[0].before(tileGrid);

  for (const section of sections) {
    section.remove();
  }

  const contentHost = document.createElement('div');
  contentHost.id = 'categoryContentHost';
  tileGrid.after(contentHost);

  for (const category of categoryConfig) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'category-tile';
    button.dataset.openCategory = category.id;
    button.setAttribute('aria-expanded', 'false');
    button.setAttribute(
      'aria-controls',
      `${category.id}Expanded`
    );

    button.innerHTML = `
      <span class="category-tile-icon">${category.icon}</span>
      <span class="category-tile-title">${category.title}</span>
      <span class="category-tile-bottom">
        <span>
          <b id="${category.id}TileCount">0</b> Spiele
        </span>
        <span class="category-tile-arrow">⌄</span>
      </span>
    `;

    tileGrid.appendChild(button);

    const content = document.createElement('section');
    content.className = 'category-expanded';
    content.id = `${category.id}Expanded`;
    content.hidden = true;

    content.innerHTML = `
      <h2>${category.icon} ${category.title}</h2>
      <div id="${category.id}" class="grid"></div>
    `;

    contentHost.appendChild(content);

    button.addEventListener('click', () => {
      const isOpening = content.hidden;

      for (const other of categoryConfig) {
        const otherContent = $(`${other.id}Expanded`);
        const otherButton = document.querySelector(
          `[data-open-category="${other.id}"]`
        );

        otherContent.hidden = true;
        otherButton.classList.remove('active');
        otherButton.setAttribute('aria-expanded', 'false');
      }

      if (isOpening) {
        content.hidden = false;
        button.classList.add('active');
        button.setAttribute('aria-expanded', 'true');

        loadGameCovers().catch(console.warn);

        content.scrollIntoView({
          behavior: 'smooth',
          block: 'nearest'
        });
      }
    });
  }
}

// SPIELEKARTEN MIT COVER OBERHALB DES NAMENS

function card(game, type) {
  const votes = voteCounts.get(game.id) || 0;
  const voted = userVotes.has(game.id);

  const labels = {
    suggested: 'SPIELVORSCHLAG',
    playing: 'JETZT IM STREAM',
    paused: 'PAUSIERT',
    planned: 'GEPLANT',
    played: 'GESPIELT',
    abandoned: 'ABGEBROCHEN'
  };

  return `
    <article class="game">
      <div class="game-cover-wrap game-cover-placeholder">
        <span class="game-cover-fallback" aria-hidden="true">🎮</span>
        <img
          class="game-cover"
          data-cover-title="${esc(game.title)}"
          alt="Cover von ${esc(game.title)}"
          loading="eager"
          decoding="async"
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
            💜 ${votes} ${voted ? 'Abgestimmt' : 'Stimmen'}
          </button>
        `
        : ''}
    </article>
  `;
}

// IGDB-COVER ABRUFEN

async function getGameCover(title) {
  const key = String(title || '').trim().toLowerCase();

  if (!key) return null;

  if (coverCache.has(key)) {
    return coverCache.get(key);
  }

  try {
    const response = await fetch(
      `/api/game-cover?title=${encodeURIComponent(title)}`
    );

    if (!response.ok) {
      throw new Error(`Cover-Abfrage: HTTP ${response.status}`);
    }

    const data = await response.json();

    const cover =
      typeof data.cover === 'string' &&
      /^https?:\/\//i.test(data.cover)
        ? data.cover
        : null;

    coverCache.set(key, cover);

    return cover;

  } catch (error) {
    console.warn(
      'Cover konnte nicht geladen werden:',
      title,
      error
    );

    return null;
  }
}

// COVER ZUVERLÄSSIG IN SPIELEKARTEN ANZEIGEN

async function loadGameCovers() {
  const images = [
    ...document.querySelectorAll('img[data-cover-title]')
  ];

  const titles = [
    ...new Set(
      images
        .map(img => img.dataset.coverTitle)
        .filter(Boolean)
    )
  ];

  // Cover in kleinen Gruppen abrufen.
  // Das vermeidet zu viele gleichzeitige Anfragen.
  const covers = new Map();

  for (let i = 0; i < titles.length; i += 5) {
    const batch = titles.slice(i, i + 5);

    const results = await Promise.all(
      batch.map(async title => [
        title,
        await getGameCover(title)
      ])
    );

    for (const [title, cover] of results) {
      covers.set(title, cover);
    }
  }

  for (const img of images) {
    if (!img.isConnected) continue;

    const title = img.dataset.coverTitle;
    const cover = covers.get(title);
    const wrap = img.closest('.game-cover-wrap');

    if (!cover) {
      img.removeAttribute('src');
      img.style.display = 'none';
      wrap?.classList.remove('has-cover');
      continue;
    }

    // Wichtig:
    // Das Bild wird nicht mehr mit "hidden" blockiert.
    // Es wird zunächst unsichtbar vorgeladen.
    img.style.display = 'block';
    img.style.opacity = '0';
    img.loading = 'eager';

    const showCover = () => {
      if (!img.isConnected) return;

      img.style.display = 'block';
      img.style.opacity = '1';
      wrap?.classList.add('has-cover');
    };

    const showFallback = () => {
      if (!img.isConnected) return;

      img.style.display = 'none';
      wrap?.classList.remove('has-cover');
    };

    img.onload = showCover;
    img.onerror = showFallback;

    if (img.getAttribute('src') !== cover) {
      img.src = cover;
    } else if (img.complete && img.naturalWidth > 0) {
      showCover();
    } else if (img.complete && img.naturalWidth === 0) {
      showFallback();
    }
  }
}

// SUCHEN UND SORTIEREN

function sortGames(items, sort, isSuggestion = false) {
  const result = [...items];

  if (sort === 'alphabetical') {
    result.sort((a, b) =>
      a.title.localeCompare(b.title, 'de')
    );

  } else if (sort === 'lastPlayed') {
    result.sort((a, b) => {
      const first = new Date(a.last_played_at || 0).getTime();
      const second = new Date(b.last_played_at || 0).getTime();

      return second - first;
    });

  } else if (isSuggestion) {
    result.sort((a, b) =>
      (voteCounts.get(b.id) || 0) -
      (voteCounts.get(a.id) || 0)
    );
  }

  return result;
}

function renderGames() {
  const search = ($('gameFilter')?.value || '')
    .trim()
    .toLocaleLowerCase('de');

  const sort = $('gameSort')?.value || 'newest';

  const approved = allSuggestions.filter(
    item => item.status === 'approved'
  );

  const groups = {
    suggested: approved,
    playing: allGames.filter(g => g.status === 'playing'),
    paused: allGames.filter(g => g.status === 'paused'),
    planned: allGames.filter(g => g.status === 'planned'),
    played: allGames.filter(g => g.status === 'played'),
    abandoned: allGames.filter(g => g.status === 'abandoned')
  };

  const counts = {
    suggestedCount: approved.length,
    playedCount: groups.played.length,
    plannedCount: groups.planned.length,
    suggestedCategoryCount: approved.length,
    pausedCount: groups.paused.length,
    plannedCategoryCount: groups.planned.length,
    playedCategoryCount: groups.played.length,
    abandonedCount: groups.abandoned.length
  };

  for (const [id, value] of Object.entries(counts)) {
    if ($(id)) $(id).textContent = value;
  }

  for (const category of categoryConfig) {
    const counter = $(`${category.id}TileCount`);

    if (counter) {
      counter.textContent = groups[category.id].length;
    }
  }

  for (const [id, items] of Object.entries(groups)) {
    const target = $(id);
    if (!target) continue;

    const filtered = items.filter(game => {
      const text = `${game.title || ''} ${game.description || ''}`
        .toLocaleLowerCase('de');

      return text.includes(search);
    });

    const sorted = sortGames(
      filtered,
      sort,
      id === 'suggested'
    );

    target.innerHTML = sorted.length
      ? sorted.map(game => card(game, id)).join('')
      : empty(
          search
            ? 'Keine passenden Spiele gefunden.'
            : 'Hier ist noch Platz für neue Abenteuer 🎮'
        );
  }

  setupVoteButtons();
  loadGameCovers().catch(console.warn);
}

// TWITCH-LOGIN

async function login() {
  check(await db.auth.signInWithOAuth({
    provider: 'twitch',
    options: {
      redirectTo: window.location.origin + window.location.pathname
    }
  }));
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
    admin = check(
      await db.rpc('is_gamehub_admin')
    ) === true;
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
          check(await db.from('votes')
            .delete()
            .eq('suggestion_id', id)
            .eq('user_id', user.id));

        } else {
          check(await db.from('votes').insert({
            suggestion_id: id,
            user_id: user.id
          }));
        }

        await load();

      } catch (error) {
        notice(error.message);
        button.disabled = false;
      }
    };
  });
}

// SPIELWECHSEL-DIALOG

async function askPreviousGameStatus(previousGame) {
  return new Promise(resolve => {
    const overlay = document.createElement('div');
    overlay.className = 'game-switch-overlay';

    overlay.innerHTML = `
      <div class="game-switch-dialog"
           role="dialog"
           aria-modal="true"
           aria-labelledby="switchTitle">

        <h2 id="switchTitle">🎮 Spielwechsel</h2>

        <p>
          Du spielst gerade
          <strong>${esc(previousGame.title)}</strong>.
        </p>

        <p>Wohin soll dieses Spiel verschoben werden?</p>

        <select id="switchPreviousStatus">
          <option value="paused">⏸️ Pausiert</option>
          <option value="played">✅ Gespielt</option>
          <option value="planned">🚀 Geplant</option>
          <option value="abandoned">❌ Abgebrochen</option>
        </select>

        <div class="game-switch-actions">
          <button type="button"
                  id="switchCancel"
                  class="secondary">
            Abbrechen
          </button>

          <button type="button"
                  id="switchConfirm"
                  class="primary">
            Spiel wechseln
          </button>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);

    const select = overlay.querySelector('#switchPreviousStatus');

    function finish(value) {
      overlay.remove();
      resolve(value);
    }

    overlay.querySelector('#switchCancel').onclick =
      () => finish(null);

    overlay.querySelector('#switchConfirm').onclick =
      () => finish(select.value);

    overlay.addEventListener('keydown', event => {
      if (event.key === 'Escape') finish(null);
    });

    select.focus();
  });
}

async function movePreviousGames(previousGames, previousStatus) {
  const changed = [];

  try {
    for (const previous of previousGames) {
      check(await db.from('games')
        .update({ status: previousStatus })
        .eq('id', previous.id));

      changed.push(previous);
    }

    return changed;

  } catch (error) {
    for (const previous of changed) {
      const result = await db.from('games')
        .update({ status: 'playing' })
        .eq('id', previous.id);

      if (result.error) {
        console.error(
          'Wiederherstellung fehlgeschlagen:',
          result.error
        );
      }
    }

    throw error;
  }
}

async function restorePreviousGames(previousGames) {
  for (const previous of previousGames) {
    const result = await db.from('games')
      .update({ status: 'playing' })
      .eq('id', previous.id);

    if (result.error) {
      console.error(
        'Wiederherstellung fehlgeschlagen:',
        result.error
      );
    }
  }
}

async function changeGameStatus(id, status) {
  const game = allGames.find(item => item.id === id);
  if (!game) throw new Error('Spiel nicht gefunden.');

  const update = { status };

  if (status === 'abandoned') {
    const reason = prompt(
      'Warum wurde das Spiel abgebrochen? (optional)',
      game.description || ''
    );

    if (reason === null) return false;
    update.description = reason.trim();
  }

  if (status === 'playing' && game.status !== 'playing') {
    const previousGames = allGames.filter(
      item => item.status === 'playing' && item.id !== id
    );

    let previousStatus = 'paused';

    if (previousGames.length) {
      previousStatus = await askPreviousGameStatus(
        previousGames[0]
      );

      if (previousStatus === null) return false;
    }

    const changed = await movePreviousGames(
      previousGames,
      previousStatus
    );

    try {
      check(await db.from('games')
        .update({
          status: 'playing',
          last_played_at: new Date().toISOString()
        })
        .eq('id', id));

    } catch (error) {
      await restorePreviousGames(changed);
      throw error;
    }

    return true;
  }

  check(await db.from('games')
    .update(update)
    .eq('id', id));

  return true;
}

// ADMIN-BEREICH

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
            <button data-suggestion="${suggestion.id}"
                    data-sstatus="approved">
              Freigeben
            </button>

            <button data-suggestion="${suggestion.id}"
                    data-sstatus="rejected">
              Ablehnen
            </button>

            <button data-suggestion="${suggestion.id}"
                    data-sstatus="pending">
              Zurückstellen
            </button>

            <button class="danger"
                    data-sdelete="${suggestion.id}">
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
            <small>(${esc(statusLabel(game.status))})</small>
          </span>

          <div>
            <button data-game="${game.id}"
                    data-gstatus="playing">
              🟢 Aktuell
            </button>

            <button data-game="${game.id}"
                    data-gstatus="paused">
              ⏸️ Pausiert
            </button>

            <button data-game="${game.id}"
                    data-gstatus="planned">
              🚀 Geplant
            </button>

            <button data-game="${game.id}"
                    data-gstatus="played">
              ✅ Gespielt
            </button>

            <button data-game="${game.id}"
                    data-gstatus="abandoned">
              ❌ Abgebrochen
            </button>

            <button class="danger"
                    data-gdelete="${game.id}">
              Löschen
            </button>
          </div>
        </div>
      `).join('')
    : empty();

  document.querySelectorAll('[data-sstatus]').forEach(button => {
    button.onclick = async () => {
      try {
        check(await db.from('suggestions')
          .update({ status: button.dataset.sstatus })
          .eq('id', Number(button.dataset.suggestion)));

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
        check(await db.from('suggestions')
          .delete()
          .eq('id', Number(button.dataset.sdelete)));

        await load();
      } catch (error) {
        notice(error.message);
      }
    };
  });

  document.querySelectorAll('[data-gstatus]').forEach(button => {
    button.onclick = async () => {
      button.disabled = true;

      try {
        const changed = await changeGameStatus(
          Number(button.dataset.game),
          button.dataset.gstatus
        );

        if (changed) {
          notice('Spielstatus aktualisiert! 💜');
          await load();
        }

      } catch (error) {
        notice(error.message);

      } finally {
        button.disabled = false;
      }
    };
  });

  document.querySelectorAll('[data-gdelete]').forEach(button => {
    button.onclick = async () => {
      if (!confirm('Spiel wirklich löschen?')) return;

      try {
        check(await db.from('games')
          .delete()
          .eq('id', Number(button.dataset.gdelete)));

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
      .select('id,title,description,status,created_at,last_played_at')
      .order('created_at', { ascending: false }),

    db.from('suggestions')
      .select('id,title,description,status,user_id,created_at')
      .order('created_at', { ascending: false })
  ]);

  allGames = check(gamesResult) || [];
  allSuggestions = check(suggestionsResult) || [];

  const approvedIds = allSuggestions
    .filter(item => item.status === 'approved')
    .map(item => item.id);

  let votes = [];

  if (approvedIds.length) {
    votes = check(await db.from('votes')
      .select('suggestion_id,user_id')
      .in('suggestion_id', approvedIds)) || [];
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

  renderGames();
  setupAdmin();
}

// SPIELVORSCHLAG EINREICHEN

$('suggestForm')?.addEventListener('submit', async event => {
  event.preventDefault();

  if (!user) {
    notice('Bitte zuerst mit Twitch anmelden.');
    return;
  }

  try {
    check(await db.from('suggestions').insert({
      title: $('title').value.trim(),
      description: $('description').value.trim(),
      user_id: user.id
    }));

    event.target.reset();
    notice('Dein Vorschlag wartet auf Freigabe! 💜');
    await load();

  } catch (error) {
    notice(error.message);
  }
});

// ADMIN: NEUES SPIEL HINZUFÜGEN

$('gameForm')?.addEventListener('submit', async event => {
  event.preventDefault();

  if (!admin) return;

  const title = $('gameTitle').value.trim();
  const description = $('gameDescription').value.trim();
  const status = $('gameStatus').value;

  if (!title) return;

  try {
    let previousGames = [];
    let previousStatus = 'paused';

    if (status === 'playing') {
      previousGames = allGames.filter(
        game => game.status === 'playing'
      );

      if (previousGames.length) {
        previousStatus = await askPreviousGameStatus(
          previousGames[0]
        );

        if (previousStatus === null) return;
      }
    }

    const changed = await movePreviousGames(
      previousGames,
      previousStatus
    );

    try {
      const newGame = {
        title,
        description,
        status
      };

      if (status === 'playing') {
        newGame.last_played_at = new Date().toISOString();
      }

      check(await db.from('games').insert(newGame));

    } catch (error) {
      await restorePreviousGames(changed);
      throw error;
    }

    event.target.reset();
    notice('Spiel hinzugefügt! 💜');
    await load();

  } catch (error) {
    notice(error.message);
  }
});

// START

(async () => {
  setupCategoryTiles();

  // Vorschlagsliste immer aufklappen
  const suggestedSection = $('suggestedSection');
  if (suggestedSection?.tagName === 'DETAILS') {
    suggestedSection.open = true;
  }

  setupGameSearch('title');
  setupGameSearch('gameTitle');

  $('gameFilter')?.addEventListener('input', renderGames);
  $('gameSort')?.addEventListener('change', renderGames);

  if (
    !SUPABASE_PUBLISHABLE_KEY ||
    SUPABASE_PUBLISHABLE_KEY.startsWith('HIER_')
  ) {
    notice('Bitte Supabase in public/config.js konfigurieren.');
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
