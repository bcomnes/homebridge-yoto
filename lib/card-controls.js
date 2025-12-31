/** @import { PlatformConfig } from 'homebridge' */

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
function getTrimmedString (value) {
  return typeof value === 'string' ? value.trim() : ''
}

/**
 * @param {unknown} value
 * @param {boolean} fallback
 * @returns {boolean}
 */
function getBooleanSetting (value, fallback) {
  return typeof value === 'boolean' ? value : fallback
}

/**
 * @param {PlatformConfig} config
 * @returns {CardControlConfig[]}
 */
export function getCardControlConfigs (config) {
  const services = config && typeof config === 'object' ? config['services'] : undefined
  const serviceConfig = typeof services === 'object' && services !== null
    ? /** @type {Record<string, unknown>} */ (services)
    : {}

  const rawControls = Array.isArray(serviceConfig['cardControls'])
    ? serviceConfig['cardControls']
    : []

  /** @type {CardControlConfig[]} */
  const controls = []
  const usedIds = new Set()

  for (const entry of rawControls) {
    if (!entry || typeof entry !== 'object') {
      continue
    }

    const record = /** @type {Record<string, unknown>} */ (entry)
    const cardId = getTrimmedString(record['cardId'])
    const label = getTrimmedString(record['label'])

    if (!cardId || !label) {
      continue
    }

    const playOnAll = getBooleanSetting(record['playOnAll'], false)

    let id = cardId
    if (usedIds.has(id)) {
      let suffix = 1
      while (usedIds.has(`${cardId}-${suffix}`)) {
        suffix += 1
      }
      id = `${cardId}-${suffix}`
    }

    usedIds.add(id)
    controls.push({
      id,
      cardId,
      label,
      playOnAll,
    })
  }

  return controls
}
