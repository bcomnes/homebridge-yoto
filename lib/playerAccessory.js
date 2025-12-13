/**
 * @fileoverview Yoto Player Accessory implementation - handles HomeKit services for a single player
 */

/** @import { PlatformAccessory, CharacteristicValue } from 'homebridge' */
/** @import { YotoPlatform } from './platform.js' */
/** @import { YotoAccessoryContext, YotoDeviceStatus, YotoPlaybackEvents } from './types.js' */

import { YotoMqtt } from './yotoMqtt.js'
import {
  DEFAULT_MANUFACTURER,
  DEFAULT_MODEL,
  LOW_BATTERY_THRESHOLD,
  PLAYBACK_STATUS,
  CARD_INSERTION_STATE,
  DEFAULT_CONFIG,
  LOG_PREFIX
} from './constants.js'

/**
 * Yoto Player Accessory Handler
 */
export class YotoPlayerAccessory {
  /**
   * @param {YotoPlatform} platform - Platform instance
   * @param {PlatformAccessory<YotoAccessoryContext>} accessory - Platform accessory
   */
  constructor (platform, accessory) {
    this.platform = platform
    this.accessory = accessory
    this.log = platform.log

    // Get device info from context
    this.device = accessory.context.device

    // Cache for current state
    this.currentStatus = accessory.context.lastStatus || null
    this.currentEvents = accessory.context.lastEvents || null
    this.lastUpdateTime = Date.now()

    // Create dedicated MQTT client for this device
    this.mqtt = new YotoMqtt(this.log)

    this.log.debug(LOG_PREFIX.ACCESSORY, `[${this.device.name}] Initializing accessory`)

    // Set up services
    this.setupAccessoryInformation()
    this.setupSmartSpeakerService()

    // Optional services based on config
    if (this.platform.config.exposeBattery !== false) {
      this.setupBatteryService()
    }

    if (this.platform.config.exposeTemperature) {
      this.setupTemperatureService()
    }

    if (this.platform.config.exposeConnectionStatus) {
      this.setupConnectionStatusService()
    }

    if (this.platform.config.exposeCardDetection) {
      this.setupCardDetectionService()
    }

    // Display brightness control (optional)
    if (this.platform.config.exposeDisplayBrightness !== false) {
      this.setupDisplayBrightnessService()
    }

    // Advanced control switches (optional)
    if (this.platform.config.exposeAdvancedControls) {
      this.setupAdvancedControlSwitches()
    }

    // Sleep timer control (optional)
    if (this.platform.config.exposeSleepTimer) {
      this.setupSleepTimerService()
    }

    // Volume limits control (optional)
    if (this.platform.config.exposeVolumeLimits) {
      this.setupVolumeLimitsServices()
    }

    // Ambient light control (optional)
    if (this.platform.config.exposeAmbientLight) {
      this.setupAmbientLightService()
    }

    // Active content tracking (optional)
    if (this.platform.config.exposeActiveContent !== false) {
      /** @type {string | null} */
      this.activeContentCardId = null
      /** @type {import('./types.js').YotoCardContent | null} */
      this.activeContentInfo = null
    }

    // MQTT connection will be initiated by platform after construction
  }

  /**
   * Initialize the accessory - connect MQTT and subscribe to updates
   * Called by platform after construction
   * @returns {Promise<void>}
   */
  async initialize () {
    await this.connectMqtt()
  }

  /**
   * Set up accessory information service
   */
  setupAccessoryInformation () {
    const infoService = this.accessory.getService(this.platform.Service.AccessoryInformation)
    if (infoService) {
      infoService
        .setCharacteristic(this.platform.Characteristic.Manufacturer, DEFAULT_MANUFACTURER)
        .setCharacteristic(this.platform.Characteristic.Model, this.device.deviceType || DEFAULT_MODEL)
        .setCharacteristic(this.platform.Characteristic.SerialNumber, this.device.deviceId)
        .setCharacteristic(this.platform.Characteristic.FirmwareRevision, this.device.releaseChannel || '1.0.0')
    }
  }

  /**
   * Set up smart speaker service for media control
   */
  setupSmartSpeakerService () {
    // Get or create the SmartSpeaker service
    this.speakerService =
      this.accessory.getService(this.platform.Service.SmartSpeaker) ||
      this.accessory.addService(this.platform.Service.SmartSpeaker)

    this.speakerService.setCharacteristic(this.platform.Characteristic.Name, this.device.name)

    // Current Media State (read-only)
    this.speakerService
      .getCharacteristic(this.platform.Characteristic.CurrentMediaState)
      .onGet(this.getCurrentMediaState.bind(this))

    // Target Media State (control playback)
    this.speakerService
      .getCharacteristic(this.platform.Characteristic.TargetMediaState)
      .onGet(this.getTargetMediaState.bind(this))
      .onSet(this.setTargetMediaState.bind(this))

    // Volume
    this.speakerService
      .getCharacteristic(this.platform.Characteristic.Volume)
      .onGet(this.getVolume.bind(this))
      .onSet(this.setVolume.bind(this))

    // Mute
    this.speakerService
      .getCharacteristic(this.platform.Characteristic.Mute)
      .onGet(this.getMute.bind(this))
      .onSet(this.setMute.bind(this))
  }

  /**
   * Set up battery service
   */
  setupBatteryService () {
    this.batteryService =
      this.accessory.getService(this.platform.Service.Battery) ||
      this.accessory.addService(this.platform.Service.Battery)

    this.batteryService.setCharacteristic(this.platform.Characteristic.Name, `${this.device.name} Battery`)

    // Battery Level
    this.batteryService
      .getCharacteristic(this.platform.Characteristic.BatteryLevel)
      .onGet(this.getBatteryLevel.bind(this))

    // Charging State
    this.batteryService
      .getCharacteristic(this.platform.Characteristic.ChargingState)
      .onGet(this.getChargingState.bind(this))

    // Status Low Battery
    this.batteryService
      .getCharacteristic(this.platform.Characteristic.StatusLowBattery)
      .onGet(this.getStatusLowBattery.bind(this))
  }

  /**
   * Set up temperature sensor service
   */
  setupTemperatureService () {
    this.temperatureService =
      this.accessory.getService(this.platform.Service.TemperatureSensor) ||
      this.accessory.addService(this.platform.Service.TemperatureSensor)

    this.temperatureService.setCharacteristic(this.platform.Characteristic.Name, `${this.device.name} Temperature`)

    this.temperatureService
      .getCharacteristic(this.platform.Characteristic.CurrentTemperature)
      .onGet(this.getCurrentTemperature.bind(this))
  }

