# Homebridge Yoto Plugin - Implementation Status

## ✅ What's Implemented

### Architecture
- ✅ Platform plugin using `yoto-nodejs-client` for device management
- ✅ One accessory per Yoto device (published as external accessory for SmartSpeaker support)
- ✅ Real-time updates via MQTT + periodic HTTP polling fallback
- ✅ Offline detection and "No Response" status handling
- ✅ Capability-based service registration (v2/v3/mini device support)

### Core Services (Always Present)
- ✅ **AccessoryInformation** - Device metadata (manufacturer, model, serial, firmware)
- ✅ **SmartSpeaker** (PRIMARY) - Playback control and volume
- ✅ **Battery** - Battery level, charging state, low battery indicator
- ✅ **ContactSensor (CardSlot)** - Card insertion detection
- ✅ **OccupancySensor (NightModeStatus)** - Day/night mode indicator
- ✅ **Switch (SleepTimer)** - Toggle sleep timer (30 min default)
- ✅ **Switch (Bluetooth)** - Toggle Bluetooth on/off
- ✅ **Fanv2 (DayMaxVolume)** - Day mode max volume limit control
- ✅ **Fanv2 (NightMaxVolume)** - Night mode max volume limit control

### Optional Services (Capability-Based)
- ✅ **TemperatureSensor** - Temperature reading (v3 only)
- ✅ **Lightbulb (DayNightlight)** - Day nightlight color/brightness control (v3 only)
- ✅ **Lightbulb (NightNightlight)** - Night nightlight color/brightness control (v3 only)
- ✅ **ContactSensor (NightlightActive)** - Live nightlight status (v3 only)
- ✅ **ContactSensor (DayNightlightActive)** - Day nightlight status (v3 only)
- ✅ **ContactSensor (NightNightlightActive)** - Night nightlight status (v3 only)

## Service & Characteristic Reference

All services are named consistently using `generateServiceName()` helper: `"[Device Name] [Service Name]"`

### Yoto Player Accessory

Each Yoto device is represented as a single HomeKit accessory with multiple services.

**Category**: `SPEAKER` (required for SmartSpeaker service)

---

#### Service: AccessoryInformation (Required)

Standard HomeKit service providing device identification.

**Characteristics:**
- `Manufacturer` (GET) - "Yoto Inc."
- `Model` (GET) - Device family (e.g., "v3", "v2", "mini")
- `SerialNumber` (GET) - Device ID
- `HardwareRevision` (GET) - Generation and form factor
- `FirmwareRevision` (GET) - Firmware version from device status

**Source:** `device` metadata + `status.firmwareVersion`

---

#### Service: SmartSpeaker (PRIMARY)

Controls playback and volume. Marked as primary service for the accessory.

**Characteristics:**
- `CurrentMediaState` (GET) - PLAY/PAUSE/STOP based on playback status
- `TargetMediaState` (GET/SET) - Control playback (play/pause/stop)
- `Volume` (GET/SET) - Volume level (0-16 native scale, dynamic max based on volume limit)
- `Mute` (GET/SET) - Mute state (derived from volume === 0)
- `StatusActive` (GET) - Online/offline indicator

**Source:** `status.volume`, `playback.playbackStatus`  
**Control:** `sendCommand({ action: 'play' | 'pause' | 'stop' | 'volume', volume: N })`

---

#### Service: Battery

Battery status information.

**Characteristics:**
- `BatteryLevel` (GET) - Battery percentage (0-100)
- `ChargingState` (GET) - CHARGING or NOT_CHARGING
- `StatusLowBattery` (GET) - LOW when ≤20%, NORMAL otherwise
- `StatusActive` (GET) - Online/offline indicator

**Source:** `status.batteryLevelPercentage`, `status.isCharging`

---

#### Service: TemperatureSensor (OPTIONAL - v3 only)

Temperature reading from device sensor.

