// CyberManju OS — Search api (crates/web/src/api/search_api.rs).
// Role: REST dashboard (:3456): routes, auth, security headers.
// Exports: SearchHit, PaginatedHits, search, search_paginated, suggest,
// FederatedPeer, FederatedRequest, search_federated.
// Integrates: cybermanju_db, cybermanju_search, cybermanju_types, redb.
// Contracts: none special (pure logic; errors bubble to caller).
// CyberManju OS — Search (shared by Tauri IPC and REST)

use std::sync::{Arc, RwLock};

use cybermanju_db::Database;
use cybermanju_search::{SearchIndex, SearchRequest};
use cybermanju_types::schema::FileNode;
use redb::ReadableTable;

/// Search result item returned to the frontend.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchHit {
    pub file_id: String,
    pub file_name: String,
    pub score: f64,
    pub snippet: Option<String>,
}

/// Paginated search results with a total match count.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PaginatedHits {
    pub results: Vec<SearchHit>,
    pub total: usize,
}

type SharedIndex = Option<Arc<RwLock<SearchIndex>>>;

/// Full-text search. Falls back to a case-insensitive substring scan over
/// the files table when no index is attached (e.g. before the index has
/// been built).
pub fn search(
    index: &SharedIndex,
    db: &Database,
    query: &str,
    limit: Option<usize>,
    offset: Option<usize>,
) -> Result<Vec<SearchHit>, String> {
    let limit = limit.unwrap_or(50);

    match index {
        Some(idx) => {
            let idx = idx.read().map_err(|e| e.to_string())?;
            let request = SearchRequest {
                query: query.to_string(),
                limit: Some(limit),
                offset,
            };
            let results = idx.search(&request).map_err(|e| e.to_string())?;
            Ok(results.into_iter().map(into_hit).collect())
        }
        None => Ok(substring_scan(db, query, limit, offset)),
    }
}

/// Search with pagination: returns a page of results plus the total count.
pub fn search_paginated(
    index: &SharedIndex,
    db: &Database,
    query: &str,
    limit: usize,
    offset: usize,
) -> Result<PaginatedHits, String> {
    let results = search(index, db, query, Some(limit), Some(offset))?;
    let total = match index {
        Some(idx) => {
            let idx = idx.read().map_err(|e| e.to_string())?;
            let count_request = SearchRequest {
                query: query.to_string(),
                limit: None,
                offset: None,
            };
            idx.search(&count_request).map_err(|e| e.to_string())?.len()
        }
        None => substring_scan(db, query, usize::MAX, None).len(),
    };

    Ok(PaginatedHits { results, total })
}

/// Type-ahead suggestions for a prefix query.
pub fn suggest(
    index: &SharedIndex,
    db: &Database,
    prefix: &str,
    limit: usize,
) -> Result<Vec<String>, String> {
    match index {
        Some(idx) => {
            let idx = idx.read().map_err(|e| e.to_string())?;
            let suggestions = idx.suggest(prefix, limit).map_err(|e| e.to_string())?;
            Ok(suggestions.into_iter().map(|s| s.text).collect())
        }
        None => {
            let prefix_lc = prefix.to_lowercase();
            let mut texts: Vec<String> = Vec::new();
            for node in all_files(db)? {
                if !node.name.to_lowercase().contains(&prefix_lc) {
                    continue;
                }
                texts.push(node.name);
                if texts.len() >= limit {
                    break;
                }
            }
            Ok(texts)
        }
    }
}

fn into_hit(r: cybermanju_search::SearchResult) -> SearchHit {
    SearchHit {
        file_id: r.file_id,
        file_name: r.file_name,
        score: r.score,
        snippet: if r.snippet.is_empty() {
            None
        } else {
            Some(r.snippet)
        },
    }
}

/// One peer to fan a federated search out to (explicit base URL — this is
/// what makes android/ios/docker/wasm work where mDNS discovery cannot).
/// `token` is the peer's own bearer (per-device credentials — never the
/// caller's token unless the vault operator pastes the same secret on both
/// ends). Empty = anonymous probe; `auth:` peers stay zero hits, never a
/// failed search.
#[derive(Debug, Clone, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FederatedPeer {
    #[serde(default)]
    pub base_url: String,
    #[serde(default)]
    pub device_id: String,
    #[serde(default)]
    pub token: String,
}

