// CyberManju OS — Keystore
//
// Passphrase-derived keys at rest: Argon2id key derivation + ChaCha20Poly1305
// AEAD. This module is the single source of truth for the machine-local
// master passphrase, the `KeyHandle` API AGENT-2 consumes, and the
// `seal`/`open_sealed` primitives used to wrap encryption private keys and
// stored OAuth credentials.
//
// <<< AGENT-3 KEYS AT REST >>>

use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
use chacha20poly1305::{
    aead::{Aead, KeyInit as AeadKeyInit},
    ChaCha20Poly1305, Nonce,
};
use rand_core::RngCore;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

// ─── Parameters ───────────────────────────────────────────────────────

/// OWASP Argon2id parameters — identical to the password-hash settings so
/// every derived key in the product costs the same to attack.
const ARGON2_M_COST: u32 = 19_456;
const ARGON2_T_COST: u32 = 2;
const ARGON2_P_COST: u32 = 1;
const ARGON2_OUTPUT_LEN: usize = 32;

/// AEAD nonce length (ChaCha20-Poly1305, 96-bit).
const NONCE_LEN: usize = 12;
/// Random data-encryption-key length.
const KEY_LEN: usize = 32;
/// Salt length for Argon2id.
const SALT_LEN: usize = 16;

// ─── Master passphrase ────────────────────────────────────────────────

/// Resolve the directory used for persisted secrets.
///
/// Order: `CYBERMANJU_DATA_DIR` → parent of `DB_PATH` → platform data dir →
/// `~/.cybermanju`. `None` when nothing resolves (nothing can be persisted).
pub fn data_dir() -> Option<PathBuf> {
    if let Ok(dir) = std::env::var("CYBERMANJU_DATA_DIR") {
        if !dir.trim().is_empty() {
            return Some(PathBuf::from(dir));
        }
    }
    if let Ok(path) = std::env::var("DB_PATH") {
        if let Some(parent) = Path::new(&path).parent() {
            if !parent.as_os_str().is_empty() {
                return Some(parent.to_path_buf());
            }
        }
    }
    #[cfg(windows)]
    {
        if let Ok(dir) = std::env::var("APPDATA") {
            return Some(PathBuf::from(dir).join("CyberManjuOS"));
        }
    }
    #[cfg(target_os = "macos")]
    {
        if let Ok(home) = std::env::var("HOME") {
            return Some(PathBuf::from(home).join("Library/Application Support/CyberManjuOS"));
        }
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        if let Ok(home) = std::env::var("HOME") {
            return Some(
                std::env::var("XDG_DATA_HOME")
                    .map(PathBuf::from)
                    .unwrap_or_else(|_| PathBuf::from(&home).join(".local/share"))
                    .join("cybermanju-os"),
            );
        }
    }
    std::env::var("HOME")
        .ok()
        .map(|home| PathBuf::from(home).join(".cybermanju"))
        .or_else(|| Some(std::env::temp_dir().join("cybermanju")))
}

/// Resolve the machine-local master passphrase.
///
/// Order: `CYBERMANJU_MASTER_PASSPHRASE` → `<data dir>/master.passphrase`
/// (generated on first use, 0600) → `None`.
pub fn master_passphrase() -> Option<String> {
    if let Ok(passphrase) = std::env::var("CYBERMANJU_MASTER_PASSPHRASE") {
        if !passphrase.trim().is_empty() {
            return Some(passphrase);
        }
    }
    let dir = data_dir()?;
    let path = dir.join("master.passphrase");
    // A present-but-unreadable file must fail closed: generating a fresh
    // passphrase over it would orphan everything sealed under the old one.
    if path.exists() && !secret_file_mode_ok(&path) {
        return None;
    }
    if let Some(existing) = read_secret_file(&path) {
        if !existing.is_empty() {
            return Some(existing);
        }
    }
    let mut raw = [0u8; 32];
    rand_core::OsRng.fill_bytes(&mut raw);
    let encoded = BASE64.encode(raw);
    write_secret_file(&path, &encoded).ok()?;
    log::info!("master passphrase created at {}", path.display());
    Some(encoded)
}

/// Fail-closed permission gate: a secret file readable by group/other is
/// refused (fail-closed) instead of silently trusted. Non-unix platforms
/// skip the check (no mode bits to inspect).
fn secret_file_mode_ok(path: &Path) -> bool {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        match std::fs::metadata(path) {
            Ok(meta) if meta.permissions().mode() & 0o077 == 0 => true,
            Ok(_) => {
                log::warn!(
                    "refusing world/group-readable secret file {} (fix with chmod 600)",
                    path.display()
                );
                false
            }
            Err(_) => false,
        }
    }
    #[cfg(not(unix))]
    {
        let _ = path;
        true
    }
}

fn read_secret_file(path: &Path) -> Option<String> {
    if !secret_file_mode_ok(path) {
        return None;
    }
    std::fs::read_to_string(path)
        .ok()
        .map(|s| s.chars().filter(|c| !c.is_whitespace()).collect::<String>())
}

