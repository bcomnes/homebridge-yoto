/** @type {import('./config.schema.json')} */
const configSchema = require('./config.schema.json')

const serviceSchema = configSchema.schema.properties.services.properties

/**
 * @typedef {keyof typeof serviceSchema} ServiceSchemaKey
 */

exports.configSchema = configSchema
exports.serviceSchema = serviceSchema
