/**
 * @fileoverview MQTT client for real-time Yoto device communication
 */

/** @import { Logger } from 'homebridge' */
/** @import { YotoDeviceStatus, YotoPlaybackEvents, MqttVolumeCommand, MqttAmbientCommand, MqttSleepTimerCommand, MqttCardStartCommand, MqttCommandResponse } from './types.js' */

import mqtt from 'mqtt'
import { EventEmitter } from 'events'
import {
  YOTO_MQTT_BROKER_URL,
  YOTO_MQTT_AUTH_NAME,
  MQTT_RECONNECT_PERIOD,
  MQTT_CONNECT_TIMEOUT,
  MQTT_TOPIC_DATA_STATUS,
  MQTT_TOPIC_DATA_EVENTS,
  MQTT_TOPIC_RESPONSE,
  MQTT_TOPIC_COMMAND_STATUS_REQUEST,
  MQTT_TOPIC_COMMAND_EVENTS_REQUEST,
  MQTT_TOPIC_COMMAND_VOLUME_SET,
  MQTT_TOPIC_COMMAND_CARD_START,
  MQTT_TOPIC_COMMAND_CARD_STOP,
  MQTT_TOPIC_COMMAND_CARD_PAUSE,
  MQTT_TOPIC_COMMAND_CARD_RESUME,
  MQTT_TOPIC_COMMAND_SLEEP_TIMER,
  MQTT_TOPIC_COMMAND_AMBIENTS_SET,
  ERROR_MESSAGES,
  LOG_PREFIX,
  INITIAL_STATUS_REQUEST_DELAY
} from './constants.js'

/**
 * MQTT client for Yoto device communication
 * @extends EventEmitter
 */
export class YotoMqtt extends EventEmitter {
  /**
   * @param {Logger} log - Homebridge logger
   * @param {Object} [options] - MQTT options
   * @param {string} [options.brokerUrl] - MQTT broker URL
   */
  constructor (log, options = {}) {
    super()
    this.log = log
    this.brokerUrl = options.brokerUrl || YOTO_MQTT_BROKER_URL
    this.client = null
    this.connected = false
    this.subscribedDevices = new Set()
    this.deviceCallbacks = new Map()
    this.reconnectAttempts = 0
    this.maxReconnectAttempts = 10
    this.reconnectDelay = MQTT_RECONNECT_PERIOD
  }

