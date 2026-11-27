#!/usr/bin/env node
// Datenpruefung: haelt personenbezogene und interne Daten aus dem oeffentlichen Repo.
//
// Wird vom pre-commit-, commit-msg- und pre-push-Hook (.githooks/) und von der
// GitHub-Action (.github/workflows/datenpruefung.yml) aufgerufen. Regel und
// Platzhalter-Konvention: CLAUDE.md und docs/entwicklung.md, Abschnitt 11.
//
// Aufrufe:
//   --gestaged             gestagter Inhalt aller gestagten Dateien (pre-commit)
//   --nachricht <datei>    eine Commit-Nachricht (commit-msg)
//   --baum [rev]           alle Dateien eines Stands, Standard HEAD
//   --bereich <rev...>     jede hinzugefuegte Zeile und jede Commit-Nachricht
//                          der Commits, die `git rev-list <rev...>` liefert
//   --dateien <datei...>   Dateien im Arbeitsverzeichnis
//
// Sperrliste: bekannte echte Werte, eine Zeile je Wert, liegt AUSSERHALB des
// Repos. Pfad aus DATEN_SPERRLISTE_DATEI, sonst ../repo-sperrliste.txt neben
// dem Repo. Fehlt sie, bricht die Pruefung ab — es sei denn,
// DATENPRUEFUNG_OHNE_SPERRLISTE=1 ist ausdruecklich gesetzt (dann laufen nur
// die Musterpruefungen).
//
// Fail closed: jeder Fehler (Git, Datei, Sperrliste) ergibt Exit-Code 2,
// jeder Fund Exit-Code 1. Nur ein sauberer Lauf ergibt 0.

import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';

const IN_CI = !!(process.env.CI || process.env.GITHUB_ACTIONS);

function git(args, opts = {}) {
  return execFileSync('git', args, { encoding: 'buffer', maxBuffer: 1 << 30, ...opts });
}

// ---------- Regeln ----------

const ERLAUBTE_ADRESSEN = new Set(['noreply@anthropic.com', 'noreply@github.com']);
const ERLAUBTE_DOMAINS = new Set(['example.com', 'example.org', 'example.net']);
const RESERVIERTE_ENDUNGEN = ['.example', '.test', '.invalid', '.localhost'];

function emailErlaubt(adresse) {
  const a = adresse.toLowerCase();
  if (ERLAUBTE_ADRESSEN.has(a)) return true;
  const domain = a.slice(a.lastIndexOf('@') + 1);
  if (ERLAUBTE_DOMAINS.has(domain)) return true;
  if (domain.endsWith('.users.noreply.github.com') || domain === 'users.noreply.github.com') return true;
  return RESERVIERTE_ENDUNGEN.some((e) => domain === e.slice(1) || domain.endsWith(e));
}

// Platzhalter fuer lange Zahlen: hoechstens drei verschiedene Ziffern
// (111000111, 2222222222222222) oder eine 9 mit mindestens sechs Nullen
// dahinter (900000000001, 90000000000007278). Dazu die z-index-Werte knapp
// unter 2^31.
function zahlErlaubt(z) {
  if (new Set(z).size <= 3) return true;
  if (/^90{6,}\d*$/.test(z)) return true;
  if (z.length === 10 && Number(z) >= 2147483000 && Number(z) <= 2147483647) return true;
  return false;
}

