#!/usr/bin/env node
/**
 * Hourly latency bench — idea 10 from the "stay on InferHub" brainstorm.
 *
 * Measures the availability and latency of each model in the chain, and
 * updates `docs/LATENCE.md` (timestamped table + 24 h summary).
 *
 * Why: the upstream is a marketplace. Latency varies by a factor of 3 between
 * the evening and 1 p.m., and 5 models out of 6 can be in 503 at the same
 * moment. Without automatic readings, we would pick the filming time by
 * intuition — and could not prove availability during judging (RNF-08).
 *
 * Usage:
 *   INFERHUB_API_KEY=… node scripts/sonder-latence.mjs
 *   node scripts/sonder-latence.mjs --modeles a,b --timeout-ms 90000 --sortie docs/LATENCE.md
 *   node scripts/sonder-latence.mjs --seche     # writes nothing (useful without a key)
 *
 * Without a key, the script warns and exits 0: it must never break CI.
 */
import { readFile, writeFile } from 'node:fs/promises'
import { argv, env, exit } from 'node:process'

const CHAINE = [
  'ag/gemini-4-carbon',
  'ag/claude-sonnet-4-6',
  'ag/gemini-4-argon',
  'ag/claude-sonnet-5-5',
  'ag/gemini-3.8-flash-high',
  'zai/glm-4.6v',
  'ag/claude-opus-4-6-thinking',
]

const AMONT = 'https://api.inferhub.dev/v1'
const LIGNES_MAX = 300

function argument(nom, defaut) {
  const index = argv.indexOf(`--${nom}`)
  return index >= 0 && argv[index + 1] ? argv[index + 1] : defaut
}

function drapeaux() {
  return {
    seche: argv.includes('--seche'),
    modeles: String(argument('modeles', '')).split(',').filter(Boolean),
    timeoutMs: Number(argument('timeout-ms', '90000')),
    sortie: String(argument('sortie', 'docs/LATENCE.md')),
  }
}

/** A minimal text call: 5 tokens are enough to measure availability. */
async function sonder(modele, cle, timeoutMs) {
  const debut = Date.now()
  const controleur = new AbortController()
  const minuteur = setTimeout(() => controleur.abort(), timeoutMs)
  try {
    const reponse = await fetch(`${AMONT}/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${cle}`,
      },
      body: JSON.stringify({
        model: modele,
        messages: [{ role: 'user', content: 'OK' }],
        max_tokens: 5,
      }),
      signal: controleur.signal,
    })
    const secondes = ((Date.now() - debut) / 1000).toFixed(1)
    if (reponse.ok) {
      const data = await reponse.json().catch(() => ({}))
      const texte = data?.choices?.[0]?.message?.content ?? ''
      return { statut: reponse.status, secondes, dispo: texte.trim().length > 0 }
    }
    const corps = (await reponse.text().catch(() => '')).slice(0, 120)
    return { statut: reponse.status, secondes, dispo: false, note: corps }
  } catch (erreur) {
    const secondes = ((Date.now() - debut) / 1000).toFixed(1)
    const timeout = erreur?.name === 'AbortError'
    return { statut: timeout ? 'timeout' : 'reseau', secondes, dispo: false }
  } finally {
    clearTimeout(minuteur)
  }
}

/** Median of a list of numbers. */
function mediane(valeurs) {
  if (valeurs.length === 0) return null
  const triees = [...valeurs].sort((a, b) => a - b)
  const milieu = Math.floor(triees.length / 2)
  return triees.length % 2 === 0 ? (triees[milieu - 1] + triees[milieu]) / 2 : triees[milieu]
}

function analyserLignes(lignes) {
  const vingtQuatreHeures = Date.now() - 24 * 3600 * 1000
  const recentes = lignes.filter((ligne) => Date.parse(ligne.horodatage) >= vingtQuatreHeures)
  const succes = recentes.filter((ligne) => ligne.dispo)
  const latences = succes.map((ligne) => Number(ligne.secondes)).filter((n) => Number.isFinite(n))
  const parModele = new Map()
  for (const ligne of recentes) {
    const total = parModele.get(ligne.modele) ?? { ok: 0, total: 0 }
    total.total += 1
    if (ligne.dispo) total.ok += 1
    parModele.set(ligne.modele, total)
  }
  const classement = [...parModele.entries()]
    .filter(([, stats]) => stats.total > 0)
    .sort((a, b) => b[1].ok / b[1].total - a[1].ok / a[1].total)
  const meilleur = classement[0]
  return {
    total: recentes.length,
    taux: recentes.length === 0 ? 0 : (succes.length / recentes.length) * 100,
    mediane: mediane(latences),
    meilleur: meilleur ? `${meilleur[0]} (${Math.round((meilleur[1].ok / meilleur[1].total) * 100)}% success over 24 h)` : '—',
  }
}

