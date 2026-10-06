// CyberManju OS — scene heuristic matcher.
//
// An HONEST classifier: it never claims vision it does not have. Scores come
// only from filename / path / user-tag text matched against the multilingual
// keyword tables in `data/scenes.json` (the same file the TypeScript UI
// parses, so desktop, server and WASM agree exactly).
//
// Each reported category carries a confidence in (0, 1] plus the keywords
// that fired, so every UI can render it as a bearing honestly ("BEACH 87% —
// matched praia") instead of a fake detection.

use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::sync::OnceLock;

// ── tables ────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Deserialize)]
struct Tables {
    #[serde(default)]
    parents: HashMap<String, String>,
    categories: Vec<Category>,
}

#[derive(Debug, Clone, Deserialize)]
struct Category {
    id: String,
    label: String,
    keywords: HashMap<String, Vec<String>>,
}

fn tables() -> &'static Tables {
    static ONCE: OnceLock<Tables> = OnceLock::new();
    ONCE.get_or_init(|| {
        serde_json::from_str(include_str!("../data/scenes.json"))
            .expect("scenes.json must parse")
    })
}

// ── normalization ─────────────────────────────────────────────────────────

/// Lowercase + latin diacritic fold. Cyrillic/CJK/kana pass through
/// untouched (Rust `to_lowercase` is Unicode-aware; combining marks U+0300–
/// U+036F are stripped so `plage` matches `plagé`-style spellings).
pub fn norm(s: &str) -> String {
    let lower = s.to_lowercase();
    let mut out = String::with_capacity(lower.len());
    for c in lower.chars() {
        if ('\u{0300}'..='\u{036f}').contains(&c) {
            continue;
        }
        out.push(c);
    }
    // Decompose precomposed latin letters without pulling in a unicode
    // crate: cover the latin-1 + latin-ext vowels used by our tables.
    out.chars()
        .map(|c| match c {
            'à' | 'á' | 'â' | 'ã' | 'ä' | 'å' | 'ā' | 'ă' | 'ą' => 'a',
            'è' | 'é' | 'ê' | 'ë' | 'ē' | 'ĕ' | 'ę' => 'e',
            'ì' | 'í' | 'î' | 'ï' | 'ĩ' | 'ī' => 'i',
            'ò' | 'ó' | 'ô' | 'õ' | 'ö' | 'ø' | 'ō' => 'o',
            'ù' | 'ú' | 'û' | 'ü' | 'ũ' | 'ū' => 'u',
            'ý' | 'ÿ' => 'y',
            'ç' | 'ć' | 'č' => 'c',
            'ñ' | 'ń' => 'n',
            'š' | 'ś' => 's',
            'ž' | 'ź' | 'ż' => 'z',
            'ß' => 's', // folded single-char; pairs with "ss" via substring rule
            'ł' => 'l',
            'æ' => 'a', // folded; "ae" spellings still hit via substring
            'œ' => 'o',
            _ => c,
        })
        .collect()
}

fn split_tokens(s: &str) -> Vec<String> {
    s.split(|c: char| {
        c.is_whitespace() || matches!(c, '/' | '\\' | '_' | '-' | '.' | ',' | ';' | ':' | '(' | ')' | '[' | ']' | '\'' | '"')
    })
    .filter(|t| !t.is_empty())
    .map(|t| t.to_string())
    .collect()
}

// ── scoring ───────────────────────────────────────────────────────────────

/// One reported category: confidence in (0, 1] + the keywords that fired.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SceneScore {
    pub category: String,
    pub label: String,
    /// 0..1 (never exactly 0 — unreported categories are omitted).
    pub score: f32,
    pub hits: Vec<String>,
}

/// Evidence fed to the matcher.
#[derive(Debug, Clone, Default)]
pub struct SceneInput {
    pub file_name: String,
    pub tags: Vec<String>,
    /// Parent folders / full path — weaker signal than the name itself.
    pub path: String,
    /// The item is already known to depict a person (face cluster hit).
    pub has_faces: bool,
    /// Image-ish mimetypes get a whisper of prior; anything else none.
    pub mime_type: String,
}

const W_NAME: f32 = 1.0;
const W_TAG: f32 = 0.95;
const W_PATH: f32 = 0.7;
const S_EXACT: f32 = 0.9; // token == keyword, or whole-string phrase hit
const S_SUB: f32 = 0.55; // keyword is a strict substring of a longer token
const S_TINY: f32 = 0.4; // single-character CJK-style keyword substring hit
const MIN_REPORT: f32 = 0.30;
const MAX_SCORE: f32 = 0.97;

fn combine(acc: f32, w: f32, s: f32) -> f32 {
    (acc + w * s * (1.0 - acc)).min(MAX_SCORE)
}

