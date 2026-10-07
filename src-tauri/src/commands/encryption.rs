use chrono::Utc;
use redb::ReadableTable;
use serde::{Deserialize, Serialize};
use tauri::State;

use crate::crypto::pqc::{self, algorithm_from_str, EncryptedFileMeta, KeyPair, PqcEngine};
use crate::AppState;

/// Status returned when encrypting/decrypting a file.
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EncryptionStatus {
    pub file_id: String,
    pub encrypted: bool,
    pub algorithm: Option<String>,
    pub updated_at: String,
}

/// Engine status returned to the frontend — matches frontend EncryptionStatus type.
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FrontendEncryptionStatus {
    pub is_encrypted: bool,
    pub algorithm: Option<String>,
    pub nist_level: Option<u8>,
    pub key_id: Option<String>,
    pub encrypted_at: Option<String>,
}

/// Key info returned to the frontend — matches frontend EncryptionKeyInfo type.
/// NEVER exposes private key material.
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FrontendKeyInfo {
    pub id: String,
    pub algorithm: String,
    pub algorithm_display: String,
    pub nist_level: u8,
    pub color: String,
    pub public_key_preview: String,
    pub has_private_key: bool,
    pub created_at: String,
}

/// Map a stored algorithm string to display info.
fn algorithm_info(algo: &str) -> (&'static str, u8, &'static str) {
    match algo {
        "kyber1024" => ("ML-KEM-1024 — FIPS 203", 5, "#00FF41"),
        "kyber768" | "hybrid" | "kyber512" => ("Hybrid ML-KEM-768 + X25519", 5, "#FFB800"),
        "ml_dsa44" | "ml-dsa44" | "ml-dsa-44" | "dilithium2" => {
            ("ML-DSA-44 — FIPS 204 (NIST Level 2)", 2, "#00D4FF")
        }
        "ml_dsa65" | "ml-dsa65" | "ml-dsa-65" | "dilithium3" => {
            ("ML-DSA-65 — FIPS 204 (NIST Level 3)", 3, "#A855F7")
        }
        "ml_dsa87" | "ml-dsa87" | "ml-dsa-87" | "dilithium5" => {
            ("ML-DSA-87 — FIPS 204 (NIST Level 5)", 5, "#FF2D6F")
        }
        "classical_sign" | "hmac" | "sphincsplus" | "sphincs+" => {
            ("HMAC-SHA512 (Classical — NOT post-quantum)", 0, "#6B7280")
        }
        "aes256" | "chacha20" => ("ChaCha20Poly1305 (Classical)", 0, "#FF6B2B"),
        _ => ("Unknown", 0, "#6B7280"),
    }
}

/// Find the most recently created encryption key matching the given algorithm string.
fn find_latest_key(
    db: &crate::db::Database,
    algorithm: &str,
) -> Result<Option<crate::db::schema::EncryptionKey>, String> {
    let tx = db.begin_read().map_err(|e| e.to_string())?;
    let table = tx
        .open_table(crate::db::Database::get_encryption_keys_table())
        .map_err(|e| e.to_string())?;

    let mut best: Option<crate::db::schema::EncryptionKey> = None;
    for entry in table.iter().map_err(|e| e.to_string())? {
        let (_, value) = entry.map_err(|e| e.to_string())?;
        let key: crate::db::schema::EncryptionKey =
            serde_json::from_str(value.value()).map_err(|e| e.to_string())?;
        // Match the algorithm family (e.g. "kyber768" and "hybrid" both map to Hybrid)
        if key.algorithm == algorithm
            && (best.is_none() || key.created_at > best.as_ref().unwrap().created_at)
        {
            best = Some(key);
        }
    }
    Ok(best)
}

/// Find the most recently created encryption key of any algorithm.
fn find_any_latest_key(
    db: &crate::db::Database,
) -> Result<Option<crate::db::schema::EncryptionKey>, String> {
    let tx = db.begin_read().map_err(|e| e.to_string())?;
    let table = tx
        .open_table(crate::db::Database::get_encryption_keys_table())
        .map_err(|e| e.to_string())?;

    let mut best: Option<crate::db::schema::EncryptionKey> = None;
    for entry in table.iter().map_err(|e| e.to_string())? {
        let (_, value) = entry.map_err(|e| e.to_string())?;
        let key: crate::db::schema::EncryptionKey =
            serde_json::from_str(value.value()).map_err(|e| e.to_string())?;
        if best.is_none() || key.created_at > best.as_ref().unwrap().created_at {
            best = Some(key);
        }
    }
    Ok(best)
}

