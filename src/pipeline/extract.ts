/**
 * Step 3 — Extraction: a single multimodal call reads the paper and returns the
 * teacher's annotations. No classic OCR: Tesseract fails on handwriting, and it
 * is precisely the handwriting that carries the information.
 */
import promptMd from '../../prompts/extraction.md?raw'
import { clientParDefaut } from './client'
import type { ClientBrut } from './client'
import type { Transport } from './llm'
import { parserExtraction } from './schemas'
import type { Extraction } from '../domain/types'

export const PROMPT_EXTRACTION = promptMd

/** The user message contains only the image and a short instruction. */
export function messageExtraction(): string {
  return 'Here is the photo of a corrected paper. List the teacher’s annotations and return the requested JSON.'
}

export async function extraireAnnotations(
  dataUrl: string,
  transport: Transport,
  client: ClientBrut = clientParDefaut(transport),
): Promise<Extraction> {
  const texte = await client({
    system: PROMPT_EXTRACTION,
    user: messageExtraction(),
    image: dataUrl,
    json: true,
    temperevision: 0.1,
    maxTokens: 2000,
  })
  return parserExtraction(texte)
}