function rendreFichier(lignes, synthese) {
  const entete = [
    '# Upstream latency (automatic readings)',
    '',
    'Measured by `scripts/sonder-latence.mjs`, run hourly by `.github/workflows/latence.yml`.',
    '**One second** per call, in series: we do not fire a burst, which would skew the measurement and',
    'saturate the upstream.',
    '',
    'These readings serve three purposes: choose the video filming time based on data, prove',
    'availability during judging (RNF-08), and honestly document the constraint',
    '(the upstream is a marketplace: latency varies by a factor of 3 depending on the hour).',
    '',
    '> The file is versioned on the `donnees/latence` branch: `main` is protected by a',
    '> ruleset (PR required), an automatic push there would be refused.',
    '',
    '## 24-hour summary',
    '',
    `- Measurements: **${synthese.total}**`,
    `- Availability rate: **${synthese.taux.toFixed(0)}%**`,
    `- Median latency of successful calls: **${synthese.mediane === null ? '—' : `${synthese.mediane.toFixed(1)} s`}**`,
    `- Most reliable model: **${synthese.meilleur}**`,
    '',
    '## Historique',
    '',
    '| Timestamp (UTC) | Model | HTTP | Latency | Available |',
    '| --- | --- | --- | --- | --- |',
  ]
  const corps = lignes.map(
    (ligne) =>
      `| ${ligne.horodatage} | \`${ligne.modele}\` | ${ligne.statut} | ${ligne.secondes} s | ${ligne.dispo ? 'oui' : 'non'} |`,
  )
  const annexe = [
    '',
    '## Manual readings before the automatic bench',
    '',
    '| Date | Model | Result |',
    '| --- | --- | --- |',
    '| 11/11 9 p.m. | `ag/gemini-4-carbon` | 200 in 16 s |',
    '| 11/11 9 p.m. | `ag/claude-sonnet-4-6` | 200 in 16 s, then 503 five minutes later |',
    '| 11/11 9 p.m. | `ag/gemini-3.8-flash-high` | 200 in 45-52 s |',
    '| 11/11 9 p.m. | `ag/gemini-4-argon`, `ag/claude-sonnet-5-5`, `ag/claude-opus-4-6-thinking` | 503 |',
    '| 11/11 9 p.m. | `oai/gpt-5.4-mini`, `ali/deepseek-v4.1-flash` | 402 out of auction |',
    '| 11/11 9 p.m. | `cbcn/glm-5.3-flash` | 403 disabled in account preferences |',
    '| 12/11 1 p.m. | `ag/gemini-3.8-flash-high` | 200 in 56.7 s (5 tokens) |',
    '| 12/11 1 p.m. | `ag/gemini-4-carbon` | 503 |',
    '',
  ]
  return `${[...entete, ...corps, ...annexe].join('\n')}\n`
}

async function main() {
  const options = drapeaux()
  const cle = env.INFERHUB_API_KEY ?? ''
  const modeles = options.modeles.length > 0 ? options.modeles : CHAINE

  if (!cle) {
    console.warn('INFERHUB_API_KEY missing: reading skipped (nothing is written).')
    return
  }

  const horodatage = new Date().toISOString()
  const lignes = []
  for (const modele of modeles) {
    const mesure = await sonder(modele, cle, options.timeoutMs)
    lignes.push({ horodatage, modele, ...mesure })
    console.log(`${modele} → ${mesure.statut} en ${mesure.secondes}s ${mesure.dispo ? '(dispo)' : '(indispo)'}`)
    await new Promise((resolve) => setTimeout(resolve, 500))
  }

  if (options.seche) return

  let existant = ''
  try {
    existant = await readFile(options.sortie, 'utf8')
  } catch {
    existant = ''
  }
  const dejaParsees = [...existant.matchAll(/^\| (\d{4}-\d\d-\d\dT[^ |]+) \| `([^`]+)` \| ([^|]+) \| ([^|]+) \| (oui|non) \|$/gm)].map((m) => ({
    horodatage: m[1],
    modele: m[2],
    statut: m[3].trim(),
    secondes: m[4].trim(),
    dispo: m[5] === 'oui',
  }))
  const toutes = [...dejaParsees, ...lignes].slice(-LIGNES_MAX)
  const synthese = analyserLignes(toutes)
  await writeFile(options.sortie, rendreFichier(toutes, synthese), 'utf8')
  console.log(`${options.sortie} updated (${toutes.length} lines, ${synthese.total} over 24 h)`)
}

main().catch((erreur) => {
  console.error('latency probe:', erreur?.message ?? erreur)
  exit(0)
})
