/**
 * @fileoverview Yoto Player Accessory implementation - handles HomeKit services for a single player
 */

/** @import { PlatformAccessory, CharacteristicValue, Service, Logger } from 'homebridge' */
/** @import { YotoPlatform } from './platform.js' */
/** @import { YotoClient } from 'yoto-nodejs-client' */
/** @import { YotoDevice, YotoDeviceStatusResponse, YotoDeviceConfigResponse } from 'yoto-nodejs-client/lib/api-endpoints/devices.js' */
/** @import { YotoEventsMessage } from 'yoto-nodejs-client/lib/mqtt/client.js' */
/** @import { YotoAccessoryContext } from './platform.js' */

/**
 * Device capabilities detected from metadata
 * @typedef {Object} YotoDeviceCapabilities
 * @property {boolean} hasTemperatureSensor - Whether device has temperature sensor (Gen3 only)
 * @property {string | undefined} formFactor - Device form factor ('standard' or 'mini')
 * @property {string | undefined} generation - Device generation (e.g., 'gen3')
 */

import {
  DEFAULT_MANUFACTURER,
  DEFAULT_MODEL,
  LOW_BATTERY_THRESHOLD,
  PLAYBACK_STATUS,
  DEFAULT_CONFIG,
  LOG_PREFIX,
} from './constants.js'

/**
 * Yoto Player Accessory Handler
 * Manages HomeKit services and characteristics for a single Yoto player
 */
export class YotoPlayerAccessory {
  /** @type {YotoPlatform} */ platform
  /** @type {PlatformAccessory<YotoAccessoryContext>} */ accessory
  /** @type {YotoClient} */ yotoClient
  /** @type {Logger} */ log
  /** @type {YotoDevice} */ device
  /** @type {string} */ deviceId
  /** @type {YotoDeviceStatusResponse | null} */ cachedStatus
  /** @type {YotoDeviceConfigResponse | null} */ cachedConfig
  /** @type {YotoEventsMessage | null} */ cachedEvents
  /** @type {number | null} */ lastUpdateTime
  /** @type {Object | null} */ mqtt
  /** @type {YotoDeviceCapabilities} */ capabilities
  /** @type {Service | undefined} */ speakerService
  /** @type {Service | undefined} */ batteryService
  /** @type {number} */ lastNonZeroVolume

  /**
   * @param {Object} params
   * @param {YotoPlatform} params.platform - Platform instance
   * @param {PlatformAccessory<YotoAccessoryContext>} params.accessory - Platform accessory
   * @param {YotoClient} params.yotoClient - Yoto API client
   */
  constructor ({ platform, accessory, yotoClient }) {
    this.platform = platform
    this.accessory = accessory
    this.yotoClient = yotoClient
    this.log = platform.log

    // Extract device info from context
    this.device = accessory.context.device
    this.deviceId = this.device.deviceId

    // State cache
    // Note: cachedStatus comes from HTTP API (getDeviceStatus)
    //       cachedConfig comes from HTTP API (getDeviceConfig)
    //       cachedEvents comes from MQTT events topic
    //       Field names differ between the two sources
    this.cachedStatus = null
    this.cachedConfig = null
    this.cachedEvents = null
    this.lastUpdateTime = null

    // MQTT client (per-device)
    this.mqtt = null

    // Volume state for mute/unmute
    this.lastNonZeroVolume = 50

    // Detect capabilities
    this.capabilities = this.detectCapabilities()
  }

  /**
   * Detect device capabilities based on device metadata
   * @returns {YotoDeviceCapabilities}
   */
  detectCapabilities () {
    // TODO: Make this actually robust
    const isMini = this.device.formFactor === 'mini'

    return {
      hasTemperatureSensor: !isMini, // Gen3 has temperature sensor, Mini does not
      formFactor: this.device.formFactor,
      generation: this.device.generation,
    }
  }

  /**
   * Setup accessory - create services and connect MQTT
   * @returns {Promise<void>}
   */
  async setup () {
    this.log.info(LOG_PREFIX.ACCESSORY, `Setting up ${this.device.name}`)

    // 1. Fetch initial device config to get firmware version
    try {
      const config = await this.yotoClient.getDeviceConfig({ deviceId: this.deviceId })
      this.cachedConfig = config
    } catch (error) {
      this.log.warn(LOG_PREFIX.ACCESSORY, `[${this.device.name}] Failed to fetch initial config:`, error)
      // Continue setup without config
    }

    // 2. Fetch initial device status for battery info
    try {
      const status = await this.yotoClient.getDeviceStatus({ deviceId: this.deviceId })
      this.cachedStatus = status
      this.lastUpdateTime = Date.now()
    } catch (error) {
      this.log.warn(LOG_PREFIX.ACCESSORY, `[${this.device.name}] Failed to fetch initial status:`, error)
      // Continue setup without status
    }

    // 3. Setup services
    this.setupAccessoryInformation()
    this.setupSmartSpeakerService()
    this.setupBatteryService()

    // 4. Connect MQTT for real-time updates
    await this.connectMqtt()

    this.log.info(LOG_PREFIX.ACCESSORY, `✓ ${this.device.name} ready`)
  }

