use anyhow::Result;
use cybermanju_types::schema::{AuditEntry, FileNode, FileVersion, ShareLink, TrashItem};
use cybermanju_types::sync::{SyncFile, SyncRunRecord};
use redb::{
    Database as RedbDatabase, ReadTransaction, ReadableTable, TableDefinition, WriteTransaction,
};

const FILES_TABLE: TableDefinition<'static, &'static str, &'static str> =
    TableDefinition::new("files");
const ACCOUNTS_TABLE: TableDefinition<'static, &'static str, &'static str> =
    TableDefinition::new("accounts");
const COLLECTIONS_TABLE: TableDefinition<'static, &'static str, &'static str> =
    TableDefinition::new("collections");
const COLLECTION_ITEMS_TABLE: TableDefinition<'static, &'static str, &'static str> =
    TableDefinition::new("collection_items");
const FACE_GROUPS_TABLE: TableDefinition<'static, &'static str, &'static str> =
    TableDefinition::new("face_groups");
const LOOSE_GROUPS_TABLE: TableDefinition<'static, &'static str, &'static str> =
    TableDefinition::new("loose_groups");
const ENCRYPTION_KEYS_TABLE: TableDefinition<'static, &'static str, &'static str> =
    TableDefinition::new("encryption_keys");
const LOCATIONS_TABLE: TableDefinition<'static, &'static str, &'static str> =
    TableDefinition::new("locations");
const USERS_TABLE: TableDefinition<'static, &'static str, &'static str> =
    TableDefinition::new("users");
const USER_FILE_PERMS_TABLE: TableDefinition<'static, &'static str, &'static str> =
    TableDefinition::new("user_file_perms");
const SYNC_CONFIGS_TABLE: TableDefinition<'static, &'static str, &'static str> =
    TableDefinition::new("sync_configs");
const PARENT_INDEX_TABLE: TableDefinition<'static, &'static str, &'static str> =
    TableDefinition::new("parent_index");
const TRASH_TABLE: TableDefinition<'static, &'static str, &'static str> =
    TableDefinition::new("trash");
const AUDIT_LOG_TABLE: TableDefinition<'static, &'static str, &'static str> =
    TableDefinition::new("audit_log");
const FILE_VERSIONS_TABLE: TableDefinition<'static, &'static str, &'static str> =
    TableDefinition::new("file_versions");
const SHARE_LINKS_TABLE: TableDefinition<'static, &'static str, &'static str> =
    TableDefinition::new("share_links");
// <<< AGENT-2 SYNC PERSISTENCE: remote locators, run history, config
// secrets and the schema marker. See AGENT-2.md items 2, 14. >>>
const SYNC_FILES_TABLE: TableDefinition<'static, &'static str, &'static str> =
    TableDefinition::new("sync_files");
const SYNC_RUNS_TABLE: TableDefinition<'static, &'static str, &'static str> =
    TableDefinition::new("sync_runs");
const SYNC_SECRETS_TABLE: TableDefinition<'static, &'static str, &'static str> =
    TableDefinition::new("sync_secrets");
const SCHEMA_VERSION_TABLE: TableDefinition<'static, &'static str, &'static str> =
    TableDefinition::new("schema_version");
// <<< CYBERMANJU OS PUSH: tables declared up front by the supervisor so the
// three parallel agents never edit this file. AGENT-6 = disks/volumes/block_map,
// AGENT-7 = scrub_runs/repairs/chunk_refs/leases/provider_health,
// AGENT-8 = compute_tasks/shell_history. Values are JSON strings, same as
// every other table here. See MISSING.md §"Pre-wired before launch". >>>
const DISKS_TABLE: TableDefinition<'static, &'static str, &'static str> =
    TableDefinition::new("disks");
const VOLUMES_TABLE: TableDefinition<'static, &'static str, &'static str> =
    TableDefinition::new("volumes");
const BLOCK_MAP_TABLE: TableDefinition<'static, &'static str, &'static str> =
    TableDefinition::new("block_map");
const SCRUB_RUNS_TABLE: TableDefinition<'static, &'static str, &'static str> =
    TableDefinition::new("scrub_runs");
const REPAIRS_TABLE: TableDefinition<'static, &'static str, &'static str> =
    TableDefinition::new("repairs");
const CHUNK_REFS_TABLE: TableDefinition<'static, &'static str, &'static str> =
    TableDefinition::new("chunk_refs");
const LEASES_TABLE: TableDefinition<'static, &'static str, &'static str> =
    TableDefinition::new("leases");
const PROVIDER_HEALTH_TABLE: TableDefinition<'static, &'static str, &'static str> =
    TableDefinition::new("provider_health");
const COMPUTE_TASKS_TABLE: TableDefinition<'static, &'static str, &'static str> =
    TableDefinition::new("compute_tasks");
const SHELL_HISTORY_TABLE: TableDefinition<'static, &'static str, &'static str> =
    TableDefinition::new("shell_history");
// <<< AI AGENT: configs (no key material — keys live in sync_secrets as
// `agent:key:<config_id>`) and session transcripts. Values are JSON strings,
// same convention as every other table here. >>>
const AGENT_CONFIGS_TABLE: TableDefinition<'static, &'static str, &'static str> =
    TableDefinition::new("agent_configs");
const AGENT_SESSIONS_TABLE: TableDefinition<'static, &'static str, &'static str> =
    TableDefinition::new("agent_sessions");
// <<< SEMANTIC MEMORY: long-term memories (curated text + embedding vector
// as JSON rows). New table = backward compatible: existing DB files gain it
// on open, like every table above. >>>
const AGENT_MEMORIES_TABLE: TableDefinition<'static, &'static str, &'static str> =
    TableDefinition::new("agent_memories");
