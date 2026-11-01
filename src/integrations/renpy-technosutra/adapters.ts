// CyberManju OS — Technosutra adapters (src/integrations/renpy-technosutra/adapters.ts).
// Role: define narrow capability contracts for future PDF text extraction and the owner's external voice app.
// Exports: PdfTextAdapter, VoiceOutputAdapter and integration readiness markers.
// Integrates: browser File type and standalone application-owned adapters.
// Contracts: no adapter is registered or invoked until its real implementation is supplied and reviewed.

/** A future, explicitly connected parser may extract text from a user-selected PDF. */
export interface PdfTextAdapter {
  readonly id: string
  extractText(file: File): Promise<string>
}

/** The future owner-supplied voice app adapter; voice generation/playback is not fabricated here. */
export interface VoiceOutputAdapter {
  readonly id: string
  speak(text: string, language?: string): Promise<void>
  stop(): Promise<void>
}

/** Readiness labels consumed by the Technosutra panel. */
export const integrationReadiness = {
  pdfText: 'awaiting-adapter',
  voiceOutput: 'awaiting-owner-app',
} as const
