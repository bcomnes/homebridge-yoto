/**
 * @fileoverview Homebridge Yoto Plugin Entry Point
 */

/** @import { API } from 'homebridge' */

import { YotoPlatform } from './lib/platform.js'
import { PLATFORM_NAME } from './lib/settings.js'

/**
 * Register the Yoto platform with Homebridge
 * @param {API} api - Homebridge API
 */
export default function (api) {
  api.registerPlatform(PLATFORM_NAME, YotoPlatform)
}
