// CyberManju OS — User Management & File Permission Commands
// Role-based access control: admin | user | viewer
// Per-file permissions: read | write | admin
// Password hashing: argon2id (cryptographically secure, salted, key-stretched)
// Session tokens: HMAC-SHA256 with 24-hour expiry (not forgeable)

use chrono::Utc;
use redb::ReadableTable;
use serde::{Deserialize, Serialize};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::State;

use crate::db::schema::{User, UserFilePermission};
use crate::AppState;

use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
use hmac::{Hmac, Mac};
use sha2::Sha256;

type HmacSha256 = Hmac<Sha256>;

/// Token validity window: 24 hours in milliseconds
const TOKEN_EXPIRY_MS: u64 = 24 * 60 * 60 * 1000;

/// Auth result matching the frontend AuthResult type.
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AuthResult {
    pub user_id: String,
    pub username: String,
    pub role: String,
    pub display_name: Option<String>,
    pub token: String,
}

// ---------------------------------------------------------------------------
// Session token: HMAC-SHA256 with expiry
// ---------------------------------------------------------------------------

/// Generate a cryptographically secure session token.
///
/// Token format (binary, base64-encoded):
///   [username_len: u16 BE] [username: bytes] [timestamp: u64 BE]
///   [nonce: 16 bytes] [hmac: 32 bytes]
///
/// The HMAC is computed over: username_bytes || timestamp_bytes || nonce_bytes
/// using the server's HMAC_SECRET. Without the secret, the token cannot be
/// forged even if the format is known.
///
/// Tokens expire after 24 hours.
fn generate_session_token(username: &str, hmac_secret: &[u8]) -> String {
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0);

    // 16-byte cryptographic nonce — prevents token reuse / precomputation attacks
    let mut nonce = [0u8; 16];
    use rand_core::RngCore;
    let mut rng = rand_core::OsRng;
    rng.fill_bytes(&mut nonce);

    let username_bytes = username.as_bytes();
    let username_len = username_bytes.len() as u16;

    // HMAC input: username || timestamp || nonce
    let mut hmac_input = Vec::with_capacity(username_bytes.len() + 8 + 16);
    hmac_input.extend_from_slice(username_bytes);
    hmac_input.extend_from_slice(&timestamp.to_be_bytes());
    hmac_input.extend_from_slice(&nonce);

    let mut mac =
        HmacSha256::new_from_slice(hmac_secret).expect("HMAC-SHA256 accepts any key length");
    mac.update(&hmac_input);
    let hmac_bytes = mac.finalize().into_bytes();

    // Assemble token: [u16 len] [username] [u64 timestamp] [16 nonce] [32 hmac]
    let mut token_bytes = Vec::with_capacity(2 + username_bytes.len() + 8 + 16 + 32);
    token_bytes.extend_from_slice(&username_len.to_be_bytes());
    token_bytes.extend_from_slice(username_bytes);
    token_bytes.extend_from_slice(&timestamp.to_be_bytes());
    token_bytes.extend_from_slice(&nonce);
    token_bytes.extend_from_slice(&hmac_bytes);

    BASE64.encode(&token_bytes)
}

