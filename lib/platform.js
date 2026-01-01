/**
 * @fileoverview Main platform implementation for Yoto Homebridge plugin
 */

/** @import { API, DynamicPlatformPlugin, Logger, PlatformAccessory, PlatformConfig, Service, Characteristic } from 'homebridge' */
/** @import { YotoDevice } from 'yoto-nodejs-client/lib/api-endpoints/devices.js' */
/** @import { YotoDeviceModel } from 'yoto-nodejs-client' */
/** @import { PlaybackAccessoryConfig } from './service-config.js' */
/** @import { CardControlConfig } from './card-controls.js' */

/**
 * Context stored in PlatformAccessory for Yoto devices
 * @typedef {Object} YotoAccessoryContext
 * @property {YotoDevice} device - Device metadata from Yoto API
 * @property {'device'} [type] - Accessory type marker
 */

/**
 * Context stored in PlatformAccessory for card control accessories
 * @typedef {Object} YotoCardAccessoryContext
 * @property {CardControlConfig} cardControl - Card control configuration
 * @property {'card-control'} type - Accessory type marker
 */

import { readFile, writeFile } from 'node:fs/promises'
import { YotoAccount } from 'yoto-nodejs-client'
import { randomUUID } from 'node:crypto'
import {
  PLATFORM_NAME,
  PLUGIN_NAME,
  DEFAULT_CLIENT_ID,
} from './settings.js'
import { YotoPlayerAccessory } from './accessory.js'
import { YotoSpeakerAccessory } from './speaker-accessory.js'
import { YotoCardControlAccessory } from './card-control-accessory.js'
import { sanitizeName } from './sanitize-name.js'
import { getPlaybackAccessoryConfig } from './service-config.js'
import { getCardControlConfigs } from './card-controls.js'

/**
 * Yoto Platform implementation
 * This class is the main constructor for your plugin, this is where you should
 * parse the user config and discover/register accessories with Homebridge.
 * @implements {DynamicPlatformPlugin}
 */
export class YotoPlatform {
  /** @type {Logger} */ log
  /** @type {PlatformConfig} */ config
  /** @type {API} */ api
  /** @type {typeof Service} */ Service
  /** @type {typeof Characteristic} */ Characteristic
  /** @type {PlaybackAccessoryConfig} */ playbackAccessoryConfig
  /** @type {Map<string, PlatformAccessory<YotoAccessoryContext>>} */ accessories = new Map()
  /** @type {Map<string, PlatformAccessory<YotoAccessoryContext>>} */ speakerAccessories = new Map()
  /** @type {Map<string, PlatformAccessory<YotoCardAccessoryContext>>} */ cardAccessories = new Map()
  /** @type {Map<string, YotoPlayerAccessory>} */ accessoryHandlers = new Map()
  /** @type {Map<string, YotoSpeakerAccessory>} */ speakerAccessoryHandlers = new Map()
  /** @type {Map<string, YotoCardControlAccessory>} */ cardAccessoryHandlers = new Map()
  /** @type {YotoAccount | null} */ yotoAccount = null
  /** @type {string} */ sessionId = randomUUID()

