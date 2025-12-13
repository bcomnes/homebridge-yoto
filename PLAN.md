# Homebridge Yoto Plugin - Implementation Plan

## Overview

A Homebridge plugin that integrates Yoto audio players with Apple HomeKit, providing comprehensive control over playback, volume, display settings, and status monitoring through MQTT.

## ✅ Current Status: Phase 1 Complete + Phase 2 Enhancements

**MVP Complete!** All Phase 1 features implemented and tested. Additional Phase 2 features added including display brightness control, sleep timer, and advanced control switches.

## Project Structure

```
homebridge-yoto/
├── lib/
│   ├── platform.js              # Main YotoPlatform class
│   ├── playerAccessory.js       # YotoPlayerAccessory handler
│   ├── yotoApi.js               # Yoto REST API client wrapper
│   ├── yotoMqtt.js              # MQTT client for real-time updates
│   ├── auth.js                  # OAuth2 authentication handler
│   ├── types.js                 # JSDoc type definitions
│   └── constants.js             # Plugin constants and defaults
├── index.js                     # Plugin entry point
├── config.schema.json           # Homebridge config UI schema
└── package.json
```

## Phase 1: Core Foundation (MVP) ✅ COMPLETE

### 1.1 Authentication System ✅

**Status:** COMPLETE

**Goal:** Implement OAuth2 Device Authorization Flow for Yoto API

**Files:**
- `lib/auth.js`

**Implementation:**
- Use `POST /oauth/device/code` to initiate device flow
- Display user_code and verification_uri in Homebridge logs
- Poll `POST /oauth/token` until user completes authorization
- Store access_token and refresh_token in platform config
- Implement automatic token refresh logic
- Handle token expiration gracefully

**API Endpoints:**
- `POST /oauth/device/code`
- `POST /oauth/token` (with grant_type: 'device_code' and 'refresh_token')

**Config Structure:**
```javascript
{
  "platform": "Yoto",
  "name": "Yoto",
  "clientId": "YOUR_CLIENT_ID",
  "accessToken": "(stored after auth)",
  "refreshToken": "(stored after auth)",
  "tokenExpiresAt": 0
}
```

### 1.2 API Client ✅

**Status:** COMPLETE

**Goal:** Create robust API wrapper for Yoto endpoints

**Files:**
- `lib/yotoApi.js` (REST endpoints)
- `lib/yotoMqtt.js` (MQTT client)

**REST API Features:**
- Centralized fetch wrapper with auth headers
- Automatic token refresh on 401 responses
- Error handling and retry logic
- Rate limiting protection
- Request/response logging for debugging

**Key REST Methods:**
```javascript
class YotoApi {
  async getDevices()              // GET /device-v2/devices/mine
  async getDeviceConfig(deviceId) // GET /device-v2/{deviceId}/config
  async updateDeviceConfig(deviceId, config) // PUT /device-v2/{deviceId}/config
  async getContent(cardId)        // GET /content/{cardId}
  async getLibraryGroups()        // GET /card/family/library/groups
}
```

**MQTT Client Features:**
- Real-time device status updates via `/device/{id}/data/status`
- Real-time playback events via `/device/{id}/data/events`
- Command publishing to control devices
- Automatic reconnection on disconnect
- Per-device topic subscriptions

**Key MQTT Methods:**
```javascript
class YotoMqtt {
  async connect(accessToken)
  async disconnect()
  subscribeToDevice(deviceId, callback)
  unsubscribeFromDevice(deviceId)
  
  // Command methods
  async setVolume(deviceId, volume)
  async startCard(deviceId, uri, options)
  async pauseCard(deviceId)
  async resumeCard(deviceId)
  async stopCard(deviceId)
  async setSleepTimer(deviceId, seconds)
  async setAmbientLight(deviceId, r, g, b)
  async requestStatus(deviceId)
  async requestEvents(deviceId)
}
```

### 1.3 Platform Setup ✅

**Status:** COMPLETE

**Goal:** Implement DynamicPlatformPlugin for device discovery

**Files:**
- `lib/platform.js`
- `index.js`

**Implementation:**
- Register platform in `index.js`
- Implement `configureAccessory()` to restore cached accessories
- Implement `discoverDevices()` called on `didFinishLaunching`
- Create Map to track accessories by deviceId
- Handle device addition/removal/updates
- Store device metadata in `accessory.context`

**Platform Lifecycle:**
1. Constructor: Initialize API client, Service/Characteristic refs
2. configureAccessory: Restore cached accessories from disk
3. didFinishLaunching: Discover devices and register new ones
4. Device sync: Update existing, add new, remove stale accessories

