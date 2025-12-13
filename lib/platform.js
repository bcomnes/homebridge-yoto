/**
 * @fileoverview Main platform implementation for Yoto Homebridge plugin
 */

/** @import { API, DynamicPlatformPlugin, Logger, PlatformAccessory, PlatformConfig } from 'homebridge' */
/** @import { YotoDevice, YotoPlatformConfig, YotoAccessoryContext } from './types.js' */

import { readFile, writeFile, mkdir } from 'fs/promises'
import { join } from 'path'
import { YotoAuth } from './auth.js'
import { YotoApi } from './yotoApi.js'
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

    // Persistent storage path for tokens
    this.storagePath = api.user.storagePath()
    this.tokenFilePath = join(this.storagePath, 'homebridge-yoto-tokens.json')

    // Track accessory handlers for status updates
    /** @type {Map<string, import('./playerAccessory.js').YotoPlayerAccessory>} */
    this.accessoryHandlers = new Map()

    // Status polling interval
    this.statusPollInterval = null

    // Initialize API clients
    this.auth = new YotoAuth(log, this.config.clientId)
    this.yotoApi = new YotoApi(log, this.auth)

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
      // Load tokens from persistent storage
      await this.loadTokens()

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

      // Start platform-level status polling (every 60 seconds)
      this.startStatusPolling()
    } catch (error) {
      this.log.error(LOG_PREFIX.PLATFORM, 'Initialization failed:', error)
    }
  }

  /**
   * Start periodic status polling for all devices
   */
  startStatusPolling () {
    // Poll every 60 seconds
    this.statusPollInterval = setInterval(async () => {
      try {
        await this.checkAllDevicesStatus()
      } catch (error) {
        this.log.error(LOG_PREFIX.PLATFORM, 'Failed to check device status:', error)
      }
    }, 60000)
  }

  /**
   * Stop status polling
   */
  stopStatusPolling () {
    if (this.statusPollInterval) {
      clearInterval(this.statusPollInterval)
      this.statusPollInterval = null
    }
  }

  /**
   * Check all devices' online status and notify accessories
   * @returns {Promise<void>}
   */
  async checkAllDevicesStatus () {
    try {
      // Fetch fresh device list from API (single call for all devices)
      const devices = await this.yotoApi.getDevices()

      // Update each accessory with fresh device info
      for (const device of devices) {
        const uuid = this.api.hap.uuid.generate(device.deviceId)
        const accessory = this.accessories.get(uuid)

        if (accessory) {
          const wasOnline = accessory.context.device.online
          const isNowOnline = device.online

          // Update device info in context
          accessory.context.device = device

          // Notify accessory handler if status changed
          const handler = this.accessoryHandlers.get(uuid)
          if (handler && wasOnline !== isNowOnline) {
            handler.handleOnlineStatusChange(isNowOnline, wasOnline)
          }
        }
      }
    } catch (error) {
      this.log.error(LOG_PREFIX.PLATFORM, 'Error checking device status:', error)
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

    // Save tokens to persistent storage
    await this.saveTokens()

    this.log.info(LOG_PREFIX.PLATFORM, '✓ Authentication successful and saved!')
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

    // Save cleared tokens
    await this.saveTokens()

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

    // Save updated tokens to persistent storage
    this.saveTokens().catch(error => {
      this.log.error(LOG_PREFIX.PLATFORM, 'Failed to save refreshed tokens:', error)
    })

    // Note: MQTT reconnection is handled by each accessory's own MQTT client
  }

  /**
   * Load tokens from config or persistent storage
   * Priority: config.json > persistent storage file
   * @returns {Promise<void>}
   */
  async loadTokens () {
    // First check if tokens are in config.json
    if (this.config.accessToken && this.config.refreshToken) {
      this.log.debug(LOG_PREFIX.PLATFORM, 'Using tokens from config.json')
      return
    }

    // Fall back to persistent storage file
    try {
      const data = await readFile(this.tokenFilePath, 'utf-8')
      const tokens = JSON.parse(data)

      if (tokens.accessToken && tokens.refreshToken) {
        this.config.accessToken = tokens.accessToken
        this.config.refreshToken = tokens.refreshToken
        this.config.tokenExpiresAt = tokens.tokenExpiresAt
        this.log.debug(LOG_PREFIX.PLATFORM, 'Loaded tokens from persistent storage')
      }
    } catch (error) {
      // File doesn't exist or is invalid - not an error on first run
      this.log.debug(LOG_PREFIX.PLATFORM, 'No saved tokens found in storage')
    }
  }

  /**
   * Save tokens to persistent storage
   * @returns {Promise<void>}
   */
  async saveTokens () {
    try {
      // Ensure storage directory exists
      await mkdir(this.storagePath, { recursive: true })

      const tokens = {
        accessToken: this.config.accessToken || '',
        refreshToken: this.config.refreshToken || '',
        tokenExpiresAt: this.config.tokenExpiresAt || 0
      }

      await writeFile(this.tokenFilePath, JSON.stringify(tokens, null, 2), 'utf-8')
      this.log.debug(LOG_PREFIX.PLATFORM, 'Saved tokens to persistent storage')
    } catch (error) {
      this.log.error(LOG_PREFIX.PLATFORM, 'Failed to save tokens:', error)
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
      const handler = new YotoPlayerAccessory(this, typedAccessory)

      // Track handler for status updates
      this.accessoryHandlers.set(uuid, handler)

      // Initialize accessory (connect MQTT, etc.)
      handler.initialize().catch(error => {
        this.log.error(LOG_PREFIX.PLATFORM, `Failed to initialize ${device.name}:`, error)
      })
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
      const handler = new YotoPlayerAccessory(this, typedAccessory)

      // Track handler for status updates
      this.accessoryHandlers.set(uuid, handler)

      // Initialize accessory (connect MQTT, etc.)
      handler.initialize().catch(error => {
        this.log.error(LOG_PREFIX.PLATFORM, `Failed to initialize ${device.name}:`, error)
      })

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

      // Remove from tracking map and handlers
      for (const accessory of staleAccessories) {
        const handler = this.accessoryHandlers.get(accessory.UUID)
        if (handler) {
          handler.destroy().catch(error => {
            this.log.error(LOG_PREFIX.PLATFORM, 'Error destroying accessory handler:', error)
          })
          this.accessoryHandlers.delete(accessory.UUID)
        }
        this.accessories.delete(accessory.UUID)
      }
    }
  }

  /**
   * Shutdown handler - cleanup connections
   */
  async shutdown () {
    this.log.info(LOG_PREFIX.PLATFORM, 'Shutting down...')

    // Stop status polling
    this.stopStatusPolling()

    // Cleanup all accessory handlers
    for (const [, handler] of this.accessoryHandlers) {
      try {
        await handler.destroy()
      } catch (error) {
        this.log.error(LOG_PREFIX.PLATFORM, 'Error shutting down accessory:', error)
      }
    }
  }
}
