// CyberManju OS — Devices (src-tauri/src/commands/devices.rs).
// Role: Tauri IPC commands for device identity (§2B.1) + LAN peers (§2B.2).
// Exports: list_devices, register_device, register_this_device,
// revoke_device, remove_device, list_lan_peers.
// Integrates: shared web API (devices), PQC engine (ML-DSA attestation),
// sync lan scanner; State<AppState> locks mirror the cron module.
// Contracts: trusted-local transport (same posture as the rest of IPC);
// revocation is still admin-gated on the REST path.
use tauri::State;

use crate::AppState;
use base64::Engine as _;
use cybermanju_types::schema::DeviceRow;

// ---------------------------------------------------------------------------
// Device identity — thin wrappers over the shared web API
// ---------------------------------------------------------------------------

/// All registered devices (revoked rows included, flagged).
#[tauri::command(async)]
pub fn list_devices(state: State<'_, AppState>) -> Result<Vec<DeviceRow>, String> {
    let db = state.db.read().map_err(|e| e.to_string())?;
    db.list_devices().map_err(|e| e.to_string())
}

/// Register (or re-attest) a device row.
#[tauri::command(async)]
pub fn register_device(
    name: String,
    public_key: Option<String>,
    key_algorithm: Option<String>,
    state: State<'_, AppState>,
) -> Result<DeviceRow, String> {
    let db = state.db.write().map_err(|e| e.to_string())?;
    cybermanju_web::api::devices::register(
        &db,
        &cybermanju_web::api::devices::RegisterRequest {
            id: None,
            name,
            public_key,
            key_algorithm,
        },
    )
}

/// Enroll THIS device: fresh ML-DSA-65 keypair, public half registered. The
/// private half is sealed into the keystore like every other keypair —
/// `register_this_device` never returns it.
#[tauri::command(async)]
pub fn register_this_device(
    name: String,
    state: State<'_, AppState>,
) -> Result<DeviceRow, String> {
    use crate::crypto::pqc::{algorithm_from_str, PqcEngine};
    let algo = algorithm_from_str("ml_dsa65")
        .ok_or_else(|| "integrity: ml_dsa65 unknown to the PQC engine".to_string())?;
    let mut engine = PqcEngine::new();
    let keypair = engine
        .generate_keypair(algo)
        .map_err(|e| format!("Key generation failed: {e}"))?;
    let public_key_b64 = base64::Engine::encode(
        &base64::engine::general_purpose::STANDARD,
        &keypair.public_key,
    );
    let db = state.db.write().map_err(|e| e.to_string())?;
    cybermanju_web::api::devices::register(
        &db,
        &cybermanju_web::api::devices::RegisterRequest {
            id: None,
            name,
            public_key: Some(public_key_b64),
            key_algorithm: Some("ml-dsa-65".to_string()),
        },
    )
}

/// Revoke a device (row stays for history, fails closed everywhere).
#[tauri::command(async)]
pub fn revoke_device(id: String, state: State<'_, AppState>) -> Result<DeviceRow, String> {
    let db = state.db.write().map_err(|e| e.to_string())?;
    let mut row = db
        .get_device(&id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| format!("not_found: no device `{id}`"))?;
    row.revoked = true;
    row.last_seen_at = chrono::Utc::now().to_rfc3339();
    db.save_device(&row).map_err(|e| e.to_string())?;
    Ok(row)
}

/// Delete a device row entirely.
#[tauri::command(async)]
pub fn remove_device(id: String, state: State<'_, AppState>) -> Result<bool, String> {
    let db = state.db.write().map_err(|e| e.to_string())?;
    db.remove_device(&id).map_err(|e| e.to_string())
}

// ---------------------------------------------------------------------------
// LAN peers (§2B.2) — active mDNS scan, 2 s cap
// ---------------------------------------------------------------------------

/// Devices answering `_cybermanju._tcp.local` on the LAN right now.
#[tauri::command(async)]
pub fn list_lan_peers() -> Result<Vec<serde_json::Value>, String> {
    let peers = cybermanju_sync::lan::discover(
        std::net::SocketAddr::V4(std::net::SocketAddrV4::new(
            cybermanju_sync::lan::MDNS_ADDR,
            cybermanju_sync::lan::MDNS_PORT,
        )),
        std::time::Duration::from_secs(2),
    )
    .map_err(|e| e)?;
    Ok(peers
        .iter()
        .map(|p| {
            serde_json::json!({
                "deviceId": p.device_id,
                "name": p.name,
                "host": p.host,
                "port": p.port,
                "lastSeenSecs": p.last_seen_secs,
            })
        })
        .collect())
}