fn write_secret_file(path: &Path, contents: &str) -> std::io::Result<()> {
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let _ = std::fs::set_permissions(parent, std::fs::Permissions::from_mode(0o700));
        }
    }
    std::fs::write(path, contents)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600));
    }
    Ok(())
}

// ─── KeyHandle API ────────────────────────────────────────────────────

/// An opaque handle to a 32-byte key stored at rest.
///
/// The key itself never appears in this struct: it is a randomly generated
/// data key wrapped by an Argon2id-derived key-encryption key.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct KeyHandle {
    /// Caller-chosen identifier (e.g. `"master"` or a file-key id).
    pub id: String,
    /// base64 Argon2id salt for the key-encryption key.
    pub salt: String,
    /// base64 AEAD nonce used to wrap `ciphertext`.
    pub nonce: String,
    /// base64 wrapped 32-byte data key.
    pub ciphertext: String,
}

/// Get the handle for `id`, deriving and persisting one on first use.
///
/// The handle is only accepted back when `passphrase` still opens it; a
/// changed passphrase re-wraps a freshly generated key (the old key is
/// unrecoverable without the old passphrase — that is the point).
pub fn get_or_derive(id: &str, passphrase: &str) -> Result<KeyHandle, String> {
    if id.trim().is_empty() {
        return Err("keystore id is required".to_string());
    }
    if let Some(handle) = load_handle(id) {
        if open(&handle, passphrase).is_ok() {
            return Ok(handle);
        }
        log::warn!(
            "keystore entry '{}' did not open with the current passphrase; re-wrapping",
            id
        );
    }

    let mut salt = [0u8; SALT_LEN];
    rand_core::OsRng.fill_bytes(&mut salt);
    let kek = derive_key(passphrase, &salt)?;

    let mut data_key = [0u8; KEY_LEN];
    rand_core::OsRng.fill_bytes(&mut data_key);

    let (nonce, ciphertext) = seal_with_key(&kek, &data_key)?;
    let handle = KeyHandle {
        id: id.to_string(),
        salt: BASE64.encode(salt),
        nonce: BASE64.encode(nonce),
        ciphertext: BASE64.encode(ciphertext),
    };
    save_handle(&handle)?;
    Ok(handle)
}

/// Open a handle and return the raw 32-byte key it wraps.
pub fn open(handle: &KeyHandle, passphrase: &str) -> Result<[u8; 32], String> {
    let salt = decode(&handle.salt, "salt")?;
    let nonce = decode(&handle.nonce, "nonce")?;
    let ciphertext = decode(&handle.ciphertext, "ciphertext")?;

    let kek = derive_key(passphrase, &salt)?;
    let plaintext = open_with_key(&kek, &nonce, &ciphertext)?;
    <[u8; 32]>::try_from(plaintext.as_slice())
        .map_err(|_| "keystore payload is not a 32-byte key".to_string())
}

/// Forget a handle.
pub fn remove(id: &str) -> Result<(), String> {
    let path = handle_path()?;
    let mut handles = load_handles();
    if handles.remove(id).is_some() {
        write_handles(&path, &handles)?;
    }
    Ok(())
}

// ─── AEAD helpers ─────────────────────────────────────────────────────

/// Encrypt `plaintext` under `passphrase`.
///
/// Returns `nonce || ciphertext` (12 bytes prepended).
pub fn seal(passphrase: &str, plaintext: &[u8]) -> Result<Vec<u8>, String> {
    let mut salt = [0u8; SALT_LEN];
    rand_core::OsRng.fill_bytes(&mut salt);
    let key = derive_key(passphrase, &salt)?;
    let (nonce, ciphertext) = seal_with_key(&key, plaintext)?;
    let mut out = Vec::with_capacity(SALT_LEN + NONCE_LEN + ciphertext.len());
    out.extend_from_slice(&salt);
    out.extend_from_slice(&nonce);
    out.extend_from_slice(&ciphertext);
    Ok(out)
}

/// Decrypt a blob produced by [`seal`].
pub fn open_sealed(passphrase: &str, blob: &[u8]) -> Result<Vec<u8>, String> {
    if blob.len() < SALT_LEN + NONCE_LEN + 16 {
        return Err("sealed blob is too short".to_string());
    }
    let (salt, rest) = blob.split_at(SALT_LEN);
    let (nonce, ciphertext) = rest.split_at(NONCE_LEN);
    let key = derive_key(passphrase, salt)?;
    open_with_key(&key, nonce, ciphertext)
}

/// [`seal`] with a base64 result — convenient for JSON columns.
pub fn seal_str(passphrase: &str, plaintext: &[u8]) -> Result<String, String> {
    seal(passphrase, plaintext).map(|bytes| BASE64.encode(bytes))
}

/// [`open_sealed`] for a base64 blob produced by [`seal_str`].
pub fn open_sealed_str(passphrase: &str, encoded: &str) -> Result<String, String> {
    let blob = decode(encoded, "sealed blob")?;
    let plain = open_sealed(passphrase, &blob)?;
    String::from_utf8(plain).map_err(|_| "sealed blob is not UTF-8".to_string())
}

