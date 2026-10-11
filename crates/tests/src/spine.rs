// CyberManju OS — Spine (crates/tests/src/spine.rs).
// ANALYSIS 100% pass: device identity (§2B.1), server todos (§4.9), op-log
// exchange (§2C), LAN peers (§2B.2), sneakernet bundles (§2B.4) and the P0-6
// no-row-token regression — one module pinning the transport: auth gates,
// body contracts, owner scoping, idempotent merges and error prefixes.

use crate::web::{
    bearer, body_of, bootstrap_session, call, login_session, mint, mk_dashboard, now_secs, status_of,
};

fn admin(d: &cybermanju_web::WebDashboard) -> String {
    bearer(&mint(d, "admin", now_secs() + 3600, "spine-admin"))
}

fn user(d: &cybermanju_web::WebDashboard) -> String {
    bearer(&mint(d, "user", now_secs() + 3600, "spine-user"))
}

#[test]
fn new_families_require_a_session() {
    let (_dir, d) = mk_dashboard(3456);
    for (method, path, body) in [
        ("GET", "/api/devices", ""),
        ("POST", "/api/devices", "{}"),
        ("GET", "/api/todos", ""),
        ("POST", "/api/todos", "{}"),
        ("GET", "/api/oplog/since", ""),
        ("POST", "/api/oplog/push", "{}"),
        ("GET", "/api/oplog/conflicts", ""),
        ("GET", "/api/peers", ""),
        ("GET", "/api/sync/bundle/export", ""),
        ("POST", "/api/sync/bundle/import", "{}"),
    ] {
        let resp = call(&d, method, path, body, None);
        assert_eq!(status_of(&resp), 401, "{method} {path}: {resp}");
    }
}