  /**
   * Connect to MQTT broker
   * @param {string} accessToken - Yoto access token for authentication
   * @param {string} deviceId - Device ID for MQTT client identification
   * @returns {Promise<void>}
   */
  async connect (accessToken, deviceId) {
    if (this.client) {
      this.log.debug(LOG_PREFIX.MQTT, 'Already connected, disconnecting first...')
      await this.disconnect()
    }

    return new Promise((resolve, reject) => {
      this.log.debug(LOG_PREFIX.MQTT, `Connecting to ${this.brokerUrl}...`)

      const clientId = `DASH${deviceId}`
      const username = `${deviceId}?x-amz-customauthorizer-name=${YOTO_MQTT_AUTH_NAME}`

      this.log.debug(LOG_PREFIX.MQTT, `Connecting with client ID: ${clientId}`)

      this.client = mqtt.connect(this.brokerUrl, {
        keepalive: 300,
        port: 443,
        protocol: 'wss',
        username,
        password: accessToken,
        reconnectPeriod: 0, // Disable auto-reconnect - we'll handle reconnection manually
        connectTimeout: MQTT_CONNECT_TIMEOUT,
        clientId,
        ALPNProtocols: ['x-amzn-mqtt-ca']
      })

      this.client.on('connect', () => {
        this.connected = true
        this.reconnectAttempts = 0
        this.reconnectDelay = MQTT_RECONNECT_PERIOD
        this.log.info(LOG_PREFIX.MQTT, '✓ Connected to MQTT broker')

        // Emit connected event
        this.emit('connected')

        // Resubscribe to all devices after reconnection
        this.resubscribeDevices()

        resolve()
      })

      this.client.on('error', (error) => {
        this.log.error(LOG_PREFIX.MQTT, 'Connection error:', error)
        this.log.error(LOG_PREFIX.MQTT, 'Error message:', error.message)
        const errorWithCode = /** @type {any} */ (error)
        this.log.error(LOG_PREFIX.MQTT, 'Error code:', errorWithCode.code)
        this.log.error(LOG_PREFIX.MQTT, 'Error stack:', error.stack)
        if (errorWithCode.code) {
          this.log.error(LOG_PREFIX.MQTT, `AWS IoT error code: ${errorWithCode.code}`)
        }
        if (!this.connected) {
          reject(error)
        }
      })

      this.client.on('close', () => {
        const wasConnected = this.connected
        this.connected = false

        // Emit disconnected event
        this.emit('disconnected')

        if (wasConnected) {
          this.log.info(LOG_PREFIX.MQTT, ERROR_MESSAGES.MQTT_DISCONNECTED)
          this.handleReconnect()
        } else {
          this.log.error(LOG_PREFIX.MQTT, 'Connection closed before establishing connection')
        }
      })

      this.client.on('reconnect', () => {
        this.reconnectAttempts++
        this.log.debug(LOG_PREFIX.MQTT, `Reconnection attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts}`)

        if (this.reconnectAttempts >= this.maxReconnectAttempts) {
          this.log.error(LOG_PREFIX.MQTT, 'Max reconnection attempts reached, stopping reconnection')
          if (this.client) {
            this.client.end(true)
          }
        }
      })

      this.client.on('offline', () => {
        this.connected = false
        this.log.debug(LOG_PREFIX.MQTT, 'MQTT client offline - connection failed or lost')

        // Emit offline event
        this.emit('offline')
      })

      this.client.on('end', () => {
        this.log.debug(LOG_PREFIX.MQTT, 'MQTT client ended')
      })

      this.client.on('disconnect', (packet) => {
        this.log.debug(LOG_PREFIX.MQTT, 'MQTT client disconnected:', packet)
      })

      this.client.on('packetreceive', (packet) => {
        this.log.debug(LOG_PREFIX.MQTT, 'Packet received:', packet.cmd)
      })

      this.client.on('packetsend', (packet) => {
        this.log.debug(LOG_PREFIX.MQTT, 'Packet sent:', packet.cmd)
      })

      this.client.on('message', (topic, message) => {
        this.handleMessage(topic, message)
      })

      // Timeout if connection takes too long
      setTimeout(() => {
        if (!this.connected) {
          reject(new Error(ERROR_MESSAGES.MQTT_CONNECTION_FAILED))
        }
      }, MQTT_CONNECT_TIMEOUT)
    })
  }

  /**
   * Disconnect from MQTT broker
   * @returns {Promise<void>}
   */
  async disconnect () {
    if (!this.client) {
      return
    }

    return new Promise((resolve) => {
      this.log.debug(LOG_PREFIX.MQTT, 'Disconnecting from MQTT broker...')

      if (this.client) {
        this.client.end(false, {}, () => {
          this.connected = false
          this.client = null
          this.subscribedDevices.clear()
          this.log.debug(LOG_PREFIX.MQTT, 'Disconnected')
          resolve()
        })
      } else {
        resolve()
      }
    })
  }

  /**
   * Handle reconnection with exponential backoff
   */
  handleReconnect () {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      this.log.error(LOG_PREFIX.MQTT, 'Max reconnection attempts reached')
      return
    }

    // Exponential backoff with jitter
    this.reconnectDelay = Math.min(
      MQTT_RECONNECT_PERIOD * Math.pow(2, this.reconnectAttempts),
      60000 // Max 60 seconds
    )

    const jitter = Math.random() * 1000
    const delay = this.reconnectDelay + jitter

