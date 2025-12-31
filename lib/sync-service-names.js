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

  // Add ConfiguredName when missing so we avoid HAP warnings on update.
  const configuredNameUuid = Characteristic.ConfiguredName.UUID
  const hasConfiguredNameCharacteristic = service.characteristics
    .some((characteristic) => characteristic.UUID === configuredNameUuid)
  const hasConfiguredNameOptional = service.optionalCharacteristics
    .some((characteristic) => characteristic.UUID === configuredNameUuid)

  if (!hasConfiguredNameCharacteristic && !hasConfiguredNameOptional) {
    service.addOptionalCharacteristic(Characteristic.ConfiguredName)
  }

  service.updateCharacteristic(Characteristic.ConfiguredName, sanitizedName)
}
