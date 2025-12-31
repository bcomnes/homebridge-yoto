/**
 * @fileoverview Yoto card control accessory implementation (play card on all devices).
 */

/** @import { PlatformAccessory, CharacteristicValue, Service, Logger } from 'homebridge' */
/** @import { YotoPlatform } from './platform.js' */
/** @import { CardControlConfig } from './card-controls.js' */

import {
  DEFAULT_MANUFACTURER,
  DEFAULT_MODEL,
  LOG_PREFIX,
} from './constants.js'
import { sanitizeName } from './sanitize-name.js'
import { syncServiceNames } from './sync-service-names.js'

/**
 * Yoto Card Control Accessory Handler (bridged)
 * Triggers card playback on all devices when toggled.
 */
export class YotoCardControlAccessory {
  /** @type {YotoPlatform} */ #platform
  /** @type {PlatformAccessory} */ #accessory
  /** @type {Logger} */ #log
  /** @type {CardControlConfig} */ #cardControl
  /** @type {Service | undefined} */ switchService
  /** @type {Set<Service>} */ #currentServices = new Set()

  /**
   * @param {Object} params
   * @param {YotoPlatform} params.platform - Platform instance
   * @param {PlatformAccessory} params.accessory - Platform accessory
   * @param {CardControlConfig} params.cardControl - Card control configuration
   */
  constructor ({ platform, accessory, cardControl }) {
    this.#platform = platform
    this.#accessory = accessory
    this.#cardControl = cardControl
    this.#log = platform.log
  }

  /**
   * Setup accessory - create services and setup handlers
   * @returns {Promise<void>}
   */
  async setup () {
    const label = this.#cardControl.label
    this.#log.debug(LOG_PREFIX.ACCESSORY, `Setting up card control accessory: ${label}`)

    this.#currentServices.clear()

    this.setupAccessoryInformation()
    this.setupSwitchService()

    for (const service of this.#accessory.services) {
      if (service.UUID !== this.#platform.Service.AccessoryInformation.UUID &&
          !this.#currentServices.has(service)) {
        this.#log.debug(LOG_PREFIX.ACCESSORY, `Removing stale card control service: ${service.displayName || service.UUID}`)
        this.#accessory.removeService(service)
      }
    }

    this.#log.debug(LOG_PREFIX.ACCESSORY, `✓ Card control accessory ready: ${label}`)
  }

  /**
   * Setup AccessoryInformation service
   */
  setupAccessoryInformation () {
    const { Service, Characteristic } = this.#platform
    const service = this.#accessory.getService(Service.AccessoryInformation) ||
      this.#accessory.addService(Service.AccessoryInformation)

    const displayName = sanitizeName(this.#accessory.displayName)

    service
      .setCharacteristic(Characteristic.Manufacturer, DEFAULT_MANUFACTURER)
      .setCharacteristic(Characteristic.Model, DEFAULT_MODEL)
      .setCharacteristic(Characteristic.SerialNumber, this.#cardControl.id)
      .setCharacteristic(Characteristic.Name, displayName)
      .setCharacteristic(Characteristic.ConfiguredName, displayName)

    this.#currentServices.add(service)
  }

  /**
   * Setup card control Switch service
   */
  setupSwitchService () {
    const { Service, Characteristic } = this.#platform
    const serviceName = sanitizeName(this.#accessory.displayName)

    const service = this.#accessory.getServiceById(Service.Switch, 'CardControl') ||
      this.#accessory.addService(Service.Switch, serviceName, 'CardControl')

    syncServiceNames({ Characteristic, service, name: serviceName })

    service
      .getCharacteristic(Characteristic.On)
      .onGet(() => false)
      .onSet(this.setCardControl.bind(this))

    service.updateCharacteristic(Characteristic.On, false)

    this.switchService = service
    this.#currentServices.add(service)
  }

  /**
   * Trigger playback for all devices.
   * @param {CharacteristicValue} value
   * @returns {Promise<void>}
   */
  async setCardControl (value) {
    const { Characteristic } = this.#platform
    const isOn = Boolean(value)

    if (!isOn) {
      this.switchService?.getCharacteristic(Characteristic.On).updateValue(false)
      return
    }

    const account = this.#platform.yotoAccount
    if (!account) {
      this.#log.warn(LOG_PREFIX.ACCESSORY, 'Card control requested before account is ready.')
      this.switchService?.getCharacteristic(Characteristic.On).updateValue(false)
      throw new this.#platform.api.hap.HapStatusError(
        this.#platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE
      )
    }

    const devices = Array.from(account.devices.values())
    if (devices.length === 0) {
      this.#log.warn(LOG_PREFIX.ACCESSORY, 'Card control requested with no devices available.')
      this.switchService?.getCharacteristic(Characteristic.On).updateValue(false)
      throw new this.#platform.api.hap.HapStatusError(
        this.#platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE
      )
    }

    const onlineDevices = devices.filter((deviceModel) => deviceModel.status.isOnline)
    const offlineDevices = devices.filter((deviceModel) => !deviceModel.status.isOnline)
    if (offlineDevices.length > 0) {
      const offlineNames = offlineDevices.map(deviceModel => deviceModel.device.name).join(', ')
      this.#log.debug(LOG_PREFIX.ACCESSORY, `Skipping offline devices for card control: ${offlineNames}`)
    }
    if (onlineDevices.length === 0) {
      this.#log.warn(LOG_PREFIX.ACCESSORY, 'Card control requested but no devices are online.')
      this.switchService?.getCharacteristic(Characteristic.On).updateValue(false)
      throw new this.#platform.api.hap.HapStatusError(
        this.#platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE
      )
    }

    this.#log.debug(
      LOG_PREFIX.ACCESSORY,
      `Play card on all devices: ${this.#cardControl.label} (${this.#cardControl.cardId})`
    )

    const results = await Promise.allSettled(
      onlineDevices.map(async (deviceModel) => {
        await deviceModel.startCard({ cardId: this.#cardControl.cardId })
        return deviceModel.device.name
      })
    )

    const failedDevices = results.reduce((acc, result, index) => {
      if (result.status === 'rejected') {
        const failedDevice = onlineDevices[index]
        if (failedDevice) {
          acc.push(failedDevice.device.name)
        }
      }
      return acc
    }, /** @type {string[]} */ ([]))

    if (failedDevices.length > 0) {
      this.#log.warn(
        LOG_PREFIX.ACCESSORY,
        `Card control failed on ${failedDevices.length} device(s): ${failedDevices.join(', ')}`
      )
    }

    this.switchService?.getCharacteristic(Characteristic.On).updateValue(false)

    if (failedDevices.length === results.length) {
      throw new this.#platform.api.hap.HapStatusError(
        this.#platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE
      )
    }
  }

  /**
   * Stop accessory - cleanup handlers (no listeners to remove)
   * @returns {Promise<void>}
   */
  async stop () {
    this.#currentServices.clear()
  }
}
