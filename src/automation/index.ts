// CyberManju OS — Automation entry point (src/automation/index.ts).
// Role: Public API of the isolated Shortcuts-style workflow engine.
// Exports: Versioned schema, runner, optional actions and bounded HTTP transport.
// Integrates: Host application and separately implemented Android native bridge.
// Contracts: No UI/native side effects on import; host must provide policy and journal.
export * from './schema'
export * from './runner'
export * from './actions'
export * from './nativeActions'
export * from './http'
export * from './storage'
export * from './repository'
export * from './service'
export * from './host'
