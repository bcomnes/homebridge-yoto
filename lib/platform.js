/**
 * @fileoverview Main platform implementation for Yoto Homebridge plugin
 */

/** @import { API, DynamicPlatformPlugin, Logger, PlatformAccessory, PlatformConfig } from 'homebridge' */
/** @import { YotoDevice, YotoPlatformConfig, YotoAccessoryContext } from './types.js' */

import { YotoAuth } from './auth.js'
import { YotoApi } from './yotoApi.js'
import { YotoMqtt } from './yotoMqtt.js'
import { YotoPlayerAccessory } from './playerAccessory.js'
import {
  PLATFORM_NAME,
  PLUGIN_NAME,
  DEFAULT_CONFIG,
  ERROR_MESSAGES,
  LOG_PREFIX
} from './constants.js'

/**
 * Yoto Platform implementation
 * @implements {DynamicPlatformPlugin}
 */
export class YotoPlatform {
  /**
   * @param {Logger} log - Homebridge logger
   * @param {PlatformConfig & YotoPlatformConfig} config - Platform configuration
   * @param {API} api - Homebridge API
   */
  constructor (log, config, api) {
    this.log = log
    this.config = /** @type {YotoPlatformConfig} */ ({ ...DEFAULT_CONFIG, ...config })
    this.api = api

    // Homebridge service and characteristic references
    this.Service = api.hap.Service
    this.Characteristic = api.hap.Characteristic

    // Track registered accessories
    /** @type {Map<string, PlatformAccessory<YotoAccessoryContext>>} */
    this.accessories = new Map()

    // Track discovered device UUIDs
    /** @type {string[]} */
    this.discoveredUUIDs = []

    // Initialize API clients
    this.auth = new YotoAuth(log, this.config.clientId)
    this.yotoApi = new YotoApi(log, this.auth)
    this.yotoMqtt = new YotoMqtt(log)

    // Set up token refresh callback
    this.yotoApi.setTokenRefreshCallback(this.handleTokenRefresh.bind(this))

    this.log.debug(LOG_PREFIX.PLATFORM, 'Initializing platform:', this.config.name)

    // Wait for Homebridge to finish launching
    this.api.on('didFinishLaunching', () => {
      this.log.debug(LOG_PREFIX.PLATFORM, 'Executed didFinishLaunching callback')
      this.initialize().catch(error => {
        this.log.error(LOG_PREFIX.PLATFORM, 'Failed to initialize:', error)
      })
    })
  }

  /**
   * Initialize the platform - authenticate and discover devices
   * @returns {Promise<void>}
   */
  async initialize () {
    try {
      // Check if we have stored credentials
      if (!this.config.accessToken || !this.config.refreshToken) {
        await this.performDeviceFlow()
      }

      // Set tokens in API client
      this.yotoApi.setTokens(
        this.config.accessToken || '',
        this.config.refreshToken || '',
        this.config.tokenExpiresAt || 0
      )

      // Discover and register devices
      try {
        await this.discoverDevices()
      } catch (error) {
        // Check if this is an auth error that requires re-authentication
        if (error instanceof Error && error.message.includes('TOKEN_REFRESH_FAILED')) {
          this.log.warn(LOG_PREFIX.PLATFORM, 'Token refresh failed, clearing tokens and restarting auth flow...')
          await this.clearTokensAndReauth()
          return
        }
        throw error
      }

      // Connect to MQTT with first device ID
      if (this.accessories.size > 0) {
        const firstAccessory = Array.from(this.accessories.values())[0]
        if (firstAccessory) {
          const firstDeviceId = firstAccessory.context.device.deviceId
          await this.yotoMqtt.connect(this.config.accessToken || '', firstDeviceId)
        }
      }
    } catch (error) {
      this.log.error(LOG_PREFIX.PLATFORM, 'Initialization failed:', error)
    }
  }

  /**
   * Perform device authorization flow
   * @returns {Promise<void>}
   */
  async performDeviceFlow () {
    this.log.warn(LOG_PREFIX.PLATFORM, ERROR_MESSAGES.NO_AUTH)
    this.log.info(LOG_PREFIX.PLATFORM, 'Starting OAuth flow...')

    const tokenResponse = await this.auth.authorize()

    // Store tokens in config
    this.config.accessToken = tokenResponse.access_token
    this.config.refreshToken = tokenResponse.refresh_token || ''
    this.config.tokenExpiresAt = this.auth.calculateExpiresAt(tokenResponse.expires_in)

    // Save tokens to config file
    await this.saveConfig()

    this.log.info(LOG_PREFIX.PLATFORM, '✓ Authentication successful and saved to config!')
  }

  /**
   * Clear invalid tokens and restart authentication
   * @returns {Promise<void>}
   */
  async clearTokensAndReauth () {
    // Clear tokens from config
    this.config.accessToken = ''
    this.config.refreshToken = ''
    this.config.tokenExpiresAt = 0

    // Save cleared config
    await this.saveConfig()

    // Restart initialization
    await this.initialize()
  }

  /**
   * Handle token refresh - update config
   * @param {string} accessToken - New access token
   * @param {string} refreshToken - New refresh token
   * @param {number} expiresAt - New expiration timestamp
   */
  handleTokenRefresh (accessToken, refreshToken, expiresAt) {
    this.log.info(LOG_PREFIX.PLATFORM, 'Token refreshed')
    this.config.accessToken = accessToken
    this.config.refreshToken = refreshToken
    this.config.tokenExpiresAt = expiresAt

    // Save updated tokens to config file
    this.saveConfig().catch(error => {
      this.log.error(LOG_PREFIX.PLATFORM, 'Failed to save refreshed tokens:', error)
    })

    // Reconnect MQTT with new token
    if (this.accessories.size > 0) {
      const firstAccessory = Array.from(this.accessories.values())[0]
      if (firstAccessory) {
        const firstDeviceId = firstAccessory.context.device.deviceId
        this.yotoMqtt.disconnect().then(() => {
          return this.yotoMqtt.connect(accessToken, firstDeviceId)
        }).catch(error => {
          this.log.error(LOG_PREFIX.PLATFORM, 'Failed to reconnect MQTT after token refresh:', error)
        })
      }
    }
  }