  /**
   * Setup AccessoryInformation service
   */
  setupAccessoryInformation () {
    const service = this.accessory.getService(this.platform.Service.AccessoryInformation) ||
      this.accessory.addService(this.platform.Service.AccessoryInformation)

    // Build hardware revision from generation and form factor
    const hardwareRevision = [
      this.device.generation,
      this.device.formFactor,
    ].filter(Boolean).join(' ') || 'Unknown'

    // Use deviceFamily for model (e.g., 'v2', 'v3', 'mini')
    const model = this.device.deviceFamily || this.device.deviceType || DEFAULT_MODEL

    service
      .setCharacteristic(this.platform.Characteristic.Manufacturer, DEFAULT_MANUFACTURER)
      .setCharacteristic(this.platform.Characteristic.Model, model)
      .setCharacteristic(this.platform.Characteristic.SerialNumber, this.deviceId)
      .setCharacteristic(this.platform.Characteristic.HardwareRevision, hardwareRevision)

    // Set firmware version from cached config if available
    if (this.cachedConfig?.device?.fwVersion) {
      service.setCharacteristic(
        this.platform.Characteristic.FirmwareRevision,
        this.cachedConfig.device.fwVersion
      )
    }
  }

  /**
   * Setup SmartSpeaker service (PRIMARY)
   */
  setupSmartSpeakerService () {
    const service = this.accessory.getService(this.platform.Service.SmartSpeaker) ||
      this.accessory.addService(this.platform.Service.SmartSpeaker)

    service.setCharacteristic(this.platform.Characteristic.Name, this.device.name)
    service.setPrimaryService(true)

    // CurrentMediaState (GET only)
    service.getCharacteristic(this.platform.Characteristic.CurrentMediaState)
      .onGet(this.getCurrentMediaState.bind(this))

    // TargetMediaState (GET/SET)
    service.getCharacteristic(this.platform.Characteristic.TargetMediaState)
      .onGet(this.getTargetMediaState.bind(this))
      .onSet(this.setTargetMediaState.bind(this))

    // Volume (GET/SET)
    service.getCharacteristic(this.platform.Characteristic.Volume)
      .onGet(this.getVolume.bind(this))
      .onSet(this.setVolume.bind(this))

    // Mute (GET/SET)
    service.getCharacteristic(this.platform.Characteristic.Mute)
      .onGet(this.getMute.bind(this))
      .onSet(this.setMute.bind(this))

    // StatusActive (online/offline indicator)
    service.getCharacteristic(this.platform.Characteristic.StatusActive)
      .onGet(this.getStatusActive.bind(this))

    this.speakerService = service
  }

  /**
   * Setup Battery service
   */
  setupBatteryService () {
    const service = this.accessory.getService(this.platform.Service.Battery) ||
      this.accessory.addService(this.platform.Service.Battery)

    service.setCharacteristic(this.platform.Characteristic.Name, `${this.device.name} Battery`)

    // BatteryLevel (GET only)
    service.getCharacteristic(this.platform.Characteristic.BatteryLevel)
      .onGet(this.getBatteryLevel.bind(this))

    // ChargingState (GET only)
    service.getCharacteristic(this.platform.Characteristic.ChargingState)
      .onGet(this.getChargingState.bind(this))

    // StatusLowBattery (GET only)
    service.getCharacteristic(this.platform.Characteristic.StatusLowBattery)
      .onGet(this.getStatusLowBattery.bind(this))

    this.batteryService = service
  }

  // ==================== SmartSpeaker Characteristic Handlers ====================

