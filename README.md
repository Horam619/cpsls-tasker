# CPSLS Tasker

Aufgaben-App für CPSLS mit täglichem KI-Briefing von Gemini. Läuft auf iPhone und Mac, alle Daten gleichen sich über Firebase ab. Push-Erinnerungen kommen um 8, 11, 14, 17 und 20 Uhr, solange Aufgaben offen sind.

| Ordner / Datei | Inhalt |
|---|---|
| `site/` | Die App selbst (wird über GitHub Pages veröffentlicht) |
| `reminders/` | Skript für die Push-Erinnerungen |
| `.github/workflows/` | Veröffentlichung und stündlicher Erinnerungs-Job |
| `firestore.rules` | Zugriffsregeln: Jede Person sieht nur ihre eigenen Daten |

---

## 1 · Firebase einrichten (ca. 10 Min., kostenlos)

1. Öffne [console.firebase.google.com](https://console.firebase.google.com) → **Projekt hinzufügen** → Name `cpsls-tasker` → Google Analytics ausschalten.
2. **Build → Authentication → Get started → E-Mail/Passwort** aktivieren und speichern.
3. **Build → Firestore Database → Datenbank erstellen** → Standort `europe-west3 (Frankfurt)` → *Produktionsmodus*.
   Danach Tab **Regeln**: den Inhalt von `firestore.rules` einfügen → **Veröffentlichen**.
4. **Projekteinstellungen (Zahnrad) → Allgemein → Meine Apps → Web (`</>`)** → Name `CPSLS Tasker` → registrieren.
   (Für `cpsls-tasker` bereits erledigt und in `src/app.js` eingebaut.)
5. **Projekteinstellungen → Dienstkonten → Neuen privaten Schlüssel generieren.** Es lädt eine `.json`-Datei herunter. Die brauchst du in Schritt 2.4. Diese Datei niemandem schicken und nicht ins Repository legen.

## 2 · GitHub einrichten (ca. 5 Min., kostenlos)

1. Neues **öffentliches** Repository `cpsls-tasker` mit diesen Dateien. Öffentlich ist nötig für kostenloses GitHub Pages. Deine Aufgaben liegen nicht im Repository, sondern geschützt in Firebase.
2. **Settings → Pages → Source: GitHub Actions.**
3. **Actions → „Website veröffentlichen“ → Run workflow.** Danach ist die App erreichbar unter
   `https://<dein-github-name>.github.io/cpsls-tasker/`
4. **Settings → Secrets and variables → Actions → New repository secret**, zweimal:
   - `FIREBASE_SERVICE_ACCOUNT`: den kompletten Inhalt der `.json`-Datei aus Schritt 1.5
   - `VAPID_PRIVATE_KEY`: den privaten Push-Schlüssel (steht nicht hier, du hast ihn separat bekommen)
5. In Firebase unter **Authentication → Einstellungen → Autorisierte Domains** `<dein-github-name>.github.io` hinzufügen.

## 3 · Auf dem iPhone

1. Die App-Adresse in **Safari** öffnen → **Teilen** → **Zum Home-Bildschirm**.
2. Die App **vom Home-Bildschirm** starten.
3. **Konto erstellen** (E-Mail + Passwort).
4. **Setup** → Gemini-Schlüssel von [aistudio.google.com/apikey](https://aistudio.google.com/apikey) einfügen → **Speichern**.
5. **Setup → Erinnerungen → Auf diesem Gerät aktivieren** → Mitteilungen erlauben.
   Funktioniert ab iOS 16.4 und nur in der App auf dem Home-Bildschirm.

## 4 · Auf dem Mac

Adresse in Safari öffnen → **Ablage → Zum Dock hinzufügen** (macOS 14 oder neuer). Alternativ in Chrome über das Installieren-Symbol in der Adresszeile. Dann mit demselben Konto anmelden.

## 5 · Erinnerungen testen

**Actions → Erinnerungen → Run workflow** sendet sofort eine Testmitteilung an alle aktivierten Geräte, sofern Aufgaben offen sind.
Danach läuft der Job automatisch jede Stunde und sendet nur zu den Zeiten 8, 11, 14, 17 und 20 Uhr (Berliner Zeit). GitHub startet Zeitpläne manchmal etwas verspätet, deshalb kann eine Mitteilung bis zu einer halben Stunde später kommen.

## Optional: Fremde Anmeldungen sperren

Wenn dein Konto angelegt ist: **Firebase → Authentication → Einstellungen → Nutzeraktionen → „Erstellung (Registrierung) aktivieren“ ausschalten.** Dann kann niemand sonst ein Konto in deinem Projekt anlegen.

## Kosten

Firebase (Spark-Tarif), GitHub Pages, GitHub Actions in öffentlichen Repositories und der kostenlose Gemini-Tarif kosten nichts. Es ist keine Kreditkarte nötig.