**Characteristics:**
- `CurrentTemperature` (GET) - Temperature in Celsius
- `StatusFault` (GET) - NO_FAULT (only shown when temperature available)
- `StatusActive` (GET) - Online/offline indicator

**Source:** `status.temperatureCelsius`  
**Availability:** `deviceModel.capabilities.hasTemperatureSensor`

---

#### Service: Lightbulb (subtype: "DayNightlight") - OPTIONAL - v3 only

Day mode nightlight color and brightness control (config-based).

**Characteristics:**
- `On` (GET/SET) - Turn nightlight on/off (off states: '0x000000', 'off')
- `Brightness` (GET/SET) - Screen brightness 0-100% (or 'auto')
- `Hue` (GET/SET) - Color hue 0-360° (derived from hex color)
- `Saturation` (GET/SET) - Color saturation 0-100% (derived from hex color)

**Source:** `config.ambientColour`, `config.dayDisplayBrightness`  
**Control:** `updateConfig({ ambientColour: '0xRRGGBB', dayDisplayBrightness: 'N' })`  
**Availability:** `deviceModel.capabilities.hasColoredNightlight`

**Color Conversion:** Uses `color-convert` library for hex ↔ HSV conversion

---

#### Service: Lightbulb (subtype: "NightNightlight") - OPTIONAL - v3 only

Night mode nightlight color and brightness control (config-based).

**Characteristics:**
- `On` (GET/SET) - Turn nightlight on/off (off states: '0x000000', 'off')
- `Brightness` (GET/SET) - Screen brightness 0-100% (or 'auto')
- `Hue` (GET/SET) - Color hue 0-360° (derived from hex color)
- `Saturation` (GET/SET) - Color saturation 0-100% (derived from hex color)

**Source:** `config.nightAmbientColour`, `config.nightDisplayBrightness`  
**Control:** `updateConfig({ nightAmbientColour: '0xRRGGBB', nightDisplayBrightness: 'N' })`  
**Availability:** `deviceModel.capabilities.hasColoredNightlight`

---

#### Service: ContactSensor (subtype: "NightlightActive") - OPTIONAL - v3 only

Shows if nightlight is currently active (live device state).

**Characteristics:**
- `ContactSensorState` (GET) - CONTACT_DETECTED when nightlight on
- `StatusActive` (GET) - Online/offline indicator

**Source:** `status.nightlightMode !== 'off'`  
**Availability:** `deviceModel.capabilities.hasColoredNightlight`

---

#### Service: ContactSensor (subtype: "DayNightlightActive") - OPTIONAL - v3 only

Shows if day nightlight is currently active and showing.

**Characteristics:**
- `ContactSensorState` (GET) - CONTACT_DETECTED when day mode + nightlight on
- `StatusActive` (GET) - Online/offline indicator

**Source:** `status.dayMode === 'day' && status.nightlightMode !== 'off'`  
**Availability:** `deviceModel.capabilities.hasColoredNightlight`

---

#### Service: ContactSensor (subtype: "NightNightlightActive") - OPTIONAL - v3 only

Shows if night nightlight is currently active and showing.

**Characteristics:**
- `ContactSensorState` (GET) - CONTACT_DETECTED when night mode + nightlight on
- `StatusActive` (GET) - Online/offline indicator

**Source:** `status.dayMode === 'night' && status.nightlightMode !== 'off'`  
**Availability:** `deviceModel.capabilities.hasColoredNightlight`

---

#### Service: ContactSensor (subtype: "CardSlot")

Shows if a card is currently inserted.

**Characteristics:**
- `ContactSensorState` (GET) - CONTACT_DETECTED when card present
- `StatusActive` (GET) - Online/offline indicator

**Source:** `status.cardInsertionState !== 'none'`

---

#### Service: OccupancySensor (subtype: "NightModeStatus")

Shows if device is in night mode (vs day mode).

**Characteristics:**
- `OccupancyDetected` (GET) - OCCUPANCY_DETECTED when in night mode
- `StatusActive` (GET) - Online/offline indicator

**Source:** `status.dayMode === 'night'`

