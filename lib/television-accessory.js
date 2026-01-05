/**
 * @fileoverview Yoto TV playback accessory implementation for external accessories.
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
} from './settings.js'
import { sanitizeName } from './utils/sanitize-name.js'
import { syncServiceNames } from './sync-service-names.js'
import { formatError } from './utils/error-format.js'
import { getTrimmedString } from './utils/get-trimmed-string.js'
import {
  clampPercent,
  clampSteps,
  percentToSteps,
  stepsFromVolumeValue,
  stepsToPercent,
} from './utils/volume.js'

/**
 * Yoto Television Playback Accessory Handler (external)
 * Manages Television, InputSource, and TelevisionSpeaker services for a single Yoto player.
 */
export class YotoTelevisionAccessory {
  /** @type {YotoPlatform} */ #platform
  /** @type {PlatformAccessory<YotoAccessoryContext>} */ #accessory
  /** @type {YotoDeviceModel} */ #deviceModel
  /** @type {Logger} */ #log
  /** @type {YotoDevice} */ #device
  /** @type {Service | undefined} */ televisionService
  /** @type {Service | undefined} */ inputSourceService
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
    this.#log.debug(LOG_PREFIX.ACCESSORY, `Setting up TV playback for ${this.#device.name}`)

    this.#currentServices.clear()

    this.setupAccessoryInformation()
    this.setupTelevisionService()
    this.setupInputSourceService()
    this.setupTelevisionSpeakerService()

    for (const service of this.#accessory.services) {
      if (service.UUID !== this.#platform.Service.AccessoryInformation.UUID &&
          !this.#currentServices.has(service)) {
        this.#log.debug(LOG_PREFIX.ACCESSORY, `Removing stale TV service: ${service.displayName || service.UUID}`)
        this.#accessory.removeService(service)
      }
    }

    this.setupEventListeners()