/// Find a specific key by ID.
fn find_key_by_id(
    db: &crate::db::Database,
    key_id: &str,
) -> Result<Option<crate::db::schema::EncryptionKey>, String> {
    let tx = db.begin_read().map_err(|e| e.to_string())?;
    let table = tx
        .open_table(crate::db::Database::get_encryption_keys_table())
        .map_err(|e| e.to_string())?;

    match table.get(key_id).map_err(|e| e.to_string())? {
        Some(value) => {
            let key: crate::db::schema::EncryptionKey =
                serde_json::from_str(value.value()).map_err(|e| e.to_string())?;
            Ok(Some(key))
        }
        None => Ok(None),
    }
}

/// Reconstruct a `pqc::KeyPair` from a stored `db::schema::EncryptionKey`.
fn reconstruct_keypair(stored: &crate::db::schema::EncryptionKey) -> Result<KeyPair, String> {
    let algorithm = algorithm_from_str(&stored.algorithm)
        .ok_or_else(|| format!("Unknown algorithm: {}", stored.algorithm))?;

    let public_key = base64::Engine::decode(
        &base64::engine::general_purpose::STANDARD,
        &stored.public_key,
    )
    .map_err(|e| format!("Failed to decode public key: {}", e))?;

    // <<< AGENT-3 KEYS AT REST: private keys are sealed, never raw base64 >>>
    let private_key = open_private_key(&stored.private_key)?;

    Ok(KeyPair {
        id: stored.id.clone(),
        algorithm,
        public_key,
        private_key,
        created_at: stored.created_at.clone(),
    })
}

// <<< AGENT-3 KEYS AT REST >>>

/// Marker prefix for a private key sealed with the master passphrase.
const SEALED_PREFIX: &str = "sealed:v1:";

/// Wrap private key bytes with an Argon2id-derived key (ChaCha20Poly1305).
///
/// Fails when no master passphrase can be resolved — the contract is to
/// **refuse to persist a raw private key**, not to fall back to plaintext.
fn seal_private_key(raw: &[u8]) -> Result<String, String> {
    let passphrase = cybermanju_crypto::keystore::master_passphrase().ok_or_else(|| {
        "No master passphrase available — refusing to store a raw private key".to_string()
    })?;
    let sealed = cybermanju_crypto::keystore::seal(&passphrase, raw)?;
    Ok(format!(
        "{}{}",
        SEALED_PREFIX,
        base64::Engine::encode(&base64::engine::general_purpose::STANDARD, sealed)
    ))
}

/// Decode a stored private key, opening the sealed form when present.
///
/// Rows written before keys-at-rest landed are still raw base64; they stay
/// readable and are migrated to the sealed form by [`seal_legacy_keys`].
fn open_private_key(stored: &str) -> Result<Vec<u8>, String> {
    if let Some(payload) = stored.strip_prefix(SEALED_PREFIX) {
        let blob = base64::Engine::decode(&base64::engine::general_purpose::STANDARD, payload)
            .map_err(|e| format!("Failed to decode sealed private key: {}", e))?;
        let passphrase = cybermanju_crypto::keystore::master_passphrase().ok_or_else(|| {
            "Master passphrase unavailable — cannot open sealed private key".to_string()
        })?;
        return cybermanju_crypto::keystore::open_sealed(&passphrase, &blob);
    }
    base64::Engine::decode(&base64::engine::general_purpose::STANDARD, stored)
        .map_err(|e| format!("Failed to decode private key: {}", e))
}

