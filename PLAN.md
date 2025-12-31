# Homebridge Yoto Plugin - Implementation Status

## ✅ What's Implemented

### Architecture
- ✅ Platform plugin using `yoto-nodejs-client` for device management
- ✅ One bridged accessory per Yoto device, optional external SmartSpeaker accessory when `services.playbackAccessory=external`
- ✅ External SmartSpeaker uses a dedicated accessory handler and is published once per runtime
- ✅ Real-time updates via MQTT + periodic HTTP polling fallback
- ✅ Offline detection and "No Response" status handling
- ✅ Capability-based service registration (v2/v3/mini device support)
- ✅ Config-driven service exposure via `services` options

### Core Services (Always Present)
- ✅ **AccessoryInformation** - Device metadata (manufacturer, model, serial, firmware)
- ✅ **ContactSensor (Online Status)** - Online/offline state (PRIMARY)
- ✅ **Battery** - Battery level, charging state, low battery indicator

### Configurable Services (Toggle + Capability)
- ✅ **Switch (Playback)** - Playback switch (bridged mode only)
- ✅ **Lightbulb (Volume)** - Volume + mute controls (bridged mode only)
- ✅ **TemperatureSensor** - Temperature reading (v3 only, toggle)
- ✅ **Lightbulb (DayNightlight)** - Day nightlight color/brightness (v3 only, toggle)
- ✅ **Lightbulb (NightNightlight)** - Night nightlight color/brightness (v3 only, toggle)
- ✅ **ContactSensor (NightlightActive)** - Live nightlight status (v3 only, toggle)
- ✅ **ContactSensor (DayNightlightActive)** - Day nightlight status (v3 only, toggle)
- ✅ **ContactSensor (NightNightlightActive)** - Night nightlight status (v3 only, toggle)
- ✅ **ContactSensor (CardSlot)** - Card insertion detection (toggle)
- ✅ **Switch (CardControl)** - Plays a configured card ID (toggle)
- ✅ **ContactSensor (DayMode)** - Day/night mode indicator (toggle)
- ✅ **Switch (SleepTimer)** - Toggle sleep timer (toggle)
- ✅ **Switch (Bluetooth)** - Toggle Bluetooth on/off (toggle)
- ✅ **Lightbulb (DayMaxVolume)** - Day mode max volume limit (toggle)
- ✅ **Lightbulb (NightMaxVolume)** - Night mode max volume limit (toggle)

### External Accessories (Optional)
- ✅ **SmartSpeaker** - External SmartSpeaker accessory when `services.playbackAccessory=external`

### Additional Accessories (Optional)
- ✅ **Card Control (All Yotos)** - Separate accessory per card control when `playOnAll` is enabled

## Service & Characteristic Reference

All services are named consistently using `generateServiceName()` helper: `"[Device Name] [Service Name]"`

### Yoto Player Accessory (Bridged)

Each Yoto device is represented as a bridged HomeKit accessory. Playback controls are exposed on this accessory only when `services.playbackAccessory=bridged`.

**Category**: `SPEAKER`

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

#### Service: ContactSensor (subtype: "OnlineStatus") (PRIMARY)

Online/offline indicator for the device.

**Characteristics:**
- `ContactSensorState` (GET) - CONTACT_NOT_DETECTED when online, CONTACT_DETECTED when offline

**Source:** `status.isOnline`

---

#### Service: Switch (subtype: "Playback") - OPTIONAL (bridged)

Play/pause control.

**Characteristics:**
- `On` (GET/SET) - On = playing, Off = paused

**Source:** `playback.playbackStatus`  
**Control:** `resumeCard()` / `pauseCard()`

---

#### Service: Lightbulb (subtype: "Volume") - OPTIONAL (bridged)

Volume and mute control.

**Characteristics:**
- `On` (GET/SET) - Mute/unmute
- `Brightness` (GET/SET) - Volume level 0-100%

**Source:** `status.volume`  
**Control:** `setVolume(steps)`  
**Conversion:** `percent = (steps / 16) * 100`

---

#### Service: Battery

Battery status information.

**Characteristics:**
- `BatteryLevel` (GET) - Battery percentage (0-100)
- `ChargingState` (GET) - CHARGING or NOT_CHARGING
- `StatusLowBattery` (GET) - LOW when ≤20%, NORMAL otherwise

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
- `ContactSensorState` (GET) - CONTACT_NOT_DETECTED when nightlight on
- `StatusActive` (GET) - Online/offline indicator

**Source:** `status.nightlightMode !== 'off'`  
**Availability:** `deviceModel.capabilities.hasColoredNightlight`

---

