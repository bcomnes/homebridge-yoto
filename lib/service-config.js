/** @import { PlatformConfig } from 'homebridge' */

/**
 * @typedef {'bridged' | 'external' | 'none'} PlaybackAccessoryMode
 */

/**
 * @typedef {Object} PlaybackAccessoryConfig
 * @property {PlaybackAccessoryMode} mode
 * @property {boolean} playbackEnabled
 * @property {boolean} volumeEnabled
 * @property {boolean} isLegacy
 */

const PLAYBACK_ACCESSORY_MODES = new Set(['bridged', 'external', 'none'])

/**
 * @param {unknown} value
 * @param {boolean} fallback
 * @returns {boolean}
 */
function getBooleanSetting (value, fallback) {
  return typeof value === 'boolean' ? value : fallback
}

/**
 * @param {unknown} value
 * @param {PlaybackAccessoryMode} fallback
 * @returns {PlaybackAccessoryMode}
 */
function parsePlaybackAccessoryMode (value, fallback) {
  if (typeof value === 'string' && PLAYBACK_ACCESSORY_MODES.has(value)) {
    return /** @type {PlaybackAccessoryMode} */ (value)
  }
  return fallback
}

/**
 * @param {PlatformConfig} config
 * @returns {PlaybackAccessoryConfig}
 */
export function getPlaybackAccessoryConfig (config) {
  const services = config && typeof config === 'object' ? config['services'] : undefined
  const serviceConfig = typeof services === 'object' && services !== null
    ? /** @type {Record<string, unknown>} */ (services)
    : {}

  const hasPlaybackAccessory = Object.prototype.hasOwnProperty.call(serviceConfig, 'playbackAccessory')
  const legacyPlayback = getBooleanSetting(serviceConfig['playback'], true)
  const legacyVolume = getBooleanSetting(serviceConfig['volume'], true)

  const legacyMode = legacyPlayback || legacyVolume ? 'bridged' : 'none'
  const mode = hasPlaybackAccessory
    ? parsePlaybackAccessoryMode(serviceConfig['playbackAccessory'], 'bridged')
    : legacyMode

  return {
    mode,
    playbackEnabled: hasPlaybackAccessory ? mode === 'bridged' : legacyPlayback,
    volumeEnabled: hasPlaybackAccessory ? mode === 'bridged' : legacyVolume,
    isLegacy: !hasPlaybackAccessory,
  }
}