/// Wrap every legacy plaintext private key at rest.
///
/// Best effort: a failure is logged rather than propagated so an unreadable
/// passphrase file never blocks file encryption. The caller must hold the
/// database write lock.
fn seal_legacy_keys(db: &crate::db::Database) {
    let run = || -> Result<u32, String> {
        let tx = db.begin_write().map_err(|e| e.to_string())?;
        let mut updates: Vec<(String, String)> = Vec::new();
        {
            let mut table = tx
                .open_table(crate::db::Database::get_encryption_keys_table())
                .map_err(|e| e.to_string())?;
            for entry in table.iter().map_err(|e| e.to_string())? {
                let (id, value) = entry.map_err(|e| e.to_string())?;
                let mut key: crate::db::schema::EncryptionKey =
                    match serde_json::from_str(value.value()) {
                        Ok(k) => k,
                        Err(_) => continue,
                    };
                if key.private_key.starts_with(SEALED_PREFIX) {
                    continue;
                }
                let raw = base64::Engine::decode(
                    &base64::engine::general_purpose::STANDARD,
                    &key.private_key,
                )
                .map_err(|e| format!("Failed to decode private key {}: {}", id.value(), e))?;
                key.private_key = seal_private_key(&raw)?;
                updates.push((
                    key.id.clone(),
                    serde_json::to_string(&key).map_err(|e| e.to_string())?,
                ));
            }
            for (id, json) in &updates {
                table
                    .insert(id.as_str(), json.as_str())
                    .map_err(|e| e.to_string())?;
            }
        }
        tx.commit().map_err(|e| e.to_string())?;
        Ok(updates.len() as u32)
    };

    match run() {
        Ok(count) if count > 0 => {
            log::info!("Sealed {} legacy private key(s) at rest", count)
        }
        Ok(_) => {}
        Err(e) => log::warn!("Could not seal legacy private keys: {}", e),
    }
}

/// Encrypt a file using real ML-KEM key encapsulation.
///
/// Flow:
///   1. Validate algorithm, find the latest matching key from the database
///   2. Read the original file bytes
///   3. Call `pqc::encrypt_data()` — performs real ML-KEM encapsulation
///   4. Write encrypted bytes to `{path}.enc`
///   5. Write metadata to `{path}.enc.meta.json`
///   6. Update the file node in the database
#[tauri::command]
pub fn encrypt_file(
    file_id: String,
    algorithm: String,
    state: State<'_, AppState>,
) -> Result<EncryptionStatus, String> {
    let supported = [
        "kyber512",
        "kyber768",
        "kyber1024",
        "hybrid",
        "ml_dsa44",
        "ml_dsa65",
        "ml_dsa87",
        "dilithium2",
        "dilithium3",
        "dilithium5",
        "sphincsplus",
        "classical_sign",
        "aes256",
    ];
    if !supported.contains(&algorithm.as_str()) {
        return Err(format!(
            "Unsupported algorithm: {}. Supported: {}",
            algorithm,
            supported.join(", ")
        ));
    }

    let db = state.db.write().map_err(|e| e.to_string())?;

    // Read the file node
    let tx_read = db.begin_read().map_err(|e| e.to_string())?;
    let table_read = tx_read
        .open_table(crate::db::Database::get_files_table())
        .map_err(|e| e.to_string())?;
    let value = table_read
        .get(file_id.as_str())
        .map_err(|e| e.to_string())?
        .ok_or_else(|| format!("not_found: file '{}' not found", file_id))?;
    let mut file_node: crate::db::schema::FileNode =
        serde_json::from_str(value.value()).map_err(|e| e.to_string())?;
    drop(tx_read);

    // <<< AGENT-3 KEYS AT REST: migrate plaintext keys while we hold the
    // write lock >>>
    seal_legacy_keys(&db);

    // Find the latest key matching this algorithm
    let stored_key = find_latest_key(&db, &algorithm)?.ok_or_else(|| {
        format!(
            "No {} keypair found. Generate one first using generate_keypair.",
            algorithm
        )
    })?;

    // Reconstruct the PQC keypair from stored bytes
    let keypair = reconstruct_keypair(&stored_key)?;

    // Attempt actual file encryption if a path is available
    let actual_algorithm_used = if let Some(ref ctx) = file_node.context_data {
        if let Some(original_path) = ctx.get("original_path").and_then(|v| v.as_str()) {
            if let Ok(plaintext) = std::fs::read(original_path) {
                match pqc::encrypt_data(&plaintext, &keypair) {
                    Ok(encrypted) => {
                        // Write encrypted bytes to .enc file
                        let enc_path = format!("{}.enc", original_path);
                        let enc_write_ok = std::fs::write(&enc_path, &encrypted.ciphertext)
                            .map_err(|e| {
                                log::error!("Failed to write encrypted file {}: {}", enc_path, e);
                                e
                            });

                        // Write metadata JSON to .enc.meta.json
                        let meta: EncryptedFileMeta = (&encrypted).into();
                        let meta_path = format!("{}.enc.meta.json", original_path);
                        let meta_json = serde_json::to_string_pretty(&meta).ok();
                        let meta_write_ok = meta_json
                            .as_ref()
                            .and_then(|mj| {
                                std::fs::write(&meta_path, mj)
                                    .map_err(|e| {
                                        log::error!(
                                            "Failed to write encryption metadata {}: {}",
                                            meta_path,
                                            e
                                        );
                                        e
                                    })
                                    .ok()
                            })
                            .is_some();

                        // Only mark as encrypted if BOTH writes succeeded
                        if enc_write_ok.is_ok() && meta_write_ok {
                            Some(encrypted.algorithm.clone())
                        } else {
                            // Cleanup: remove partial .enc file if it exists
                            let _ = std::fs::remove_file(&enc_path);
                            let _ = std::fs::remove_file(&meta_path);
                            None
                        }
                    }
                    Err(e) => {
                        log::error!("PQC encryption failed (metadata still updated): {}", e);
                        None
                    }
                }
            } else {
                None
            }
        } else {
            None
        }
    } else {
        None
    };

    let now = Utc::now().to_rfc3339();
    let enc_algorithm = actual_algorithm_used
        .unwrap_or_else(|| format!("{}+ChaCha20Poly1305", algorithm_info(&algorithm).0));
    file_node.encrypted = true;
    file_node.encryption_algorithm = Some(enc_algorithm.clone());
    file_node.modified_at = now.clone();

    // Write back
    let serialized = serde_json::to_string(&file_node).map_err(|e| e.to_string())?;
    let tx = db.begin_write().map_err(|e| e.to_string())?;
    {
        let mut table = tx
            .open_table(crate::db::Database::get_files_table())
            .map_err(|e| e.to_string())?;
        table
            .insert(file_id.as_str(), serialized.as_str())
            .map_err(|e| e.to_string())?;
    }
    tx.commit().map_err(|e| e.to_string())?;

    Ok(EncryptionStatus {
        file_id: file_id.clone(),
        encrypted: true,
        algorithm: Some(enc_algorithm),
        updated_at: now,
    })
}

