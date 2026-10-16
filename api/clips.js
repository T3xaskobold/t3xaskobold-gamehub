
const CHANNEL_NAME = "t3xaskobold";

export default async function handler(req, res) {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "s-maxage=300, stale-while-revalidate=600");

  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({
      error: "Methode nicht erlaubt"
    });
  }

  const clientId = process.env.TWITCH_CLIPS_CLIENT_ID;
  const clientSecret = process.env.TWITCH_CLIPS_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    console.error("Twitch-Clips-Zugangsdaten fehlen.");

    return res.status(500).json({
      error: "Twitch-Clips sind noch nicht eingerichtet."
    });
  }

  try {
    // 1. App-Zugriffstoken von Twitch anfordern
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
      console.error(
        "Twitch-Tokenfehler:",
        tokenResponse.status
      );

      return res.status(502).json({
        error: "Twitch-Anmeldung fehlgeschlagen."
      });
    }

    const tokenData = await tokenResponse.json();
    const accessToken = tokenData.access_token;

    const twitchHeaders = {
      "Client-ID": clientId,
      "Authorization": `Bearer ${accessToken}`
    };

    // 2. Twitch-Kanal anhand des Namens finden
    const userUrl = new URL(
      "https://api.twitch.tv/helix/users"
    );

    userUrl.searchParams.set("login", CHANNEL_NAME);

    const userResponse = await fetch(userUrl, {
      headers: twitchHeaders
    });

    if (!userResponse.ok) {
      throw new Error(
        `Twitch-Benutzerabfrage: ${userResponse.status}`
      );
    }

    const userData = await userResponse.json();
    const user = userData.data?.[0];

    if (!user) {
      return res.status(404).json({
        error: "Twitch-Kanal nicht gefunden."
      });
    }

    // 3. Neueste Clips des Kanals laden
    const clipsUrl = new URL(
      "https://api.twitch.tv/helix/clips"
    );

    clipsUrl.searchParams.set("broadcaster_id", user.id);
    clipsUrl.searchParams.set("first", "50");

    const clipsResponse = await fetch(clipsUrl, {
      headers: twitchHeaders
    });

    if (!clipsResponse.ok) {
      throw new Error(
        `Twitch-Clipabfrage: ${clipsResponse.status}`
      );
    }

    const clipsData = await clipsResponse.json();

    const clips = (clipsData.data || [])
      .map((clip) => ({
        id: clip.id,
        title: clip.title,
        url: clip.url,
        embed_url: clip.embed_url,
        thumbnail_url: clip.thumbnail_url,
        creator_name: clip.creator_name,
        view_count: clip.view_count,
        created_at: clip.created_at,
        duration: clip.duration,
        game_id: clip.game_id
      }))
      .sort(
        (a, b) =>
          new Date(b.created_at) - new Date(a.created_at)
      );

    return res.status(200).json({
      channel: CHANNEL_NAME,
      updated_at: new Date().toISOString(),
      clips
    });

  } catch (error) {
    console.error("Fehler beim Laden der Twitch-Clips:", error);

    return res.status(502).json({
      error: "Die Twitch-Clips konnten nicht geladen werden."
    });
  }
}
