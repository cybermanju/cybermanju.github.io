// CyberManju OS — Lib (crates/crypto/src/lib.rs).
// Role: ChaCha20Poly1305 + ML-KEM/DSS + Argon2id + BLAKE3.
// Exports: keystore, pqc.
// Integrates: standalone (no imports).
// Contracts: none special (pure logic; errors bubble to caller).
pub mod keystore;
pub mod pqc;

pub use pqc::*;
