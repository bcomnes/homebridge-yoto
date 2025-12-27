/** @import { Service, Characteristic } from 'homebridge' */
import { sanitizeName } from './sanitize-name.js'

/**
 * Apply HomeKit-visible naming to a service.
 *
 * We set both `Name` and `ConfiguredName` on every service we manage so HomeKit tiles are consistently labeled.
 *
 * @param {object} params
 * @param {Service} params.service
 * @param {string} params.name
 * @param {typeof Characteristic} params.Characteristic
 * @returns {void}
 */
export function syncServiceNames ({
  Characteristic,
  service,
  name
}) {
  const sanitizedName = sanitizeName(name)
  service.displayName = sanitizedName

  service.updateCharacteristic(Characteristic.Name, sanitizedName)

  // Set ConfiguredName on all services, not just ones that say they support it.
  // This is the only way to set the service name inside an accessory.
  // const hasConfiguredNameCharacteristic = service.characteristics.some(c => c.UUID === Characteristic.ConfiguredName.UUID)
  // const hasConfiguredNameOptional = service.optionalCharacteristics.some(c => c.UUID === Characteristic.ConfiguredName.UUID)
  // if (!hasConfiguredNameCharacteristic && !hasConfiguredNameOptional) {
  //   service.addOptionalCharacteristic(Characteristic.ConfiguredName)
  // }

  service.updateCharacteristic(Characteristic.ConfiguredName, sanitizedName)
}
