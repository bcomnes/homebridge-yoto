/// <reference lib="dom" />
/* eslint-env browser */

/**
 * @fileoverview Client-side UI logic for Yoto Homebridge plugin OAuth authentication
 */

/** @import {IHomebridgePluginUi} from '@homebridge/plugin-ui-utils/ui.interface' */
/** @import { AuthConfigResponse, AuthStartResponse, AuthPollResponse } from '../server.js' */

/**
 * @global
 * @type {IHomebridgePluginUi}
 */
const homebridge = window.homebridge

/**
 * @typedef {Object} YotoConfig
 * @property {string} [clientId] - OAuth client ID
 * @property {string} [refreshToken] - Stored refresh token
 * @property {string} [accessToken] - Stored access token
 * @property {number} [tokenExpiresAt] - Token expiration timestamp
 */

// State variables
/** @type {ReturnType<typeof setInterval> | null} */
let pollingInterval = null
/** @type {ReturnType<typeof setInterval> | null} */
let countdownInterval = null
/** @type {string | null} */
let deviceCode = null
/** @type {string | null} */
let clientId = null
let pollIntervalSeconds = 5
/** @type {YotoConfig[]} */
let pluginConfig = []
/** @type {string | null} */
let defaultClientId = null

/**
 * Initialize UI when ready
 */
async function initializeUI () {
  // Button click handlers
  const startAuthBtn = document.getElementById('startAuthButton')
  const openUrlBtn = document.getElementById('openUrlButton')
  const retryBtn = document.getElementById('retryButton')
  const logoutBtn = document.getElementById('logoutButton')

  if (startAuthBtn) startAuthBtn.addEventListener('click', startDeviceFlow)
  if (openUrlBtn) openUrlBtn.addEventListener('click', openVerificationUrl)
  if (retryBtn) retryBtn.addEventListener('click', retryAuth)
  if (logoutBtn) logoutBtn.addEventListener('click', logout)

  // Show schema-based config form below custom UI
  homebridge.showSchemaForm()

  // Load auth config and check authentication status
  await loadAuthConfig()
  await checkAuthStatus()
}

// Initialize on ready
homebridge.addEventListener('ready', initializeUI)

/**
 * Show a specific UI section and hide all others
 * @param {string} sectionToShow - ID of section to show
 * @param {Object} [options] - Optional parameters
 * @param {string} [options.errorMessage] - Error message to display (for errorSection)
 */
function showSection (sectionToShow, options = {}) {
  const sections = [
    'statusMessage',
    'authRequired',
    'deviceCodeSection',
    'authSuccess',
    'errorSection'
  ]

  for (const sectionId of sections) {
    const el = document.getElementById(sectionId)
    if (el) {
      el.style.display = sectionId === sectionToShow ? 'block' : 'none'
    }
  }

  // Set error message if provided
  if (options.errorMessage) {
    const errorMessageEl = document.getElementById('errorMessage')
    if (errorMessageEl) errorMessageEl.textContent = options.errorMessage
  }
}

/**
 * Show authentication required section
 */
function showAuthRequired () {
  showSection('authRequired')
}

/**
 * Show authentication success
 */
function showAuthSuccess () {
  showSection('authSuccess')
}

/**
 * Show error message
 * @param {string} message - Error message to display
 */
function showError (message) {
  showSection('errorSection', { errorMessage: message })
}

/**
 * Load authentication configuration from server
 * @returns {Promise<void>}
 */
async function loadAuthConfig () {
  try {
    // Load plugin config first
    pluginConfig = await homebridge.getPluginConfig()
    if (!pluginConfig.length) {
      pluginConfig.push({})
    }

    /** @type {AuthConfigResponse} */
    const config = await homebridge.request('/auth/config')
    defaultClientId = config.defaultClientId

    // Populate the client ID input field
    const clientIdInput = /** @type {HTMLInputElement | null} */ (document.getElementById('clientIdInput'))
    const defaultClientIdDisplay = document.getElementById('defaultClientIdDisplay')

    if (clientIdInput) {
      // Use configured value or default
      const currentConfig = pluginConfig[0] || {}
      clientIdInput.value = currentConfig.clientId || defaultClientId
      clientIdInput.placeholder = defaultClientId
    }

    if (defaultClientIdDisplay) {
      defaultClientIdDisplay.textContent = defaultClientId
    }
  } catch (error) {
    console.error('Failed to load auth config:', error)
  }
}

