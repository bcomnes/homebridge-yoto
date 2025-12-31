import { test } from 'node:test'
import assert from 'node:assert/strict'
import homebridgeYoto from './index.js'

test('exports default function', () => {
  assert.strictEqual(typeof homebridgeYoto, 'function')
})
