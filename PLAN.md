# Homebridge Yoto Plugin - Architecture Plan

## Overview

This plugin creates HomeKit accessories for Yoto Player smart speakers, providing full control over playback, volume, ambient lighting, battery status, and device settings through the Home app.

---

## Accessory Type

### Primary Accessory
- **Category:** `Categories.SPEAKER`
- **Publishing Method:** `api.publishExternalAccessories()` (required for SmartSpeaker service)
- **One accessory per Yoto Player device**

---

## Service & Characteristic Hierarchy

### Yoto Player Accessory
- **Category:** `SPEAKER`
- **Name:** `{device.name}` (e.g., "Living Room Yoto")

#### Service: AccessoryInformation (Required)
- **Manufacturer:** "Yoto"
- **Model:** `{deviceType}` (e.g., "Yoto Player Mini")
- **SerialNumber:** `{deviceId}`
- **FirmwareRevision:** `{from device info}`
- **Name:** `{device.name}`

#### Service: SmartSpeaker (PRIMARY)
- **CurrentMediaState** (READ-ONLY)
  - Values: 0=PLAY, 1=PAUSE, 2=STOP, 4=INTERRUPTED
  - Source: MQTT events (activeCard presence)
- **TargetMediaState** (READ/WRITE)
  - Values: 0=PLAY, 1=PAUSE, 2=STOP
  - Action: `startCard()`, `pauseCard()`, `stopCard()`
- **Volume** (READ/WRITE, 0-100)
  - Source: `status.userVolumePercentage`
  - Action: `setVolume()` via MQTT
- **Mute** (READ/WRITE, boolean)
  - Derived: `volume === 0`
  - Action: `setVolume(0)` or restore previous
- **ConfiguredName** (READ/WRITE)
  - Value: `device.name`

#### Service: Battery
- **BatteryLevel** (READ-ONLY, 0-100)
  - Source: `status.batteryLevelPercentage`
- **ChargingState** (READ-ONLY)
  - Values: 0=NOT_CHARGING, 1=CHARGING
  - Source: `status.isCharging`
- **StatusLowBattery** (READ-ONLY)
  - Values: 0=NORMAL, 1=LOW (when < 20%)
  - Source: `status.batteryLevelPercentage`

#### Service: Fanv2 (subtype: "DayMaxVolume")
- **Active** (READ-ONLY)
  - Always ACTIVE (just a slider control)
- **RotationSpeed** (READ/WRITE, 0-100)
  - Represents: Day maximum volume limit
  - Source: `deviceConfig.maxVolumeLimit`
  - Action: `updateDeviceConfig({ maxVolumeLimit })`
- **Name:** "Day Max Volume"

#### Service: Fanv2 (subtype: "NightMaxVolume")
- **Active** (READ-ONLY)
  - Always ACTIVE (just a slider control)
- **RotationSpeed** (READ/WRITE, 0-100)
  - Represents: Night maximum volume limit
  - Source: `deviceConfig.nightMaxVolumeLimit`
  - Action: `updateDeviceConfig({ nightMaxVolumeLimit })`
- **Name:** "Night Max Volume"

#### Service: Lightbulb (subtype: "DayAmbient")
- **On** (READ/WRITE, boolean)
  - Controls: Day ambient light enable/disable
- **Brightness** (READ/WRITE, 0-100)
  - Source: `deviceConfig.dayDisplayBrightness`
  - Action: `updateDeviceConfig({ dayDisplayBrightness })`
- **Hue** (READ/WRITE, 0-360)
  - Source: `deviceConfig.ambientColour` (hex → HSV)
  - Action: `setAmbientHex()` after HSV → hex conversion
- **Saturation** (READ/WRITE, 0-100)
  - Source: `deviceConfig.ambientColour` (hex → HSV)
  - Action: `setAmbientHex()` after HSV → hex conversion
- **Name:** "Day Ambient Light"

#### Service: Lightbulb (subtype: "NightAmbient")
- **On** (READ/WRITE, boolean)
  - Controls: Night ambient light enable/disable
- **Brightness** (READ/WRITE, 0-100)
  - Source: `deviceConfig.nightDisplayBrightness`
  - Action: `updateDeviceConfig({ nightDisplayBrightness })`
