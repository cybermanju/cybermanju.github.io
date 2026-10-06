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
