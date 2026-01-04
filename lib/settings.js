import { configSchema } from '../config.schema.cjs'

/**
 * This is the name of the platform that users will use to register the plugin in the Homebridge config.json
 */
export const PLATFORM_NAME = 'Yoto'

/**
 * This must match the name of your plugin as defined the package.json `name` property
 */
export const PLUGIN_NAME = 'homebridge-yoto'

/**
 * Default OAuth Client ID from config schema
 */
export const DEFAULT_CLIENT_ID = configSchema.schema.properties.clientId.default

/** Device defaults */
export const DEFAULT_MANUFACTURER = 'Yoto Inc.'
export const DEFAULT_MODEL = 'Yoto Player'

/** Battery threshold */
export const LOW_BATTERY_THRESHOLD = 20

/** Logging prefixes for debugging */
export const LOG_PREFIX = {
  PLATFORM: '[Platform]',
  ACCESSORY: '[Accessory]',
  MQTT: '[MQTT]',
}