- **Hue** (READ/WRITE, 0-360)
  - Source: `deviceConfig.nightAmbientColour` (hex → HSV)
  - Action: `setAmbientHex()` after HSV → hex conversion
- **Saturation** (READ/WRITE, 0-100)
  - Source: `deviceConfig.nightAmbientColour` (hex → HSV)
  - Action: `setAmbientHex()` after HSV → hex conversion
- **Name:** "Night Ambient Light"

#### Service: TemperatureSensor (OPTIONAL)
- **CurrentTemperature** (READ-ONLY, °C)
  - Source: `status.temperatureCelcius`
  - Only exposed if !== "notSupported"
- **StatusFault** (READ-ONLY)
  - Values: 0=NO_FAULT (online), 1=GENERAL_FAULT (offline)
  - Source: `device.online`

#### Service: ContactSensor (subtype: "CardSlot")
- **ContactSensorState** (READ-ONLY)
  - Values: 0=CONTACT_DETECTED, 1=CONTACT_NOT_DETECTED
  - Source: `status.cardInsertionState`
  - Logic: 0=no card, 1=physical card, 2=remote card
- **Name:** "Card Inserted"

#### Service: Switch (subtype: "SleepTimer")
- **On** (READ/WRITE, boolean)
  - GET: Check if sleep timer active
  - SET true: `setSleepTimer(30)` - default 30 min
  - SET false: `setSleepTimer(0)` - cancel timer
- **Name:** "Sleep Timer"

#### Service: OccupancySensor (subtype: "NightModeStatus")
- **OccupancyDetected** (READ-ONLY)
  - Value: `status.dayMode === 0` (OCCUPANCY_DETECTED when in night mode)
  - Source: `status.dayMode` (-1=unknown, 0=night, 1=day)
  - Purpose: Indicates current day/night mode state for automations
- **Name:** "Night Mode Active"
- **Note:** Day/Night mode is automatic based on configured schedule times (`dayTime` and `nightTime` in device config). There is no API to manually override the mode. Users must adjust schedule times via the Yoto app.

#### Service: Switch (subtype: "Bluetooth")
- **On** (READ/WRITE, boolean)
  - GET: `deviceConfig.bluetoothEnabled`
  - SET: `bluetoothOn()` / `bluetoothOff()`
- **Name:** "Bluetooth"

#### Service: StatelessProgrammableSwitch (DYNAMIC - per shortcut)
- **ProgrammableSwitchEvent** (NOTIFY-ONLY)
  - Value: 0=SINGLE_PRESS (triggers the shortcut)
- **ServiceLabelIndex** (READ-ONLY)
  - Position in shortcut list
- **Name:** `{shortcut.name}`
  - Examples: "Toothbrush Timer", "Tidy Up Timer"
  - Source: Device shortcuts configuration
  - Action: Trigger via `sendDeviceCommand()` or shortcuts API

---

## Data Sources

### Yoto API Endpoints
- **`getDevices()`** - Device discovery and metadata
- **`getDeviceStatus({ deviceId })`** - Real-time device status
- **`getDeviceConfig({ deviceId })`** - Device configuration/settings
- **`updateDeviceConfig({ deviceId, configUpdate })`** - Update settings
- **`sendDeviceCommand({ deviceId, command })`** - Send control commands

### MQTT Real-Time Updates
- **Events Topic** (`device/{id}/events`, `device/{id}/data/events`)
  - Playback state changes
  - Track changes
  - Card insertion/removal
  
- **Status Topic** (`device/{id}/status`, `device/{id}/data/status`)
  - Battery level updates
  - Charging state changes
  - Volume changes
  - Temperature updates
  - Device configuration changes
  
- **Response Topic** (`device/{id}/response`)
  - Command confirmations

---

## Configuration Options

### Platform Config (`config.json`)

```json
{
  "platform": "YotoPlayer",
  "name": "Yoto Player",
  "clientId": "your-client-id",
  "refreshToken": "your-refresh-token",
  "accessToken": "auto-refreshed-token",
  "pollingInterval": 60,
  "enableMqtt": true,
  "exposeShortcuts": true,
  "exposeTemperatureSensor": true,
  "exposeAmbientLights": true,
  "exposeMaxVolumeControls": true
}
```