  /**
   * Get current media state
   * @returns {Promise<CharacteristicValue>}
   */
  async getCurrentMediaState () {
    if (!this.cachedEvents) {
      return this.platform.Characteristic.CurrentMediaState.STOP
    }

    const playbackStatus = this.cachedEvents.playbackStatus

    if (playbackStatus === PLAYBACK_STATUS.PLAYING) {
      return this.platform.Characteristic.CurrentMediaState.PLAY
    } else if (playbackStatus === PLAYBACK_STATUS.PAUSED) {
      return this.platform.Characteristic.CurrentMediaState.PAUSE
    }

    return this.platform.Characteristic.CurrentMediaState.STOP
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
    this.log.debug(LOG_PREFIX.ACCESSORY, `[${this.device.name}] Set target media state:`, value)

    try {
      // TODO: Send MQTT commands when MQTT client is implemented
      if (value === this.platform.Characteristic.TargetMediaState.PLAY) {
        this.log.info(LOG_PREFIX.ACCESSORY, `[${this.device.name}] Play command (TODO: implement MQTT)`)
        // await this.mqtt.resumeCard(this.deviceId)
      } else if (value === this.platform.Characteristic.TargetMediaState.PAUSE) {
        this.log.info(LOG_PREFIX.ACCESSORY, `[${this.device.name}] Pause command (TODO: implement MQTT)`)
        // await this.mqtt.pauseCard(this.deviceId)
      } else if (value === this.platform.Characteristic.TargetMediaState.STOP) {
        this.log.info(LOG_PREFIX.ACCESSORY, `[${this.device.name}] Stop command (TODO: implement MQTT)`)
        // await this.mqtt.stopCard(this.deviceId)
      }
    } catch (error) {
      this.log.error(LOG_PREFIX.ACCESSORY, `[${this.device.name}] Failed to set media state:`, error)
      throw new this.platform.api.hap.HapStatusError(
        this.platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE
      )
    }
  }

  /**
   * Get volume level (0-100)
   * Note: Volume comes from MQTT events.volume, NOT HTTP API status.userVolumePercentage
   * @returns {Promise<CharacteristicValue>}
   */
  async getVolume () {
    // Volume comes from MQTT events, not HTTP status
    if (!this.cachedEvents || this.cachedEvents.volume === undefined) {
      return 50 // Default volume
    }

    const volume = Number(this.cachedEvents.volume) || 50
    return volume
  }

  /**
   * Set volume level
   * @param {CharacteristicValue} value - Volume level (0-100)
   * @returns {Promise<void>}
   */
  async setVolume (value) {
    this.log.debug(LOG_PREFIX.ACCESSORY, `[${this.device.name}] Set volume:`, value)

    const volume = Number(value)

    // Track last non-zero volume for unmute
    if (volume > 0) {
      this.lastNonZeroVolume = volume
    }

    try {
      // TODO: Send MQTT command when MQTT client is implemented
      this.log.info(LOG_PREFIX.ACCESSORY, `[${this.device.name}] Volume command: ${volume} (TODO: implement MQTT)`)
      // await this.mqtt.setVolume(this.deviceId, volume)
    } catch (error) {
      this.log.error(LOG_PREFIX.ACCESSORY, `[${this.device.name}] Failed to set volume:`, error)
      throw new this.platform.api.hap.HapStatusError(
        this.platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE
      )
    }
  }

  /**
   * Get mute state (derived from volume === 0)
   * @returns {Promise<CharacteristicValue>}
   */
  async getMute () {
    if (!this.cachedEvents || this.cachedEvents.volume === undefined) {
      return false
    }

    return Number(this.cachedEvents.volume) === 0
  }

  /**
   * Set mute state
   * @param {CharacteristicValue} value - Mute state
   * @returns {Promise<void>}
   */
  async setMute (value) {
    this.log.debug(LOG_PREFIX.ACCESSORY, `[${this.device.name}] Set mute:`, value)

    try {
      if (value) {
        // Mute - set volume to 0
        this.log.info(LOG_PREFIX.ACCESSORY, `[${this.device.name}] Mute (TODO: implement MQTT)`)
        // await this.mqtt.setVolume(this.deviceId, 0)
      } else {
        // Unmute - restore to last non-zero volume
        this.log.info(LOG_PREFIX.ACCESSORY, `[${this.device.name}] Unmute to ${this.lastNonZeroVolume} (TODO: implement MQTT)`)
        // await this.mqtt.setVolume(this.deviceId, this.lastNonZeroVolume)
      }
    } catch (error) {
      this.log.error(LOG_PREFIX.ACCESSORY, `[${this.device.name}] Failed to set mute:`, error)
      throw new this.platform.api.hap.HapStatusError(
        this.platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE
      )
    }
  }

  /**
   * Get status active (online/offline)
   * @returns {Promise<CharacteristicValue>}
   */
  async getStatusActive () {
    return this.isDeviceOnline()
  }

  // ==================== Battery Characteristic Handlers ====================

