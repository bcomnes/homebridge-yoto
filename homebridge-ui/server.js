/**
 * @fileoverview Custom UI server for Yoto Homebridge plugin OAuth authentication
 */

import { HomebridgePluginUiServer, RequestError } from '@homebridge/plugin-ui-utils'
import { YotoClient } from 'yoto-nodejs-client'
import { DEFAULT_CLIENT_ID } from '../lib/settings.js'

/**
 * Custom UI server for Yoto plugin OAuth authentication
 * @extends {HomebridgePluginUiServer}
 */
class YotoUiServer extends HomebridgePluginUiServer {
  constructor () {
    // super() MUST be called first
    super()

    // Register OAuth endpoints
    this.onRequest('/auth/config', getAuthConfig)
    this.onRequest('/auth/start', startDeviceFlow)
    this.onRequest('/auth/poll', pollForToken)

    // this MUST be called when you are ready to accept requests
    this.ready()
  }
}

// Create and start the server
(() => new YotoUiServer())()

/**
 * Response from /auth/config endpoint
 * @typedef {Object} AuthConfigResponse
 * @property {string} defaultClientId - The default OAuth client ID
 */

/**
 * Get authentication configuration
 * @returns {Promise<AuthConfigResponse>}
 */
async function getAuthConfig () {
  return {
    defaultClientId: DEFAULT_CLIENT_ID
  }
}

/**
 * Request payload for /auth/start endpoint
 * @typedef {Object} AuthStartRequest
 * @property {string} [clientId] - OAuth client ID from config (optional, falls back to DEFAULT_CLIENT_ID)
 */

/**
 * Response from /auth/start endpoint
 * @typedef {Object} AuthStartResponse
 * @property {string} verification_uri - Base URL for user verification (e.g., https://yotoplay.com/activate)
 * @property {string} verification_uri_complete - Complete URL with code pre-filled
 * @property {string} user_code - User code to enter at verification_uri
 * @property {string} device_code - Device code for polling (not shown to user)
 * @property {number} expires_in - Seconds until code expires (typically 900)
 * @property {number} interval - Recommended polling interval in seconds
 * @property {string} client_id - OAuth client ID used for this flow
 */

/**
 * Start OAuth device flow
 * @param {AuthStartRequest} payload - Request with optional client ID
 * @returns {Promise<AuthStartResponse>}
 */
async function startDeviceFlow (payload) {
  console.log('[Server] startDeviceFlow called with payload:', JSON.stringify(redactSensitive(payload), null, 2))
  try {
    const clientId = payload.clientId || DEFAULT_CLIENT_ID
    console.log('[Server] Using clientId:', clientId)

    // Request device code from Yoto
    console.log('[Server] Requesting device code from Yoto API...')
    const deviceCodeResponse = await YotoClient.requestDeviceCode({
      clientId,
      scope: 'openid profile offline_access',
      audience: 'https://api.yotoplay.com'
    })
    console.log('[Server] Device code response:', JSON.stringify(redactSensitive(deviceCodeResponse), null, 2))

    // Return the device flow info to the UI
    const result = {
      verification_uri: deviceCodeResponse.verification_uri || '',
      verification_uri_complete: deviceCodeResponse.verification_uri_complete || '',
      user_code: deviceCodeResponse.user_code || '',
      device_code: deviceCodeResponse.device_code || '',
      expires_in: deviceCodeResponse.expires_in || 900,
      interval: deviceCodeResponse.interval || 5,
      client_id: clientId
    }
    console.log('[Server] startDeviceFlow returning:', JSON.stringify(result, null, 2))
    return result
  } catch (error) {
    console.error('[Server] startDeviceFlow error:', error)
    throw new RequestError('Failed to start device flow', {
      message: error instanceof Error ? error.message : 'Unknown error'
    })
  }
}

/**
 * Request payload for /auth/poll endpoint
 * @typedef {Object} AuthPollRequest
 * @property {string} deviceCode - Device code from AuthStartResponse
 * @property {string} clientId - OAuth client ID used in auth/start
 */

/**
 * Response from /auth/poll endpoint when still pending
 * @typedef {Object} AuthPollPendingResponse
 * @property {true} pending - Indicates authorization still pending
 * @property {string} message - Status message (e.g., "Waiting for authorization...")
 */

/**
 * Response from /auth/poll endpoint when need to slow down
 * @typedef {Object} AuthPollSlowDownResponse
 * @property {true} slow_down - Indicates polling too fast
 * @property {string} message - Status message about slowing down
 */

