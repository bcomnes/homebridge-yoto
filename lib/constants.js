/**
 * @fileoverview Constants and default values for the Yoto Homebridge plugin
 */

/**
 * Plugin identification constants
 */
export const PLATFORM_NAME = 'Yoto'
export const PLUGIN_NAME = 'homebridge-yoto'

/**
 * Yoto API endpoints
 */
export const YOTO_API_BASE_URL = 'https://api.yotoplay.com'
export const YOTO_OAUTH_AUTHORIZE_URL = `${YOTO_API_BASE_URL}/authorize`
export const YOTO_OAUTH_TOKEN_URL = `${YOTO_API_BASE_URL}/oauth/token`
export const YOTO_OAUTH_DEVICE_CODE_URL = `${YOTO_API_BASE_URL}/oauth/device/code`

/**
 * MQTT configuration
 */
export const YOTO_MQTT_BROKER_URL = 'mqtt://mqtt.yotoplay.com:1883'
export const MQTT_RECONNECT_PERIOD = 5000 // milliseconds
export const MQTT_CONNECT_TIMEOUT = 30000 // milliseconds

/**
 * MQTT topic templates
 */
export const MQTT_TOPIC_DATA_STATUS = '/device/{deviceId}/data/status'
export const MQTT_TOPIC_DATA_EVENTS = '/device/{deviceId}/data/events'
export const MQTT_TOPIC_RESPONSE = '/device/{deviceId}/response'
export const MQTT_TOPIC_COMMAND_STATUS_REQUEST = '/device/{deviceId}/command/status/request'
export const MQTT_TOPIC_COMMAND_EVENTS_REQUEST = '/device/{deviceId}/command/events/request'
export const MQTT_TOPIC_COMMAND_VOLUME_SET = '/device/{deviceId}/command/volume/set'
export const MQTT_TOPIC_COMMAND_CARD_START = '/device/{deviceId}/command/card/start'
export const MQTT_TOPIC_COMMAND_CARD_STOP = '/device/{deviceId}/command/card/stop'
export const MQTT_TOPIC_COMMAND_CARD_PAUSE = '/device/{deviceId}/command/card/pause'
export const MQTT_TOPIC_COMMAND_CARD_RESUME = '/device/{deviceId}/command/card/resume'
export const MQTT_TOPIC_COMMAND_SLEEP_TIMER = '/device/{deviceId}/command/sleep-timer/set'
export const MQTT_TOPIC_COMMAND_AMBIENTS_SET = '/device/{deviceId}/command/ambients/set'
export const MQTT_TOPIC_COMMAND_REBOOT = '/device/{deviceId}/command/reboot'

/**
 * OAuth configuration
 */
export const OAUTH_CLIENT_ID = 'homebridge-yoto'
export const OAUTH_AUDIENCE = 'https://api.yotoplay.com'
export const OAUTH_SCOPE = 'profile offline_access openid'
export const OAUTH_POLLING_INTERVAL = 5000 // milliseconds
export const OAUTH_DEVICE_CODE_TIMEOUT = 300000 // 5 minutes

/**
 * Device polling and timeouts
 */
export const DEFAULT_STATUS_TIMEOUT_SECONDS = 120 // Mark device offline after no updates
export const TOKEN_REFRESH_BUFFER_SECONDS = 300 // Refresh token 5 minutes before expiry
export const INITIAL_STATUS_REQUEST_DELAY = 2000 // milliseconds after MQTT connect

/**
 * HomeKit service configuration
 */
export const DEFAULT_MANUFACTURER = 'Yoto'
export const DEFAULT_MODEL = 'Yoto Player'
export const LOW_BATTERY_THRESHOLD = 20 // percentage

/**
 * Volume configuration
 */
export const MIN_VOLUME = 0
export const MAX_VOLUME = 100
export const YOTO_MAX_VOLUME_LIMIT = 16 // Yoto's internal max volume scale

/**
 * Playback status mapping
 */
export const PLAYBACK_STATUS = {
  PLAYING: 'playing',
  PAUSED: 'paused',
  STOPPED: 'stopped'
}

/**
 * Card insertion states
 */
export const CARD_INSERTION_STATE = {
  NONE: 0,
  PHYSICAL: 1,
  REMOTE: 2
}

/**
 * Day mode states
 */
export const DAY_MODE = {
  UNKNOWN: -1,
  NIGHT: 0,
  DAY: 1
}

/**
 * Power source states
 */
export const POWER_SOURCE = {
  BATTERY: 0,
  V2_DOCK: 1,
  USB_C: 2,
  QI_DOCK: 3
}

/**
 * Default configuration values
 */
export const DEFAULT_CONFIG = {
  platform: PLATFORM_NAME,
  name: PLATFORM_NAME,
  mqttBroker: YOTO_MQTT_BROKER_URL,
  statusTimeoutSeconds: DEFAULT_STATUS_TIMEOUT_SECONDS,
  exposeTemperature: true,
  exposeBattery: true,
  exposeAdvancedControls: false,
  exposeConnectionStatus: true,
  exposeCardDetection: false,
  exposeDisplayBrightness: true,
  exposeSleepTimer: false,
  exposeVolumeLimits: false,
  exposeAmbientLight: false,
  exposeActiveContent: true,
  updateAccessoryName: false,
  volumeControlType: 'speaker',
  debug: false
}

/**
 * Error messages
 */
export const ERROR_MESSAGES = {
  NO_AUTH: 'No authentication credentials found. Please complete OAuth setup.',
  TOKEN_EXPIRED: 'Access token expired. Attempting to refresh...',
  TOKEN_REFRESH_FAILED: 'Failed to refresh access token. Please re-authenticate.',
  MQTT_CONNECTION_FAILED: 'Failed to connect to MQTT broker.',
  MQTT_DISCONNECTED: 'MQTT connection lost. Attempting to reconnect...',
  DEVICE_OFFLINE: 'Device appears to be offline.',
  API_ERROR: 'API request failed',
  INVALID_CONFIG: 'Invalid configuration'
}

/**
 * Log prefixes
 */
export const LOG_PREFIX = {
  AUTH: '[Auth]',
  API: '[API]',
  MQTT: '[MQTT]',
  PLATFORM: '[Platform]',
  ACCESSORY: '[Accessory]'
}