  /**
   * Set up connection status sensor (occupancy sensor)
   */
  setupConnectionStatusService () {
    this.connectionService =
      this.accessory.getService(this.platform.Service.OccupancySensor) ||
      this.accessory.addService(this.platform.Service.OccupancySensor)

    this.connectionService.setCharacteristic(this.platform.Characteristic.Name, `${this.device.name} Connection`)

    this.connectionService
      .getCharacteristic(this.platform.Characteristic.OccupancyDetected)
      .onGet(this.getOccupancyDetected.bind(this))

    this.connectionService
      .getCharacteristic(this.platform.Characteristic.StatusActive)
      .onGet(this.getStatusActive.bind(this))
  }

  /**
   * Set up card detection sensor (contact sensor)
   */
  setupCardDetectionService () {
    this.cardDetectionService =
      this.accessory.getService(this.platform.Service.ContactSensor) ||
      this.accessory.addService(this.platform.Service.ContactSensor)

    this.cardDetectionService.setCharacteristic(this.platform.Characteristic.Name, `${this.device.name} Card`)

    this.cardDetectionService
      .getCharacteristic(this.platform.Characteristic.ContactSensorState)
      .onGet(this.getContactSensorState.bind(this))
  }

  /**
   * Set up display brightness control (lightbulb service)
   */
  setupDisplayBrightnessService () {
    this.displayService =
      this.accessory.getService(this.platform.Service.Lightbulb) ||
      this.accessory.addService(this.platform.Service.Lightbulb)

    this.displayService.setCharacteristic(this.platform.Characteristic.Name, `${this.device.name} Display`)

    // On/Off state
    this.displayService
      .getCharacteristic(this.platform.Characteristic.On)
      .onGet(this.getDisplayOn.bind(this))
      .onSet(this.setDisplayOn.bind(this))

    // Brightness
    this.displayService
      .getCharacteristic(this.platform.Characteristic.Brightness)
      .onGet(this.getDisplayBrightness.bind(this))
      .onSet(this.setDisplayBrightness.bind(this))
  }

  /**
   * Set up advanced control switches
   */
  setupAdvancedControlSwitches () {
    // Bluetooth enabled switch
    this.bluetoothSwitch =
      this.accessory.getService(`${this.device.name} Bluetooth`) ||
      this.accessory.addService(this.platform.Service.Switch, `${this.device.name} Bluetooth`, 'bluetooth')

    this.bluetoothSwitch.setCharacteristic(this.platform.Characteristic.Name, `${this.device.name} Bluetooth`)

    this.bluetoothSwitch
      .getCharacteristic(this.platform.Characteristic.On)
      .onGet(this.getBluetoothEnabled.bind(this))
      .onSet(this.setBluetoothEnabled.bind(this))

    // Repeat all switch
    this.repeatSwitch =
      this.accessory.getService(`${this.device.name} Repeat`) ||
      this.accessory.addService(this.platform.Service.Switch, `${this.device.name} Repeat`, 'repeat')

    this.repeatSwitch.setCharacteristic(this.platform.Characteristic.Name, `${this.device.name} Repeat`)

    this.repeatSwitch
      .getCharacteristic(this.platform.Characteristic.On)
      .onGet(this.getRepeatAll.bind(this))
      .onSet(this.setRepeatAll.bind(this))

    // Bluetooth headphones switch
    this.btHeadphonesSwitch =
      this.accessory.getService(`${this.device.name} BT Headphones`) ||
      this.accessory.addService(this.platform.Service.Switch, `${this.device.name} BT Headphones`, 'bt-headphones')

    this.btHeadphonesSwitch.setCharacteristic(this.platform.Characteristic.Name, `${this.device.name} BT Headphones`)

    this.btHeadphonesSwitch
      .getCharacteristic(this.platform.Characteristic.On)
      .onGet(this.getBtHeadphonesEnabled.bind(this))
      .onSet(this.setBtHeadphonesEnabled.bind(this))
  }

  /**
   * Set up sleep timer control (fan service)
   */
  setupSleepTimerService () {
    this.sleepTimerService =
      this.accessory.getService(this.platform.Service.Fanv2) ||
      this.accessory.addService(this.platform.Service.Fanv2)

    this.sleepTimerService.setCharacteristic(this.platform.Characteristic.Name, `${this.device.name} Sleep Timer`)

    // Active state (timer on/off)
    this.sleepTimerService
      .getCharacteristic(this.platform.Characteristic.Active)
      .onGet(this.getSleepTimerActive.bind(this))
      .onSet(this.setSleepTimerActive.bind(this))

    // Rotation speed represents minutes (0-100 mapped to 0-120 minutes)
    this.sleepTimerService
      .getCharacteristic(this.platform.Characteristic.RotationSpeed)
      .setProps({ minValue: 0, maxValue: 100, minStep: 1 })
      .onGet(this.getSleepTimerMinutes.bind(this))
      .onSet(this.setSleepTimerMinutes.bind(this))
  }

  /**
   * Set up volume limit controls (lightbulb services)
   */
  setupVolumeLimitsServices () {
    // Day volume limit
    this.dayVolumeLimitService =
      this.accessory.getService(`${this.device.name} Day Volume Limit`) ||
      this.accessory.addService(this.platform.Service.Lightbulb, `${this.device.name} Day Volume Limit`, 'day-volume-limit')

    this.dayVolumeLimitService.setCharacteristic(this.platform.Characteristic.Name, `${this.device.name} Day Volume Limit`)

    this.dayVolumeLimitService
      .getCharacteristic(this.platform.Characteristic.On)
      .onGet(this.getDayVolumeLimitEnabled.bind(this))
      .onSet(this.setDayVolumeLimitEnabled.bind(this))

    this.dayVolumeLimitService
      .getCharacteristic(this.platform.Characteristic.Brightness)
      .setProps({ minValue: 0, maxValue: 100, minStep: 1 })
      .onGet(this.getDayVolumeLimit.bind(this))
      .onSet(this.setDayVolumeLimit.bind(this))

    // Night volume limit
    this.nightVolumeLimitService =
      this.accessory.getService(`${this.device.name} Night Volume Limit`) ||
      this.accessory.addService(this.platform.Service.Lightbulb, `${this.device.name} Night Volume Limit`, 'night-volume-limit')

    this.nightVolumeLimitService.setCharacteristic(this.platform.Characteristic.Name, `${this.device.name} Night Volume Limit`)

    this.nightVolumeLimitService
      .getCharacteristic(this.platform.Characteristic.On)
      .onGet(this.getNightVolumeLimitEnabled.bind(this))
      .onSet(this.setNightVolumeLimitEnabled.bind(this))

    this.nightVolumeLimitService
      .getCharacteristic(this.platform.Characteristic.Brightness)
      .setProps({ minValue: 0, maxValue: 100, minStep: 1 })
      .onGet(this.getNightVolumeLimit.bind(this))
      .onSet(this.setNightVolumeLimit.bind(this))
  }

