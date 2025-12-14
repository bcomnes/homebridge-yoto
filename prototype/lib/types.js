/**
 * @fileoverview Type definitions for Yoto API and Homebridge integration
 */

/**
 * @typedef {Object} YotoDevice
 * @property {string} deviceId - Unique identifier for the device
 * @property {string} name - Device name
 * @property {string} description - Device description
 * @property {boolean} online - Whether device is currently online
 * @property {string} releaseChannel - Release channel (e.g., "stable", "beta")
 * @property {string} deviceType - Type of device (e.g., "player")
 * @property {string} deviceFamily - Device family (e.g., "yoto")
 * @property {string} deviceGroup - Device group classification
 */

/**
 * YotoDeviceStatus - ACTUAL structure from MQTT /device/{id}/data/status
 * Note: This differs from the documented API schema
 * @typedef {Object} YotoDeviceStatus
 * @property {number} battery - Raw battery voltage (e.g., 3693)
 * @property {string} [powerCaps] - Power capability flags (e.g., '0x02')
 * @property {number} batteryLevel - Battery level percentage (0-100)
 * @property {number} batteryTemp - Battery temperature
 * @property {string} batteryData - Battery data string (e.g., '0:0:0')
 * @property {number} batteryLevelRaw - Raw battery level value
 * @property {number} free - Free memory
 * @property {number} freeDMA - Free DMA memory
 * @property {number} free32 - Free 32-bit memory
 * @property {number} upTime - Device uptime in seconds
 * @property {number} utcTime - Current UTC time (Unix timestamp)
 * @property {number} aliveTime - Time device has been alive
 * @property {number} accelTemp - Accelerometer temperature in Celsius
 * @property {number} [qiOtp] - Qi charging related field
 * @property {number} [errorsLogged] - Number of errors logged
 * @property {string} nightlightMode - Nightlight mode (e.g., 'off')
 * @property {string} temp - Temperature data string (e.g., '1014:23:318')
 *
 * Note: Volume information comes from events, not status!
 * The following documented fields may exist but haven't been observed in v3 players:
 * @property {number} [statusVersion] - Status data version
 * @property {string} [fwVersion] - Firmware version
 * @property {string} [productType] - Product type identifier
 * @property {number} [als] - Ambient light sensor reading
 * @property {number} [freeDisk] - Free disk space in bytes
 * @property {number} [shutdownTimeout] - Auto-shutdown timeout in seconds
 * @property {number} [dbatTimeout] - Display battery timeout
 * @property {number} [charging] - Charging state (0=not charging, 1=charging)
 * @property {string | null} [activeCard] - Currently active card ID or null
 * @property {number} [cardInserted] - Card insertion state (0=none, 1=physical, 2=remote)
 * @property {number} [playingStatus] - Playing status code
 * @property {boolean} [headphones] - Whether headphones are connected
 * @property {number} [dnowBrightness] - Current display brightness
 * @property {number} [dayBright] - Day mode brightness setting
 * @property {number} [nightBright] - Night mode brightness setting
 * @property {boolean} [bluetoothHp] - Bluetooth headphones enabled
 * @property {number} [volume] - System volume level (may be in events instead)
 * @property {number} [userVolume] - User volume level 0-100 (may be in events instead)
 * @property {'12' | '24'} [timeFormat] - Time format preference
 * @property {number} [day] - Day mode (0=night, 1=day, -1=unknown)
 */

