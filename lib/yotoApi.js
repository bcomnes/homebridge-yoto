/**
 * @fileoverview REST API client for Yoto API
 */

/** @import { Logger } from 'homebridge' */
/** @import { YotoApiDevicesResponse, YotoDevice, YotoDeviceConfig, YotoCardContent } from './types.js' */
/** @import { YotoAuth } from './auth.js' */

import {
  YOTO_API_BASE_URL,
  ERROR_MESSAGES,
  LOG_PREFIX
} from './constants.js'

/**
 * Yoto REST API client
 */
export class YotoApi {
  /**
   * @param {Logger} log - Homebridge logger
   * @param {YotoAuth} auth - Authentication handler
   */
  constructor (log, auth) {
    this.log = log
    this.auth = auth
    this.accessToken = null
    this.refreshToken = null
    this.tokenExpiresAt = 0
  }

  /**
   * Set authentication tokens
   * @param {string} accessToken - Access token
   * @param {string} refreshToken - Refresh token
   * @param {number} expiresAt - Token expiration timestamp
   */
  setTokens (accessToken, refreshToken, expiresAt) {
    this.accessToken = accessToken
    this.refreshToken = refreshToken
    this.tokenExpiresAt = expiresAt
  }

  /**
   * Check if we have valid authentication
   * @returns {boolean}
   */
  hasAuth () {
    return !!this.accessToken
  }

  /**
   * Ensure we have a valid access token, refreshing if necessary
   * @returns {Promise<void>}
   */
  async ensureValidToken () {
    if (!this.accessToken) {
      throw new Error(ERROR_MESSAGES.NO_AUTH)
    }

    // Check if token needs refresh
    if (this.auth.isTokenExpired(this.tokenExpiresAt)) {
      this.log.info(LOG_PREFIX.API, ERROR_MESSAGES.TOKEN_EXPIRED)

      if (!this.refreshToken) {
        throw new Error(ERROR_MESSAGES.TOKEN_REFRESH_FAILED)
      }

      try {
        const tokenResponse = await this.auth.refreshAccessToken(this.refreshToken)
        this.accessToken = tokenResponse.access_token
        this.tokenExpiresAt = this.auth.calculateExpiresAt(tokenResponse.expires_in)

        // Update refresh token if a new one was provided
        if (tokenResponse.refresh_token) {
          this.refreshToken = tokenResponse.refresh_token
        }

        // Notify platform to save updated tokens
        if (this.onTokenRefreshCallback) {
          this.onTokenRefreshCallback(this.accessToken, this.refreshToken, this.tokenExpiresAt)
        }
      } catch (error) {
        this.log.error(LOG_PREFIX.API, 'Token refresh failed:', error)
        // Throw specific error so platform can detect and restart auth flow
        throw new Error('TOKEN_REFRESH_FAILED')
      }
    }
  }

  /**
   * Make an authenticated API request
   * @param {string} endpoint - API endpoint path
   * @param {RequestInit & { _retried?: boolean }} [options] - Fetch options
   * @returns {Promise<any>}
   */
  async request (endpoint, options = {}) {
    await this.ensureValidToken()

    const url = `${YOTO_API_BASE_URL}${endpoint}`

    const headers = {
      Authorization: `Bearer ${this.accessToken}`,
      'Content-Type': 'application/json',
      ...options.headers
    }

    try {
      this.log.debug(LOG_PREFIX.API, `${options.method || 'GET'} ${endpoint}`)

      const response = await fetch(url, {
        ...options,
        headers
      })

      if (!response.ok) {
        const errorText = await response.text()
        this.log.error(LOG_PREFIX.API, `Request failed: ${response.status} ${errorText}`)

        // Handle 401 by attempting token refresh once
        if (response.status === 401 && !options._retried) {
          this.log.warn(LOG_PREFIX.API, 'Received 401, forcing token refresh...')
          this.tokenExpiresAt = 0 // Force refresh
          await this.ensureValidToken()
          return this.request(endpoint, { ...options, _retried: true })
        }

        throw new Error(`API request failed: ${response.status} ${errorText}`)
      }

      // Return empty object for 204 No Content
      if (response.status === 204) {
        return {}
      }

      return await response.json()
    } catch (error) {
      this.log.error(LOG_PREFIX.API, `${ERROR_MESSAGES.API_ERROR}:`, error)
      throw error
    }
  }

