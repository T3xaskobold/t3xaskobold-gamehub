
export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({
      error: 'Methode nicht erlaubt'
    });
  }

  const title = String(req.query.title || '').trim();
  const search = String(req.query.search || '').trim();

  if (!title && !search) {
    return res.status(400).json({
      error: 'Spielname oder Suchbegriff fehlt'
    });
  }

  if (title.length > 150 || search.length > 150) {
    return res.status(400).json({
      error: 'Suchbegriff zu lang'
    });
  }

  try {
    const clientId = process.env.TWITCH_CLIENT_ID;
    const clientSecret = process.env.TWITCH_CLIENT_SECRET;

    if (!clientId || !clientSecret) {
      return res.status(500).json({
        error: 'IGDB nicht konfiguriert'
      });
    }

    // Twitch-Zugriffstoken anfordern
    const tokenResponse = await fetch(
      'https://id.twitch.tv/oauth2/token',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: new URLSearchParams({
          client_id: clientId,
          client_secret: clientSecret,
          grant_type: 'client_credentials'
        })
      }
    );

    if (!tokenResponse.ok) {
      console.error(
        'Twitch-Zugriff fehlgeschlagen:',
        tokenResponse.status
      );

      return res.status(502).json({
        error: 'Twitch-Zugriff fehlgeschlagen'
      });
    }

    const tokenData = await tokenResponse.json();
    const accessToken = tokenData.access_token;

    if (!accessToken) {
      throw new Error('Kein Twitch-Token erhalten');
    }

    // Spielnamen für IGDB sicher bereinigen
    const query = search || title;

    const safeQuery = query
      .replace(/["\\]/g, ' ')
      .replace(/[;\r\n]/g, ' ')
      .trim();

    // IGDB nach passenden Spielen fragen
    const gameResponse = await fetch(
      'https://api.igdb.com/v4/games',
      {
        method: 'POST',
        headers: {
          'Client-ID': clientId,
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'text/plain'
        },
        body: `
          search "${safeQuery}";
          fields name,cover.image_id;
          limit 50;
        `
      }
    );

    if (!gameResponse.ok) {
      console.error(
        'IGDB-Suche fehlgeschlagen:',
        gameResponse.status
      );

      return res.status(502).json({
        error: 'IGDB-Suche fehlgeschlagen'
      });
    }

    const games = await gameResponse.json();

    // Aus IGDB-Bild-ID eine Cover-Adresse erzeugen
    function coverUrl(game) {
      const imageId = game.cover?.image_id;

      if (!imageId) return null;

      return (
        'https://images.igdb.com/igdb/image/upload/' +
        `t_cover_big/${imageId}.jpg`
      );
    }

    // Namen vereinheitlichen, damit unterschiedliche
    // Schreibweisen besser verglichen werden können
    function normalize(value) {
      return String(value || '')
        .normalize('NFKD')
        .toLocaleLowerCase('de')
        .replace(/&/g, 'and')
        .replace(/[™®©]/g, '')
        .replace(/[^a-z0-9]+/g, ' ')
        .trim()
        .replace(/\s+/g, ' ');
    }

    // Übereinstimmung bewerten.
    // Ein völlig anderes Spiel darf kein Cover liefern.
    function matchScore(gameName, requestedTitle) {
      const game = normalize(gameName);
      const requested = normalize(requestedTitle);

      if (!game || !requested) return -1;

      // Exakter Titel
      if (game === requested) return 1000;

      // Beispielsweise "Skyrim" und
      // "The Elder Scrolls V: Skyrim"
      const gameWords = game.split(' ');
      const requestedWords = requested.split(' ');

      const requestedContained = requestedWords.every(
        word => gameWords.includes(word)
      );

      const gameContained = gameWords.every(
        word => requestedWords.includes(word)
      );

      if (requestedContained) {
        return 500 -
          Math.max(0, gameWords.length - requestedWords.length) * 5;
      }

      if (gameContained) {
        return 350 -
          Math.max(0, requestedWords.length - gameWords.length) * 5;
      }

      return -1;
    }

    res.setHeader(
      'Cache-Control',
      's-maxage=300, stale-while-revalidate=3600'
    );

    // AUTOMATISCHE SUCHVORSCHLÄGE BLEIBEN ERHALTEN
    if (search) {
      const normalizedSearch = normalize(search);

      const suggestions = games
        .filter(game => game.name)
        .sort((a, b) => {
          const aStarts = normalize(a.name)
            .startsWith(normalizedSearch);

          const bStarts = normalize(b.name)
            .startsWith(normalizedSearch);

          return Number(bStarts) - Number(aStarts);
        })
        .slice(0, 10)
        .map(game => ({
          id: game.id,
          name: game.name,
          cover: coverUrl(game)
        }));

      return res.status(200).json({
        suggestions
      });
    }

    // COVER FÜR VORHANDENE SPIELEKARTEN
    // Nur passende Spiele berücksichtigen
    const matches = games
      .filter(game => game.name && game.cover?.image_id)
      .map(game => ({
        game,
        score: matchScore(game.name, title)
      }))
      .filter(item => item.score > 0)
      .sort((a, b) => b.score - a.score);

    const bestMatch = matches[0]?.game || null;

    return res.status(200).json({
      cover: bestMatch ? coverUrl(bestMatch) : null
    });

  } catch (error) {
    console.error('IGDB-Fehler:', error);

    return res.status(502).json({
      error: 'Spieldaten konnten nicht geladen werden'
    });
  }
}
