# homebridge-yoto

[![latest version](https://img.shields.io/npm/v/homebridge-yoto.svg)](https://www.npmjs.com/package/homebridge-yoto)
[![Actions Status](https://github.com/bcomnes/homebridge-yoto/workflows/tests/badge.svg)](https://github.com/bcomnes/homebridge-yoto/actions)
[![downloads](https://img.shields.io/npm/dm/homebridge-yoto.svg)](https://npmtrends.com/homebridge-yoto)
![Types in JS](https://img.shields.io/badge/types_in_js-yes-brightgreen)
[![neostandard javascript style](https://img.shields.io/badge/code_style-neostandard-7fffff?style=flat&labelColor=ff80ff)](https://github.com/neostandard/neostandard)
[![Socket Badge](https://socket.dev/api/badge/npm/package/homebridge-yoto)](https://socket.dev/npm/package/homebridge-yoto)

> Control your Yoto players through Apple HomeKit

A Homebridge plugin that integrates Yoto audio players with Apple HomeKit, providing real-time control over playback, volume, and device status through MQTT.

## Features

- 🎵 **Playback Control** - Play, pause, and stop content from the Home app
- 🔊 **Volume Control** - Adjust volume with HomeKit sliders or Siri
- 🔋 **Battery Status** - Monitor battery level and charging state
- 🌡️ **Temperature Monitoring** - Track device temperature
- 📡 **Connection Status** - Know when devices are online/offline
- 🎴 **Card Detection** - Detect when cards are inserted
- 💡 **Display Brightness** - Control screen brightness like a lightbulb
- ⏱️ **Sleep Timer** - Set auto-shutoff timer (0-120 minutes)
- 🔊 **Volume Limits** - Set separate day/night maximum volume levels (0-16)
- 🎨 **Ambient Light** - Full RGB color control for ambient LEDs
- 📝 **Active Content** - Track and display what's currently playing
- ⚙️ **Advanced Controls** - Bluetooth, Repeat, and more via switches
- ⚡ **Real-Time Updates** - Instant status updates via MQTT (no polling!)
- 🔐 **Secure OAuth2** - Device authorization flow for authentication

## Installation

### Via Homebridge UI (Recommended)

1. Search for "Yoto" in the Homebridge Config UI X plugin search
2. Click **Install**
3. Follow the OAuth setup instructions in the Homebridge logs
4. Restart Homebridge

### Via Command Line

```bash
npm install -g homebridge-yoto
```

Or add to your Homebridge `package.json`:

```bash
npm install homebridge-yoto
```

## Configuration

### Initial Setup

1. **Install the plugin** using one of the methods above
2. **Start Homebridge** - the plugin will automatically initiate OAuth flow (uses default OAuth client ID)
3. **Check the logs** for authentication instructions:
   ```
   [Yoto] ============================================================
   [Yoto] YOTO AUTHENTICATION REQUIRED
   [Yoto] ============================================================
   [Yoto] 
   [Yoto] 1. Visit: https://api.yotoplay.com/device/auth
   [Yoto] 2. Enter code: ABC-DEF-GHI
   [Yoto] 
   [Yoto] Or visit: https://api.yotoplay.com/device/auth?code=ABC-DEF-GHI
   [Yoto] 
   [Yoto] Code expires in 5 minutes
   [Yoto] ============================================================
   ```
4. **Visit the URL** and enter the code to authorize
5. **Wait for confirmation** - tokens will be saved automatically
6. **Restart Homebridge** to complete setup

### Configuration Options

The plugin can be configured through the Homebridge Config UI or by editing `config.json`:

```json
{
  "platform": "Yoto",
  "name": "Yoto",
  "clientId": "Y4HJ8BFqRQ24GQoLzgOzZ2KSqWmFG8LI",
  "mqttBroker": "mqtt://mqtt.yotoplay.com:1883",
  "statusTimeoutSeconds": 120,
  "exposeTemperature": true,
  "exposeBattery": true,
  "exposeConnectionStatus": true,
  "exposeCardDetection": false,
  "exposeDisplayBrightness": true,
  "exposeSleepTimer": false,
  "exposeVolumeLimits": false,
  "exposeAmbientLight": false,
  "exposeActiveContent": true,
  "updateAccessoryName": false,
  "exposeAdvancedControls": false,
  "volumeControlType": "speaker",
  "debug": false
}
```

#### Configuration Fields

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `platform` | string | `"Yoto"` | **Required** - Must be "Yoto" |
| `name` | string | `"Yoto"` | Platform name in Homebridge logs |
| `clientId` | string | `Y4HJ8BFqRQ24GQoLzgOzZ2KSqWmFG8LI` | OAuth client ID (default works for most users) |
| `accessToken` | string | - | OAuth access token (managed automatically) |
| `refreshToken` | string | - | OAuth refresh token (managed automatically) |
| `tokenExpiresAt` | number | - | Token expiration timestamp (managed automatically) |
| `mqttBroker` | string | `mqtt://mqtt.yotoplay.com:1883` | MQTT broker URL |
| `statusTimeoutSeconds` | number | `120` | Seconds without updates before marking offline |
| `exposeTemperature` | boolean | `true` | Add temperature sensor service |
| `exposeBattery` | boolean | `true` | Add battery service |
| `exposeConnectionStatus` | boolean | `true` | Add online/offline status sensor |
| `exposeCardDetection` | boolean | `false` | Add card insertion detection sensor |
| `exposeDisplayBrightness` | boolean | `true` | Add lightbulb service for display brightness |
| `exposeSleepTimer` | boolean | `false` | Add fan service for sleep timer control |
| `exposeVolumeLimits` | boolean | `false` | Add lightbulb services for day/night volume limits |
| `exposeAmbientLight` | boolean | `false` | Add lightbulb service with RGB color control |
| `exposeActiveContent` | boolean | `true` | Track and log currently playing content |
| `updateAccessoryName` | boolean | `false` | Update accessory name with current content title |
| `exposeAdvancedControls` | boolean | `false` | Add switches for Bluetooth, Repeat, etc. |
| `volumeControlType` | string | `"speaker"` | Service type for volume (`"speaker"`, `"fan"`, or `"lightbulb"`) |
| `debug` | boolean | `false` | Enable verbose debug logging |

**Note on Client ID:** The default client ID (`Y4HJ8BFqRQ24GQoLzgOzZ2KSqWmFG8LI`) is a public OAuth application that works for all users. You only need to change this if:
- You want to use your own OAuth application
- You're experiencing rate limiting issues
- You need custom OAuth settings

To create your own OAuth app, visit [yoto.dev](https://yoto.dev).

## HomeKit Services

Each Yoto player is exposed as a HomeKit accessory with the following services:

### Smart Speaker (Primary)
- **Current Media State** - Shows if content is playing, paused, or stopped
- **Target Media State** - Control playback (play/pause/stop)
- **Volume** - Adjust volume (0-100)
- **Mute** - Mute/unmute audio

### Battery (Optional)
- **Battery Level** - Current battery percentage
- **Charging State** - Whether device is charging
- **Low Battery** - Alert when battery is below 20%

### Temperature Sensor (Optional)
- **Current Temperature** - Device temperature in Celsius

### Occupancy Sensor (Optional)
- **Occupancy Detected** - Indicates if device is online
- **Status Active** - Shows connection status

### Contact Sensor (Optional)
- **Contact Sensor State** - Detects when a card is inserted

### Lightbulb (Display Brightness, Optional)
- **On/Off** - Turn display on or off
- **Brightness** - Adjust display brightness (0-100)

### Fan (Sleep Timer, Optional)
- **Active** - Enable/disable sleep timer
- **Rotation Speed** - Timer duration (0-100 = 0-120 minutes)

### Switches (Advanced Controls, Optional)
- **Bluetooth Switch** - Enable/disable Bluetooth
- **Repeat Switch** - Enable/disable repeat all
- **BT Headphones Switch** - Enable/disable Bluetooth headphones

### Lightbulb (Volume Limits, Optional)
- **Day Volume Limit** - Maximum volume during day mode (0-16 = 0-100%)
- **Night Volume Limit** - Maximum volume during night mode (0-16 = 0-100%)

### Lightbulb (Ambient Light, Optional)
- **On/Off** - Enable/disable ambient light
- **Hue** - Color hue (0-360)
- **Saturation** - Color saturation (0-100%)
- **Brightness** - Light intensity (0-100%)

### Active Content Information (Optional)
- Automatically tracks and logs currently playing content
- Displays card title, author, and category in logs
- Optionally updates accessory name with current content

## Usage Examples

### Siri Commands

- "Hey Siri, play Bedroom Player"
- "Hey Siri, pause Kitchen Player"
- "Hey Siri, set Bedroom Player volume to 50%"
- "Hey Siri, turn on Bedroom Player Display"
- "Hey Siri, set Bedroom Player Display to 30%"
- "Hey Siri, turn on Bedroom Player Sleep Timer"
- "Hey Siri, set Bedroom Player Day Volume Limit to 75%"
- "Hey Siri, set Bedroom Player Ambient Light to red"
- "Hey Siri, what's the battery level of my Yoto Player?"

### Automation Ideas

- **Bedtime Routine** - Automatically pause all players at bedtime
- **Good Morning** - Start playing daily content when you wake up
- **Low Battery Alert** - Get notified when battery drops below 20%
- **Card Inserted** - Trigger lights or scenes when a card is inserted
- **Device Online** - Get notified when a player comes online
- **Dim Display at Night** - Automatically dim display brightness at bedtime
- **Sleep Timer** - Auto-stop playback after a set time
- **Night Mode Volume** - Automatically lower max volume at bedtime
- **Ambient Light Scenes** - Change LED colors based on time of day or mood
- **Content-Based Automations** - Trigger actions when specific content starts playing

## Troubleshooting

### Authentication Issues

**Problem:** OAuth flow not completing

**Solution:**
1. Check that you're visiting the correct URL from the logs
2. Ensure the code hasn't expired (5 minute timeout)
3. Try restarting Homebridge to generate a new code
4. Check your internet connection
5. Verify the client ID is correct (default: `Y4HJ8BFqRQ24GQoLzgOzZ2KSqWmFG8LI`)

**Problem:** "Invalid client" or "Client not found" errors

**Solution:**
1. Ensure you haven't changed the `clientId` field in config
2. If using a custom client ID, verify it's correct at yoto.dev
3. Try removing the `clientId` field to use the default

### MQTT Connection Issues

**Problem:** No real-time updates, devices show "No Response"

**Solution:**
1. Check `statusTimeoutSeconds` setting - increase if needed
2. Verify MQTT broker URL is correct
3. Check Homebridge logs for MQTT connection errors
4. Ensure your network allows MQTT connections (port 1883)

### Device Not Appearing

**Problem:** Yoto player doesn't show up in Home app

**Solution:**
1. Verify device appears in Yoto app
2. Check Homebridge logs for discovery messages
3. Try restarting Homebridge
4. Remove cached accessories and restart

### Token Refresh Issues

**Problem:** "Token refresh failed" errors

**Solution:**
1. Clear tokens from config and restart to re-authenticate
2. Check system time is correct (affects token validation)
3. Verify you have internet connectivity

## Development

This plugin uses TypeScript-in-JavaScript with JSDoc for type safety.

### Setup

```bash
git clone https://github.com/bcomnes/homebridge-yoto.git
cd homebridge-yoto
npm install
```

### Running Tests

```bash
npm test
```

### Code Style

```bash
npm run test:lint
```

### Type Checking

```bash
npm run test:tsc
```

## Architecture

- **OAuth2 Device Flow** - Secure authentication without client secrets
- **MQTT Real-Time Updates** - Instant status updates via `/device/{id}/data/status` and `/device/{id}/data/events` topics
- **Dynamic Platform** - Automatically discovers and registers devices
- **REST API** - Used for device discovery and configuration updates
- **Platform Accessories** - Each Yoto player is a cached platform accessory

## API Documentation

- [Yoto Developer API](https://yoto.dev/api/)
- [Yoto MQTT Documentation](https://yoto.dev/players-mqtt/mqtt-docs/)

## Contributing

Contributions are welcome! Please:

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## License

MIT © [Bret Comnes](https://bret.io)

## Acknowledgments

- Thanks to [Yoto](https://yoto.io) for their excellent API and MQTT documentation
- Built with [Homebridge](https://homebridge.io)

## Support

- 🐛 [Report a Bug](https://github.com/bcomnes/homebridge-yoto/issues)
- 💡 [Request a Feature](https://github.com/bcomnes/homebridge-yoto/issues)
- 📖 [Documentation](https://github.com/bcomnes/homebridge-yoto#readme)