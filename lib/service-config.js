/** @import { PlatformConfig } from 'homebridge' */

/**
 * @typedef {Object} PlaybackAccessoryConfig
 * @property {boolean} playbackEnabled
 * @property {boolean} volumeEnabled
 * @property {boolean} smartSpeakerEnabled
 * @property {boolean} televisionEnabled
 */

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
 * @returns {PlaybackAccessoryConfig}
 */
export function getPlaybackAccessoryConfig (config) {
  const services = config && typeof config === 'object' ? config['services'] : undefined
  const serviceConfig = typeof services === 'object' && services !== null
    ? /** @type {Record<string, unknown>} */ (services)
    : {}

  const playbackEnabled = getBooleanSetting(serviceConfig['playbackControls'], false)
  const smartSpeakerEnabled = getBooleanSetting(serviceConfig['smartSpeaker'], false)
  const televisionEnabled = getBooleanSetting(serviceConfig['television'], false)

  return {
    playbackEnabled,
    volumeEnabled: playbackEnabled,
    smartSpeakerEnabled,
    televisionEnabled,
  }
}