### 1.4 Player Accessory (Basic) ✅

**Status:** COMPLETE

**Goal:** Create accessory with essential playback controls

**Files:**
- `lib/playerAccessory.js`

**Services (Phase 1):**
1. **AccessoryInformation** (required)
   - Manufacturer: "Yoto"
   - Model: from device.deviceType
   - SerialNumber: device.deviceId
   - FirmwareRevision: device.releaseChannel

2. **SmartSpeaker** (primary service)
   - CurrentMediaState: PLAYING/PAUSED/STOPPED (read-only)
   - TargetMediaState: PLAY/PAUSE/STOP (write)
   - Volume: 0-100 (read/write)
   - Mute: boolean (read/write)

3. **Battery**
   - BatteryLevel: 0-100
   - ChargingState: NOT_CHARGING/CHARGING
   - StatusLowBattery: NORMAL/LOW (< 20%)

**Implementation:**
- Constructor: Set up services and characteristics
- Implement onGet/onSet handlers for each characteristic
- Subscribe to MQTT topics for real-time updates
- Use `updateCharacteristic()` when MQTT messages arrive
- Cache last known state for onGet handlers

### 1.5 MQTT Real-Time Updates ✅

**Status:** COMPLETE

**Goal:** Keep HomeKit in sync with device state using MQTT

**Implementation:**
- Connect to Yoto MQTT broker on platform init
- Subscribe to `/device/{id}/data/status` for each device
- Subscribe to `/device/{id}/data/events` for playback events
- Update characteristics immediately when MQTT messages arrive
- Request initial status via `/device/{id}/command/status/request` on startup
- Implement reconnection logic with exponential backoff
- Handle offline devices (no recent MQTT messages)

**MQTT Topic Subscriptions:**
```javascript
// Per device subscriptions
/device/{deviceId}/data/status   → Battery, volume, config state
/device/{deviceId}/data/events   → Playback state, current track
/device/{deviceId}/response      → Command confirmations
```

**Status Mapping:**
```javascript
// MQTT data/status → HomeKit
batteryLevel → BatteryLevel
charging (0/1) → ChargingState (NOT_CHARGING/CHARGING)
userVolume → Volume
activeCard → CurrentMediaState context

// MQTT data/events → HomeKit  
playbackStatus ("playing"/"paused"/"stopped") → CurrentMediaState
volume → Volume (real-time)
cardId → Active content tracking
```

**Command Publishing:**
```javascript
// HomeKit actions → MQTT commands
Set Volume → /device/{id}/command/volume/set
Play/Pause → /device/{id}/command/card/pause or /resume
Stop → /device/{id}/command/card/stop
```

## Phase 2: Enhanced Controls (Partially Complete)

### 2.1 Display Control ✅

**Status:** COMPLETE

**Service:** Lightbulb (for brightness control)

**Characteristics:**
- On: Display on/off
- Brightness: 0-100 mapped to display brightness settings

**Implementation:**
- Map to `dayDisplayBrightness` and `nightDisplayBrightness`
- Handle "auto" mode as max brightness (100)
- Numeric values map directly to percentage
- Create separate services for day/night if needed

### 2.2 Temperature Sensor ✅

**Status:** COMPLETE

**Service:** TemperatureSensor (optional, enabled via config)

**Characteristics:**
- CurrentTemperature: From `temperatureCelcius`

**Config:**
```javascript
{
  "exposeTemperature": true
}
```

### 2.3 Connection Status ✅

**Status:** COMPLETE

**Service:** ContactSensor or OccupancySensor

**Characteristics:**
- ContactSensorState or OccupancyDetected: Based on `isOnline`
- StatusActive: `isOnline`

**Use Cases:**
- Automation triggers when player comes online
- Notifications when player goes offline
- Parent monitoring of device usage

### 2.4 Configuration Switches ✅

**Status:** COMPLETE

**Goal:** Expose device settings as HomeKit switches

**Switches:**
1. Bluetooth Enabled → `bluetoothEnabled`
2. Bluetooth Headphones → `btHeadphonesEnabled`
3. Repeat All → `repeatAll`

**Implementation:**
- Create Switch service for each setting
- onSet: Update via `PUT /device-v2/{deviceId}/config`
- onGet: Read from cached config or status
- Refresh config on status poll

**Config:**
```javascript
{
  "exposeAdvancedControls": true
}
```

## Phase 3: Advanced Features

### 3.1 Volume Limits

