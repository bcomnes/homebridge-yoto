import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  clampPercent,
  clampSteps,
  percentToSteps,
  stepsFromVolumeValue,
  stepsToPercent,
} from './volume.js'

test('clampPercent clamps and rounds values', () => {
  assert.strictEqual(clampPercent(-5), 0)
  assert.strictEqual(clampPercent(0), 0)
  assert.strictEqual(clampPercent(12.4), 12)
  assert.strictEqual(clampPercent(12.6), 13)
  assert.strictEqual(clampPercent(100), 100)
  assert.strictEqual(clampPercent(250), 100)
  assert.strictEqual(clampPercent(Number.NaN), 0)
})

test('clampSteps clamps values without rounding', () => {
  assert.strictEqual(clampSteps(-1), 0)
  assert.strictEqual(clampSteps(0), 0)
  assert.strictEqual(clampSteps(7.5), 7.5)
  assert.strictEqual(clampSteps(16), 16)
  assert.strictEqual(clampSteps(20), 16)
  assert.strictEqual(clampSteps(Number.NaN), 0)
})

test('stepsToPercent scales steps to percent', () => {
  assert.strictEqual(stepsToPercent(0), 0)
  assert.strictEqual(stepsToPercent(8), 50)
  assert.strictEqual(stepsToPercent(16), 100)
  assert.strictEqual(stepsToPercent(7.5), 47)
})

test('percentToSteps scales percent to steps', () => {
  assert.strictEqual(percentToSteps(0), 0)
  assert.strictEqual(percentToSteps(50), 8)
  assert.strictEqual(percentToSteps(100), 16)
  assert.strictEqual(percentToSteps(12.6), 2)
})

test('stepsFromVolumeValue handles steps or percents', () => {
  assert.strictEqual(stepsFromVolumeValue(12), 12)
  assert.strictEqual(stepsFromVolumeValue(0), 0)
  assert.strictEqual(stepsFromVolumeValue(50), 8)
  assert.strictEqual(stepsFromVolumeValue(18), 3)
  assert.strictEqual(stepsFromVolumeValue(Number.NaN), 0)
})