  /**
   * Get all devices associated with the authenticated user
   * @returns {Promise<YotoDevice[]>}
   */
  async getDevices () {
    this.log.debug(LOG_PREFIX.API, 'Fetching devices...')

    const response = /** @type {YotoApiDevicesResponse} */ (await this.request('/device-v2/devices/mine'))

    this.log.info(LOG_PREFIX.API, `Found ${response.devices.length} device(s)`)
    return response.devices
  }

  /**
   * Get device configuration
   * @param {string} deviceId - Device ID
   * @returns {Promise<YotoDeviceConfig>}
   */
  async getDeviceConfig (deviceId) {
    this.log.debug(LOG_PREFIX.API, `Fetching config for device ${deviceId}`)

    const config = /** @type {YotoDeviceConfig} */ (await this.request(`/device-v2/${deviceId}/config`))
    return config
  }

  /**
   * Update device configuration
   * @param {string} deviceId - Device ID
   * @param {YotoDeviceConfig} config - Updated configuration
   * @returns {Promise<YotoDeviceConfig>}
   */
  async updateDeviceConfig (deviceId, config) {
    this.log.debug(LOG_PREFIX.API, `Updating config for device ${deviceId}`)

    const updatedConfig = /** @type {YotoDeviceConfig} */ (await this.request(`/device-v2/${deviceId}/config`, {
      method: 'PUT',
      body: JSON.stringify(config)
    }))

    return updatedConfig
  }

  /**
   * Get content/card details
   * @param {string} cardId - Card ID
   * @param {Object} [options] - Query options
   * @param {string} [options.timezone] - Timezone for chapter availability
   * @param {boolean} [options.playable] - Return playable signed URLs
   * @returns {Promise<YotoCardContent>}
   */
  async getContent (cardId, options = {}) {
    this.log.debug(LOG_PREFIX.API, `Fetching content for card ${cardId}`)

    const queryParams = new URLSearchParams()
    if (options.timezone) {
      queryParams.append('timezone', options.timezone)
    }
    if (options.playable) {
      queryParams.append('playable', 'true')
    }

    const queryString = queryParams.toString()
    const endpoint = `/content/${cardId}${queryString ? `?${queryString}` : ''}`

    const content = /** @type {YotoCardContent} */ (await this.request(endpoint))
    return content
  }

  /**
   * Get user's MYO (Make Your Own) cards
   * @param {Object} [options] - Query options
   * @param {boolean} [options.showdeleted] - Show deleted cards
   * @returns {Promise<any>}
   */
  async getMyContent (options = {}) {
    this.log.debug(LOG_PREFIX.API, 'Fetching user content...')

    const queryParams = new URLSearchParams()
    if (options.showdeleted !== undefined) {
      queryParams.append('showdeleted', String(options.showdeleted))
    }

    const queryString = queryParams.toString()
    const endpoint = `/content/mine${queryString ? `?${queryString}` : ''}`

    const content = await this.request(endpoint)
    return content
  }

  /**
   * Get family library groups
   * @returns {Promise<any>}
   */
  async getLibraryGroups () {
    this.log.debug(LOG_PREFIX.API, 'Fetching library groups...')

    const groups = await this.request('/card/family/library/groups')
    return groups
  }

  /**
   * Get specific library group
   * @param {string} groupId - Group ID
   * @returns {Promise<any>}
   */
  async getLibraryGroup (groupId) {
    this.log.debug(LOG_PREFIX.API, `Fetching library group ${groupId}`)

    const group = await this.request(`/card/family/library/groups/${groupId}`)
    return group
  }

  /**
   * Set callback for token refresh events
   * @param {(accessToken: string, refreshToken: string, expiresAt: number) => void} callback
   */
  setTokenRefreshCallback (callback) {
    this.onTokenRefreshCallback = callback
  }
}