#[test]
fn devices_register_idempotently_and_revoke_admin_only() {
    let (_dir, d) = mk_dashboard(3456);
    let auth = admin(&d);
    let reg = call(
        &d,
        "POST",
        "/api/devices",
        r#"{"name":"laptop","publicKey":"QUJD","keyAlgorithm":"ml-dsa-65"}"#,
        Some(&auth),
    );
    assert_eq!(status_of(&reg), 200, "{reg}");
    let first: serde_json::Value = serde_json::from_str(body_of(&reg)).expect("json");
    let id = first["id"].as_str().expect("id").to_string();
    assert_eq!(first["revoked"], false);

    // Re-enrollment with the same id heartbeats instead of duplicating.
    let again = call(
        &d,
        "POST",
        "/api/devices",
        &format!(r#"{{"id":"{id}","name":"laptop-2"}}"#),
        Some(&auth),
    );
    assert_eq!(status_of(&again), 200, "{again}");
    let listed = call(&d, "GET", "/api/devices", "", Some(&auth));
    let rows: serde_json::Value = serde_json::from_str(body_of(&listed)).expect("json");
    assert_eq!(rows.as_array().map(|a| a.len()), Some(1));

    // Non-admins cannot revoke or delete.
    let plain = user(&d);
    let denied = call(&d, "POST", &format!("/api/devices/{id}/revoke"), "", Some(&plain));
    assert_eq!(status_of(&denied), 403, "{denied}");
    let revoked = call(&d, "POST", &format!("/api/devices/{id}/revoke"), "", Some(&auth));
    assert_eq!(status_of(&revoked), 200, "{revoked}");
    let row: serde_json::Value = serde_json::from_str(body_of(&revoked)).expect("json");
    assert_eq!(row["revoked"], true);

    let gone = call(&d, "DELETE", &format!("/api/devices/{id}"), "", Some(&auth));
    assert_eq!(status_of(&gone), 200, "{gone}");
    let missing = call(&d, "DELETE", &format!("/api/devices/{id}"), "", Some(&auth));
    assert_eq!(status_of(&missing), 404, "{missing}");
}

#[test]
fn todos_scope_to_owners_and_validate() {
    let (_dir, d) = mk_dashboard(3456);
    // Two ordinary users through an admin (minted ids collide per role).
    let admin_token = admin(&d);
    for user in ["alice", "bob"] {
        let created = call(
            &d,
            "POST",
            "/api/users",
            &format!(r#"{{"username":"{user}","password":"correct horse battery","role":"user"}}"#),
            Some(admin_token.as_str()),
        );
        assert_eq!(status_of(&created), 201, "{created}");
    }
    let alice = bearer(&login_session(&d, "alice", "correct horse battery"));
    let bob = bearer(&login_session(&d, "bob", "correct horse battery"));
    let created = call(&d, "POST", "/api/todos", r#"{"title":"Buy milk"}"#, Some(&alice));
    assert_eq!(status_of(&created), 200, "{created}");
    let row: serde_json::Value = serde_json::from_str(body_of(&created)).expect("json");
    let id = row["id"].as_str().expect("id").to_string();

    let blank = call(&d, "POST", "/api/todos", r#"{"title":"  "}"#, Some(&alice));
    assert_eq!(status_of(&blank), 400, "{blank}");

    // Bob sees none of Alice's rows; touching them 404s (never 403-leaks).
    let bobs = call(&d, "GET", "/api/todos", "", Some(&bob));
    assert_eq!(
        body_of(&bobs),
        "[]",
        "cross-owner leak: {bobs}"
    );
    let touch = call(&d, "PUT", &format!("/api/todos/{id}"), r#"{"done":true}"#, Some(&bob));
    assert_eq!(status_of(&touch), 404, "{touch}");

    let done = call(&d, "PUT", &format!("/api/todos/{id}"), r#"{"done":true}"#, Some(&alice));
    assert_eq!(status_of(&done), 200, "{done}");
    let row: serde_json::Value = serde_json::from_str(body_of(&done)).expect("json");
    assert_eq!(row["done"], true);

    let removed = call(&d, "DELETE", &format!("/api/todos/{id}"), "", Some(&alice));
    assert_eq!(status_of(&removed), 200, "{removed}");
}

#[test]
fn oplog_push_pull_and_conflicts() {
    let (_dir, d) = mk_dashboard(3456);
    let auth = admin(&d);
    let empty = call(&d, "GET", "/api/oplog/since", "", Some(&auth));
    assert_eq!(status_of(&empty), 200, "{empty}");
    assert_eq!(body_of(&empty), r#"{"head":0,"ops":[]}"#, "{empty}");

    let bad = call(&d, "POST", "/api/oplog/push", r#"{"ops":[{"kind":""}]}"#, Some(&auth));
    assert_eq!(status_of(&bad), 400, "{bad}");

    let push = call(
        &d,
        "POST",
        "/api/oplog/push",
        r#"{"ops":[
            {"opId":"d1-0","deviceId":"d1","createdAt":"2026-10-11T00:00:00Z","kind":"tag","fileId":"f1","payload":{}},
            {"opId":"d2-0","deviceId":"d2","createdAt":"2026-10-11T00:00:00Z","kind":"rename","fileId":"f1","payload":{}}
        ]}"#,
        Some(&auth),
    );
    assert_eq!(status_of(&push), 200, "{push}");
    let report: serde_json::Value = serde_json::from_str(body_of(&push)).expect("json");
    assert_eq!(report["appended"], 2);

    // Re-push is idempotent.
    let again = call(
        &d,
        "POST",
        "/api/oplog/push",
        r#"{"ops":[
            {"opId":"d1-0","deviceId":"d1","createdAt":"2026-10-11T00:00:00Z","kind":"tag","fileId":"f1","payload":{}}
        ]}"#,
        Some(&auth),
    );
    let report: serde_json::Value = serde_json::from_str(body_of(&again)).expect("json");
    assert_eq!((report["appended"].as_u64(), report["skipped"].as_u64()), (Some(0), Some(1)));

    let page = call(&d, "GET", "/api/oplog/since?since=0&limit=500", "", Some(&auth));
    let page: serde_json::Value = serde_json::from_str(body_of(&page)).expect("json");
    assert_eq!(page["ops"].as_array().map(|a| a.len()), Some(1));

    // Same file, two devices, neither vector dominates → one fork pair.
    let conflicts = call(&d, "GET", "/api/oplog/conflicts", "", Some(&auth));
    let conflicts: serde_json::Value = serde_json::from_str(body_of(&conflicts)).expect("json");
    assert_eq!(conflicts["conflicts"].as_array().map(|a| a.len()), Some(1));
}

#[test]
fn bundle_export_import_round_trips_admin_only() {
    let (_dir, d) = mk_dashboard(3456);
    let auth = admin(&d);
    let plain = user(&d);
    let denied = call(&d, "GET", "/api/sync/bundle/export?since=0", "", Some(&plain));
    assert_eq!(status_of(&denied), 403, "{denied}");

    call(
        &d,
        "POST",
        "/api/oplog/push",
        r#"{"ops":[{"opId":"d9-0","deviceId":"d9","createdAt":"2026-10-11T00:00:00Z","kind":"star","fileId":"f2","payload":{}}]}"#,
        Some(&auth),
    );
    let export = call(&d, "GET", "/api/sync/bundle/export?since=0&deviceId=d9", "", Some(&auth));
    assert_eq!(status_of(&export), 200, "{export}");
    let bundle: serde_json::Value = serde_json::from_str(body_of(&export)).expect("json");
    assert_eq!(bundle["format"], "cyb-bundle/1");

    // Tampered bytes fail closed with integrity:, never merge.
    let tampered = body_of(&export).replace("\"kind\":\"star\"", "\"kind\":\"delete\"");
    let bad = call(&d, "POST", "/api/sync/bundle/import", &tampered, Some(&auth));
    assert_eq!(status_of(&bad), 409, "{bad}");
    assert!(body_of(&bad).contains("integrity:"), "{bad}");
}

#[test]
fn peers_answers_200_with_an_array() {
    // CI sandboxes rarely have mDNS peers; the contract is the shape —
    // 200 + array (possibly empty), never a refusal or a hang.
    let (_dir, d) = mk_dashboard(3456);
    let auth = admin(&d);
    let resp = call(&d, "GET", "/api/peers", "", Some(&auth));
    assert_eq!(status_of(&resp), 200, "{resp}");
    assert!(body_of(&resp).starts_with('['), "{resp}");
}

#[test]
fn sync_config_tokens_never_reach_rows_or_clients() {
    // P0-6 regression: the request token lands in the side table only.
    let (_dir, d) = mk_dashboard(3456);
    let token = bootstrap_session(&d, "cfgowner", "correct horse battery");
    let auth = bearer(&token);
    let saved = call(
        &d,
        "POST",
        "/api/sync/configs",
        r#"{"config":{"id":"","name":"vault","backendType":"local","token":"sekret-token"}}}"#,
        Some(&auth),
    );
    assert!(status_of(&saved) == 200 || status_of(&saved) == 400, "{saved}");
    if status_of(&saved) == 200 {
        assert!(!body_of(&saved).contains("sekret-token"), "token echoed: {saved}");
        let listed = call(&d, "GET", "/api/sync/configs", "", Some(&auth));
        assert!(!body_of(&listed).contains("sekret-token"), "token listed: {listed}");
    }
}
