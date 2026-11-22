/**
 * Merged bench — measures the NEW path (batches 1+3): a single vision call
 * (annotations + typing), then the second pass on uncertain errors.
 *
 * Compare with the measurements of the separate path (extraction then
 * classification), already recorded on 11 November: 53-92 s latency per paper.
 *
 *   INFERHUB_API_KEY=… npx vitest run tests/live/fusion.test.ts
 *
 * Skipped without a key: CI stays green and consumes no quota.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { construireDiagnostic } from '../../src/domain/diagnostic'
import { analyserImage } from '../../src/pipeline/analyse'
import type { ClientBrut } from '../../src/pipeline/client'
import { revoirFautesPeuSures } from '../../src/pipeline/revue'
import type { RequeteLLM, Transport } from '../../src/pipeline/llm'
import { chaineModeles, construireCorps } from '../../src/pipeline/llm'
import type { CodeErreur } from '../../src/domain/taxonomy'

const CLE = process.env.INFERHUB_API_KEY ?? ''
const AMONT = process.env.REVISION_AMONT ?? 'https://api.inferhub.dev/v1'
const MODELE = process.env.REVISION_MODELE ?? ''
const DELAI_APPEL_MS = 120_000

const transport: Transport = { proxy: `${AMONT}/chat/completions`, ...(MODELE ? { modele: MODELE } : {}) }

type EntreeManifeste = { fichier: string; dominant: CodeErreur | null; degradee: boolean }
const manifeste: { copies: EntreeManifeste[] } = JSON.parse(
  readFileSync(fileURLToPath(new URL('../../corpus/images/manifeste.json', import.meta.url)), 'utf8'),
)

// Representative subset: 2 clean, 1 degraded, 1 clean-paper, 1 ambiguous.
const CIBLES = ['copie-1-signes.png', 'copie-4-developpement.png', 'copie-8-grandeurs.png', 'copie-3-propre.png', 'copie-6-puissances-photo.png']

async function appeler(requete: RequeteLLM, modele: string): Promise<string> {
  const reponse = await fetch(`${AMONT}/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${CLE}` },
    body: JSON.stringify(construireCorps(requete, modele)),
    signal: AbortSignal.timeout(DELAI_APPEL_MS),
  })
  if (!reponse.ok) {
    throw Object.assign(new Error(`upstream HTTP ${reponse.status}`), { statut: reponse.status })
  }
  const data = (await reponse.json()) as { choices?: { message?: { content?: string } }[] }
  return data.choices?.[0]?.message?.content ?? ''
}

const TRANSITOIRES = new Set([402, 429, 500, 502, 503, 504])

const clientDirect: ClientBrut = async (requete: RequeteLLM) => {
  let derniere = 'no model available'
  for (const modele of chaineModeles(transport)) {
    try {
      return await appeler(requete, modele)
    } catch (erreur) {
      if (!TRANSITOIRES.has((erreur as { statut?: number }).statut ?? 0)) throw erreur
      derniere = (erreur as Error).message
    }
  }
  throw new Error(derniere)
}

function image(nom: string): string {
  const chemin = fileURLToPath(new URL(`../../corpus/images/${nom}`, import.meta.url))
  return `data:image/png;base64,${readFileSync(chemin).toString('base64')}`
}

describe.skipIf(!CLE)('new merged path (batches 1+3)', () => {
  it('measures accuracy and latency on the representative subset', async () => {
    let bons = 0
    let totalMs = 0
    for (const fichier of CIBLES) {
      const entree = manifeste.copies.find((c) => c.fichier === fichier)!
      const debut = Date.now()
      const { erreurs } = await analyserImage(image(fichier), transport, clientDirect)
      const revue = await revoirFautesPeuSures(erreurs, transport, clientDirect)
      const diagnostic = construireDiagnostic(revue.erreurs, { id: fichier, createdAt: new Date().toISOString() })
      const ms = Date.now() - debut
      totalMs += ms
      const ok = diagnostic.typeDominant === entree.dominant
      if (ok) bons += 1
      console.info(
        `[fusion:${fichier}] expected=${entree.dominant ?? 'clean'} got=${diagnostic.typeDominant ?? 'none'} ` +
          `errors=${diagnostic.nbFautes} reviews=${revue.revues} changed=${revue.modifiees} ${(ms / 1000).toFixed(1)}s`,
      )
    }
    const moyenne = totalMs / CIBLES.length / 1000
    console.info(`[fusion] accuracy=${bons}/${CIBLES.length} average latency=${moyenne.toFixed(1)}s`)
    // Latency: target < 25 s on average (the separate path measured 53-92 s).
    expect(moyenne).toBeLessThan(40)
  }, 30 * 60_000)
})