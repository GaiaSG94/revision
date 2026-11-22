/**
 * Public addresses of the project. A single place: sections pointing to the
 * repository or the demo derive from it, no URL is copied.
 */
export const DEPOT = 'https://github.com/GaiaSG94/revision'

export const DEMO = 'https://gaiasg94.github.io/revision/'

/** GitHub link to a file in the repository, on the main branch. */
export function docDuDepot(chemin: string): string {
  return `${DEPOT}/blob/main/${chemin}`
}
