/**
 * @fileoverview Volume scaling helpers for converting between steps and percents.
 */

export const DEFAULT_VOLUME_STEPS = 16

/**
 * Clamp a percent value to 0-100 (rounded).
 * @param {number} value
 * @returns {number}
 */
export function clampPercent (value) {
  const normalized = Number.isFinite(value) ? value : 0
  return Math.max(0, Math.min(Math.round(normalized), 100))
}

/**
 * Clamp a steps value to 0-maxSteps (preserves fractional input).
 * @param {number} value
 * @param {number} [maxSteps=DEFAULT_VOLUME_STEPS]
 * @returns {number}
 */
export function clampSteps (value, maxSteps = DEFAULT_VOLUME_STEPS) {
  const normalized = Number.isFinite(value) ? value : 0
  return Math.max(0, Math.min(normalized, maxSteps))
}

/**
 * Convert steps to percent.
 * @param {number} steps
 * @param {number} [maxSteps=DEFAULT_VOLUME_STEPS]
 * @returns {number}
 */
export function stepsToPercent (steps, maxSteps = DEFAULT_VOLUME_STEPS) {
  const clampedSteps = clampSteps(steps, maxSteps)
  return Math.round((clampedSteps / maxSteps) * 100)
}

/**
 * Convert percent to steps.
 * @param {number} percent
 * @param {number} [maxSteps=DEFAULT_VOLUME_STEPS]
 * @returns {number}
 */
export function percentToSteps (percent, maxSteps = DEFAULT_VOLUME_STEPS) {
  const normalizedPercent = clampPercent(percent)
  return Math.round((normalizedPercent / 100) * maxSteps)
}

/**
 * Normalize a volume value that may be in steps or percent into steps.
 * @param {number} value
 * @param {number} [maxSteps=DEFAULT_VOLUME_STEPS]
 * @returns {number}
 */
export function stepsFromVolumeValue (value, maxSteps = DEFAULT_VOLUME_STEPS) {
  const normalized = Number.isFinite(value) ? value : 0

  if (normalized <= maxSteps) {
    return Math.round(clampSteps(normalized, maxSteps))
  }

  return percentToSteps(normalized, maxSteps)
}