    this.log.debug(LOG_PREFIX.MQTT, `Will attempt reconnection in ${Math.round(delay / 1000)}s`)
  }

  /**
   * Resubscribe to all device topics after reconnection
   */
  async resubscribeDevices () {
    if (this.subscribedDevices.size === 0) {
      return
    }

    this.log.debug(LOG_PREFIX.MQTT, `Resubscribing to ${this.subscribedDevices.size} device(s)...`)

    for (const deviceId of this.subscribedDevices) {
      const callbacks = this.deviceCallbacks.get(deviceId)
      if (callbacks) {
        try {
          // Clear from set temporarily to allow resubscription
          this.subscribedDevices.delete(deviceId)
          await this.subscribeToDevice(deviceId, callbacks)
        } catch (error) {
          this.log.error(LOG_PREFIX.MQTT, `Failed to resubscribe to device ${deviceId}:`, error)
        }
      }
    }
  }

  /**
   * Subscribe to device topics
   * @param {string} deviceId - Device ID
   * @param {Object} callbacks - Callback functions
   * @param {(status: YotoDeviceStatus) => void} [callbacks.onStatus] - Status update callback
   * @param {(events: YotoPlaybackEvents) => void} [callbacks.onEvents] - Events update callback
   * @param {(response: MqttCommandResponse) => void} [callbacks.onResponse] - Command response callback
   * @returns {Promise<void>}
   */
  async subscribeToDevice (deviceId, callbacks) {
    if (!this.client || !this.connected) {
      throw new Error('MQTT client not connected')
    }

    if (this.subscribedDevices.has(deviceId)) {
      this.log.debug(LOG_PREFIX.MQTT, `Already subscribed to device ${deviceId}`)
      return
    }

    this.log.debug(LOG_PREFIX.MQTT, `Subscribing to device ${deviceId}...`)

    const topics = [
      this.buildTopic(MQTT_TOPIC_DATA_STATUS, deviceId),
      this.buildTopic(MQTT_TOPIC_DATA_EVENTS, deviceId),
      this.buildTopic(MQTT_TOPIC_RESPONSE, deviceId)
    ]

    return new Promise((resolve, reject) => {
      if (!this.client) {
        reject(new Error('MQTT client not available'))
        return
      }

      this.client.subscribe(topics, (error) => {
        if (error) {
          this.log.error(LOG_PREFIX.MQTT, `Failed to subscribe to device ${deviceId}:`, error)
          reject(error)
          return
        }

        this.subscribedDevices.add(deviceId)
        this.deviceCallbacks.set(deviceId, callbacks)
        this.log.debug(LOG_PREFIX.MQTT, `✓ Subscribed to device ${deviceId}`)

        // Request initial status after a short delay
        setTimeout(() => {
          this.requestStatus(deviceId).catch(err => {
            this.log.debug(LOG_PREFIX.MQTT, `Failed to request initial status for ${deviceId}:`, err)
          })
          this.requestEvents(deviceId).catch(err => {
            this.log.debug(LOG_PREFIX.MQTT, `Failed to request initial events for ${deviceId}:`, err)
          })
        }, INITIAL_STATUS_REQUEST_DELAY)

        resolve()
      })
    })
  }

  /**
   * Unsubscribe from device topics
   * @param {string} deviceId - Device ID
   * @returns {Promise<void>}
   */
  async unsubscribeFromDevice (deviceId) {
    if (!this.client || !this.subscribedDevices.has(deviceId)) {
      return
    }

    this.log.debug(LOG_PREFIX.MQTT, `Unsubscribing from device ${deviceId}...`)

    const topics = [
      this.buildTopic(MQTT_TOPIC_DATA_STATUS, deviceId),
      this.buildTopic(MQTT_TOPIC_DATA_EVENTS, deviceId),
      this.buildTopic(MQTT_TOPIC_RESPONSE, deviceId)
    ]

    return new Promise((resolve, reject) => {
      if (!this.client) {
        reject(new Error('MQTT client not available'))
        return
      }

      this.client.unsubscribe(topics, (error) => {
        if (error) {
          this.log.error(LOG_PREFIX.MQTT, `Failed to unsubscribe from device ${deviceId}:`, error)
          reject(error)
          return
        }

        this.subscribedDevices.delete(deviceId)
        this.deviceCallbacks.delete(deviceId)
        this.log.debug(LOG_PREFIX.MQTT, `✓ Unsubscribed from device ${deviceId}`)
        resolve()
      })
    })
  }

  /**
   * Handle incoming MQTT message
   * @param {string} topic - Message topic
   * @param {Buffer} message - Message payload
   */
  handleMessage (topic, message) {
    try {
      const payload = JSON.parse(message.toString())
      const deviceId = this.extractDeviceId(topic)

      if (!deviceId) {
        this.log.debug(LOG_PREFIX.MQTT, `Could not extract device ID from topic: ${topic}`)
        return
      }

      const callbacks = this.deviceCallbacks.get(deviceId)
      if (!callbacks) {
        this.log.debug(LOG_PREFIX.MQTT, `No callbacks registered for device ${deviceId}`)
        return
      }

      if (topic.includes('/status')) {
        this.log.debug(LOG_PREFIX.MQTT, `Status update for ${deviceId}`)
        callbacks.onStatus?.(payload)
      } else if (topic.includes('/events')) {
        this.log.debug(LOG_PREFIX.MQTT, `Events update for ${deviceId}`)
        callbacks.onEvents?.(payload)
      } else if (topic.includes('/response')) {
        this.log.debug(LOG_PREFIX.MQTT, `Command response for ${deviceId}`)
        callbacks.onResponse?.(payload)
      }
    } catch (error) {
      this.log.error(LOG_PREFIX.MQTT, 'Error handling message:', error)
      this.log.debug(LOG_PREFIX.MQTT, 'Failed message topic:', topic)
      this.log.debug(LOG_PREFIX.MQTT, 'Failed message payload:', message.toString())
    }
  }

  /**
   * Publish a command to device
   * @param {string} topic - Command topic
   * @param {any} [payload] - Command payload
   * @returns {Promise<void>}
   */
  async publish (topic, payload = {}) {
    if (!this.client || !this.connected) {
      throw new Error('MQTT client not connected')
    }

    return new Promise((resolve, reject) => {
      if (!this.client) {
        reject(new Error('MQTT client not available'))
        return
      }

      const message = JSON.stringify(payload)
      this.log.debug(LOG_PREFIX.MQTT, `Publishing to ${topic}:`, message)

      // Add timeout for publish operation
      const timeout = setTimeout(() => {
        reject(new Error('MQTT publish timeout'))
      }, 5000)

      this.client.publish(topic, message, { qos: 0 }, (error) => {
        clearTimeout(timeout)

        if (error) {
          this.log.error(LOG_PREFIX.MQTT, `Failed to publish to ${topic}:`, error)
          reject(error)
        } else {
          resolve()
        }
      })
    })
  }

  /**
   * Request current device status
   * @param {string} deviceId - Device ID
   * @returns {Promise<void>}
   */
  async requestStatus (deviceId) {
    const topic = this.buildTopic(MQTT_TOPIC_COMMAND_STATUS_REQUEST, deviceId)
    await this.publish(topic, {})
  }

  /**
   * Request current playback events
   * @param {string} deviceId - Device ID
   * @returns {Promise<void>}
   */
  async requestEvents (deviceId) {
    const topic = this.buildTopic(MQTT_TOPIC_COMMAND_EVENTS_REQUEST, deviceId)
    await this.publish(topic, {})
  }

  /**
   * Set device volume
   * @param {string} deviceId - Device ID
   * @param {number} volume - Volume level (0-100)
   * @returns {Promise<void>}
   */
  async setVolume (deviceId, volume) {
    const topic = this.buildTopic(MQTT_TOPIC_COMMAND_VOLUME_SET, deviceId)
    /** @type {MqttVolumeCommand} */
    const payload = { volume: Math.round(volume) }
    await this.publish(topic, payload)
  }

  /**
   * Start playing a card
   * @param {string} deviceId - Device ID
   * @param {string} cardUri - Card URI
   * @param {Object} [options] - Playback options
   * @param {string} [options.chapterKey] - Chapter to start from
   * @param {string} [options.trackKey] - Track to start from
   * @param {number} [options.secondsIn] - Start offset in seconds
   * @param {number} [options.cutOff] - Stop offset in seconds
   * @param {boolean} [options.anyButtonStop] - Any button stops playback
   * @returns {Promise<void>}
   */
  async startCard (deviceId, cardUri, options = {}) {
    const topic = this.buildTopic(MQTT_TOPIC_COMMAND_CARD_START, deviceId)
    /** @type {MqttCardStartCommand} */
    const payload = {
      uri: cardUri
    }
    if (options.chapterKey !== undefined) payload.chapterKey = options.chapterKey
    if (options.trackKey !== undefined) payload.trackKey = options.trackKey
    if (options.secondsIn !== undefined) payload.secondsIn = options.secondsIn
    if (options.cutOff !== undefined) payload.cutOff = options.cutOff
    if (options.anyButtonStop !== undefined) payload.anyButtonStop = options.anyButtonStop
    await this.publish(topic, payload)
  }

  /**
   * Pause card playback
   * @param {string} deviceId - Device ID
   * @returns {Promise<void>}
   */
  async pauseCard (deviceId) {
    const topic = this.buildTopic(MQTT_TOPIC_COMMAND_CARD_PAUSE, deviceId)
    await this.publish(topic, {})
  }

  /**
   * Resume card playback
   * @param {string} deviceId - Device ID
   * @returns {Promise<void>}
   */
  async resumeCard (deviceId) {
    const topic = this.buildTopic(MQTT_TOPIC_COMMAND_CARD_RESUME, deviceId)
    await this.publish(topic, {})
  }

  /**
   * Stop card playback
   * @param {string} deviceId - Device ID
   * @returns {Promise<void>}
   */
  async stopCard (deviceId) {
    const topic = this.buildTopic(MQTT_TOPIC_COMMAND_CARD_STOP, deviceId)
    await this.publish(topic, {})
  }

  /**
   * Set sleep timer
   * @param {string} deviceId - Device ID
   * @param {number} seconds - Duration in seconds (0 to disable)
   * @returns {Promise<void>}
   */
  async setSleepTimer (deviceId, seconds) {
    const topic = this.buildTopic(MQTT_TOPIC_COMMAND_SLEEP_TIMER, deviceId)
    /** @type {MqttSleepTimerCommand} */
    const payload = { seconds }
    await this.publish(topic, payload)
  }

  /**
   * Set ambient light color
   * @param {string} deviceId - Device ID
   * @param {number} r - Red intensity (0-255)
   * @param {number} g - Green intensity (0-255)
   * @param {number} b - Blue intensity (0-255)
   * @returns {Promise<void>}
   */
  async setAmbientLight (deviceId, r, g, b) {
    const topic = this.buildTopic(MQTT_TOPIC_COMMAND_AMBIENTS_SET, deviceId)
    /** @type {MqttAmbientCommand} */
    const payload = { r, g, b }
    await this.publish(topic, payload)
  }

  /**
   * Build topic string with device ID
   * @param {string} template - Topic template
   * @param {string} deviceId - Device ID
   * @returns {string}
   */
  buildTopic (template, deviceId) {
    return template.replace('{deviceId}', deviceId)
  }

  /**
   * Extract device ID from topic
   * @param {string} topic - Topic string
   * @returns {string | null}
   */
  extractDeviceId (topic) {
    // Match both /device/{id}/ and device/{id}/ patterns
    const match = topic.match(/\/?device\/([^/]+)\//)
    return match?.[1] ?? null
  }

  /**
   * Check if connected to MQTT broker
   * @returns {boolean}
   */
  isConnected () {
    return this.connected && this.client !== null
  }
}
