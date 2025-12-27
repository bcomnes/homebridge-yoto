/**
 * @fileoverview Main platform implementation for Yoto Homebridge plugin
 */

/** @import { API, DynamicPlatformPlugin, Logger, PlatformAccessory, PlatformConfig, Service, Characteristic } from 'homebridge' */
/** @import { YotoDevice } from 'yoto-nodejs-client/lib/api-endpoints/devices.js' */
/** @import { YotoDeviceModel } from 'yoto-nodejs-client' */

/**
 * Context stored in PlatformAccessory for Yoto devices
 * @typedef {Object} YotoAccessoryContext
 * @property {YotoDevice} device - Device metadata from Yoto API
 */

import { readFile, writeFile } from 'fs/promises'
import { YotoAccount } from 'yoto-nodejs-client'
import {
  PLATFORM_NAME,
  PLUGIN_NAME,
  DEFAULT_CLIENT_ID,
} from './settings.js'
import { YotoPlayerAccessory } from './accessory.js'
import { sanitizeName } from './sanitize-name.js'

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
  /** @type {Map<string, PlatformAccessory<YotoAccessoryContext>>} */ accessories = new Map()
  /** @type {Map<string, YotoPlayerAccessory>} */ accessoryHandlers = new Map()
  /** @type {YotoAccount | null} */ yotoAccount = null

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

    log.info('Authentication tokens found, initializing Yoto account...')

    const { updateHomebridgeConfig } = this

    // Initialize YotoAccount with client and device options
    this.yotoAccount = new YotoAccount({
      clientOptions: {
        clientId,
        refreshToken,
        accessToken,
        onTokenRefresh: async ({ updatedAccessToken, updatedRefreshToken, updatedExpiresAt, prevAccessToken, prevRefreshToken }) => {
          log.info('Access token refreshed, expires at:', new Date(updatedExpiresAt * 1000).toISOString())

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
        httpPollIntervalMs: config['httpPollIntervalMs'] || 60000
      }
    })

    // Listen to account-level events
    this.yotoAccount.on('error', (error, context) => {
      if (context.deviceId) {
        log.error(`Device error [${context.deviceId} ${context.operation} ${context.source}]:`, error.message)
      } else {
        log.error('Account error:', error.message)
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
    const { log, accessories } = this
    log.info('Loading accessory from cache:', accessory.displayName)

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
      this.log.info('Starting Yoto account...')

      // Listen for devices being added
      this.yotoAccount.on('deviceAdded', async (deviceId, deviceModel) => {
        const device = deviceModel.device
        this.log.info(`Device discovered: ${device.name} (${deviceId})`)
        await this.registerDevice(device, deviceModel)
      })

      // Start the account (discovers devices, creates device models, starts MQTT)
      await this.yotoAccount.start()

      this.log.info(`✓ Yoto account started with ${this.yotoAccount.devices.size} device(s)`)

      // Remove stale accessories after all devices are registered
      this.removeStaleAccessories()
    } catch (error) {
      this.log.error('Failed to start account:', error instanceof Error ? error.message : String(error))
    }
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
      this.log.info('Restoring existing accessory from cache:', device.name)

      // Update display name if it has changed
      if (existingAccessory.displayName !== sanitizedDeviceName) {
        existingAccessory.updateDisplayName(sanitizedDeviceName)
        const infoService = existingAccessory.getService(this.api.hap.Service.AccessoryInformation)
        if (infoService) {
          // Only update Name, preserve user's ConfiguredName customization
          // ConfiguredName is intentionally NOT updated here because:
          // - It allows users to rename accessories in the Home app
          // - Their custom names should survive Homebridge restarts and Yoto device name changes
          // - Name stays in sync with Yoto's device name for plugin identification
          infoService
            .setCharacteristic(this.api.hap.Characteristic.Name, sanitizedDeviceName)
            .setCharacteristic(this.api.hap.Characteristic.ConfiguredName, sanitizedDeviceName)
        }
      }

      // Update context with fresh device data
      existingAccessory.context = {
        ...existingAccessory.context,
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

      return { success: true }
    } else {
      // Create new accessory
      this.log.info('Adding new accessory:', device.name)

      // Create platform accessory
      /** @type {PlatformAccessory<YotoAccessoryContext>} */
      // eslint-disable-next-line new-cap
      const accessory = new this.api.platformAccessory(sanitizedDeviceName, uuid, accessoryCategory)

      // Set Name and ConfiguredName on AccessoryInformation service
      const infoService = accessory.getService(this.api.hap.Service.AccessoryInformation)
      if (infoService) {
        infoService
          .setCharacteristic(this.api.hap.Characteristic.Name, sanitizedDeviceName)
          .setCharacteristic(this.api.hap.Characteristic.ConfiguredName, sanitizedDeviceName)
      }

      // Set accessory context
      accessory.context = {
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
      this.log.info(`Registering new accessory: ${device.name}`)
      this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory])

      // Add to our tracking map (cast to typed version)
      this.accessories.set(uuid, accessory)

      return { success: true }
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
        this.log.info('Removing existing accessory from cache:', accessory.displayName)

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
  }

  /**
   * Shutdown platform - cleanup all handlers and stop account
   */
  async shutdown () {
    this.log.info('Shutting down Yoto platform...')

    // Stop all accessory handlers
    const stopPromises = []
    for (const [uuid, handler] of this.accessoryHandlers) {
      stopPromises.push(
        handler.stop().catch(error => {
          this.log.error(`Failed to stop handler for ${uuid}:`, error)
        })
      )
    }

    // Wait for all handlers to cleanup
    await Promise.all(stopPromises)
    this.accessoryHandlers.clear()

    // Stop the YotoAccount (disconnects all device models and MQTT)
    if (this.yotoAccount) {
      await this.yotoAccount.stop()
      this.yotoAccount = null
    }

    this.log.info('✓ Yoto platform shutdown complete')
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
