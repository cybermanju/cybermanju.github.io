//! Durable idempotency tombstones for Android automation Intent handoffs.
//!
//! Only SHA-256 hashes of opaque idempotency keys are stored. A claim is synced
//! before an Android Intent is launched. Any duplicate returns `unknown` and
//! never launches a second Intent. Tombstones are not automatically evicted;
//! cleanup waits for an explicit run-retention lifecycle API from the runner.
use crate::automation::{NativeActionOutcome, NativeActionRequest};
use fs2::FileExt;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::BTreeSet;
use std::fs::{self, File, OpenOptions};
use std::io::{Read, Write};
use std::path::Path;
#[cfg(target_os = "android")]
use std::path::PathBuf;
use std::sync::{Mutex, OnceLock};

const JOURNAL_FILE: &str = "automation-idempotency.v1.json";
const LOCK_FILE: &str = "automation-idempotency.v1.lock";
const MAX_JOURNAL_BYTES: u64 = 64 * 1024 * 1024;

static PROCESS_LOCK: OnceLock<Mutex<()>> = OnceLock::new();

#[derive(Debug, Clone, Serialize, Deserialize)]
struct Journal {
    version: u8,
    keys: BTreeSet<String>,
}

/// Atomically claim an idempotency key, run once, and retain a hash-only marker.
/// `directory` must be the app-private Android files directory.
pub(crate) fn claim_and_dispatch_at(
    directory: &Path,
    request: &NativeActionRequest,
    action: impl FnOnce() -> NativeActionOutcome,
) -> Result<NativeActionOutcome, JournalError> {
    let process_guard = PROCESS_LOCK
        .get_or_init(|| Mutex::new(()))
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    let _process_guard = process_guard;

    fs::create_dir_all(directory).map_err(|_| JournalError::Unavailable)?;
    let lock_path = directory.join(LOCK_FILE);
    let lock_file = OpenOptions::new()
        .create(true)
        .read(true)
        .write(true)
        .open(lock_path)
        .map_err(|_| JournalError::Unavailable)?;
    lock_file
        .lock_exclusive()
        .map_err(|_| JournalError::Unavailable)?;

    let result = claim_locked(directory, request, action);
    let _ = lock_file.unlock();
    result
}

/// Use the Android data directory that startup already probed and published.
#[cfg(target_os = "android")]
pub(crate) fn app_private_directory() -> Result<PathBuf, JournalError> {
    let raw = std::env::var("CYBERMANJU_DATA_DIR")
        .or_else(|_| std::env::var("CYBERMANJU_ANDROID_FILES_DIR"))
        .map_err(|_| JournalError::Unavailable)?;
    let path = PathBuf::from(raw);
    if !path.is_absolute() {
        return Err(JournalError::Unavailable);
    }
    Ok(path)
}

fn claim_locked(
    directory: &Path,
    request: &NativeActionRequest,
    action: impl FnOnce() -> NativeActionOutcome,
) -> Result<NativeActionOutcome, JournalError> {
    let key_hash = digest_hex(request.idempotency_key.as_bytes());
    let path = directory.join(JOURNAL_FILE);
    let mut journal = read_journal(&path)?;
    if journal.keys.contains(&key_hash) {
        return Ok(NativeActionOutcome::Unknown);
    }

    journal.keys.insert(key_hash);
    // Persist and fsync the tombstone before any outside app can be launched.
    write_journal_atomically(directory, &path, &journal)?;
    Ok(action())
}

fn read_journal(path: &Path) -> Result<Journal, JournalError> {
    let mut file = match File::open(path) {
        Ok(file) => file,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return Ok(Journal {
                version: 1,
                keys: BTreeSet::new(),
            });
        }
        Err(_) => return Err(JournalError::Unavailable),
    };
    let size = file
        .metadata()
        .map_err(|_| JournalError::Unavailable)?
        .len();
    if size > MAX_JOURNAL_BYTES {
        return Err(JournalError::Unavailable);
    }
    let mut bytes = Vec::with_capacity(size as usize);
    file.read_to_end(&mut bytes)
        .map_err(|_| JournalError::Unavailable)?;
    let journal: Journal = serde_json::from_slice(&bytes).map_err(|_| JournalError::Unavailable)?;
    if journal.version != 1 {
        return Err(JournalError::Unavailable);
    }
    Ok(journal)
}