  /**
   * @param {Logger} log - Homebridge logger
   * @param {PlatformConfig} config - Platform configuration
   * @param {API} api - Homebridge API
   */
  constructor (log, config, api) {
    this.log = log
    this.config = config
    this.api = api
    this.Service = api.hap.Service
    this.Characteristic = api.hap.Characteristic
    this.playbackAccessoryConfig = getPlaybackAccessoryConfig(config)

    log.debug('Finished initializing platform:', config.name)

    // Extract auth tokens once
    const clientId = config['clientId'] || DEFAULT_CLIENT_ID
    const refreshToken = config['refreshToken']
    const accessToken = config['accessToken']

    // Debug: Log what we found (redacted)
    log.debug('Config check - Has refreshToken:', !!refreshToken)
    log.debug('Config check - Has accessToken:', !!accessToken)
    log.debug('Config check - ClientId:', clientId ? 'present' : 'missing')

    // Check if we have authentication tokens
    if (!refreshToken || !accessToken) {
      log.warn('No authentication tokens found. Please configure the plugin through the Homebridge UI.')
      return
    }

    log.debug('Authentication tokens found, initializing Yoto account...')

    const { updateHomebridgeConfig, sessionId } = this

    // Initialize YotoAccount with client and device options
    this.yotoAccount = new YotoAccount({
      clientOptions: {
        clientId,
        refreshToken,
        accessToken,
        onTokenRefresh: async ({ updatedAccessToken, updatedRefreshToken, updatedExpiresAt, prevAccessToken, prevRefreshToken }) => {
          log.debug('Access token refreshed, expires at:', new Date(updatedExpiresAt * 1000).toISOString())

          // Update config file with new tokens (similar to homebridge-ring pattern)
          await updateHomebridgeConfig((configContents) => {
            let updatedConfig = configContents

            // Replace old tokens with new tokens
            if (prevAccessToken) {
              updatedConfig = updatedConfig.replace(prevAccessToken, updatedAccessToken)
            }
            if (prevRefreshToken && updatedRefreshToken) {
              updatedConfig = updatedConfig.replace(prevRefreshToken, updatedRefreshToken)
            }

            return updatedConfig
          })
        }
      },
      deviceOptions: {
        httpPollIntervalMs: config['httpPollIntervalMs'] || 60000,
        yotoDeviceMqttOptions: {
          sessionId
        }
      }
    })

    const formatError = (/** @type {unknown} */ error) => (
      error instanceof Error ? (error.stack || error.message) : String(error)
    )

    // Listen to account-level events
    this.yotoAccount.on('error', ({ error, context }) => {
      const details = formatError(error)
      if (context.deviceId) {
        const label = this.formatDeviceLabel(context.deviceId)
        log.error(`Device error [${label} ${context.operation} ${context.source}]:`, details)
        log.debug('Device error context:', context)
      } else {
        log.error('Account error:', details)
        log.debug('Account error context:', context)
      }
    })

    // When this event is fired it means Homebridge has restored all cached accessories from disk.
    // Dynamic Platform plugins should only register new accessories after this event was fired,
    // in order to ensure they weren't added to homebridge already. This event can also be used
    // to start discovery of new accessories.
    api.on('didFinishLaunching', async () => {
      log.debug('Executed didFinishLaunching callback')
      // Start the YotoAccount which will discover and start all devices
      await this.startAccount()
    })

    // When homebridge shuts down, cleanup all handlers and MQTT connections
    api.on('shutdown', () => {
      log.debug('Homebridge shutting down, cleaning up accessories...')
      this.shutdown()
    })
  }

  /**
   * This function is invoked when homebridge restores cached accessories from disk at startup.
   * It should be used to set up event handlers for characteristics and update respective values.
   * In practice, it never is. It simply collects previously created devices into an accessories map
   * that is then used to setup devices after didFinishLaunching fires.
   * @param {PlatformAccessory} accessory - Cached accessory
   */
  configureAccessory (accessory) {
    const { log, accessories, cardAccessories } = this
    log.debug('Loading accessory from cache:', accessory.displayName)

    const context = accessory.context
    const record = context && typeof context === 'object'
      ? /** @type {Record<string, unknown>} */ (context)
      : null
    const accessoryType = record && typeof record['type'] === 'string'
      ? record['type']
      : undefined

    if (accessoryType === 'card-control' || record?.['cardControl']) {
      cardAccessories.set(accessory.UUID, /** @type {PlatformAccessory<YotoCardAccessoryContext>} */ (accessory))
      return
    }

    // Add to our tracking map (cast to our typed version)
    accessories.set(accessory.UUID, /** @type {PlatformAccessory<YotoAccessoryContext>} */ (accessory))
  }

