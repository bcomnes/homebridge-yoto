/**
 * @typedef {Object} CardControlConfig
 * @property {string} id
 * @property {string} cardId
 * @property {string} label
 * @property {boolean} playOnAll
 */
/**
 * @param {unknown} value
 * @returns {string}
 */
export function getTrimmedString (value) {
  return typeof value === 'string' ? value.trim() : ''
}