  /**
   * Save config to disk using Homebridge API
   * @returns {Promise<void>}
   */
  async saveConfig () {
    try {
      // Check if updatePlatformConfig is available (Homebridge 1.3.0+)
      // @ts-expect-error - updatePlatformConfig may not exist in older Homebridge versions
      if (typeof this.api.updatePlatformConfig === 'function') {
        // @ts-expect-error - updatePlatformConfig may not exist in older Homebridge versions
        await this.api.updatePlatformConfig([this.config])
        this.log.debug(LOG_PREFIX.PLATFORM, 'Config saved to disk')
      } else {
        // Fallback for older Homebridge versions
        this.log.debug(LOG_PREFIX.PLATFORM, 'Config updated in memory (restart Homebridge to persist)')
      }
    } catch (error) {
      this.log.error(LOG_PREFIX.PLATFORM, 'Failed to save config:', error)
      throw error
    }
  }

  /**
   * Restore cached accessories from disk
   * This is called by Homebridge on startup for each cached accessory
   * @param {PlatformAccessory<YotoAccessoryContext>} accessory - Cached accessory
   */
  configureAccessory (accessory) {
    this.log.info(LOG_PREFIX.PLATFORM, 'Loading accessory from cache:', accessory.displayName)

    // Add to our tracking map
    this.accessories.set(accessory.UUID, accessory)
  }

  /**
   * Discover Yoto devices and register as accessories
   * @returns {Promise<void>}
   */
  async discoverDevices () {
    try {
      this.log.info(LOG_PREFIX.PLATFORM, 'Discovering Yoto devices...')

      // Fetch devices from API
      const devices = await this.yotoApi.getDevices()

      if (devices.length === 0) {
        this.log.warn(LOG_PREFIX.PLATFORM, 'No Yoto devices found in account')
        return
      }

      // Process each device
      for (const device of devices) {
        await this.registerDevice(device)
      }

      // Remove accessories that are no longer present
      this.removeStaleAccessories()

      this.log.info(LOG_PREFIX.PLATFORM, `✓ Discovered ${devices.length} device(s)`)
    } catch (error) {
      this.log.error(LOG_PREFIX.PLATFORM, 'Failed to discover devices:', error)
      throw error
    }
  }

  /**
   * Register a device as a platform accessory
   * @param {YotoDevice} device - Device to register
   * @returns {Promise<void>}
   */
  async registerDevice (device) {
    // Generate UUID for this device
    const uuid = this.api.hap.uuid.generate(device.deviceId)
    this.discoveredUUIDs.push(uuid)

    // Check if accessory already exists
    const existingAccessory = this.accessories.get(uuid)

    if (existingAccessory) {
      // Accessory exists - update it
      this.log.info(LOG_PREFIX.PLATFORM, 'Restoring existing accessory:', device.name)

      // Update context with fresh device data
      const typedAccessory = /** @type {PlatformAccessory<YotoAccessoryContext>} */ (existingAccessory)
      typedAccessory.context.device = device
      typedAccessory.context.lastUpdate = Date.now()

      // Update accessory information
      this.api.updatePlatformAccessories([existingAccessory])

      // Create handler for this accessory
      // eslint-disable-next-line no-new
      new YotoPlayerAccessory(this, typedAccessory)
    } else {
      // Create new accessory
      this.log.info(LOG_PREFIX.PLATFORM, 'Adding new accessory:', device.name)

      // Create platform accessory
      // eslint-disable-next-line new-cap
      const accessory = new this.api.platformAccessory(device.name, uuid)

      // Create typed accessory with context
      const typedAccessory = /** @type {PlatformAccessory<YotoAccessoryContext>} */ (accessory)

      // Set accessory context
      typedAccessory.context = {
        device,
        lastStatus: null,
        lastEvents: null,
        lastUpdate: Date.now()
      }

      // Create handler for this accessory
      // eslint-disable-next-line no-new
      new YotoPlayerAccessory(this, typedAccessory)

      // Register with Homebridge
      this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory])

      // Add to our tracking map
      this.accessories.set(uuid, typedAccessory)
    }
  }

  /**
   * Remove accessories that are no longer present in the account
   */
  removeStaleAccessories () {
    const staleAccessories = []

    for (const [uuid, accessory] of this.accessories) {
      if (!this.discoveredUUIDs.includes(uuid)) {
        this.log.info(LOG_PREFIX.PLATFORM, 'Removing stale accessory:', accessory.displayName)
        staleAccessories.push(accessory)
      }
    }

    if (staleAccessories.length > 0) {
      this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, staleAccessories)

      // Remove from tracking map
      for (const accessory of staleAccessories) {
        this.accessories.delete(accessory.UUID)
      }
    }
  }

  /**
   * Shutdown handler - cleanup connections
   */
  async shutdown () {
    this.log.info(LOG_PREFIX.PLATFORM, 'Shutting down...')

    try {
      await this.yotoMqtt.disconnect()
    } catch (error) {
      this.log.error(LOG_PREFIX.PLATFORM, 'Error during shutdown:', error)
    }
  }
}