  /**
   * Get battery level (0-100)
   * Note: Uses HTTP API status.batteryLevelPercentage (MQTT uses different field: batteryLevel)
   * @returns {Promise<CharacteristicValue>}
   */
  async getBatteryLevel () {
    if (!this.cachedStatus || this.cachedStatus.batteryLevelPercentage === undefined) {
      return 100 // Assume full if unknown
    }

    const battery = Number(this.cachedStatus.batteryLevelPercentage) || 100
    return battery
  }

  /**
   * Get charging state
   * @returns {Promise<CharacteristicValue>}
   */
  async getChargingState () {
    if (!this.cachedStatus) {
      return this.platform.Characteristic.ChargingState.NOT_CHARGING
    }

    const isCharging = this.cachedStatus.isCharging || false
    return isCharging
      ? this.platform.Characteristic.ChargingState.CHARGING
      : this.platform.Characteristic.ChargingState.NOT_CHARGING
  }

  /**
   * Get low battery status
   * @returns {Promise<CharacteristicValue>}
   */
  async getStatusLowBattery () {
    if (!this.cachedStatus || this.cachedStatus.batteryLevelPercentage === undefined) {
      return this.platform.Characteristic.StatusLowBattery.BATTERY_LEVEL_NORMAL
    }

    const battery = Number(this.cachedStatus.batteryLevelPercentage) || 100
    return battery <= LOW_BATTERY_THRESHOLD
      ? this.platform.Characteristic.StatusLowBattery.BATTERY_LEVEL_LOW
      : this.platform.Characteristic.StatusLowBattery.BATTERY_LEVEL_NORMAL
  }

  // ==================== Helper Methods ====================

  /**
   * Check if device is considered online based on last update time
   * @returns {boolean}
   */
  isDeviceOnline () {
    if (!this.lastUpdateTime) {
      return false
    }

    const timeoutMs = (this.platform.config['statusTimeoutSeconds'] || DEFAULT_CONFIG.statusTimeoutSeconds) * 1000
    return Date.now() - this.lastUpdateTime < timeoutMs
  }

  /**
   * Update characteristics from cached state
   */
  updateCharacteristics () {
    if (!this.speakerService) {
      return
    }

    // Update playback state
    this.updatePlaybackCharacteristics()

    // Update battery state
    if (this.batteryService && this.cachedStatus) {
      if (this.cachedStatus.batteryLevelPercentage !== undefined) {
        this.batteryService.updateCharacteristic(
          this.platform.Characteristic.BatteryLevel,
          this.cachedStatus.batteryLevelPercentage
        )
      }

      if (this.cachedStatus.isCharging !== undefined) {
        const chargingState = this.cachedStatus.isCharging
          ? this.platform.Characteristic.ChargingState.CHARGING
          : this.platform.Characteristic.ChargingState.NOT_CHARGING

        this.batteryService.updateCharacteristic(
          this.platform.Characteristic.ChargingState,
          chargingState
        )
      }
    }

    // Update online status
    this.speakerService.updateCharacteristic(
      this.platform.Characteristic.StatusActive,
      this.isDeviceOnline()
    )
  }

  /**
   * Update playback characteristics from MQTT events
   */
  updatePlaybackCharacteristics () {
    if (!this.cachedEvents || !this.speakerService) {
      return
    }

    // Map playback status to HomeKit media state
    let mediaState = this.platform.Characteristic.CurrentMediaState.STOP

    if (this.cachedEvents.playbackStatus === PLAYBACK_STATUS.PLAYING) {
      mediaState = this.platform.Characteristic.CurrentMediaState.PLAY
    } else if (this.cachedEvents.playbackStatus === PLAYBACK_STATUS.PAUSED) {
      mediaState = this.platform.Characteristic.CurrentMediaState.PAUSE
    }

    // Update both current and target to keep in sync
    this.speakerService.updateCharacteristic(
      this.platform.Characteristic.CurrentMediaState,
      mediaState
    )

    this.speakerService.updateCharacteristic(
      this.platform.Characteristic.TargetMediaState,
      mediaState
    )
  }

  /**
   * Connect MQTT client for real-time updates
   * @returns {Promise<void>}
   */
  async connectMqtt () {
    // TODO: Implement MQTT client connection
    this.log.debug(LOG_PREFIX.MQTT, `[${this.device.name}] MQTT connection (TODO: implement)`)

    // For now, just mark as online
    this.lastUpdateTime = Date.now()
  }

  /**
   * Destroy accessory - disconnect MQTT and cleanup
   * @returns {Promise<void>}
   */
  async destroy () {
    this.log.info(LOG_PREFIX.ACCESSORY, `Destroying ${this.device.name}`)

    // TODO: Disconnect MQTT when implemented
    if (this.mqtt) {
      // await this.mqtt.disconnect()
      this.mqtt = null
    }
  }
}