#### Service: ContactSensor (subtype: "DayNightlightActive") - OPTIONAL - v3 only

Shows if day nightlight is currently active and showing.

**Characteristics:**
- `ContactSensorState` (GET) - CONTACT_NOT_DETECTED when day mode + nightlight on
- `StatusActive` (GET) - Online/offline indicator

**Source:** `status.dayMode === 'day' && status.nightlightMode !== 'off'`  
**Availability:** `deviceModel.capabilities.hasColoredNightlight`

---

#### Service: ContactSensor (subtype: "NightNightlightActive") - OPTIONAL - v3 only

Shows if night nightlight is currently active and showing.

**Characteristics:**
- `ContactSensorState` (GET) - CONTACT_NOT_DETECTED when night mode + nightlight on
- `StatusActive` (GET) - Online/offline indicator

**Source:** `status.dayMode === 'night' && status.nightlightMode !== 'off'`  
**Availability:** `deviceModel.capabilities.hasColoredNightlight`

---

#### Service: ContactSensor (subtype: "CardSlot")

Shows if a card is currently inserted.

**Characteristics:**
- `ContactSensorState` (GET) - CONTACT_NOT_DETECTED when card present
- `StatusActive` (GET) - Online/offline indicator

**Source:** `status.cardInsertionState !== 'none'`

---

#### Service: ContactSensor (subtype: "DayMode")

Shows if device is in day mode (vs night mode).

**Characteristics:**
- `ContactSensorState` (GET) - CONTACT_NOT_DETECTED when in day mode
- `StatusActive` (GET) - Online/offline indicator

**Source:** `status.dayMode === 'day'`

---

#### Service: Switch (subtype: "SleepTimer")

Toggle sleep timer on/off.

**Characteristics:**
- `On` (GET/SET) - Sleep timer active state

**Source:** `playback.sleepTimerActive`  
**Control:** `setSleepTimer(30 * 60)` (on) or `setSleepTimer(0)` (off)

---

#### Service: Switch (subtype: "CardControl:<id>")

Plays a configured card ID on the device.

**Characteristics:**
- `On` (GET/SET) - Trigger card playback; resets to Off

**Source:** `services.cardControls[]`  
**Control:** `startCard({ cardId: "<cardId>" })`

---

#### Service: Switch (subtype: "Bluetooth")

Toggle Bluetooth on/off (config-based, works offline).

**Characteristics:**
- `On` (GET/SET) - Bluetooth enabled state

**Source:** `config.bluetoothEnabled` (boolean)  
**Control:** `updateConfig({ bluetoothEnabled: true | false })`

**Note:** No StatusActive - config-based services work offline

---

#### Service: Lightbulb (subtype: "DayMaxVolume")

Control day mode maximum volume limit (config-based, works offline).

**Characteristics:**
- `On` (GET/SET) - Always true
- `Brightness` (GET/SET) - Volume limit 0-100%

**Source:** `config.maxVolumeLimit` (device: 0-16, HomeKit: 0-100%)  
**Control:** `updateConfig({ maxVolumeLimit: N })`  
**Conversion:** `percentage = (limit / 16) * 100`

---

#### Service: Lightbulb (subtype: "NightMaxVolume")

Control night mode maximum volume limit (config-based, works offline).

**Characteristics:**
- `On` (GET/SET) - Always true
- `Brightness` (GET/SET) - Volume limit 0-100%

**Source:** `config.nightMaxVolumeLimit` (device: 0-16, HomeKit: 0-100%)  
**Control:** `updateConfig({ nightMaxVolumeLimit: N })`  
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

### External SmartSpeaker Accessory (Optional)

Published when `services.playbackAccessory=external`. This accessory is separate from the bridged device accessory, requires pairing, and replaces the bridged playback/volume services.

#### Service: AccessoryInformation (Required)

Same characteristics as the bridged accessory.

---

#### Service: SmartSpeaker (PRIMARY)

Controls playback and volume on the external accessory.

**Characteristics:**
- `CurrentMediaState` (GET) - PLAY/PAUSE/STOP based on playback status
- `TargetMediaState` (GET/SET) - Control playback (play/pause/stop; stop maps to pause)
- `Volume` (GET/SET) - Volume level 0-100% (mapped to 0-16 steps)
- `Mute` (GET/SET) - Mute state (derived from volume === 0)
- `StatusActive` (GET) - Online/offline indicator

**Source:** `status.volume`, `playback.playbackStatus`  
**Control:** `resumeCard()` / `pauseCard()` / `setVolume(steps)`

---

### Card Control Accessory (All Yotos)

Published for any card control with `playOnAll=true`. This accessory is bridged and provides a single switch to play the configured card on every online device.

