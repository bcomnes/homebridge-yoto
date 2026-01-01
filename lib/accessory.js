/**
 * @fileoverview Yoto Player Accessory implementation - handles HomeKit services for a single player
 */

/** @import { PlatformAccessory, CharacteristicValue, Service, Logger } from 'homebridge' */
/** @import { YotoPlatform } from './platform.js' */
/** @import { YotoDeviceModel } from 'yoto-nodejs-client' */
/** @import { YotoDevice } from 'yoto-nodejs-client/lib/api-endpoints/devices.js' */
/** @import { YotoAccessoryContext } from './platform.js' */
/** @import { ServiceSchemaKey } from '../config.schema.cjs' */
/** @import { CardControlConfig } from './card-controls.js' */

/**
 * Device capabilities detected from metadata
 * @typedef {Object} YotoDeviceCapabilities
 * @property {boolean} hasTemperatureSensor - Whether device has temperature sensor (Gen3 only)
 * @property {string | undefined} formFactor - Device form factor ('standard' or 'mini')
 * @property {string | undefined} generation - Device generation (e.g., 'gen3')
 */

/**
 * Accessory service toggles from config.
 * @typedef {Object} YotoServiceToggles
 * @property {boolean} playback
 * @property {boolean} volume
 * @property {boolean} battery
 * @property {boolean} temperature
 * @property {boolean} nightlight
 * @property {boolean} cardSlot
 * @property {boolean} dayMode
 * @property {boolean} sleepTimer
 * @property {boolean} bluetooth
 * @property {boolean} volumeLimits
 */

import convert from 'color-convert'
import {
  DEFAULT_MANUFACTURER,
  DEFAULT_MODEL,
  LOW_BATTERY_THRESHOLD,
  LOG_PREFIX,
} from './constants.js'
import { sanitizeName } from './sanitize-name.js'
import { syncServiceNames } from './sync-service-names.js'
import { serviceSchema } from '../config.schema.cjs'
import { getPlaybackAccessoryConfig } from './service-config.js'
import { getCardControlConfigs } from './card-controls.js'

// Use syncServiceNames for every visible service so HomeKit labels stay stable.
// Exceptions: AccessoryInformation (named in platform) and Battery (set Characteristic.Name only).

/**
 * @param {unknown} value
 * @param {boolean} fallback
 * @returns {boolean}
 */
function getBooleanSetting (value, fallback) {
  return typeof value === 'boolean' ? value : fallback
}

/**
 * @param {ServiceSchemaKey} key
 * @returns {boolean}
 */
function getServiceDefault (key) {
  const entry = serviceSchema[key]
  if (entry && 'default' in entry && typeof entry.default === 'boolean') {
    return entry.default
  }
  return false
}

/**
 * Yoto Player Accessory Handler
 * Manages HomeKit services and characteristics for a single Yoto player
 */
export class YotoPlayerAccessory {
  /** @type {YotoPlatform} */ #platform
  /** @type {PlatformAccessory<YotoAccessoryContext>} */ #accessory
  /** @type {YotoDeviceModel} */ #deviceModel
  /** @type {Logger} */ #log
  /** @type {YotoDevice} */ #device
  /** @type {Service | undefined} */ playbackService
  /** @type {Service | undefined} */ volumeService
  /** @type {Service | undefined} */ batteryService
  /** @type {Service | undefined} */ onlineStatusService
  /** @type {Service | undefined} */ temperatureSensorService
  /** @type {Service | undefined} */ dayNightlightService
  /** @type {Service | undefined} */ nightNightlightService
  /** @type {Service | undefined} */ nightlightActiveService
  /** @type {Service | undefined} */ dayNightlightActiveService
  /** @type {Service | undefined} */ nightNightlightActiveService
  /** @type {Service | undefined} */ cardSlotService
  /** @type {Service | undefined} */ dayModeService
  /** @type {Service | undefined} */ sleepTimerService
  /** @type {Service | undefined} */ bluetoothService
  /** @type {Service | undefined} */ dayMaxVolumeService
  /** @type {Service | undefined} */ nightMaxVolumeService
  // Volume state for mute/unmute (0-100 percent)
  /** @type {number} */ #lastNonZeroVolume = 50
  // Nightlight color state for restore-on-ON
  /** @type {string} */ #lastDayColor = '0xffffff'
  /** @type {string} */ #lastNightColor = '0xffffff'
  /** @type {Set<Service>} */ #currentServices = new Set()

  /**
   * @param {Object} params
   * @param {YotoPlatform} params.platform - Platform instance
   * @param {PlatformAccessory<YotoAccessoryContext>} params.accessory - Platform accessory
   * @param {YotoDeviceModel} params.deviceModel - Yoto device model with live state
   */
  constructor ({ platform, accessory, deviceModel }) {
    this.#platform = platform
    this.#accessory = accessory
    this.#deviceModel = deviceModel
    this.#log = platform.log

    // Extract device info from context
    this.#device = accessory.context.device

    // Track all services we add during setup
    this.#currentServices = new Set()
  }

  /**
   * @returns {YotoServiceToggles}
   */
  getServiceToggles () {
    const config = this.#platform.config
    const services = config && typeof config === 'object' ? config['services'] : undefined
    const serviceConfig = typeof services === 'object' && services !== null
      ? /** @type {Record<string, unknown>} */ (services)
      : {}
    const playbackConfig = getPlaybackAccessoryConfig(this.#platform.config)

    return {
      playback: playbackConfig.playbackEnabled,
      volume: playbackConfig.volumeEnabled,
      battery: getBooleanSetting(serviceConfig['battery'], getServiceDefault('battery')),
      temperature: getBooleanSetting(serviceConfig['temperature'], getServiceDefault('temperature')),
      nightlight: getBooleanSetting(serviceConfig['nightlight'], getServiceDefault('nightlight')),
      cardSlot: getBooleanSetting(serviceConfig['cardSlot'], getServiceDefault('cardSlot')),
      dayMode: getBooleanSetting(serviceConfig['dayMode'], getServiceDefault('dayMode')),
      sleepTimer: getBooleanSetting(serviceConfig['sleepTimer'], getServiceDefault('sleepTimer')),
      bluetooth: getBooleanSetting(serviceConfig['bluetooth'], getServiceDefault('bluetooth')),
      volumeLimits: getBooleanSetting(serviceConfig['volumeLimits'], getServiceDefault('volumeLimits')),
    }
  }

  /**
   * Setup accessory - create services and setup event listeners
   * @returns {Promise<void>}
   */
  async setup () {
    this.#log.debug(LOG_PREFIX.ACCESSORY, `Setting up ${this.#device.name}`)

    // Check if device type is supported
    if (!this.#deviceModel.capabilities.supported) {
      this.#log.warn(
        LOG_PREFIX.ACCESSORY,
        `[${this.#device.name}] Unknown device type '${this.#device.deviceType}' - some features may not work correctly`
      )
    }

    // Clear the set before setup (in case setup is called multiple times)
    this.#currentServices.clear()

    // 1. Setup services
    const serviceToggles = this.getServiceToggles()

    this.setupAccessoryInformation()
    this.setupOnlineStatusService()

    if (serviceToggles.playback) {
      this.setupPlaybackSwitchService()
    }

    if (serviceToggles.volume) {
      this.setupVolumeService()
    }

    if (serviceToggles.battery) {
      this.setupBatteryService()
    }

    // Setup optional services based on device capabilities
    if (serviceToggles.temperature && this.#deviceModel.capabilities.hasTemperatureSensor) {
      this.setupTemperatureSensorService()
    }

    if (serviceToggles.nightlight && this.#deviceModel.capabilities.hasColoredNightlight) {
      this.setupNightlightServices()
    }

    // Setup universal services (available on all devices)
    if (serviceToggles.cardSlot) {
      this.setupCardSlotService()
    }
    if (serviceToggles.dayMode) {
      this.setupDayModeService()
    }
    if (serviceToggles.sleepTimer) {
      this.setupSleepTimerService()
    }
    if (serviceToggles.bluetooth) {
      this.setupBluetoothService()
    }
    if (serviceToggles.volumeLimits) {
      this.setupVolumeLimitServices()
    }
    this.setupCardControlServices()

    // Remove any services that aren't in our current set
    // (except AccessoryInformation which should always be preserved)
    for (const service of this.#accessory.services) {
      if (service.UUID !== this.#platform.Service.AccessoryInformation.UUID &&
          !this.#currentServices.has(service)) {
        this.#log.debug(LOG_PREFIX.ACCESSORY, `Removing stale service: ${service.displayName || service.UUID}`)
        this.#accessory.removeService(service)
      }
    }

    // 2. Setup event listeners for device model updates
    this.setupEventListeners()

    this.#log.debug(LOG_PREFIX.ACCESSORY, `✓ ${this.#device.name} ready`)
  }

  /**
   * Generate service name with device name prefix
   * @param {string} serviceName - Base service name
   * @returns {string} Full service name with device prefix
   */
  generateServiceName (serviceName) {
    const rawName = `${this.#device.name} ${serviceName}`
    return sanitizeName(rawName)
  }