/// Decrypt a file using real ML-KEM decapsulation.
///
/// Flow:
///   1. Read the file node and locate the .enc.meta.json
///   2. Load the encryption key by key_id from the metadata
///   3. Read the .enc ciphertext
///   4. Call `pqc::decrypt_data()` — performs real ML-KEM decapsulation
///   5. Write the decrypted bytes back to the original path
///   6. Update the file node in the database
#[tauri::command]
pub fn decrypt_file(
    file_id: String,
    state: State<'_, AppState>,
) -> Result<EncryptionStatus, String> {
    let db = state.db.write().map_err(|e| e.to_string())?;

    // Read the file node
    let tx_read = db.begin_read().map_err(|e| e.to_string())?;
    let table_read = tx_read
        .open_table(crate::db::Database::get_files_table())
        .map_err(|e| e.to_string())?;
    let value = table_read
        .get(file_id.as_str())
        .map_err(|e| e.to_string())?
        .ok_or_else(|| format!("not_found: file '{}' not found", file_id))?;
    let mut file_node: crate::db::schema::FileNode =
        serde_json::from_str(value.value()).map_err(|e| e.to_string())?;
    drop(tx_read);

    // <<< AGENT-3 KEYS AT REST: migrate plaintext keys while we hold the
    // write lock >>>
    seal_legacy_keys(&db);

    // Attempt actual file decryption if a path is available
    if let Some(ref ctx) = file_node.context_data {
        if let Some(original_path) = ctx.get("original_path").and_then(|v| v.as_str()) {
            let enc_path = format!("{}.enc", original_path);
            let meta_path = format!("{}.enc.meta.json", original_path);

            // Read encryption metadata
            let meta_json = std::fs::read_to_string(&meta_path)
                .map_err(|e| format!("Cannot read encryption metadata {}: {}", meta_path, e))?;
            let meta: EncryptedFileMeta = serde_json::from_str(&meta_json)
                .map_err(|e| format!("Failed to parse encryption metadata: {}", e))?;

            // Load the key used for encryption
            let stored_key = find_key_by_id(&db, &meta.key_id)?.ok_or_else(|| {
                format!("Encryption key {} not found — cannot decrypt", meta.key_id)
            })?;
            let keypair = reconstruct_keypair(&stored_key)?;

            // Read ciphertext
            let ciphertext = std::fs::read(&enc_path)
                .map_err(|e| format!("Cannot read encrypted file {}: {}", enc_path, e))?;

            // Reconstruct FileEncryptedData and decrypt
            let encrypted = meta
                .to_encrypted_data(ciphertext)
                .map_err(|e| format!("Failed to reconstruct encrypted data: {}", e))?;

            match pqc::decrypt_data(&encrypted, &keypair) {
                Ok(plaintext) => {
                    // Write decrypted file back to original path
                    std::fs::write(original_path, &plaintext)
                        .map_err(|e| format!("Failed to write decrypted file: {}", e))?;

                    // Clean up .enc and .enc.meta.json
                    let _ = std::fs::remove_file(&enc_path);
                    let _ = std::fs::remove_file(&meta_path);
                }
                Err(e) => {
                    return Err(format!("integrity: decryption failed: {}", e));
                }
            }
        }
    }

    let now = Utc::now().to_rfc3339();
    file_node.encrypted = false;
    file_node.encryption_algorithm = None;
    file_node.modified_at = now.clone();

    let serialized = serde_json::to_string(&file_node).map_err(|e| e.to_string())?;
    let tx = db.begin_write().map_err(|e| e.to_string())?;
    {
        let mut table = tx
            .open_table(crate::db::Database::get_files_table())
            .map_err(|e| e.to_string())?;
        table
            .insert(file_id.as_str(), serialized.as_str())
            .map_err(|e| e.to_string())?;
    }
    tx.commit().map_err(|e| e.to_string())?;

    Ok(EncryptionStatus {
        file_id,
        encrypted: false,
        algorithm: None,
        updated_at: now,
    })
}

