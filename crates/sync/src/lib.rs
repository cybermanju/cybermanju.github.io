// CyberManju OS — Storage Sync Engine
// Shared by the Tauri desktop app, the web dashboard and the Docker server.
//
// Single source of truth for:
//   * the sync models (re-exported from cybermanju-types)
//   * the five storage backends
//   * the OAuth2 token refresh helpers
//   * the scan → compress → upload → link pipeline

pub mod backends;
// <<< AGENT-2 MODS: chunk manifest + striped placement (item 10), >>>
// <<< AGENT-2 MODS: auto-sync scheduler (item 11) >>>
pub mod manifest;
pub mod oauth;
pub mod pipeline;
// <<< AGENT-1 MODS: transport reliability >>>
pub mod quota;
pub mod rate_limit;
pub mod retry;
// <<< AGENT-2 MODS: auto-sync scheduler >>>
pub mod scheduler;
pub mod state;
pub mod transfer;
// <<< AGENT-7 MODS: durability, repair, erasure coding, catalog, provider
// health, chunk GC/eviction/rebalance and multi-writer leases >>>
pub mod gc;
pub mod health;
pub mod lease;
pub mod repair;
pub mod scrub;

pub use backends::{create_backend, create_repository, CreateRepoInput, CreatedRepo};
pub use cybermanju_types::sync::*;
pub use pipeline::SyncPipeline;
pub use state::SyncState;
// <<< AGENT-1 RE-EXPORTS: the contract other agents consume >>>
pub use quota::{usage as quota_usage, QuotaUsage};
pub use retry::{classify as classify_error, ErrorClass, RetryPolicy};
pub use transfer::{blake3_hex, verify_blake3};