### Configuration Properties

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `clientId` | string | **required** | Yoto API Client ID |
| `refreshToken` | string | **required** | OAuth2 refresh token |
| `accessToken` | string | auto | OAuth2 access token (auto-refreshed) |
| `pollingInterval` | number | 60 | Seconds between status polls (fallback when MQTT unavailable) |
| `enableMqtt` | boolean | true | Use MQTT for real-time updates |
| `exposeShortcuts` | boolean | true | Show timer shortcuts as switches |
| `exposeTemperatureSensor` | boolean | true | Show device temperature sensor |
| `exposeAmbientLights` | boolean | true | Show ambient light controls |
| `exposeMaxVolumeControls` | boolean | true | Show day/night max volume controls |

---

## State Management

### Architecture: MQTT-First with HTTP Fallback

**Primary State Source:** MQTT real-time messages (automatic every 30s + on-demand)
**Fallback:** HTTP API polling for device discovery only (every 5 minutes)

### MQTT Connection Behavior

- ✅ **Can connect to offline devices** - Connection always succeeds
- ❌ **Offline devices never respond** - No status, events, or responses
- ✅ **Online devices respond immediately** - Status within milliseconds
- ⚠️ **No errors on offline connection** - Must use timeout to detect unresponsive devices

### Caching Strategy

```typescript
class YotoPlayerAccessory {
  private cachedState = {
    // Online/offline tracking
    online: false,           // Updated from MQTT response timeout
    lastSeen: 0,            // Timestamp of last MQTT message
    
    // From MQTT 'status' messages (automatic every 30s)
    volume: 0,
    batteryLevel: 100,
    charging: false,
    temperature: 20,
    cardInserted: false,
    dayMode: true,
    
    // From MQTT 'events' messages (real-time)
    isPlaying: false,
    currentCard: null,
    currentTrack: null,
    playbackStatus: 'stopped',
    
    // From HTTP API (on discovery)
    device: null,
    config: null,
  };
}
```

### Update Flow

#### 1. Device Discovery (HTTP API - Every 5 Minutes)
```
Platform polls HTTP /devices endpoint
       ↓
Add new devices / Remove deleted devices
       ↓
Each device creates MQTT connection
```

#### 2. MQTT Real-Time Updates (Primary State Source)
```
MQTT 'events' message received (real-time)
       ↓
Update cachedState (playback, card, track)
       ↓
Update HomeKit characteristics
       ↓
Home app shows changes instantly

MQTT 'status' message received (every 30s automatic)
       ↓
Update cachedState (volume, battery, temp, etc.)
       ↓
Update HomeKit characteristics
       ↓
Mark device as online (lastSeen = now)
```

#### 3. Offline Device Detection
```
MQTT connection succeeds
       ↓
Request immediate status
       ↓
Set 10-second timeout
       ↓
If no response → Mark device offline
       ↓
Throw SERVICE_COMMUNICATION_FAILURE in GET handlers
```

#### 4. HomeKit GET Handlers (Fast)
```
HomeKit requests characteristic value
       ↓
Check if device online
       ↓
If offline: Throw HapStatusError
       ↓
If online: Return cached value instantly
```

#### 5. HomeKit SET Handlers (MQTT Commands)
```
HomeKit sends new value
       ↓
Send MQTT command (setVolume, pauseCard, etc.)
       ↓
Optimistically update cachedState
       ↓
Update HomeKit characteristic immediately
       ↓
MQTT 'status' or 'events' confirms change
```

### Important Notes

- **MQTT status is authoritative** - HTTP API may lag behind device state
- **Volume limits are enforced** - Device clamps volume to day/night max
- **MQTT commands return OK** - Even if clamped or limited by config
- **Don't verify via HTTP API** - Commands accepted by MQTT won't immediately show in HTTP API
- **Automatic status every 30s** - No need for polling state
- **Request immediate status** - Call `mqtt.requestStatus()` for instant update

---

## Error Handling

### Offline Device Detection

