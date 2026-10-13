# T3xaskobold GameHub 🎮

Funktionsfähige Node.js-Web-App mit Twitch-OAuth, SQLite-Datenbank, Spielvorschlägen, einer Stimme pro Twitch-Account und Admin-Verwaltung.

## Start
1. Node.js 20+ installieren.
2. In diesem Ordner `npm install` ausführen.
3. `.env.example` nach `.env` kopieren.
4. Auf https://dev.twitch.tv/console/apps eine Twitch-Anwendung anlegen, OAuth-Redirect-URL `http://localhost:3000/auth/callback` (für lokal) registrieren und Client-ID sowie Secret in `.env` eintragen.
5. `SESSION_SECRET` auf eine lange zufällige Zeichenfolge setzen, etwa mit `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`.
6. `npm start` ausführen und http://localhost:3000 öffnen.
7. Mit dem Twitch-Konto **t3xaskobold** anmelden, um den Admin-Bereich zu sehen. Noch sicherer: `ADMIN_TWITCH_ID` auf deine Twitch-User-ID setzen.

## Online stellen
Node.js-Hosting mit dauerhaftem Datenträger verwenden. `BASE_URL` auf deine öffentliche HTTPS-Domain setzen, `NODE_ENV=production` setzen, HTTPS-Redirect-URL `https://DEINE-DOMAIN/auth/callback` in der Twitch Developer Console hinterlegen. Die Datei `gamehub.sqlite` liegt im Arbeitsverzeichnis und muss auf einem **persistenten Volume** gespeichert und gesichert werden. Der integrierte Express-Session-MemoryStore ist **nur für lokale Entwicklung** gedacht: vor öffentlichem Betrieb einen persistenten Session-Store (z. B. SQLite oder Redis) konfigurieren. Reverse-Proxy-/HTTPS-Konfiguration prüfen. Geheimnisse niemals ins öffentliche Repository hochladen.

## Hinweise
- Es sind bewusst keine Beispielspiele eingetragen.
- Vorschläge werden sofort öffentlich sichtbar. Der Admin kann sie ablehnen oder löschen. Wenn du Vorabmoderation willst, ergänze einen gesonderten `pending`-Status.
- Für produktiven Betrieb sind zusätzlich Datenschutzhinweise/Impressum nach den für dich geltenden Regeln sowie Backups und Monitoring sinnvoll.
- OAuth-State, CSRF-Token, Session-Cookies, Rate-Limit und Eingabevalidierung sind integriert.