    this.#log.debug(LOG_PREFIX.ACCESSORY, `✓ ${this.#device.name} playback ready`)
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
   * Setup Television service (PRIMARY)
   */
  setupTelevisionService () {
    const { Service, Characteristic } = this.#platform
    const serviceName = sanitizeName(this.#accessory.displayName)

    const service = this.#accessory.getService(Service.Television) ||
      this.#accessory.addService(Service.Television, serviceName)

    service.setPrimaryService(true)
    service.displayName = serviceName
    // Set both display and configured names explicitly for the TV service and keep them in sync.
    service
      .setCharacteristic(Characteristic.Name, serviceName)
      .setCharacteristic(Characteristic.ConfiguredName, serviceName)

    service
      .getCharacteristic(Characteristic.ConfiguredName)
      .onSet((value) => {
        const incomingName = getTrimmedString(value)
        const configuredName = sanitizeName(incomingName) || serviceName
        if (service.displayName !== configuredName) {
          service.displayName = configuredName
        }
        service.updateCharacteristic(Characteristic.Name, configuredName)
        if (configuredName !== incomingName) {
          service.updateCharacteristic(Characteristic.ConfiguredName, configuredName)
        }
      })

    service
      .getCharacteristic(Characteristic.Active)
      .onGet(this.getActive.bind(this))
      .onSet(this.setActive.bind(this))

    service
      .getCharacteristic(Characteristic.ActiveIdentifier)
      .onGet(this.getActiveIdentifier.bind(this))
      .onSet(this.setActiveIdentifier.bind(this))

    service
      .getCharacteristic(Characteristic.RemoteKey)
      .onSet(this.setRemoteKey.bind(this))

    service.setCharacteristic(
      Characteristic.SleepDiscoveryMode,
      Characteristic.SleepDiscoveryMode.ALWAYS_DISCOVERABLE
    )

    service.addOptionalCharacteristic(Characteristic.CurrentMediaState)
    service.addOptionalCharacteristic(Characteristic.TargetMediaState)

    service
      .getCharacteristic(Characteristic.CurrentMediaState)
      .onGet(this.getCurrentMediaState.bind(this))

    service
      .getCharacteristic(Characteristic.TargetMediaState)
      .onGet(this.getTargetMediaState.bind(this))
      .onSet(this.setTargetMediaState.bind(this))

    service.setCharacteristic(Characteristic.ActiveIdentifier, 1)

    this.televisionService = service
    this.#currentServices.add(service)
  }

  /**
   * Setup InputSource service
   */
  setupInputSourceService () {
    const { Service, Characteristic } = this.#platform
    const inputName = sanitizeName(`${this.#device.name} Library`)

    const service = this.#accessory.getServiceById(Service.InputSource, 'PlaybackInput') ||
      this.#accessory.addService(Service.InputSource, inputName, 'PlaybackInput')

    service
      .setCharacteristic(Characteristic.Identifier, 1)
      .setCharacteristic(Characteristic.ConfiguredName, inputName)
      .setCharacteristic(Characteristic.InputDeviceType, Characteristic.InputDeviceType.AUDIO_SYSTEM)
      .setCharacteristic(Characteristic.InputSourceType, Characteristic.InputSourceType.OTHER)
      .setCharacteristic(Characteristic.IsConfigured, Characteristic.IsConfigured.CONFIGURED)
      .setCharacteristic(Characteristic.Name, inputName)
      .setCharacteristic(Characteristic.CurrentVisibilityState, Characteristic.CurrentVisibilityState.SHOWN)
      .setCharacteristic(Characteristic.TargetVisibilityState, Characteristic.TargetVisibilityState.SHOWN)

    service
      .getCharacteristic(Characteristic.TargetVisibilityState)
      .onSet((value) => {
        const target = typeof value === 'number' ? value : Number(value)
        const current = target === Characteristic.TargetVisibilityState.SHOWN
          ? Characteristic.CurrentVisibilityState.SHOWN
          : Characteristic.CurrentVisibilityState.HIDDEN
        service.updateCharacteristic(Characteristic.CurrentVisibilityState, current)
      })

    if (this.televisionService) {
      this.televisionService.addLinkedService(service)
    }

    this.inputSourceService = service
    this.#currentServices.add(service)
  }

  /**
   * Setup TelevisionSpeaker service
   */
  setupTelevisionSpeakerService () {
    const { Service, Characteristic } = this.#platform
    const serviceName = sanitizeName(`${this.#accessory.displayName} Audio`)

    const service = this.#accessory.getService(Service.TelevisionSpeaker) ||
      this.#accessory.addService(Service.TelevisionSpeaker, serviceName)

    syncServiceNames({ Characteristic, service, name: serviceName })

    service.addOptionalCharacteristic(Characteristic.Active)
    service.addOptionalCharacteristic(Characteristic.Volume)
    service.addOptionalCharacteristic(Characteristic.VolumeControlType)
    service.addOptionalCharacteristic(Characteristic.VolumeSelector)

    service
      .getCharacteristic(Characteristic.Mute)
      .onGet(this.getMute.bind(this))
      .onSet(this.setMute.bind(this))

    service
      .getCharacteristic(Characteristic.Active)
      .onGet(this.getSpeakerActive.bind(this))

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
      .getCharacteristic(Characteristic.VolumeControlType)
      .updateValue(Characteristic.VolumeControlType.ABSOLUTE)

    service
      .getCharacteristic(Characteristic.VolumeSelector)
      .onSet(this.setVolumeSelector.bind(this))

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
            this.updateSpeakerVolumeCharacteristics(status.volume)
            break

          case 'isOnline':
            this.updateTelevisionPlaybackCharacteristics(this.#deviceModel.playback.playbackStatus ?? null)
            this.updateSpeakerActiveCharacteristic(this.#deviceModel.playback.playbackStatus ?? null)
            break

          case 'firmwareVersion':
            this.updateFirmwareVersionCharacteristic(status.firmwareVersion)
            break

          // Available but not mapped to Television characteristics
          case 'batteryLevelPercentage':
          case 'isCharging':
          case 'maxVolume':
          case 'temperatureCelsius':
          case 'nightlightMode':
          case 'dayMode':
          case 'cardInsertionState':
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
            break

          default: {
            /** @type {never} */
            const _exhaustive = field
            this.#log.debug('Unhandled TV status field:', _exhaustive)
            break
          }
        }
      }
    })

