/**
 * @fileoverview Constants for Yoto Homebridge plugin
 */

// Playback status from MQTT events
export const PLAYBACK_STATUS = {
  PLAYING: 'playing',
  PAUSED: 'paused',
  STOPPED: 'stopped',
}

// Card insertion state from device status
export const CARD_INSERTION_STATE = {
  NONE: 0,
  PHYSICAL: 1,
  REMOTE: 2,
}

// Day mode state from device status
export const DAY_MODE = {
  UNKNOWN: -1,
  NIGHT: 0,
  DAY: 1,
}

// Power source from device status
export const POWER_SOURCE = {
  BATTERY: 0,
  V2_DOCK: 1,
  USB_C: 2,
  QI: 3,
}

// Device defaults
export const DEFAULT_MANUFACTURER = 'Yoto Inc.'
export const DEFAULT_MODEL = 'Yoto Player'

// Battery threshold
export const LOW_BATTERY_THRESHOLD = 20

// Default config values
export const DEFAULT_CONFIG = {
  pollingInterval: 300000, // 5 minutes in milliseconds
  statusTimeoutSeconds: 120, // Consider offline after 2 minutes without MQTT update
  enableMqtt: true,
  exposeBattery: true,
  exposeTemperature: true,
}

// Logging prefixes for debugging
export const LOG_PREFIX = {
  PLATFORM: '[Platform]',
  ACCESSORY: '[Accessory]',
  MQTT: '[MQTT]',
}