/// Score one normalized keyword against token/haystack evidence.
fn keyword_signal(keyword: &str, tokens: &[String], hay: &str) -> f32 {
    if keyword.is_empty() {
        return 0.0;
    }
    if keyword.contains(' ') {
        // Multi-word phrase ("lune de miel"): whole-string containment.
        return if hay.contains(keyword) { S_EXACT } else { 0.0 };
    }
    let kw_chars = keyword.chars().count();
    let mut best = 0.0;
    for t in tokens {
        if t == keyword {
            return S_EXACT;
        }
        if kw_chars == 1 {
            // Single CJK-style char: containment anywhere is only a weak
            // signal (whole-token equality already returned exact above).
            if t.contains(keyword) {
                best = best.max(S_TINY);
            }
        } else if kw_chars >= 4 && t.chars().count() > kw_chars {
            // Mid-token containment ("cume" in "document") is noise, but
            // edge-aligned forms are real morphology ("praias", "beaches").
            if t.starts_with(keyword) || t.ends_with(keyword) {
                best = best.max(S_SUB);
            }
        }
    }
    // Unsegmented scripts (CJK strings with no token boundaries at all):
    // raw containment is the only signal available. Latin single tokens
    // already had their edge-aligned chance above — "cume" in "document"
    // must stay silent.
    if best == 0.0 && kw_chars >= 2 && hay.contains(keyword) && is_unsegmented(hay) {
        // Token equality already failed, so this is a within-string hit.
        best = S_SUB.min(S_EXACT - 0.1);
    }
    best
}

/// True when the haystack is CJK-style continuous script (Han, hiragana,
/// katakana, Hangul) — the only case where raw containment is legitimate.
fn is_unsegmented(hay: &str) -> bool {
    hay.chars().any(|c| {
        matches!(c,
            '\u{4e00}'..='\u{9fff}'   // CJK unified ideographs
            | '\u{3040}'..='\u{309f}' // hiragana
            | '\u{30a0}'..='\u{30ff}' // katakana
            | '\u{ac00}'..='\u{d7af}' // hangul syllables
        )
    })
}

fn is_image_mime(mime: &str) -> bool {
    let m = mime.to_lowercase();
    m.starts_with("image/") || m.contains("photo") || m.contains("picture")
}

/// Classify evidence → sorted descending scene scores (empty = no signal).
pub fn classify(input: &SceneInput) -> Vec<SceneScore> {
    let t = tables();
    let stem = input
        .file_name
        .rsplit_once('.')
        .map(|(s, _)| s)
        .unwrap_or(&input.file_name);
    let name_n = norm(stem);
    let path_n = norm(&input.path);
    let tags_n: Vec<String> = input.tags.iter().map(|s| norm(s)).collect();

    let name_tokens = split_tokens(&name_n);
    let path_tokens = split_tokens(&path_n);
    let tag_tokens: Vec<String> = tags_n.iter().flat_map(|s| split_tokens(s)).collect();
    let tags_hay = tags_n.join(" ");

    let mut out: Vec<SceneScore> = Vec::new();
    for cat in &t.categories {
        let mut acc = 0.0f32;
        let mut hits: Vec<String> = Vec::new();
        let mut seen: HashSet<String> = HashSet::new();
        // Deterministic language order for stable hits output.
        let mut langs: Vec<&String> = cat.keywords.keys().collect();
        langs.sort();
        for lang in langs {
            for kw_raw in &cat.keywords[lang] {
                let kw = norm(kw_raw);
                let s_name = keyword_signal(&kw, &name_tokens, &name_n);
                let s_tag = keyword_signal(&kw, &tag_tokens, &tags_hay);
                let s_path = keyword_signal(&kw, &path_tokens, &path_n);
                // Source weight folded into the signal; combine additively.
                let s = (W_NAME * s_name).max(W_TAG * s_tag).max(W_PATH * s_path);
                if s > 0.0 {
                    acc = combine(acc, 1.0, s);
                    if seen.insert(kw.clone()) {
                        hits.push(kw_raw.clone());
                    }
                }
            }
        }
        if cat.id == "human" && input.has_faces {
            acc = combine(acc, 1.0, 0.55);
            if !seen.contains("face-cluster") {
                hits.push("face-cluster".to_string());
            }
        }
        if acc >= MIN_REPORT {
            out.push(SceneScore {
                category: cat.id.clone(),
                label: cat.label.clone(),
                score: (acc * 100.0).round() / 100.0,
                hits,
            });
        }
    }

    // Child → parent inheritance at a discount (dog ⇒ animal @60%).
    let mut extra: Vec<SceneScore> = Vec::new();
    for s in &out {
        if let Some(parent) = t.parents.get(&s.category) {
            let ps = (s.score * 0.6 * 100.0).round() / 100.0;
            if ps >= MIN_REPORT && !out.iter().any(|o| &o.category == parent) {
                if let Some(cat) = t.categories.iter().find(|c| &c.id == parent) {
                    extra.push(SceneScore {
                        category: cat.id.clone(),
                        label: cat.label.clone(),
                        score: ps,
                        hits: vec![format!("inferred:{}", s.category)],
                    });
                }
            }
        }
    }
    out.extend(extra);

    if is_image_mime(&input.mime_type) {
        // Whisper of prior for visual categories — never enough alone.
        for s in out.iter_mut() {
            s.score = ((s.score + 0.02).min(MAX_SCORE) * 100.0).round() / 100.0;
        }
    }

    out.sort_by(|a, b| {
        b.score
            .partial_cmp(&a.score)
            .unwrap_or(std::cmp::Ordering::Equal)
            .then_with(|| a.category.cmp(&b.category))
    });
    out
}

/// Which scene categories does a free-text query name? Powers the dynamic
/// search listing ("praia" → BEACH) in every language of the tables.
pub fn match_query(query: &str) -> Vec<SceneScore> {
    classify(&SceneInput {
        file_name: query.to_string(),
        ..Default::default()
    })
}

/// All category ids + labels (for UI pickers / tests).
pub fn category_list() -> Vec<(String, String)> {
    tables()
        .categories
        .iter()
        .map(|c| (c.id.clone(), c.label.clone()))
        .collect()
}

#[cfg(test)]
mod tests;