/// Verify a session token and extract the username.
///
/// Returns `Ok((username, timestamp_ms))` if the token is valid and not expired.
/// Returns `Err` with a descriptive message if:
///   - The token is malformed (bad base64, wrong length)
///   - The HMAC signature doesn't match (forged token)
///   - The token has expired (>24 hours old)
pub fn verify_session_token(token: &str, hmac_secret: &[u8]) -> Result<(String, u64), String> {
    let token_bytes = BASE64
        .decode(token)
        .map_err(|_| "Invalid token: bad base64 encoding".to_string())?;

    // Minimum: 2 (len) + 0 (username) + 8 (timestamp) + 16 (nonce) + 32 (hmac) = 58
    if token_bytes.len() < 58 {
        return Err("Invalid token: too short".to_string());
    }

    let username_len = u16::from_be_bytes(
        token_bytes[0..2]
            .try_into()
            .map_err(|_| "Invalid token: malformed header".to_string())?,
    ) as usize;

    let expected_len = 2 + username_len + 8 + 16 + 32;
    if token_bytes.len() != expected_len {
        return Err(format!(
            "Invalid token: length mismatch (expected {}, got {})",
            expected_len,
            token_bytes.len()
        ));
    }

    // Extract fields
    let username = String::from_utf8(token_bytes[2..2 + username_len].to_vec())
        .map_err(|_| "Invalid token: username is not valid UTF-8".to_string())?;

    let timestamp = u64::from_be_bytes(
        token_bytes[2 + username_len..2 + username_len + 8]
            .try_into()
            .map_err(|_| "Invalid token: malformed timestamp".to_string())?,
    );

    let nonce = &token_bytes[2 + username_len + 8..2 + username_len + 8 + 16];
    let stored_hmac = &token_bytes[2 + username_len + 8 + 16..];

    // Check expiry (24 hours)
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0);

    if now > timestamp.saturating_add(TOKEN_EXPIRY_MS) {
        return Err(format!(
            "Token expired (issued {} ms ago, max {} ms)",
            now.saturating_sub(timestamp),
            TOKEN_EXPIRY_MS
        ));
    }

    // Recompute HMAC over the same input and verify in constant time
    // Using Mac::verify_slice which computes HMAC and compares without
    // leaking timing information.
    let mut hmac_input = Vec::with_capacity(username_len + 8 + 16);
    hmac_input.extend_from_slice(&token_bytes[2..2 + username_len]);
    hmac_input.extend_from_slice(&timestamp.to_be_bytes());
    hmac_input.extend_from_slice(nonce);

    let mut mac =
        HmacSha256::new_from_slice(hmac_secret).expect("HMAC-SHA256 accepts any key length");
    mac.update(&hmac_input);

    // verify_slice performs constant-time comparison internally
    mac.verify_slice(stored_hmac)
        .map_err(|_| "Invalid token: signature verification failed".to_string())?;

    Ok((username, timestamp))
}

// ---------------------------------------------------------------------------
// Tauri commands
// ---------------------------------------------------------------------------

/// Register a new user (arg validation + persistence live in the shared API).
#[tauri::command]
pub fn register_user(
    username: String,
    password: String,
    display_name: Option<String>,
    role: Option<String>,
    state: State<'_, AppState>,
) -> Result<User, String> {
    let db = state.db.write().map_err(|e| e.to_string())?;
    // <<< AGENT-3 IDENTITY: desktop IPC is a trusted local transport, so it
    // keeps full role freedom; the HTTP path is Bootstrap/AdminCreated. >>>
    cybermanju_web::api::users::register(
        &db,
        username,
        password,
        display_name,
        role,
        cybermanju_web::api::users::RegistrationMode::LocalIpc,
    )
}

#[tauri::command]
pub fn authenticate_user(
    username: String,
    password: String,
    state: State<'_, AppState>,
) -> Result<AuthResult, String> {
    // <<< AGENT-3 IDENTITY: one shared verification path for both transports
    // — argon2id with pinned parameters plus the legacy BLAKE3 migration,
    // living in `cybermanju_web::api::users` so HTTP and Tauri behave
    // identically. The write lock is taken up front because a legacy hash is
    // upgraded in place; taking read-then-write on the same thread deadlocks
    // on `std::sync::RwLock`. >>>
    let db = state.db.write().map_err(|e| e.to_string())?;
    let outcome = cybermanju_web::api::users::authenticate(&db, &username, &password)?;
    if outcome.upgraded {
        log::info!(
            "Upgraded legacy BLAKE3 password hash to argon2id for user '{}'",
            username
        );
    }

    // Generate HMAC-signed, non-forgeable session token
    let user = outcome.user;
    let token = generate_session_token(&user.username, &state.hmac_secret);
    Ok(AuthResult {
        user_id: user.id,
        username: user.username,
        role: user.role,
        display_name: user.display_name,
        token,
    })
}

