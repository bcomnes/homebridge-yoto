/**
 * @fileoverview Main platform implementation for Yoto Homebridge plugin
 */

/** @import { API, DynamicPlatformPlugin, Logger, PlatformAccessory, PlatformConfig, Service, Characteristic } from 'homebridge' */
/** @import { YotoDevice, YotoDeviceStatusResponse } from 'yoto-nodejs-client/lib/api-endpoints/devices.js' */
/** @import { YotoEventsMessage } from 'yoto-nodejs-client/lib/mqtt/client.js' */

/**
 * Context stored in PlatformAccessory for Yoto devices
 * @typedef {Object} YotoAccessoryContext
 * @property {YotoDevice} device - Device metadata from Yoto API
 * @property {YotoDeviceStatusResponse | null} [lastStatus] - Last HTTP API status response
 * @property {YotoEventsMessage | null} [lastEvents] - Last MQTT events message
 * @property {number} [lastUpdate] - Timestamp of last update (milliseconds)
 * @property {number} [lastNonZeroVolume] - Last non-zero volume for unmute restoration
 */

import { readFile, writeFile } from 'fs/promises'
import { YotoClient } from 'yoto-nodejs-client'
import {
  PLATFORM_NAME,
  PLUGIN_NAME,
  DEFAULT_CLIENT_ID,
} from './settings.js'
import { YotoPlayerAccessory } from './accessory.js'

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
  /** @type {string[]} */ discoveredUUIDs = []
  /** @type {YotoClient | null} */ yotoClient = null

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

    log.info('Authentication tokens found, initializing Yoto client...')

    const { updateHomebridgeConfig } = this

    // Initialize Yoto client with token refresh handling
    this.yotoClient = new YotoClient({
      clientId,
      refreshToken,
      accessToken,
      onTokenRefresh: async ({ accessToken: newAccessToken, refreshToken: newRefreshToken, expiresAt }) => {
        log.info('Access token refreshed, expires at:', new Date(expiresAt).toISOString())

        // Update config file with new tokens (similar to homebridge-ring pattern)
        await updateHomebridgeConfig((configContents) => {
          let updatedConfig = configContents

          // Replace old tokens with new tokens
          if (accessToken) {
            updatedConfig = updatedConfig.replace(accessToken, newAccessToken)
          }
          if (refreshToken && newRefreshToken) {
            updatedConfig = updatedConfig.replace(refreshToken, newRefreshToken)
          }

          return updatedConfig
        })
      }
    })

    // When this event is fired it means Homebridge has restored all cached accessories from disk.
    // Dynamic Platform plugins should only register new accessories after this event was fired,
    // in order to ensure they weren't added to homebridge already. This event can also be used
    // to start discovery of new accessories.
    api.on('didFinishLaunching', () => {
      log.debug('Executed didFinishLaunching callback')
      // run the method to discover / register your devices as accessories
      this.discoverDevices()
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
   * Discover and register Yoto devices as accessories.
   * Accessories must only be registered once, previously created accessories
   * must not be registered again to prevent "duplicate UUID" errors.
   */
  async discoverDevices () {
    if (!this.yotoClient) {
      this.log.error('Cannot discover devices - Yoto client not initialized')
      return
    }

    try {
      this.log.info('Discovering Yoto devices...')
      const response = await this.yotoClient.getDevices()
      const devices = response.devices || []
      this.log.info(`Found ${devices.length} Yoto device(s)`)

      // Clear discovered UUIDs for this discovery cycle
      this.discoveredUUIDs = []

      // Track successful registrations
      let allDevicesRegistered = true

      // Register each device as an accessory
      for (const device of devices) {
        try {
          const { success } = await this.registerDevice(device)
          if (!success) {
            allDevicesRegistered = false
          }
        } catch (error) {
          this.log.error(`Failed to register device ${device.name}:`, error)
          allDevicesRegistered = false
        }
      }

      // Only remove stale accessories if all devices were successfully registered
      // This prevents accidentally removing working accessories if registration fails
      if (allDevicesRegistered) {
        this.removeStaleAccessories()
      } else {
        this.log.warn('Skipping stale accessory removal due to registration errors')
      }

      this.log.info(`✓ Discovered ${devices.length} device(s)`)
    } catch (error) {
      this.log.error('Failed to discover devices:', error instanceof Error ? error.message : String(error))
    }
  }

  /**
   * Register a device as a platform accessory
   * @param {YotoDevice} device - Device to register
   * @returns {Promise<{ success: boolean }>} Object indicating if registration succeeded
   */
  async registerDevice (device) {
    if (!this.yotoClient) {
      this.log.error('Cannot register device - Yoto client not initialized')
      return { success: false }
    }
    // Generate UUID for this device
    const uuid = this.api.hap.uuid.generate(device.deviceId)
    this.discoveredUUIDs.push(uuid)

    // Check if accessory already exists
    const existingAccessory = this.accessories.get(uuid)

    if (existingAccessory) {
      // Accessory exists - update it
      this.log.info('Restoring existing accessory from cache:', device.name)

      // Update display name if it has changed
      if (existingAccessory.displayName !== device.name) {
        existingAccessory.displayName = device.name
        const infoService = existingAccessory.getService(this.api.hap.Service.AccessoryInformation)
        if (infoService) {
          // Only update Name, preserve user's ConfiguredName customization
          // ConfiguredName is intentionally NOT updated here because:
          // - It allows users to rename accessories in the Home app
          // - Their custom names should survive Homebridge restarts and Yoto device name changes
          // - Name stays in sync with Yoto's device name for plugin identification
          infoService
            .setCharacteristic(this.api.hap.Characteristic.Name, device.name)
        }
      }

      // Update context with fresh device data
      existingAccessory.context = {
        ...existingAccessory.context,
        device,
      }

      // Update accessory information
      this.api.updatePlatformAccessories([existingAccessory])

      // Create handler for this accessory (yotoClient is guaranteed non-null here)
      const handler = new YotoPlayerAccessory({
        platform: this,
        accessory: existingAccessory,
        yotoClient: this.yotoClient,
      })

      // Track handler
      this.accessoryHandlers.set(uuid, handler)

      // Initialize accessory (connect MQTT, etc.)
      await handler.setup()

      return { success: true }
    } else {
      // Create new accessory
      this.log.info('Adding new accessory:', device.name)

      // Create platform accessory as external accessory (SmartSpeaker requires Categories.SPEAKER)
      /** @type {PlatformAccessory<YotoAccessoryContext>} */
      // eslint-disable-next-line new-cap
      const accessory = new this.api.platformAccessory(device.name, uuid, this.api.hap.Categories.SPEAKER)

      // Set Name and ConfiguredName on AccessoryInformation service
      const infoService = accessory.getService(this.api.hap.Service.AccessoryInformation)
      if (infoService) {
        infoService
          .setCharacteristic(this.api.hap.Characteristic.Name, device.name)
          .setCharacteristic(this.api.hap.Characteristic.ConfiguredName, device.name)
      }

      // Set accessory context
      accessory.context = {
        device,
      }

      // Create handler for this accessory (yotoClient is guaranteed non-null here)
      const handler = new YotoPlayerAccessory({
        platform: this,
        accessory,
        yotoClient: this.yotoClient,
      })

      // Track handler
      this.accessoryHandlers.set(uuid, handler)

      // Initialize accessory (connect MQTT, etc.)
      await handler.setup()

      // Publish as external accessory (SmartSpeaker must be external)
      // Homebridge will log the setup code when the accessory starts listening
      this.log.info(`Publishing new external accessory: ${device.name}`)
      this.api.publishExternalAccessories(PLUGIN_NAME, [accessory])

      // Add to our tracking map (cast to typed version)
      this.accessories.set(uuid, accessory)

      return { success: true }
    }
  }

  /**
   * Remove accessories that are no longer present in the account
   */
  removeStaleAccessories () {
    for (const [uuid, accessory] of this.accessories) {
      if (!this.discoveredUUIDs.includes(uuid)) {
        this.log.info('Removing existing accessory from cache:', accessory.displayName)

        // Destroy handler if it exists
        const handler = this.accessoryHandlers.get(uuid)
        if (handler) {
          handler.destroy().catch(error => {
            this.log.error(`Failed to destroy handler for ${accessory.displayName}:`, error)
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
   * Shutdown platform - cleanup all handlers and MQTT connections
   */
  async shutdown () {
    this.log.info('Shutting down Yoto platform...')

    // Destroy all accessory handlers (disconnects MQTT, cleanup)
    const destroyPromises = []
    for (const [uuid, handler] of this.accessoryHandlers) {
      destroyPromises.push(
        handler.destroy().catch(error => {
          this.log.error(`Failed to destroy handler for ${uuid}:`, error)
        })
      )
    }

    // Wait for all handlers to cleanup
    await Promise.all(destroyPromises)

    this.accessoryHandlers.clear()
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
