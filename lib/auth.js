/**
 * @fileoverview OAuth2 Device Authorization Flow implementation for Yoto API
 */

/** @import { Logger } from 'homebridge' */
/** @import { YotoApiTokenResponse, YotoApiDeviceCodeResponse } from './types.js' */

import {
  YOTO_OAUTH_DEVICE_CODE_URL,
  YOTO_OAUTH_TOKEN_URL,
  OAUTH_CLIENT_ID,
  OAUTH_AUDIENCE,
  OAUTH_SCOPE,
  OAUTH_POLLING_INTERVAL,
  OAUTH_DEVICE_CODE_TIMEOUT,
  ERROR_MESSAGES,
  LOG_PREFIX
} from './constants.js'

/**
 * OAuth2 authentication handler for Yoto API
 */
export class YotoAuth {
  /**
   * @param {Logger} log - Homebridge logger
   */
  constructor (log) {
    this.log = log
  }

  /**
   * Initiate device authorization flow
   * @returns {Promise<YotoApiDeviceCodeResponse>}
   */
  async initiateDeviceFlow () {
    this.log.info(LOG_PREFIX.AUTH, 'Initiating device authorization flow...')

    try {
      const response = await fetch(YOTO_OAUTH_DEVICE_CODE_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          client_id: OAUTH_CLIENT_ID,
          scope: OAUTH_SCOPE,
          audience: OAUTH_AUDIENCE
        })
      })

      if (!response.ok) {
        const errorText = await response.text()
        throw new Error(`Device code request failed: ${response.status} ${errorText}`)
      }

      const data = /** @type {YotoApiDeviceCodeResponse} */ (await response.json())

      this.log.info(LOG_PREFIX.AUTH, '='.repeat(60))
      this.log.info(LOG_PREFIX.AUTH, 'YOTO AUTHENTICATION REQUIRED')
      this.log.info(LOG_PREFIX.AUTH, '='.repeat(60))
      this.log.info(LOG_PREFIX.AUTH, '')
      this.log.info(LOG_PREFIX.AUTH, `1. Visit: ${data.verification_uri}`)
      this.log.info(LOG_PREFIX.AUTH, `2. Enter code: ${data.user_code}`)
      this.log.info(LOG_PREFIX.AUTH, '')
      this.log.info(LOG_PREFIX.AUTH, `Or visit: ${data.verification_uri_complete}`)
      this.log.info(LOG_PREFIX.AUTH, '')
      this.log.info(LOG_PREFIX.AUTH, `Code expires in ${Math.floor(data.expires_in / 60)} minutes`)
      this.log.info(LOG_PREFIX.AUTH, '='.repeat(60))

      return data
    } catch (error) {
      this.log.error(LOG_PREFIX.AUTH, 'Failed to initiate device flow:', error)
      throw error
    }
  }

  /**
   * Poll for authorization completion
   * @param {string} deviceCode - Device code from initiation
   * @returns {Promise<YotoApiTokenResponse>}
   */
  async pollForAuthorization (deviceCode) {
    const startTime = Date.now()
    const timeout = OAUTH_DEVICE_CODE_TIMEOUT

    this.log.info(LOG_PREFIX.AUTH, 'Waiting for user authorization...')

    while (Date.now() - startTime < timeout) {
      try {
        const response = await fetch(YOTO_OAUTH_TOKEN_URL, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
            device_code: deviceCode,
            client_id: OAUTH_CLIENT_ID
          })
        })

        if (response.ok) {
          const tokenData = /** @type {YotoApiTokenResponse} */ (await response.json())
          this.log.info(LOG_PREFIX.AUTH, '✓ Authorization successful!')
          return tokenData
        }

        const errorData = /** @type {any} */ (await response.json().catch(() => ({})))

        // Handle specific OAuth errors
        if (errorData.error === 'authorization_pending') {
          // Still waiting for user to authorize
          await this.sleep(OAUTH_POLLING_INTERVAL)
          continue
        }

        if (errorData.error === 'slow_down') {
          // Server wants us to slow down polling
          await this.sleep(OAUTH_POLLING_INTERVAL * 2)
          continue
        }

        if (errorData.error === 'expired_token') {
          throw new Error('Device code expired. Please restart the authorization process.')
        }

        if (errorData.error === 'access_denied') {
          throw new Error('Authorization was denied by the user.')
        }

        // Unknown error
        throw new Error(`Authorization failed: ${errorData.error || response.statusText}`)
      } catch (error) {
        if (error instanceof Error && error.message.includes('expired')) {
          throw error
        }
        this.log.debug(LOG_PREFIX.AUTH, 'Polling error:', error)
        await this.sleep(OAUTH_POLLING_INTERVAL)
      }
    }

    throw new Error('Authorization timed out. Please try again.')
  }

  /**
   * Refresh access token using refresh token
   * @param {string} refreshToken - Refresh token
   * @returns {Promise<YotoApiTokenResponse>}
   */
  async refreshAccessToken (refreshToken) {
    this.log.debug(LOG_PREFIX.AUTH, 'Refreshing access token...')

    try {
      const response = await fetch(YOTO_OAUTH_TOKEN_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          grant_type: 'refresh_token',
          refresh_token: refreshToken,
          client_id: OAUTH_CLIENT_ID
        })
      })

      if (!response.ok) {
        const errorText = await response.text()
        throw new Error(`Token refresh failed: ${response.status} ${errorText}`)
      }

      const tokenData = /** @type {YotoApiTokenResponse} */ (await response.json())
      this.log.info(LOG_PREFIX.AUTH, '✓ Token refreshed successfully')
      return tokenData
    } catch (error) {
      this.log.error(LOG_PREFIX.AUTH, ERROR_MESSAGES.TOKEN_REFRESH_FAILED, error)
      throw error
    }
  }

  /**
   * Complete device authorization flow
   * @returns {Promise<YotoApiTokenResponse>}
   */
  async authorize () {
    const deviceCodeResponse = await this.initiateDeviceFlow()
    const tokenResponse = await this.pollForAuthorization(deviceCodeResponse.device_code)
    return tokenResponse
  }

  /**
   * Check if token is expired or expiring soon
   * @param {number} expiresAt - Token expiration timestamp (seconds since epoch)
   * @param {number} bufferSeconds - Seconds before expiry to consider expired
   * @returns {boolean}
   */
  isTokenExpired (expiresAt, bufferSeconds = 300) {
    const now = Math.floor(Date.now() / 1000)
    return expiresAt <= now + bufferSeconds
  }

  /**
   * Calculate token expiration timestamp
   * @param {number} expiresIn - Seconds until token expires
   * @returns {number} - Unix timestamp when token expires
   */
  calculateExpiresAt (expiresIn) {
    return Math.floor(Date.now() / 1000) + expiresIn
  }

  /**
   * Sleep for specified milliseconds
   * @param {number} ms - Milliseconds to sleep
   * @returns {Promise<void>}
   */
  sleep (ms) {
    return new Promise(resolve => setTimeout(resolve, ms))
  }
}
