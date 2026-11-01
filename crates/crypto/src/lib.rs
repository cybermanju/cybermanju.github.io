// CyberManju OS — Lib (crates/crypto/src/lib.rs).
// Role: ChaCha20Poly1305 + ML-KEM/DSS + Argon2id + BLAKE3 + CYBMJ01 backup containers.
// Exports: keystore, pqc, container.
// Integrates: standalone (no imports).
// Contracts: none special (pure logic; errors bubble to caller).
pub mod container;
pub mod keystore;
#[cfg(feature = "pqc")]
pub mod pqc;

#[cfg(feature = "pqc")]
pub use pqc::*;