/**
 * Start OAuth device flow
 * @returns {Promise<void>}
 */
async function startDeviceFlow () {
  try {
    homebridge.showSpinner()

    // Get client ID from input field (which may have been edited by user)
    const clientIdInput = /** @type {HTMLInputElement | null} */ (document.getElementById('clientIdInput'))
    const clientIdToUse = clientIdInput?.value || defaultClientId || undefined

    // Save the client ID to config if it's different from what's stored
    const config = pluginConfig[0] || {}
    if (clientIdToUse && clientIdToUse !== config.clientId) {
      if (!pluginConfig[0]) pluginConfig[0] = {}
      pluginConfig[0].clientId = clientIdToUse
      await homebridge.updatePluginConfig(pluginConfig)
      await homebridge.savePluginConfig()
    }

    /** @type {AuthStartResponse} */
    const response = await homebridge.request('/auth/start', {
      clientId: clientIdToUse
    })

    // Store device code and client ID for polling
    deviceCode = response.device_code
    clientId = response.client_id
    pollIntervalSeconds = response.interval

    // Show device code section
    showSection('deviceCodeSection')

    // Set verification URL (complete with code)
    const verificationUrlCompleteEl = /** @type {HTMLInputElement | null} */ (document.getElementById('verificationUrlComplete'))
    if (verificationUrlCompleteEl) verificationUrlCompleteEl.value = response.verification_uri_complete

    // Set user code
    const userCodeEl = /** @type {HTMLInputElement | null} */ (document.getElementById('userCode'))
    if (userCodeEl) userCodeEl.value = response.user_code

    // Start countdown
    startCountdown(response.expires_in)

    // Start polling for token
    startPolling()

    homebridge.hideSpinner()
  } catch (error) {
    homebridge.hideSpinner()

    // Debug: Log the raw error
    console.error('Start auth error (raw):', error)
    console.error('Start auth error (type):', typeof error)
    console.error('Start auth error (keys):', error && typeof error === 'object' ? Object.keys(error) : 'N/A')

    // Extract error message from various error formats
    let errorMessage = 'Failed to start authentication'
    if (error && typeof error === 'object') {
      if ('message' in error && error.message) {
        errorMessage = String(error.message)
      } else if ('error' in error && error.error) {
        errorMessage = String(error.error)
      } else {
        errorMessage = JSON.stringify(error)
      }
    } else if (error) {
      errorMessage = String(error)
    }

    console.error('Start auth error (extracted message):', errorMessage)

    homebridge.toast.error('Failed to start authentication', errorMessage)
    showError(errorMessage)
  }
}

/**
 * Start countdown timer
 * @param {number} expiresIn - Seconds until expiration
 */
function startCountdown (expiresIn) {
  let remaining = expiresIn
  const totalTime = expiresIn

  countdownInterval = setInterval(() => {
    remaining--

    const minutes = Math.floor(remaining / 60)
    const seconds = remaining % 60
    const percentage = (remaining / totalTime) * 100

    const countdownTextEl = document.getElementById('countdownText')
    const countdownBarEl = /** @type {HTMLElement | null} */ (document.getElementById('countdownBar'))

    if (countdownTextEl) countdownTextEl.textContent = `${minutes}:${seconds.toString().padStart(2, '0')}`
    if (countdownBarEl) countdownBarEl.style.width = percentage + '%'

    if (percentage < 30) {
      const barEl = document.getElementById('countdownBar')
      if (barEl) barEl.className = 'progress-bar bg-danger'
    } else if (percentage < 60) {
      const barEl = document.getElementById('countdownBar')
      if (barEl) barEl.className = 'progress-bar bg-warning'
    }

    if (remaining <= 0) {
      if (countdownInterval) clearInterval(countdownInterval)
      if (pollingInterval) clearInterval(pollingInterval)
      showError('The authorization code has expired. Please try again.')
    }
  }, 1000)
}

/**
 * Start polling for token
 */