/// Federated search request — local BM25 first, then peer fan-out.
#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FederatedRequest {
    #[serde(default)]
    pub query: String,
    #[serde(default)]
    pub limit: Option<usize>,
    #[serde(default)]
    pub peers: Vec<FederatedPeer>,
    #[serde(default)]
    pub timeout_secs: Option<u64>,
}

/// Federated search: local hits (tagged `local`) plus one bounded
/// `GET /api/search` per peer (tagged with its base URL), merged with
/// `peers::merge_federated_hits` (dedup by file id, max score wins). A dead
/// peer degrades to zero hits for that peer — never a failed search.
/// Only an explicit per-peer `token` is sent to that peer; the caller's
/// inbound bearer is never reused or forwarded.
pub fn search_federated(
    index: &SharedIndex,
    db: &Database,
    req: &FederatedRequest,
) -> Vec<cybermanju_sync::peers::FederatedHit> {
    let limit = req.limit.unwrap_or(50).clamp(1, 200);
    let timeout = req.timeout_secs.unwrap_or(8).clamp(1, 30);
    let mut hits: Vec<cybermanju_sync::peers::FederatedHit> =
        search(index, db, &req.query, Some(limit), None)
            .unwrap_or_default()
            .into_iter()
            .map(|h| cybermanju_sync::peers::FederatedHit {
                file_id: h.file_id,
                file_name: h.file_name,
                score: h.score,
                snippet: h.snippet.unwrap_or_default(),
                source: "local".to_string(),
            })
            .collect();
    for peer in req.peers.iter().take(8) {
        if peer.base_url.trim().is_empty() {
            continue;
        }
        // Relay tickets are the QUIC future — never fetched over HTTP.
        // They degrade to zero hits like any dead peer, without a doomed fetch.
        if cybermanju_sync::peers::classify_addr(&peer.base_url)
            == cybermanju_sync::peers::PeerTransport::RelayFuture
        {
            continue;
        }
        // Never reuse the incoming request's bearer. Only an explicit token
        // scoped to this peer may be attached to its outbound request.
        let token = peer.token.trim();
        let bearer = if token.is_empty() { None } else { Some(token) };
        match cybermanju_sync::peers::fetch_peer_hits(
            &peer.base_url,
            &req.query,
            limit,
            timeout,
            bearer,
        ) {
            Ok(mut remote) => {
                if !peer.device_id.trim().is_empty() {
                    // Compare against the normalized base (callers may send a
                    // trailing slash; `fetch_peer_hits` tags the normalized
                    // form) so device-id retagging works on every transport.
                    let normalized = cybermanju_sync::peers::normalize_base_url(&peer.base_url)
                        .unwrap_or_else(|_| peer.base_url.clone());
                    for hit in &mut remote {
                        if hit.source == peer.base_url || hit.source == normalized {
                            hit.source = peer.device_id.clone();
                        }
                    }
                }
                hits.append(&mut remote);
            }
            Err(_) => continue,
        }
    }
    cybermanju_sync::peers::merge_federated_hits(hits, limit)
}

fn all_files(db: &Database) -> Result<Vec<FileNode>, String> {
    let tx = db.begin_read().map_err(|e| e.to_string())?;
    let table = tx
        .open_table(Database::get_files_table())
        .map_err(|e| e.to_string())?;

    let mut files = Vec::new();
    for entry in table.iter().map_err(|e| e.to_string())? {
        let (_, value) = entry.map_err(|e| e.to_string())?;
        if let Ok(node) = serde_json::from_str::<FileNode>(value.value()) {
            files.push(node);
        }
    }
    Ok(files)
}

fn substring_scan(
    db: &Database,
    query: &str,
    limit: usize,
    offset: Option<usize>,
) -> Vec<SearchHit> {
    let query_lc = query.to_lowercase();
    if query_lc.is_empty() {
        return Vec::new();
    }

    let Ok(files) = all_files(db) else {
        return Vec::new();
    };

    files
        .into_iter()
        .filter(|f| f.name.to_lowercase().contains(&query_lc))
        .skip(offset.unwrap_or(0))
        .take(limit)
        .map(|f| SearchHit {
            file_id: f.id,
            file_name: f.name,
            score: 1.0,
            snippet: None,
        })
        .collect()
}
