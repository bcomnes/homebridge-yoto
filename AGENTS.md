# Agent Development Notes

This document contains patterns, conventions, and guidelines for developing the homebridge-yoto plugin.

## Dont write summary markdown files unless asked to do so

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

## Event Pattern Preference

### Use Aggregate Events with Exhaustive Type Narrowing

The `yoto-nodejs-client` library should emit **only aggregate events** with `changedFields` arrays:

- `statusUpdate` - passes `(status, source, changedFields[])`
- `configUpdate` - passes `(config, changedFields[])`
- `playbackUpdate` - passes `(playback, changedFields[])`

**Do NOT create granular field events** like `volumeChanged`, `batteryLevelChanged`, etc.

### Homebridge Plugin Pattern

The plugin should use exhaustive switch statements to handle field updates:

```javascript
this.deviceModel.on('statusUpdate', (status, source, changedFields) => {
  for (const field of changedFields) {
    switch (field) {
      case 'volume':
        // Update volume characteristic
        break
      
      case 'batteryLevelPercentage':
        // Update battery characteristic
        break
      
      // ... handle all fields
      
      case 'firmwareVersion':
        // Empty case - available but not used yet
        break
      
      default: {
        // Exhaustive check - TypeScript error if field missed
        const _exhaustive: never = field
        break
      }
    }
  }
})
```

**Benefits:**
- Fewer event listeners (3 instead of 20+)
- Exhaustive TypeScript checking ensures all fields handled
- Empty cases document available fields
- Easy to extend - just fill in empty cases
- Type-safe with proper field typing

## Changelog Management

**NEVER manually edit CHANGELOG.md**
