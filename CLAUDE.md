# Regeln für dieses Repository

## Öffentlich — und deshalb ohne echte Daten

Dieses Repo ist **absichtlich öffentlich**: Tampermonkey holt die Updates ohne
Anmeldung über `raw.githubusercontent.com`. Alles, was hier je committet wird,
ist für jeden lesbar, auch in der Historie.

**Niemals ins Repo** — weder in Code, Kommentare, Tests, Doku noch in
Commit-Nachrichten, Branch- oder Tag-Namen:

- personenbezogene Daten: Instagram-Handles, Namen, Anzeigenamen,
  E-Mail-Adressen, Instagram-Thread-, Benutzer- und Bild-IDs
- interne Kennungen: ClickUp-Workspace-, Space-, Listen- und Task-IDs,
  Meta-Werbekonto-, Business- und Seiten-IDs
- Token, Schlüssel, Passwörter und sonstige Geheimnisse

Tests und Doku verwenden **nur erfundene Werte** nach der
Platzhalter-Konvention in [`docs/entwicklung.md`](docs/entwicklung.md#11-regeln-für-zugangsdaten-und-daten),
Abschnitt 11. Kurz: lange Zahlen als `9` mit mindestens sechs Nullen
(`900000000001`) oder aus höchstens drei verschiedenen Ziffern (`111000111`),
E-Mail-Adressen nur unter `example.com/.org/.net`, `*.test`, `*.example`,
`*.invalid`, Handles und Namen frei erfunden.

**Echte Vorfälle werden in Worten beschrieben**, nie mit dem echten Wert —
„ein Handle mit Unterstrichen vorne und hinten", nicht der Handle selbst.

## Wächter

- Hooks einmal pro Klon aktivieren: `git config core.hooksPath .githooks`
  (`pre-commit`: `node --check` auf jede gestagte `*.user.js` und
  Datenprüfung des gestagten Inhalts; `commit-msg` und `pre-push`: Datenprüfung).
- `tools/datenpruefung.mjs` braucht die Sperrliste echter Werte **außerhalb**
  des Repos (`../repo-sperrliste.txt` oder `DATEN_SPERRLISTE_DATEI`). Sie wird
  nie committet.
- Die GitHub-Action `Datenpruefung` prüft jeden Push und Pull Request.
- Einen Fund nie umgehen (`--no-verify`), sondern den Wert ersetzen.

## Sonst

- Doku wird im selben Commit wie die Codeänderung aktualisiert.
- Jede Änderung an einer `*.user.js` erhöht die Version an beiden Stellen
  (`@version` und `const VERSION`).
- Nach jedem Push die ausgelieferte Rohdatei prüfen — die ausgelieferte Datei
  ist die Wahrheit (`docs/entwicklung.md`, Abschnitt 10).