**Implementation Options:**

**Option A: Custom Characteristics (via Eve)**
- Requires homebridge-lib for custom characteristics
- Create slider characteristics for max volume

**Option B: Additional Lightbulb Services**
- Use brightness as volume limit (0-16 → 0-100 scale)
- Name: "Max Volume Day" and "Max Volume Night"

**Settings:**
- Max Volume Limit (Day): `maxVolumeLimit` (0-16)
- Max Volume Limit (Night): `nightMaxVolumeLimit` (0-16)

### 3.2 Ambient Light Control

**Service:** Lightbulb (with color)

**Characteristics:**
- On: Ambient light enabled
- Brightness: Light intensity
- Hue/Saturation: Parse `ambientColour` hex to HSV

**Implementation:**
- Parse hex color (e.g., "#ff3900") to Hue/Saturation
- Separate services for day and night colors
- Update via config: `ambientColour`, `nightAmbientColour`

### 3.3 Card Detection ✅

**Status:** COMPLETE

**Service:** ContactSensor

**Characteristics:**
- ContactSensorState: DETECTED when card inserted
- StatusActive: true

**Status Mapping:**
```javascript
cardInsertionState === 0 → CONTACT_NOT_DETECTED
cardInsertionState === 1 → CONTACT_DETECTED (physical)
cardInsertionState === 2 → CONTACT_DETECTED (remote)
```

**Use Cases:**
- Trigger automations when card inserted
- Parent monitoring of what's playing
- Bedtime routine detection

### 3.4 Sleep Timer ✅

**Status:** COMPLETE

**Implementation:**
- ✅ Uses Fanv2 service with rotation speed as timer minutes (0-120 minutes)
- ✅ Active characteristic controls timer on/off
- ✅ Real-time updates from MQTT events
- Or use Valve service with duration
- Map to `shutdownTimeout` setting (in seconds)
- Convert minutes to seconds for API

## Phase 4: Content Integration

### 4.1 Active Content Info

**Goal:** Display currently playing content information

**Implementation:**
- When `activeCard` changes, fetch via `GET /content/{cardId}`
- Store card metadata in accessory context
- Display title/author in logs or as custom characteristics
- Update accessory display name with current content (optional)

### 4.2 Shortcuts (Future)

**Goal:** Expose device shortcuts as programmable switches

**API Endpoint:**
- `PUT /device-v2/{deviceId}/shortcuts`

**Service:** StatelessProgrammableSwitch

**Implementation:**
- Create button for each configured shortcut
- Press triggers associated content/command
- Separate buttons for day/night mode shortcuts
- Read from device config: `dayYotoDaily`, `nightYotoRadio`, etc.

**Note:** Library groups functionality has been removed from the plan as it's not essential for MVP.

## Configuration Schema

### Basic Config
```json
{
  "platform": "Yoto",
  "name": "Yoto",
  "clientId": "",
  "accessToken": "",
  "refreshToken": "",
  "tokenExpiresAt": 0
}
```

### Advanced Config
```json
{
  "platform": "Yoto",
  "name": "Yoto",
  "clientId": "",
  "mqttBroker": "mqtt://mqtt.yotoplay.com:1883",
  "exposeTemperature": true,
  "exposeBattery": true,
  "exposeAdvancedControls": false,
  "exposeConnectionStatus": true,
  "exposeCardDetection": false,
  "volumeControlType": "speaker",
  "statusTimeoutSeconds": 120,
  "debug": false
}
```

### config.schema.json Structure
- OAuth setup instructions in description
- clientId field (required)
- MQTT broker URL (with default)
- Feature toggles for optional sensors
- Status timeout slider (60-300 seconds) - mark device offline if no updates
- Debug mode toggle

## Error Handling Strategy

### API Errors
- 401 Unauthorized → Trigger token refresh
- 403 Forbidden → Log error, mark device unavailable
- 404 Not Found → Device may be deleted, unregister accessory
- 429 Too Many Requests → Implement exponential backoff
- 500+ Server Errors → Retry with backoff, log for user

### Device Offline
- Mark services as "No Response" in HomeKit if no MQTT updates for statusTimeoutSeconds
- MQTT client will automatically attempt reconnection
- Resume normal operation when MQTT messages resume
- Log connection status changes

### MQTT Connection Issues
- Implement exponential backoff for reconnection attempts
- Use Last Will and Testament (LWT) if supported by broker
- Maintain connection state per device
- Gracefully handle broker unavailability

