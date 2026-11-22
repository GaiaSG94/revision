#!/usr/bin/env node
/**
 * Size guard (user rule of October 2026): files < 500 lines,
 * functions < 50 lines. A growing file is split up, never accepted as-is.
 *
 * Usage: node scripts/check-tokens.mjs [--strict]
 *   default: fails (exit 1) on a file > 500 lines; long functions are
 *            reported as warnings;
 *   --strict: also fails on functions > 50 lines.
 *
 * Function counting is a brace heuristic (no parser): braces written inside
 * strings skew the measurement, hence the default warning mode.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const RACINE = process.cwd()
const IGNORES = new Set(['node_modules', 'dist', '.git', '.github', 'corpus', 'coverage', '.vercel'])
const EXTENSIONS = new Set(['.ts', '.tsx', '.mjs', '.js'])
const LIMITE_FICHIER = 500
const LIMITE_FONCTION = 50
const strict = process.argv.includes('--strict')

function fichiers(dir) {
  const trouves = []
  for (const entree of readdirSync(dir)) {
    if (IGNORES.has(entree)) continue
    const chemin = join(dir, entree)
    if (statSync(chemin).isDirectory()) trouves.push(...fichiers(chemin))
    else if (EXTENSIONS.has(entree.slice(entree.lastIndexOf('.')))) trouves.push(chemin)
  }
  return trouves
}

function fonctionsLongues(lignes) {
  const longues = []
  for (let i = 0; i < lignes.length; i += 1) {
    const motif = lignes[i].match(/^\s*(?:export\s+)?(?:async\s+)?function\s+([A-Za-z0-9_$]+)/)
    if (!motif) continue
    let profondeur = 0
    let ouverte = false
    for (let j = i; j < lignes.length; j += 1) {
      for (const caractere of lignes[j]) {
        if (caractere === '{') {
          profondeur += 1
          ouverte = true
        } else if (caractere === '}') profondeur -= 1
      }
      if (ouverte && profondeur <= 0) {
        const taille = j - i + 1
        if (taille > LIMITE_FONCTION) longues.push({ nom: motif[1], ligne: i + 1, taille })
        break
      }
    }
  }
  return longues
}

const cibles = fichiers(RACINE).sort()
const tropGros = []
const longues = []

for (const chemin of cibles) {
  const lignes = readFileSync(chemin, 'utf8').split('\n')
  const relatif = relative(RACINE, chemin)
  if (lignes.length > LIMITE_FICHIER) tropGros.push({ relatif, taille: lignes.length })
  for (const fonction of fonctionsLongues(lignes)) longues.push({ ...fonction, relatif })
}

console.log(
  `${cibles.length} file(s) checked — limit ${LIMITE_FICHIER} lines/file, ${LIMITE_FONCTION} lines/function`,
)
for (const fichier of tropGros) {
  console.log(`::error::${fichier.relatif}: ${fichier.taille} lines (> ${LIMITE_FICHIER}) — split it`)
}
for (const fonction of longues) {
  const marqueur = strict ? '::error::' : '::warning::'
  console.log(`${marqueur}${fonction.relatif}:${fonction.ligne} function ${fonction.nom}: ${fonction.taille} lines`)
}

const echec = tropGros.length > 0 || (strict && longues.length > 0)
console.log(
  echec
    ? `FAILED: ${tropGros.length} file(s) and ${longues.length} function(s) over the limit`
    : `OK: ${longues.length} function(s) flagged, no file over the limit`,
)
process.exit(echec ? 1 : 0)