    this.#deviceModel.on('playbackUpdate', (playback, changedFields) => {
      for (const field of changedFields) {
        switch (field) {
          case 'playbackStatus':
            this.updateTelevisionPlaybackCharacteristics(playback.playbackStatus)
            this.updateSpeakerActiveCharacteristic(playback.playbackStatus)
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
            this.#log.debug('Unhandled TV playback field:', _exhaustive)
            break
          }
        }
      }
    })

    this.#deviceModel.on('online', ({ reason: _reason }) => {
      this.updateTelevisionPlaybackCharacteristics(this.#deviceModel.playback.playbackStatus ?? null)
      this.updateSpeakerActiveCharacteristic(this.#deviceModel.playback.playbackStatus ?? null)
    })

    this.#deviceModel.on('offline', ({ reason: _reason }) => {
      this.updateTelevisionPlaybackCharacteristics(this.#deviceModel.playback.playbackStatus ?? null)
      this.updateSpeakerActiveCharacteristic(this.#deviceModel.playback.playbackStatus ?? null)
    })

    this.#deviceModel.on('error', (error) => {
      const details = formatError(error)
      this.#log.error(`[${this.#device.name}] TV device error:`, details)
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
   * @param { "playing" | "paused" | "stopped" | "loading" | null} _playbackStatus
   * @param {boolean} isOnline
   * @returns {CharacteristicValue}
   */
  getActiveValue (_playbackStatus, isOnline) {
    const { Characteristic } = this.#platform
    if (!isOnline) {
      return Characteristic.Active.INACTIVE
    }

    return Characteristic.Active.ACTIVE
  }

  /**
   * Get Active state from live playback status
   * @returns {Promise<CharacteristicValue>}
   */
  async getActive () {
    const playbackStatus = this.#deviceModel.playback.playbackStatus ?? null
    const isOnline = this.#deviceModel.status.isOnline
    const active = this.getActiveValue(playbackStatus, isOnline)
    this.#log.debug(
      LOG_PREFIX.ACCESSORY,
      `[${this.#device.name}] Get TV active -> ${active} (${playbackStatus ?? 'unknown'})`
    )
    return active
  }

  /**
   * Set Active state (play/pause)
   * @param {CharacteristicValue} value
   * @returns {Promise<void>}
   */
  async setActive (value) {
    const { Characteristic } = this.#platform
    const targetValue = typeof value === 'number' ? value : Number(value)
    this.#log.debug(LOG_PREFIX.ACCESSORY, `[${this.#device.name}] Set TV active:`, value)

    try {
      if (targetValue === Characteristic.Active.ACTIVE) {
        await this.#deviceModel.resumeCard()
        return
      }

      if (targetValue === Characteristic.Active.INACTIVE) {
        await this.#deviceModel.pauseCard()
      }
    } catch (error) {
      this.#log.error(LOG_PREFIX.ACCESSORY, `[${this.#device.name}] Failed to set TV active:`, formatError(error))
      throw new this.#platform.api.hap.HapStatusError(
        this.#platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE
      )
    }
  }

  /**
   * Get Active Identifier (single input)
   * @returns {Promise<CharacteristicValue>}
   */
  async getActiveIdentifier () {
    this.#log.debug(LOG_PREFIX.ACCESSORY, `[${this.#device.name}] Get TV active identifier -> 1`)
    return 1
  }

  /**
   * Set Active Identifier (single input)
   * @param {CharacteristicValue} value
   * @returns {Promise<void>}
   */
  async setActiveIdentifier (value) {
    const identifier = typeof value === 'number' ? value : Number(value)
    this.#log.debug(LOG_PREFIX.ACCESSORY, `[${this.#device.name}] Set TV active identifier:`, identifier)

    if (identifier !== 1 && this.televisionService) {
      this.televisionService
        .getCharacteristic(this.#platform.Characteristic.ActiveIdentifier)
        .updateValue(1)
    }
  }

  /**
   * Handle remote key input
   * @param {CharacteristicValue} value
   * @returns {Promise<void>}
   */
  async setRemoteKey (value) {
    const { Characteristic } = this.#platform
    const keyValue = typeof value === 'number' ? value : Number(value)
    this.#log.debug(LOG_PREFIX.ACCESSORY, `[${this.#device.name}] Remote key:`, keyValue)

    try {
      switch (keyValue) {
        case Characteristic.RemoteKey.PLAY_PAUSE: {
          const status = this.#deviceModel.playback.playbackStatus
          if (status === 'playing') {
            await this.#deviceModel.pauseCard()
          } else {
            await this.#deviceModel.resumeCard()
          }
          break
        }
        default:
          this.#log.debug(LOG_PREFIX.ACCESSORY, `[${this.#device.name}] Unhandled remote key:`, keyValue)
          break
      }
    } catch (error) {
      this.#log.error(LOG_PREFIX.ACCESSORY, `[${this.#device.name}] Failed to handle remote key:`, formatError(error))
      throw new this.#platform.api.hap.HapStatusError(
        this.#platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE
      )
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
      `[${this.#device.name}] Get TV current media state -> ${current} (${playbackStatus ?? 'unknown'})`
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
      `[${this.#device.name}] Get TV target media state -> ${target} (${playbackStatus ?? 'unknown'})`
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
    this.#log.debug(LOG_PREFIX.ACCESSORY, `[${this.#device.name}] Set TV target media state:`, value)

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
        await this.#deviceModel.stopCard()
      }
    } catch (error) {
      this.#log.error(LOG_PREFIX.ACCESSORY, `[${this.#device.name}] Failed to set TV media state:`, formatError(error))
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
    const percent = stepsToPercent(volumeSteps)
    this.#log.debug(
      LOG_PREFIX.ACCESSORY,
      `[${this.#device.name}] Get TV volume -> ${percent} (rawSteps=${volumeSteps})`
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
    this.#log.debug(LOG_PREFIX.ACCESSORY, `[${this.#device.name}] Set TV volume:`, value)

    const requestedPercent = typeof value === 'number' ? value : Number(value)
    if (!Number.isFinite(requestedPercent)) {
      throw new this.#platform.api.hap.HapStatusError(
        this.#platform.api.hap.HAPStatus.INVALID_VALUE_IN_REQUEST
      )
    }

    const normalizedPercent = clampPercent(requestedPercent)
    const requestedSteps = percentToSteps(normalizedPercent)
    const steps = clampSteps(requestedSteps)

    if (steps > 0) {
      this.#lastNonZeroVolume = stepsToPercent(steps)
    }

    try {
      await deviceModel.setVolume(steps)
      this.updateSpeakerVolumeCharacteristics(steps)
    } catch (error) {
      this.#log.error(LOG_PREFIX.ACCESSORY, `[${this.#device.name}] Failed to set TV volume:`, formatError(error))
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
    this.#log.debug(LOG_PREFIX.ACCESSORY, `[${this.#device.name}] Get TV mute -> ${isMuted}`)
    return isMuted
  }

  /**
   * Set mute state
   * @param {CharacteristicValue} value - Mute state
   * @returns {Promise<void>}
   */
  async setMute (value) {
    const isMuted = Boolean(value)
    this.#log.debug(LOG_PREFIX.ACCESSORY, `[${this.#device.name}] Set TV mute:`, isMuted)

    if (isMuted) {
      await this.setVolume(0)
      return
    }

    await this.setVolume(this.#lastNonZeroVolume)
  }

  /**
   * Get speaker active state (mirrors playback)
   * @returns {Promise<CharacteristicValue>}
   */
  async getSpeakerActive () {
    const playbackStatus = this.#deviceModel.playback.playbackStatus ?? null
    const isOnline = this.#deviceModel.status.isOnline
    const active = this.getActiveValue(playbackStatus, isOnline)
    this.#log.debug(LOG_PREFIX.ACCESSORY, `[${this.#device.name}] Get TV speaker active -> ${active}`)
    return active
  }

  /**
   * Handle volume selector (increment/decrement)
   * @param {CharacteristicValue} value
   * @returns {Promise<void>}
   */
  async setVolumeSelector (value) {
    const { Characteristic } = this.#platform
    const selector = typeof value === 'number' ? value : Number(value)
    const currentSteps = stepsFromVolumeValue(this.#deviceModel.status.volume)
    const delta = selector === Characteristic.VolumeSelector.INCREMENT ? 1 : -1
    const nextSteps = clampSteps(currentSteps + delta)
    this.#log.debug(
      LOG_PREFIX.ACCESSORY,
      `[${this.#device.name}] Set TV volume selector:`,
      selector,
      `-> ${nextSteps}`
    )

    try {
      await this.#deviceModel.setVolume(nextSteps)
      this.updateSpeakerVolumeCharacteristics(nextSteps)
    } catch (error) {
      this.#log.error(LOG_PREFIX.ACCESSORY, `[${this.#device.name}] Failed to set TV volume selector:`, formatError(error))
      throw new this.#platform.api.hap.HapStatusError(
        this.#platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE
      )
    }
  }

  /**
   * Update Television Active and media state characteristics
   * @param { "playing" | "paused" | "stopped" | "loading" | null} playbackStatus
   */
  updateTelevisionPlaybackCharacteristics (playbackStatus) {
    if (!this.televisionService) return

    const { Characteristic } = this.#platform
    const isOnline = this.#deviceModel.status.isOnline
    const active = this.getActiveValue(playbackStatus, isOnline)
    const { current, target } = this.getMediaStateValues(playbackStatus)

    this.televisionService
      .getCharacteristic(Characteristic.Active)
      .updateValue(active)

    this.televisionService
      .getCharacteristic(Characteristic.ActiveIdentifier)
      .updateValue(1)

    this.televisionService
      .getCharacteristic(Characteristic.CurrentMediaState)
      .updateValue(current)

    this.televisionService
      .getCharacteristic(Characteristic.TargetMediaState)
      .updateValue(target)
  }

  /**
   * Update TV speaker volume + mute characteristics
   * @param {number} volumeSteps - Volume level (0-16)
   */
  updateSpeakerVolumeCharacteristics (volumeSteps) {
    if (!this.speakerService) return

    const percent = stepsToPercent(volumeSteps)
    const isMuted = clampSteps(volumeSteps) === 0

    this.speakerService
      .getCharacteristic(this.#platform.Characteristic.Volume)
      .updateValue(percent)

    this.speakerService
      .getCharacteristic(this.#platform.Characteristic.Mute)
      .updateValue(isMuted)
  }

  /**
   * Update TV speaker active characteristic
   * @param { "playing" | "paused" | "stopped" | "loading" | null} playbackStatus
   */
  updateSpeakerActiveCharacteristic (playbackStatus) {
    if (!this.speakerService) return

    const { Characteristic } = this.#platform
    const isOnline = this.#deviceModel.status.isOnline
    const active = this.getActiveValue(playbackStatus, isOnline)

    this.speakerService
      .getCharacteristic(Characteristic.Active)
      .updateValue(active)
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
    this.#log.debug(LOG_PREFIX.ACCESSORY, `Stopping TV playback for ${this.#device.name}`)

    this.#deviceModel.removeAllListeners('statusUpdate')
    this.#deviceModel.removeAllListeners('playbackUpdate')
    this.#deviceModel.removeAllListeners('online')
    this.#deviceModel.removeAllListeners('offline')
    this.#deviceModel.removeAllListeners('error')
  }
}