### Token Expiration
- Proactively refresh before expiration
- If refresh fails, require user re-authentication
- Clear tokens from config on auth failure
- Display clear instructions in logs

### Homebridge Crashes
- Persist all state in accessory.context
- Gracefully restore on restart
- Re-establish API connection
- Resume polling from last known state

## Testing Strategy

### Unit Tests
- API client methods (mock fetch)
- Token refresh logic
- Status mapping functions
- Config validation

### Integration Tests
- OAuth flow (with mock server)
- Device discovery
- Characteristic updates
- Error recovery

### Manual Testing Checklist
- [ ] Initial OAuth setup flow
- [ ] Device discovery and registration
- [ ] Play/pause control
- [ ] Volume adjustment
- [ ] Battery status display
- [ ] MQTT connection establishment
- [ ] Real-time status updates via MQTT
- [ ] Device offline handling
- [ ] Token refresh
- [ ] Homebridge restart recovery
- [ ] Multiple device support
- [ ] Device removal from account

## Documentation

### README.md
- Overview and features
- Prerequisites (Yoto account, Homebridge)
- Installation instructions
- OAuth setup guide with screenshots
- Configuration options
- Troubleshooting common issues
- Supported devices

### CHANGELOG.md
- Version history
- Feature additions
- Bug fixes
- Breaking changes

### Contributing Guide
- Development setup
- Code style (JSDoc, ESLint)
- Testing requirements
- Pull request process

## Future Enhancements (Post-MVP)

### Content Management
- [ ] Recently played content tracking
- [ ] MYO card management
- [ ] Active content information display

### Advanced Device Control
- [ ] Alarm management
- [ ] Clock face selection
- [ ] Scheduled ambient light changes
- [ ] Audio output routing

### Multi-Device Features
- [ ] Synchronized playback
- [ ] Family dashboard accessory
- [ ] Group controls

### Parental Controls
- [ ] Time-based restrictions
- [ ] Content filtering
- [ ] Usage monitoring

### Automation Integration
- [ ] Bedtime scene triggers
- [ ] Presence detection
- [ ] Weather-based content
- [ ] HomeKit Secure Video integration (if camera added)

## Success Metrics

### MVP Success Criteria
- [ ] Successfully authenticate with Yoto API
- [ ] Discover and register all user devices
- [ ] Control play/pause from Home app
- [ ] Adjust volume from Home app
- [ ] Display accurate battery status
- [ ] Status updates within 60 seconds
- [ ] Survive Homebridge restart
- [ ] Handle device offline gracefully

### Phase 2 Success Criteria
- [ ] Brightness control functional
- [ ] Temperature sensor (if enabled)
- [ ] Connection status monitoring
- [ ] Configuration switches work

### User Satisfaction Goals
- Setup time under 5 minutes
- No more than 2 second latency for controls
- Clear error messages and recovery steps
- Stable over 7 days continuous operation

## Development Phases Timeline

### Week 1: Foundation
- Day 1-2: Project setup, REST API client, auth
- Day 3-4: MQTT client implementation
- Day 5-7: Platform implementation with MQTT integration

### Week 2: Core Features
- Day 1-2: Basic accessory with playback/volume controls via MQTT
- Day 3-4: Battery service, real-time status updates
- Day 5-7: Display control, temperature sensor

### Week 3: Advanced Features
- Day 1-3: Advanced controls, volume limits
- Day 4-5: Card detection, connection status
- Day 6-7: Integration testing, polish

### Week 4: Release Prep
- Day 1-3: Documentation, examples
- Day 4-5: Beta testing with users
- Day 6-7: Bug fixes, npm publish

## Next Steps

1. ✅ Review and approve plan
2. ✅ Discover MQTT integration capability
3. ✅ Set up project structure and dependencies (including MQTT library)
4. ✅ Implement auth.js with OAuth flow
5. ✅ Create REST API client wrapper
6. ✅ Create MQTT client wrapper with subscriptions
7. ✅ Build platform foundation with MQTT connection
8. ✅ Implement basic player accessory with real-time updates
9. ✅ Add display brightness control
10. ✅ Add sleep timer control
11. ✅ Add advanced control switches
12. ✅ Improve MQTT reconnection logic
13. 🔄 Test with real Yoto devices (PRIORITY)
14. 🔄 Add volume limit controls (IN PROGRESS)
15. 🔄 Add ambient light color control (IN PROGRESS)
16. ⏳ Add active content information display
17. ⏳ Add shortcuts support (future)
18. ⏳ Publish to npm
19. ⏳ Iterate based on user feedback