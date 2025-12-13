# Agent Development Notes

This document contains patterns, conventions, and guidelines for developing the homebridge-yoto plugin.

## JSDoc Typing Patterns

### Use TypeScript-in-JavaScript (ts-in-js)

All source files use `.js` extensions with JSDoc comments for type safety. This provides type checking without TypeScript compilation overhead.

### Avoid `any` types

Always provide specific types. Use `unknown` when the type is truly unknown, then narrow it with type guards.

**Bad:**
```javascript
/**
 * @param {any} data
 */
function processData(data) {
  return data.value;
}
```

**Good:**
```javascript
/**
 * @param {YotoDeviceStatus} status
 * @returns {number}
 */
function getBatteryLevel(status) {
  return status.batteryLevelPercentage;
}
```

### Use @ts-expect-error over @ts-ignore

When you must suppress a TypeScript error, use `@ts-expect-error` with a comment explaining why. This will error if the issue is fixed, prompting cleanup.

**Bad:**
```javascript
// @ts-ignore
const value = accessory.context.device.unknownProperty;
```

**Good:**
```javascript
// @ts-expect-error - API may return undefined for offline devices
const lastSeen = accessory.context.device.lastSeenAt;
```

### Use newer @import syntax in jsdoc/ts-in-js for types only

Import types using the `@import` JSDoc tag to avoid runtime imports of type-only dependencies.

```javascript
/** @import { API, DynamicPlatformPlugin, Logger, PlatformAccessory, PlatformConfig, Service, Characteristic } from 'homebridge' */
/** @import { YotoDevice, YotoDeviceStatus, YotoDeviceConfig } from './types.js' */

/**
 * @param {Logger} log
 * @param {PlatformConfig} config
 * @param {API} api
 */
export function YotoPlatform(log, config, api) {
  this.log = log;
  this.config = config;
  this.api = api;
}
```

### Import Consolidation

Keep regular imports and type imports separate. Use single-line imports for types when possible.

```javascript
import { EventEmitter } from 'events';

/** @import { YotoDevice } from './types.js' */
/** @import { API, PlatformAccessory } from 'homebridge' */
```

### Homebridge Type Import Patterns

Homebridge types are available from the `homebridge` package:

```javascript
/** @import { API, Characteristic, DynamicPlatformPlugin, Logger, PlatformAccessory, PlatformConfig, Service } from 'homebridge' */
/** @import { CharacteristicValue } from 'homebridge' */
```

For HAP (HomeKit Accessory Protocol) types:

```javascript
/** @import { HAPStatus } from 'homebridge' */

/**
 * @throws {import('homebridge').HapStatusError}
 */
function throwNotResponding() {
  throw new this.api.hap.HapStatusError(this.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
}
```

### Prefer Schema-Based Types

Define types for API responses and configuration objects using JSDoc typedef.

```javascript
/**
 * @typedef {Object} YotoDeviceStatus
 * @property {string} deviceId
 * @property {number} batteryLevelPercentage
 * @property {boolean} isCharging
 * @property {boolean} isOnline
 * @property {string | null} activeCard
 * @property {number} userVolumePercentage
 * @property {number} systemVolumePercentage
 * @property {number} temperatureCelcius
 * @property {number} wifiStrength
 * @property {0 | 1 | 2} cardInsertionState - 0=none, 1=physical, 2=remote
 * @property {-1 | 0 | 1} dayMode - -1=unknown, 0=night, 1=day
 * @property {0 | 1 | 2 | 3} powerSource - 0=battery, 1=V2 dock, 2=USB-C, 3=Qi
 */

/**
 * @typedef {Object} YotoDevice
 * @property {string} deviceId
 * @property {string} name
 * @property {string} description
 * @property {boolean} online
 * @property {string} releaseChannel
 * @property {string} deviceType
 * @property {string} deviceFamily
 * @property {string} deviceGroup
 */

/**
 * @typedef {Object} YotoDeviceConfig
 * @property {string} name
 * @property {YotoDeviceConfigSettings} config
 */

/**
 * @typedef {Object} YotoDeviceConfigSettings
 * @property {any[]} alarms
 * @property {string} ambientColour
 * @property {string} bluetoothEnabled
 * @property {boolean} btHeadphonesEnabled
 * @property {string} clockFace
 * @property {string} dayDisplayBrightness
 * @property {string} dayTime
 * @property {string} maxVolumeLimit
 * @property {string} nightAmbientColour
 * @property {string} nightDisplayBrightness
 * @property {string} nightMaxVolumeLimit
 * @property {string} nightTime
 * @property {boolean} repeatAll
 * @property {string} shutdownTimeout
 * @property {string} volumeLevel
 */
```

### API Response Typing

Type API responses explicitly:

```javascript
/**
 * @typedef {Object} YotoApiDevicesResponse
 * @property {YotoDevice[]} devices
 */

/**
 * Get all devices for authenticated user
 * @returns {Promise<YotoDevice[]>}
 */
async function getDevices() {
  const response = await fetch('https://api.yotoplay.com/device-v2/devices/mine', {
    headers: { 'Authorization': `Bearer ${this.accessToken}` }
  });
  
  /** @type {YotoApiDevicesResponse} */
  const data = await response.json();
  return data.devices;
}
```

### Platform Accessory Context Typing

Define the context object structure stored in accessories:

```javascript
/**
 * @typedef {Object} YotoAccessoryContext
 * @property {YotoDevice} device
 * @property {YotoDeviceStatus | null} lastStatus
 * @property {number} lastUpdate
 */

/**
 * @param {PlatformAccessory<YotoAccessoryContext>} accessory
 */
function configureAccessory(accessory) {
  const device = accessory.context.device;
  this.log.info('Restoring device:', device.name);
}
```

### Nullable Fields in API Responses

Use union types with `null` for fields that may be absent:

```javascript
/**
 * @typedef {Object} YotoCardContent
 * @property {string} cardId
 * @property {string} title
 * @property {string | null} author
 * @property {string | null} description
 * @property {YotoChapter[] | null} chapters
 */
```

### Optional vs Nullable

Distinguish between optional fields (may not exist) and nullable fields (exists but may be null):

```javascript
/**
 * @typedef {Object} YotoPlayerState
 * @property {string} deviceId - Always present
 * @property {string | null} activeCard - Present but may be null
 * @property {string} [lastPlayedCard] - May not be present in response
 */
```

## Changelog Management

**NEVER manually edit CHANGELOG.md**

The changelog is automatically generated using `auto-changelog` during the version bump process:

- When running `npm version [patch|minor|major]`, the `version:changelog` script runs automatically
- It uses the keepachangelog template
- Detects breaking changes via `BREAKING CHANGE:` pattern in commit messages
- Generates entries from git commits

To ensure proper changelog generation:
- Write meaningful git commit messages
- Use conventional commit format when possible
- Mark breaking changes with `BREAKING CHANGE:` in commit body
- Let the automation handle changelog updates during `npm version`