```typescript
private async initializeMqtt() {
  this.mqttClient = await this.platform.yotoClient.createMqttClient({
    deviceId: this.device.deviceId,
  });
  
  this.mqttClient.on('connected', async () => {
    // Request immediate status
    await this.mqttClient.requestStatus();
    
    // Set 10-second timeout to detect offline devices
    this.statusTimeout = setTimeout(() => {
      if (!this.cachedState.online) {
        this.log.warn('Device appears offline - no MQTT response');
        this.markDeviceOffline();
      }
    }, 10000);
  });
  
  this.mqttClient.on('status', (message) => {
    // Clear timeout - device is responsive
    if (this.statusTimeout) {
      clearTimeout(this.statusTimeout);
    }
    
    // Mark online
    this.cachedState.online = true;
    this.cachedState.lastSeen = Date.now();
    
    // Update characteristics
    this.handleMqttStatus(message);
  });
}
```

### Offline Device Handling

**GET Handlers:**
```typescript
.onGet(() => {
  if (!this.cachedState.online) {
    throw new this.platform.api.hap.HapStatusError(
      this.platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE
    );
  }
  return this.cachedState.volume;
});
```

**SET Handlers:**
```typescript
.onSet(async (value) => {
  if (!this.mqttClient || !this.cachedState.online) {
    throw new this.platform.api.hap.HapStatusError(
      this.platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE
    );
  }
  await this.mqttClient.setVolume(value);
  this.cachedState.volume = value; // Optimistic update
});
```

**StatusActive Characteristic:**

The `StatusActive` characteristic is used to indicate whether a service/sensor is currently reachable:
- Format: `BOOL` (true/false)
- Permissions: `READ`, `NOTIFY`
- Shows as "Not Responding" in Home app when `false`
- Should be added to all services that can go offline

```typescript
private configureServices() {
  // Add StatusActive to services
  this.smartSpeakerService
    .addOptionalCharacteristic(this.platform.Characteristic.StatusActive);
  
  this.batteryService
    ?.addOptionalCharacteristic(this.platform.Characteristic.StatusActive);
  
  this.temperatureSensorService
    ?.addOptionalCharacteristic(this.platform.Characteristic.StatusActive);
  
  // Set GET handler
  this.smartSpeakerService
    .getCharacteristic(this.platform.Characteristic.StatusActive)
    .onGet(() => this.cachedState.online);
  
  // Initialize to current online state
  this.updateOnlineStatus(this.cachedState.online);
}

private markDeviceOffline() {
  this.cachedState.online = false;
  this.updateOnlineStatus(false);
}

private handleMqttStatus(message) {
  this.cachedState.online = true;
  this.cachedState.lastSeen = Date.now();
  this.updateOnlineStatus(true);
  // ... update other characteristics
}

private updateOnlineStatus(online: boolean) {
  // Update StatusActive on all services
  this.smartSpeakerService?.updateCharacteristic(
    this.platform.Characteristic.StatusActive,
    online
  );
  
  this.batteryService?.updateCharacteristic(
    this.platform.Characteristic.StatusActive,
    online
  );
  
  this.temperatureSensorService?.updateCharacteristic(
    this.platform.Characteristic.StatusActive,
    online
  );
  
  // Update CardSlot, ambient lights, etc.
}
```

### MQTT Connection Issues

**Auto-Reconnect:**
- MQTT client handles reconnection automatically
- `autoResubscribe: true` ensures topics are restored
- Listen for `reconnecting` event to log state

**Connection Errors:**
```typescript
this.mqttClient.on('error', (error) => {
  this.log.error('MQTT error:', error);
  this.markDeviceOffline();
});

this.mqttClient.on('close', () => {
  this.log.warn('MQTT disconnected, will auto-reconnect');
  this.markDeviceOffline();
});
```

### API Failures

**HTTP Discovery Failures:**
- Log error but don't crash
- Keep existing accessories active
- Retry on next polling interval (5 min)

**Token Refresh:**
- Automatic via `onTokenRefresh` callback
- Update config file with new tokens
- MQTT will auto-reconnect with new token

### Volume Limit Handling

**Device enforces limits based on day/night mode:**
- Day mode: `maxVolumeLimit` (typically 13 = 86%)
- Night mode: `nightMaxVolumeLimit` (typically 6 = 40%)
- Commands are clamped silently by device
- MQTT returns `OK` even if value clamped