// Generic key/value blob: vault secrets, app config, shell file content and
// any other session state the browser build keeps inside `.cybermanju`.
// Keys are namespaced by convention (`secret:`, `config:`, `content:`,
// `volume:`), values are raw UTF-8 strings.
const KV_TABLE: TableDefinition<'static, &'static str, &'static str> = TableDefinition::new("kv");

/// Rows kept in `sync_runs` — enough for a UI history page, few enough that
/// the prune scan stays trivial.
pub const SYNC_RUN_HISTORY_LIMIT: usize = 20;

/// Clone shares the underlying redb handle (its own internal locking), so a
/// short-lived clone lets long I/O (verified moves) run without holding the
/// request `RwLock` — same lock-free discipline as the sync pipeline.
#[derive(Clone)]
pub struct Database {
    db: std::sync::Arc<RedbDatabase>,
}

impl Database {
    pub fn new(path: &str) -> Result<Self> {
        // redb creates the FILE but never its parent directories. Create them
        // so callers can pass `<data-dir>/cybermanju.db` on a fresh install
        // (desktop AppImage/Flatpak, Docker) instead of failing with ENOENT.
        let p = std::path::Path::new(path);
        if let Some(parent) = p.parent() {
            if !parent.as_os_str().is_empty() {
                std::fs::create_dir_all(parent).map_err(|e| {
                    anyhow::anyhow!("cannot create database directory {}: {e}", parent.display())
                })?;
            }
        }
        let db = RedbDatabase::create(path)?;
        let write_txn = db.begin_write()?;
        {
            write_txn.open_table(FILES_TABLE)?;
            write_txn.open_table(ACCOUNTS_TABLE)?;
            write_txn.open_table(COLLECTIONS_TABLE)?;
            write_txn.open_table(COLLECTION_ITEMS_TABLE)?;
            write_txn.open_table(FACE_GROUPS_TABLE)?;
            write_txn.open_table(LOOSE_GROUPS_TABLE)?;
            write_txn.open_table(ENCRYPTION_KEYS_TABLE)?;
            write_txn.open_table(LOCATIONS_TABLE)?;
            write_txn.open_table(USERS_TABLE)?;
            write_txn.open_table(USER_FILE_PERMS_TABLE)?;
            write_txn.open_table(SYNC_CONFIGS_TABLE)?;
            write_txn.open_table(PARENT_INDEX_TABLE)?;
            write_txn.open_table(TRASH_TABLE)?;
            write_txn.open_table(AUDIT_LOG_TABLE)?;
            write_txn.open_table(FILE_VERSIONS_TABLE)?;
            write_txn.open_table(SHARE_LINKS_TABLE)?;
            // <<< AGENT-2 SYNC PERSISTENCE >>>
            write_txn.open_table(SYNC_FILES_TABLE)?;
            write_txn.open_table(SYNC_RUNS_TABLE)?;
            write_txn.open_table(SYNC_SECRETS_TABLE)?;
            // <<< CYBERMANJU OS PUSH: open the new tables too >>>
            write_txn.open_table(DISKS_TABLE)?;
            write_txn.open_table(VOLUMES_TABLE)?;
            write_txn.open_table(BLOCK_MAP_TABLE)?;
            write_txn.open_table(SCRUB_RUNS_TABLE)?;
            write_txn.open_table(REPAIRS_TABLE)?;
            write_txn.open_table(CHUNK_REFS_TABLE)?;
            write_txn.open_table(LEASES_TABLE)?;
            write_txn.open_table(PROVIDER_HEALTH_TABLE)?;
            write_txn.open_table(COMPUTE_TASKS_TABLE)?;
            write_txn.open_table(SHELL_HISTORY_TABLE)?;
            // <<< AI AGENT tables >>>
            write_txn.open_table(AGENT_CONFIGS_TABLE)?;
            write_txn.open_table(AGENT_SESSIONS_TABLE)?;
            write_txn.open_table(AGENT_MEMORIES_TABLE)?;
            // Generic kv blob (secrets, config, content) — same table the
            // browser build writes so a `.cybermanju` image opens here too.
            write_txn.open_table(KV_TABLE)?;
            {
                let mut schema = write_txn.open_table(SCHEMA_VERSION_TABLE)?;
                if schema.get("schema")?.is_none() {
                    schema.insert("schema", "1")?;
                }
            }
        }
        write_txn.commit()?;
        Ok(Self {
            db: std::sync::Arc::new(db),
        })
    }

    pub fn begin_read(&self) -> Result<ReadTransaction> {
        Ok(self.db.begin_read()?)
    }

    pub fn begin_write(&self) -> Result<WriteTransaction> {
        Ok(self.db.begin_write()?)
    }

