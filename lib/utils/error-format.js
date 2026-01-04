/**
 * @param {unknown} error
 * @returns {string}
 */
export function formatError (error) {
  const base = error instanceof Error ? (error.stack || error.message) : String(error)
  if (!error || typeof error !== 'object') return base

  const err = /** @type {Record<string, unknown>} */ (error)
  const extra = []
  const jsonBody = 'jsonBody' in err ? err['jsonBody'] : null
  const textBody = 'textBody' in err ? err['textBody'] : null

  if (jsonBody) {
    try {
      extra.push(JSON.stringify(jsonBody))
    } catch {
      extra.push(String(jsonBody))
    }
  }

  if (typeof textBody === 'string' && textBody.length) {
    if (typeof jsonBody !== 'string' || textBody !== jsonBody) {
      extra.push(textBody)
    }
  }

  return extra.length ? `${base}\n${extra.join('\n')}` : base
}
