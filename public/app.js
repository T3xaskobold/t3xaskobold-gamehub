
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from './config.js';

const $ = id => document.getElementById(id);

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;'
}[c]));

let db;
let user = null;
let admin = false;

const coverCache = new Map();

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

function check({ error }) {
  if (error) throw error;
}

function empty() {
  return '<div class="empty">Hier ist noch Platz für neue Abenteuer 🎮</div>';
}

// INTELLIGENTE SPIELSUCHE FÜR COMMUNITY UND ADMIN

function setupGameSearch(inputId) {
  const input = $(inputId);
  if (!input) return;

  const wrapper = document.createElement('div');
  wrapper.className = 'game-search-wrapper';

  input.parentNode.insertBefore(wrapper, input);
  wrapper.appendChild(input);

  const list = document.createElement('div');
  list.className = 'game-search-results';
  list.setAttribute('role', 'listbox');
  list.setAttribute('aria-label', 'Spielvorschläge');

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

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }

        const data = await response.json();

        if (
          request !== sequence ||
          input.value.trim() !== query
        ) return;

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

        input.setAttribute(
          'aria-expanded',
          String(!list.hidden)
        );

      } catch (error) {
        if (error.name !== 'AbortError') {
          console.warn('Spielsuche fehlgeschlagen:', error);
        }
      }
    }, 300);
  });

  input.addEventListener('keydown', event => {
    if (event.key === 'Escape') {
      close();
    }
  });

  document.addEventListener('click', event => {
    if (!wrapper.contains(event.target)) {
      close();
    }
  });

  close();
}

setupGameSearch('title');
setupGameSearch('gameTitle');

// KATEGORIE: ABGEBROCHENE GAMES

function ensureAbandonedSection() {
  if ($('abandoned')) return;

  const played = $('played');
  if (!played) return;

  const section = document.createElement('section');
  section.id = 'abandonedSection';

  section.innerHTML = `
    <h2>
      ❌ Abgebrochene Games
      <span id="abandonedCount">0</span>
    </h2>
    <div id="abandoned" class="grid"></div>
  `;

  const adminSection = $('adminSection');

  if (adminSection?.parentElement) {
    adminSection.before(section);
  } else {
    played.parentElement.after(section);
  }
}

// SPIELEKARTEN MIT AUTOMATISCHEN COVERN

function card(g, type, counts, voted) {
  const n = counts.get(g.id) || 0;

  const label = {
    suggested: 'SPIELVORSCHLAG',
    planned: 'DEMNÄCHST',
    played: 'GESPIELT',
    abandoned: 'ABGEBROCHEN'
  }[type] || 'GAME';

  return `
    <article class="game">
      <div class="game-cover-wrap" style="display:none">
        <img
          class="game-cover"
          data-cover-title="${esc(g.title)}"
          alt="Cover von ${esc(g.title)}"
          loading="eager"
          style="display:none"
        >
      </div>

      <div class="eyebrow">${label}</div>

      <h3>${esc(g.title)}</h3>

      ${g.description
        ? `<p>${esc(g.description)}</p>`
        : ''}

      ${type === 'suggested'
        ? `
          <button
            class="vote ${voted.has(g.id) ? 'active' : ''}"
            data-vote="${g.id}"
          >
            💜 ${n} ${voted.has(g.id) ? 'Abgestimmt' : 'Stimmen'}
          </button>
        `
        : ''}
    </article>
  `;
}

// COVER ÜBER UNSERE API LADEN

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
      throw new Error(`Cover-API: HTTP ${response.status}`);
    }

    const data = await response.json();

    const cover =
      typeof data.cover === 'string' &&
      data.cover.startsWith('https://')
        ? data.cover
        : null;

    if (cover) {
      coverCache.set(key, cover);
    }

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

async function loadGameCovers() {
  const images = [
    ...document.querySelectorAll('img[data-cover-title]')
  ];

  const titles = [
    ...new Set(
      images.map(img => img.dataset.coverTitle)
    )
  ];

  const results = await Promise.all(
    titles.map(async title => [
      title,
      await getGameCover(title)
    ])
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

      if (wrap) {
        wrap.style.display = 'block';
      }
    };

    img.onerror = () => {
      img.style.display = 'none';

      if (wrap) {
        wrap.style.display = 'none';
      }
    };

    img.src = cover;

    if (img.complete && img.naturalWidth > 0) {
      img.onload();
    }
  }
}