  /**
   * Set up ambient light control (lightbulb service with color)
   */
  setupAmbientLightService () {
    this.ambientLightService =
      this.accessory.getService(`${this.device.name} Ambient Light`) ||
      this.accessory.addService(this.platform.Service.Lightbulb, `${this.device.name} Ambient Light`, 'ambient-light')

    this.ambientLightService.setCharacteristic(this.platform.Characteristic.Name, `${this.device.name} Ambient Light`)

    // On/Off state
    this.ambientLightService
      .getCharacteristic(this.platform.Characteristic.On)
      .onGet(this.getAmbientLightOn.bind(this))
      .onSet(this.setAmbientLightOn.bind(this))

    // Hue
    this.ambientLightService
      .getCharacteristic(this.platform.Characteristic.Hue)
      .onGet(this.getAmbientLightHue.bind(this))
      .onSet(this.setAmbientLightHue.bind(this))

    // Saturation
    this.ambientLightService
      .getCharacteristic(this.platform.Characteristic.Saturation)
      .onGet(this.getAmbientLightSaturation.bind(this))
      .onSet(this.setAmbientLightSaturation.bind(this))

    // Brightness
    this.ambientLightService
      .getCharacteristic(this.platform.Characteristic.Brightness)
      .onGet(this.getAmbientLightBrightness.bind(this))
      .onSet(this.setAmbientLightBrightness.bind(this))
  }

  /**
   * Connect MQTT for this device
   */
  async connectMqtt () {
    try {
      // Ensure we have an access token
      if (!this.platform.config.accessToken) {
        this.log.warn(LOG_PREFIX.ACCESSORY, `[${this.device.name}] No access token available for MQTT connection`)
        return
      }

      // TEMPORARY: Debug logging for MQTT troubleshooting
      this.log.warn(LOG_PREFIX.ACCESSORY, `[${this.device.name}] MQTT Connection Details:`)
      this.log.warn(LOG_PREFIX.ACCESSORY, `  Device ID: ${this.device.deviceId}`)
      this.log.warn(LOG_PREFIX.ACCESSORY, `  Access Token: ${this.platform.config.accessToken}`)
      this.log.warn(LOG_PREFIX.ACCESSORY, `  Token Length: ${this.platform.config.accessToken.length}`)

      // Connect MQTT with device ID and access token
      await this.mqtt.connect(
        this.platform.config.accessToken,
        this.device.deviceId
      )

      // Subscribe to device topics
      await this.mqtt.subscribeToDevice(this.device.deviceId, {
        onStatus: this.handleStatusUpdate.bind(this),
        onEvents: this.handleEventsUpdate.bind(this),
        onResponse: this.handleCommandResponse.bind(this)
      })

      this.log.debug(LOG_PREFIX.ACCESSORY, `[${this.device.name}] MQTT connected and subscribed`)
    } catch (error) {
      this.log.error(LOG_PREFIX.ACCESSORY, `[${this.device.name}] Failed to connect MQTT:`, error)
    }
  }

  /**
   * Handle device status update from MQTT
   * @param {YotoDeviceStatus} status - Device status
   */
  handleStatusUpdate (status) {
    this.log.debug(LOG_PREFIX.ACCESSORY, `[${this.device.name}] Status update received`)
    this.currentStatus = status
    this.lastUpdateTime = Date.now()
    this.accessory.context.lastStatus = status

    // Update all characteristics
    this.updateCharacteristics()
  }

  /**
   * Handle playback events update from MQTT
   * @param {YotoPlaybackEvents} events - Playback events
   */
  handleEventsUpdate (events) {
    this.log.debug(LOG_PREFIX.ACCESSORY, `[${this.device.name}] Events update received`)
    this.currentEvents = events
    this.lastUpdateTime = Date.now()
    this.accessory.context.lastEvents = events

    // Track active content changes
    if (this.platform.config.exposeActiveContent !== false && events.cardId) {
      this.handleActiveContentChange(events.cardId)
    }

    // Update playback-related characteristics
    this.updatePlaybackCharacteristics()
  }

  /**
   * Handle command response from MQTT
   * @param {import('./types.js').MqttCommandResponse} response - Command response
   */
  handleCommandResponse (response) {
    this.log.debug(LOG_PREFIX.ACCESSORY, `[${this.device.name}] Command response:`, response)
  }

