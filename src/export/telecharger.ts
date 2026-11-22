import { nomFichierDate } from './exports'

/**
 * Browser-side download: a Blob, an ephemeral link, then remove it from the
 * DOM (otherwise successive downloads pile up in memory).
 */
export function telecharger(contenu: string, nom: string, type = 'text/plain;charset=utf-8'): void {
  const blob = new Blob([contenu], { type })
  const url = URL.createObjectURL(blob)
  const lien = document.createElement('a')
  lien.href = url
  lien.download = nom
  document.body.appendChild(lien)
  lien.click()
  lien.remove()
  URL.revokeObjectURL(url)
}

export function telechargerCsv(contenu: string, prefixe = 'revision-profil'): void {
  telecharger(contenu, nomFichierDate(prefixe, 'csv'), 'text/csv;charset=utf-8')
}

export function telechargerMarkdown(contenu: string, prefixe = 'revision-fiche'): void {
  telecharger(contenu, nomFichierDate(prefixe, 'md'), 'text/markdown;charset=utf-8')
}
