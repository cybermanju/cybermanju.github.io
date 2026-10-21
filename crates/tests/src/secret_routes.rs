// CyberManju OS — Secret route regressions (crates/tests/src/secret_routes.rs).
// Exercises the real authenticated router and per-user vault ownership.

use crate::web::{bearer, body_of, call, mint, mk_dashboard, now_secs, status_of};
use cybermanju_types::secrets::{SecretKind, SecretRow};

const USER_OWNER: &str = "user-user";
const ADMIN_OWNER: &str = "user-admin";

fn save_row(d: &cybermanju_web::WebDashboard, row: &SecretRow) {
    d.db.read()
        .expect("db lock")
        .save_secret(row)
        .expect("save secret");
}

fn row(id: &str, owner_id: Option<&str>, prefix: &str) -> SecretRow {
    SecretRow {
        id: id.to_string(),
        owner_id: owner_id.map(str::to_string),
        kind: SecretKind::Login,
        title: format!("{prefix}-title"),
        username: Some(format!("{prefix}-username")),
        url: Some(format!("https://{prefix}.invalid")),
        category: Some(format!("{prefix}-category")),
        tags: vec![format!("{prefix}-tag")],
        notes: Some(format!("{prefix}-notes")),
        favorite: false,
        created_at: "2026-01-01T00:00:00Z".to_string(),
        updated_at: "2026-01-01T00:00:00Z".to_string(),
        value_sealed: String::new(),
        has_value: false,
    }
}

fn fixture() -> (
    tempfile::TempDir,
    std::sync::Arc<cybermanju_web::WebDashboard>,
    String,
    String,
) {
    let (dir, d) = mk_dashboard(3456);
    save_row(&d, &row("owned-user", Some(USER_OWNER), "mine"));
    save_row(&d, &row("owned-admin", Some(ADMIN_OWNER), "admin-vault"));
    // Store an old wire row that predates ownerId, rather than serializing
    // owner_id:null, so the serde default contract is covered as well.
    let legacy = r#"{"id":"legacy-row","kind":"login","title":"legacy-title","username":"legacy-username","url":"https://legacy.invalid","category":"legacy-category","tags":["legacy-tag"],"notes":"legacy-notes","favorite":false,"createdAt":"2026-01-01T00:00:00Z","updatedAt":"2026-01-01T00:00:00Z","valueSealed":"","hasValue":false}"#;
    {
        let db = d.db.read().expect("db lock");
        let tx = db.begin_write().expect("legacy tx");
        {
            let mut table = tx
                .open_table(cybermanju_db::Database::get_secrets_table())
                .expect("secrets table");
            table
                .insert("legacy-row", legacy)
                .expect("insert legacy row");
        }
        tx.commit().expect("commit legacy row");
    }
    let user = bearer(&mint(&d, "user", now_secs() + 3600, "secret-user"));
    let admin = bearer(&mint(&d, "admin", now_secs() + 3600, "secret-admin"));
    (dir, d, user, admin)
}

#[test]
fn secret_metadata_is_scoped_to_owner_even_for_admin() {
    let (_dir, d, user, admin) = fixture();
    for auth in [&user, &admin] {
        let response = call(&d, "GET", "/api/secrets", "", Some(auth));
        assert_eq!(status_of(&response), 200, "{response}");
        let value: serde_json::Value =
            serde_json::from_str(body_of(&response)).expect("secrets json");
        let body = body_of(&response);
        if auth == &user {
            assert!(body.contains("mine-title"), "{body}");
            assert!(body.contains("mine-username"), "{body}");
            assert!(body.contains("https://mine.invalid"), "{body}");
            assert!(body.contains("mine-notes"), "{body}");
            assert!(body.contains("mine-tag"), "{body}");
        } else {
            assert!(body.contains("admin-vault-title"), "{body}");
        }
        for foreign in [
            "admin-vault-title",
            "admin-vault-username",
            "https://admin-vault.invalid",
            "admin-vault-notes",
            "admin-vault-tag",
            "legacy-title",
            "legacy-username",
            "https://legacy.invalid",
            "legacy-notes",
            "legacy-tag",
        ] {
            if auth == &user
                || foreign.starts_with("legacy-")
                || foreign == "https://legacy.invalid"
            {
                assert!(
                    !body.contains(foreign),
                    "foreign metadata leaked ({foreign}): {body}"
                );
            }
        }
        assert_eq!(value.as_array().expect("array").len(), 1, "{value}");
    }
}