// TWITCH LOGIN

async function login() {
  const { error } = await db.auth.signInWithOAuth({
    provider: 'twitch',
    options: {
      redirectTo:
        window.location.origin + window.location.pathname
    }
  });

  check({ error });
}

async function refreshAuth() {
  const {
    data: { user: u },
    error
  } = await db.auth.getUser();

  if (error && error.name !== 'AuthSessionMissingError') {
    throw error;
  }

  user = u || null;
  admin = false;

  if (user) {
    const result = await db.rpc('is_gamehub_admin');

    check(result);

    admin = result.data === true;
  }

  $('account').replaceChildren();

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

    const btn = document.createElement('button');

    btn.className = 'secondary';
    btn.textContent = 'Logout';

    btn.onclick = async () => {
      try {
        check(await db.auth.signOut());

        await refreshAuth();
        await load();

      } catch (e) {
        notice(e.message);
      }
    };

    $('account').append(name, btn);

  } else {
    const btn = document.createElement('button');

    btn.className = 'primary';
    btn.textContent = 'Mit Twitch anmelden';

    btn.onclick = () => {
      login().catch(e => notice(e.message));
    };

    $('account').append(btn);
  }

  $('adminSection').classList.toggle('hidden', !admin);
}

// SPIELE UND VORSCHLÄGE LADEN