**Use Case:** Trigger automations based on device's day/night schedule

---

#### Service: Switch (subtype: "SleepTimer")

Toggle sleep timer on/off.

**Characteristics:**
- `On` (GET/SET) - Sleep timer active state
- `StatusActive` (GET) - Online/offline indicator

**Source:** `playback.sleepTimerActive`  
**Control:** `sendCommand({ action: 'sleep-timer', minutes: 30 })` (on) or `minutes: 0` (off)

---

#### Service: Switch (subtype: "Bluetooth")

Toggle Bluetooth on/off (config-based, works offline).

**Characteristics:**
- `On` (GET/SET) - Bluetooth enabled state

**Source:** `config.bluetoothEnabled` (string '0' or '1')  
**Control:** `updateConfig({ bluetoothEnabled: '1' | '0' })`

**Note:** No StatusActive - config-based services work offline

---

#### Service: Fanv2 (subtype: "DayMaxVolume")

Control day mode maximum volume limit (config-based, works offline).

**Characteristics:**
- `Active` (GET) - Always ACTIVE
- `RotationSpeed` (GET/SET) - Volume limit 0-100%

**Source:** `config.maxVolumeLimit` (device: 0-16, HomeKit: 0-100%)  
**Control:** `updateConfig({ maxVolumeLimit: 'N' })`  
**Conversion:** `percentage = (limit / 16) * 100`

---

#### Service: Fanv2 (subtype: "NightMaxVolume")

Control night mode maximum volume limit (config-based, works offline).

**Characteristics:**
- `Active` (GET) - Always ACTIVE
- `RotationSpeed` (GET/SET) - Volume limit 0-100%

**Source:** `config.nightMaxVolumeLimit` (device: 0-16, HomeKit: 0-100%)  
**Control:** `updateConfig({ nightMaxVolumeLimit: 'N' })`  
**Conversion:** `percentage = (limit / 16) * 100`

---

#### Service: StatelessProgrammableSwitch (DYNAMIC) - NOT YET IMPLEMENTED

One service per shortcut configured on device. Trigger shortcuts from HomeKit.

**Characteristics:**
- `ProgrammableSwitchEvent` (READ/NOTIFY) - SINGLE_PRESS event
- `ServiceLabelIndex` (GET) - Index in shortcuts array

**Source:** `config.shortcuts.modes.day.content[]` and `config.shortcuts.modes.night.content[]`  
**Control:** `sendCommand({ action: 'play', shortcut: X })`

**Note:** Dynamic services - created based on device configuration

---

### Service Availability Matrix

| Service | v2 | v3 | mini |
|---------|----|----|------|
| AccessoryInformation | ✅ | ✅ | ✅ |
| SmartSpeaker | ✅ | ✅ | ✅ |
| Battery | ✅ | ✅ | ✅ |
| ContactSensor (CardSlot) | ✅ | ✅ | ✅ |
| OccupancySensor (NightMode) | ✅ | ✅ | ✅ |
| Switch (SleepTimer) | ✅ | ✅ | ✅ |
| Switch (Bluetooth) | ✅ | ✅ | ✅ |
| Fanv2 (Volume Limits) | ✅ | ✅ | ✅ |
| TemperatureSensor | ❌ | ✅ | ❌ |
| Lightbulb (Nightlights) | ❌ | ✅ | ❌ |
| ContactSensor (Nightlight Status) | ❌ | ✅ | ❌ |
| StatelessProgrammableSwitch | 🚧 | 🚧 | 🚧 |

---

## Offline Behavior

### What Gets Marked as "No Response"

Services are categorized by data source:

**Device State Services** (require online connection):
- SmartSpeaker (playback, volume)
- Battery (level, charging)
- TemperatureSensor (temperature)
- ContactSensor - all variants (card, nightlight status)
- OccupancySensor (night mode)
- Switch (SleepTimer) - reads playback state