/// Verify a session token — returns the username and timestamp if valid.
///
/// This is a separate command so the frontend (or any caller) can validate
/// tokens without performing a full authentication.
#[tauri::command]
pub fn verify_token(
    token: String,
    state: State<'_, AppState>,
) -> Result<serde_json::Value, String> {
    match verify_session_token(&token, &state.hmac_secret) {
        Ok((username, timestamp)) => Ok(serde_json::json!({
            "valid": true,
            "username": username,
            "issued_at": timestamp,
            "expires_at": timestamp + TOKEN_EXPIRY_MS,
        })),
        Err(e) => Ok(serde_json::json!({
            "valid": false,
            "error": e,
        })),
    }
}

/// List all registered users.
#[tauri::command]
pub fn list_users(state: State<'_, AppState>) -> Result<Vec<User>, String> {
    let db = state.db.read().map_err(|e| e.to_string())?;
    let tx = db.begin_read().map_err(|e| e.to_string())?;
    let table = tx
        .open_table(crate::db::Database::get_users_table())
        .map_err(|e| e.to_string())?;

    let mut results = Vec::new();
    for entry in table.iter().map_err(|e| e.to_string())? {
        let (_, value) = entry.map_err(|e| e.to_string())?;
        let user: User = serde_json::from_str(value.value()).map_err(|e| e.to_string())?;
        results.push(user);
    }

    Ok(results)
}

/// Alias for set_file_permission — frontend calls this as grant_file_permission.
#[tauri::command]
pub fn grant_file_permission(
    user_id: String,
    file_id: String,
    access: String,
    granted_by: String,
    state: State<'_, AppState>,
) -> Result<crate::db::schema::UserFilePermission, String> {
    set_file_permission(user_id, file_id, access, granted_by, state)
}

/// Grant a file permission to a user (aliased as grant_file_permission for frontend).
#[tauri::command]
pub fn set_file_permission(
    user_id: String,
    file_id: String,
    access: String,
    granted_by: String,
    state: State<'_, AppState>,
) -> Result<UserFilePermission, String> {
    if !["read", "write", "admin"].contains(&access.as_str()) {
        return Err(format!(
            "Invalid access level: {}. Must be read, write, or admin",
            access
        ));
    }

    let db = state.db.write().map_err(|e| e.to_string())?;
    let now = Utc::now().to_rfc3339();
    let perm_id = uuid::Uuid::new_v4().to_string();

    // Check if a permission already exists for this user+file
    let tx_read = db.begin_read().map_err(|e| e.to_string())?;
    let perms_table = tx_read
        .open_table(crate::db::Database::get_user_file_perms_table())
        .map_err(|e| e.to_string())?;
    let mut existing_id: Option<String> = None;
    for entry in perms_table.iter().map_err(|e| e.to_string())? {
        let (key, value) = entry.map_err(|e| e.to_string())?;
        let perm: UserFilePermission =
            serde_json::from_str(value.value()).map_err(|e| e.to_string())?;
        if perm.user_id == user_id && perm.file_id == file_id {
            existing_id = Some(key.value().to_string());
            break;
        }
    }
    drop(tx_read);

    let permission = UserFilePermission {
        id: perm_id.clone(),
        user_id,
        file_id,
        access,
        granted_by,
        granted_at: now,
    };

    let serialized = serde_json::to_string(&permission).map_err(|e| e.to_string())?;
    let tx = db.begin_write().map_err(|e| e.to_string())?;
    {
        let mut table = tx
            .open_table(crate::db::Database::get_user_file_perms_table())
            .map_err(|e| e.to_string())?;
        if let Some(ref eid) = existing_id {
            table.remove(eid.as_str()).map_err(|e| e.to_string())?;
        }
        table
            .insert(perm_id.as_str(), serialized.as_str())
            .map_err(|e| e.to_string())?;
    }
    tx.commit().map_err(|e| e.to_string())?;

    Ok(permission)
}