  /**
   * Update all characteristics with current state
   */
  updateCharacteristics () {
    if (!this.currentStatus) {
      return
    }

    // Update volume
    if (this.speakerService) {
      this.speakerService.updateCharacteristic(
        this.platform.Characteristic.Volume,
        this.currentStatus.userVolume
      )
    }

    // Update battery
    if (this.batteryService) {
      this.batteryService.updateCharacteristic(
        this.platform.Characteristic.BatteryLevel,
        this.currentStatus.batteryLevel
      )

      this.batteryService.updateCharacteristic(
        this.platform.Characteristic.ChargingState,
        this.currentStatus.charging
          ? this.platform.Characteristic.ChargingState.CHARGING
          : this.platform.Characteristic.ChargingState.NOT_CHARGING
      )

      this.batteryService.updateCharacteristic(
        this.platform.Characteristic.StatusLowBattery,
        this.currentStatus.batteryLevel < LOW_BATTERY_THRESHOLD
          ? this.platform.Characteristic.StatusLowBattery.BATTERY_LEVEL_LOW
          : this.platform.Characteristic.StatusLowBattery.BATTERY_LEVEL_NORMAL
      )
    }

    // Update temperature
    if (this.temperatureService && this.currentStatus.temp) {
      const temp = parseFloat(this.currentStatus.temp)
      if (!isNaN(temp)) {
        this.temperatureService.updateCharacteristic(
          this.platform.Characteristic.CurrentTemperature,
          temp
        )
      }

      // Update display brightness
      if (this.displayService) {
        const isOn = this.currentStatus.dnowBrightness > 0
        this.displayService.updateCharacteristic(
          this.platform.Characteristic.On,
          isOn
        )

        // Map brightness (0-100) from device brightness value
        const brightness = Math.min(100, Math.max(0, this.currentStatus.dnowBrightness))
        this.displayService.updateCharacteristic(
          this.platform.Characteristic.Brightness,
          brightness
        )
      }

      // Update advanced control switches
      if (this.bluetoothSwitch) {
        const bluetoothEnabled = this.currentStatus.bluetoothHp
        this.bluetoothSwitch.updateCharacteristic(
          this.platform.Characteristic.On,
          bluetoothEnabled
        )
      }

      if (this.btHeadphonesSwitch) {
        const btHeadphonesEnabled = this.currentStatus.bluetoothHp
        this.btHeadphonesSwitch.updateCharacteristic(
          this.platform.Characteristic.On,
          btHeadphonesEnabled
        )
      }
    }

    // Update repeat all from events if available
    if (this.currentEvents && this.repeatSwitch) {
      const repeatAll = this.currentEvents.repeatAll === 'true'
      this.repeatSwitch.updateCharacteristic(
        this.platform.Characteristic.On,
        repeatAll
      )
    }

    // Update sleep timer from events if available
    if (this.currentEvents && this.sleepTimerService) {
      const sleepTimerActive = this.currentEvents.sleepTimerActive === 'true'
      this.sleepTimerService.updateCharacteristic(
        this.platform.Characteristic.Active,
        sleepTimerActive
          ? this.platform.Characteristic.Active.ACTIVE
          : this.platform.Characteristic.Active.INACTIVE
      )

      if (sleepTimerActive && this.currentEvents.sleepTimerSeconds) {
        const seconds = parseInt(this.currentEvents.sleepTimerSeconds)
        const minutes = Math.round(seconds / 60)
        // Map minutes (0-120) to rotation speed (0-100)
        const rotationSpeed = Math.min(100, Math.round((minutes / 120) * 100))
        this.sleepTimerService.updateCharacteristic(
          this.platform.Characteristic.RotationSpeed,
          rotationSpeed
        )
      }
    }

    // Update connection status
    if (this.connectionService) {
      const isOnline = this.isDeviceOnline()
      this.connectionService.updateCharacteristic(
        this.platform.Characteristic.OccupancyDetected,
        isOnline
          ? this.platform.Characteristic.OccupancyDetected.OCCUPANCY_DETECTED
          : this.platform.Characteristic.OccupancyDetected.OCCUPANCY_NOT_DETECTED
      )

      this.connectionService.updateCharacteristic(
        this.platform.Characteristic.StatusActive,
        isOnline
      )
    }

    // Update card detection
    if (this.cardDetectionService) {
      const cardInserted = this.currentStatus.cardInserted !== CARD_INSERTION_STATE.NONE
      this.cardDetectionService.updateCharacteristic(
        this.platform.Characteristic.ContactSensorState,
        cardInserted
          ? this.platform.Characteristic.ContactSensorState.CONTACT_DETECTED
          : this.platform.Characteristic.ContactSensorState.CONTACT_NOT_DETECTED
      )
    }
  }