/**
 * Response from /auth/poll endpoint on success
 * @typedef {Object} AuthPollSuccessResponse
 * @property {true} success - Indicates successful authentication
 * @property {string} message - Success message
 * @property {string} refreshToken - OAuth refresh token (long-lived)
 * @property {string} accessToken - OAuth access token (short-lived)
 * @property {number} tokenExpiresAt - Unix timestamp when access token expires
 */

/**
 * Union type for all possible /auth/poll responses
 * @typedef {AuthPollPendingResponse | AuthPollSlowDownResponse | AuthPollSuccessResponse} AuthPollResponse
 */

/**
 * Poll for token exchange
 * @param {AuthPollRequest} payload - Request payload with device code and client ID
 * @returns {Promise<AuthPollResponse>}
 */
async function pollForToken (payload) {
  console.log('[Server] pollForToken called with payload:', JSON.stringify(redactSensitive(payload), null, 2))
  const { deviceCode, clientId } = payload

  if (!deviceCode || !clientId) {
    console.error('[Server] Missing deviceCode or clientId')
    throw new RequestError('Missing required parameters', {
      message: 'deviceCode and clientId are required'
    })
  }

  try {
    // Try to exchange device code for tokens
    console.log('[Server] Attempting token exchange...')
    const tokenResponse = await YotoClient.exchangeToken({
      grantType: 'urn:ietf:params:oauth:grant-type:device_code',
      deviceCode,
      clientId,
      audience: 'https://api.yotoplay.com'
    })
    console.log('[Server] Token exchange successful!')

    // Validate required token fields
    if (!tokenResponse.refresh_token || !tokenResponse.access_token) {
      throw new Error('Token response missing required fields')
    }

    // Calculate token expiration (24 hours from now)
    const expiresIn = tokenResponse.expires_in
    const tokenExpiresAt = Date.now() + (expiresIn * 1000)

    // Return tokens to client for saving
    /** @type {AuthPollSuccessResponse} */
    const result = {
      success: true,
      message: 'Authentication successful!',
      refreshToken: tokenResponse.refresh_token,
      accessToken: tokenResponse.access_token,
      tokenExpiresAt
    }
    console.log('[Server] pollForToken success, returning tokens (redacted)')
    return result
  } catch (error) {
    // YotoAPIError has error details in error.body
    const err = /** @type {any} */ (error)
    const errorCode = err.body?.error
    const errorDescription = err.body?.error_description

    // Handle expected polling errors based on error.body.error
    if (errorCode === 'authorization_pending') {
      // This is expected during polling - don't log as error
      /** @type {AuthPollPendingResponse} */
      const pendingResult = {
        pending: true,
        message: 'Waiting for authorization...'
      }
      return pendingResult
    }

    if (errorCode === 'slow_down') {
      console.log('[Server] Polling too fast, slowing down...')
      /** @type {AuthPollSlowDownResponse} */
      const slowDownResult = {
        slow_down: true,
        message: 'Polling too fast, slowing down...'
      }
      return slowDownResult
    }

    if (errorCode === 'expired_token') {
      console.error('[Server] Device code expired')
      throw new RequestError('Device code expired', {
        message: 'The authorization code has expired. Please start over.'
      })
    }

    if (errorCode === 'access_denied') {
      console.error('[Server] Access denied by user')
      throw new RequestError('Access denied', {
        message: 'Authorization was denied. Please try again.'
      })
    }

    // Unexpected error - log full details
    console.error('[Server] Unexpected error during token exchange:', error)
    console.error('[Server] Error code:', errorCode)
    console.error('[Server] Error description:', errorDescription)
    const errorMessage = errorDescription || (error instanceof Error ? error.message : String(error))
    throw new RequestError('Token exchange failed', {
      message: errorMessage || 'Unknown error occurred'
    })
  }
}

/**
 * Redact sensitive data from objects for logging
 * @param {any} obj - Object to redact
 * @returns {any} Redacted copy
 */
function redactSensitive (obj) {
  if (!obj || typeof obj !== 'object') return obj

  const redacted = Array.isArray(obj) ? [...obj] : { ...obj }
  const sensitiveKeys = ['accessToken', 'refreshToken', 'access_token', 'refresh_token', 'token', 'deviceCode', 'device_code']

  for (const key in redacted) {
    if (sensitiveKeys.includes(key) && redacted[key]) {
      redacted[key] = '[REDACTED]'
    } else if (key === 'config' && typeof redacted[key] === 'object') {
      redacted[key] = redactSensitive(redacted[key])
    }
  }

  return redacted
}