  /**
   * Start YotoAccount - discovers devices and creates device models
   */
  async startAccount () {
    if (!this.yotoAccount) {
      this.log.error('Cannot start account - YotoAccount not initialized')
      return
    }

    try {
      this.log.debug('Starting Yoto account...')

      // Listen for devices being added
      this.yotoAccount.on('deviceAdded', async ({ deviceId }) => {
        const deviceModel = this.yotoAccount?.getDevice(deviceId)
        if (!deviceModel) {
          const label = this.formatDeviceLabel(deviceId)
          this.log.warn(`Device added but no model found for ${label}`)
          return
        }

        const device = deviceModel.device
        this.log.info(`Device discovered: ${device.name} (${deviceId})`)
        await this.registerDevice(device, deviceModel)
      })

      this.yotoAccount.on('deviceRemoved', ({ deviceId }) => {
        const label = this.formatDeviceLabel(deviceId)
        this.log.debug(`Device removed: ${label}`)
        this.removeStaleAccessories()
      })

      this.yotoAccount.on('online', ({ deviceId, metadata }) => {
        const label = this.formatDeviceLabel(deviceId)
        const reason = metadata?.reason ? ` (${metadata.reason})` : ''
        this.log.info(`Device online: ${label}${reason}`)
      })

      this.yotoAccount.on('offline', ({ deviceId, metadata }) => {
        const label = this.formatDeviceLabel(deviceId)
        const reason = metadata?.reason ? ` (${metadata.reason})` : ''
        this.log.info(`Device offline: ${label}${reason}`)
      })

      /**
       * @param {{ status?: Record<string, unknown> } | null | undefined} message
       * @returns {string}
       */
      const formatLegacyStatusFields = (message) => {
        const status = message?.status
        if (!status || typeof status !== 'object') return ''
        const fields = Object.keys(status)
        if (!fields.length) return ''
        const preview = fields.slice(0, 8).join(', ')
        const suffix = fields.length > 8 ? `, +${fields.length - 8} more` : ''
        return ` fields: ${preview}${suffix}`
      }

      this.yotoAccount.on('statusUpdate', ({ deviceId, source, changedFields }) => {
        const label = this.formatDeviceLabel(deviceId)
        const fields = Array.from(changedFields).join(', ')
        this.log.debug(`Status update [${label} ${source}]: ${fields}`)
      })

      this.yotoAccount.on('configUpdate', ({ deviceId, changedFields }) => {
        const label = this.formatDeviceLabel(deviceId)
        const fields = Array.from(changedFields).join(', ')
        this.log.debug(`Config update [${label}]: ${fields}`)
      })

      this.yotoAccount.on('playbackUpdate', ({ deviceId, changedFields }) => {
        const label = this.formatDeviceLabel(deviceId)
        const fields = Array.from(changedFields).join(', ')
        this.log.debug(`Playback update [${label}]: ${fields}`)
      })

      this.yotoAccount.on('mqttConnect', ({ deviceId }) => {
        const label = this.formatDeviceLabel(deviceId)
        this.log.debug(`MQTT connected: ${label}`)
      })

      this.yotoAccount.on('mqttDisconnect', ({ deviceId, metadata }) => {
        const label = this.formatDeviceLabel(deviceId)
        const reasonCode = metadata?.packet?.reasonCode
        const reason = typeof reasonCode === 'number' ? ` (code ${reasonCode})` : ''
        this.log.warn(`MQTT disconnected: ${label}${reason}`)
      })

      this.yotoAccount.on('mqttClose', ({ deviceId, metadata }) => {
        const label = this.formatDeviceLabel(deviceId)
        const reason = metadata?.reason ? ` (${metadata.reason})` : ''
        this.log.debug(`MQTT closed: ${label}${reason}`)
      })

      this.yotoAccount.on('mqttReconnect', ({ deviceId }) => {
        const label = this.formatDeviceLabel(deviceId)
        this.log.debug(`MQTT reconnecting: ${label}`)
      })

      this.yotoAccount.on('mqttOffline', ({ deviceId }) => {
        const label = this.formatDeviceLabel(deviceId)
        this.log.debug(`MQTT offline: ${label}`)
      })

      this.yotoAccount.on('mqttEnd', ({ deviceId }) => {
        const label = this.formatDeviceLabel(deviceId)
        this.log.debug(`MQTT ended: ${label}`)
      })

      this.yotoAccount.on('mqttStatus', ({ deviceId, topic }) => {
        const label = this.formatDeviceLabel(deviceId)
        this.log.debug(`MQTT status [${label}]: ${topic}`)
      })

      this.yotoAccount.on('mqttEvents', ({ deviceId, topic }) => {
        const label = this.formatDeviceLabel(deviceId)
        this.log.debug(`MQTT events [${label}]: ${topic}`)
      })

      this.yotoAccount.on('mqttStatusLegacy', ({ deviceId, topic, message }) => {
        const label = this.formatDeviceLabel(deviceId)
        const fields = formatLegacyStatusFields(message)
        this.log.debug(`MQTT legacy status [${label}]: ${topic}${fields}`)
      })

      this.yotoAccount.on('mqttResponse', ({ deviceId, topic, message }) => {
        const label = this.formatDeviceLabel(deviceId)
        let payload = ''
        try {
          payload = message ? ` ${JSON.stringify(message)}` : ''
        } catch {
          payload = ' [unserializable message]'
        }
        this.log.debug(`MQTT response [${label}]: ${topic}${payload}`)
      })

      this.yotoAccount.on('mqttUnknown', ({ deviceId, topic }) => {
        const label = this.formatDeviceLabel(deviceId)
        this.log.debug(`MQTT unknown [${label}]: ${topic}`)
      })

      // Start the account (discovers devices, creates device models, starts MQTT)
      await this.yotoAccount.start()

      this.log.info(`✓ Yoto account started with ${this.yotoAccount.devices.size} device(s)`)

      // Remove stale accessories after all devices are registered
      this.removeStaleAccessories()

      await this.registerCardControlAccessories()
    } catch (error) {
      this.log.error('Failed to start account:', error instanceof Error ? error.message : String(error))
    }
  }