  /**
   * Setup AccessoryInformation service
   */
  setupAccessoryInformation () {
    const { Service, Characteristic } = this.#platform
    const service = this.#accessory.getService(Service.AccessoryInformation) ||
      this.#accessory.addService(Service.AccessoryInformation)

    // Build hardware revision from generation and form factor
    const hardwareRevision = [
      this.#device.generation,
      this.#device.formFactor,
    ].filter(Boolean).join(' ') || 'Unknown'

    // Use deviceFamily for model (e.g., 'v2', 'v3', 'mini')
    const model = this.#device.deviceFamily || this.#device.deviceType || DEFAULT_MODEL

    // Set standard characteristics
    service
      .setCharacteristic(Characteristic.Manufacturer, DEFAULT_MANUFACTURER)
      .setCharacteristic(Characteristic.Model, model)
      .setCharacteristic(Characteristic.SerialNumber, this.#device.deviceId)
      .setCharacteristic(Characteristic.HardwareRevision, hardwareRevision)

    // Set firmware version from live status if available
    if (this.#deviceModel.status.firmwareVersion) {
      service.setCharacteristic(
        Characteristic.FirmwareRevision,
        this.#deviceModel.status.firmwareVersion
      )
    }

    this.#currentServices.add(service)
  }

  /**
   * Setup online/offline ContactSensor service (PRIMARY)
   */
  setupOnlineStatusService () {
    const { Service, Characteristic } = this.#platform
    const serviceName = this.generateServiceName('Online Status')

    const service = this.#accessory.getServiceById(Service.ContactSensor, 'OnlineStatus') ||
      this.#accessory.addService(Service.ContactSensor, serviceName, 'OnlineStatus')

    service.setPrimaryService(true)

    syncServiceNames({ Characteristic, service, name: serviceName })

    service
      .getCharacteristic(Characteristic.ContactSensorState)
      .onGet(this.getOnlineStatus.bind(this))

    this.onlineStatusService = service
    this.#currentServices.add(service)
  }

  /**
   * Setup play/pause Switch service
   */
  setupPlaybackSwitchService () {
    const { Service, Characteristic } = this.#platform
    const serviceName = this.generateServiceName('Playback')

    const service = this.#accessory.getServiceById(Service.Switch, 'Playback') ||
      this.#accessory.addService(Service.Switch, serviceName, 'Playback')

    syncServiceNames({ Characteristic, service, name: serviceName })

    service
      .getCharacteristic(Characteristic.On)
      .onGet(this.getPlaybackOn.bind(this))
      .onSet(this.setPlaybackOn.bind(this))

    this.playbackService = service
    this.#currentServices.add(service)
  }

  /**
   * Setup Lightbulb service for volume/mute controls (Speaker service isn't shown in Home)
   */
  setupVolumeService () {
    const { Service, Characteristic } = this.#platform
    const serviceName = this.generateServiceName('Volume')

    const service = this.#accessory.getServiceById(Service.Lightbulb, 'Volume') ||
      this.#accessory.addService(Service.Lightbulb, serviceName, 'Volume')
    syncServiceNames({ Characteristic, service, name: serviceName })

    service
      .getCharacteristic(Characteristic.On)
      .onGet(this.getVolumeOn.bind(this))
      .onSet(this.setVolumeOn.bind(this))

    service
      .getCharacteristic(Characteristic.Brightness)
      .setProps({
        minValue: 0,
        maxValue: 100,
        minStep: 1,
      })
      .onGet(this.getVolume.bind(this))
      .onSet(this.setVolume.bind(this))

    this.volumeService = service
    this.#currentServices.add(service)
  }

  /**
   * Setup Battery service
   */
  setupBatteryService () {
    const { Service, Characteristic } = this.#platform
    const serviceName = this.generateServiceName('Battery')
    const service = this.#accessory.getService(Service.Battery) ||
      this.#accessory.addService(Service.Battery, serviceName)
    service.setCharacteristic(Characteristic.Name, serviceName)

    // BatteryLevel (GET only)
    service.getCharacteristic(Characteristic.BatteryLevel)
      .onGet(this.getBatteryLevel.bind(this))

    // ChargingState (GET only)
    service.getCharacteristic(Characteristic.ChargingState)
      .onGet(this.getChargingState.bind(this))

    // StatusLowBattery (GET only)
    service.getCharacteristic(Characteristic.StatusLowBattery)
      .onGet(this.getStatusLowBattery.bind(this))

    // Battery does not support StatusActive

    this.batteryService = service
    this.#currentServices.add(service)
  }

  /**
   * Setup TemperatureSensor service (optional - only for devices with temperature sensor)
   */
  setupTemperatureSensorService () {
    const { Service, Characteristic } = this.#platform
    const serviceName = this.generateServiceName('Temperature')
    const service = this.#accessory.getService(Service.TemperatureSensor) ||
      this.#accessory.addService(Service.TemperatureSensor, serviceName)
    syncServiceNames({ Characteristic, service, name: serviceName })

    // CurrentTemperature (GET only)
    service.getCharacteristic(Characteristic.CurrentTemperature)
      .onGet(this.getCurrentTemperature.bind(this))

    // StatusFault (GET only) - indicates if sensor is working
    service.getCharacteristic(Characteristic.StatusFault)
      .onGet(this.getTemperatureSensorFault.bind(this))

    // StatusActive (online/offline indicator)
    service.getCharacteristic(Characteristic.StatusActive)
      .onGet(this.getStatusActive.bind(this))

    this.temperatureSensorService = service
    this.#currentServices.add(service)
  }

  /**
   * Setup Nightlight services (optional - only for devices with colored nightlight)
   * Creates two Lightbulb services for day and night nightlight color control
   */
  setupNightlightServices () {
    const { Service, Characteristic } = this.#platform

    // Day Nightlight
    const dayName = this.generateServiceName('Day Nightlight')
    const dayService = this.#accessory.getServiceById(Service.Lightbulb, 'DayNightlight') ||
      this.#accessory.addService(Service.Lightbulb, dayName, 'DayNightlight')
    syncServiceNames({ Characteristic, service: dayService, name: dayName })

    // On (READ/WRITE) - Turn nightlight on/off
    dayService.getCharacteristic(Characteristic.On)
      .onGet(this.getDayNightlightOn.bind(this))
      .onSet(this.setDayNightlightOn.bind(this))

    // Brightness (READ/WRITE) - Display brightness (screen brightness, not color brightness)
    dayService.getCharacteristic(Characteristic.Brightness)
      .onGet(this.getDayNightlightBrightness.bind(this))
      .onSet(this.setDayNightlightBrightness.bind(this))

    // Hue (READ/WRITE) - Color hue from ambientColour
    dayService.getCharacteristic(Characteristic.Hue)
      .onGet(this.getDayNightlightHue.bind(this))
      .onSet(this.setDayNightlightHue.bind(this))

    // Saturation (READ/WRITE) - Color saturation from ambientColour
    dayService.getCharacteristic(Characteristic.Saturation)
      .onGet(this.getDayNightlightSaturation.bind(this))
      .onSet(this.setDayNightlightSaturation.bind(this))

    this.dayNightlightService = dayService

    // Night Nightlight
    const nightName = this.generateServiceName('Night Nightlight')
    const nightService = this.#accessory.getServiceById(Service.Lightbulb, 'NightNightlight') ||
      this.#accessory.addService(Service.Lightbulb, nightName, 'NightNightlight')
    syncServiceNames({ Characteristic, service: nightService, name: nightName })

    // On (READ/WRITE) - Turn nightlight on/off
    nightService.getCharacteristic(Characteristic.On)
      .onGet(this.getNightNightlightOn.bind(this))
      .onSet(this.setNightNightlightOn.bind(this))

    // Brightness (READ/WRITE) - Display brightness (screen brightness, not color brightness)
    nightService.getCharacteristic(Characteristic.Brightness)
      .onGet(this.getNightNightlightBrightness.bind(this))
      .onSet(this.setNightNightlightBrightness.bind(this))

    // Hue (READ/WRITE) - Color hue from nightAmbientColour
    nightService.getCharacteristic(Characteristic.Hue)
      .onGet(this.getNightNightlightHue.bind(this))
      .onSet(this.setNightNightlightHue.bind(this))

    // Saturation (READ/WRITE) - Color saturation from nightAmbientColour
    nightService.getCharacteristic(Characteristic.Saturation)
      .onGet(this.getNightNightlightSaturation.bind(this))
      .onSet(this.setNightNightlightSaturation.bind(this))

    this.nightNightlightService = nightService

    // Setup nightlight status ContactSensors
    // These show the live state of nightlights (different from config-based Lightbulb services)

    // ContactSensor: NightlightActive - Shows if nightlight is currently on
    const nightlightActiveName = this.generateServiceName('Nightlight Active')
    const nightlightActiveService = this.#accessory.getServiceById(Service.ContactSensor, 'NightlightActive') ||
      this.#accessory.addService(Service.ContactSensor, nightlightActiveName, 'NightlightActive')
    syncServiceNames({ Characteristic, service: nightlightActiveService, name: nightlightActiveName })

    nightlightActiveService.getCharacteristic(Characteristic.ContactSensorState)
      .onGet(this.getNightlightActive.bind(this))

    this.nightlightActiveService = nightlightActiveService

    // ContactSensor: DayNightlightActive - Shows if day nightlight is currently showing
    const dayNightlightActiveName = this.generateServiceName('Day Nightlight Active')
    const dayNightlightActiveService = this.#accessory.getServiceById(Service.ContactSensor, 'DayNightlightActive') ||
      this.#accessory.addService(Service.ContactSensor, dayNightlightActiveName, 'DayNightlightActive')
    syncServiceNames({ Characteristic, service: dayNightlightActiveService, name: dayNightlightActiveName })

    dayNightlightActiveService.getCharacteristic(Characteristic.ContactSensorState)
      .onGet(this.getDayNightlightActive.bind(this))

    this.dayNightlightActiveService = dayNightlightActiveService

    // ContactSensor: NightNightlightActive - Shows if night nightlight is currently showing
    const nightNightlightActiveName = this.generateServiceName('Night Nightlight Active')
    const nightNightlightActiveService = this.#accessory.getServiceById(Service.ContactSensor, 'NightNightlightActive') ||
      this.#accessory.addService(Service.ContactSensor, nightNightlightActiveName, 'NightNightlightActive')
    syncServiceNames({ Characteristic, service: nightNightlightActiveService, name: nightNightlightActiveName })

    nightNightlightActiveService.getCharacteristic(Characteristic.ContactSensorState)
      .onGet(this.getNightNightlightActive.bind(this))

    this.nightNightlightActiveService = nightNightlightActiveService

    this.#currentServices.add(dayService)
    this.#currentServices.add(nightService)
    this.#currentServices.add(nightlightActiveService)
    this.#currentServices.add(dayNightlightActiveService)
    this.#currentServices.add(nightNightlightActiveService)
  }

  /**
   * Setup card slot ContactSensor service
   * Shows if a card is inserted in the player
   */
  setupCardSlotService () {
    const { Service, Characteristic } = this.#platform
    const serviceName = this.generateServiceName('Card Slot')

    const service = this.#accessory.getServiceById(Service.ContactSensor, 'CardSlot') ||
      this.#accessory.addService(Service.ContactSensor, serviceName, 'CardSlot')
    syncServiceNames({ Characteristic, service, name: serviceName })

    service.getCharacteristic(Characteristic.ContactSensorState)
      .onGet(this.getCardSlotState.bind(this))

    this.cardSlotService = service
    this.#currentServices.add(service)
  }

  /**
   * Setup day mode ContactSensor service
   * Shows if device is in day mode (vs night mode)
   */
  setupDayModeService () {
    const { Service, Characteristic } = this.#platform
    const serviceName = this.generateServiceName('Day Mode')

    const service = this.#accessory.getServiceById(Service.ContactSensor, 'DayModeStatus') ||
      this.#accessory.addService(Service.ContactSensor, serviceName, 'DayModeStatus')
    syncServiceNames({ Characteristic, service, name: serviceName })

    service.getCharacteristic(Characteristic.ContactSensorState)
      .onGet(this.getDayModeStatus.bind(this))

    this.dayModeService = service
    this.#currentServices.add(service)
  }

  /**
   * Setup sleep timer Switch service
   * Toggle sleep timer on/off
   */
  setupSleepTimerService () {
    const { Service, Characteristic } = this.#platform
    const serviceName = this.generateServiceName('Sleep Timer')

    const service = this.#accessory.getServiceById(Service.Switch, 'SleepTimer') ||
      this.#accessory.addService(Service.Switch, serviceName, 'SleepTimer')
    syncServiceNames({ Characteristic, service, name: serviceName })

    service.getCharacteristic(Characteristic.On)
      .onGet(this.getSleepTimerState.bind(this))
      .onSet(this.setSleepTimerState.bind(this))

    this.sleepTimerService = service
    this.#currentServices.add(service)
  }

  /**
   * Setup Bluetooth Switch service
   * Toggle Bluetooth on/off
   */
  setupBluetoothService () {
    const { Service, Characteristic } = this.#platform
    const serviceName = this.generateServiceName('Bluetooth')

    const service = this.#accessory.getServiceById(Service.Switch, 'Bluetooth') ||
      this.#accessory.addService(Service.Switch, serviceName, 'Bluetooth')
    syncServiceNames({ Characteristic, service, name: serviceName })

    service.getCharacteristic(Characteristic.On)
      .onGet(this.getBluetoothState.bind(this))
      .onSet(this.setBluetoothState.bind(this))

    this.bluetoothService = service
    this.#currentServices.add(service)
  }

  /**
   * Setup volume limit Lightbulb services
   * Control day and night mode max volume limits
   */
  setupVolumeLimitServices () {
    const { Service, Characteristic } = this.#platform

    // Day Max Volume
    const dayName = this.generateServiceName('Day Max Volume')
    const dayService = this.#accessory.getServiceById(Service.Lightbulb, 'DayMaxVolume') ||
      this.#accessory.addService(Service.Lightbulb, dayName, 'DayMaxVolume')
    syncServiceNames({ Characteristic, service: dayService, name: dayName })

    dayService
      .getCharacteristic(Characteristic.On)
      .onGet(() => true)
      .onSet((value) => {
        if (!value) {
          dayService.updateCharacteristic(Characteristic.On, true)
        }
      })
    dayService.setCharacteristic(Characteristic.On, true)

    dayService
      .getCharacteristic(Characteristic.Brightness)
      .setProps({ minValue: 0, maxValue: 100, minStep: 1 })
      .onGet(this.getDayMaxVolume.bind(this))
      .onSet(this.setDayMaxVolume.bind(this))

    this.dayMaxVolumeService = dayService

    // Night Max Volume
    const nightName = this.generateServiceName('Night Max Volume')
    const nightService = this.#accessory.getServiceById(Service.Lightbulb, 'NightMaxVolume') ||
      this.#accessory.addService(Service.Lightbulb, nightName, 'NightMaxVolume')
    syncServiceNames({ Characteristic, service: nightService, name: nightName })

    nightService
      .getCharacteristic(Characteristic.On)
      .onGet(() => true)
      .onSet((value) => {
        if (!value) {
          nightService.updateCharacteristic(Characteristic.On, true)
        }
      })
    nightService.setCharacteristic(Characteristic.On, true)

    nightService
      .getCharacteristic(Characteristic.Brightness)
      .setProps({ minValue: 0, maxValue: 100, minStep: 1 })
      .onGet(this.getNightMaxVolume.bind(this))
      .onSet(this.setNightMaxVolume.bind(this))

    this.nightMaxVolumeService = nightService

    this.#currentServices.add(dayService)
    this.#currentServices.add(nightService)
  }

  /**
   * Setup card control Switch services
   */
  setupCardControlServices () {
    const cardControls = getCardControlConfigs(this.#platform.config)
    if (cardControls.length === 0) {
      return
    }

    const { Service, Characteristic } = this.#platform

    for (const control of cardControls) {
      const serviceName = this.generateServiceName(control.label)
      const subtype = `CardControl:${control.id}`

      const service = this.#accessory.getServiceById(Service.Switch, subtype) ||
        this.#accessory.addService(Service.Switch, serviceName, subtype)

      syncServiceNames({ Characteristic, service, name: serviceName })

      service
        .getCharacteristic(Characteristic.On)
        .onGet(() => false)
        .onSet(async (value) => {
          await this.setCardControl(service, control, value)
        })

      service.updateCharacteristic(Characteristic.On, false)

      this.#currentServices.add(service)
    }
  }

  /**
   * Setup event listeners for device model updates
   * Uses exhaustive switch pattern for type safety
   */
  setupEventListeners () {
    // Status updates - exhaustive field checking
    this.#deviceModel.on('statusUpdate', (status, _source, changedFields) => {
      for (const field of changedFields) {
        switch (field) {
          case 'volume':
            this.updateVolumeCharacteristic(status.volume)
            this.updateMuteCharacteristic(status.volume)
            break

          case 'batteryLevelPercentage':
            this.updateBatteryLevelCharacteristic(status.batteryLevelPercentage)
            this.updateLowBatteryCharacteristic(status.batteryLevelPercentage)
            break

          case 'isCharging':
            this.updateChargingStateCharacteristic(status.isCharging)
            break

          case 'isOnline':
            this.updateOnlineStatusCharacteristic(status.isOnline)
            break

          case 'firmwareVersion':
            this.updateFirmwareVersionCharacteristic(status.firmwareVersion)
            break

          case 'temperatureCelsius':
            if (this.#deviceModel.capabilities.hasTemperatureSensor && status.temperatureCelsius !== null) {
              this.updateTemperatureCharacteristic(status.temperatureCelsius)
            }
            break

          case 'nightlightMode':
            // Update nightlight status ContactSensors
            if (this.#deviceModel.capabilities.hasColoredNightlight) {
              this.updateNightlightStatusCharacteristics()
            }
            break

          case 'dayMode':
            // Update day mode ContactSensor
            this.updateDayModeCharacteristic()
            // Update nightlight status ContactSensors (depends on dayMode)
            if (this.#deviceModel.capabilities.hasColoredNightlight) {
              this.updateNightlightStatusCharacteristics()
            }
            break

          case 'cardInsertionState':
            this.updateCardSlotCharacteristic()
            break

          // Available but not yet mapped to characteristics
          case 'activeCardId':
          case 'maxVolume':
          case 'powerSource':
          case 'wifiStrength':
          case 'freeDiskSpaceBytes':
          case 'totalDiskSpaceBytes':
          case 'isAudioDeviceConnected':
          case 'isBluetoothAudioConnected':
          case 'ambientLightSensorReading':
          case 'displayBrightness':
          case 'timeFormat':
          case 'uptime':
          case 'updatedAt':
          case 'source':
            // Not implemented - empty case documents availability
            break

          default: {
            // Exhaustive check - TypeScript will error if a field is missed
            /** @type {never} */
            const _exhaustive = field
            this.#log.debug('Unhandled status field:', _exhaustive)
            break
          }
        }
      }
    })

    // Config updates - exhaustive field checking
    this.#deviceModel.on('configUpdate', (config, changedFields) => {
      const { Characteristic } = this.#platform

      for (const field of changedFields) {
        switch (field) {
          case 'dayDisplayBrightness':
          case 'dayDisplayBrightnessAuto': {
            if (this.dayNightlightService) {
              const raw = config.dayDisplayBrightnessAuto ? 100 : (config.dayDisplayBrightness ?? 100)
              const brightness = Math.max(0, Math.min(Math.round(raw), 100))
              this.dayNightlightService.updateCharacteristic(Characteristic.Brightness, brightness)
            }
            break
          }

          case 'nightDisplayBrightness':
          case 'nightDisplayBrightnessAuto': {
            if (this.nightNightlightService) {
              const raw = config.nightDisplayBrightnessAuto ? 100 : (config.nightDisplayBrightness ?? 100)
              const brightness = Math.max(0, Math.min(Math.round(raw), 100))
              this.nightNightlightService.updateCharacteristic(Characteristic.Brightness, brightness)
            }
            break
          }

          case 'ambientColour': {
            if (this.dayNightlightService) {
              const isOn = !this.isColorOff(config.ambientColour)
              this.dayNightlightService.updateCharacteristic(Characteristic.On, isOn)

              if (isOn) {
                const hex = this.parseHexColor(config.ambientColour)
                const [h, s] = convert.hex.hsv(hex)
                this.dayNightlightService.updateCharacteristic(Characteristic.Hue, h)
                this.dayNightlightService.updateCharacteristic(Characteristic.Saturation, s)
              }
            }
            break
          }

          case 'nightAmbientColour': {
            if (this.nightNightlightService) {
              const isOn = !this.isColorOff(config.nightAmbientColour)
              this.nightNightlightService.updateCharacteristic(Characteristic.On, isOn)

              if (isOn) {
                const hex = this.parseHexColor(config.nightAmbientColour)
                const [h, s] = convert.hex.hsv(hex)
                this.nightNightlightService.updateCharacteristic(Characteristic.Hue, h)
                this.nightNightlightService.updateCharacteristic(Characteristic.Saturation, s)
              }
            }
            break
          }

          case 'maxVolumeLimit':
            this.updateVolumeLimitCharacteristics()
            break

          case 'nightMaxVolumeLimit':
            this.updateVolumeLimitCharacteristics()
            break

          case 'bluetoothEnabled':
            this.updateBluetoothCharacteristic()
            break

          // Config fields available but not exposed as characteristics yet
          case 'alarms':
          case 'btHeadphonesEnabled':
          case 'clockFace':
          case 'dayTime':
          case 'nightTime':
          case 'dayYotoDaily':
          case 'nightYotoDaily':
          case 'dayYotoRadio':
          case 'nightYotoRadio':
          case 'nightYotoRadioEnabled':
          case 'daySoundsOff':
          case 'nightSoundsOff':
          case 'displayDimBrightness':
          case 'displayDimTimeout':
          case 'headphonesVolumeLimited':
          case 'hourFormat':
          case 'locale':
          case 'logLevel':
          case 'pausePowerButton':
          case 'pauseVolumeDown':
          case 'repeatAll':
          case 'showDiagnostics':
          case 'shutdownTimeout':
          case 'systemVolume':
          case 'timezone':
          case 'volumeLevel': {
            // Not exposed - empty case documents availability
            break
          }

          default: {
            /** @type {never} */
            const _exhaustive = field
            this.#log.debug('Unhandled config field:', _exhaustive)
            break
          }
        }
      }
    })

    // Playback updates - exhaustive field checking
    this.#deviceModel.on('playbackUpdate', (playback, changedFields) => {
      for (const field of changedFields) {
        switch (field) {
          case 'playbackStatus':
            this.updatePlaybackSwitchCharacteristic(playback.playbackStatus)
            break

          case 'position':
          case 'trackLength':
            break

          case 'sleepTimerActive':
            this.updateSleepTimerCharacteristic()
            break

          // Playback fields - informational only
          case 'cardId':
          case 'source':
          case 'trackTitle':
          case 'trackKey':
          case 'chapterTitle':
          case 'chapterKey':
          case 'sleepTimerSeconds':
          case 'streaming':
          case 'updatedAt': {
            // Not exposed as characteristics
            break
          }

          default: {
            /** @type {never} */
            const _exhaustive = field
            this.#log.debug('Unhandled playback field:', _exhaustive)
            break
          }
        }
      }
    })

    // Lifecycle events
    this.#deviceModel.on('online', ({ reason: _reason }) => {
      // Platform logs online/offline events to avoid duplicate output.
      this.updateOnlineStatusCharacteristic(true)
    })

    this.#deviceModel.on('offline', ({ reason: _reason }) => {
      // Platform logs online/offline events to avoid duplicate output.
      this.updateOnlineStatusCharacteristic(false)
    })

    this.#deviceModel.on('error', (error) => {
      const details = error instanceof Error ? (error.stack || error.message) : String(error)
      this.#log.error(`[${this.#device.name}] Device error:`, details)
    })
  }

  // ==================== Playback (Switch) Characteristic Handlers ====================

  /**
   * Get play/pause state as a Switch "On" value
   * @returns {Promise<CharacteristicValue>}
   */
  async getPlaybackOn () {
    const isOn = this.#deviceModel.playback.playbackStatus === 'playing'
    this.#log.debug(LOG_PREFIX.ACCESSORY, `[${this.#device.name}] Get playback switch -> ${isOn}`)
    return isOn
  }

  /**
   * Set play/pause state via Switch "On"
   * @param {CharacteristicValue} value
   * @returns {Promise<void>}
   */
  async setPlaybackOn (value) {
    const isOn = Boolean(value)
    this.#log.debug(LOG_PREFIX.ACCESSORY, `[${this.#device.name}] Set playback switch:`, isOn)

    try {
      if (isOn) {
        await this.#deviceModel.resumeCard()
      } else {
        await this.#deviceModel.pauseCard()
      }
    } catch (error) {
      this.#log.error(LOG_PREFIX.ACCESSORY, `[${this.#device.name}] Failed to set playback state:`, error)
      throw new this.#platform.api.hap.HapStatusError(
        this.#platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE
      )
    }
  }

  /**
   * Get volume level as percentage (mapped from 0-16 steps)
   * @returns {Promise<CharacteristicValue>}
   */
  async getVolume () {
    const volumeSteps = this.#deviceModel.status.volume
    const normalizedSteps = Number.isFinite(volumeSteps) ? volumeSteps : 0
    const clampedSteps = Math.max(0, Math.min(normalizedSteps, 16))
    const percent = Math.round((clampedSteps / 16) * 100)
    this.#log.debug(
      LOG_PREFIX.ACCESSORY,
      `[${this.#device.name}] Get volume rawSteps=${volumeSteps} percent=${percent}`
    )
    return percent
  }

  /**
   * Set volume level as percentage (mapped to 0-16 steps)
   * @param {CharacteristicValue} value
   * @returns {Promise<void>}
   */
  async setVolume (value) {
    const deviceModel = this.#deviceModel
    this.#log.debug(LOG_PREFIX.ACCESSORY, `[${this.#device.name}] Set volume:`, value)

    const requestedPercent = typeof value === 'number' ? value : Number(value)
    if (!Number.isFinite(requestedPercent)) {
      throw new this.#platform.api.hap.HapStatusError(
        this.#platform.api.hap.HAPStatus.INVALID_VALUE_IN_REQUEST
      )
    }

    const normalizedPercent = Math.max(0, Math.min(Math.round(requestedPercent), 100))
    const requestedSteps = Math.round((normalizedPercent / 100) * 16)
    const steps = Math.max(0, Math.min(Math.round(requestedSteps), 16))
    const resultPercent = Math.round((steps / 16) * 100)
    this.#log.debug(
      LOG_PREFIX.ACCESSORY,
      `[${this.#device.name}] Set volume raw=${value} normalizedPercent=${normalizedPercent} requestedSteps=${requestedSteps} -> steps=${steps} percent=${resultPercent}`
    )

    // Track last non-zero volume for unmute
    if (steps > 0) {
      this.#lastNonZeroVolume = Math.round((steps / 16) * 100)
    }

    try {
      await deviceModel.setVolume(steps)
      if (this.volumeService) {
        const { Characteristic } = this.#platform
        const clampedPercent = Math.round((steps / 16) * 100)
        this.volumeService
          .getCharacteristic(Characteristic.On)
          .updateValue(steps > 0)

        if (steps !== requestedSteps || normalizedPercent !== requestedPercent) {
          this.volumeService
            .getCharacteristic(Characteristic.Brightness)
            .updateValue(clampedPercent)
        }
      }
    } catch (error) {
      this.#log.error(LOG_PREFIX.ACCESSORY, `[${this.#device.name}] Failed to set volume:`, error)
      throw new this.#platform.api.hap.HapStatusError(
        this.#platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE
      )
    }
  }

  /**
   * Get volume On state (derived from volume > 0)
   * @returns {Promise<CharacteristicValue>}
   */
  async getVolumeOn () {
    const isOn = this.#deviceModel.status.volume > 0
    this.#log.debug(LOG_PREFIX.ACCESSORY, `[${this.#device.name}] Get volume on -> ${isOn}`)
    return isOn
  }

  /**
   * Set volume On state (mute/unmute)
   * @param {CharacteristicValue} value
   * @returns {Promise<void>}
   */
  async setVolumeOn (value) {
    this.#log.debug(LOG_PREFIX.ACCESSORY, `[${this.#device.name}] Set volume on:`, value)

    const isOn = Boolean(value)
    const currentVolume = this.#deviceModel.status.volume

    if (!isOn) {
      if (currentVolume !== 0) {
        await this.setVolume(0)
      }
      return
    }

    if (currentVolume === 0) {
      await this.setVolume(this.#lastNonZeroVolume)
    }
  }

  /**
   * Get status active (online/offline)
   * @returns {Promise<CharacteristicValue>}
   */
  async getStatusActive () {
    const isOnline = this.#deviceModel.status.isOnline
    this.#log.debug(LOG_PREFIX.ACCESSORY, `[${this.#device.name}] Get status active -> ${isOnline}`)
    return isOnline
  }

  /**
   * Get online status as a ContactSensorState
   * @returns {Promise<CharacteristicValue>}
   */
  async getOnlineStatus () {
    const { Characteristic } = this.#platform
    const isOnline = this.#deviceModel.status.isOnline
    this.#log.debug(LOG_PREFIX.ACCESSORY, `[${this.#device.name}] Get online status -> ${isOnline}`)
    return isOnline
      ? Characteristic.ContactSensorState.CONTACT_NOT_DETECTED
      : Characteristic.ContactSensorState.CONTACT_DETECTED
  }

  // ==================== Battery Characteristic Handlers ====================

  /**
   * Get battery level (0-100) from live status
   * @returns {Promise<CharacteristicValue>}
   */
  async getBatteryLevel () {
    const battery = this.#deviceModel.status.batteryLevelPercentage
    const level = Number.isFinite(battery) ? battery : 100
    this.#log.debug(LOG_PREFIX.ACCESSORY, `[${this.#device.name}] Get battery level -> ${level}`)
    return level
  }

  /**
   * Get charging state from live status
   * @returns {Promise<CharacteristicValue>}
   */
  async getChargingState () {
    const isCharging = this.#deviceModel.status.isCharging
    this.#log.debug(LOG_PREFIX.ACCESSORY, `[${this.#device.name}] Get charging state -> ${isCharging}`)
    return isCharging
      ? this.#platform.Characteristic.ChargingState.CHARGING
      : this.#platform.Characteristic.ChargingState.NOT_CHARGING
  }

  /**
   * Get low battery status from live status
   * @returns {Promise<CharacteristicValue>}
   */
  async getStatusLowBattery () {
    const battery = this.#deviceModel.status.batteryLevelPercentage
    const batteryLevel = Number.isFinite(battery) ? battery : 100
    this.#log.debug(LOG_PREFIX.ACCESSORY, `[${this.#device.name}] Get low battery -> ${batteryLevel}`)
    return batteryLevel <= LOW_BATTERY_THRESHOLD
      ? this.#platform.Characteristic.StatusLowBattery.BATTERY_LEVEL_LOW
      : this.#platform.Characteristic.StatusLowBattery.BATTERY_LEVEL_NORMAL
  }

  // ==================== TemperatureSensor Characteristic Handlers ====================

  /**
   * Get current temperature from live status
   * @returns {Promise<CharacteristicValue>}
   */
  async getCurrentTemperature () {
    const temp = this.#deviceModel.status.temperatureCelsius

    // Return a default value if temperature is not available
    if (temp === null || temp === 'notSupported') {
      this.#log.debug(LOG_PREFIX.ACCESSORY, `[${this.#device.name}] Get temperature -> unavailable`)
      return 0
    }

    this.#log.debug(LOG_PREFIX.ACCESSORY, `[${this.#device.name}] Get temperature -> ${temp}`)
    return Number(temp)
  }

  /**
   * Get temperature sensor fault status
   * @returns {Promise<CharacteristicValue>}
   */
  async getTemperatureSensorFault () {
    // Report fault if device is offline or temperature is not available
    const isOffline = !this.#deviceModel.status.isOnline
    const temp = this.#deviceModel.status.temperatureCelsius
    const isUnavailable = temp === null || temp === 'notSupported'
    const isFault = isOffline || isUnavailable
    const fault = isFault
      ? this.#platform.Characteristic.StatusFault.GENERAL_FAULT
      : this.#platform.Characteristic.StatusFault.NO_FAULT
    this.#log.debug(
      LOG_PREFIX.ACCESSORY,
      `[${this.#device.name}] Get temperature sensor fault -> ${isFault} (online=${!isOffline} temp=${temp})`
    )
    return fault
  }

  // ==================== Nightlight Characteristic Handlers ====================

  /**
   * Helper: Parse hex color (handles both '0xRRGGBB' and '#RRGGBB' formats)
   * @param {string} hexColor - Hex color string
   * @returns {string} - Normalized hex without prefix (RRGGBB)
   */
  parseHexColor (hexColor) {
    if (!hexColor) return '000000'
    // Remove '0x' or '#' prefix
    return hexColor.replace(/^(0x|#)/, '')
  }

  /**
   * Helper: Format hex color to Yoto format (0xRRGGBB)
   * @param {string} hex - Hex color without prefix (RRGGBB)
   * @returns {string} - Formatted as '0xRRGGBB'
   */
  formatHexColor (hex) {
    return `0x${hex}`
  }

  /**
   * Helper: Check if color is "off" (black or 'off' string)
   * @param {string} color - Color value
   * @returns {boolean}
   */
  isColorOff (color) {
    return !color || color === 'off' || color === '0x000000' || color === '#000000' || color === '000000'
  }

  // ---------- Day Nightlight Handlers ----------

  /**
   * Get day nightlight on/off state
   * @returns {Promise<CharacteristicValue>}
   */
  async getDayNightlightOn () {
    const color = this.#deviceModel.config.ambientColour
    const isOn = !this.isColorOff(color)
    this.#log.debug(LOG_PREFIX.ACCESSORY, `[${this.#device.name}] Get day nightlight on -> ${isOn} (${color})`)
    return isOn
  }

  /**
   * Set day nightlight on/off state
   * @param {CharacteristicValue} value
   */
  async setDayNightlightOn (value) {
    try {
      if (value) {
        // Turn ON - restore previous color or default to white
        const colorToSet = this.#lastDayColor || '0xffffff'
        this.#log.debug(LOG_PREFIX.ACCESSORY, `Turning day nightlight ON with color: ${colorToSet}`)
        await this.#deviceModel.updateConfig({ ambientColour: colorToSet })
      } else {
        // Turn OFF - save current color and set to black
        const currentColor = this.#deviceModel.config.ambientColour
        if (!this.isColorOff(currentColor)) {
          this.#lastDayColor = currentColor
        }
        this.#log.debug(LOG_PREFIX.ACCESSORY, 'Turning day nightlight OFF')
        await this.#deviceModel.updateConfig({ ambientColour: '0x000000' })
      }
    } catch (error) {
      this.#log.error(LOG_PREFIX.ACCESSORY, `[${this.#device.name}] Failed to set day nightlight:`, error)
      throw new this.#platform.api.hap.HapStatusError(
        this.#platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE
      )
    }
  }

  /**
   * Get day nightlight brightness (screen brightness)
   * @returns {Promise<CharacteristicValue>}
   */
  async getDayNightlightBrightness () {
    const config = this.#deviceModel.config
    const isAuto = config.dayDisplayBrightnessAuto
    const raw = config.dayDisplayBrightness
    const brightness = isAuto || raw === null
      ? 100
      : Math.max(0, Math.min(Math.round(raw), 100))
    this.#log.debug(
      LOG_PREFIX.ACCESSORY,
      `[${this.#device.name}] Get day nightlight brightness -> ${brightness} (raw=${raw} auto=${isAuto})`
    )
    return brightness
  }

  /**
   * Set day nightlight brightness (screen brightness)
   * @param {CharacteristicValue} value
   */
  async setDayNightlightBrightness (value) {
    const rawBrightness = Number(value)
    if (!Number.isFinite(rawBrightness)) {
      throw new this.#platform.api.hap.HapStatusError(
        this.#platform.api.hap.HAPStatus.INVALID_VALUE_IN_REQUEST
      )
    }

    const brightnessValue = Math.max(0, Math.min(Math.round(rawBrightness), 100))
    this.#log.debug(LOG_PREFIX.ACCESSORY, `Setting day display brightness: ${brightnessValue}`)
    try {
      await this.#deviceModel.updateConfig({
        dayDisplayBrightness: brightnessValue,
        dayDisplayBrightnessAuto: false
      })
    } catch (error) {
      this.#log.error(LOG_PREFIX.ACCESSORY, `[${this.#device.name}] Failed to set day brightness:`, error)
      throw new this.#platform.api.hap.HapStatusError(
        this.#platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE
      )
    }
  }

  /**
   * Get day nightlight hue
   * @returns {Promise<CharacteristicValue>}
   */
  async getDayNightlightHue () {
    const color = this.#deviceModel.config.ambientColour
    if (this.isColorOff(color)) {
      this.#log.debug(LOG_PREFIX.ACCESSORY, `[${this.#device.name}] Get day nightlight hue -> 0 (off)`)
      return 0
    }
    const hex = this.parseHexColor(color)
    const [h] = convert.hex.hsv(hex)
    this.#log.debug(LOG_PREFIX.ACCESSORY, `[${this.#device.name}] Get day nightlight hue -> ${h} (${color})`)
    return h
  }

  /**
   * Set day nightlight hue
   * @param {CharacteristicValue} value
   */
  async setDayNightlightHue (value) {
    const rawHue = Number(value)
    if (!Number.isFinite(rawHue)) {
      throw new this.#platform.api.hap.HapStatusError(
        this.#platform.api.hap.HAPStatus.INVALID_VALUE_IN_REQUEST
      )
    }
    const hue = Math.max(0, Math.min(rawHue, 360))

    // Get current saturation to maintain it
    const currentColor = this.#deviceModel.config.ambientColour
    let saturation = 100
    if (!this.isColorOff(currentColor)) {
      const hex = this.parseHexColor(currentColor)
      const [, s] = convert.hex.hsv(hex)
      saturation = s
    }

    // Convert HSV to hex (use full value/brightness for color)
    const newHex = convert.hsv.hex([hue, saturation, 100])
    const formattedColor = this.formatHexColor(newHex)

    this.#log.debug(LOG_PREFIX.ACCESSORY, `Setting day nightlight hue: ${hue}° → ${formattedColor}`)
    try {
      await this.#deviceModel.updateConfig({ ambientColour: formattedColor })
    } catch (error) {
      this.#log.error(LOG_PREFIX.ACCESSORY, `[${this.#device.name}] Failed to set day nightlight hue:`, error)
      throw new this.#platform.api.hap.HapStatusError(
        this.#platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE
      )
    }
  }

  /**
   * Get day nightlight saturation
   * @returns {Promise<CharacteristicValue>}
   */
  async getDayNightlightSaturation () {
    const color = this.#deviceModel.config.ambientColour
    if (this.isColorOff(color)) {
      this.#log.debug(LOG_PREFIX.ACCESSORY, `[${this.#device.name}] Get day nightlight saturation -> 0 (off)`)
      return 0
    }
    const hex = this.parseHexColor(color)
    const [, s] = convert.hex.hsv(hex)
    this.#log.debug(LOG_PREFIX.ACCESSORY, `[${this.#device.name}] Get day nightlight saturation -> ${s} (${color})`)
    return s
  }

  /**
   * Set day nightlight saturation
   * @param {CharacteristicValue} value
   */
  async setDayNightlightSaturation (value) {
    const rawSaturation = Number(value)
    if (!Number.isFinite(rawSaturation)) {
      throw new this.#platform.api.hap.HapStatusError(
        this.#platform.api.hap.HAPStatus.INVALID_VALUE_IN_REQUEST
      )
    }
    const saturation = Math.max(0, Math.min(rawSaturation, 100))

    // Get current hue to maintain it
    const currentColor = this.#deviceModel.config.ambientColour
    let hue = 0
    if (!this.isColorOff(currentColor)) {
      const hex = this.parseHexColor(currentColor)
      const [h] = convert.hex.hsv(hex)
      hue = h
    }

    // Convert HSV to hex (use full value/brightness for color)
    const newHex = convert.hsv.hex([hue, saturation, 100])
    const formattedColor = this.formatHexColor(newHex)

    this.#log.debug(LOG_PREFIX.ACCESSORY, `Setting day nightlight saturation: ${saturation}% → ${formattedColor}`)
    try {
      await this.#deviceModel.updateConfig({ ambientColour: formattedColor })
    } catch (error) {
      this.#log.error(LOG_PREFIX.ACCESSORY, `[${this.#device.name}] Failed to set day nightlight saturation:`, error)
      throw new this.#platform.api.hap.HapStatusError(
        this.#platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE
      )
    }
  }

  // ---------- Night Nightlight Handlers ----------

  /**
   * Get night nightlight on/off state
   * @returns {Promise<CharacteristicValue>}
   */
  async getNightNightlightOn () {
    const color = this.#deviceModel.config.nightAmbientColour
    const isOn = !this.isColorOff(color)
    this.#log.debug(LOG_PREFIX.ACCESSORY, `[${this.#device.name}] Get night nightlight on -> ${isOn} (${color})`)
    return isOn
  }

  /**
   * Set night nightlight on/off state
   * @param {CharacteristicValue} value
   */
  async setNightNightlightOn (value) {
    try {
      if (value) {
        // Turn ON - restore previous color or default to white
        const colorToSet = this.#lastNightColor || '0xffffff'
        this.#log.debug(LOG_PREFIX.ACCESSORY, `Turning night nightlight ON with color: ${colorToSet}`)
        await this.#deviceModel.updateConfig({ nightAmbientColour: colorToSet })
      } else {
        // Turn OFF - save current color and set to black
        const currentColor = this.#deviceModel.config.nightAmbientColour
        if (!this.isColorOff(currentColor)) {
          this.#lastNightColor = currentColor
        }
        this.#log.debug(LOG_PREFIX.ACCESSORY, 'Turning night nightlight OFF')
        await this.#deviceModel.updateConfig({ nightAmbientColour: '0x000000' })
      }
    } catch (error) {
      this.#log.error(LOG_PREFIX.ACCESSORY, `[${this.#device.name}] Failed to set night nightlight:`, error)
      throw new this.#platform.api.hap.HapStatusError(
        this.#platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE
      )
    }
  }

  /**
   * Get night nightlight brightness (screen brightness)
   * @returns {Promise<CharacteristicValue>}
   */
  async getNightNightlightBrightness () {
    const config = this.#deviceModel.config
    const isAuto = config.nightDisplayBrightnessAuto
    const raw = config.nightDisplayBrightness
    const brightness = isAuto || raw === null
      ? 100
      : Math.max(0, Math.min(Math.round(raw), 100))
    this.#log.debug(
      LOG_PREFIX.ACCESSORY,
      `[${this.#device.name}] Get night nightlight brightness -> ${brightness} (raw=${raw} auto=${isAuto})`
    )
    return brightness
  }

  /**
   * Set night nightlight brightness (screen brightness)
   * @param {CharacteristicValue} value
   */
  async setNightNightlightBrightness (value) {
    const rawBrightness = Number(value)
    if (!Number.isFinite(rawBrightness)) {
      throw new this.#platform.api.hap.HapStatusError(
        this.#platform.api.hap.HAPStatus.INVALID_VALUE_IN_REQUEST
      )
    }

    const brightnessValue = Math.max(0, Math.min(Math.round(rawBrightness), 100))
    this.#log.debug(LOG_PREFIX.ACCESSORY, `Setting night display brightness: ${brightnessValue}`)
    try {
      await this.#deviceModel.updateConfig({
        nightDisplayBrightness: brightnessValue,
        nightDisplayBrightnessAuto: false
      })
    } catch (error) {
      this.#log.error(LOG_PREFIX.ACCESSORY, `[${this.#device.name}] Failed to set night brightness:`, error)
      throw new this.#platform.api.hap.HapStatusError(
        this.#platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE
      )
    }
  }

  /**
   * Get night nightlight hue
   * @returns {Promise<CharacteristicValue>}
   */
  async getNightNightlightHue () {
    const color = this.#deviceModel.config.nightAmbientColour
    if (this.isColorOff(color)) {
      this.#log.debug(LOG_PREFIX.ACCESSORY, `[${this.#device.name}] Get night nightlight hue -> 0 (off)`)
      return 0
    }
    const hex = this.parseHexColor(color)
    const [h] = convert.hex.hsv(hex)
    this.#log.debug(LOG_PREFIX.ACCESSORY, `[${this.#device.name}] Get night nightlight hue -> ${h} (${color})`)
    return h
  }

  /**
   * Set night nightlight hue
   * @param {CharacteristicValue} value
   */
  async setNightNightlightHue (value) {
    const rawHue = Number(value)
    if (!Number.isFinite(rawHue)) {
      throw new this.#platform.api.hap.HapStatusError(
        this.#platform.api.hap.HAPStatus.INVALID_VALUE_IN_REQUEST
      )
    }
    const hue = Math.max(0, Math.min(rawHue, 360))

    // Get current saturation to maintain it
    const currentColor = this.#deviceModel.config.nightAmbientColour
    let saturation = 100
    if (!this.isColorOff(currentColor)) {
      const hex = this.parseHexColor(currentColor)
      const [, s] = convert.hex.hsv(hex)
      saturation = s
    }

    // Convert HSV to hex (use full value/brightness for color)
    const newHex = convert.hsv.hex([hue, saturation, 100])
    const formattedColor = this.formatHexColor(newHex)

    this.#log.debug(LOG_PREFIX.ACCESSORY, `Setting night nightlight hue: ${hue}° → ${formattedColor}`)
    try {
      await this.#deviceModel.updateConfig({ nightAmbientColour: formattedColor })
    } catch (error) {
      this.#log.error(LOG_PREFIX.ACCESSORY, `[${this.#device.name}] Failed to set night nightlight hue:`, error)
      throw new this.#platform.api.hap.HapStatusError(
        this.#platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE
      )
    }
  }

  /**
   * Get night nightlight saturation
   * @returns {Promise<CharacteristicValue>}
   */
  async getNightNightlightSaturation () {
    const color = this.#deviceModel.config.nightAmbientColour
    if (this.isColorOff(color)) {
      this.#log.debug(LOG_PREFIX.ACCESSORY, `[${this.#device.name}] Get night nightlight saturation -> 0 (off)`)
      return 0
    }
    const hex = this.parseHexColor(color)
    const [, s] = convert.hex.hsv(hex)
    this.#log.debug(LOG_PREFIX.ACCESSORY, `[${this.#device.name}] Get night nightlight saturation -> ${s} (${color})`)
    return s
  }

  /**
   * Set night nightlight saturation
   * @param {CharacteristicValue} value
   */
  async setNightNightlightSaturation (value) {
    const rawSaturation = Number(value)
    if (!Number.isFinite(rawSaturation)) {
      throw new this.#platform.api.hap.HapStatusError(
        this.#platform.api.hap.HAPStatus.INVALID_VALUE_IN_REQUEST
      )
    }
    const saturation = Math.max(0, Math.min(rawSaturation, 100))

    // Get current hue to maintain it
    const currentColor = this.#deviceModel.config.nightAmbientColour
    let hue = 0
    if (!this.isColorOff(currentColor)) {
      const hex = this.parseHexColor(currentColor)
      const [h] = convert.hex.hsv(hex)
      hue = h
    }

    // Convert HSV to hex (use full value/brightness for color)
    const newHex = convert.hsv.hex([hue, saturation, 100])
    const formattedColor = this.formatHexColor(newHex)

    this.#log.debug(LOG_PREFIX.ACCESSORY, `Setting night nightlight saturation: ${saturation}% → ${formattedColor}`)
    try {
      await this.#deviceModel.updateConfig({ nightAmbientColour: formattedColor })
    } catch (error) {
      this.#log.error(LOG_PREFIX.ACCESSORY, `[${this.#device.name}] Failed to set night nightlight saturation:`, error)
      throw new this.#platform.api.hap.HapStatusError(
        this.#platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE
      )
    }
  }

  // ==================== Nightlight Status ContactSensor Getters ====================

  /**
   * Get nightlight active state
   * @returns {Promise<CharacteristicValue>}
   */
  async getNightlightActive () {
    const { Characteristic } = this.#platform
    const status = this.#deviceModel.status
    const isActive = status.nightlightMode !== 'off'
    this.#log.debug(LOG_PREFIX.ACCESSORY, `[${this.#device.name}] Get nightlight active -> ${isActive}`)
    return isActive ? Characteristic.ContactSensorState.CONTACT_NOT_DETECTED : Characteristic.ContactSensorState.CONTACT_DETECTED
  }

  /**
   * Get day nightlight active state
   * @returns {Promise<CharacteristicValue>}
   */
  async getDayNightlightActive () {
    const { Characteristic } = this.#platform
    const status = this.#deviceModel.status
    const isDay = status.dayMode === 'day'
    const isActive = status.nightlightMode !== 'off'
    const isShowing = isDay && isActive
    this.#log.debug(
      LOG_PREFIX.ACCESSORY,
      `[${this.#device.name}] Get day nightlight active -> ${isShowing} (day=${isDay} active=${isActive})`
    )
    return isShowing ? Characteristic.ContactSensorState.CONTACT_NOT_DETECTED : Characteristic.ContactSensorState.CONTACT_DETECTED
  }

  /**
   * Get night nightlight active state
   * @returns {Promise<CharacteristicValue>}
   */
  async getNightNightlightActive () {
    const { Characteristic } = this.#platform
    const status = this.#deviceModel.status
    const isNight = status.dayMode === 'night'
    const isActive = status.nightlightMode !== 'off'
    const isShowing = isNight && isActive
    this.#log.debug(
      LOG_PREFIX.ACCESSORY,
      `[${this.#device.name}] Get night nightlight active -> ${isShowing} (night=${isNight} active=${isActive})`
    )
    return isShowing ? Characteristic.ContactSensorState.CONTACT_NOT_DETECTED : Characteristic.ContactSensorState.CONTACT_DETECTED
  }

  // ==================== Card Slot ContactSensor Getter ====================

  /**
   * Get card slot state
   * @returns {Promise<CharacteristicValue>}
   */
  async getCardSlotState () {
    const { Characteristic } = this.#platform
    const status = this.#deviceModel.status
    const hasCard = status.cardInsertionState !== 'none'
    this.#log.debug(LOG_PREFIX.ACCESSORY, `[${this.#device.name}] Get card slot -> ${hasCard} (${status.cardInsertionState})`)
    return hasCard ? Characteristic.ContactSensorState.CONTACT_NOT_DETECTED : Characteristic.ContactSensorState.CONTACT_DETECTED
  }

  // ==================== Day Mode ContactSensor Getter ====================

  /**
   * Get day mode status
   * @returns {Promise<CharacteristicValue>}
   */
  async getDayModeStatus () {
    const { Characteristic } = this.#platform
    const status = this.#deviceModel.status
    const isDayMode = status.dayMode === 'day'
    this.#log.debug(LOG_PREFIX.ACCESSORY, `[${this.#device.name}] Get day mode -> ${isDayMode}`)
    return isDayMode
      ? Characteristic.ContactSensorState.CONTACT_NOT_DETECTED
      : Characteristic.ContactSensorState.CONTACT_DETECTED
  }

  // ==================== Sleep Timer Switch Getter/Setter ====================

  /**
   * Get sleep timer state
   * @returns {Promise<CharacteristicValue>}
   */
  async getSleepTimerState () {
    const playback = this.#deviceModel.playback
    this.#log.debug(
      LOG_PREFIX.ACCESSORY,
      `[${this.#device.name}] Get sleep timer -> ${playback.sleepTimerActive ?? false}`
    )
    return playback.sleepTimerActive ?? false
  }

  /**
   * Set sleep timer state
   * @param {CharacteristicValue} value
   */
  async setSleepTimerState (value) {
    const enabled = Boolean(value)

    try {
      if (enabled) {
        // Turn on sleep timer - default to 30 minutes
        this.#log.debug(LOG_PREFIX.ACCESSORY, 'Activating sleep timer (30 minutes)')
        await this.#deviceModel.setSleepTimer(30 * 60)
      } else {
        // Turn off sleep timer
        this.#log.debug(LOG_PREFIX.ACCESSORY, 'Deactivating sleep timer')
        await this.#deviceModel.setSleepTimer(0)
      }
    } catch (error) {
      this.#log.error(LOG_PREFIX.ACCESSORY, `[${this.#device.name}] Failed to set sleep timer:`, error)
      throw new this.#platform.api.hap.HapStatusError(
        this.#platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE
      )
    }
  }

  // ==================== Bluetooth Switch Getter/Setter ====================

  /**
   * Get Bluetooth state
   * @returns {Promise<CharacteristicValue>}
   */
  async getBluetoothState () {
    const enabled = this.#deviceModel.config.bluetoothEnabled ?? false
    this.#log.debug(LOG_PREFIX.ACCESSORY, `[${this.#device.name}] Get Bluetooth -> ${enabled}`)
    return enabled
  }

  /**
   * Set Bluetooth state
   * @param {CharacteristicValue} value
   */
  async setBluetoothState (value) {
    const enabled = Boolean(value)
    this.#log.debug(LOG_PREFIX.ACCESSORY, `Setting Bluetooth: ${enabled ? 'ON' : 'OFF'}`)
    try {
      await this.#deviceModel.updateConfig({ bluetoothEnabled: enabled })
    } catch (error) {
      this.#log.error(LOG_PREFIX.ACCESSORY, `[${this.#device.name}] Failed to set Bluetooth:`, error)
      throw new this.#platform.api.hap.HapStatusError(
        this.#platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE
      )
    }
  }

  // ==================== Card Control Switch Setter ====================

  /**
   * Trigger card playback for a configured card control.
   * @param {Service} service
   * @param {CardControlConfig} control
   * @param {CharacteristicValue} value
   * @returns {Promise<void>}
   */
  async setCardControl (service, control, value) {
    const { Characteristic } = this.#platform
    const isOn = Boolean(value)
    this.#log.debug(
      LOG_PREFIX.ACCESSORY,
      `[${this.#device.name}] Set card control: ${control.label} (${control.cardId}) -> ${isOn}`
    )

    if (!isOn) {
      service.getCharacteristic(Characteristic.On).updateValue(false)
      return
    }

    if (!this.#deviceModel.status.isOnline) {
      this.#log.warn(LOG_PREFIX.ACCESSORY, `[${this.#device.name}] Card control skipped (offline): ${control.label}`)
      service.getCharacteristic(Characteristic.On).updateValue(false)
      throw new this.#platform.api.hap.HapStatusError(
        this.#platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE
      )
    }

    this.#log.debug(
      LOG_PREFIX.ACCESSORY,
      `[${this.#device.name}] Play card control: ${control.label} (${control.cardId})`
    )

    try {
      await this.#deviceModel.startCard({ cardId: control.cardId })
    } catch (error) {
      this.#log.error(
        LOG_PREFIX.ACCESSORY,
        `[${this.#device.name}] Failed to play card ${control.cardId}:`,
        error
      )
      service.getCharacteristic(Characteristic.On).updateValue(false)
      throw new this.#platform.api.hap.HapStatusError(
        this.#platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE
      )
    }

    service.getCharacteristic(Characteristic.On).updateValue(false)
  }

  // ==================== Volume Limit Lightbulb Getters/Setters ====================

  /**
   * Get day max volume limit as percentage (mapped from 0-16 steps)
   * @returns {Promise<CharacteristicValue>}
   */
  async getDayMaxVolume () {
    const limit = this.#deviceModel.config.maxVolumeLimit
    const steps = Number.isFinite(limit) ? limit : 16
    const clampedSteps = Math.max(0, Math.min(steps, 16))
    const percent = Math.round((clampedSteps / 16) * 100)
    this.#log.debug(
      LOG_PREFIX.ACCESSORY,
      `[${this.#device.name}] Get day max volume limit rawSteps=${limit} percent=${percent}`
    )
    return percent
  }

  /**
   * Set day max volume limit as percentage (mapped to 0-16 steps)
   * @param {CharacteristicValue} value
   */
  async setDayMaxVolume (value) {
    const requestedPercent = typeof value === 'number' ? value : Number(value)
    if (!Number.isFinite(requestedPercent)) {
      throw new this.#platform.api.hap.HapStatusError(
        this.#platform.api.hap.HAPStatus.INVALID_VALUE_IN_REQUEST
      )
    }

    const normalizedPercent = Math.max(0, Math.min(Math.round(requestedPercent), 100))
    const requestedSteps = Math.round((normalizedPercent / 100) * 16)
    const limit = Math.max(0, Math.min(Math.round(requestedSteps), 16))
    const limitPercent = Math.round((limit / 16) * 100)
    this.#log.debug(
      LOG_PREFIX.ACCESSORY,
      `[${this.#device.name}] Set day max volume limit raw=${value} normalizedPercent=${normalizedPercent} requestedSteps=${requestedSteps} -> steps=${limit} percent=${limitPercent}`
    )
    try {
      await this.#deviceModel.updateConfig({ maxVolumeLimit: limit })
    } catch (error) {
      this.#log.error(LOG_PREFIX.ACCESSORY, `[${this.#device.name}] Failed to set day max volume limit:`, error)
      throw new this.#platform.api.hap.HapStatusError(
        this.#platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE
      )
    }
  }

  /**
   * Get night max volume limit as percentage (mapped from 0-16 steps)
   * @returns {Promise<CharacteristicValue>}
   */
  async getNightMaxVolume () {
    const limit = this.#deviceModel.config.nightMaxVolumeLimit
    const steps = Number.isFinite(limit) ? limit : 10
    const clampedSteps = Math.max(0, Math.min(steps, 16))
    const percent = Math.round((clampedSteps / 16) * 100)
    this.#log.debug(
      LOG_PREFIX.ACCESSORY,
      `[${this.#device.name}] Get night max volume limit rawSteps=${limit} percent=${percent}`
    )
    return percent
  }

  /**
   * Set night max volume limit as percentage (mapped to 0-16 steps)
   * @param {CharacteristicValue} value
   */
  async setNightMaxVolume (value) {
    const requestedPercent = typeof value === 'number' ? value : Number(value)
    if (!Number.isFinite(requestedPercent)) {
      throw new this.#platform.api.hap.HapStatusError(
        this.#platform.api.hap.HAPStatus.INVALID_VALUE_IN_REQUEST
      )
    }

    const normalizedPercent = Math.max(0, Math.min(Math.round(requestedPercent), 100))
    const requestedSteps = Math.round((normalizedPercent / 100) * 16)
    const limit = Math.max(0, Math.min(Math.round(requestedSteps), 16))
    const limitPercent = Math.round((limit / 16) * 100)
    this.#log.debug(
      LOG_PREFIX.ACCESSORY,
      `[${this.#device.name}] Set night max volume limit raw=${value} normalizedPercent=${normalizedPercent} requestedSteps=${requestedSteps} -> steps=${limit} percent=${limitPercent}`
    )
    try {
      await this.#deviceModel.updateConfig({ nightMaxVolumeLimit: limit })
    } catch (error) {
      this.#log.error(LOG_PREFIX.ACCESSORY, `[${this.#device.name}] Failed to set night max volume limit:`, error)
      throw new this.#platform.api.hap.HapStatusError(
        this.#platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE
      )
    }
  }

  // ==================== Characteristic Update Methods ====================

  /**
   * Update playback switch characteristic
   * @param { "playing" | "paused" | "stopped" | "loading" | null} playbackStatus - Playback status
   */
  updatePlaybackSwitchCharacteristic (playbackStatus) {
    if (!this.playbackService) return

    const { Characteristic } = this.#platform
    const isOn = playbackStatus === 'playing'
    this.playbackService
      .getCharacteristic(Characteristic.On)
      .updateValue(isOn)
  }

  /**
   * Update volume characteristic
   * @param {number} volumeSteps - Volume level (0-16)
   */
  updateVolumeCharacteristic (volumeSteps) {
    if (!this.volumeService) return

    if (volumeSteps > 0) {
      this.#lastNonZeroVolume = Math.round((volumeSteps / 16) * 100)
    }

    const normalizedVolume = Number.isFinite(volumeSteps) ? volumeSteps : 0
    const clampedVolume = Math.max(0, Math.min(normalizedVolume, 16))
    const percent = Math.round((clampedVolume / 16) * 100)
    this.#log.debug(
      LOG_PREFIX.ACCESSORY,
      `[${this.#device.name}] Update volume characteristic rawSteps=${volumeSteps} percent=${percent}`
    )

    const { Characteristic } = this.#platform
    this.volumeService
      .getCharacteristic(Characteristic.Brightness)
      .updateValue(percent)
  }

  /**
   * Update mute characteristic
   * @param {number} volume - Volume level
   */
  updateMuteCharacteristic (volume) {
    if (!this.volumeService) return

    const { Characteristic } = this.#platform
    this.volumeService
      .getCharacteristic(Characteristic.On)
      .updateValue(volume > 0)
  }

  /**
   * Update battery level characteristic
   * @param {number} batteryLevel - Battery level percentage
   */
  updateBatteryLevelCharacteristic (batteryLevel) {
    if (!this.batteryService) return

    const { Characteristic } = this.#platform
    this.batteryService
      .getCharacteristic(Characteristic.BatteryLevel)
      .updateValue(batteryLevel)
  }

  /**
   * Update low battery characteristic
   * @param {number} batteryLevel - Battery level percentage
   */
  updateLowBatteryCharacteristic (batteryLevel) {
    if (!this.batteryService) return

    const { Characteristic } = this.#platform
    const lowBattery = batteryLevel <= LOW_BATTERY_THRESHOLD
      ? Characteristic.StatusLowBattery.BATTERY_LEVEL_LOW
      : Characteristic.StatusLowBattery.BATTERY_LEVEL_NORMAL

    this.batteryService
      .getCharacteristic(Characteristic.StatusLowBattery)
      .updateValue(lowBattery)
  }

  /**
   * Update charging state characteristic
   * @param {boolean} isCharging - Is device charging
   */
  updateChargingStateCharacteristic (isCharging) {
    if (!this.batteryService) return

    const { Characteristic } = this.#platform
    const chargingState = isCharging
      ? Characteristic.ChargingState.CHARGING
      : Characteristic.ChargingState.NOT_CHARGING

    this.batteryService
      .getCharacteristic(Characteristic.ChargingState)
      .updateValue(chargingState)
  }

  /**
   * Update online status characteristic for all device-state services
   *
   * Services that need StatusActive (read device state, unavailable when offline):
   * - TemperatureSensor (temperature reading)
   * - ContactSensor (online status, card insertion, day/night mode, nightlight status)
   *
   * Services that DON'T need StatusActive (config-based, work offline):
   * - Lightbulb services (ambient lights - config only)
   * - Lightbulb services (max volume - config only)
   * - Switch (Bluetooth - config only)
   * - StatelessProgrammableSwitch (shortcuts - config only)
   *
   * @param {boolean} isOnline - Online status
   */
  updateOnlineStatusCharacteristic (isOnline) {
    const { Characteristic } = this.#platform

    if (this.onlineStatusService) {
      this.onlineStatusService
        .getCharacteristic(Characteristic.ContactSensorState)
        .updateValue(isOnline
          ? Characteristic.ContactSensorState.CONTACT_NOT_DETECTED
          : Characteristic.ContactSensorState.CONTACT_DETECTED)
    }

    // Update TemperatureSensor (temperature reading)
    if (this.temperatureSensorService) {
      this.temperatureSensorService
        .getCharacteristic(Characteristic.StatusActive)
        .updateValue(isOnline)
    }

    // Update nightlight status ContactSensors (device state)
    if (this.nightlightActiveService) {
      this.nightlightActiveService
        .getCharacteristic(Characteristic.StatusActive)
        .updateValue(isOnline)
    }
    if (this.dayNightlightActiveService) {
      this.dayNightlightActiveService
        .getCharacteristic(Characteristic.StatusActive)
        .updateValue(isOnline)
    }
    if (this.nightNightlightActiveService) {
      this.nightNightlightActiveService
        .getCharacteristic(Characteristic.StatusActive)
        .updateValue(isOnline)
    }

    // Update card slot ContactSensor (device state)
    if (this.cardSlotService) {
      this.cardSlotService
        .getCharacteristic(Characteristic.StatusActive)
        .updateValue(isOnline)
    }

    // Update day mode ContactSensor (device state)
    if (this.dayModeService) {
      this.dayModeService
        .getCharacteristic(Characteristic.StatusActive)
        .updateValue(isOnline)
    }

    // Note: Config-based services (Nightlight Lightbulbs, Volume Limit Lightbulbs, Bluetooth Switch, Shortcuts)
    // do NOT get StatusActive updated - they work offline since they only read/write config

    // TODO: Add shortcut services when implemented
    // if (this.shortcutServices) {
    //   for (const service of this.shortcutServices) {
    //     service
    //       .getCharacteristic(this.platform.Characteristic.StatusActive)
    //       .updateValue(isOnline)
    //   }
    // }
  }

  /**
   * Update firmware version characteristic
   * @param {string} firmwareVersion - Firmware version
   */
  updateFirmwareVersionCharacteristic (firmwareVersion) {
    const { Service, Characteristic } = this.#platform
    const infoService = this.#accessory.getService(Service.AccessoryInformation)
    if (!infoService) return

    infoService.setCharacteristic(
      Characteristic.FirmwareRevision,
      firmwareVersion
    )
  }

  /**
   * Update nightlight status ContactSensor characteristics
   */
  updateNightlightStatusCharacteristics () {
    const { Characteristic } = this.#platform
    const status = this.#deviceModel.status

    if (this.nightlightActiveService) {
      const isActive = status.nightlightMode !== 'off'
      this.nightlightActiveService
        .getCharacteristic(Characteristic.ContactSensorState)
        .updateValue(isActive ? Characteristic.ContactSensorState.CONTACT_NOT_DETECTED : Characteristic.ContactSensorState.CONTACT_DETECTED)
    }

    if (this.dayNightlightActiveService) {
      const isDay = status.dayMode === 'day'
      const isActive = status.nightlightMode !== 'off'
      const isShowing = isDay && isActive
      this.dayNightlightActiveService
        .getCharacteristic(Characteristic.ContactSensorState)
        .updateValue(isShowing ? Characteristic.ContactSensorState.CONTACT_NOT_DETECTED : Characteristic.ContactSensorState.CONTACT_DETECTED)
    }

    if (this.nightNightlightActiveService) {
      const isNight = status.dayMode === 'night'
      const isActive = status.nightlightMode !== 'off'
      const isShowing = isNight && isActive
      this.nightNightlightActiveService
        .getCharacteristic(Characteristic.ContactSensorState)
        .updateValue(isShowing ? Characteristic.ContactSensorState.CONTACT_NOT_DETECTED : Characteristic.ContactSensorState.CONTACT_DETECTED)
    }
  }

  /**
   * Update card slot ContactSensor characteristic
   */
  updateCardSlotCharacteristic () {
    if (!this.cardSlotService) {
      return
    }

    const { Characteristic } = this.#platform
    const status = this.#deviceModel.status
    const hasCard = status.cardInsertionState !== 'none'

    this.cardSlotService
      .getCharacteristic(Characteristic.ContactSensorState)
      .updateValue(hasCard ? Characteristic.ContactSensorState.CONTACT_NOT_DETECTED : Characteristic.ContactSensorState.CONTACT_DETECTED)
  }

  /**
   * Update day mode ContactSensor characteristic
   */
  updateDayModeCharacteristic () {
    if (!this.dayModeService) {
      return
    }

    const { Characteristic } = this.#platform
    const status = this.#deviceModel.status
    const isDayMode = status.dayMode === 'day'

    this.dayModeService
      .getCharacteristic(Characteristic.ContactSensorState)
      .updateValue(isDayMode ? Characteristic.ContactSensorState.CONTACT_NOT_DETECTED : Characteristic.ContactSensorState.CONTACT_DETECTED)
  }

  /**
   * Update sleep timer Switch characteristic
   */
  updateSleepTimerCharacteristic () {
    if (!this.sleepTimerService) {
      return
    }

    const { Characteristic } = this.#platform
    const playback = this.#deviceModel.playback

    this.sleepTimerService
      .getCharacteristic(Characteristic.On)
      .updateValue(playback.sleepTimerActive ?? false)
  }

  /**
   * Update Bluetooth Switch characteristic
   */
  updateBluetoothCharacteristic () {
    if (!this.bluetoothService) {
      return
    }

    const { Characteristic } = this.#platform
    const enabled = this.#deviceModel.config.bluetoothEnabled ?? false

    this.bluetoothService
      .getCharacteristic(Characteristic.On)
      .updateValue(enabled)
  }

  /**
   * Update volume limit Lightbulb characteristics
   */
  updateVolumeLimitCharacteristics () {
    const config = this.#deviceModel.config
    const { Characteristic } = this.#platform

    if (this.dayMaxVolumeService) {
      const limit = Number.isFinite(config.maxVolumeLimit) ? config.maxVolumeLimit : 16
      const clampedLimit = Math.max(0, Math.min(limit, 16))
      const percent = Math.round((clampedLimit / 16) * 100)
      this.#log.debug(
        LOG_PREFIX.ACCESSORY,
        `[${this.#device.name}] Update day max volume characteristic rawSteps=${limit} percent=${percent}`
      )
      this.dayMaxVolumeService
        .getCharacteristic(Characteristic.Brightness)
        .updateValue(percent)
    }

    if (this.nightMaxVolumeService) {
      const limit = Number.isFinite(config.nightMaxVolumeLimit) ? config.nightMaxVolumeLimit : 10
      const clampedLimit = Math.max(0, Math.min(limit, 16))
      const percent = Math.round((clampedLimit / 16) * 100)
      this.#log.debug(
        LOG_PREFIX.ACCESSORY,
        `[${this.#device.name}] Update night max volume characteristic rawSteps=${limit} percent=${percent}`
      )
      this.nightMaxVolumeService
        .getCharacteristic(Characteristic.Brightness)
        .updateValue(percent)
    }
  }

  /**
   * Update temperature characteristic and fault status
   * @param {string | number | null} temperature - Temperature in Celsius
   */
  updateTemperatureCharacteristic (temperature) {
    if (!this.temperatureSensorService) return

    // Skip if temperature is not available
    if (temperature === null || temperature === 'notSupported') {
      return
    }

    const { Characteristic } = this.#platform
    const temp = Number(temperature)
    this.temperatureSensorService
      .getCharacteristic(Characteristic.CurrentTemperature)
      .updateValue(temp)

    // Update fault status
    const fault = Characteristic.StatusFault.NO_FAULT
    this.temperatureSensorService
      .getCharacteristic(Characteristic.StatusFault)
      .updateValue(fault)
  }

  // ==================== Lifecycle Methods ====================

  /**
   * Stop accessory - cleanup event listeners
   * @returns {Promise<void>}
   */
  async stop () {
    this.#log.debug(LOG_PREFIX.ACCESSORY, `Stopping ${this.#device.name}`)

    // Remove all event listeners from device model
    this.#deviceModel.removeAllListeners('statusUpdate')
    this.#deviceModel.removeAllListeners('configUpdate')
    this.#deviceModel.removeAllListeners('playbackUpdate')
    this.#deviceModel.removeAllListeners('online')
    this.#deviceModel.removeAllListeners('offline')
    this.#deviceModel.removeAllListeners('error')

    // Note: Don't call deviceModel.stop() here - that's handled by YotoAccount
  }
}