/**
 * YotoPlaybackEvents - From MQTT /device/{id}/data/events
 * @typedef {Object} YotoPlaybackEvents
 * @property {string} repeatAll - Repeat all setting ("true" or "false")
 * @property {string} streaming - Streaming active ("true" or "false")
 * @property {string} volume - Current volume level (0-100 as string)
 * @property {string} volumeMax - Maximum volume level (0-100 as string)
 * @property {string} playbackWait - Playback wait state ("true" or "false")
 * @property {string} sleepTimerActive - Sleep timer active ("true" or "false")
 * @property {string} eventUtc - Event timestamp (Unix timestamp as string)
 * @property {string} trackLength - Track duration in seconds (as string)
 * @property {string} position - Current playback position in seconds (as string)
 * @property {string} cardId - Active card ID
 * @property {string} source - Playback source (e.g., "card", "remote", "MQTT")
 * @property {string} cardUpdatedAt - Card last updated timestamp (ISO8601)
 * @property {string} chapterTitle - Current chapter title
 * @property {string} chapterKey - Current chapter key
 * @property {string} trackTitle - Current track title
 * @property {string} trackKey - Current track key
 * @property {string} playbackStatus - Playback status (e.g., "playing", "paused", "stopped")
 * @property {string} sleepTimerSeconds - Remaining sleep timer seconds (as string)
 */

/**
 * @typedef {Object} YotoDeviceConfigSettings
 * @property {any[]} alarms - Alarm configurations
 * @property {string} ambientColour - Ambient LED color (hex format)
 * @property {string} bluetoothEnabled - Bluetooth enabled state
 * @property {boolean} btHeadphonesEnabled - Bluetooth headphones enabled
 * @property {string} clockFace - Clock face style
 * @property {string} dayDisplayBrightness - Day display brightness
 * @property {string} dayTime - Day mode start time
 * @property {string} dayYotoDaily - Day mode Yoto Daily content
 * @property {string} dayYotoRadio - Day mode Yoto Radio content
 * @property {string} displayDimBrightness - Display dim brightness level
 * @property {string} displayDimTimeout - Display dim timeout in seconds
 * @property {boolean} headphonesVolumeLimited - Headphones volume limited
 * @property {string} hourFormat - Hour format ("12" or "24")
 * @property {string} locale - Locale setting
 * @property {string} maxVolumeLimit - Max volume limit (0-16)
 * @property {string} nightAmbientColour - Night ambient LED color
 * @property {string} nightDisplayBrightness - Night display brightness
 * @property {string} nightMaxVolumeLimit - Night max volume limit (0-16)
 * @property {string} nightTime - Night mode start time
 * @property {string} nightYotoDaily - Night mode Yoto Daily content
 * @property {string} nightYotoRadio - Night mode Yoto Radio content
 * @property {boolean} repeatAll - Repeat all tracks enabled
 * @property {string} shutdownTimeout - Auto-shutdown timeout in seconds
 * @property {string} volumeLevel - Volume level preset
 */

/**
 * @typedef {Object} YotoDeviceConfig
 * @property {string} name - Device name
 * @property {YotoDeviceConfigSettings} config - Device configuration settings
 */

/**
 * @typedef {Object} YotoCardContent
 * @property {Object} [card] - Card information
 * @property {string} [card.cardId] - Card unique identifier
 * @property {string} [card.title] - Card title
 * @property {string} [card.slug] - Card slug
 * @property {string} [card.userId] - Owner user ID
 * @property {string} [card.createdAt] - Creation timestamp
 * @property {string} [card.updatedAt] - Update timestamp
 * @property {boolean} [card.deleted] - Whether card is deleted
 * @property {Object} [card.metadata] - Additional metadata
 * @property {string} [card.metadata.author] - Card author
 * @property {string} [card.metadata.category] - Content category
 * @property {string} [card.metadata.description] - Card description
 * @property {Object} [card.metadata.cover] - Cover image data
 * @property {string} [card.metadata.cover.imageL] - Large cover image URL
 * @property {Object} [card.metadata.media] - Media information
 * @property {number} [card.metadata.media.duration] - Total duration in seconds
 * @property {number} [card.metadata.media.fileSize] - File size in bytes
 * @property {YotoChapter[]} [card.chapters] - Card chapters
 */

/**
 * @typedef {Object} YotoChapter
 * @property {string} key - Chapter key
 * @property {string} title - Chapter title
 * @property {string | null} availableFrom - Availability date (ISO8601)
 * @property {YotoTrack[]} tracks - Chapter tracks
 */

/**
 * @typedef {Object} YotoTrack
 * @property {string} key - Track key
 * @property {string} title - Track title
 * @property {number} duration - Track duration in seconds
 */