  /**
   * @param {string} deviceId
   * @returns {string}
   */
  formatDeviceLabel (deviceId) {
    const deviceName = this.yotoAccount?.getDevice(deviceId)?.device?.name
    if (deviceName && deviceName !== deviceId) {
      return `${deviceName} (${deviceId})`
    }
    return deviceId
  }

  /**
   * @param {string} deviceId
   * @returns {string}
   */
  getSpeakerAccessoryUuid (deviceId) {
    return this.api.hap.uuid.generate(`${deviceId}:speaker`)
  }

  /**
   * @param {YotoDevice} device
   * @returns {string}
   */
  getSpeakerAccessoryName (device) {
    const rawName = `${device.name} Speaker`
    return sanitizeName(rawName) || `${device.deviceId} Speaker`
  }

  /**
   * @param {CardControlConfig} control
   * @returns {string}
   */
  getCardControlAccessoryUuid (control) {
    return this.api.hap.uuid.generate(`card-control:${control.id}`)
  }

  /**
   * @param {CardControlConfig} control
   * @returns {string}
   */
  getCardControlAccessoryName (control) {
    const rawName = `${control.label} (All Yotos)`
    return sanitizeName(rawName) || `${control.cardId} (All Yotos)`
  }

  /**
   * Register a device as a platform accessory
   * @param {YotoDevice} device - Device to register
   * @param {YotoDeviceModel} deviceModel - Device model instance
   * @returns {Promise<{ success: boolean }>} Object indicating if registration succeeded
   */
  async registerDevice (device, deviceModel) {
    // Generate UUID for this device
    const uuid = this.api.hap.uuid.generate(device.deviceId)
    const sanitizedDeviceName = sanitizeName(device.name)
    const accessoryCategory = this.api.hap.Categories.SPEAKER

    // Check if accessory already exists
    const existingAccessory = this.accessories.get(uuid)

    if (existingAccessory) {
      // Accessory exists - update it
      this.log.debug('Restoring existing accessory from cache:', device.name)

      // Update display name if it has changed
      if (existingAccessory.displayName !== sanitizedDeviceName) {
        existingAccessory.updateDisplayName(sanitizedDeviceName)
      }

      // Update context with fresh device data
      existingAccessory.context = {
        ...existingAccessory.context,
        type: 'device',
        device,
      }

      // Ensure category matches our current service model
      if (existingAccessory.category !== accessoryCategory) {
        existingAccessory.category = accessoryCategory
      }

      // Update accessory information
      this.api.updatePlatformAccessories([existingAccessory])

      // Create handler for this accessory with device model
      const handler = new YotoPlayerAccessory({
        platform: this,
        accessory: existingAccessory,
        deviceModel,
      })

      // Track handler
      this.accessoryHandlers.set(uuid, handler)

      // Initialize accessory (setup services and event listeners)
      await handler.setup()

      if (this.playbackAccessoryConfig.mode === 'external') {
        await this.registerSpeakerAccessory(device, deviceModel)
      }

      return { success: true }
    } else {
      // Create new accessory
      this.log.debug('Adding new accessory:', device.name)

      // Create platform accessory
      /** @type {PlatformAccessory<YotoAccessoryContext>} */
      // eslint-disable-next-line new-cap
      const accessory = new this.api.platformAccessory(sanitizedDeviceName, uuid, accessoryCategory)

      // Set accessory context
      accessory.context = {
        type: 'device',
        device,
      }

      // Create handler for this accessory with device model
      const handler = new YotoPlayerAccessory({
        platform: this,
        accessory,
        deviceModel,
      })

      // Track handler
      this.accessoryHandlers.set(uuid, handler)

      // Initialize accessory (setup services and event listeners)
      await handler.setup()

      // Register as a platform accessory (bridged).
      this.log.debug(`Registering new accessory: ${device.name}`)
      this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory])