**HomeKit should reflect actual limits:**
```typescript
// Update maxValue based on current mode
const maxVolume = this.cachedState.dayMode 
  ? this.config.maxVolumeLimit 
  : this.config.nightMaxVolumeLimit;

this.service.getCharacteristic(Characteristic.Volume)
  .setProps({ maxValue: maxVolume });
```

---

## Implementation Notes

### Color Conversion
Yoto uses hex colors (`#RRGGBB`), HomeKit uses HSV:
- **Hex → HSV:** For GET operations
- **HSV → Hex:** For SET operations
- Use existing color conversion utilities

### Volume Limits
- Current volume respects max volume limits
- Day/night limits switch automatically based on dayMode
- Max volume controls adjust upper bound, not current volume

### Timer Shortcuts
- Dynamically discovered from device config
- Created as StatelessProgrammableSwitch services
- Each shortcut is a separate service with unique subtype
- Trigger via button press in Home app

### Day/Night Mode
- Day/Night mode is **automatic** based on configured schedule times
- `status.dayMode` indicates current state: -1=unknown, 0=night, 1=day
- Schedule times in `deviceConfig`: `dayTime` (e.g., "07:30"), `nightTime` (e.g., "19:30")
- No API exists to manually override/toggle the mode
- OccupancySensor provides read-only status for automations
- Users adjust schedule times via Yoto app only

### External Accessory Publishing
- **Must use** `api.publishExternalAccessories()`
- **Cannot use** `api.registerPlatformAccessories()`
- SmartSpeaker service requires external accessory pattern
- User must manually add accessory in Home app

---

## Future Enhancements (Post-MVP)

### Potential Additions
- [ ] Family Library integration
- [ ] Content browsing/selection via InputSource
- [ ] Playlist management
- [ ] Historical playback data
- [ ] Multiple Yoto Player support
- [ ] Custom timer duration configuration
- [ ] HomeKit automations triggers (e.g., "When card inserted")

### Not Planned
- ❌ Audio streaming (not supported by Yoto API)
- ❌ Direct content upload (requires app)
- ❌ User account management
- ❌ Multiple family profiles

---

## References

