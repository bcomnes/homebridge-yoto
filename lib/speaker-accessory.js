/**
 * @fileoverview Yoto SmartSpeaker accessory implementation for external accessories.
 */

/** @import { PlatformAccessory, CharacteristicValue, Service, Logger } from 'homebridge' */
/** @import { YotoPlatform } from './platform.js' */
/** @import { YotoDeviceModel } from 'yoto-nodejs-client' */
/** @import { YotoDevice } from 'yoto-nodejs-client/lib/api-endpoints/devices.js' */
/** @import { YotoAccessoryContext } from './platform.js' */

import {
  DEFAULT_MANUFACTURER,
  DEFAULT_MODEL,
  LOG_PREFIX,
} from './constants.js'
import { sanitizeName } from './sanitize-name.js'
import { syncServiceNames } from './sync-service-names.js'
import { formatError } from './error-format.js'

/**
 * Yoto SmartSpeaker Accessory Handler (external)
 * Manages SmartSpeaker service and characteristics for a single Yoto player.
 */
export class YotoSpeakerAccessory {
  /** @type {YotoPlatform} */ #platform
  /** @type {PlatformAccessory<YotoAccessoryContext>} */ #accessory
  /** @type {YotoDeviceModel} */ #deviceModel
  /** @type {Logger} */ #log
  /** @type {YotoDevice} */ #device
  /** @type {Service | undefined} */ speakerService
  /** @type {number} */ #lastNonZeroVolume = 50
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

