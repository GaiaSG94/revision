import type { EtapeId } from './types'

/**
 * The six pipeline steps, in order. Single source of labels: the orchestrator
 * and the analysis screen read them here, never duplicated.
 */
export const ETAPES: { id: EtapeId; libelle: string }[] = [
  { id: 'ingest', libelle: 'Reading the photo' },
  { id: 'anonymise', libelle: 'Masking the name' },
  { id: 'extrait', libelle: "Reading the teacher's marks" },
  { id: 'classifie', libelle: 'Sorting into the 12 types' },
  { id: 'agrege', libelle: 'Updating your profile' },
  { id: 'genere', libelle: 'Building the targeted exercise' },
]

export function libelleEtape(id: EtapeId): string {
  return ETAPES.find((e) => e.id === id)?.libelle ?? id
}