const MUSTER = [
  {
    name: 'E-Mail-Adresse ausserhalb reservierter Domains',
    re: /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g,
    pruefe: (m) => !emailErlaubt(m),
  },
  {
    name: 'Lange Zahl (moegliche Thread-, Benutzer-, Bild-, Seiten- oder ClickUp-ID)',
    re: /(?<![\d.])\d{9,}(?!\d)/g,
    pruefe: (m) => !zahlErlaubt(m),
  },
  {
    name: 'ClickUp-artige Task-ID',
    re: /(?<![A-Za-z0-9_#\/-])\d[0-9a-z]{6,11}(?![A-Za-z0-9_])/g,
    pruefe: (m) => /[g-z]/.test(m)
      && (m.match(/\d/g) || []).length >= 2 && (m.match(/[a-z]/g) || []).length >= 2
      && !/^\d+(?:px|vh|vw|em|rem|ms|min|sec|s|h|m|d|kb|mb|gb)$/.test(m)
      && !/^\d+x\d+$/.test(m),
  },
  { name: 'Token (UpPromote/Stripe-Form pk_/sk_)', re: /\b[ps]k_(?:live_|test_)?[A-Za-z0-9_]{16,}/g },
  { name: 'Token (Shopify shpat_/shpss_)', re: /\bshp(?:at|ss|ca|pa)_[A-Fa-f0-9]{20,}/g },
  { name: 'Token (GitHub)', re: /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{20,})/g },
  { name: 'Token (Meta EAA…)', re: /\bEAA[A-Za-z0-9]{30,}/g },
  { name: 'Token (Slack)', re: /\bxox[abposr]-[A-Za-z0-9-]{10,}/g },
  { name: 'Schluessel (AWS)', re: /\bAKIA[0-9A-Z]{16}\b/g },
  { name: 'Privater Schluessel', re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/g },
  { name: 'Bearer-Token', re: /\bBearer\s+[A-Za-z0-9._~+\/-]{24,}/g },
];

// ---------- Sperrliste ----------

function sperrlisteLaden(wurzel) {
  const pfad = path.resolve(process.env.DATEN_SPERRLISTE_DATEI || path.join(wurzel, '..', 'repo-sperrliste.txt'));
  if (!existsSync(pfad)) {
    if (process.env.DATENPRUEFUNG_OHNE_SPERRLISTE === '1') {
      console.error('WARNUNG: keine Sperrliste (' + pfad + ') — es laufen nur die Musterpruefungen.');
      return [];
    }
    throw new Error('Sperrliste fehlt: ' + pfad + '\n'
      + '  Anlegen (eine Zeile je echtem Wert, ausserhalb des Repos) oder DATEN_SPERRLISTE_DATEI setzen.\n'
      + '  Nur wenn es wirklich keine gibt: DATENPRUEFUNG_OHNE_SPERRLISTE=1.');
  }
  const rel = path.relative(path.resolve(wurzel), pfad);
  if (!rel.startsWith('..') && !path.isAbsolute(rel)) {
    throw new Error('Die Sperrliste liegt im Repo (' + pfad + '). Sie darf nie committet werden — nach ausserhalb verschieben.');
  }
  const werte = readFileSync(pfad, 'utf8').split(/\r?\n/).map((z) => z.trim()).filter((z) => z && !z.startsWith('#'));
  if (process.env.DATEN_SPERRLISTE_DATEI && werte.length === 0) {
    throw new Error('Sperrliste ist leer: ' + pfad);
  }
  return werte.map((w) => ({
    wert: w,
    re: new RegExp('(?<![A-Za-z0-9])' + w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?![A-Za-z0-9])', 'i'),
  }));
}

// ---------- Pruefen ----------

const maske = (w) => (IN_CI ? w.slice(0, 2) + '…(' + w.length + ' Zeichen)' : w);

function varianten(zeile) {
  const v = new Set([zeile]);
  v.add(zeile.normalize('NFKC'));
  v.add(zeile.replace(/\\(?=[_*.])/g, ''));
  v.add(zeile.normalize('NFKC').replace(/\\(?=[_*.])/g, ''));
  v.add(zeile.replace(/\\u\{([0-9A-Fa-f]+)\}/g, (_, h) => String.fromCodePoint(parseInt(h, 16))).normalize('NFKC'));
  return [...v];
}

const funde = [];
let gepruefteEinheiten = 0;

function pruefeText(text, ort, sperre) {
  gepruefteEinheiten++;
  const zeilen = text.split(/\r?\n/);
  zeilen.forEach((zeile, i) => {
    const wo = ort.zeilen ? ort.zeilen[i] : (i + 1);
    for (const regel of MUSTER) {
      for (const m of zeile.matchAll(regel.re)) {
        if (!regel.pruefe || regel.pruefe(m[0])) funde.push({ ort: ort.name, zeile: wo, regel: regel.name, wert: m[0] });
      }
    }
    for (const s of sperre) {
      if (varianten(zeile).some((v) => s.re.test(v))) {
        funde.push({ ort: ort.name, zeile: wo, regel: 'Sperrliste (bekannter echter Wert)', wert: s.wert });
      }
    }
  });
}

function gestagt(sperre) {
  const namen = git(['diff', '--cached', '--name-only', '--diff-filter=ACMR', '-z']).toString('utf8').split('\0').filter(Boolean);
  for (const n of namen) {
    const inhalt = git(['show', ':' + n]).toString('utf8');
    pruefeText(n, { name: '(Dateiname)' }, sperre);
    pruefeText(inhalt, { name: n + ' (gestagt)' }, sperre);
  }
}

function baum(rev, sperre) {
  const namen = git(['ls-tree', '-r', '--name-only', '-z', rev]).toString('utf8').split('\0').filter(Boolean);
  if (namen.length === 0) throw new Error('Stand ' + rev + ' enthaelt keine Dateien');
  for (const n of namen) {
    pruefeText(n, { name: '(Dateiname)' }, sperre);
    pruefeText(git(['show', rev + ':' + n]).toString('utf8'), { name: rev + ':' + n }, sperre);
  }
}

function bereich(revs, sperre) {
  const liste = git(['rev-list', ...revs]).toString('utf8').split('\n').filter(Boolean);
  for (const c of liste) {
    const kurz = c.slice(0, 10);
    const nachricht = git(['log', '-1', '--format=%B', c]).toString('utf8');
    pruefeText(nachricht, { name: kurz + ' (Commit-Nachricht)' }, sperre);
    const diff = git(['show', '-m', '--first-parent', '--format=', '--unified=0', '--no-color',
      '--no-ext-diff', '--no-textconv', '--no-renames', c]).toString('utf8');
    let datei = '?';
    const zeilen = []; const nummern = [];
    const abschliessen = () => {
      if (zeilen.length) pruefeText(zeilen.join('\n'), { name: kurz + ':' + datei, zeilen: nummern.slice() }, sperre);
      zeilen.length = 0; nummern.length = 0;
    };
    let nr = 0;
    for (const z of diff.split('\n')) {
      if (z.startsWith('+++ ')) { abschliessen(); datei = z.replace(/^\+\+\+ (b\/)?/, ''); pruefeText(datei, { name: kurz + ' (Dateiname)' }, sperre); continue; }
      if (z.startsWith('--- ') || z.startsWith('diff --git') || z.startsWith('index ')) continue;
      if (/^Binary files .* differ$/.test(z)) {
        funde.push({ ort: kurz, zeile: 0, regel: 'Binaerdatei kann nicht geprueft werden', wert: z.slice(13, 80) });
        continue;
      }
      const kopf = z.match(/^@@ -\d+(?:,\d+)? \+(\d+)/);
      if (kopf) { nr = Number(kopf[1]); continue; }
      if (z.startsWith('+')) { zeilen.push(z.slice(1)); nummern.push(nr++); }
    }
    abschliessen();
  }
  return liste.length;
}

function hauptprogramm() {
  const args = process.argv.slice(2);
  const modus = args[0];
  const wurzel = git(['rev-parse', '--show-toplevel']).toString('utf8').trim();
  const sperre = sperrlisteLaden(wurzel);
  if (modus === '--gestaged') gestagt(sperre);
  else if (modus === '--nachricht') {
    if (!args[1]) throw new Error('--nachricht braucht eine Datei');
    const text = readFileSync(args[1], 'utf8').split(/\r?\n/).filter((z) => !z.startsWith('#')).join('\n');
    pruefeText(text, { name: 'Commit-Nachricht' }, sperre);
  } else if (modus === '--baum') baum(args[1] || 'HEAD', sperre);
  else if (modus === '--bereich') {
    if (args.length < 2) throw new Error('--bereich braucht Revisionen');
    const n = bereich(args.slice(1), sperre);
    console.error('Datenpruefung: ' + n + ' Commit(s) geprueft.');
  } else if (modus === '--dateien') {
    for (const d of args.slice(1)) pruefeText(readFileSync(d, 'utf8'), { name: d }, sperre);
  } else {
    throw new Error('Unbekannter Aufruf. Siehe Kopf von tools/datenpruefung.mjs.');
  }

  if (funde.length) {
    console.error('\nDATENPRUEFUNG: ' + funde.length + ' Fund(e) — nichts davon gehoert in dieses oeffentliche Repo.\n');
    for (const f of funde.slice(0, 200)) console.error('  ' + f.ort + ':' + f.zeile + '  ' + f.regel + ': ' + maske(f.wert));
    if (funde.length > 200) console.error('  … und ' + (funde.length - 200) + ' weitere');
    console.error('\nEchte Werte durch erfundene Platzhalter ersetzen (Konvention: docs/entwicklung.md, Abschnitt 11).');
    process.exit(1);
  }
  console.error('Datenpruefung: sauber (' + gepruefteEinheiten + ' Textteile, Sperrliste: ' + sperre.length + ' Werte).');
}

try {
  hauptprogramm();
} catch (e) {
  console.error('DATENPRUEFUNG ABGEBROCHEN (fail closed): ' + (e && e.message ? e.message : e));
  process.exit(2);
}