/// Revoke a file permission — frontend calls this as revoke_file_permission.
#[tauri::command]
pub fn revoke_file_permission(
    permission_id: String,
    state: State<'_, AppState>,
) -> Result<bool, String> {
    let db = state.db.write().map_err(|e| e.to_string())?;
    let tx = db.begin_write().map_err(|e| e.to_string())?;
    {
        let mut table = tx
            .open_table(crate::db::Database::get_user_file_perms_table())
            .map_err(|e| e.to_string())?;
        let removed = table
            .remove(permission_id.as_str())
            .map_err(|e| e.to_string())?
            .is_some();
        if !removed {
            return Err(format!("Permission not found: {}", permission_id));
        }
    }
    tx.commit().map_err(|e| e.to_string())?;
    Ok(true)
}

/// Verify whether a specific user has access to a specific file.
#[tauri::command]
pub fn verify_file_access(
    user_id: String,
    file_id: String,
    required_access: String,
    state: State<'_, AppState>,
) -> Result<bool, String> {
    let db = state.db.read().map_err(|e| e.to_string())?;
    let tx = db.begin_read().map_err(|e| e.to_string())?;
    let table = tx
        .open_table(crate::db::Database::get_user_file_perms_table())
        .map_err(|e| e.to_string())?;

    let level = |a: &str| match a {
        "admin" => 3u8,
        "write" => 2,
        "read" => 1,
        _ => 0,
    };
    let required = level(&required_access);

    for entry in table.iter().map_err(|e| e.to_string())? {
        let (_, value) = entry.map_err(|e| e.to_string())?;
        let perm: UserFilePermission =
            serde_json::from_str(value.value()).map_err(|e| e.to_string())?;
        if perm.user_id == user_id && perm.file_id == file_id && level(&perm.access) >= required {
            return Ok(true);
        }
    }

    // Check if user is admin (admins have global access)
    let users_table = tx
        .open_table(crate::db::Database::get_users_table())
        .map_err(|e| e.to_string())?;
    for entry in users_table.iter().map_err(|e| e.to_string())? {
        let (_, value) = entry.map_err(|e| e.to_string())?;
        let user: User = serde_json::from_str(value.value()).map_err(|e| e.to_string())?;
        if user.id == user_id && user.role == "admin" && user.is_active {
            return Ok(true);
        }
    }

    Ok(false)
}

/// Alias for register_user — called by the frontend as create_user.
#[tauri::command]
pub fn create_user(
    username: String,
    password: String,
    role: String,
    state: State<'_, AppState>,
) -> Result<User, String> {
    register_user(username, password, None, Some(role), state)
}

/// Delete a user by ID.
#[tauri::command]
pub fn delete_user(user_id: String, state: State<'_, AppState>) -> Result<bool, String> {
    let db = state.db.write().map_err(|e| e.to_string())?;
    cybermanju_web::api::users::delete(&db, &user_id)
}

/// Update a user's role.
#[tauri::command]
pub fn update_user_role(
    user_id: String,
    role: String,
    state: State<'_, AppState>,
) -> Result<User, String> {
    let db = state.db.write().map_err(|e| e.to_string())?;
    cybermanju_web::api::users::update_role(&db, &user_id, role)
}
#[tauri::command]
pub fn get_file_permissions(
    file_id: String,
    state: State<'_, AppState>,
) -> Result<Vec<UserFilePermission>, String> {
    let db = state.db.read().map_err(|e| e.to_string())?;
    let tx = db.begin_read().map_err(|e| e.to_string())?;
    let table = tx
        .open_table(crate::db::Database::get_user_file_perms_table())
        .map_err(|e| e.to_string())?;

    let mut results = Vec::new();
    for entry in table.iter().map_err(|e| e.to_string())? {
        let (_, value) = entry.map_err(|e| e.to_string())?;
        let perm: UserFilePermission =
            serde_json::from_str(value.value()).map_err(|e| e.to_string())?;
        if perm.file_id == file_id {
            results.push(perm);
        }
    }

    Ok(results)
}