**Config-Based Services** (work offline):
- Lightbulb (nightlight color/brightness)
- Fanv2 (volume limits)
- Switch (Bluetooth)
- StatelessProgrammableSwitch (shortcuts)

### Implementation

Device state services use `StatusActive` characteristic to indicate offline status. When `StatusActive` is false, HomeKit shows "No Response" for the service.

Config-based services do NOT have `StatusActive` and remain accessible when offline since they only read/write device configuration (cached in `deviceModel.config`).

---

## ❌ What's Left to Implement

### StatelessProgrammableSwitch Services (Shortcuts)

Dynamic services created based on `config.shortcuts` configuration.

**Implementation Notes:**
- Parse `config.shortcuts.modes.day.content[]` and `config.shortcuts.modes.night.content[]`
- Create one service per unique shortcut
- Handle shortcuts refresh when config changes
- Trigger with `sendCommand({ action: 'play', shortcut: X })`

**Complexity:** Dynamic service lifecycle management, shortcut identification

---

## API Reference Documentation

### YotoDeviceModel - State & Events

**State Properties:**
- `device` - Device metadata (deviceId, name, deviceType, etc.)
- `status` - Live device status (volume, battery, temperature, etc.)
- `config` - Device configuration (nightlight colors, volume limits, etc.)
- `shortcuts` - Configured shortcuts
- `playback` - Playback state (status, track, sleep timer, etc.)

**Events:**
- `statusUpdate(status, source, changedFields)` - Device status changed
- `configUpdate(config, changedFields)` - Configuration changed
- `playbackUpdate(playback, changedFields)` - Playback state changed
- `online({ reason })` - Device came online
- `offline({ reason })` - Device went offline

### Device API Endpoints

- `GET /devices` - List all devices
- `GET /devices/:deviceId/config` - Get device config
- `GET /devices/:deviceId/status` - Get device status
- `POST /devices/:deviceId/config` - Update device config
- `POST /devices/:deviceId/mq` - Send device command

### Command Examples

```javascript
// Playback control
await deviceModel.sendCommand({ action: 'play' })
await deviceModel.sendCommand({ action: 'pause' })
await deviceModel.sendCommand({ action: 'stop' })

// Volume control
await deviceModel.sendCommand({ action: 'volume', volume: 10 })

// Sleep timer
await deviceModel.sendCommand({ action: 'sleep-timer', minutes: 30 })
```

### Config Update Examples

```javascript
// Nightlight colors
await deviceModel.updateConfig({ ambientColour: '0xff5733' })
await deviceModel.updateConfig({ nightAmbientColour: '0x3366ff' })

// Volume limits
await deviceModel.updateConfig({ maxVolumeLimit: '12' })
await deviceModel.updateConfig({ nightMaxVolumeLimit: '8' })

// Bluetooth
await deviceModel.updateConfig({ bluetoothEnabled: '1' })
```

---

## Testing Checklist

### Basic Functionality
- [ ] Device discovery and accessory creation
- [ ] Playback control (play/pause/stop)
- [ ] Volume control (0-16 range)
- [ ] Battery status updates
- [ ] Online/offline detection
- [ ] Firmware version display

### Optional Services
- [ ] Temperature sensor (v3 only)
- [ ] Nightlight color control (v3 only)
- [ ] Nightlight brightness control (v3 only)
- [ ] Nightlight status sensors (v3 only)
- [ ] Card slot detection (all devices)
- [ ] Night mode detection (all devices)
- [ ] Sleep timer control (all devices)
- [ ] Bluetooth toggle (all devices)
- [ ] Volume limit controls (all devices)

### Edge Cases
- [ ] Device goes offline during operation
- [ ] MQTT disconnection with HTTP fallback
- [ ] Multiple devices in one account
- [ ] Device rename handling
- [ ] Config changes from Yoto app

### Automations
- [ ] Trigger on card insertion
- [ ] Trigger on night mode change
- [ ] Trigger on nightlight activation
- [ ] Volume limit changes based on time
- [ ] Sleep timer activation