#[test]
fn unauthenticated_secret_routes_are_rejected() {
    let (_dir, d, _, _) = fixture();
    for (method, path, body) in [
        ("GET", "/api/secrets", ""),
        ("GET", "/api/secrets/owned-user", ""),
        ("GET", "/api/secrets/owned-user/reveal", ""),
        ("PUT", "/api/secrets/owned-user", "{}"),
        ("DELETE", "/api/secrets/owned-user", ""),
        ("POST", "/api/secrets", "{}"),
    ] {
        let response = call(&d, method, path, body, None);
        assert_eq!(status_of(&response), 401, "{method} {path}: {response}");
    }
}

#[test]
fn foreign_and_legacy_ids_are_not_readable_revealable_or_mutable() {
    let (_dir, d, user, admin) = fixture();
    for auth in [&user, &admin] {
        let foreign_id = if auth == &user {
            "owned-admin"
        } else {
            "owned-user"
        };
        for id in [foreign_id, "legacy-row"] {
            for (method, suffix, body) in [
                ("GET", "", ""),
                ("GET", "/reveal", ""),
                (
                    "PUT",
                    "",
                    r#"{"title":"tampered-title","notes":"tampered-notes"}"#,
                ),
                ("DELETE", "", ""),
            ] {
                let path = format!("/api/secrets/{id}{suffix}");
                let response = call(&d, method, &path, body, Some(auth));
                let expected = if auth == &user && (method != "GET" || suffix == "/reveal") {
                    403
                } else {
                    404
                };
                assert_eq!(
                    status_of(&response),
                    expected,
                    "{method} {path}: {response}"
                );
            }
            let response = call(
                &d,
                "POST",
                "/api/secrets",
                &format!(r#"{{"id":"{id}","title":"tampered-title","value":"x"}}"#),
                Some(auth),
            );
            let expected = if auth == &user { 403 } else { 404 };
            assert_eq!(status_of(&response), expected, "POST id={id}: {response}");
        }
    }
    let db = d.db.read().expect("db lock");
    for (id, expected_title) in [
        ("owned-user", "mine-title"),
        ("owned-admin", "admin-vault-title"),
        ("legacy-row", "legacy-title"),
    ] {
        let stored = db
            .get_secret(id)
            .expect("read stored row")
            .expect("row remains");
        assert_eq!(stored.title, expected_title, "row {id} changed");
        assert_ne!(stored.title, "tampered-title");
        assert_ne!(stored.notes.as_deref(), Some("tampered-notes"));
    }
}

#[test]
fn post_body_cannot_select_a_different_owner() {
    let (_dir, d, _, admin) = fixture();
    // Even an admin caller who supplies the foreign owner in JSON cannot claim
    // that owner's existing row. Authorization happens before passphrase use.
    let response = call(
        &d,
        "POST",
        "/api/secrets",
        r#"{"id":"owned-user","title":"new-entry","ownerId":"user-user"}"#,
        Some(&admin),
    );
    assert_eq!(status_of(&response), 404, "{response}");
    let db = d.db.read().expect("db lock");
    let stored = db.get_secret("owned-user").unwrap().unwrap();
    assert_eq!(stored.owner_id.as_deref(), Some(USER_OWNER));
    assert_eq!(stored.title, "mine-title");
}

#[test]
fn local_vault_does_not_bypass_authenticated_owners() {
    let (_dir, d, _, _) = fixture();
    let db = d.db.read().unwrap();
    let local = cybermanju_web::api::secrets::list(&db).unwrap();
    assert_eq!(local.len(), 1);
    assert_eq!(local[0].id, "legacy-row");
    assert!(cybermanju_web::api::secrets::get_meta(&db, "owned-user")
        .unwrap_err()
        .starts_with("not_found:"));
    assert!(cybermanju_web::api::secrets::list_scoped(&db, Some(""))
        .unwrap_err()
        .starts_with("auth:"));
    assert!(cybermanju_web::api::secrets::list_scoped(&db, Some("  "))
        .unwrap_err()
        .starts_with("auth:"));
}

#[test]
fn owner_can_read_update_and_delete_own_metadata() {
    let (_dir, d, _, admin) = fixture();
    for (method, body) in [
        ("GET", ""),
        ("PUT", r#"{"title":"renamed"}"#),
        ("DELETE", ""),
    ] {
        let response = call(&d, method, "/api/secrets/owned-admin", body, Some(&admin));
        assert_eq!(status_of(&response), 200, "{response}");
    }
    assert!(d
        .db
        .read()
        .unwrap()
        .get_secret("owned-admin")
        .unwrap()
        .is_none());
}