      if (this.playbackAccessoryConfig.mode === 'external') {
        await this.registerSpeakerAccessory(device, deviceModel)
      }

      // Add to our tracking map (cast to typed version)
      this.accessories.set(uuid, accessory)

      return { success: true }
    }
  }

  /**
   * Register a device as an external SmartSpeaker accessory
   * @param {YotoDevice} device - Device to register
   * @param {YotoDeviceModel} deviceModel - Device model instance
   * @returns {Promise<{ success: boolean }>} Object indicating if registration succeeded
   */
  async registerSpeakerAccessory (device, deviceModel) {
    const uuid = this.getSpeakerAccessoryUuid(device.deviceId)
    const speakerName = this.getSpeakerAccessoryName(device)
    if (this.speakerAccessories.has(uuid)) {
      this.log.debug('SmartSpeaker accessory already published:', speakerName)
      return { success: true }
    }

    this.log.info('Adding new SmartSpeaker accessory:', speakerName)

    /** @type {PlatformAccessory<YotoAccessoryContext>} */
    // eslint-disable-next-line new-cap
    const accessory = new this.api.platformAccessory(
      speakerName,
      uuid,
      this.api.hap.Categories.SPEAKER
    )

    accessory.context = {
      device,
    }

    const handler = new YotoSpeakerAccessory({
      platform: this,
      accessory,
      deviceModel,
    })

    this.speakerAccessoryHandlers.set(uuid, handler)

    await handler.setup()

    this.log.info(`Publishing external SmartSpeaker accessory: ${speakerName}`)
    this.api.publishExternalAccessories(PLUGIN_NAME, [accessory])

    this.speakerAccessories.set(uuid, accessory)

    return { success: true }
  }

  /**
   * Register or update card control accessories that target all devices.
   * @returns {Promise<void>}
   */
  async registerCardControlAccessories () {
    const cardControls = getCardControlConfigs(this.config).filter(control => control.playOnAll)
    const desiredUuids = new Set()

    for (const control of cardControls) {
      const uuid = this.getCardControlAccessoryUuid(control)
      const accessoryName = this.getCardControlAccessoryName(control)
      desiredUuids.add(uuid)

      const existingAccessory = this.cardAccessories.get(uuid)
      if (existingAccessory) {
        this.log.debug('Restoring existing card control accessory from cache:', accessoryName)

        if (existingAccessory.displayName !== accessoryName) {
          existingAccessory.updateDisplayName(accessoryName)
        }

        existingAccessory.context = {
          type: 'card-control',
          cardControl: control,
        }

        this.api.updatePlatformAccessories([existingAccessory])

        const existingHandler = this.cardAccessoryHandlers.get(uuid)
        if (existingHandler) {
          await existingHandler.stop().catch(error => {
            this.log.error(`Failed to stop card control handler for ${existingAccessory.displayName}:`, error)
          })
          this.cardAccessoryHandlers.delete(uuid)
        }

        const handler = new YotoCardControlAccessory({
          platform: this,
          accessory: existingAccessory,
          cardControl: control,
        })

        this.cardAccessoryHandlers.set(uuid, handler)
        await handler.setup()
        continue
      }

      this.log.debug('Adding new card control accessory:', accessoryName)

      /** @type {PlatformAccessory<YotoCardAccessoryContext>} */
      // eslint-disable-next-line new-cap
      const accessory = new this.api.platformAccessory(
        accessoryName,
        uuid,
        this.api.hap.Categories.SWITCH
      )

      accessory.context = {
        type: 'card-control',
        cardControl: control,
      }

      const handler = new YotoCardControlAccessory({
        platform: this,
        accessory,
        cardControl: control,
      })

      this.cardAccessoryHandlers.set(uuid, handler)
      await handler.setup()

      this.log.debug(`Registering card control accessory: ${accessoryName}`)
      this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory])

      this.cardAccessories.set(uuid, accessory)
    }

    for (const [uuid, accessory] of this.cardAccessories) {
      if (desiredUuids.has(uuid)) {
        continue
      }

      this.log.debug('Removing card control accessory from cache:', accessory.displayName)

      const handler = this.cardAccessoryHandlers.get(uuid)
      if (handler) {
        await handler.stop().catch(error => {
          this.log.error(`Failed to stop card control handler for ${accessory.displayName}:`, error)
        })
        this.cardAccessoryHandlers.delete(uuid)
      }

      this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory])
      this.cardAccessories.delete(uuid)
    }
  }

  /**
   * Remove accessories that are no longer present in the account
   */
  removeStaleAccessories () {
    if (!this.yotoAccount) {
      return
    }

    // Get current device IDs from account
    const currentDeviceIds = this.yotoAccount.getDeviceIds()
    const currentUUIDs = currentDeviceIds.map(id => this.api.hap.uuid.generate(id))

    for (const [uuid, accessory] of this.accessories) {
      if (!currentUUIDs.includes(uuid)) {
        this.log.debug('Removing existing accessory from cache:', accessory.displayName)

        // Stop handler if it exists
        const handler = this.accessoryHandlers.get(uuid)
        if (handler) {
          handler.stop().catch(error => {
            this.log.error(`Failed to stop handler for ${accessory.displayName}:`, error)
          })
          this.accessoryHandlers.delete(uuid)
        }

        // Unregister from Homebridge
        this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory])

        // Remove from our tracking map
        this.accessories.delete(uuid)
      }
    }

    for (const [uuid, accessory] of this.speakerAccessories) {
      const deviceId = accessory.context.device?.deviceId
      if (!deviceId || !currentDeviceIds.includes(deviceId)) {
        this.log.debug('Removing external SmartSpeaker accessory from runtime:', accessory.displayName)

        const handler = this.speakerAccessoryHandlers.get(uuid)
        if (handler) {
          handler.stop().catch(error => {
            this.log.error(`Failed to stop SmartSpeaker handler for ${accessory.displayName}:`, error)
          })
          this.speakerAccessoryHandlers.delete(uuid)
        }

        this.speakerAccessories.delete(uuid)
      }
    }
  }

  /**
   * Shutdown platform - cleanup all handlers and stop account
   */
  async shutdown () {
    this.log.debug('Shutting down Yoto platform...')

    // Stop all accessory handlers
    const stopPromises = []
    for (const [uuid, handler] of this.accessoryHandlers) {
      stopPromises.push(
        handler.stop().catch(error => {
          this.log.error(`Failed to stop handler for ${uuid}:`, error)
        })
      )
    }
    for (const [uuid, handler] of this.speakerAccessoryHandlers) {
      stopPromises.push(
        handler.stop().catch(error => {
          this.log.error(`Failed to stop SmartSpeaker handler for ${uuid}:`, error)
        })
      )
    }
    for (const [uuid, handler] of this.cardAccessoryHandlers) {
      stopPromises.push(
        handler.stop().catch(error => {
          this.log.error(`Failed to stop card control handler for ${uuid}:`, error)
        })
      )
    }

    // Wait for all handlers to cleanup
    await Promise.all(stopPromises)
    this.accessoryHandlers.clear()
    this.speakerAccessoryHandlers.clear()
    this.cardAccessoryHandlers.clear()
    this.speakerAccessories.clear()
    this.cardAccessories.clear()

    // Stop the YotoAccount (disconnects all device models and MQTT)
    if (this.yotoAccount) {
      await this.yotoAccount.stop()
      this.yotoAccount = null
    }

    this.log.debug('✓ Yoto platform shutdown complete')
  }

  /**
   * Update Homebridge config.json file
   * @param {(configContents: string) => string} updateFn - Function to update config contents
   */
  async updateHomebridgeConfig (updateFn) {
    const configPath = this.api.user.configPath()

    try {
      const configContents = await readFile(configPath, 'utf8')
      const updatedContents = updateFn(configContents)
      await writeFile(configPath, updatedContents, 'utf8')
      this.log.debug('Updated config.json with new tokens')
    } catch (error) {
      this.log.error('Failed to update config.json:', error)
    }
  }
}
