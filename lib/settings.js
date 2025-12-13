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
