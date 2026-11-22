import assert from 'node:assert/strict'
import { test } from 'node:test'
import { revenue, rows } from '../src/report.js'

test('revenue is units times price', () => {
  assert.equal(revenue(rows[0]), 30)
})
