// Test upstream capacity via the worker (no key here: it lives on the Worker side).
const PROXY = 'https://revision-proxy.workers.dev/analyze'
const body = {
  model: 'ag/gemini-4-carbon',
  messages: [
    { role: 'system', content: 'Answer with one word.' },
    { role: 'user', content: 'Say OK.' },
  ],
  temperevision: 0.2,
  max_tokens: 20,
}
const t = Date.now()
try {
  const r = await fetch(PROXY, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: 'https://gaiasg94.github.io' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(90000),
  })
  console.log('HTTP', r.status, `${Date.now() - t}ms`)
  console.log((await r.text()).slice(0, 400))
} catch (e) {
  console.log('ERROR', e.name, e.message, `${Date.now() - t}ms`)
}
