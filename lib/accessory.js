/**
 * @fileoverview Yoto Player Accessory implementation - handles HomeKit services for a single player
 */

/** @import { PlatformAccessory, CharacteristicValue, Service, Logger } from 'homebridge' */
/** @import { YotoPlatform } from './platform.js' */
/** @import { YotoDeviceModel } from 'yoto-nodejs-client' */
/** @import { YotoDevice } from 'yoto-nodejs-client/lib/api-endpoints/devices.js' */
/** @import { YotoAccessoryContext } from './platform.js' */

/**
 * Device capabilities detected from metadata
 * @typedef {Object} YotoDeviceCapabilities
 * @property {boolean} hasTemperatureSensor - Whether device has temperature sensor (Gen3 only)
 * @property {string | undefined} formFactor - Device form factor ('standard' or 'mini')
 * @property {string | undefined} generation - Device generation (e.g., 'gen3')
 */

import convert from 'color-convert'
import {
  DEFAULT_MANUFACTURER,
  DEFAULT_MODEL,
  LOW_BATTERY_THRESHOLD,
  PLAYBACK_STATUS,
  LOG_PREFIX,
} from './constants.js'

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
  /** @type {Service | undefined} */ speakerService
  /** @type {Service | undefined} */ batteryService
  /** @type {Service | undefined} */ temperatureSensorService
  /** @type {Service | undefined} */ dayNightlightService
  /** @type {Service | undefined} */ nightNightlightService
  /** @type {Service | undefined} */ nightlightActiveService
  /** @type {Service | undefined} */ dayNightlightActiveService
  /** @type {Service | undefined} */ nightNightlightActiveService
  /** @type {Service | undefined} */ cardSlotService
  /** @type {Service | undefined} */ nightModeService
  /** @type {Service | undefined} */ sleepTimerService
  /** @type {Service | undefined} */ bluetoothService
  /** @type {Service | undefined} */ dayMaxVolumeService
  /** @type {Service | undefined} */ nightMaxVolumeService
  // Volume state for mute/unmute
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
   * Setup accessory - create services and setup event listeners
   * @returns {Promise<void>}
   */
  async setup () {
    this.#log.info(LOG_PREFIX.ACCESSORY, `Setting up ${this.#device.name}`)

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
    this.setupAccessoryInformation()
    this.setupSmartSpeakerService()
    this.setupBatteryService()

    // Setup optional services based on device capabilities
    if (this.#deviceModel.capabilities.hasTemperatureSensor) {
      this.setupTemperatureSensorService()
    }

    if (this.#deviceModel.capabilities.hasColoredNightlight) {
      this.setupNightlightServices()
    }

    // Setup universal services (available on all devices)
    this.setupCardSlotService()
    this.setupNightModeService()
    this.setupSleepTimerService()
    this.setupBluetoothService()
    this.setupVolumeLimitServices()

    // Remove any services that aren't in our current set
    // (except AccessoryInformation which should always be preserved)
    for (const service of this.#accessory.services) {
      if (service.UUID !== this.#platform.Service.AccessoryInformation.UUID &&
          !this.#currentServices.has(service)) {
        this.#log.info(LOG_PREFIX.ACCESSORY, `Removing stale service: ${service.displayName || service.UUID}`)
        this.#accessory.removeService(service)
      }
    }

    // 2. Setup event listeners for device model updates
    this.setupEventListeners()

    this.#log.info(LOG_PREFIX.ACCESSORY, `✓ ${this.#device.name} ready`)
  }

  /**
   * Generate service name with device name prefix
   * @param {string} serviceName - Base service name
   * @returns {string} Full service name with device prefix
   */
  generateServiceName (serviceName) {
    return `${this.#device.name} ${serviceName}`
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
   * Setup SmartSpeaker service (PRIMARY)
   */
  setupSmartSpeakerService () {
    const { Service, Characteristic } = this.#platform
    const service = this.#accessory.getService(Service.SmartSpeaker) ||
      this.#accessory.addService(Service.SmartSpeaker, this.#device.name)

    service.setPrimaryService(true)

    // Optional characteristics NOT implemented:
    // - ConfiguredName - handled at accessory level
    // - AirPlay Enable - not applicable to Yoto hardware

    // CurrentMediaState (GET only)
    service.getCharacteristic(Characteristic.CurrentMediaState)
      .onGet(this.getCurrentMediaState.bind(this))

    // TargetMediaState (GET/SET)
    service.getCharacteristic(Characteristic.TargetMediaState)
      .onGet(this.getTargetMediaState.bind(this))
      .onSet(this.setTargetMediaState.bind(this))

    // Volume (GET/SET) - Use native 0-16 scale with dynamic max
    service.getCharacteristic(Characteristic.Volume)
      .setProps({
        minValue: 0,
        maxValue: this.#deviceModel.status.maxVolume || 16,
        minStep: 1
      })
      .onGet(this.getVolume.bind(this))
      .onSet(this.setVolume.bind(this))

    // Mute (GET/SET)
    service.getCharacteristic(Characteristic.Mute)
      .onGet(this.getMute.bind(this))
      .onSet(this.setMute.bind(this))

    // StatusActive (online/offline indicator)
    // @Status Active] Characteristic not in required or optional characteristic section for service SmartSpeaker. Adding anyway.
    // service.getCharacteristic(Characteristic.StatusActive)
    //   .onGet(this.getStatusActive.bind(this))

    this.speakerService = service
    this.#currentServices.add(service)
  }

  /**
   * Setup Battery service
   */
  setupBatteryService () {
    const { Service, Characteristic } = this.#platform
    const service = this.#accessory.getService(Service.Battery) ||
      this.#accessory.addService(Service.Battery, this.generateServiceName('Battery'))

    // BatteryLevel (GET only)
    service.getCharacteristic(Characteristic.BatteryLevel)
      .onGet(this.getBatteryLevel.bind(this))

    // ChargingState (GET only)
    service.getCharacteristic(Characteristic.ChargingState)
      .onGet(this.getChargingState.bind(this))

    // StatusLowBattery (GET only)
    service.getCharacteristic(Characteristic.StatusLowBattery)
      .onGet(this.getStatusLowBattery.bind(this))

    // StatusActive (online/offline indicator)
    // Battery@Status Active] Characteristic not in required or optional characteristic section for service Battery. Adding anyway.
    // service.getCharacteristic(Characteristic.StatusActive)
    //   .onGet(this.getStatusActive.bind(this))

    this.batteryService = service
    this.#currentServices.add(service)
  }

  /**
   * Setup TemperatureSensor service (optional - only for devices with temperature sensor)
   */
  setupTemperatureSensorService () {
    const { Service, Characteristic } = this.#platform
    const service = this.#accessory.getService(Service.TemperatureSensor) ||
      this.#accessory.addService(Service.TemperatureSensor, this.generateServiceName('Temperature'))

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
    const dayService = this.#accessory.getServiceById(Service.Lightbulb, 'DayNightlight') ||
      this.#accessory.addService(Service.Lightbulb, this.generateServiceName('Day Nightlight'), 'DayNightlight')

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
    const nightService = this.#accessory.getServiceById(Service.Lightbulb, 'NightNightlight') ||
      this.#accessory.addService(Service.Lightbulb, this.generateServiceName('Night Nightlight'), 'NightNightlight')

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
    const nightlightActiveService = this.#accessory.getServiceById(
      Service.ContactSensor,
      'NightlightActive'
    ) || this.#accessory.addService(
      Service.ContactSensor,
      this.generateServiceName('Nightlight Active'),
      'NightlightActive'
    )

    nightlightActiveService
      .setCharacteristic(Characteristic.Name, this.generateServiceName('Nightlight Active'))
      .getCharacteristic(Characteristic.ContactSensorState)
      .onGet(this.getNightlightActive.bind(this))

    this.nightlightActiveService = nightlightActiveService

    // ContactSensor: DayNightlightActive - Shows if day nightlight is currently showing
    const dayNightlightActiveService = this.#accessory.getServiceById(
      Service.ContactSensor,
      'DayNightlightActive'
    ) || this.#accessory.addService(
      Service.ContactSensor,
      this.generateServiceName('Day Nightlight Active'),
      'DayNightlightActive'
    )

    dayNightlightActiveService
      .setCharacteristic(Characteristic.Name, this.generateServiceName('Day Nightlight Active'))
      .getCharacteristic(Characteristic.ContactSensorState)
      .onGet(this.getDayNightlightActive.bind(this))

    this.dayNightlightActiveService = dayNightlightActiveService

    // ContactSensor: NightNightlightActive - Shows if night nightlight is currently showing
    const nightNightlightActiveService = this.#accessory.getServiceById(
      Service.ContactSensor,
      'NightNightlightActive'
    ) || this.#accessory.addService(
      Service.ContactSensor,
      this.generateServiceName('Night Nightlight Active'),
      'NightNightlightActive'
    )

    nightNightlightActiveService
      .setCharacteristic(Characteristic.Name, this.generateServiceName('Night Nightlight Active'))
      .getCharacteristic(Characteristic.ContactSensorState)
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

    const service = this.#accessory.getServiceById(
      Service.ContactSensor,
      'CardSlot'
    ) || this.#accessory.addService(
      Service.ContactSensor,
      this.generateServiceName('Card Slot'),
      'CardSlot'
    )

    service
      .setCharacteristic(Characteristic.Name, this.generateServiceName('Card Slot'))
      .getCharacteristic(Characteristic.ContactSensorState)
      .onGet(this.getCardSlotState.bind(this))

    this.cardSlotService = service
    this.#currentServices.add(service)
  }

  /**
   * Setup night mode OccupancySensor service
   * Shows if device is in night mode (vs day mode)
   */
  setupNightModeService () {
    const { Service, Characteristic } = this.#platform

    const service = this.#accessory.getServiceById(
      Service.OccupancySensor,
      'NightModeStatus'
    ) || this.#accessory.addService(
      Service.OccupancySensor,
      this.generateServiceName('Night Mode'),
      'NightModeStatus'
    )

    service
      .setCharacteristic(Characteristic.Name, this.generateServiceName('Night Mode'))
      .getCharacteristic(Characteristic.OccupancyDetected)
      .onGet(this.getNightModeStatus.bind(this))

    this.nightModeService = service
    this.#currentServices.add(service)
  }

  /**
   * Setup sleep timer Switch service
   * Toggle sleep timer on/off
   */
  setupSleepTimerService () {
    const { Service, Characteristic } = this.#platform

    const service = this.#accessory.getServiceById(
      Service.Switch,
      'SleepTimer'
    ) || this.#accessory.addService(
      Service.Switch,
      this.generateServiceName('Sleep Timer'),
      'SleepTimer'
    )

    service
      .setCharacteristic(Characteristic.Name, this.generateServiceName('Sleep Timer'))
      .getCharacteristic(Characteristic.On)
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

    const service = this.#accessory.getServiceById(
      Service.Switch,
      'Bluetooth'
    ) || this.#accessory.addService(
      Service.Switch,
      this.generateServiceName('Bluetooth'),
      'Bluetooth'
    )

    service
      .setCharacteristic(Characteristic.Name, this.generateServiceName('Bluetooth'))
      .getCharacteristic(Characteristic.On)
      .onGet(this.getBluetoothState.bind(this))
      .onSet(this.setBluetoothState.bind(this))

    this.bluetoothService = service
    this.#currentServices.add(service)
  }

  /**
   * Setup volume limit Fanv2 services
   * Control day and night mode max volume limits
   */
  setupVolumeLimitServices () {
    const { Service, Characteristic } = this.#platform

    // Day Max Volume
    const dayService = this.#accessory.getServiceById(
      Service.Fanv2,
      'DayMaxVolume'
    ) || this.#accessory.addService(
      Service.Fanv2,
      this.generateServiceName('Day Max Volume'),
      'DayMaxVolume'
    )

    dayService
      .setCharacteristic(Characteristic.Name, this.generateServiceName('Day Max Volume'))
      .getCharacteristic(Characteristic.Active)
      .onGet(() => Characteristic.Active.ACTIVE)

    dayService
      .getCharacteristic(Characteristic.RotationSpeed)
      .setProps({ minValue: 0, maxValue: 100, minStep: 1 })
      .onGet(this.getDayMaxVolume.bind(this))
      .onSet(this.setDayMaxVolume.bind(this))

    this.dayMaxVolumeService = dayService

    // Night Max Volume
    const nightService = this.#accessory.getServiceById(
      Service.Fanv2,
      'NightMaxVolume'
    ) || this.#accessory.addService(
      Service.Fanv2,
      this.generateServiceName('Night Max Volume'),
      'NightMaxVolume'
    )

    nightService
      .setCharacteristic(Characteristic.Name, this.generateServiceName('Night Max Volume'))
      .getCharacteristic(Characteristic.Active)
      .onGet(() => Characteristic.Active.ACTIVE)

    nightService
      .getCharacteristic(Characteristic.RotationSpeed)
      .setProps({ minValue: 0, maxValue: 100, minStep: 1 })
      .onGet(this.getNightMaxVolume.bind(this))
      .onSet(this.setNightMaxVolume.bind(this))

    this.nightMaxVolumeService = nightService

    this.#currentServices.add(dayService)
    this.#currentServices.add(nightService)
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

          case 'maxVolume':
            this.updateVolumeLimitProps(status.maxVolume)
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
            // Update night mode OccupancySensor
            this.updateNightModeCharacteristic()
            // Update nightlight status ContactSensors (depends on dayMode)
            if (this.#deviceModel.capabilities.hasColoredNightlight) {
              this.updateNightlightStatusCharacteristics()
            }
            // Day/night mode affects which volume limit is active
            this.updateVolumeLimitProps(status.maxVolume)
            break

          case 'cardInsertionState':
            this.updateCardSlotCharacteristic()
            break

          // Available but not yet mapped to characteristics
          case 'activeCardId':
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
          case 'dayDisplayBrightness': {
            if (this.dayNightlightService) {
              const brightness = config.dayDisplayBrightness === 'auto' ? 100 : parseInt(config.dayDisplayBrightness, 10) || 100
              this.dayNightlightService.updateCharacteristic(Characteristic.Brightness, brightness)
            }
            break
          }

          case 'nightDisplayBrightness': {
            if (this.nightNightlightService) {
              const brightness = config.nightDisplayBrightness === 'auto' ? 100 : parseInt(config.nightDisplayBrightness, 10) || 100
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
            this.updateCurrentMediaStateCharacteristic(playback.playbackStatus)
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
          case 'position':
          case 'trackLength':
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
    this.#deviceModel.on('online', ({ reason }) => {
      this.#log.info(`[${this.#device.name}] Device came online (${reason})`)
      this.updateOnlineStatusCharacteristic(true)
    })

    this.#deviceModel.on('offline', ({ reason }) => {
      this.#log.warn(`[${this.#device.name}] Device went offline (${reason})`)
      this.updateOnlineStatusCharacteristic(false)
    })

    this.#deviceModel.on('error', (error) => {
      this.#log.error(`[${this.#device.name}] Device error:`, error.message)
    })
  }

  // ==================== SmartSpeaker Characteristic Handlers ====================

  /**
   * Get current media state from live playback state
   * @returns {Promise<CharacteristicValue>}
   */
  async getCurrentMediaState () {
    const playbackStatus = this.#deviceModel.playback.playbackStatus

    if (playbackStatus === PLAYBACK_STATUS.PLAYING) {
      return this.#platform.Characteristic.CurrentMediaState.PLAY
    } else if (playbackStatus === PLAYBACK_STATUS.PAUSED) {
      return this.#platform.Characteristic.CurrentMediaState.PAUSE
    }

    return this.#platform.Characteristic.CurrentMediaState.STOP
  }

  /**
   * Get target media state (follows current state)
   * @returns {Promise<CharacteristicValue>}
   */
  async getTargetMediaState () {
    return this.getCurrentMediaState()
  }

  /**
   * Set target media state (play/pause/stop)
   * @param {CharacteristicValue} value - Target state
   * @returns {Promise<void>}
   */
  async setTargetMediaState (value) {
    this.#log.debug(LOG_PREFIX.ACCESSORY, `[${this.#device.name}] Set target media state:`, value)

    try {
      if (value === this.#platform.Characteristic.TargetMediaState.PLAY) {
        await this.#deviceModel.sendCommand({ action: 'resume' })
      } else if (value === this.#platform.Characteristic.TargetMediaState.PAUSE) {
        await this.#deviceModel.sendCommand({ action: 'pause' })
      } else if (value === this.#platform.Characteristic.TargetMediaState.STOP) {
        await this.#deviceModel.sendCommand({ action: 'stop' })
      }
    } catch (error) {
      this.#log.error(LOG_PREFIX.ACCESSORY, `[${this.#device.name}] Failed to set media state:`, error)
      throw new this.#platform.api.hap.HapStatusError(
        this.#platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE
      )
    }
  }

  /**
   * Get volume level (0-16 native scale) from live status
   * @returns {Promise<CharacteristicValue>}
   */
  async getVolume () {
    const volume = this.#deviceModel.status.volume || 8
    return volume
  }

  /**
   * Set volume level
   * @param {CharacteristicValue} value - Volume level (0-16 native scale)
   * @returns {Promise<void>}
   */
  async setVolume (value) {
    this.#log.debug(LOG_PREFIX.ACCESSORY, `[${this.#device.name}] Set volume:`, value)

    const volume = Number(value)

    // Track last non-zero volume for unmute
    if (volume > 0) {
      this.#lastNonZeroVolume = volume
    }

    try {
      await this.#deviceModel.sendCommand({ action: 'volume', volume })
    } catch (error) {
      this.#log.error(LOG_PREFIX.ACCESSORY, `[${this.#device.name}] Failed to set volume:`, error)
      throw new this.#platform.api.hap.HapStatusError(
        this.#platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE
      )
    }
  }

  /**
   * Get mute state (derived from volume === 0)
   * @returns {Promise<CharacteristicValue>}
   */
  async getMute () {
    return this.#deviceModel.status.volume === 0
  }

  /**
   * Set mute state
   * @param {CharacteristicValue} value - Mute state
   * @returns {Promise<void>}
   */
  async setMute (value) {
    this.#log.debug(LOG_PREFIX.ACCESSORY, `[${this.#device.name}] Set mute:`, value)

    try {
      if (value) {
        // Mute - set volume to 0
        await this.#deviceModel.sendCommand({ action: 'volume', volume: 0 })
      } else {
        // Unmute - restore to last non-zero volume
        await this.#deviceModel.sendCommand({ action: 'volume', volume: this.#lastNonZeroVolume })
      }
    } catch (error) {
      this.#log.error(LOG_PREFIX.ACCESSORY, `[${this.#device.name}] Failed to set mute:`, error)
      throw new this.#platform.api.hap.HapStatusError(
        this.#platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE
      )
    }
  }

  /**
   * Get status active (online/offline)
   * @returns {Promise<CharacteristicValue>}
   */
  async getStatusActive () {
    return this.#deviceModel.status.isOnline
  }

  // ==================== Battery Characteristic Handlers ====================

  /**
   * Get battery level (0-100) from live status
   * @returns {Promise<CharacteristicValue>}
   */
  async getBatteryLevel () {
    return this.#deviceModel.status.batteryLevelPercentage || 100
  }

  /**
   * Get charging state from live status
   * @returns {Promise<CharacteristicValue>}
   */
  async getChargingState () {
    const isCharging = this.#deviceModel.status.isCharging
    return isCharging
      ? this.#platform.Characteristic.ChargingState.CHARGING
      : this.#platform.Characteristic.ChargingState.NOT_CHARGING
  }

  /**
   * Get low battery status from live status
   * @returns {Promise<CharacteristicValue>}
   */
  async getStatusLowBattery () {
    const battery = this.#deviceModel.status.batteryLevelPercentage || 100
    return battery <= LOW_BATTERY_THRESHOLD
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
      return 0
    }

    return Number(temp)
  }

  /**
   * Get temperature sensor fault status
   * @returns {Promise<CharacteristicValue>}
   */
  async getTemperatureSensorFault () {
    // Report fault if device is offline or temperature is not available
    if (!this.#deviceModel.status.isOnline ||
        this.#deviceModel.status.temperatureCelsius === null ||
        this.#deviceModel.status.temperatureCelsius === 'notSupported') {
      return this.#platform.Characteristic.StatusFault.GENERAL_FAULT
    }

    return this.#platform.Characteristic.StatusFault.NO_FAULT
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
    return !this.isColorOff(color)
  }

  /**
   * Set day nightlight on/off state
   * @param {CharacteristicValue} value
   */
  async setDayNightlightOn (value) {
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
  }

  /**
   * Get day nightlight brightness (screen brightness)
   * @returns {Promise<CharacteristicValue>}
   */
  async getDayNightlightBrightness () {
    const brightness = this.#deviceModel.config.dayDisplayBrightness
    if (brightness === 'auto') {
      return 100
    }
    return parseInt(brightness, 10) || 100
  }

  /**
   * Set day nightlight brightness (screen brightness)
   * @param {CharacteristicValue} value
   */
  async setDayNightlightBrightness (value) {
    const brightnessValue = Math.round(Number(value))
    this.#log.debug(LOG_PREFIX.ACCESSORY, `Setting day display brightness: ${brightnessValue}`)
    await this.#deviceModel.updateConfig({ dayDisplayBrightness: String(brightnessValue) })
  }

  /**
   * Get day nightlight hue
   * @returns {Promise<CharacteristicValue>}
   */
  async getDayNightlightHue () {
    const color = this.#deviceModel.config.ambientColour
    if (this.isColorOff(color)) {
      return 0
    }
    const hex = this.parseHexColor(color)
    const [h] = convert.hex.hsv(hex)
    return h
  }

  /**
   * Set day nightlight hue
   * @param {CharacteristicValue} value
   */
  async setDayNightlightHue (value) {
    const hue = Number(value)

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
    await this.#deviceModel.updateConfig({ ambientColour: formattedColor })
  }

  /**
   * Get day nightlight saturation
   * @returns {Promise<CharacteristicValue>}
   */
  async getDayNightlightSaturation () {
    const color = this.#deviceModel.config.ambientColour
    if (this.isColorOff(color)) {
      return 0
    }
    const hex = this.parseHexColor(color)
    const [, s] = convert.hex.hsv(hex)
    return s
  }

  /**
   * Set day nightlight saturation
   * @param {CharacteristicValue} value
   */
  async setDayNightlightSaturation (value) {
    const saturation = Number(value)

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
    await this.#deviceModel.updateConfig({ ambientColour: formattedColor })
  }

  // ---------- Night Nightlight Handlers ----------

  /**
   * Get night nightlight on/off state
   * @returns {Promise<CharacteristicValue>}
   */
  async getNightNightlightOn () {
    const color = this.#deviceModel.config.nightAmbientColour
    return !this.isColorOff(color)
  }

  /**
   * Set night nightlight on/off state
   * @param {CharacteristicValue} value
   */
  async setNightNightlightOn (value) {
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
  }

  /**
   * Get night nightlight brightness (screen brightness)
   * @returns {Promise<CharacteristicValue>}
   */
  async getNightNightlightBrightness () {
    const brightness = this.#deviceModel.config.nightDisplayBrightness
    if (brightness === 'auto') {
      return 100
    }
    return parseInt(brightness, 10) || 100
  }

  /**
   * Set night nightlight brightness (screen brightness)
   * @param {CharacteristicValue} value
   */
  async setNightNightlightBrightness (value) {
    const brightnessValue = Math.round(Number(value))
    this.#log.debug(LOG_PREFIX.ACCESSORY, `Setting night display brightness: ${brightnessValue}`)
    await this.#deviceModel.updateConfig({ nightDisplayBrightness: String(brightnessValue) })
  }

  /**
   * Get night nightlight hue
   * @returns {Promise<CharacteristicValue>}
   */
  async getNightNightlightHue () {
    const color = this.#deviceModel.config.nightAmbientColour
    if (this.isColorOff(color)) {
      return 0
    }
    const hex = this.parseHexColor(color)
    const [h] = convert.hex.hsv(hex)
    return h
  }

  /**
   * Set night nightlight hue
   * @param {CharacteristicValue} value
   */
  async setNightNightlightHue (value) {
    const hue = Number(value)

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
    await this.#deviceModel.updateConfig({ nightAmbientColour: formattedColor })
  }

  /**
   * Get night nightlight saturation
   * @returns {Promise<CharacteristicValue>}
   */
  async getNightNightlightSaturation () {
    const color = this.#deviceModel.config.nightAmbientColour
    if (this.isColorOff(color)) {
      return 0
    }
    const hex = this.parseHexColor(color)
    const [, s] = convert.hex.hsv(hex)
    return s
  }

  /**
   * Set night nightlight saturation
   * @param {CharacteristicValue} value
   */
  async setNightNightlightSaturation (value) {
    const saturation = Number(value)

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
    await this.#deviceModel.updateConfig({ nightAmbientColour: formattedColor })
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
    return isActive ? Characteristic.ContactSensorState.CONTACT_DETECTED : Characteristic.ContactSensorState.CONTACT_NOT_DETECTED
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
    return isShowing ? Characteristic.ContactSensorState.CONTACT_DETECTED : Characteristic.ContactSensorState.CONTACT_NOT_DETECTED
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
    return isShowing ? Characteristic.ContactSensorState.CONTACT_DETECTED : Characteristic.ContactSensorState.CONTACT_NOT_DETECTED
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
    return hasCard ? Characteristic.ContactSensorState.CONTACT_DETECTED : Characteristic.ContactSensorState.CONTACT_NOT_DETECTED
  }

  // ==================== Night Mode OccupancySensor Getter ====================

  /**
   * Get night mode status
   * @returns {Promise<CharacteristicValue>}
   */
  async getNightModeStatus () {
    const { Characteristic } = this.#platform
    const status = this.#deviceModel.status
    const isNightMode = status.dayMode === 'night'
    return isNightMode ? Characteristic.OccupancyDetected.OCCUPANCY_DETECTED : Characteristic.OccupancyDetected.OCCUPANCY_NOT_DETECTED
  }

  // ==================== Sleep Timer Switch Getter/Setter ====================

  /**
   * Get sleep timer state
   * @returns {Promise<CharacteristicValue>}
   */
  async getSleepTimerState () {
    const playback = this.#deviceModel.playback
    return playback.sleepTimerActive ?? false
  }

  /**
   * Set sleep timer state
   * @param {CharacteristicValue} value
   */
  async setSleepTimerState (value) {
    const enabled = Boolean(value)

    if (enabled) {
      // Turn on sleep timer - default to 30 minutes
      this.#log.info(LOG_PREFIX.ACCESSORY, 'Activating sleep timer (30 minutes)')
      await this.#deviceModel.sendCommand({ action: 'sleep-timer', minutes: 30 })
    } else {
      // Turn off sleep timer
      this.#log.info(LOG_PREFIX.ACCESSORY, 'Deactivating sleep timer')
      await this.#deviceModel.sendCommand({ action: 'sleep-timer', minutes: 0 })
    }
  }

  // ==================== Bluetooth Switch Getter/Setter ====================

  /**
   * Get Bluetooth state
   * @returns {Promise<CharacteristicValue>}
   */
  async getBluetoothState () {
    const config = this.#deviceModel.config
    // bluetoothEnabled is a string '0' or '1'
    return config.bluetoothEnabled === '1'
  }

  /**
   * Set Bluetooth state
   * @param {CharacteristicValue} value
   */
  async setBluetoothState (value) {
    const enabled = Boolean(value)
    this.#log.info(LOG_PREFIX.ACCESSORY, `Setting Bluetooth: ${enabled ? 'ON' : 'OFF'}`)
    // bluetoothEnabled is a string '0' or '1'
    await this.#deviceModel.updateConfig({ bluetoothEnabled: enabled ? '1' : '0' })
  }

  // ==================== Volume Limit Fanv2 Getters/Setters ====================

  /**
   * Get day max volume limit
   * @returns {Promise<CharacteristicValue>}
   */
  async getDayMaxVolume () {
    const config = this.#deviceModel.config
    // maxVolumeLimit is a string number
    const limit = parseInt(config.maxVolumeLimit, 10) || 16
    // Convert from 0-16 to 0-100 percentage
    const percentage = Math.round((limit / 16) * 100)
    return percentage
  }

  /**
   * Set day max volume limit
   * @param {CharacteristicValue} value
   */
  async setDayMaxVolume (value) {
    const percentage = Number(value)
    // Convert from 0-100 percentage to 0-16 device range
    const limit = Math.round((percentage / 100) * 16)
    this.#log.info(LOG_PREFIX.ACCESSORY, `Setting day max volume limit: ${percentage}% (${limit}/16)`)
    // maxVolumeLimit is a string number
    await this.#deviceModel.updateConfig({ maxVolumeLimit: String(limit) })
  }

  /**
   * Get night max volume limit
   * @returns {Promise<CharacteristicValue>}
   */
  async getNightMaxVolume () {
    const config = this.#deviceModel.config
    // nightMaxVolumeLimit is a string number
    const limit = parseInt(config.nightMaxVolumeLimit, 10) || 10
    // Convert from 0-16 to 0-100 percentage
    const percentage = Math.round((limit / 16) * 100)
    return percentage
  }

  /**
   * Set night max volume limit
   * @param {CharacteristicValue} value
   */
  async setNightMaxVolume (value) {
    const percentage = Number(value)
    // Convert from 0-100 percentage to 0-16 device range
    const limit = Math.round((percentage / 100) * 16)
    this.#log.info(LOG_PREFIX.ACCESSORY, `Setting night max volume limit: ${percentage}% (${limit}/16)`)
    // nightMaxVolumeLimit is a string number
    await this.#deviceModel.updateConfig({ nightMaxVolumeLimit: String(limit) })
  }

  // ==================== Characteristic Update Methods ====================

  /**
   * Update volume characteristic
   * @param {number} volume - Volume level
   */
  updateVolumeCharacteristic (volume) {
    if (!this.speakerService) return

    const { Characteristic } = this.#platform
    this.speakerService
      .getCharacteristic(Characteristic.Volume)
      .updateValue(volume)
  }

  /**
   * Update volume limit props - adjusts max value based on day/night mode
   * @param {number} maxVolume - Maximum volume limit (0-16)
   */
  updateVolumeLimitProps (maxVolume) {
    if (!this.speakerService) return

    const { Characteristic } = this.#platform
    this.speakerService
      .getCharacteristic(Characteristic.Volume)
      .setProps({
        maxValue: maxVolume || 16
      })

    this.#log.debug(`[${this.#device.name}] Volume limit updated to ${maxVolume}`)
  }

  /**
   * Update mute characteristic
   * @param {number} volume - Volume level
   */
  updateMuteCharacteristic (volume) {
    if (!this.speakerService) return

    const { Characteristic } = this.#platform
    const muted = volume === 0
    this.speakerService
      .getCharacteristic(Characteristic.Mute)
      .updateValue(muted)
  }

  /**
   * Update current media state characteristic
   * @param {string | null} playbackStatus - Playback status
   */
  updateCurrentMediaStateCharacteristic (playbackStatus) {
    if (!this.speakerService) return

    const { Characteristic } = this.#platform
    let mediaState = Characteristic.CurrentMediaState.STOP

    if (playbackStatus === PLAYBACK_STATUS.PLAYING) {
      mediaState = Characteristic.CurrentMediaState.PLAY
    } else if (playbackStatus === PLAYBACK_STATUS.PAUSED) {
      mediaState = Characteristic.CurrentMediaState.PAUSE
    }

    // Update both current and target to keep in sync
    this.speakerService
      .getCharacteristic(Characteristic.CurrentMediaState)
      .updateValue(mediaState)

    this.speakerService
      .getCharacteristic(Characteristic.TargetMediaState)
      .updateValue(mediaState)
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
   * - SmartSpeaker (playback, volume)
   * - Battery (battery level, charging state)
   * - TemperatureSensor (temperature reading)
   * - ContactSensor (card insertion state) - when implemented
   * - OccupancySensor (day/night mode from device) - when implemented
   * - Switch (Sleep Timer - reads device playback state) - when implemented
   *
   * Services that DON'T need StatusActive (config-based, work offline):
   * - Lightbulb services (ambient lights - config only)
   * - Fanv2 services (max volume - config only)
   * - Switch (Bluetooth - config only)
   * - StatelessProgrammableSwitch (shortcuts - config only)
   *
   * @param {boolean} isOnline - Online status
   */
  updateOnlineStatusCharacteristic (isOnline) {
    const { Characteristic } = this.#platform

    // Update SmartSpeaker (playback, volume)
    // SmartSpeaker doesn't allow this
    // if (this.speakerService) {
    //   this.speakerService
    //     .getCharacteristic(Characteristic.StatusActive)
    //     .updateValue(isOnline)
    // }

    // Update Battery (battery level, charging state)
    // Battery Doesn't support this
    // if (this.batteryService) {
    //   this.batteryService
    //     .getCharacteristic(Characteristic.StatusActive)
    //     .updateValue(isOnline)
    // }

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

    // Update night mode OccupancySensor (device state)
    if (this.nightModeService) {
      this.nightModeService
        .getCharacteristic(Characteristic.StatusActive)
        .updateValue(isOnline)
    }

    // Update sleep timer Switch (reads device playback state)
    if (this.sleepTimerService) {
      this.sleepTimerService
        .getCharacteristic(Characteristic.StatusActive)
        .updateValue(isOnline)
    }

    // Note: Config-based services (Nightlight Lightbulbs, Fanv2, Bluetooth Switch, Shortcuts)
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
        .updateValue(isActive ? Characteristic.ContactSensorState.CONTACT_DETECTED : Characteristic.ContactSensorState.CONTACT_NOT_DETECTED)
    }

    if (this.dayNightlightActiveService) {
      const isDay = status.dayMode === 'day'
      const isActive = status.nightlightMode !== 'off'
      const isShowing = isDay && isActive
      this.dayNightlightActiveService
        .getCharacteristic(Characteristic.ContactSensorState)
        .updateValue(isShowing ? Characteristic.ContactSensorState.CONTACT_DETECTED : Characteristic.ContactSensorState.CONTACT_NOT_DETECTED)
    }

    if (this.nightNightlightActiveService) {
      const isNight = status.dayMode === 'night'
      const isActive = status.nightlightMode !== 'off'
      const isShowing = isNight && isActive
      this.nightNightlightActiveService
        .getCharacteristic(Characteristic.ContactSensorState)
        .updateValue(isShowing ? Characteristic.ContactSensorState.CONTACT_DETECTED : Characteristic.ContactSensorState.CONTACT_NOT_DETECTED)
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
      .updateValue(hasCard ? Characteristic.ContactSensorState.CONTACT_DETECTED : Characteristic.ContactSensorState.CONTACT_NOT_DETECTED)
  }

  /**
   * Update night mode OccupancySensor characteristic
   */
  updateNightModeCharacteristic () {
    if (!this.nightModeService) {
      return
    }

    const { Characteristic } = this.#platform
    const status = this.#deviceModel.status
    const isNightMode = status.dayMode === 'night'

    this.nightModeService
      .getCharacteristic(Characteristic.OccupancyDetected)
      .updateValue(isNightMode ? Characteristic.OccupancyDetected.OCCUPANCY_DETECTED : Characteristic.OccupancyDetected.OCCUPANCY_NOT_DETECTED)
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
      .updateValue(playback.sleepTimerActive)
  }

  /**
   * Update Bluetooth Switch characteristic
   */
  updateBluetoothCharacteristic () {
    if (!this.bluetoothService) {
      return
    }

    const { Characteristic } = this.#platform
    const config = this.#deviceModel.config
    // bluetoothEnabled is a string '0' or '1'
    const enabled = config.bluetoothEnabled === '1'

    this.bluetoothService
      .getCharacteristic(Characteristic.On)
      .updateValue(enabled)
  }

  /**
   * Update volume limit Fanv2 characteristics
   */
  updateVolumeLimitCharacteristics () {
    const config = this.#deviceModel.config
    const { Characteristic } = this.#platform

    if (this.dayMaxVolumeService) {
      // maxVolumeLimit is a string number
      const limit = parseInt(config.maxVolumeLimit, 10) || 16
      const percentage = Math.round((limit / 16) * 100)
      this.dayMaxVolumeService
        .getCharacteristic(Characteristic.RotationSpeed)
        .updateValue(percentage)
    }

    if (this.nightMaxVolumeService) {
      // nightMaxVolumeLimit is a string number
      const limit = parseInt(config.nightMaxVolumeLimit, 10) || 10
      const percentage = Math.round((limit / 16) * 100)
      this.nightMaxVolumeService
        .getCharacteristic(Characteristic.RotationSpeed)
        .updateValue(percentage)
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
    this.#log.info(LOG_PREFIX.ACCESSORY, `Stopping ${this.#device.name}`)

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
