import '@testing-library/jest-dom/vitest'

// jsdom doesn't implement scrollIntoView; App calls it on every new message.
// Guarded: this setup file also runs for server/*.e2e.test.js, which opts
// into the plain Node environment (no Element global) via a
// `@vitest-environment node` docblock.
if (typeof Element !== 'undefined') {
  Element.prototype.scrollIntoView = () => {}
}