function startPolling () {
  pollingInterval = setInterval(async () => {
    try {
      /** @type {AuthPollResponse} */
      const result = await homebridge.request('/auth/poll', {
        deviceCode: deviceCode || '',
        clientId: clientId || ''
      })

      // Type guard: check if success response
      if ('success' in result && result.success) {
        // Success! Update config with tokens
        if (pollingInterval) clearInterval(pollingInterval)
        if (countdownInterval) clearInterval(countdownInterval)

        // Update plugin config with new tokens
        if (!pluginConfig[0]) pluginConfig[0] = {}
        // Type narrowing: result.success is true, so we have AuthPollSuccessResponse
        pluginConfig[0].refreshToken = result.refreshToken
        pluginConfig[0].accessToken = result.accessToken
        pluginConfig[0].tokenExpiresAt = result.tokenExpiresAt

        // Ensure clientId is set (use the one we got from the flow)
        if (!pluginConfig[0].clientId && clientId) {
          pluginConfig[0].clientId = clientId
        }

        // Save to Homebridge config
        await homebridge.updatePluginConfig(pluginConfig)
        await homebridge.savePluginConfig()

        // Refresh the schema form to show updated token fields
        homebridge.hideSchemaForm()
        setTimeout(() => {
          homebridge.showSchemaForm()
        }, 100)

        homebridge.toast.success('Authentication successful!')
        homebridge.toast.info('Please restart the plugin for changes to take effect', 'Restart Required')
        showAuthSuccess()
      } else if ('slow_down' in result && result.slow_down) {
        // Type guard: check if slow_down response
        // Increase polling interval
        if (pollingInterval) clearInterval(pollingInterval)
        pollIntervalSeconds = pollIntervalSeconds * 1.5
        startPolling()
      }
      // If pending (has 'pending' property), just continue polling
    } catch (error) {
      // Stop polling on error
      if (pollingInterval) clearInterval(pollingInterval)
      if (countdownInterval) clearInterval(countdownInterval)

      // Debug: Log the raw error
      console.error('Poll error (raw):', error)
      console.error('Poll error (type):', typeof error)
      console.error('Poll error (keys):', error && typeof error === 'object' ? Object.keys(error) : 'N/A')

      // Extract error message from various error formats
      let errorMessage = 'Authentication failed'
      if (error && typeof error === 'object') {
        if ('message' in error && error.message) {
          errorMessage = String(error.message)
        } else if ('error' in error && error.error) {
          errorMessage = String(error.error)
        } else {
          errorMessage = JSON.stringify(error)
        }
      } else if (error) {
        errorMessage = String(error)
      }

      console.error('Poll error (extracted message):', errorMessage)

      homebridge.toast.error('Authentication failed', errorMessage)
      showError(errorMessage)
    }
  }, pollIntervalSeconds * 1000)
}

/**
 * Open verification URL in new window
 */
function openVerificationUrl () {
  const urlEl = /** @type {HTMLInputElement | null} */ (document.getElementById('verificationUrlComplete'))
  if (urlEl && urlEl.value) {
    window.open(urlEl.value, '_blank')
  }
}

/**
 * Retry authentication
 */
function retryAuth () {
  showAuthRequired()
}

/**
 * Logout - clear tokens and restart auth flow
 */
async function logout () {
  try {
    homebridge.showSpinner()

    // Clear tokens from config
    if (pluginConfig[0]) {
      delete pluginConfig[0].refreshToken
      delete pluginConfig[0].accessToken
      delete pluginConfig[0].tokenExpiresAt
    }

    // Save cleared config
    await homebridge.updatePluginConfig(pluginConfig)
    await homebridge.savePluginConfig()

    homebridge.hideSpinner()
    homebridge.toast.success('Logged out successfully')

    // Show auth required screen
    showAuthRequired()
  } catch (error) {
    homebridge.hideSpinner()
    const errorMessage = error && typeof error === 'object' && 'message' in error
      ? String(error.message)
      : String(error)
    homebridge.toast.error('Logout failed', errorMessage)
  }
}

/**
 * Check initial authentication status
 * @returns {Promise<void>}
 */
async function checkAuthStatus () {
  try {
    // pluginConfig is already loaded by loadAuthConfig
    const config = pluginConfig[0]

    // Check if we have tokens configured (don't validate them, just check they exist)
    const hasRefreshToken = !!config?.refreshToken
    const hasAccessToken = !!config?.accessToken

    if (hasRefreshToken && hasAccessToken) {
      showAuthSuccess()
    } else {
      showAuthRequired()
      // Populate client ID field if we're showing auth required
      const clientIdInput = /** @type {HTMLInputElement | null} */ (document.getElementById('clientIdInput'))
      if (clientIdInput && defaultClientId) {
        clientIdInput.value = config?.clientId || defaultClientId
      }
    }
  } catch (error) {
    console.error('Failed to check auth status:', error)
    showAuthRequired()
  }
}
