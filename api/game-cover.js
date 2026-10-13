
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

    const query = search || title;

    // Sonderzeichen für die IGDB-Suche bereinigen
    const safeQuery = query
      .replace(/["\\]/g, ' ')
      .replace(/[;\r\n]/g, ' ');

    // Spiele bei IGDB suchen
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
          limit 30;
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

    // Passende Cover-URL erzeugen
    const coverUrl = game =>
      game.cover?.image_id
        ? `https://images.igdb.com/igdb/image/upload/t_cover_big/${game.cover.image_id}.jpg`
        : null;

    res.setHeader(
      'Cache-Control',
      's-maxage=3600, stale-while-revalidate=86400'
    );

    // NEU: Suchvorschläge für die Eingabefelder
    if (search) {
      const normalized = search.toLocaleLowerCase();

      const suggestions = games
        .filter(game => game.name)
        .sort((a, b) => {
          const aStarts = a.name
            .toLocaleLowerCase()
            .startsWith(normalized);

          const bStarts = b.name
            .toLocaleLowerCase()
            .startsWith(normalized);

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

    // BISHER: Cover für eine vorhandene Spielekarte
    const normalizedTitle = title.toLocaleLowerCase();

    const match =
      games.find(game =>
        game.name?.toLocaleLowerCase() === normalizedTitle &&
        game.cover?.image_id
      ) ||
      games.find(game => game.cover?.image_id);

    return res.status(200).json({
      cover: match ? coverUrl(match) : null
    });

  } catch (error) {
    console.error('IGDB-Fehler:', error);

    return res.status(502).json({
      error: 'Spieldaten konnten nicht geladen werden'
    });
  }
}