#### Service: AccessoryInformation (Required)

Standard HomeKit service providing accessory metadata.

---

#### Service: Switch (PRIMARY)

Plays a configured card ID on all online devices when toggled.

**Characteristics:**
- `On` (GET/SET) - Trigger card playback; resets to Off

**Control:** `startCard({ cardId: "<cardId>" })` on each online device

---

### Service Availability Matrix

| Service | v2 | v3 | mini | Notes |
|---------|----|----|------|-------|
| AccessoryInformation | ✅ | ✅ | ✅ | Main accessory |
| ContactSensor (Online Status) | ✅ | ✅ | ✅ | Main accessory |
| Battery | ✅ | ✅ | ✅ | Main accessory |
| Switch (Playback) | ✅ | ✅ | ✅ | `playbackAccessory=bridged` |
| Lightbulb (Volume) | ✅ | ✅ | ✅ | `playbackAccessory=bridged` |
| SmartSpeaker (external) | ✅ | ✅ | ✅ | `playbackAccessory=external` |
| ContactSensor (CardSlot) | ✅ | ✅ | ✅ | Toggle |
| Switch (Card Control) | ✅ | ✅ | ✅ | `services.cardControls[]` |
| Switch (Card Control - All Yotos) | ✅ | ✅ | ✅ | `services.cardControls[].playOnAll` |
| ContactSensor (DayMode) | ✅ | ✅ | ✅ | Toggle |
| Switch (SleepTimer) | ✅ | ✅ | ✅ | Toggle |
| Switch (Bluetooth) | ✅ | ✅ | ✅ | Toggle |
| Lightbulb (Volume Limits) | ✅ | ✅ | ✅ | Toggle |
| TemperatureSensor | ❌ | ✅ | ❌ | Toggle + capability |
| Lightbulb (Nightlights) | ❌ | ✅ | ❌ | Toggle + capability |
| ContactSensor (Nightlight Status) | ❌ | ✅ | ❌ | Toggle + capability |
| StatelessProgrammableSwitch | 🚧 | 🚧 | 🚧 | Not implemented |

---

## Offline Behavior

### What Gets Marked as "No Response"

Services are categorized by data source and whether they expose `StatusActive`.

**Device State Services with StatusActive** (show No Response when offline):
- TemperatureSensor
- ContactSensor variants (card slot, day mode, nightlight status)
- SmartSpeaker (external accessory)

**Device State Services without StatusActive**:
- ContactSensor (Online Status) uses ContactSensorState to show online/offline
- Switch (Playback) and Lightbulb (Volume) in bridged mode
- Battery
- Switch (SleepTimer)
- Switch (Card Control) (per device and All Yotos)

**Config-Based Services** (work offline):
- Lightbulb (nightlight color/brightness)
- Lightbulb (volume limits)
- Switch (Bluetooth)
- StatelessProgrammableSwitch (shortcuts)

### Implementation

Device state services that support `StatusActive` are updated from `status.isOnline`. The Online Status contact sensor flips state when the device goes offline.

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
await deviceModel.resumeCard()
await deviceModel.pauseCard()

// Volume control
await deviceModel.setVolume(10)

// Sleep timer
await deviceModel.setSleepTimer(30 * 60)
```

### Config Update Examples

```javascript
// Nightlight colors
await deviceModel.updateConfig({ ambientColour: '0xff5733' })
await deviceModel.updateConfig({ nightAmbientColour: '0x3366ff' })

// Volume limits
await deviceModel.updateConfig({ maxVolumeLimit: 12 })
await deviceModel.updateConfig({ nightMaxVolumeLimit: 8 })

// Bluetooth
await deviceModel.updateConfig({ bluetoothEnabled: true })
```

---

## Testing Checklist

### Basic Functionality
- [ ] Device discovery and accessory creation
- [ ] Playback control (bridged + external)
- [ ] Volume control (bridged + external)
- [ ] External SmartSpeaker pairing (when enabled)
- [ ] Battery status updates
- [ ] Online/offline detection
- [ ] Firmware version display

### Optional Services
- [ ] Temperature sensor (v3 only)
- [ ] Nightlight color control (v3 only)
- [ ] Nightlight brightness control (v3 only)
- [ ] Nightlight status sensors (v3 only)
- [ ] Card slot detection (all devices)
- [ ] Card control switches (per device)
- [ ] Card control (All Yotos) accessory
- [ ] Day mode detection (all devices)
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
- [ ] Trigger on day mode change
- [ ] Trigger on nightlight activation
- [ ] Volume limit changes based on time
- [ ] Sleep timer activation