    this.#device = accessory.context.device
    this.#currentServices = new Set()
  }

  /**
   * Setup accessory - create services and setup event listeners
   * @returns {Promise<void>}
   */
  async setup () {
    this.#log.debug(LOG_PREFIX.ACCESSORY, `Setting up speaker for ${this.#device.name}`)

    this.#currentServices.clear()

    this.setupAccessoryInformation()
    this.setupSmartSpeakerService()

    for (const service of this.#accessory.services) {
      if (service.UUID !== this.#platform.Service.AccessoryInformation.UUID &&
          !this.#currentServices.has(service)) {
        this.#log.debug(LOG_PREFIX.ACCESSORY, `Removing stale speaker service: ${service.displayName || service.UUID}`)
        this.#accessory.removeService(service)
      }
    }

    this.setupEventListeners()

    this.#log.debug(LOG_PREFIX.ACCESSORY, `✓ ${this.#device.name} speaker ready`)
  }

  /**
   * Setup AccessoryInformation service
   */
  setupAccessoryInformation () {
    const { Service, Characteristic } = this.#platform
    const service = this.#accessory.getService(Service.AccessoryInformation) ||
      this.#accessory.addService(Service.AccessoryInformation)
    const displayName = sanitizeName(this.#accessory.displayName)
    const nameCharacteristic = service.getCharacteristic(Characteristic.Name)
    const configuredCharacteristic = service.getCharacteristic(Characteristic.ConfiguredName)
    const previousName = nameCharacteristic.value
    const configuredName = configuredCharacteristic.value

    const hardwareRevision = [
      this.#device.generation,
      this.#device.formFactor,
    ].filter(Boolean).join(' ') || 'Unknown'

    const model = this.#device.deviceFamily || this.#device.deviceType || DEFAULT_MODEL

    service
      .setCharacteristic(Characteristic.Name, displayName)
      .setCharacteristic(Characteristic.Manufacturer, DEFAULT_MANUFACTURER)
      .setCharacteristic(Characteristic.Model, model)
      .setCharacteristic(Characteristic.SerialNumber, this.#device.deviceId)
      .setCharacteristic(Characteristic.HardwareRevision, hardwareRevision)

    if (typeof configuredName !== 'string' || configuredName === previousName) {
      service.setCharacteristic(Characteristic.ConfiguredName, displayName)
    }

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
    const serviceName = sanitizeName(this.#accessory.displayName)

    const service = this.#accessory.getService(Service.SmartSpeaker) ||
      this.#accessory.addService(Service.SmartSpeaker, serviceName)

    service.setPrimaryService(true)

    syncServiceNames({ Characteristic, service, name: serviceName })

    service
      .getCharacteristic(Characteristic.CurrentMediaState)
      .onGet(this.getCurrentMediaState.bind(this))

    service
      .getCharacteristic(Characteristic.TargetMediaState)
      .onGet(this.getTargetMediaState.bind(this))
      .onSet(this.setTargetMediaState.bind(this))

    // Keep transport controls enabled in Home by advertising AirPlay support.
    service
      .getCharacteristic(Characteristic.AirPlayEnable)
      .onGet(() => true)
      .updateValue(true)

    service
      .getCharacteristic(Characteristic.Volume)
      .setProps({
        minValue: 0,
        maxValue: 100,
        minStep: 1,
      })
      .onGet(this.getVolume.bind(this))
      .onSet(this.setVolume.bind(this))

    service
      .getCharacteristic(Characteristic.Mute)
      .onGet(this.getMute.bind(this))
      .onSet(this.setMute.bind(this))

    this.speakerService = service
    this.#currentServices.add(service)
  }

  /**
   * Setup event listeners for device model updates
   */
  setupEventListeners () {
    this.#deviceModel.on('statusUpdate', (status, _source, changedFields) => {
      for (const field of changedFields) {
        switch (field) {
          case 'volume':
            this.updateVolumeCharacteristic(status.volume)
            break

          case 'firmwareVersion':
            this.updateFirmwareVersionCharacteristic(status.firmwareVersion)
            break

          // Available but not mapped to SmartSpeaker characteristics
          case 'batteryLevelPercentage':
          case 'isCharging':
          case 'maxVolume':
          case 'temperatureCelsius':
          case 'nightlightMode':
          case 'dayMode':
          case 'cardInsertionState':
          case 'activeCardId':
          case 'powerSource':
          case 'isOnline':
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
            break

          default: {
            /** @type {never} */
            const _exhaustive = field
            this.#log.debug('Unhandled speaker status field:', _exhaustive)
            break
          }
        }
      }
    })

    this.#deviceModel.on('playbackUpdate', (playback, changedFields) => {
      for (const field of changedFields) {
        switch (field) {
          case 'playbackStatus':
            this.updateSmartSpeakerMediaStateCharacteristic(playback.playbackStatus)
            break

          case 'sleepTimerActive':
          case 'position':
          case 'trackLength':
          case 'cardId':
          case 'cardTitle':
          case 'cardSlug':
          case 'cardCoverImageUrl':
          case 'cardAuthor':
          case 'cardReadBy':
          case 'cardDurationSeconds':
          case 'source':
          case 'trackTitle':
          case 'trackKey':
          case 'chapterTitle':
          case 'chapterKey':
          case 'sleepTimerSeconds':
          case 'streaming':
          case 'updatedAt':
            break

          default: {
            /** @type {never} */
            const _exhaustive = field
            this.#log.debug('Unhandled speaker playback field:', _exhaustive)
            break
          }
        }
      }
    })

    this.#deviceModel.on('error', (error) => {
      const details = formatError(error)
      this.#log.error(`[${this.#device.name}] Speaker device error:`, details)
    })
  }

  /**
   * @param { "playing" | "paused" | "stopped" | "loading" | null} playbackStatus
   * @returns {{ current: CharacteristicValue, target: CharacteristicValue }}
   */
  getMediaStateValues (playbackStatus) {
    const { Characteristic } = this.#platform

    if (playbackStatus === 'playing') {
      return {
        current: Characteristic.CurrentMediaState.PLAY,
        target: Characteristic.TargetMediaState.PLAY,
      }
    }

    if (playbackStatus === 'paused') {
      return {
        current: Characteristic.CurrentMediaState.PAUSE,
        target: Characteristic.TargetMediaState.PAUSE,
      }
    }

    if (playbackStatus === 'loading') {
      return {
        current: Characteristic.CurrentMediaState.LOADING,
        target: Characteristic.TargetMediaState.PLAY,
      }
    }

    return {
      current: Characteristic.CurrentMediaState.STOP,
      target: Characteristic.TargetMediaState.STOP,
    }
  }

  /**
   * Get current media state from live playback state
   * @returns {Promise<CharacteristicValue>}
   */
  async getCurrentMediaState () {
    const playbackStatus = this.#deviceModel.playback.playbackStatus ?? null
    const current = this.getMediaStateValues(playbackStatus).current
    this.#log.debug(
      LOG_PREFIX.ACCESSORY,
      `[${this.#device.name}] Get current media state -> ${current} (${playbackStatus ?? 'unknown'})`
    )
    return current
  }

  /**
   * Get target media state (follows current state)
   * @returns {Promise<CharacteristicValue>}
   */
  async getTargetMediaState () {
    const playbackStatus = this.#deviceModel.playback.playbackStatus ?? null
    const target = this.getMediaStateValues(playbackStatus).target
    this.#log.debug(
      LOG_PREFIX.ACCESSORY,
      `[${this.#device.name}] Get target media state -> ${target} (${playbackStatus ?? 'unknown'})`
    )
    return target
  }

  /**
   * Set target media state (play/pause/stop)
   * @param {CharacteristicValue} value - Target state
   * @returns {Promise<void>}
   */
  async setTargetMediaState (value) {
    const { Characteristic } = this.#platform
    const targetValue = typeof value === 'number' ? value : Number(value)
    this.#log.debug(LOG_PREFIX.ACCESSORY, `[${this.#device.name}] Set target media state:`, value)

    try {
      if (targetValue === Characteristic.TargetMediaState.PLAY) {
        await this.#deviceModel.resumeCard()
        return
      }

      if (targetValue === Characteristic.TargetMediaState.PAUSE) {
        await this.#deviceModel.pauseCard()
        return
      }

      if (targetValue === Characteristic.TargetMediaState.STOP) {
        await this.#deviceModel.pauseCard()
      }
    } catch (error) {
      this.#log.error(LOG_PREFIX.ACCESSORY, `[${this.#device.name}] Failed to set media state:`, formatError(error))
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
      `[${this.#device.name}] Get speaker volume -> ${percent} (rawSteps=${volumeSteps})`
    )
    return percent
  }

  /**
   * Set volume level as percentage (mapped to 0-16 steps)
   * @param {CharacteristicValue} value - Volume level percent
   * @returns {Promise<void>}
   */
  async setVolume (value) {
    const deviceModel = this.#deviceModel
    this.#log.debug(LOG_PREFIX.ACCESSORY, `[${this.#device.name}] Set speaker volume:`, value)

    const requestedPercent = typeof value === 'number' ? value : Number(value)
    if (!Number.isFinite(requestedPercent)) {
      throw new this.#platform.api.hap.HapStatusError(
        this.#platform.api.hap.HAPStatus.INVALID_VALUE_IN_REQUEST
      )
    }

    const normalizedPercent = Math.max(0, Math.min(Math.round(requestedPercent), 100))
    const requestedSteps = Math.round((normalizedPercent / 100) * 16)
    const steps = Math.max(0, Math.min(Math.round(requestedSteps), 16))

    if (steps > 0) {
      this.#lastNonZeroVolume = Math.round((steps / 16) * 100)
    }

    try {
      await deviceModel.setVolume(steps)
      this.updateVolumeCharacteristic(steps)
    } catch (error) {
      this.#log.error(LOG_PREFIX.ACCESSORY, `[${this.#device.name}] Failed to set speaker volume:`, formatError(error))
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
    const isMuted = this.#deviceModel.status.volume === 0
    this.#log.debug(LOG_PREFIX.ACCESSORY, `[${this.#device.name}] Get speaker mute -> ${isMuted}`)
    return isMuted
  }

  /**
   * Set mute state
   * @param {CharacteristicValue} value - Mute state
   * @returns {Promise<void>}
   */
  async setMute (value) {
    const isMuted = Boolean(value)
    this.#log.debug(LOG_PREFIX.ACCESSORY, `[${this.#device.name}] Set speaker mute:`, isMuted)

    if (isMuted) {
      await this.setVolume(0)
      return
    }

    await this.setVolume(this.#lastNonZeroVolume)
  }

  /**
   * Update SmartSpeaker media state characteristics
   * @param { "playing" | "paused" | "stopped" | "loading" | null} playbackStatus - Playback status
   */
  updateSmartSpeakerMediaStateCharacteristic (playbackStatus) {
    if (!this.speakerService) return

    const { Characteristic } = this.#platform
    const { current, target } = this.getMediaStateValues(playbackStatus)

    this.speakerService
      .getCharacteristic(Characteristic.CurrentMediaState)
      .updateValue(current)

    this.speakerService
      .getCharacteristic(Characteristic.TargetMediaState)
      .updateValue(target)
  }

  /**
   * Update volume and mute characteristics
   * @param {number} volumeSteps - Volume level (0-16)
   */
  updateVolumeCharacteristic (volumeSteps) {
    if (!this.speakerService) return

    const normalizedVolume = Number.isFinite(volumeSteps) ? volumeSteps : 0
    const clampedVolume = Math.max(0, Math.min(normalizedVolume, 16))
    const percent = Math.round((clampedVolume / 16) * 100)
    const isMuted = clampedVolume === 0

    this.speakerService
      .getCharacteristic(this.#platform.Characteristic.Volume)
      .updateValue(percent)

    this.speakerService
      .getCharacteristic(this.#platform.Characteristic.Mute)
      .updateValue(isMuted)
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
   * Stop accessory - cleanup event listeners
   * @returns {Promise<void>}
   */
  async stop () {
    this.#log.debug(LOG_PREFIX.ACCESSORY, `Stopping speaker for ${this.#device.name}`)

    this.#deviceModel.removeAllListeners('statusUpdate')
    this.#deviceModel.removeAllListeners('playbackUpdate')
    this.#deviceModel.removeAllListeners('error')
  }
}
