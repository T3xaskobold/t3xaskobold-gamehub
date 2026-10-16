
export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  if (req.method !== "GET") {
    return res.status(405).json({
      error: "Methode nicht erlaubt"
    });
  }

  const clientId = process.env.TWITCH_CLIPS_CLIENT_ID;
  const clientSecret = process.env.TWITCH_CLIPS_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    return res.status(500).json({
      error: "Twitch-Zugangsdaten fehlen"
    });
  }

  try {
    const tokenResponse = await fetch(
      "https://id.twitch.tv/oauth2/token",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded"
        },
        body: new URLSearchParams({
          client_id: clientId,
          client_secret: clientSecret,
          grant_type: "client_credentials"
        })
      }
    );

    if (!tokenResponse.ok) {
      throw new Error("Twitch-Anmeldung fehlgeschlagen");
    }

    const tokenData = await tokenResponse.json();

    const streamResponse = await fetch(
      "https://api.twitch.tv/helix/streams?user_login=t3xaskobold",
      {
        headers: {
          "Client-ID": clientId,
          Authorization: "Bearer " + tokenData.access_token
        }
      }
    );

    if (!streamResponse.ok) {
      throw new Error("LIVE-Status konnte nicht abgerufen werden");
    }

    const streamData = await streamResponse.json();
    const stream = streamData.data?.[0] || null;

    return res.status(200).json({
      live: Boolean(stream),
      title: stream?.title || null,
      game: stream?.game_name || null
    });

  } catch (error) {
    return res.status(502).json({
      error: "Twitch-LIVE-Status momentan nicht verfügbar"
    });
  }
}