async function load() {
  ensureAbandonedSection();

  const [gr, sr] = await Promise.all([
    db.from('games')
      .select('id,title,description,status')
      .order('created_at', { ascending: false }),

    db.from('suggestions')
      .select('id,title,description,status,user_id')
      .order('created_at', { ascending: false })
  ]);

  check(gr);
  check(sr);

  const games = gr.data || [];
  const suggestions = sr.data || [];

  const approved = suggestions.filter(
    s => s.status === 'approved'
  );

  const ids = approved.map(s => s.id);

  let votes = [];

  if (ids.length) {
    const vr = await db.from('votes')
      .select('suggestion_id,user_id')
      .in('suggestion_id', ids);

    check(vr);

    votes = vr.data || [];
  }

  const counts = new Map();
  const voted = new Set();

  for (const v of votes) {
    counts.set(
      v.suggestion_id,
      (counts.get(v.suggestion_id) || 0) + 1
    );

    if (user && v.user_id === user.id) {
      voted.add(v.suggestion_id);
    }
  }

  const planned = games.filter(
    g => g.status === 'planned' || g.status === 'playing'
  );

  const played = games.filter(
    g => g.status === 'played'
  );

  const abandoned = games.filter(
    g => g.status === 'abandoned'
  );

  for (const [id, items, type] of [
    ['suggested', approved, 'suggested'],
    ['planned', planned, 'planned'],
    ['played', played, 'played'],
    ['abandoned', abandoned, 'abandoned']
  ]) {
    const count = $(id + 'Count');
    const target = $(id);

    if (!target) continue;

    if (count) {
      count.textContent = items.length;
    }

    target.innerHTML = items.length
      ? items.map(g => card(g, type, counts, voted)).join('')
      : empty();
  }

  loadGameCovers().catch(console.warn);

  // ABSTIMMUNGEN

  document.querySelectorAll('[data-vote]').forEach(b => {
    b.onclick = async () => {
      if (!user) {
        notice('Bitte zuerst mit Twitch anmelden.');
        return;
      }

      const id = Number(b.dataset.vote);

      try {
        if (voted.has(id)) {
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

      } catch (e) {
        notice(e.message);
      }
    };
  });

  // ADMIN-BEREICH

  if (admin) {
    $('adminSuggestions').innerHTML = suggestions.length
      ? suggestions.map(s => `
          <div class="adminrow">
            <span>
              <b>${esc(s.title)}</b>
              <small>(${esc(s.status)})</small>
            </span>

            <div>
              <button data-suggestion="${s.id}" data-sstatus="approved">
                Freigeben
              </button>

              <button data-suggestion="${s.id}" data-sstatus="rejected">
                Ablehnen
              </button>

              <button data-suggestion="${s.id}" data-sstatus="pending">
                Zurückstellen
              </button>

              <button class="danger" data-sdelete="${s.id}">
                Löschen
              </button>
            </div>
          </div>
        `).join('')
      : empty();

    $('adminGames').innerHTML = games.length
      ? games.map(g => `
          <div class="adminrow">
            <span>
              <b>${esc(g.title)}</b>
              <small>(${esc(g.status)})</small>
            </span>

            <div>
              <button data-game="${g.id}" data-gstatus="planned">
                Planen
              </button>

              <button data-game="${g.id}" data-gstatus="playing">
                Spiele ich
              </button>

              <button data-game="${g.id}" data-gstatus="played">
                Gespielt
              </button>

              <button data-game="${g.id}" data-gstatus="abandoned">
                ❌ Abgebrochen
              </button>

              <button class="danger" data-gdelete="${g.id}">
                Löschen
              </button>
            </div>
          </div>
        `).join('')
      : empty();

    // VORSCHLÄGE VERWALTEN

    document.querySelectorAll('[data-sstatus]').forEach(b => {
      b.onclick = async () => {
        try {
          check(
            await db.from('suggestions')
              .update({ status: b.dataset.sstatus })
              .eq('id', Number(b.dataset.suggestion))
          );

          await load();

        } catch (e) {
          notice(e.message);
        }
      };
    });

    document.querySelectorAll('[data-sdelete]').forEach(b => {
      b.onclick = async () => {
        if (!confirm('Vorschlag wirklich löschen?')) return;

        try {
          check(
            await db.from('suggestions')
              .delete()
              .eq('id', Number(b.dataset.sdelete))
          );

          await load();

        } catch (e) {
          notice(e.message);
        }
      };
    });

    // SPIELE VERWALTEN

    document.querySelectorAll('[data-gstatus]').forEach(b => {
      b.onclick = async () => {
        const id = Number(b.dataset.game);
        const status = b.dataset.gstatus;

        const game = games.find(g => g.id === id);

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

        } catch (e) {
          notice(e.message);
        }
      };
    });

    document.querySelectorAll('[data-gdelete]').forEach(b => {
      b.onclick = async () => {
        if (!confirm('Spiel wirklich löschen?')) return;

        try {
          check(
            await db.from('games')
              .delete()
              .eq('id', Number(b.dataset.gdelete))
          );

          await load();

        } catch (e) {
          notice(e.message);
        }
      };
    });
  }
}

// SPIELVORSCHLAG ABSENDEN

$('suggestForm').addEventListener('submit', async e => {
  e.preventDefault();

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

    e.target.reset();

    notice('Dein Vorschlag wartet auf Freigabe! 💜');

    await load();

  } catch (err) {
    notice(err.message);
  }
});

// ADMIN: NEUES SPIEL HINZUFÜGEN

$('gameForm').addEventListener('submit', async e => {
  e.preventDefault();

  if (!admin) return;

  try {
    check(
      await db.from('games').insert({
        title: $('gameTitle').value.trim(),
        description: $('gameDescription').value.trim(),
        status: $('gameStatus').value
      })
    );

    e.target.reset();

    notice('Spiel hinzugefügt!');

    await load();

  } catch (err) {
    notice(err.message);
  }
});

// WEBSITE STARTEN

(async () => {
  if (SUPABASE_PUBLISHABLE_KEY.startsWith('HIER_')) {
    notice(
      'Bitte zuerst den Publishable Key in public/config.js eintragen.'
    );

    $('account').textContent = 'Konfiguration fehlt';
    return;
  }

  try {
    db = createClient(
      SUPABASE_URL,
      SUPABASE_PUBLISHABLE_KEY
    );

    await refreshAuth();
    await load();

    db.auth.onAuthStateChange(() => {
      setTimeout(async () => {
        try {
          await refreshAuth();
          await load();
        } catch (e) {
          notice(e.message);
        }
      }, 0);
    });

  } catch (e) {
    notice(e.message);
  }
})();