fn seal_with_key(key: &[u8], plaintext: &[u8]) -> Result<([u8; NONCE_LEN], Vec<u8>), String> {
    let cipher = cipher(key)?;
    let mut nonce = [0u8; NONCE_LEN];
    rand_core::OsRng.fill_bytes(&mut nonce);
    let ciphertext = cipher
        .encrypt(Nonce::from_slice(&nonce), plaintext)
        .map_err(|_| "encryption failed".to_string())?;
    Ok((nonce, ciphertext))
}

fn open_with_key(key: &[u8], nonce: &[u8], ciphertext: &[u8]) -> Result<Vec<u8>, String> {
    if nonce.len() != NONCE_LEN {
        return Err("invalid nonce length".to_string());
    }
    let cipher = cipher(key)?;
    cipher
        .decrypt(Nonce::from_slice(nonce), ciphertext)
        .map_err(|_| "decryption failed: wrong passphrase or corrupted data".to_string())
}

fn cipher(key: &[u8]) -> Result<ChaCha20Poly1305, String> {
    if key.len() != KEY_LEN {
        return Err("invalid key length".to_string());
    }
    ChaCha20Poly1305::new_from_slice(key)
        .map_err(|e| format!("invalid ChaCha20Poly1305 key: {}", e))
}

/// Argon2id key derivation with pinned parameters.
pub fn derive_key(passphrase: &str, salt: &[u8]) -> Result<[u8; 32], String> {
    use argon2::{Algorithm, Argon2, Params, Version};

    let params = Params::new(
        ARGON2_M_COST,
        ARGON2_T_COST,
        ARGON2_P_COST,
        Some(ARGON2_OUTPUT_LEN),
    )
    .map_err(|e| format!("Invalid Argon2 parameters: {}", e))?;
    let argon = Argon2::new(Algorithm::Argon2id, Version::V0x13, params);
    let mut out = [0u8; ARGON2_OUTPUT_LEN];
    argon
        .hash_password_into(passphrase.as_bytes(), salt, &mut out)
        .map_err(|e| format!("Argon2 derivation failed: {}", e))?;
    Ok(out)
}

// ─── Handle persistence ───────────────────────────────────────────────

fn handle_path() -> Result<PathBuf, String> {
    data_dir()
        .map(|dir| dir.join("keystore.json"))
        .ok_or_else(|| "No data directory available for the keystore".to_string())
}

fn load_handles() -> std::collections::HashMap<String, KeyHandle> {
    let path = match data_dir() {
        Some(dir) => dir.join("keystore.json"),
        None => return Default::default(),
    };
    let raw = match std::fs::read_to_string(path) {
        Ok(raw) => raw,
        Err(_) => return Default::default(),
    };
    serde_json::from_str(&raw).unwrap_or_default()
}

fn load_handle(id: &str) -> Option<KeyHandle> {
    load_handles().remove(id)
}

fn save_handle(handle: &KeyHandle) -> Result<(), String> {
    let path = handle_path()?;
    let mut handles = load_handles();
    handles.insert(handle.id.clone(), handle.clone());
    write_handles(&path, &handles)
}

fn write_handles(
    path: &Path,
    handles: &std::collections::HashMap<String, KeyHandle>,
) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let _ = std::fs::set_permissions(parent, std::fs::Permissions::from_mode(0o700));
        }
    }
    let encoded = serde_json::to_string(handles).map_err(|e| e.to_string())?;
    std::fs::write(path, encoded)
        .map_err(|e| format!("Could not write {}: {}", path.display(), e))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600));
    }
    Ok(())
}

fn decode(value: &str, what: &str) -> Result<Vec<u8>, String> {
    BASE64
        .decode(value)
        .map_err(|_| format!("keystore {} is not valid base64", what))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn seal_round_trip() {
        let blob = seal("hunter2", b"private key bytes").unwrap();
        // The plaintext must not survive in the clear.
        assert!(!blob.windows(16).any(|w| w == b"private key byte"));
        let back = open_sealed("hunter2", &blob).unwrap();
        assert_eq!(back, b"private key bytes");
    }

    #[test]
    fn seal_rejects_wrong_passphrase() {
        let blob = seal("hunter2", b"secret").unwrap();
        assert!(open_sealed("wrong", &blob).is_err());
    }

    #[test]
    fn seal_str_round_trip() {
        let encoded = seal_str("pw", b"{\"a\":1}").unwrap();
        let back = open_sealed_str("pw", &encoded).unwrap();
        assert_eq!(back, "{\"a\":1}");
    }

    #[test]
    fn derive_key_is_deterministic() {
        let a = derive_key("pw", b"0123456789abcdef").unwrap();
        let b = derive_key("pw", b"0123456789abcdef").unwrap();
        assert_eq!(a, b);
        let c = derive_key("pw", b"fedcba9876543210").unwrap();
        assert_ne!(a, c);
    }
}