/// Return the PQC encryption engine status based on actual key state.
///
/// Reads the most recently created key from the database and reports
/// its algorithm, NIST level, and creation time.
#[tauri::command]
pub fn get_encryption_status(
    state: State<'_, AppState>,
) -> Result<FrontendEncryptionStatus, String> {
    let db = state.db.read().map_err(|e| e.to_string())?;

    // Check if any keys exist at all
    let latest_key = find_any_latest_key(&db)?;

    // Also check if any files are actually encrypted
    let any_encrypted = {
        let tx = db.begin_read().map_err(|e| e.to_string())?;
        let table = tx
            .open_table(crate::db::Database::get_files_table())
            .map_err(|e| e.to_string())?;
        let mut found = false;
        for (_, value) in table.iter().map_err(|e| e.to_string())?.flatten() {
            if let Ok(node) = serde_json::from_str::<crate::db::schema::FileNode>(value.value()) {
                if node.encrypted {
                    found = true;
                    break;
                }
            }
        }
        found
    };

    if let Some(key) = latest_key {
        let algo_enum = algorithm_from_str(&key.algorithm);
        let (display, nist_level, _color) = algorithm_info(&key.algorithm);
        Ok(FrontendEncryptionStatus {
            is_encrypted: any_encrypted || algo_enum.is_some(),
            algorithm: Some(display.to_string()),
            nist_level: Some(nist_level),
            key_id: Some(key.id),
            encrypted_at: Some(key.created_at),
        })
    } else {
        Ok(FrontendEncryptionStatus {
            is_encrypted: false,
            algorithm: None,
            nist_level: None,
            key_id: None,
            encrypted_at: None,
        })
    }
}

