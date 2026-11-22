/**
 * Closed taxonomy of (maths) errors — a defining decision of the project.
 *
 * The model never invents a category: it must choose from these 12 codes, or
 * answer E99 ("untyped"), which is excluded from the profile. This lock is what
 * makes the diagnosis measurable and defensible (see REVISION.md §17).
 *
 * Labels and signatures are in English: the product is in English, and the
 * signatures act as a safeguard in the prompts (the model answers in English).
 */

export const CODES_ERREUR = [
  'E01',
  'E02',
  'E03',
  'E04',
  'E05',
  'E06',
  'E07',
  'E08',
  'E09',
  'E10',
  'E11',
  'E12',
] as const

/** E99 = no category with sufficient confidence: reported, outside the profile. */
export type CodeErreur = (typeof CODES_ERREUR)[number] | 'E99'

export type TypeErreur = {
  code: (typeof CODES_ERREUR)[number]
  libelle: string
  /** Signature to look for — acts as a safeguard in the prompts. */
  signature: string
}

export const TAXONOMIE: readonly TypeErreur[] = [
  {
    code: 'E01',
    libelle: 'Lost sign',
    signature:
      'Unjustified sign change between two lines, typically while expanding.',
  },
  {
    code: 'E02',
    libelle: 'Incomplete expansion',
    signature:
      'Partial distributivity: one term inside the parentheses is not multiplied.',
  },
  {
    code: 'E03',
    libelle: 'Misused special product',
    signature: '(a+b)² expanded as a²+b², or wrong sign on the double product.',
  },
  {
    code: 'E04',
    libelle: 'Wrong common denominator',
    signature:
      'Sum of fractions: denominators combined wrongly, numerators not adjusted.',
  },
  {
    code: 'E05',
    libelle: 'Forgotten special case',
    signature:
      'Division by zero, value excluded from the domain, negative root left undiscussed.',
  },
  {
    code: 'E06',
    libelle: 'Mishandled power',
    signature:
      'Exponent applied to only part of the factor, power rules confused.',
  },
  {
    code: 'E07',
    libelle: 'Wrongly simplified root',
    signature: '√(a+b) split into √a+√b, incorrect simplification.',
  },
  {
    code: 'E08',
    libelle: 'Faulty transposition',
    signature:
      'Moving a term across the equals sign without the correct inverse operation.',
  },
  {
    code: 'E09',
    libelle: 'Rounding / precision',
    signature:
      'Premature rounding, error propagation, exact value replaced too early.',
  },
  {
    code: 'E10',
    libelle: 'Missing unit or conversion',
    signature: 'Result with no unit, inconsistent conversion.',
  },
  {
    code: 'E11',
    libelle: 'Copying mistake',
    signature:
      'Carelessness: the statement or previous line is miscopied, the maths afterwards is correct.',
  },
  {
    code: 'E12',
    libelle: 'Unjustified conclusion',
    signature:
      'Valid reasoning but a logical step is missing or a claim is left unproven.',
  },
] as const

export const CODE_NON_TYPEE: CodeErreur = 'E99'
export const LIBELLE_NON_TYPEE = 'Untyped'

const PAR_CODE = new Map<string, TypeErreur>(TAXONOMIE.map((t) => [t.code, t]))

export function libelleDe(code: CodeErreur): string {
  if (code === CODE_NON_TYPEE) return LIBELLE_NON_TYPEE
  return PAR_CODE.get(code)?.libelle ?? LIBELLE_NON_TYPEE
}

export function signatureDe(code: CodeErreur): string {
  if (code === CODE_NON_TYPEE) return 'No type matches with sufficient confidence.'
  return PAR_CODE.get(code)?.signature ?? ''
}

/** E99 leaves the profile; E11 enters it with zero weight (it is not a gap). */
export function entreDansLeProfil(code: CodeErreur): boolean {
  return code !== CODE_NON_TYPEE
}

export function estPonderee(code: CodeErreur): boolean {
  return code !== 'E11' && code !== CODE_NON_TYPEE
}

export function estCodeConnu(valeur: unknown): valeur is CodeErreur {
  return typeof valeur === 'string' && (PAR_CODE.has(valeur) || valeur === CODE_NON_TYPEE)
}
