/**
 * @fileoverview Utility functions for the plugin
 *
 * Includes code adapted from `homebridge-plugin-utils`:
 * - Source: https://github.com/hjdhjd/homebridge-plugin-utils/blob/main/src/util.ts
 *
 * ISC License
 * ===========
 *
 * Copyright (c) 2017-2025, HJD https://github.com/hjdhjd
 *
 * Permission to use, copy, modify, and/or distribute this software for any purpose
 * with or without fee is hereby granted, provided that the above copyright notice
 * and this permission notice appear in all copies.
 *
 * THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH
 * REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY AND
 * FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY SPECIAL, DIRECT,
 * INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES WHATSOEVER RESULTING FROM LOSS
 * OF USE, DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR OTHER
 * TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR PERFORMANCE OF
 * THIS SOFTWARE.
 */

/**
 * Sanitize an accessory/service name according to HomeKit naming conventions.
 *
 * Starts and ends with a letter or number. Exception: may end with a period.
 * May have the following special characters: -"',.#&.
 * Must not include emojis.
 *
 * @param {string} name - The name to sanitize
 * @returns {string} The HomeKit-sanitized version of the name
 */
export function sanitizeName (name) {
  return name
    // Replace any disallowed char (including emojis) with a space.
    .replace(/[^\p{L}\p{N}\-"'.,#&\s]/gu, ' ')
    // Collapse multiple spaces to one.
    .replace(/\s+/g, ' ')
    // Trim spaces at the beginning and end of the string.
    .trim()
    // Strip any leading non-letter/number.
    .replace(/^[^\p{L}\p{N}]+/u, '')
    // Collapse two or more trailing periods into one.
    .replace(/\.{2,}$/g, '.')
    // Remove any other trailing char that's not letter/number/period.
    .replace(/[^\p{L}\p{N}.]$/u, '')
}
