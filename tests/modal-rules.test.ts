import test from 'node:test'
import assert from 'node:assert/strict'
import { modalDismissal } from '../src/services/modalRules.ts'
for (const trigger of ['X', 'Escape', 'exterior', 'Volver']) test(`cierre ${trigger}: lectura, cambios y transaccion`, () => {
  assert.equal(modalDismissal(false, false, false), 'close')
  assert.equal(modalDismissal(false, true, true), 'confirm')
  assert.equal(modalDismissal(true, false, false), 'blocked')
  assert.equal(modalDismissal(true, true, true), 'blocked')
})