/**
 * @typedef {Object} YotoApiDevicesResponse
 * @property {YotoDevice[]} devices - Array of devices
 */

/**
 * @typedef {Object} YotoApiTokenResponse
 * @property {string} access_token - Access token
 * @property {string} token_type - Token type (typically "Bearer")
 * @property {number} expires_in - Token lifetime in seconds
 * @property {string} [refresh_token] - Refresh token
 * @property {string} [scope] - Granted scopes
 * @property {string} [id_token] - ID token JWT
 */

/**
 * @typedef {Object} YotoApiDeviceCodeResponse
 * @property {string} device_code - Device verification code
 * @property {string} user_code - User-facing code to enter
 * @property {string} verification_uri - URL for user to visit
 * @property {string} verification_uri_complete - Complete verification URL with code
 * @property {number} expires_in - Code lifetime in seconds
 * @property {number} interval - Minimum polling interval in seconds
 */

/**
 * @typedef {Object} YotoAccessoryContext
 * @property {YotoDevice} device - Device information
 * @property {YotoDeviceStatus | null} lastStatus - Last known device status
 * @property {YotoPlaybackEvents | null} lastEvents - Last known playback events
 * @property {number} lastUpdate - Timestamp of last update
 * @property {YotoCardContent | null} [activeContentInfo] - Current active content information
 */

/**
 * @typedef {Object} YotoPlatformConfig
 * @property {string} [platform] - Platform name (should be "Yoto")
 * @property {string} [name] - Platform instance name
 * @property {string} [clientId] - OAuth client ID
 * @property {string} [accessToken] - Stored access token
 * @property {string} [refreshToken] - Stored refresh token
 * @property {number} [tokenExpiresAt] - Token expiration timestamp
 * @property {string} [mqttBroker] - MQTT broker URL
 * @property {number} [statusTimeoutSeconds] - Seconds before marking device offline
 * @property {boolean} [exposeTemperature] - Expose temperature sensor
 * @property {boolean} [exposeBattery] - Expose battery service
 * @property {boolean} [exposeAdvancedControls] - Expose advanced control switches
 * @property {boolean} [exposeConnectionStatus] - Expose connection status sensor
 * @property {boolean} [exposeCardDetection] - Expose card detection sensor
 * @property {boolean} [exposeDisplayBrightness] - Expose display brightness control
 * @property {boolean} [exposeSleepTimer] - Expose sleep timer control
 * @property {boolean} [exposeVolumeLimits] - Expose volume limit controls
 * @property {boolean} [exposeAmbientLight] - Expose ambient light color control
 * @property {boolean} [exposeActiveContent] - Track and display active content information
 * @property {boolean} [updateAccessoryName] - Update accessory display name with current content
 * @property {string} [volumeControlType] - Volume control service type
 * @property {boolean} [debug] - Enable debug logging
 */

/**
 * @typedef {Object} MqttCommandResponse
 * @property {Object} status - Response status
 * @property {string} req_body - Stringified request body
 */

/**
 * MQTT command payloads
 */

/**
 * @typedef {Object} MqttVolumeCommand
 * @property {number} volume - Volume level (0-100)
 */

/**
 * @typedef {Object} MqttAmbientCommand
 * @property {number} r - Red intensity (0-255)
 * @property {number} g - Green intensity (0-255)
 * @property {number} b - Blue intensity (0-255)
 */

/**
 * @typedef {Object} MqttSleepTimerCommand
 * @property {number} seconds - Sleep timer duration (0 to disable)
 */

/**
 * @typedef {Object} MqttCardStartCommand
 * @property {string} uri - Card URI (e.g., "https://yoto.io/{cardId}")
 * @property {string} [chapterKey] - Chapter to start from
 * @property {string} [trackKey] - Track to start from
 * @property {number} [secondsIn] - Playback start offset in seconds
 * @property {number} [cutOff] - Playback stop offset in seconds
 * @property {boolean} [anyButtonStop] - Whether any button stops playback
 */

export {}