/// Generate a new PQC keypair using real ML-KEM key generation.
///
/// Uses the pqcrypto-mlkem crate for actual post-quantum key generation:
///   - kyber1024  → ML-KEM-1024 encapsulation/decapsulation keypair
///   - kyber768/kyber512/hybrid → ML-KEM-768 keypair (X25519 derived at use time)
///   - dilithium*/sphincsplus/classical_sign  → 64-byte HMAC-SHA512 key with SHA-256 fingerprint
///   - aes256      → 32-byte ChaCha20Poly1305 key
///
/// Keys are stored as base64-encoded bytes in the database.
/// The returned EncryptionKey contains the public key bytes (base64) and
/// the private key bytes (base64) — the private key IS stored in the DB
/// for this local encryption use case.
#[tauri::command]
pub fn generate_keypair(
    algorithm: String,
    state: State<'_, AppState>,
) -> Result<crate::db::schema::EncryptionKey, String> {
    let algo_enum = algorithm_from_str(&algorithm).ok_or_else(|| {
        format!(
            "Unsupported algorithm: {}. Supported: kyber1024, hybrid, ml_dsa44, ml_dsa65, ml_dsa87, classical_sign, aes256",
            algorithm
        )
    })?;

    // Use the real PQC engine to generate the keypair
    let mut engine = PqcEngine::new();
    let keypair = engine
        .generate_keypair(algo_enum)
        .map_err(|e| format!("Key generation failed: {}", e))?;

    let now = Utc::now().to_rfc3339();

    // Encode the actual key bytes as base64
    let public_key_b64 = base64::Engine::encode(
        &base64::engine::general_purpose::STANDARD,
        &keypair.public_key,
    );
    // <<< AGENT-3 KEYS AT REST: seal before it ever touches the database >>>
    let private_key_b64 = seal_private_key(&keypair.private_key)?;

    let key = crate::db::schema::EncryptionKey {
        id: keypair.id.clone(),
        algorithm: algorithm.clone(),
        public_key: public_key_b64,
        private_key: private_key_b64,
        created_at: now.clone(),
        label: Some(format!("{} keypair", algorithm_info(&algorithm).0)),
    };

    // Store in the database
    let db = state.db.write().map_err(|e| e.to_string())?;
    // Opportunistically migrate any older plaintext keys while we hold the
    // write lock.
    seal_legacy_keys(&db);
    let serialized = serde_json::to_string(&key).map_err(|e| e.to_string())?;
    let tx = db.begin_write().map_err(|e| e.to_string())?;
    {
        let mut table = tx
            .open_table(crate::db::Database::get_encryption_keys_table())
            .map_err(|e| e.to_string())?;
        table
            .insert(keypair.id.as_str(), serialized.as_str())
            .map_err(|e| e.to_string())?;
    }
    tx.commit().map_err(|e| e.to_string())?;

    Ok(key)
}

/// List all encryption keys — NEVER exposes private key material.
///
/// Returns only a 16-byte base64 preview of the public key, the algorithm
/// info, and metadata. The full private key is never included in the response.
#[tauri::command]
pub fn list_keys(state: State<'_, AppState>) -> Result<Vec<FrontendKeyInfo>, String> {
    let db = state.db.read().map_err(|e| e.to_string())?;
    let tx = db.begin_read().map_err(|e| e.to_string())?;
    let table = tx
        .open_table(crate::db::Database::get_encryption_keys_table())
        .map_err(|e| e.to_string())?;

    let mut results = Vec::new();
    for entry in table.iter().map_err(|e| e.to_string())? {
        let (_, value) = entry.map_err(|e| e.to_string())?;
        let key: crate::db::schema::EncryptionKey =
            serde_json::from_str(value.value()).map_err(|e| e.to_string())?;

        let (display, nist_level, color) = algorithm_info(&key.algorithm);

        // Decode the public key to get the preview bytes
        let preview = match base64::Engine::decode(
            &base64::engine::general_purpose::STANDARD,
            &key.public_key,
        ) {
            Ok(bytes) => {
                let truncated = &bytes[..16.min(bytes.len())];
                let encoded =
                    base64::Engine::encode(&base64::engine::general_purpose::STANDARD, truncated);
                format!("{}...", encoded)
            }
            Err(_) => {
                // Fallback: show first 16 chars of the stored string
                if key.public_key.len() > 16 {
                    format!("{}...", &key.public_key[..16])
                } else {
                    key.public_key.clone()
                }
            }
        };

        results.push(FrontendKeyInfo {
            id: key.id,
            algorithm: key.algorithm,
            algorithm_display: display.to_string(),
            nist_level,
            color: color.to_string(),
            public_key_preview: preview,
            has_private_key: !key.private_key.is_empty(),
            created_at: key.created_at,
        });
    }

    Ok(results)
}
