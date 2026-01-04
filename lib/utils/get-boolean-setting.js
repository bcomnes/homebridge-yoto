// Use syncServiceNames for every visible service so HomeKit labels stay stable.
// Exceptions: AccessoryInformation (named in platform) and Battery (set Characteristic.Name only).
/**
 * @param {unknown} value
 * @param {boolean} fallback
 * @returns {boolean}
 */
export function getBooleanSetting (value, fallback) {
  return typeof value === 'boolean' ? value : fallback
}
