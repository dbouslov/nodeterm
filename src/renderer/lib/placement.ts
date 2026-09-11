// The engine moved to src/shared/placement so the Server Edition's headless factory shares it.
// Re-exported here so existing renderer imports (and this file's test) are untouched.
export { freeSpot, type Box } from '@shared/placement'
