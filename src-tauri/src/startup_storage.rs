// CyberManju OS — Startup storage recovery (src-tauri/src/startup_storage.rs).
// Role: Recover confirmed redb corruption without mistaking an opener lock for damaged data.
// Exports: open_database.
// Integrates: native startup, cybermanju_db, redb typed errors.
// Contracts: Conflicts, permission failures and incompatible formats never rename the live vault.
use anyhow::Context;
use cybermanju_db::Database;
use std::path::Path;

fn is_database_corruption(error: &anyhow::Error) -> bool {
    matches!(
        error.downcast_ref::<redb::DatabaseError>(),
        Some(redb::DatabaseError::Storage(redb::StorageError::Corrupted(
            _
        )))
    )
}

pub(crate) fn open_database(path: &Path) -> anyhow::Result<Database> {
    let path_str = path.to_string_lossy();
    let first = match Database::new(&path_str) {
        Ok(database) => return Ok(database),
        Err(error) => error,
    };
    if !is_database_corruption(&first) {
        // Android process death can leave an opener lock behind. A live or
        // uncertain lock is NOT corruption: renaming here detaches a healthy
        // vault from its owner and still cannot fix the lock on the next open.
        return Err(first).with_context(|| {
            format!(
                "Failed to open database at {}; vault preserved (not confirmed corruption)",
                path.display()
            )
        });
    }

    // UUID prevents a second failure within the same second overwriting a
    // previous recovery copy. Never remove the lock to force a conflicting open.
    let backup = path.with_file_name(format!("cybermanju.corrupt-{}.bak", uuid::Uuid::new_v4()));
    tracing::error!(
        "confirmed database corruption at {}: {first} — quarantining to {}",
        path.display(),
        backup.display()
    );
    std::fs::rename(path, &backup).with_context(|| {
        format!(
            "Failed to quarantine confirmed corrupt database at {} ({first})",
            path.display()
        )
    })?;
    Database::new(&path_str).with_context(|| {
        format!(
            "Failed to recreate database at {}; original preserved at {}",
            path.display(),
            backup.display()
        )
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    struct Fixture(std::path::PathBuf);

    impl Fixture {
        fn new() -> Self {
            let dir =
                std::env::temp_dir().join(format!("cybermanju-startup-{}", uuid::Uuid::new_v4()));
            std::fs::create_dir(&dir).unwrap();
            Self(dir)
        }

        fn path(&self) -> std::path::PathBuf {
            self.0.join("cybermanju.db")
        }
    }

    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn recovery_classifies_only_typed_open_corruption() {
        assert!(is_database_corruption(&anyhow::Error::new(
            redb::DatabaseError::Storage(redb::StorageError::Corrupted("torn header".into()))
        )));
        let corruption = anyhow::Error::new(redb::DatabaseError::Storage(
            redb::StorageError::Corrupted("torn header".into()),
        ));
        assert!(is_database_corruption(
            &corruption.context("opening existing vault")
        ));
        for error in [
            anyhow::anyhow!("conflict: database is already open"),
            anyhow::anyhow!("DB corrupted: text is not evidence"),
            anyhow::Error::new(redb::DatabaseError::DatabaseAlreadyOpen),
            anyhow::Error::new(redb::DatabaseError::UpgradeRequired(1)),
            anyhow::Error::new(redb::DatabaseError::Storage(redb::StorageError::Io(
                std::io::Error::from(std::io::ErrorKind::PermissionDenied),
            ))),
        ] {
            assert!(!is_database_corruption(&error), "{error}");
        }
    }

    #[test]
    fn live_opener_never_quarantines_or_resets_the_vault() {
        let fixture = Fixture::new();
        let path = fixture.path();
        let database = open_database(&path).unwrap();
        database.kv_set("resume:sentinel", "keep my data").unwrap();
        let before = std::fs::read(&path).unwrap();
        let error = open_database(&path)
            .err()
            .expect("live opener must conflict");
        assert!(format!("{error:#}").contains("conflict:"));
        assert_eq!(std::fs::read(&path).unwrap(), before);
        assert_eq!(std::fs::read_dir(&fixture.0).unwrap().count(), 2);
        assert_eq!(
            database.kv_get("resume:sentinel").unwrap().as_deref(),
            Some("keep my data")
        );
        drop(database);
        let resumed = open_database(&path).unwrap();
        assert_eq!(
            resumed.kv_get("resume:sentinel").unwrap().as_deref(),
            Some("keep my data")
        );
    }

    #[test]
    fn uncertain_lock_preserves_database_and_lock_bytes() {
        let fixture = Fixture::new();
        let path = fixture.path();
        drop(open_database(&path).unwrap());
        let before = std::fs::read(&path).unwrap();
        let lock = path.with_extension("db.lock");
        std::fs::write(&lock, "unreadable-owner").unwrap();
        assert!(open_database(&path).is_err());
        assert_eq!(std::fs::read(&path).unwrap(), before);
        assert_eq!(std::fs::read_to_string(lock).unwrap(), "unreadable-owner");
        assert_eq!(std::fs::read_dir(&fixture.0).unwrap().count(), 2);
    }

    #[cfg(any(target_os = "linux", target_os = "android"))]
    #[test]
    fn startup_reopens_dead_owner_without_quarantine_or_data_reset() {
        let fixture = Fixture::new();
        let path = fixture.path();
        let database = open_database(&path).unwrap();
        database.kv_set("resume:sentinel", "same vault").unwrap();
        drop(database);
        let mut child = std::process::Command::new("sh")
            .args(["-c", "exit 0"])
            .spawn()
            .unwrap();
        let dead_pid = child.id();
        child.wait().unwrap();
        std::fs::write(path.with_extension("db.lock"), dead_pid.to_string()).unwrap();
        let resumed = open_database(&path).unwrap();
        assert_eq!(
            resumed.kv_get("resume:sentinel").unwrap().as_deref(),
            Some("same vault")
        );
        assert_eq!(std::fs::read_dir(&fixture.0).unwrap().count(), 2);
    }

    #[test]
    fn confirmed_corruption_keeps_a_recovery_copy() {
        let fixture = Fixture::new();
        let path = fixture.path();
        let corrupt = vec![0xff; 16_384];
        std::fs::write(&path, &corrupt).unwrap();
        let recovered = open_database(&path).unwrap();
        recovered.kv_set("resume:sentinel", "recovered").unwrap();
        let backups: Vec<_> = std::fs::read_dir(&fixture.0)
            .unwrap()
            .map(|entry| entry.unwrap().path())
            .filter(|entry| entry.extension().is_some_and(|ext| ext == "bak"))
            .collect();
        assert_eq!(backups.len(), 1);
        assert_eq!(std::fs::read(&backups[0]).unwrap(), corrupt);
    }
}
