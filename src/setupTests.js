import '@testing-library/jest-dom/vitest'

// jsdom doesn't implement scrollIntoView; App calls it on every new message.
Element.prototype.scrollIntoView = () => {}