  /**
   * Update playback-related characteristics
   */
  updatePlaybackCharacteristics () {
    if (!this.currentEvents || !this.speakerService) {
      return
    }

    // Map playback status to HomeKit media state
    let mediaState = this.platform.Characteristic.CurrentMediaState.STOP

    if (this.currentEvents.playbackStatus === PLAYBACK_STATUS.PLAYING) {
      mediaState = this.platform.Characteristic.CurrentMediaState.PLAY
    } else if (this.currentEvents.playbackStatus === PLAYBACK_STATUS.PAUSED) {
      mediaState = this.platform.Characteristic.CurrentMediaState.PAUSE
    }

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
   * Check if device is considered online based on last update time
   * @returns {boolean}
   */
  isDeviceOnline () {
    const timeoutMs = (this.platform.config.statusTimeoutSeconds || DEFAULT_CONFIG.statusTimeoutSeconds) * 1000
    return Date.now() - this.lastUpdateTime < timeoutMs
  }

  // ==================== Characteristic Handlers ====================

  /**
   * Get current media state
   * @returns {Promise<CharacteristicValue>}
   */
  async getCurrentMediaState () {
    if (!this.currentEvents) {
      return this.platform.Characteristic.CurrentMediaState.STOP
    }

    if (this.currentEvents.playbackStatus === PLAYBACK_STATUS.PLAYING) {
      return this.platform.Characteristic.CurrentMediaState.PLAY
    } else if (this.currentEvents.playbackStatus === PLAYBACK_STATUS.PAUSED) {
      return this.platform.Characteristic.CurrentMediaState.PAUSE
    }

    return this.platform.Characteristic.CurrentMediaState.STOP
  }

  /**
   * Get target media state
   * @returns {Promise<CharacteristicValue>}
   */
  async getTargetMediaState () {
    // Target state follows current state
    return this.getCurrentMediaState()
  }

  /**
   * Set target media state (play/pause/stop)
   * @param {CharacteristicValue} value - Target state
   */
  async setTargetMediaState (value) {
    this.log.debug(LOG_PREFIX.ACCESSORY, `[${this.device.name}] Set target media state:`, value)

    try {
      if (value === this.platform.Characteristic.TargetMediaState.PLAY) {
        await this.mqtt.resumeCard(this.device.deviceId)
      } else if (value === this.platform.Characteristic.TargetMediaState.PAUSE) {
        await this.mqtt.pauseCard(this.device.deviceId)
      } else if (value === this.platform.Characteristic.TargetMediaState.STOP) {
        await this.mqtt.stopCard(this.device.deviceId)
      }
    } catch (error) {
      this.log.error(LOG_PREFIX.ACCESSORY, `[${this.device.name}] Failed to set media state:`, error)
      throw new this.platform.api.hap.HapStatusError(
        this.platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE
      )
    }
  }

  /**
   * Get volume
   * @returns {Promise<CharacteristicValue>}
   */
  async getVolume () {
    if (!this.currentStatus) {
      return 50
    }
    return this.currentStatus.userVolume
  }

  /**
   * Set volume
   * @param {CharacteristicValue} value - Volume level (0-100)
   */
  async setVolume (value) {
    this.log.debug(LOG_PREFIX.ACCESSORY, `[${this.device.name}] Set volume:`, value)

    try {
      await this.mqtt.setVolume(this.device.deviceId, Number(value))
    } catch (error) {
      this.log.error(LOG_PREFIX.ACCESSORY, `[${this.device.name}] Failed to set volume:`, error)
      throw new this.platform.api.hap.HapStatusError(
        this.platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE
      )
    }
  }

  /**
   * Get mute state
   * @returns {Promise<CharacteristicValue>}
   */
  async getMute () {
    if (!this.currentStatus) {
      return false
    }
    return this.currentStatus.userVolume === 0
  }

  /**
   * Set mute state
   * @param {CharacteristicValue} value - Mute state
   */
  async setMute (value) {
    this.log.debug(LOG_PREFIX.ACCESSORY, `[${this.device.name}] Set mute:`, value)

    try {
      if (value) {
        // Mute - set volume to 0
        await this.mqtt.setVolume(this.device.deviceId, 0)
      } else {
        // Unmute - restore to a reasonable volume if currently 0
        const currentVolume = this.currentStatus?.userVolume || 0
        const targetVolume = currentVolume === 0 ? 50 : currentVolume
        await this.mqtt.setVolume(this.device.deviceId, targetVolume)
      }
    } catch (error) {
      this.log.error(LOG_PREFIX.ACCESSORY, `[${this.device.name}] Failed to set mute:`, error)
      throw new this.platform.api.hap.HapStatusError(
        this.platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE
      )
    }
  }

  /**
   * Get battery level
   * @returns {Promise<CharacteristicValue>}
   */
  async getBatteryLevel () {
    if (!this.currentStatus) {
      return 100
    }
    return this.currentStatus.batteryLevel
  }

  /**
   * Get charging state
   * @returns {Promise<CharacteristicValue>}
   */
  async getChargingState () {
    if (!this.currentStatus) {
      return this.platform.Characteristic.ChargingState.NOT_CHARGING
    }

    return this.currentStatus.charging
      ? this.platform.Characteristic.ChargingState.CHARGING
      : this.platform.Characteristic.ChargingState.NOT_CHARGING
  }

  /**
   * Get low battery status
   * @returns {Promise<CharacteristicValue>}
   */
  async getStatusLowBattery () {
    if (!this.currentStatus) {
      return this.platform.Characteristic.StatusLowBattery.BATTERY_LEVEL_NORMAL
    }

    return this.currentStatus.batteryLevel < LOW_BATTERY_THRESHOLD
      ? this.platform.Characteristic.StatusLowBattery.BATTERY_LEVEL_LOW
      : this.platform.Characteristic.StatusLowBattery.BATTERY_LEVEL_NORMAL
  }

  /**
   * Get current temperature
   * @returns {Promise<CharacteristicValue>}
   */
  async getCurrentTemperature () {
    if (!this.currentStatus || !this.currentStatus.temp) {
      return 20
    }

    const temp = parseFloat(this.currentStatus.temp)
    return isNaN(temp) ? 20 : temp
  }

  /**
   * Get occupancy detected (connection status)
   * @returns {Promise<CharacteristicValue>}
   */
  async getOccupancyDetected () {
    const isOnline = this.isDeviceOnline()
    return isOnline
      ? this.platform.Characteristic.OccupancyDetected.OCCUPANCY_DETECTED
      : this.platform.Characteristic.OccupancyDetected.OCCUPANCY_NOT_DETECTED
  }

  /**
   * Get status active (connection status)
   * @returns {Promise<CharacteristicValue>}
   */
  async getStatusActive () {
    return this.isDeviceOnline()
  }

  /**
   * Get contact sensor state (card detection)
   * @returns {Promise<CharacteristicValue>}
   */
  async getContactSensorState () {
    if (!this.currentStatus) {
      return this.platform.Characteristic.ContactSensorState.CONTACT_NOT_DETECTED
    }

    const cardInserted = this.currentStatus.cardInserted !== CARD_INSERTION_STATE.NONE
    return cardInserted
      ? this.platform.Characteristic.ContactSensorState.CONTACT_DETECTED
      : this.platform.Characteristic.ContactSensorState.CONTACT_NOT_DETECTED
  }

  /**
   * Get display on state
   * @returns {Promise<CharacteristicValue>}
   */
  async getDisplayOn () {
    if (!this.currentStatus) {
      return true
    }
    return this.currentStatus.dnowBrightness > 0
  }

  /**
   * Set display on/off state
   * @param {CharacteristicValue} value - On/off state
   */
  async setDisplayOn (value) {
    this.log.debug(LOG_PREFIX.ACCESSORY, `[${this.device.name}] Set display on:`, value)

    try {
      // Get current config to update brightness settings
      const config = await this.platform.yotoApi.getDeviceConfig(this.device.deviceId)

      if (value) {
        // Turn on - restore to auto or previous brightness
        config.config.dayDisplayBrightness = 'auto'
        config.config.nightDisplayBrightness = 'auto'
      } else {
        // Turn off - set brightness to 0
        config.config.dayDisplayBrightness = '0'
        config.config.nightDisplayBrightness = '0'
      }

      await this.platform.yotoApi.updateDeviceConfig(this.device.deviceId, config)
    } catch (error) {
      this.log.error(LOG_PREFIX.ACCESSORY, `[${this.device.name}] Failed to set display on:`, error)
      throw new this.platform.api.hap.HapStatusError(
        this.platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE
      )
    }
  }

  /**
   * Get display brightness
   * @returns {Promise<CharacteristicValue>}
   */
  async getDisplayBrightness () {
    if (!this.currentStatus) {
      return 100
    }

    // Use current brightness value (0-100)
    return Math.min(100, Math.max(0, this.currentStatus.dnowBrightness))
  }

  /**
   * Set display brightness
   * @param {CharacteristicValue} value - Brightness level (0-100)
   */
  async setDisplayBrightness (value) {
    this.log.debug(LOG_PREFIX.ACCESSORY, `[${this.device.name}] Set display brightness:`, value)

    try {
      const config = await this.platform.yotoApi.getDeviceConfig(this.device.deviceId)

      // Map 0-100 to brightness string
      const brightness = String(Math.round(Number(value)))

      // Update both day and night brightness
      config.config.dayDisplayBrightness = brightness
      config.config.nightDisplayBrightness = brightness

      await this.platform.yotoApi.updateDeviceConfig(this.device.deviceId, config)
    } catch (error) {
      this.log.error(LOG_PREFIX.ACCESSORY, `[${this.device.name}] Failed to set display brightness:`, error)
      throw new this.platform.api.hap.HapStatusError(
        this.platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE
      )
    }
  }

  /**
   * Get Bluetooth enabled state
   * @returns {Promise<CharacteristicValue>}
   */
  async getBluetoothEnabled () {
    if (!this.currentStatus) {
      return false
    }
    return this.currentStatus.bluetoothHp
  }

  /**
   * Set Bluetooth enabled state
   * @param {CharacteristicValue} value - Enabled state
   */
  async setBluetoothEnabled (value) {
    this.log.debug(LOG_PREFIX.ACCESSORY, `[${this.device.name}] Set Bluetooth enabled:`, value)

    try {
      const config = await this.platform.yotoApi.getDeviceConfig(this.device.deviceId)
      config.config.bluetoothEnabled = value ? '1' : '0'
      await this.platform.yotoApi.updateDeviceConfig(this.device.deviceId, config)
    } catch (error) {
      this.log.error(LOG_PREFIX.ACCESSORY, `[${this.device.name}] Failed to set Bluetooth:`, error)
      throw new this.platform.api.hap.HapStatusError(
        this.platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE
      )
    }
  }

  /**
   * Get repeat all state
   * @returns {Promise<CharacteristicValue>}
   */
  async getRepeatAll () {
    if (!this.currentEvents) {
      return false
    }
    return this.currentEvents.repeatAll === 'true'
  }

  /**
   * Set repeat all state
   * @param {CharacteristicValue} value - Repeat state
   */
  async setRepeatAll (value) {
    this.log.debug(LOG_PREFIX.ACCESSORY, `[${this.device.name}] Set repeat all:`, value)

    try {
      const config = await this.platform.yotoApi.getDeviceConfig(this.device.deviceId)
      config.config.repeatAll = Boolean(value)
      await this.platform.yotoApi.updateDeviceConfig(this.device.deviceId, config)
    } catch (error) {
      this.log.error(LOG_PREFIX.ACCESSORY, `[${this.device.name}] Failed to set repeat:`, error)
      throw new this.platform.api.hap.HapStatusError(
        this.platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE
      )
    }
  }

  /**
   * Get Bluetooth headphones enabled state
   * @returns {Promise<CharacteristicValue>}
   */
  async getBtHeadphonesEnabled () {
    if (!this.currentStatus) {
      return false
    }
    return this.currentStatus.bluetoothHp
  }

  /**
   * Set Bluetooth headphones enabled state
   * @param {CharacteristicValue} value - Enabled state
   */
  async setBtHeadphonesEnabled (value) {
    this.log.debug(LOG_PREFIX.ACCESSORY, `[${this.device.name}] Set BT headphones enabled:`, value)

    try {
      const config = await this.platform.yotoApi.getDeviceConfig(this.device.deviceId)
      config.config.btHeadphonesEnabled = Boolean(value)
      await this.platform.yotoApi.updateDeviceConfig(this.device.deviceId, config)
    } catch (error) {
      this.log.error(LOG_PREFIX.ACCESSORY, `[${this.device.name}] Failed to set BT headphones:`, error)
      throw new this.platform.api.hap.HapStatusError(
        this.platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE
      )
    }
  }

  /**
   * Get sleep timer active state
   * @returns {Promise<CharacteristicValue>}
   */
  async getSleepTimerActive () {
    if (!this.currentEvents) {
      return this.platform.Characteristic.Active.INACTIVE
    }
    return this.currentEvents.sleepTimerActive === 'true'
      ? this.platform.Characteristic.Active.ACTIVE
      : this.platform.Characteristic.Active.INACTIVE
  }

  /**
   * Set sleep timer active state
   * @param {CharacteristicValue} value - Active state
   */
  async setSleepTimerActive (value) {
    this.log.debug(LOG_PREFIX.ACCESSORY, `[${this.device.name}] Set sleep timer active:`, value)

    try {
      if (value === this.platform.Characteristic.Active.INACTIVE) {
        // Turn off timer
        await this.mqtt.setSleepTimer(this.device.deviceId, 0)
      } else {
        // Turn on with default duration (30 minutes)
        await this.mqtt.setSleepTimer(this.device.deviceId, 30 * 60)
      }
    } catch (error) {
      this.log.error(LOG_PREFIX.ACCESSORY, `[${this.device.name}] Failed to set sleep timer active:`, error)
      throw new this.platform.api.hap.HapStatusError(
        this.platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE
      )
    }
  }

  /**
   * Get sleep timer minutes (as rotation speed)
   * @returns {Promise<CharacteristicValue>}
   */
  async getSleepTimerMinutes () {
    if (!this.currentEvents || this.currentEvents.sleepTimerActive !== 'true') {
      return 0
    }

    const seconds = parseInt(this.currentEvents.sleepTimerSeconds || '0')
    const minutes = Math.round(seconds / 60)
    // Map minutes (0-120) to rotation speed (0-100)
    return Math.min(100, Math.round((minutes / 120) * 100))
  }

  /**
   * Set sleep timer minutes (from rotation speed)
   * @param {CharacteristicValue} value - Rotation speed (0-100)
   */
  async setSleepTimerMinutes (value) {
    this.log.debug(LOG_PREFIX.ACCESSORY, `[${this.device.name}] Set sleep timer minutes:`, value)

    try {
      // Map rotation speed (0-100) to minutes (0-120)
      const minutes = Math.round((Number(value) / 100) * 120)
      const seconds = minutes * 60

      if (seconds === 0) {
        // Turn off timer
        await this.mqtt.setSleepTimer(this.device.deviceId, 0)
      } else {
        // Set timer with specified duration
        await this.mqtt.setSleepTimer(this.device.deviceId, seconds)
      }
    } catch (error) {
      this.log.error(LOG_PREFIX.ACCESSORY, `[${this.device.name}] Failed to set sleep timer:`, error)
      throw new this.platform.api.hap.HapStatusError(
        this.platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE
      )
    }
  }

  /**
   * Get day volume limit enabled state
   * @returns {Promise<CharacteristicValue>}
   */
  async getDayVolumeLimitEnabled () {
    // Always enabled - brightness controls the limit
    return true
  }

  /**
   * Set day volume limit enabled state
   * @param {CharacteristicValue} _value - Enabled state (unused)
   */
  async setDayVolumeLimitEnabled (_value) {
    // No-op - always enabled, use brightness to control
    this.log.debug(LOG_PREFIX.ACCESSORY, `[${this.device.name}] Day volume limit always enabled`)
  }

  /**
   * Get day volume limit (0-16 mapped to 0-100)
   * @returns {Promise<CharacteristicValue>}
   */
  async getDayVolumeLimit () {
    try {
      const config = await this.platform.yotoApi.getDeviceConfig(this.device.deviceId)
      const limit = parseInt(config.config.maxVolumeLimit || '16')
      // Map 0-16 to 0-100
      return Math.round((limit / 16) * 100)
    } catch (error) {
      this.log.error(LOG_PREFIX.ACCESSORY, `[${this.device.name}] Failed to get day volume limit:`, error)
      return 100
    }
  }

  /**
   * Set day volume limit (0-100 mapped to 0-16)
   * @param {CharacteristicValue} value - Brightness value (0-100)
   */
  async setDayVolumeLimit (value) {
    this.log.debug(LOG_PREFIX.ACCESSORY, `[${this.device.name}] Set day volume limit:`, value)

    try {
      const config = await this.platform.yotoApi.getDeviceConfig(this.device.deviceId)
      // Map 0-100 to 0-16
      const limit = Math.round((Number(value) / 100) * 16)
      config.config.maxVolumeLimit = String(limit)
      await this.platform.yotoApi.updateDeviceConfig(this.device.deviceId, config)
    } catch (error) {
      this.log.error(LOG_PREFIX.ACCESSORY, `[${this.device.name}] Failed to set day volume limit:`, error)
      throw new this.platform.api.hap.HapStatusError(
        this.platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE
      )
    }
  }

  /**
   * Get night volume limit enabled state
   * @returns {Promise<CharacteristicValue>}
   */
  async getNightVolumeLimitEnabled () {
    // Always enabled - brightness controls the limit
    return true
  }

  /**
   * Set night volume limit enabled state
   * @param {CharacteristicValue} _value - Enabled state (unused)
   */
  async setNightVolumeLimitEnabled (_value) {
    // No-op - always enabled, use brightness to control
    this.log.debug(LOG_PREFIX.ACCESSORY, `[${this.device.name}] Night volume limit always enabled`)
  }

  /**
   * Get night volume limit (0-16 mapped to 0-100)
   * @returns {Promise<CharacteristicValue>}
   */
  async getNightVolumeLimit () {
    try {
      const config = await this.platform.yotoApi.getDeviceConfig(this.device.deviceId)
      const limit = parseInt(config.config.nightMaxVolumeLimit || '16')
      // Map 0-16 to 0-100
      return Math.round((limit / 16) * 100)
    } catch (error) {
      this.log.error(LOG_PREFIX.ACCESSORY, `[${this.device.name}] Failed to get night volume limit:`, error)
      return 100
    }
  }

  /**
   * Set night volume limit (0-100 mapped to 0-16)
   * @param {CharacteristicValue} value - Brightness value (0-100)
   */
  async setNightVolumeLimit (value) {
    this.log.debug(LOG_PREFIX.ACCESSORY, `[${this.device.name}] Set night volume limit:`, value)

    try {
      const config = await this.platform.yotoApi.getDeviceConfig(this.device.deviceId)
      // Map 0-100 to 0-16
      const limit = Math.round((Number(value) / 100) * 16)
      config.config.nightMaxVolumeLimit = String(limit)
      await this.platform.yotoApi.updateDeviceConfig(this.device.deviceId, config)
    } catch (error) {
      this.log.error(LOG_PREFIX.ACCESSORY, `[${this.device.name}] Failed to set night volume limit:`, error)
      throw new this.platform.api.hap.HapStatusError(
        this.platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE
      )
    }
  }

  /**
   * Get ambient light on state
   * @returns {Promise<CharacteristicValue>}
   */
  async getAmbientLightOn () {
    try {
      const config = await this.platform.yotoApi.getDeviceConfig(this.device.deviceId)
      const color = config.config.ambientColour || '#000000'
      // Off if color is black (#000000)
      return color !== '#000000' && color !== 'off'
    } catch (error) {
      this.log.error(LOG_PREFIX.ACCESSORY, `[${this.device.name}] Failed to get ambient light state:`, error)
      return false
    }
  }

  /**
   * Set ambient light on/off state
   * @param {CharacteristicValue} value - On/off state
   */
  async setAmbientLightOn (value) {
    this.log.debug(LOG_PREFIX.ACCESSORY, `[${this.device.name}] Set ambient light on:`, value)

    try {
      if (value) {
        // Turn on - set to white or previous color
        await this.mqtt.setAmbientLight(this.device.deviceId, 255, 255, 255)
      } else {
        // Turn off - set to black
        await this.mqtt.setAmbientLight(this.device.deviceId, 0, 0, 0)
      }
    } catch (error) {
      this.log.error(LOG_PREFIX.ACCESSORY, `[${this.device.name}] Failed to set ambient light on:`, error)
      throw new this.platform.api.hap.HapStatusError(
        this.platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE
      )
    }
  }

  /**
   * Get ambient light hue
   * @returns {Promise<CharacteristicValue>}
   */
  async getAmbientLightHue () {
    try {
      const config = await this.platform.yotoApi.getDeviceConfig(this.device.deviceId)
      const hex = config.config.ambientColour || '#000000'
      const { h } = this.hexToHsv(hex)
      return h
    } catch (error) {
      this.log.error(LOG_PREFIX.ACCESSORY, `[${this.device.name}] Failed to get ambient light hue:`, error)
      return 0
    }
  }

  /**
   * Set ambient light hue
   * @param {CharacteristicValue} value - Hue value (0-360)
   */
  async setAmbientLightHue (value) {
    this.log.debug(LOG_PREFIX.ACCESSORY, `[${this.device.name}] Set ambient light hue:`, value)
    // Store for combined update with saturation and brightness
    this.pendingAmbientHue = Number(value)
    await this.updateAmbientLightColor()
  }

  /**
   * Get ambient light saturation
   * @returns {Promise<CharacteristicValue>}
   */
  async getAmbientLightSaturation () {
    try {
      const config = await this.platform.yotoApi.getDeviceConfig(this.device.deviceId)
      const hex = config.config.ambientColour || '#000000'
      const { s } = this.hexToHsv(hex)
      return s
    } catch (error) {
      this.log.error(LOG_PREFIX.ACCESSORY, `[${this.device.name}] Failed to get ambient light saturation:`, error)
      return 0
    }
  }

  /**
   * Set ambient light saturation
   * @param {CharacteristicValue} value - Saturation value (0-100)
   */
  async setAmbientLightSaturation (value) {
    this.log.debug(LOG_PREFIX.ACCESSORY, `[${this.device.name}] Set ambient light saturation:`, value)
    // Store for combined update with hue and brightness
    this.pendingAmbientSaturation = Number(value)
    await this.updateAmbientLightColor()
  }

  /**
   * Get ambient light brightness
   * @returns {Promise<CharacteristicValue>}
   */
  async getAmbientLightBrightness () {
    try {
      const config = await this.platform.yotoApi.getDeviceConfig(this.device.deviceId)
      const hex = config.config.ambientColour || '#000000'
      const { v } = this.hexToHsv(hex)
      return v
    } catch (error) {
      this.log.error(LOG_PREFIX.ACCESSORY, `[${this.device.name}] Failed to get ambient light brightness:`, error)
      return 100
    }
  }

  /**
   * Set ambient light brightness
   * @param {CharacteristicValue} value - Brightness value (0-100)
   */
  async setAmbientLightBrightness (value) {
    this.log.debug(LOG_PREFIX.ACCESSORY, `[${this.device.name}] Set ambient light brightness:`, value)
    // Store for combined update with hue and saturation
    this.pendingAmbientBrightness = Number(value)
    await this.updateAmbientLightColor()
  }

  /**
   * Update ambient light color using stored HSV values
   */
  async updateAmbientLightColor () {
    try {
      // Get current config to read existing HSV values
      const config = await this.platform.yotoApi.getDeviceConfig(this.device.deviceId)
      const currentHex = config.config.ambientColour || '#ffffff'
      const currentHsv = this.hexToHsv(currentHex)

      // Use pending values or current values
      const h = this.pendingAmbientHue !== undefined ? this.pendingAmbientHue : currentHsv.h
      const s = this.pendingAmbientSaturation !== undefined ? this.pendingAmbientSaturation : currentHsv.s
      const v = this.pendingAmbientBrightness !== undefined ? this.pendingAmbientBrightness : currentHsv.v

      // Convert HSV to RGB
      const { r, g, b } = this.hsvToRgb(h, s, v)

      // Send MQTT command
      await this.mqtt.setAmbientLight(this.device.deviceId, r, g, b)

      // Clear pending values
      this.pendingAmbientHue = undefined
      this.pendingAmbientSaturation = undefined
      this.pendingAmbientBrightness = undefined
    } catch (error) {
      this.log.error(LOG_PREFIX.ACCESSORY, `[${this.device.name}] Failed to update ambient light:`, error)
    }
  }

  /**
   * Convert hex color to HSV
   * @param {string} hex - Hex color string (e.g., "#ff3900")
   * @returns {{ h: number, s: number, v: number }} HSV values (h: 0-360, s: 0-100, v: 0-100)
   */
  hexToHsv (hex) {
    // Remove # if present
    hex = hex.replace('#', '')

    // Parse RGB
    const r = parseInt(hex.substring(0, 2), 16) / 255
    const g = parseInt(hex.substring(2, 4), 16) / 255
    const b = parseInt(hex.substring(4, 6), 16) / 255

    const max = Math.max(r, g, b)
    const min = Math.min(r, g, b)
    const delta = max - min

    let h = 0
    let s = 0
    const v = max

    if (delta !== 0) {
      s = delta / max

      if (max === r) {
        h = ((g - b) / delta + (g < b ? 6 : 0)) / 6
      } else if (max === g) {
        h = ((b - r) / delta + 2) / 6
      } else {
        h = ((r - g) / delta + 4) / 6
      }
    }

    return {
      h: Math.round(h * 360),
      s: Math.round(s * 100),
      v: Math.round(v * 100)
    }
  }

  /**
   * Convert HSV to RGB
   * @param {number} h - Hue (0-360)
   * @param {number} s - Saturation (0-100)
   * @param {number} v - Value/Brightness (0-100)
   * @returns {{ r: number, g: number, b: number }} RGB values (0-255)
   */
  hsvToRgb (h, s, v) {
    h = h / 360
    s = s / 100
    v = v / 100

    let r, g, b

    const i = Math.floor(h * 6)
    const f = h * 6 - i
    const p = v * (1 - s)
    const q = v * (1 - f * s)
    const t = v * (1 - (1 - f) * s)

    switch (i % 6) {
      case 0: r = v; g = t; b = p; break
      case 1: r = q; g = v; b = p; break
      case 2: r = p; g = v; b = t; break
      case 3: r = p; g = q; b = v; break
      case 4: r = t; g = p; b = v; break
      case 5: r = v; g = p; b = q; break
      default: r = 0; g = 0; b = 0
    }

    return {
      r: Math.round(r * 255),
      g: Math.round(g * 255),
      b: Math.round(b * 255)
    }
  }

  /**
   * Handle active content change
   * @param {string} cardId - Card ID
   */
  async handleActiveContentChange (cardId) {
    // Skip if same card
    if (this.activeContentCardId === cardId) {
      return
    }

    this.activeContentCardId = cardId
    this.log.info(LOG_PREFIX.ACCESSORY, `[${this.device.name}] Active card changed: ${cardId}`)

    try {
      // Fetch card details
      const content = await this.platform.yotoApi.getContent(cardId)
      this.activeContentInfo = content

      // Log content information
      const title = content.card?.title || 'Unknown'
      this.log.info(LOG_PREFIX.ACCESSORY, `[${this.device.name}] Now playing: "${title}"`)

      if (content.card?.metadata?.author) {
        this.log.info(LOG_PREFIX.ACCESSORY, `[${this.device.name}] Author: ${content.card.metadata.author}`)
      }

      if (content.card?.metadata?.category) {
        this.log.info(LOG_PREFIX.ACCESSORY, `[${this.device.name}] Category: ${content.card.metadata.category}`)
      }

      // Optionally update accessory display name with current content
      if (this.platform.config.updateAccessoryName && content.card?.title) {
        this.accessory.displayName = `${this.device.name} - ${content.card.title}`
        this.log.debug(LOG_PREFIX.ACCESSORY, `[${this.device.name}] Updated display name`)
      }

      // Store in context for persistence
      this.accessory.context.activeContentInfo = this.activeContentInfo
    } catch (error) {
      this.log.error(LOG_PREFIX.ACCESSORY, `[${this.device.name}] Failed to fetch content details:`, error)
    }
  }
}
