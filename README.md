<p align="center">

<img src="https://github.com/homebridge/branding/raw/latest/logos/homebridge-wordmark-logo-vertical.png" width="150">

<img src="./logo.png" width="150">

</p>

<span align="center">

# homebridge-yoto

</span>

<span align="center">

[![latest version](https://img.shields.io/npm/v/homebridge-yoto.svg)](https://www.npmjs.com/package/homebridge-yoto)
[![Actions Status](https://github.com/bcomnes/homebridge-yoto/workflows/tests/badge.svg)](https://github.com/bcomnes/homebridge-yoto/actions)
[![downloads](https://img.shields.io/npm/dm/homebridge-yoto.svg)](https://npmtrends.com/homebridge-yoto)
![Types in JS](https://img.shields.io/badge/types_in_js-yes-brightgreen)
[![neostandard javascript style](https://img.shields.io/badge/code_style-neostandard-7fffff?style=flat&labelColor=ff80ff)](https://github.com/neostandard/neostandard)
[![Socket Badge](https://socket.dev/api/badge/npm/package/homebridge-yoto)](https://socket.dev/npm/package/homebridge-yoto)

</span>

THIS PLUGIN IS A WIP. DO NOT USE YET.

Homebridge plugin that exposes Yoto players to HomeKit with optional playback controls, device status, and nightlight settings.

## Settings

**Playback Controls** (`services.playbackAccessory`)
- **Bridged (Switch + Dimmer)**: Adds Playback and Volume services on the main accessory.
- **External Smart Speaker**: Publishes a separate Smart Speaker accessory for playback and volume. Requires pairing the extra accessory in the Home app.
- **None**: Disables playback and volume services entirely.

**Card Controls** (`services.cardControls`)
- Adds a per-device switch that plays the configured card ID.
- Optional "Play on All Yotos" accessory per card control.

**Service toggles**
- **Temperature Sensor**: Adds a temperature sensor when supported by the device.
- **Nightlight**: Adds day/night nightlight controls and status sensors.
- **Card Slot**: Adds a card insertion sensor.
- **Day Mode**: Adds a day/night mode sensor.
- **Sleep Timer**: Adds a sleep timer switch.
- **Bluetooth**: Adds a Bluetooth toggle switch.
- **Volume Limits**: Adds day/night max volume controls.

## HomeKit Services

**Playback (bridged)**
- **Playback**: Switch; On resumes, Off pauses.
- **Volume**: Lightbulb; On unmutes, Off mutes, Brightness maps 0-100% to device volume steps.

**Smart Speaker (external)**
- **Smart Speaker**: Current/Target Media State, Volume, Mute, and StatusActive (online state).

**Card Controls**
- **Card Control**: Switch on each device that plays the configured card ID.
- **Card Control (All Yotos)**: Optional switch accessory that plays the card on every Yoto.

**Device status**
- **Online Status**: Contact sensor; Contact Not Detected = online.
- **Battery**: Battery level, charging state, and low battery.
- **Temperature**: Temperature sensor with fault status when offline/unavailable.

**Nightlight**
- **Day Nightlight / Night Nightlight**: Lightbulbs with On/Off, Brightness, Hue, and Saturation.
- **Nightlight Active / Day Nightlight Active / Night Nightlight Active**: Contact sensors for live nightlight state.

**Other controls**
- **Card Slot**: Contact sensor for card insertion.
- **Day Mode**: Contact sensor; Contact Not Detected = day mode.
- **Sleep Timer**: Switch to enable/disable sleep timer.
- **Bluetooth**: Switch to toggle Bluetooth.
- **Day/Night Max Volume**: Lightbulb brightness sets max volume limits.

## License

MIT © [Bret Comnes](https://bret.io)

## Acknowledgments

- Thanks to [Yoto](https://yoto.io) for their new API!
- Built with [Homebridge](https://homebridge.io)
s