### Documentation
- [Yoto API Documentation](https://yoto.dev/api/)
- [Yoto MQTT Documentation](https://yoto.dev/players-mqtt/)
- [HomeKit Accessory Protocol (HAP)](https://developer.apple.com/homekit/)
- [Homebridge Plugin Development](https://developers.homebridge.io/)

### Example Plugins
- [homebridge-homepod-radio](https://github.com/paolotremadio/homebridge-homepod-radio) - SmartSpeaker reference
- [homebridge-virtual-accessories](https://github.com/Domi04151309/homebridge-virtual-accessories) - Service patterns

### Libraries
- [yoto-nodejs-client](https://github.com/bretep/yoto-nodejs-client) - Yoto API client
- [homebridge](https://github.com/homebridge/homebridge) - Platform framework
- [HAP-NodeJS](https://github.com/homebridge/HAP-NodeJS) - HomeKit protocol

---

## Device Capability Detection

### Device Types & Capabilities

Yoto devices have different capabilities based on their type, generation, and form factor. Services should be created conditionally based on device capabilities.

#### Device Metadata

From `YotoDevice` response:
```typescript
{
  deviceId: string,
  name: string,
  deviceType: string,        // e.g., "player", "mini"
  deviceFamily: string,      // e.g., "yoto-player"
  deviceGroup: string,       // e.g., "player"
  generation?: string,       // e.g., "gen3"
  formFactor?: string       // e.g., "standard", "mini"
}
```

#### Known Device Types

| Device Type | Form Factor | Temperature Sensor | Ambient Light | Display | Notes |
|-------------|-------------|-------------------|---------------|---------|-------|
| Yoto Player (Gen 3) | standard | ✅ | ✅ | Full | Original player |
| Yoto Mini | mini | ❌ | ❌ | Minimal | Compact version, no sensors |
| Yoto Player (Gen 2) | standard | ✅ | ✅ | Full | Older generation |

### Capability Detection Strategy

#### 1. Check Device Status Response

```typescript
async function detectCapabilities(deviceId: string): DeviceCapabilities {
  const status = await getDeviceStatus({ deviceId });
  
  return {
    hasTemperatureSensor: status.temperatureCelcius !== undefined && 
                          status.temperatureCelcius !== "notSupported",
    hasAmbientLightSensor: status.ambientLightSensorReading !== undefined,
    hasBattery: status.batteryLevelPercentage !== undefined,
    hasCardSlot: status.cardInsertionState !== undefined,
    supportsBluetooth: status.isBluetoothAudioConnected !== undefined
  };
}
```

#### 2. Form Factor Detection

```typescript
function detectFormFactor(device: YotoDevice): string {
  // Explicit form factor
  if (device.formFactor) {
    return device.formFactor; // 'standard', 'mini'
  }
  
  // Fallback: check device type
  if (device.deviceType?.toLowerCase().includes('mini')) {
    return 'mini';
  }
  
  return 'standard';
}
```

#### 3. Service Creation Logic

```typescript
class YotoPlayerAccessory {
  private capabilities: DeviceCapabilities;
  
  async initialize() {
    // Detect capabilities on startup
    this.capabilities = await this.detectCapabilities();
    
    // Always create core services
    this.createCoreServices();
    
    // Conditionally create optional services
    if (this.capabilities.hasTemperatureSensor) {
      this.createTemperatureSensorService();
    }
    
    if (this.capabilities.hasAmbientLightSensor) {
      this.createAmbientLightServices();
    }
    
    if (this.config.exposeMaxVolumeControls) {
      this.createMaxVolumeServices();
    }
    
    if (this.config.exposeShortcuts) {
      await this.createShortcutServices();
    }
  }
  
  private createCoreServices() {
    // These are ALWAYS created
    this.createAccessoryInformation();
    this.createSmartSpeakerService();
    this.createBatteryService();
    this.createCardSensorService();
    this.createSleepTimerService();
    this.createOccupancySensorService();
    this.createBluetoothService();
  }
}
```

### Service Availability Matrix

| Service | Yoto Player | Yoto Mini | Configurable |
|---------|-------------|-----------|--------------|
| **Core Services** | | | |
| AccessoryInformation | ✅ Always | ✅ Always | No |
| SmartSpeaker | ✅ Always | ✅ Always | No |
| Battery | ✅ Always | ✅ Always | No |
| ContactSensor (Card) | ✅ Always | ✅ Always | No |
| OccupancySensor (Night Mode) | ✅ Always | ✅ Always | No |
| Switch (Sleep Timer) | ✅ Always | ✅ Always | No |
| Switch (Bluetooth) | ✅ Always | ✅ Always | No |
| **Optional Services** | | | |
| TemperatureSensor | ✅ Yes | ❌ No | `exposeTemperatureSensor` |
| Lightbulb (Day Ambient) | ✅ Yes | ❌ No | `exposeAmbientLights` |
| Lightbulb (Night Ambient) | ✅ Yes | ❌ No | `exposeAmbientLights` |
| Fanv2 (Day Max Volume) | ✅ Yes | ✅ Yes | `exposeMaxVolumeControls` |
| Fanv2 (Night Max Volume) | ✅ Yes | ✅ Yes | `exposeMaxVolumeControls` |
| StatelessProgrammableSwitch | ✅ Yes | ✅ Yes | `exposeShortcuts` |

### Implementation Example

```typescript
interface DeviceCapabilities {
  hasTemperatureSensor: boolean;
  hasAmbientLightSensor: boolean;
  hasBattery: boolean;
  hasCardSlot: boolean;
  supportsBluetooth: boolean;
  formFactor: 'standard' | 'mini';
}

class YotoPlayerAccessory {
  private capabilities: DeviceCapabilities;
  
  private async detectCapabilities(): Promise<DeviceCapabilities> {
    const deviceId = this.accessory.context.device.deviceId;
    const device = this.accessory.context.device;
    
    try {
      const status = await this.platform.yotoClient.getDeviceStatus({ deviceId });
      
      return {
        hasTemperatureSensor: this.checkTemperatureSensor(status),
        hasAmbientLightSensor: status.ambientLightSensorReading !== undefined,
        hasBattery: status.batteryLevelPercentage !== undefined,
        hasCardSlot: status.cardInsertionState !== undefined,
        supportsBluetooth: status.isBluetoothAudioConnected !== undefined,
        formFactor: this.detectFormFactor(device)
      };
    } catch (error) {
      this.platform.log.warn('Failed to detect capabilities, using defaults:', error);
      
      // Safe defaults based on form factor
      const formFactor = this.detectFormFactor(device);
      return {
        hasTemperatureSensor: formFactor === 'standard',
        hasAmbientLightSensor: formFactor === 'standard',
        hasBattery: true,
        hasCardSlot: true,
        supportsBluetooth: true,
        formFactor
      };
    }
  }
  
  private checkTemperatureSensor(status: any): boolean {
    if (status.temperatureCelcius === undefined) {
      return false;
    }
    if (status.temperatureCelcius === "notSupported") {
      return false;
    }
    return true;
  }
  
  private detectFormFactor(device: YotoDevice): 'standard' | 'mini' {
    if (device.formFactor === 'mini') return 'mini';
    if (device.deviceType?.toLowerCase().includes('mini')) return 'mini';
    return 'standard';
  }
  
  private createTemperatureSensorService() {
    if (!this.capabilities.hasTemperatureSensor) {
      this.platform.log.debug('Skipping temperature sensor - not supported by device');
      return;
    }
    
    if (!this.platform.config.exposeTemperatureSensor) {
      this.platform.log.debug('Skipping temperature sensor - disabled in config');
      return;
    }
    
    this.platform.log.info('Creating temperature sensor service');
    this.temperatureService = this.accessory.addService(
      this.platform.Service.TemperatureSensor
    );
    // ... setup characteristics
  }
  
  private createAmbientLightServices() {
    if (!this.capabilities.hasAmbientLightSensor) {
      this.platform.log.debug('Skipping ambient light controls - not supported by device');
      return;
    }
    
    if (!this.platform.config.exposeAmbientLights) {
      this.platform.log.debug('Skipping ambient light controls - disabled in config');
      return;
    }
    
    this.platform.log.info('Creating ambient light services');
    this.dayAmbientService = this.accessory.addService(
      this.platform.Service.Lightbulb,
      'Day Ambient Light',
      'DayAmbient'
    );
    this.nightAmbientService = this.accessory.addService(
      this.platform.Service.Lightbulb,
      'Night Ambient Light',
      'NightAmbient'
    );
    // ... setup characteristics
  }
}
```

### Logging Strategy

```typescript
// On startup
this.platform.log.info(`Device: ${device.name} (${device.deviceType})`);
this.platform.log.info(`Form Factor: ${this.capabilities.formFactor}`);
this.platform.log.info(`Capabilities: ${JSON.stringify(this.capabilities)}`);

// Per service
this.platform.log.info('✓ Created SmartSpeaker service');
this.platform.log.info('✓ Created Battery service');
this.platform.log.debug('✗ Skipped temperature sensor - not supported');
this.platform.log.debug('✗ Skipped ambient lights - disabled in config');
```

### Cached Accessories Handling

When restoring from cache, re-detect capabilities and remove/add services as needed:

```typescript
async configureAccessory(accessory: PlatformAccessory<YotoDeviceContext>) {
  this.platform.log.info('Restoring accessory from cache:', accessory.displayName);
  
  // Re-detect capabilities (device may have changed)
  const capabilities = await this.detectCapabilities();
  
  // Remove services that are no longer supported
  if (!capabilities.hasTemperatureSensor) {
    const tempService = accessory.getService(this.platform.Service.TemperatureSensor);
    if (tempService) {
      this.platform.log.info('Removing temperature sensor - no longer supported');
      accessory.removeService(tempService);
    }
  }
  
  // Continue with normal initialization
  this.accessories.set(accessory.UUID, accessory);
}
```

---

## Authentication & Configuration

✅ **IMPLEMENTED** - OAuth2 device flow authentication with custom UI is complete. See:
- `homebridge-ui/server.js` - Backend auth endpoints
- `homebridge-ui/public/` - Frontend UI implementation
- `yoto-nodejs-client` - Handles token management and refresh