fn write_journal_atomically(
    directory: &Path,
    path: &Path,
    journal: &Journal,
) -> Result<(), JournalError> {
    let bytes = serde_json::to_vec(journal).map_err(|_| JournalError::Unavailable)?;
    if bytes.len() as u64 > MAX_JOURNAL_BYTES {
        return Err(JournalError::Unavailable);
    }
    let temporary = directory.join(format!("{JOURNAL_FILE}.tmp"));
    let mut file = OpenOptions::new()
        .create(true)
        .truncate(true)
        .write(true)
        .open(&temporary)
        .map_err(|_| JournalError::Unavailable)?;
    file.write_all(&bytes)
        .map_err(|_| JournalError::Unavailable)?;
    file.sync_all().map_err(|_| JournalError::Unavailable)?;
    fs::rename(&temporary, path).map_err(|_| JournalError::Unavailable)?;
    File::open(directory)
        .and_then(|directory| directory.sync_all())
        .map_err(|_| JournalError::Unavailable)?;
    Ok(())
}

fn digest_hex(bytes: &[u8]) -> String {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let digest = Sha256::digest(bytes);
    let mut out = String::with_capacity(digest.len() * 2);
    for byte in digest {
        out.push(HEX[(byte >> 4) as usize] as char);
        out.push(HEX[(byte & 0x0f) as usize] as char);
    }
    out
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum JournalError {
    Unavailable,
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::path::PathBuf;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_dir(label: &str) -> PathBuf {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        std::env::temp_dir().join(format!(
            "cybermanju-automation-{label}-{}-{nonce}",
            std::process::id()
        ))
    }

    fn request() -> NativeActionRequest {
        NativeActionRequest {
            protocol_version: 1,
            request_id: "req-1".into(),
            workflow_id: "workflow-1".into(),
            workflow_revision: 1,
            node_id: "node-1".into(),
            action_id: "android.share_text".into(),
            input: json!({"text":"PRIVATE PAYLOAD MUST NOT BE WRITTEN"}),
            idempotency_key: "random-key-01".into(),
            expected_revision: None,
        }
    }

    #[test]
    fn duplicate_key_returns_unknown_and_never_runs_action_twice() {
        let dir = temp_dir("duplicate");
        let calls = AtomicUsize::new(0);
        let first = claim_and_dispatch_at(&dir, &request(), || {
            calls.fetch_add(1, Ordering::SeqCst);
            NativeActionOutcome::Accepted {
                job_id: "external:req-1".into(),
            }
        })
        .unwrap();
        let duplicate = claim_and_dispatch_at(&dir, &request(), || {
            calls.fetch_add(1, Ordering::SeqCst);
            NativeActionOutcome::Succeeded {
                output: serde_json::Value::Null,
            }
        })
        .unwrap();
        assert!(matches!(first, NativeActionOutcome::Accepted { .. }));
        assert!(matches!(duplicate, NativeActionOutcome::Unknown));
        assert_eq!(calls.load(Ordering::SeqCst), 1);
        let content = fs::read_to_string(dir.join(JOURNAL_FILE)).unwrap();
        assert!(!content.contains("PRIVATE PAYLOAD MUST NOT BE WRITTEN"));
        assert!(!content.contains("random-key-01"));
        assert!(!content.contains("external:req-1"));
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn interrupted_claim_returns_unknown_and_never_runs_action_again() {
        let dir = temp_dir("interrupted");
        let calls = AtomicUsize::new(0);
        let panic = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            let _ = claim_and_dispatch_at(&dir, &request(), || -> NativeActionOutcome {
                calls.fetch_add(1, Ordering::SeqCst);
                panic!("simulate process interruption after durable claim")
            });
        }));
        assert!(panic.is_err());
        let duplicate = claim_and_dispatch_at(&dir, &request(), || {
            calls.fetch_add(1, Ordering::SeqCst);
            NativeActionOutcome::Succeeded {
                output: serde_json::Value::Null,
            }
        })
        .unwrap();
        assert!(matches!(duplicate, NativeActionOutcome::Unknown));
        assert_eq!(calls.load(Ordering::SeqCst), 1);
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn inability_to_persist_claim_prevents_the_external_action() {
        let parent = temp_dir("read-only");
        fs::create_dir_all(&parent).unwrap();
        let not_a_directory = parent.join("file");
        fs::write(&not_a_directory, b"x").unwrap();
        let calls = AtomicUsize::new(0);
        let result = claim_and_dispatch_at(&not_a_directory, &request(), || {
            calls.fetch_add(1, Ordering::SeqCst);
            NativeActionOutcome::Succeeded {
                output: serde_json::Value::Null,
            }
        });
        assert!(matches!(result, Err(JournalError::Unavailable)));
        assert_eq!(calls.load(Ordering::SeqCst), 0);
        fs::remove_dir_all(parent).unwrap();
    }
}