    pub fn get_files_table() -> TableDefinition<'static, &'static str, &'static str> {
        FILES_TABLE
    }
    pub fn get_accounts_table() -> TableDefinition<'static, &'static str, &'static str> {
        ACCOUNTS_TABLE
    }
    pub fn get_collections_table() -> TableDefinition<'static, &'static str, &'static str> {
        COLLECTIONS_TABLE
    }
    pub fn get_collection_items_table() -> TableDefinition<'static, &'static str, &'static str> {
        COLLECTION_ITEMS_TABLE
    }
    pub fn get_face_groups_table() -> TableDefinition<'static, &'static str, &'static str> {
        FACE_GROUPS_TABLE
    }
    pub fn get_loose_groups_table() -> TableDefinition<'static, &'static str, &'static str> {
        LOOSE_GROUPS_TABLE
    }
    pub fn get_encryption_keys_table() -> TableDefinition<'static, &'static str, &'static str> {
        ENCRYPTION_KEYS_TABLE
    }
    pub fn get_locations_table() -> TableDefinition<'static, &'static str, &'static str> {
        LOCATIONS_TABLE
    }
    pub fn get_users_table() -> TableDefinition<'static, &'static str, &'static str> {
        USERS_TABLE
    }
    pub fn get_user_file_perms_table() -> TableDefinition<'static, &'static str, &'static str> {
        USER_FILE_PERMS_TABLE
    }
    pub fn get_sync_configs_table() -> TableDefinition<'static, &'static str, &'static str> {
        SYNC_CONFIGS_TABLE
    }
    pub fn get_parent_index_table() -> TableDefinition<'static, &'static str, &'static str> {
        PARENT_INDEX_TABLE
    }
    pub fn get_trash_table() -> TableDefinition<'static, &'static str, &'static str> {
        TRASH_TABLE
    }
    pub fn get_audit_log_table() -> TableDefinition<'static, &'static str, &'static str> {
        AUDIT_LOG_TABLE
    }
    pub fn get_file_versions_table() -> TableDefinition<'static, &'static str, &'static str> {
        FILE_VERSIONS_TABLE
    }
    pub fn get_share_links_table() -> TableDefinition<'static, &'static str, &'static str> {
        SHARE_LINKS_TABLE
    }
    // <<< AGENT-2 SYNC PERSISTENCE >>>
    pub fn get_sync_files_table() -> TableDefinition<'static, &'static str, &'static str> {
        SYNC_FILES_TABLE
    }
    pub fn get_sync_runs_table() -> TableDefinition<'static, &'static str, &'static str> {
        SYNC_RUNS_TABLE
    }
    pub fn get_sync_secrets_table() -> TableDefinition<'static, &'static str, &'static str> {
        SYNC_SECRETS_TABLE
    }
    // <<< CYBERMANJU OS PUSH: accessors for the pre-declared OS tables >>>
    /// AGENT-6 — one `.cybermanju` disk record per provider binding.
    pub fn get_disks_table() -> TableDefinition<'static, &'static str, &'static str> {
        DISKS_TABLE
    }
    /// AGENT-6 — the merged logical volume definition.
    pub fn get_volumes_table() -> TableDefinition<'static, &'static str, &'static str> {
        VOLUMES_TABLE
    }
    /// AGENT-6 — LBA → chunk placement rows.
    pub fn get_block_map_table() -> TableDefinition<'static, &'static str, &'static str> {
        BLOCK_MAP_TABLE
    }
    /// AGENT-7 — one row per scrub pass (per provider).
    pub fn get_scrub_runs_table() -> TableDefinition<'static, &'static str, &'static str> {
        SCRUB_RUNS_TABLE
    }
    /// AGENT-7 — repair findings and their outcome.
    pub fn get_repairs_table() -> TableDefinition<'static, &'static str, &'static str> {
        REPAIRS_TABLE
    }
    /// AGENT-7 — chunk hash → refcount/manifest references (GC authority).
    pub fn get_chunk_refs_table() -> TableDefinition<'static, &'static str, &'static str> {
        CHUNK_REFS_TABLE
    }
    /// AGENT-7 — single-writer volume leases.
    pub fn get_leases_table() -> TableDefinition<'static, &'static str, &'static str> {
        LEASES_TABLE
    }
    /// AGENT-7 — per-provider health score and quarantine state.
    pub fn get_provider_health_table() -> TableDefinition<'static, &'static str, &'static str> {
        PROVIDER_HEALTH_TABLE
    }
    /// AGENT-8 — the process table behind `ps` / `top` / `kill`.
    pub fn get_compute_tasks_table() -> TableDefinition<'static, &'static str, &'static str> {
        COMPUTE_TASKS_TABLE
    }
    /// AGENT-8 — `cybsh` command history.
    pub fn get_shell_history_table() -> TableDefinition<'static, &'static str, &'static str> {
        SHELL_HISTORY_TABLE
    }
    // <<< AI AGENT accessors >>>
    /// Saved agent configs (keyless rows — provider keys are side-tabled).
    pub fn get_agent_configs_table() -> TableDefinition<'static, &'static str, &'static str> {
        AGENT_CONFIGS_TABLE
    }
    /// Agent session transcripts.
    pub fn get_agent_sessions_table() -> TableDefinition<'static, &'static str, &'static str> {
        AGENT_SESSIONS_TABLE
    }
    /// Agent long-term memories (text + embedding vectors as JSON rows).
    pub fn get_agent_memories_table() -> TableDefinition<'static, &'static str, &'static str> {
        AGENT_MEMORIES_TABLE
    }

    /// Generic key/value blob (secrets, config, file content, volume mirror).
    pub fn get_kv_table() -> TableDefinition<'static, &'static str, &'static str> {
        KV_TABLE
    }

    pub fn kv_get(&self, key: &str) -> Result<Option<String>> {
        let tx = self.db.begin_read()?;
        let table = tx.open_table(KV_TABLE)?;
        Ok(table.get(key)?.map(|value| value.value().to_string()))
    }

    pub fn kv_set(&self, key: &str, value: &str) -> Result<()> {
        let tx = self.db.begin_write()?;
        {
            let mut table = tx.open_table(KV_TABLE)?;
            table.insert(key, value)?;
        }
        tx.commit()?;
        Ok(())
    }

    pub fn kv_delete(&self, key: &str) -> Result<bool> {
        let tx = self.db.begin_write()?;
        let removed = {
            let mut table = tx.open_table(KV_TABLE)?;
            let previous = table.remove(key)?;
            previous.is_some()
        };
        tx.commit()?;
        Ok(removed)
    }

    pub fn kv_list(&self, prefix: &str) -> Result<Vec<(String, usize)>> {
        let tx = self.db.begin_read()?;
        let table = tx.open_table(KV_TABLE)?;
        let mut rows = Vec::new();
        for entry in table.iter()? {
            let (key, value) = entry?;
            let key = key.value().to_string();
            if key.starts_with(prefix) {
                rows.push((key, value.value().len()));
            }
        }
        Ok(rows)
    }

    /// Row key for a synced copy: one local file × one config.
    fn sync_file_key(file_id: &str, config_id: &str) -> String {
        format!("{}/{}", file_id, config_id)
    }

    /// Insert or replace the locator record for one synced copy.
    pub fn upsert_sync_file(&self, record: &SyncFile) -> Result<()> {
        let key = Self::sync_file_key(&record.id, record.config_id.as_deref().unwrap_or(""));
        let serialized = serde_json::to_string(record)?;
        let tx = self.db.begin_write()?;
        {
            let mut table = tx.open_table(SYNC_FILES_TABLE)?;
            table.insert(key.as_str(), serialized.as_str())?;
        }
        tx.commit()?;
        Ok(())
    }

    /// Locator record for one (file, config) pair.
    pub fn get_sync_file(&self, file_id: &str, config_id: &str) -> Result<Option<SyncFile>> {
        let tx = self.db.begin_read()?;
        let table = tx.open_table(SYNC_FILES_TABLE)?;
        let key = Self::sync_file_key(file_id, config_id);
        match table.get(key.as_str())? {
            Some(v) => Ok(Some(serde_json::from_str(v.value())?)),
            None => Ok(None),
        }
    }

    /// Newest record uploaded to `remote_path` by `config_id` (linear scan —
    /// the table holds one row per synced file, never more than a library).
    pub fn find_sync_file_by_remote(
        &self,
        config_id: &str,
        remote_path: &str,
    ) -> Result<Option<SyncFile>> {
        let tx = self.db.begin_read()?;
        let table = tx.open_table(SYNC_FILES_TABLE)?;
        let mut found: Option<SyncFile> = None;
        for entry in table.iter()? {
            let (_, value) = entry?;
            let record: SyncFile = serde_json::from_str(value.value())?;
            if record.config_id.as_deref() == Some(config_id)
                && record.remote_path.as_deref() == Some(remote_path)
            {
                found = Some(record);
            }
        }
        Ok(found)
    }

    /// All locator records, optionally narrowed to one config.
    pub fn list_sync_files(&self, config_id: Option<&str>) -> Result<Vec<SyncFile>> {
        let tx = self.db.begin_read()?;
        let table = tx.open_table(SYNC_FILES_TABLE)?;
        let mut records = Vec::new();
        for entry in table.iter()? {
            let (_, value) = entry?;
            let record: SyncFile = serde_json::from_str(value.value())?;
            if config_id.is_none() || record.config_id.as_deref() == config_id {
                records.push(record);
            }
        }
        Ok(records)
    }

    /// Drop one locator record (used when the remote copy is deleted).
    pub fn remove_sync_file(&self, file_id: &str, config_id: &str) -> Result<bool> {
        let key = Self::sync_file_key(file_id, config_id);
        let tx = self.db.begin_write()?;
        let removed = {
            let mut table = tx.open_table(SYNC_FILES_TABLE)?;
            let removed = table.remove(key.as_str())?.is_some();
            removed
        };
        tx.commit()?;
        Ok(removed)
    }

    /// Persist a finished run and prune the history to
    /// [`SYNC_RUN_HISTORY_LIMIT`] rows (oldest `finished_at` first).
    pub fn save_sync_run(&self, record: &SyncRunRecord) -> Result<()> {
        let serialized = serde_json::to_string(record)?;
        let tx = self.db.begin_write()?;
        {
            let mut table = tx.open_table(SYNC_RUNS_TABLE)?;
            table.insert(record.run_id.as_str(), serialized.as_str())?;

            let mut rows: Vec<(String, String)> = Vec::new();
            for entry in table.iter()? {
                let (key, value) = entry?;
                let stored: SyncRunRecord = serde_json::from_str(value.value())?;
                rows.push((key.value().to_string(), stored.finished_at));
            }
            if rows.len() > SYNC_RUN_HISTORY_LIMIT {
                rows.sort_by_key(|a| a.1.clone());
                for (stale, _) in rows.iter().take(rows.len() - SYNC_RUN_HISTORY_LIMIT) {
                    table.remove(stale.as_str())?;
                }
            }
        }
        tx.commit()?;
        Ok(())
    }

    /// One finished run by id (survives restarts).
    pub fn get_sync_run(&self, run_id: &str) -> Result<Option<SyncRunRecord>> {
        let tx = self.db.begin_read()?;
        let table = tx.open_table(SYNC_RUNS_TABLE)?;
        match table.get(run_id)? {
            Some(v) => Ok(Some(serde_json::from_str(v.value())?)),
            None => Ok(None),
        }
    }

    /// Run history, newest `finished_at` first, capped at `limit`.
    pub fn list_sync_runs(&self, limit: usize) -> Result<Vec<SyncRunRecord>> {
        let tx = self.db.begin_read()?;
        let table = tx.open_table(SYNC_RUNS_TABLE)?;
        let mut rows = Vec::new();
        for entry in table.iter()? {
            let (_, value) = entry?;
            rows.push(serde_json::from_str::<SyncRunRecord>(value.value())?);
        }
        rows.sort_by_key(|a| std::cmp::Reverse(a.finished_at.clone()));
        rows.truncate(limit);
        Ok(rows)
    }

    // ─── Config secrets (AGENT-3 request: token lives beside the row) ──
    // `SyncConfig.token` is `skip_serializing`, so the JSON row never holds
    // it. The side table does — written by `save_config`, merged back by
    // `get_config`/`list_configs`, removed by `delete_config`.

    pub fn put_sync_secret(&self, config_id: &str, secret: &str) -> Result<()> {
        let tx = self.db.begin_write()?;
        {
            let mut table = tx.open_table(SYNC_SECRETS_TABLE)?;
            table.insert(config_id, secret)?;
        }
        tx.commit()?;
        Ok(())
    }

    pub fn get_sync_secret(&self, config_id: &str) -> Result<Option<String>> {
        let tx = self.db.begin_read()?;
        let table = tx.open_table(SYNC_SECRETS_TABLE)?;
        Ok(table.get(config_id)?.map(|v| v.value().to_string()))
    }

    pub fn remove_sync_secret(&self, config_id: &str) -> Result<bool> {
        let tx = self.db.begin_write()?;
        let removed = {
            let mut table = tx.open_table(SYNC_SECRETS_TABLE)?;
            let removed = table.remove(config_id)?.is_some();
            removed
        };
        tx.commit()?;
        Ok(removed)
    }

    /// Every saved sync config with its secret merged back in (the row JSON
    /// never carries `token`). Used by the pipeline's striped placement,
    /// which must reach several providers in one run.
    pub fn list_sync_configs(&self) -> Result<Vec<cybermanju_types::sync::SyncConfig>> {
        let tx = self.db.begin_read()?;
        let table = tx.open_table(SYNC_CONFIGS_TABLE)?;
        let mut configs = Vec::new();
        for entry in table.iter()? {
            let (_, value) = entry?;
            let mut config: cybermanju_types::sync::SyncConfig =
                serde_json::from_str(value.value())?;
            if config.token.is_none() {
                config.token = self.get_sync_secret(&config.id)?;
            }
            configs.push(config);
        }
        Ok(configs)
    }

    /// Ids of every live file. Trashed files live in their own table, so
    /// this is exactly the set an auto-sync scan should walk (item 11).
    pub fn list_file_ids(&self) -> Result<Vec<String>> {
        let tx = self.db.begin_read()?;
        let table = tx.open_table(FILES_TABLE)?;
        let mut ids = Vec::new();
        for entry in table.iter()? {
            let (key, _) = entry?;
            ids.push(key.value().to_string());
        }
        Ok(ids)
    }

    /// Persisted schema marker (1 = first sync-persistence schema).
    pub fn schema_version(&self) -> Result<u64> {
        let tx = self.db.begin_read()?;
        let table = tx.open_table(SCHEMA_VERSION_TABLE)?;
        match table.get("schema")? {
            Some(v) => Ok(v.value().parse::<u64>().unwrap_or(0)),
            None => Ok(0),
        }
    }

    pub fn log_audit(
        &self,
        action: &str,
        entity_type: &str,
        entity_id: &str,
        user_id: Option<&str>,
        details: Option<serde_json::Value>,
    ) -> Result<()> {
        let entry = AuditEntry {
            id: uuid::Uuid::new_v4().to_string(),
            action: action.to_string(),
            entity_type: entity_type.to_string(),
            entity_id: entity_id.to_string(),
            user_id: user_id.map(|s| s.to_string()),
            details,
            timestamp: chrono::Utc::now().to_rfc3339(),
        };
        let tx = self.db.begin_write()?;
        {
            let mut table = tx.open_table(AUDIT_LOG_TABLE)?;
            table.insert(entry.id.as_str(), serde_json::to_string(&entry)?.as_str())?;
        }
        tx.commit()?;
        Ok(())
    }

    pub fn trash_file(
        &self,
        file_id: &str,
        file_node: &FileNode,
        deleted_by: Option<&str>,
    ) -> Result<()> {
        let trash_item = TrashItem {
            id: file_id.to_string(),
            original_file: file_node.clone(),
            deleted_at: chrono::Utc::now().to_rfc3339(),
            deleted_by: deleted_by.map(|s| s.to_string()),
            restore_path: file_node.parent_id.clone(),
        };
        let tx = self.db.begin_write()?;
        {
            let mut trash_table = tx.open_table(TRASH_TABLE)?;
            trash_table.insert(file_id, serde_json::to_string(&trash_item)?.as_str())?;
            let mut files_table = tx.open_table(FILES_TABLE)?;
            files_table.remove(file_id)?;
        }
        tx.commit()?;
        Ok(())
    }

    pub fn restore_from_trash(&self, file_id: &str) -> Result<Option<TrashItem>> {
        let tx = self.db.begin_write()?;
        let result = {
            let trash_table = tx.open_table(TRASH_TABLE)?;
            let found: Option<TrashItem> = trash_table
                .get(file_id)?
                .and_then(|v| serde_json::from_str::<TrashItem>(v.value()).ok());
            found
        };
        if let Some(ref item) = result {
            let mut files_table = tx.open_table(FILES_TABLE)?;
            let serialized = serde_json::to_string(&item.original_file)?;
            files_table.insert(file_id, serialized.as_str())?;
            let mut trash_table = tx.open_table(TRASH_TABLE)?;
            trash_table.remove(file_id)?;
        }
        tx.commit()?;
        Ok(result)
    }

    pub fn list_trash(&self) -> Result<Vec<TrashItem>> {
        let tx = self.db.begin_read()?;
        let table = tx.open_table(TRASH_TABLE)?;
        let mut items = Vec::new();
        for entry in table.iter()? {
            let (_, value) = entry?;
            if let Ok(item) = serde_json::from_str::<TrashItem>(value.value()) {
                items.push(item);
            }
        }
        Ok(items)
    }

    pub fn empty_trash(&self) -> Result<u32> {
        let tx = self.db.begin_write()?;
        let mut count = 0u32;
        {
            let trash_table = tx.open_table(TRASH_TABLE)?;
            let keys: Vec<String> = trash_table
                .iter()?
                .filter_map(|e| e.ok().map(|(k, _)| k.value().to_string()))
                .collect();
            drop(trash_table);
            let mut trash_table = tx.open_table(TRASH_TABLE)?;
            for key in keys {
                trash_table.remove(key.as_str())?;
                count += 1;
            }
        }
        tx.commit()?;
        Ok(count)
    }

    pub fn create_file_version(
        &self,
        file_node: &FileNode,
        snapshot_data: Option<&str>,
    ) -> Result<FileVersion> {
        let tx = self.db.begin_write()?;
        let version = {
            let versions_table = tx.open_table(FILE_VERSIONS_TABLE)?;
            let existing: Vec<FileVersion> = versions_table
                .iter()?
                .filter_map(|e| e.ok())
                .filter(|(k, _)| k.value().starts_with(&format!("{}/", file_node.id)))
                .filter_map(|(_, v)| serde_json::from_str::<FileVersion>(v.value()).ok())
                .collect();
            let next_ver = existing.iter().map(|v| v.version_number).max().unwrap_or(0) + 1;
            FileVersion {
                id: format!("{}/v{}", file_node.id, next_ver),
                file_id: file_node.id.clone(),
                version_number: next_ver,
                hash_blake3: file_node.hash_blake3.clone(),
                size_bytes: file_node.size_bytes,
                snapshot_data: snapshot_data.map(|s| s.to_string()),
                created_at: chrono::Utc::now().to_rfc3339(),
            }
        };
        {
            let mut versions_table = tx.open_table(FILE_VERSIONS_TABLE)?;
            versions_table.insert(
                version.id.as_str(),
                serde_json::to_string(&version)?.as_str(),
            )?;
        }
        tx.commit()?;
        Ok(version)
    }

    pub fn list_file_versions(&self, file_id: &str) -> Result<Vec<FileVersion>> {
        let tx = self.db.begin_read()?;
        let table = tx.open_table(FILE_VERSIONS_TABLE)?;
        let versions: Vec<FileVersion> = table
            .iter()?
            .filter_map(|e| e.ok())
            .filter(|(k, _)| k.value().starts_with(&format!("{}/", file_id)))
            .filter_map(|(_, v)| serde_json::from_str::<FileVersion>(v.value()).ok())
            .collect();
        Ok(versions)
    }

    pub fn revert_file_version(
        &self,
        file_id: &str,
        version_id: &str,
    ) -> Result<Option<FileVersion>> {
        let tx = self.db.begin_write()?;
        let version = {
            let versions_table = tx.open_table(FILE_VERSIONS_TABLE)?;
            let found: Option<FileVersion> = versions_table
                .get(version_id)?
                .and_then(|v| serde_json::from_str::<FileVersion>(v.value()).ok());
            found
        };
        if let Some(ref ver) = version {
            let mut files_table = tx.open_table(FILES_TABLE)?;
            let existing_node: Option<FileNode> = files_table
                .get(file_id)?
                .and_then(|v| serde_json::from_str::<FileNode>(v.value()).ok());
            if let Some(mut file_node) = existing_node {
                file_node.hash_blake3 = ver.hash_blake3.clone();
                file_node.size_bytes = ver.size_bytes;
                file_node.modified_at = chrono::Utc::now().to_rfc3339();
                files_table.insert(file_id, serde_json::to_string(&file_node)?.as_str())?;
            }
        }
        tx.commit()?;
        Ok(version)
    }

    pub fn create_share_link(&self, file_id: &str, expires_in_hours: u64) -> Result<ShareLink> {
        use base64::Engine;
        use rand_core::RngCore;
        let mut token_bytes = [0u8; 32];
        rand_core::OsRng.fill_bytes(&mut token_bytes);
        let token = base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(token_bytes);

        let now = chrono::Utc::now();
        let expires_at = if expires_in_hours > 0 {
            (now + chrono::Duration::hours(expires_in_hours as i64)).to_rfc3339()
        } else {
            (now + chrono::Duration::days(365)).to_rfc3339()
        };

        let link = ShareLink {
            id: uuid::Uuid::new_v4().to_string(),
            file_id: file_id.to_string(),
            token: token.clone(),
            expires_at,
            created_at: now.to_rfc3339(),
            url: None,
        };

        let tx = self.db.begin_write()?;
        {
            let mut table = tx.open_table(SHARE_LINKS_TABLE)?;
            table.insert(link.id.as_str(), serde_json::to_string(&link)?.as_str())?;
        }
        tx.commit()?;
        Ok(link)
    }

    pub fn get_share_link_by_token(&self, token: &str) -> Result<Option<ShareLink>> {
        let tx = self.db.begin_read()?;
        let table = tx.open_table(SHARE_LINKS_TABLE)?;
        for entry in table.iter()? {
            let (_, value) = entry?;
            let link: ShareLink = serde_json::from_str(value.value())?;
            if link.token == token {
                return Ok(Some(link));
            }
        }
        Ok(None)
    }

    pub fn get_file_node(&self, file_id: &str) -> Result<Option<FileNode>> {
        let tx = self.db.begin_read()?;
        let table = tx.open_table(FILES_TABLE)?;
        match table.get(file_id)? {
            Some(v) => Ok(Some(serde_json::from_str(v.value())?)),
            None => Ok(None),
        }
    }

    pub fn add_to_parent_index(&self, file_id: &str, parent_id: &str) -> Result<()> {
        let tx = self.db.begin_write()?;
        {
            let mut table = tx.open_table(PARENT_INDEX_TABLE)?;
            let existing: Vec<String> = table
                .get(parent_id)?
                .and_then(|v| serde_json::from_str(v.value()).ok())
                .unwrap_or_default();
            let mut ids = existing;
            if !ids.contains(&file_id.to_string()) {
                ids.push(file_id.to_string());
            }
            table.insert(parent_id, serde_json::to_string(&ids)?.as_str())?;
        }
        tx.commit()?;
        Ok(())
    }

    pub fn remove_from_parent_index(&self, file_id: &str, parent_id: &str) -> Result<()> {
        let tx = self.db.begin_write()?;
        {
            let mut table = tx.open_table(PARENT_INDEX_TABLE)?;
            let existing: Vec<String> = table
                .get(parent_id)?
                .and_then(|v| serde_json::from_str(v.value()).ok())
                .unwrap_or_default();
            let mut ids = existing;
            ids.retain(|id| id != file_id);
            if ids.is_empty() {
                table.remove(parent_id)?;
            } else {
                table.insert(parent_id, serde_json::to_string(&ids)?.as_str())?;
            }
        }
        tx.commit()?;
        Ok(())
    }

    pub fn list_by_parent(&self, parent_id: &str) -> Result<Vec<String>> {
        let tx = self.db.begin_read()?;
        let table = tx.open_table(PARENT_INDEX_TABLE)?;
        let value = table.get(parent_id)?;
        match value {
            Some(v) => {
                let ids: Vec<String> = serde_json::from_str(v.value())?;
                Ok(ids)
            }
            None => Ok(Vec::new()),
        }
    }

    pub fn insert_file_with_index(
        &self,
        file_id: &str,
        serialized: &str,
        parent_id: Option<&str>,
    ) -> Result<()> {
        let tx = self.db.begin_write()?;
        {
            let mut files_table = tx.open_table(FILES_TABLE)?;
            files_table.insert(file_id, serialized)?;
            if let Some(pid) = parent_id {
                let mut index_table = tx.open_table(PARENT_INDEX_TABLE)?;
                let existing: Vec<String> = index_table
                    .get(pid)?
                    .and_then(|v| serde_json::from_str(v.value()).ok())
                    .unwrap_or_default();
                let mut ids = existing;
                if !ids.contains(&file_id.to_string()) {
                    ids.push(file_id.to_string());
                }
                index_table.insert(pid, serde_json::to_string(&ids)?.as_str())?;
            }
        }
        tx.commit()?;
        Ok(())
    }

    pub fn remove_file_with_index(&self, file_id: &str, parent_id: Option<&str>) -> Result<bool> {
        let tx = self.db.begin_write()?;
        let removed = {
            let mut files_table = tx.open_table(FILES_TABLE)?;
            let result = files_table.remove(file_id)?.is_some();
            result
        };
        if removed {
            if let Some(pid) = parent_id {
                let mut index_table = tx.open_table(PARENT_INDEX_TABLE)?;
                let existing: Vec<String> = index_table
                    .get(pid)?
                    .and_then(|v| serde_json::from_str(v.value()).ok())
                    .unwrap_or_default();
                let mut ids = existing;
                ids.retain(|id| id != file_id);
                if ids.is_empty() {
                    index_table.remove(pid)?;
                } else {
                    index_table.insert(pid, serde_json::to_string(&ids)?.as_str())?;
                }
            }
        }
        tx.commit()?;
        Ok(removed)
    }

    pub fn move_file_with_index(
        &self,
        file_id: &str,
        serialized: &str,
        old_parent_id: Option<&str>,
        new_parent_id: &str,
    ) -> Result<()> {
        let tx = self.db.begin_write()?;
        {
            let mut files_table = tx.open_table(FILES_TABLE)?;
            files_table.insert(file_id, serialized)?;
            if let Some(old_pid) = old_parent_id {
                let mut index_table = tx.open_table(PARENT_INDEX_TABLE)?;
                let existing: Vec<String> = index_table
                    .get(old_pid)?
                    .and_then(|v| serde_json::from_str(v.value()).ok())
                    .unwrap_or_default();
                let mut ids = existing;
                ids.retain(|id| id != file_id);
                if ids.is_empty() {
                    index_table.remove(old_pid)?;
                } else {
                    index_table.insert(old_pid, serde_json::to_string(&ids)?.as_str())?;
                }
            }
            let mut index_table = tx.open_table(PARENT_INDEX_TABLE)?;
            let existing: Vec<String> = index_table
                .get(new_parent_id)?
                .and_then(|v| serde_json::from_str(v.value()).ok())
                .unwrap_or_default();
            let mut ids = existing;
            if !ids.contains(&file_id.to_string()) {
                ids.push(file_id.to_string());
            }
            index_table.insert(new_parent_id, serde_json::to_string(&ids)?.as_str())?;
        }
        tx.commit()?;
        Ok(())
    }

    /// Export a compact, consistent point-in-time image of the complete database.
    ///
    /// redb read transactions provide a stable view while concurrent writes
    /// continue. Copying the logical tables into a fresh database avoids
    /// copying a live/mmap'd file and preserves every table in the schema.
    pub fn snapshot_bytes(&self) -> Result<Vec<u8>> {
        let path =
            std::env::temp_dir().join(format!("cybermanju-snapshot-{}.db", uuid::Uuid::new_v4()));

        let result = (|| -> Result<Vec<u8>> {
            let snapshot_db = RedbDatabase::create(&path)?;
            {
                let read_tx = self.db.begin_read()?;
                let write_tx = snapshot_db.begin_write()?;

                macro_rules! copy_table {
                    ($table:ident) => {{
                        let source = read_tx.open_table($table)?;
                        let mut destination = write_tx.open_table($table)?;
                        for entry in source.iter()? {
                            let (key, value) = entry?;
                            destination.insert(key.value(), value.value())?;
                        }
                    }};
                }

                copy_table!(FILES_TABLE);
                copy_table!(ACCOUNTS_TABLE);
                copy_table!(COLLECTIONS_TABLE);
                copy_table!(COLLECTION_ITEMS_TABLE);
                copy_table!(FACE_GROUPS_TABLE);
                copy_table!(LOOSE_GROUPS_TABLE);
                copy_table!(ENCRYPTION_KEYS_TABLE);
                copy_table!(LOCATIONS_TABLE);
                copy_table!(USERS_TABLE);
                copy_table!(USER_FILE_PERMS_TABLE);
                copy_table!(SYNC_CONFIGS_TABLE);
                copy_table!(PARENT_INDEX_TABLE);
                copy_table!(TRASH_TABLE);
                copy_table!(AUDIT_LOG_TABLE);
                copy_table!(FILE_VERSIONS_TABLE);
                copy_table!(SHARE_LINKS_TABLE);
                copy_table!(SYNC_FILES_TABLE);
                copy_table!(SYNC_RUNS_TABLE);
                copy_table!(SYNC_SECRETS_TABLE);
                copy_table!(SCHEMA_VERSION_TABLE);
                copy_table!(DISKS_TABLE);
                copy_table!(VOLUMES_TABLE);
                copy_table!(BLOCK_MAP_TABLE);
                copy_table!(SCRUB_RUNS_TABLE);
                copy_table!(REPAIRS_TABLE);
                copy_table!(CHUNK_REFS_TABLE);
                copy_table!(LEASES_TABLE);
                copy_table!(PROVIDER_HEALTH_TABLE);
                copy_table!(COMPUTE_TASKS_TABLE);
                copy_table!(SHELL_HISTORY_TABLE);
                copy_table!(AGENT_CONFIGS_TABLE);
                copy_table!(AGENT_SESSIONS_TABLE);
                copy_table!(AGENT_MEMORIES_TABLE);
                copy_table!(KV_TABLE);

                write_tx.commit()?;
            }
            drop(snapshot_db);

            let bytes = std::fs::read(&path)?;
            const MAX_SNAPSHOT_BYTES: usize = 256 * 1024 * 1024;
            if bytes.len() > MAX_SNAPSHOT_BYTES {
                anyhow::bail!("native database snapshot exceeds the 256 MiB export limit");
            }
            Ok(bytes)
        })();

        let _ = std::fs::remove_file(&path);
        result
    }
}

