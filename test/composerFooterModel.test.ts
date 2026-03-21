import assert from 'node:assert/strict'
import test from 'node:test'
import { resolveComposerFooterLayout } from '../src/components/composerFooterModel.ts'

test('chat footer keeps the tabs counter centered with the menu on the right', () => {
  assert.deepEqual(resolveComposerFooterLayout({ mode: 'chat', searchActive: false }), {
    centerSlot: 'open-tabs',
    leftSlot: 'search',
    navWidth: 'compact',
    rightSlot: 'menu',
    variant: 'chat',
  })
})

test('tabs footer reuses the right-side menu slot instead of browse placeholder copy', () => {
  assert.deepEqual(resolveComposerFooterLayout({ mode: 'tabs', searchActive: false }), {
    centerSlot: 'new-tab',
    leftSlot: 'search',
    navWidth: 'wide',
    rightSlot: 'menu',
    variant: 'tabs',
  })
})

test('search footer expands into full-width search navigation', () => {
  assert.deepEqual(resolveComposerFooterLayout({ mode: 'tabs', searchActive: true }), {
    centerSlot: 'search-status',
    leftSlot: 'search-previous',
    navWidth: 'full',
    rightSlot: 'search-next',
    variant: 'search',
  })
})
