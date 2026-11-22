/**
 * Single table of contents for the "How it works" screen.
 *
 * Each section reads its anchor and title here; the screen reads its table of
 * contents here. No string is copied from one file to another: adding a section
 * means adding an entry here.
 */
export const SECTIONS = {
  pipeline: { id: 'pipeline', titre: 'The pipeline, step by step' },
  taxonomie: { id: 'taxonomie', titre: 'The 12 error types' },
  gardeFou: { id: 'garde-fou', titre: 'The exercise guardrail' },
  confidentialite: { id: 'confidentialite', titre: 'Your data: the five rules' },
  mesures: { id: 'mesures', titre: 'The real numbers, measured' },
  outilsIA: { id: 'outils-ia', titre: 'AI in the product, AI in the code' },
  liens: { id: 'liens', titre: 'Going further' },
} as const

export type SectionDef = (typeof SECTIONS)[keyof typeof SECTIONS]

/** Display order: the declaration order above. */
export const SOMMAIRE: readonly SectionDef[] = Object.values(SECTIONS)
