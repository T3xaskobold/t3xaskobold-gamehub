
module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({
      error: 'Methode nicht erlaubt'
    });
  }

  const title = String(req.query.title || '').trim();

  if (!title || title.length > 150) {
    return res.status(400).json({
      error: 'Ungültiger Spielname'
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
        'Twitch Token Fehler:',
        tokenResponse.status
      );

      return res.status(502).json({
        error: 'Twitch-Zugriff fehlgeschlagen'
      });
    }

    const tokenData = await tokenResponse.json();
    const accessToken = tokenData.access_token;

    if (!accessToken) {
      throw new Error('Kein Twitch-Zugriffstoken erhalten');
    }

    const safeTitle = title
      .replace(/["\\]/g, ' ')
      .replace(/[;\r\n]/g, ' ');

    const gameResponse = await fetch(
      'https://api.igdb.com/v4/games',
      {
        method: 'POST',
        headers: {
          'Client-ID': clientId,
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'text/plain'
        },
        body: `search "${safeTitle}"; fields name,cover.image_id; limit 10;`
      }
    );

    if (!gameResponse.ok) {
      console.error(
        'IGDB Fehler:',
        gameResponse.status
      );

      return res.status(502).json({
        error: 'IGDB-Suche fehlgeschlagen'
      });
    }

    const games = await gameResponse.json();
    const normalizedTitle = title.toLocaleLowerCase();

    const match =
      games.find(game =>
        game.name?.toLocaleLowerCase() === normalizedTitle &&
        game.cover?.image_id
      ) ||
      games.find(game => game.cover?.image_id);

    const cover = match?.cover?.image_id
      ? `https://images.igdb.com/igdb/image/upload/t_cover_big/${match.cover.image_id}.jpg`
      : null;

    res.setHeader(
      'Cache-Control',
      's-maxage=86400, stale-while-revalidate=604800'
    );

    return res.status(200).json({
      cover
    });

  } catch (error) {
    console.error('Cover-Suche:', error);

    return res.status(502).json({
      error: 'Cover konnte nicht geladen werden'
    });
  }
};
