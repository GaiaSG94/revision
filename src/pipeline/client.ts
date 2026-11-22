/**
 * Model injection point: the whole pipeline talks to a `ClientBrut`, never
 * directly to `fetch`. Tests provide a function returning simulated JSON — no
 * network, no quota consumed.
 */
import { completer } from './llm'
import type { RequeteLLM, Transport } from './llm'

export type ClientBrut = (requete: RequeteLLM) => Promise<string>

/** Real client: edge proxy or BYOK, depending on the transport. */
export function clientParDefaut(transport: Transport): ClientBrut {
  return (requete: RequeteLLM) => completer(transport, requete)
}

/** Test client: returns the next response in the queue, or fails beyond it. */
export function clientSimule(reponses: string[]): ClientBrut {
  let index = 0
  return async () => {
    const reponse = reponses[index]
    if (reponse === undefined) throw new Error('clientSimule: no response left')
    index += 1
    return reponse
  }
}