#[cfg(test)]
mod snapshot_tests {
    use super::*;

    #[test]
    fn snapshot_bytes_preserves_rows_and_opens_as_a_database() {
        let source_path = std::env::temp_dir().join(format!(
            "cybermanju-snapshot-source-{}.db",
            uuid::Uuid::new_v4()
        ));
        let snapshot_path = std::env::temp_dir().join(format!(
            "cybermanju-snapshot-copy-{}.db",
            uuid::Uuid::new_v4()
        ));
        let source = Database::new(source_path.to_str().unwrap()).unwrap();
        {
            let tx = source.db.begin_write().unwrap();
            {
                let mut table = tx.open_table(KV_TABLE).unwrap();
                table.insert("mirror:test", "snapshot-value").unwrap();
            }
            tx.commit().unwrap();
        }

        let bytes = source.snapshot_bytes().unwrap();
        std::fs::write(&snapshot_path, &bytes).unwrap();
        let snapshot = Database::new(snapshot_path.to_str().unwrap()).unwrap();
        let read_tx = snapshot.db.begin_read().unwrap();
        let table = read_tx.open_table(KV_TABLE).unwrap();
        assert_eq!(
            table.get("mirror:test").unwrap().unwrap().value(),
            "snapshot-value"
        );

        drop(table);
        drop(read_tx);
        drop(snapshot);
        drop(source);
        let _ = std::fs::remove_file(source_path);
        let _ = std::fs::remove_file(snapshot_path);
    }

    #[test]
    fn kv_methods_round_trip_list_prefix_and_delete() {
        let path =
            std::env::temp_dir().join(format!("cybermanju-kv-methods-{}.db", uuid::Uuid::new_v4()));
        let db = Database::new(path.to_str().unwrap()).unwrap();
        db.kv_set("volume:/notes.md", "Olá, vault").unwrap();
        db.kv_set("config:theme", "dark").unwrap();

        assert_eq!(
            db.kv_get("volume:/notes.md").unwrap().as_deref(),
            Some("Olá, vault")
        );
        assert_eq!(db.kv_get("missing").unwrap(), None);
        assert_eq!(
            db.kv_list("volume:").unwrap(),
            vec![("volume:/notes.md".to_string(), "Olá, vault".len())]
        );
        assert!(db.kv_delete("volume:/notes.md").unwrap());
        assert!(!db.kv_delete("volume:/notes.md").unwrap());
        assert_eq!(db.kv_get("volume:/notes.md").unwrap(), None);

        drop(db);
        let _ = std::fs::remove_file(path);
    }
}
