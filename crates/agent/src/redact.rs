// CyberManju OS — Redact (crates/agent/src/redact.rs).
// Secret redaction for tool outputs (omp-style stream hygiene).
//
// Tool results flow back into the transcript, which persists to disk and
// syncs across providers — a pasted API key in `env` output or an
// `Authorization:` header echo must never land there. `redact` scans for
// known secret markers (ASCII case-insensitive, so shouting env files are
// covered) plus JWT shapes and replaces the secret run with `***`, keeping
// the marker so the model still sees *which* credential kind appeared.
// Pure string surgery: no regex crate, no I/O, wasm-safe. Offsets are byte
// indices into the original text, so multibyte content can never mis-slice.

/// Markers whose trailing token run is secret. Matching is case-sensitive
/// on purpose (`PASSWORD=` in shouting config files is still caught by the
/// lowercase pass — see `redact`).
/// Lowercase twins are unnecessary: matching below is ASCII
/// case-insensitive, so `PASSWORD=` and `password=` hit the same rule.
const MARKERS: &[&str] = &[
    "sk-ant-",
    "sk-",
    "AKIA",
    "ghp_",
    "gho_",
    "ghu_",
    "github_pat_",
    "xox",
    "glpat-",
    "Bearer ",
    "api_key=",
    "apiKey=",
    "apikey=",
    "key=",
    "password=",
    "passwd=",
    "passphrase=",
    "secret=",
    "token=",
    "jwt_secret",
    "ya29.",
];

/// Characters that may continue a secret token.
fn is_token_char(c: char) -> bool {
    c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.' | '/' | '+' | '=' | '~')
}

/// Redact secrets in `text`. Returns `(redacted, replacements)`.
pub fn redact(text: &str) -> (String, usize) {
    // Cheap path first: no marker, no JWT shape, no work.
    let mut hits: Vec<(usize, usize)> = Vec::new();

    // All ordinary markers are matched in ONE pass over the original bytes (ASCII
    // case-insensitive): byte offsets always stay in `text` coordinates,
    // which keeps every later slice on a char boundary.
    // Longest marker first, so `sk-ant-…` wins over its prefix `sk-` and
    // the more specific credential kind stays visible in the redacted text.
    let mut markers: Vec<&str> = MARKERS.to_vec();
    markers.sort_by_key(|m| std::cmp::Reverse(m.len()));
    let mut claimed: std::collections::HashSet<usize> = std::collections::HashSet::new();
    for marker in markers {
        let needle = marker.as_bytes();
        let mut from = 0;
        let bytes = text.as_bytes();
        while from + needle.len() <= bytes.len() {
            let window = &bytes[from..from + needle.len()];
            let matches = window
                .iter()
                .zip(needle.iter())
                .all(|(a, b)| a.eq_ignore_ascii_case(b));
            if !matches {
                from += 1;
                continue;
            }
            let start = from;
            let secret_start = start + needle.len();
            let mut end = secret_start;
            let mut run = 0;
            while end < bytes.len() && run < 512 && is_token_char(bytes[end] as char) {
                end += 1;
                run += 1;
            }
            if end > secret_start && claimed.insert(start) {
                // Redact only the secret run — the marker itself stays so the
                // model still sees *which* credential kind appeared.
                hits.push((secret_start, end));
                from = end;
            } else {
                from = secret_start;
            }
        }
    }
    scan_pem(text, &mut hits);
    scan_jwt(text, &mut hits);

    if hits.is_empty() {
        return (text.to_string(), 0);
    }
    hits.sort_unstable();
    hits.dedup();
    // Merge overlaps so one secret yields one `***`.
    let mut merged: Vec<(usize, usize)> = Vec::with_capacity(hits.len());
    for (start, end) in hits {
        // Defense in depth for every scanner: a future byte-cap or matcher
        // regression must discard the input, never panic or expose a suffix.
        if start > end
            || end > text.len()
            || !text.is_char_boundary(start)
            || !text.is_char_boundary(end)
        {
            return ("***".to_string(), 1);
        }
        if let Some(last) = merged.last_mut() {
            if start <= last.1 {
                last.1 = last.1.max(end);
                continue;
            }
        }
        merged.push((start, end));
    }
    let mut out = String::with_capacity(text.len());
    let mut cursor = 0;
    for (start, end) in &merged {
        out.push_str(&text[cursor..*start]);
        out.push_str("***");
        cursor = *end;
    }
    out.push_str(&text[cursor..]);
    let count = merged.len();
    (out, count)
}

/// Scan PEM-style private-key blocks. ANSI CSI sequences are skipped while
/// identifying structural lines, so color-wrapped/split headers still match.
/// A missing terminator fails closed to EOF; each block is bounded to 1 MiB.
/// Ambiguous BEGIN spacing/labels after five dashes discard the suffix, even
/// for non-private labels: guessing whether malformed PEM is public is unsafe.
fn scan_pem(text: &str, hits: &mut Vec<(usize, usize)>) {
    const MAX_BLOCK: usize = 1_048_576;
    const MAX_HEADER: usize = 256;
    let b = text.as_bytes();
    let mut line_start = 0;
    while line_start < b.len() {
        let line_end = b[line_start..]
            .iter()
            .position(|&x| x == b'\n')
            .map(|n| line_start + n)
            .unwrap_or(b.len());
        let mut clean = Vec::new();
        let mut offsets = Vec::new();
        let mut i = line_start;
        // Memory is linear in this input line (Hub fields are byte-capped at
        // ingress). Do not silently stop before a header in a long log prefix.
        while i < line_end {
            if b[i] == 0x1b && i + 1 < line_end && b[i + 1] == b'[' {
                i += 2;
                while i < line_end && !(0x40..=0x7e).contains(&b[i]) {
                    i += 1;
                }
                if i < line_end {
                    i += 1;
                }
            } else {
                clean.push(b[i]);
                offsets.push(i);
                i += 1;
            }
        }
        if clean.ends_with(b"\r") {
            clean.pop();
            offsets.pop();
        }

        // Headers may be embedded in log prefixes, and CSI controls may split
        // any header byte. Keep the original offset of every normalized byte.
        let mut pos = 0;
        while pos + 5 <= clean.len() {
            if &clean[pos..pos + 5] != b"-----" {
                pos += 1;
                continue;
            }
            let mut begin = pos + 5;
            // Decode only the next scalar, never cast UTF-8 bytes to chars.
            // Noncanonical Unicode separators must reach the fail-closed
            // spacing check below instead of hiding a private-key candidate.
            while let Some(width) = pem_whitespace_len(&clean[begin..]) {
                begin += width;
            }
            if begin + 5 > clean.len() || !ascii_eq_ignore_case(&clean[begin..begin + 5], b"BEGIN")
            {
                pos += 1;
                continue;
            }
            if begin != pos + 5 || pos + 11 > clean.len() || clean[pos + 10] != b' ' {
                hits.push((offsets[pos], b.len()));
                return;
            }
            let label_start = pos + 11;
            let header_limit = label_start.saturating_add(MAX_HEADER + 5).min(clean.len());
            let label_end = match clean[label_start..header_limit]
                .windows(5)
                .position(|w| w == b"-----")
            {
                Some(n) => label_start + n,
                None => {
                    // A malformed or oversized PEM candidate is not safe prose.
                    // Avoid repeated suffix scans and discard its trailing data.
                    hits.push((offsets[pos], b.len()));
                    return;
                }
            };
            let label = &clean[label_start..label_end];
            let private_suffix = b"PRIVATE KEY";
            let candidate = label.len() >= private_suffix.len()
                && ascii_eq_ignore_case(
                    &label[label.len() - private_suffix.len()..],
                    private_suffix,
                );
            let valid_label = !label.is_empty()
                && label.len() <= MAX_HEADER
                && !label.starts_with(b" ")
                && !label.ends_with(b" ")
                && !label.windows(2).any(|pair| pair == b"  ")
                && label
                    .iter()
                    .all(|x| x.is_ascii_alphanumeric() || *x == b' ' || *x == b'-');
            if !valid_label {
                hits.push((offsets[pos], b.len()));
                return;
            }
            if candidate {
                let start = offsets[pos];
                let search_start = if line_end < b.len() {
                    line_end + 1
                } else {
                    line_end
                };
                let mut limit = search_start.saturating_add(MAX_BLOCK).min(b.len());
                // The byte cap may land inside a multibyte scalar. Never make
                // that index a cursor or an emitted string-slice boundary.
                while !text.is_char_boundary(limit) {
                    limit -= 1;
                }
                let mut cursor = search_start;
                let mut found = None;
                while cursor < limit {
                    let row_end = b[cursor..limit]
                        .iter()
                        .position(|&x| x == b'\n')
                        .map(|n| cursor + n)
                        .unwrap_or(limit);
                    let mut row = Vec::new();
                    let mut row_offsets = Vec::new();
                    let mut j = cursor;
                    while j < row_end {
                        if b[j] == 0x1b && j + 1 < row_end && b[j + 1] == b'[' {
                            j += 2;
                            while j < row_end && !(0x40..=0x7e).contains(&b[j]) {
                                j += 1;
                            }
                            if j < row_end {
                                j += 1;
                            }
                        } else {
                            row.push(b[j]);
                            row_offsets.push(j);
                            j += 1;
                        }
                    }
                    if row.ends_with(b"\r") {
                        row.pop();
                        row_offsets.pop();
                    }
                    let end_prefix = b"-----END ";
                    let mut k = 0;
                    while k + end_prefix.len() <= row.len() {
                        if ascii_eq_ignore_case(&row[k..k + end_prefix.len()], end_prefix) {
                            let label_end = k + end_prefix.len() + label.len();
                            let matches_end = label_end + 5 <= row.len()
                                && ascii_eq_ignore_case(
                                    &row[k + end_prefix.len()..label_end],
                                    label,
                                )
                                && &row[label_end..label_end + 5] == b"-----";
                            if matches_end {
                                // Stop after the final ASCII dash, not the whole
                                // line: a second BEGIN may follow trailing log
                                // text here. Map through stripped CSI controls
                                // so this remains an original UTF-8 boundary.
                                found = Some(row_offsets[label_end + 4] + 1);
                                break;
                            }
                        }
                        k += 1;
                    }
                    if found.is_some() {
                        break;
                    }
                    if row_end == limit {
                        // The block scan cap must never expose trailing material.
                        break;
                    }
                    cursor = row_end + 1;
                }
                let end = found.unwrap_or(b.len());
                hits.push((start, end));
                if end == b.len() {
                    return;
                }
                // Resume after a consumed block: nested BEGIN text belongs to
                // the outer block, but the rest of its END line is unscanned.
                line_start = end;
                break;
            }
            pos = label_end + 5;
        }
        if line_start > line_end {
            continue;
        }
        if line_end == b.len() {
            break;
        }
        line_start = line_end + 1;
    }
}

/// Recognize Unicode White_Space while retaining normalized byte offsets.
/// CSI stripping can leave malformed UTF-8; never slice a str at that offset.
fn pem_whitespace_len(bytes: &[u8]) -> Option<usize> {
    let width = match *bytes.first()? {
        0x00..=0x7f => 1,
        0xc2..=0xdf => 2,
        0xe0..=0xef => 3,
        0xf0..=0xf4 => 4,
        _ => return None,
    };
    let scalar = std::str::from_utf8(bytes.get(..width)?)
        .ok()?
        .chars()
        .next()?;
    scalar.is_whitespace().then_some(width)
}

fn ascii_eq_ignore_case(a: &[u8], b: &[u8]) -> bool {
    a.len() == b.len() && a.iter().zip(b).all(|(x, y)| x.eq_ignore_ascii_case(y))
}

/// JWT shapes (`eyJ…​.…​.…`) with no marker at all.
fn scan_jwt(text: &str, hits: &mut Vec<(usize, usize)>) {
    let bytes = text.as_bytes();
    let mut i = 0;
    while i + 4 < bytes.len() {
        if &bytes[i..i + 3] == b"eyJ" {
            let mut end = i + 3;
            let mut dots = 0;
            while end < bytes.len() && is_token_char(bytes[end] as char) {
                if bytes[end] == b'.' {
                    dots += 1;
                }
                end += 1;
            }
            // Three segments, sane length: almost certainly a JWT.
            if dots == 2 && end - i > 20 && end - i < 4096 {
                hits.push((i, end));
                i = end;
                continue;
            }
        }
        i += 1;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn clean_text_passes_through_untouched() {
        let (out, n) = redact("fn main() {\n    println!(\"hello\");\n}");
        assert_eq!(n, 0);
        assert!(out.contains("hello"));
    }

    #[test]
    fn known_markers_redact_the_token_run() {
        let (out, n) = redact("key is sk-ant-secretvalue123 and done");
        assert_eq!(n, 1);
        assert!(out.contains("sk-ant-***"), "{out}");
        assert!(!out.contains("secretvalue123"));

        let (out, n) = redact("AKIAIOSFODNN7EXAMPLE here");
        assert_eq!(n, 1, "{out}");
        assert!(out.contains("AKIA***"));

        let (out, n) = redact("Authorization: Bearer abcdef123456");
        assert_eq!(n, 1, "{out}");
        assert!(!out.contains("abcdef123456"));
    }

    #[test]
    fn env_shouting_and_assignments_are_covered() {
        let (out, n) = redact("PASSWORD=hunter2-hunter2\nother=1");
        assert_eq!(n, 1, "{out}");
        assert!(!out.contains("hunter2"));
        assert!(out.contains("other=1"));

        let (out, _) = redact("-----BEGIN PRIVATE KEY-----\nMIIEvgIBADAN");
        assert!(!out.contains("MIIEvg"), "{out}");
    }

    #[test]
    fn server_secret_shapes_are_covered() {
        // `?key=` query auth, env-dumped master passphrase / jwt secret,
        // Google OAuth access tokens.
        let (out, n) = redact("url?key=AIzaSyD-abc123XYZ_ ok");
        assert_eq!(n, 1, "{out}");
        assert!(!out.contains("AIzaSyD"), "{out}");

        let (out, n) = redact("CYBERMANJU_MASTER_PASSPHRASE=hunter2-hunter2\nother=1");
        assert_eq!(n, 1, "{out}");
        assert!(!out.contains("hunter2"));
        assert!(out.contains("other=1"));

        let (out, n) = redact("jwt_secret=hunter2");
        assert_eq!(n, 1, "{out}");
        assert!(!out.contains("hunter2"));

        let (out, n) = redact("token ya29.a0AfH6SMBx1234567890 ok");
        assert_eq!(n, 1, "{out}");
        assert!(!out.contains("AfH6SMB"));
    }

    #[test]
    fn bare_markers_without_secrets_stay_put() {
        let (out, n) = redact("set token= then run");
        assert_eq!(n, 0, "{out}");
        assert!(out.contains("token="));
    }

    #[test]
    fn overlapping_markers_merge_into_one_replacement() {
        // `sk-` is a prefix of the longer run; one secret, one `***`.
        let (out, n) = redact("sk-ant-abc123");
        assert_eq!(n, 1, "{out}");
        assert_eq!(out.matches("***").count(), 1);
    }

    #[test]
    fn pem_private_key_variants_and_crlf_redact_whole_blocks() {
        for label in [
            "RSA PRIVATE KEY",
            "OPENSSH PRIVATE KEY",
            "EC PRIVATE KEY",
            "ENCRYPTED PRIVATE KEY",
            "FUTURE PRIVATE KEY",
        ] {
            let input = format!("before\r\n-----BEGIN {label}-----\r\nline one\r\nline two\r\n-----END {label}-----\r\nafter");
            let (out, n) = redact(&input);
            assert_eq!(n, 1, "{label}: {out}");
            assert!(
                !out.contains("line one") && !out.contains("line two"),
                "{out}"
            );
            assert!(
                out.starts_with("before\r\n") && out.ends_with("after"),
                "{out}"
            );
        }
    }

    #[test]
    fn pem_unterminated_and_nested_begin_fail_closed_without_fragments() {
        let input = "safe\n-----BEGIN RSA PRIVATE KEY-----\nsecret\n-----BEGIN EC PRIVATE KEY-----\nstill secret";
        let (out, n) = redact(input);
        assert_eq!(n, 1, "{out}");
        assert_eq!(out, "safe\n***");
    }

    #[test]
    fn ansi_wrapped_pem_header_and_body_are_redacted() {
        let input = "\x1b[31m-----BEGIN RSA PRIVATE KEY-----\x1b[0m\n\x1b[32msecret-body\x1b[0m\n\x1b[31m-----END RSA PRIVATE KEY-----\x1b[0m\nvisible";
        let (out, n) = redact(input);
        assert_eq!(n, 1, "{out}");
        assert!(!out.contains("secret-body"));
        assert!(out.ends_with("visible"));
    }

    #[test]
    fn pem_inline_lowercase_multiple_and_ansi_split_headers_redact() {
        let input = concat!(
            "key: -----begin private key-----  \r\nfirst-secret\r\n",
            "-----end private key----- trailing text\r\n",
            "next: -----BEGIN RSA PRIVATE KEY-----\nsecond-secret\n",
            "-----END RSA PRIVATE KEY-----\n",
            "\x1b[31m-----BE\x1b[0mGIN EC PRIVATE KEY-----\nthird-secret\n",
            "-----END EC PRIVATE KEY-----\nvisible",
        );
        let (out, n) = redact(input);
        assert_eq!(n, 3, "{out}");
        assert!(!out.contains("first-secret"));
        assert!(!out.contains("second-secret"));
        assert!(!out.contains("third-secret"));
        assert!(out.ends_with("visible"));
    }

    #[test]
    fn pem_long_prefix_and_closed_outer_block_leave_no_nested_material() {
        let prefix = "ç".repeat(4097);
        let input = format!("{prefix}-----BEGIN PRIVATE KEY-----\nouter-secret\n-----BEGIN EC PRIVATE KEY-----\ninner-secret\n-----END PRIVATE KEY-----\nvisible");
        let (out, n) = redact(&input);
        assert_eq!(n, 1);
        assert!(out.starts_with(&prefix));
        assert!(out.ends_with("visible"));
        assert!(!out.contains("secret"));
        assert!(!out.contains("PRIVATE KEY"));
    }

    #[test]
    fn pem_scan_and_header_caps_fail_closed_to_eof() {
        let input = format!(
            "safe\n-----BEGIN PRIVATE KEY-----\n{}\n-----END PRIVATE KEY-----\ntrailing-secret",
            "x".repeat(1_048_577)
        );
        assert_eq!(redact(&input).0, "safe\n***");
        let oversized = format!(
            "safe\n-----BEGIN {} PRIVATE KEY-----\nsecret\n",
            "X".repeat(257)
        );
        assert_eq!(redact(&oversized).0, "safe\n***");
        assert_eq!(
            redact("safe\n-----BEGIN PRIVATE KEY\nsecret").0,
            "safe\n***"
        );
    }

    #[test]
    fn pem_second_begin_on_first_end_line_redacts_both_bodies() {
        let exact = "-----BEGIN PRIVATE KEY-----\nFIRSTMATERIAL\n-----END PRIVATE KEY----- -----BEGIN PRIVATE KEY-----\nSECONDMATERIAL\n-----END PRIVATE KEY-----\nvisible";
        assert_eq!(redact(exact), ("*** ***\nvisible".into(), 2));
        for newline in ["\n", "\r\n"] {
            for ansi in [false, true] {
                let first_end = if ansi {
                    "-----EN\x1b[0mD PRIVATE KEY-----"
                } else {
                    "-----END PRIVATE KEY-----"
                };
                let second_begin = if ansi {
                    "-----BE\x1b[31mGIN RSA PRIVATE KEY-----"
                } else {
                    "-----BEGIN RSA PRIVATE KEY-----"
                };
                let input = format!("préfix{newline}-----BEGIN PRIVATE KEY-----{newline}FIRST_BODY_MATERIAL{newline}{first_end} trailing ç log {second_begin}{newline}SECOND_BODY_LINE_ONE{newline}SECOND_BODY_LINE_TWO{newline}-----END RSA PRIVATE KEY-----{newline}visible");
                let (out, count) = redact(&input);
                assert_eq!(count, 2, "{out:?}");
                assert_eq!(
                    out,
                    format!("préfix{newline}*** trailing ç log ***{newline}visible")
                );
                for residue in [
                    "FIRST_BODY_MATERIAL",
                    "SECOND_BODY_LINE_ONE",
                    "SECOND_BODY_LINE_TWO",
                    "PRIVATE KEY",
                ] {
                    assert!(!out.contains(residue), "{out:?}");
                }
                // A later pass must not be needed to discover the second key.
                assert_eq!(redact(&out), (out, 0));
            }
        }
    }

    #[test]
    fn pem_multibyte_scan_cap_never_panics_or_leaks_suffix() {
        // Every possible cap position within a four-byte emoji is exercised.
        for padding in 0..4 {
            let input = format!(
                "préfix\n-----BEGIN PRIVATE KEY-----\n{}{}\n-----END PRIVATE KEY-----\nSECRETMATERIAL",
                "x".repeat(padding), "😀".repeat(262_145)
            );
            assert!(input.len() > 1_048_576);
            let result = std::panic::catch_unwind(|| redact(&input));
            assert!(result.is_ok(), "redaction panicked at padding {padding}");
            assert_eq!(result.unwrap(), ("préfix\n***".into(), 1));
        }
    }

    #[test]
    fn malformed_pem_header_spacing_fails_closed_to_eof() {
        for header in [
            "----- BEGIN PRIVATE KEY-----",
            "-----\tBEGIN PRIVATE KEY-----",
            "-----BEGIN\tPRIVATE KEY-----",
            "-----BEGINPRIVATE KEY-----",
            "-----BEGIN  PRIVATE KEY-----",
            "-----BEGIN PRIVATE KEY -----",
            "-----BEGIN PRIVATE  KEY-----",
            "-----BEGIN PRIVATE\tKEY-----",
            "-----BEGIN PRIVATE KEY\t-----",
            "-----BEGIN PRIVATE\u{a0}KEY-----",
            "-----BE\x1b[31mGIN PRIVATE KEY -----",
        ] {
            let input = format!(
                "safe\n{header}\nHIDDENMATERIAL\n-----END PRIVATE KEY-----\nambiguous suffix"
            );
            assert_eq!(redact(&input), ("safe\n***".into(), 1), "{header:?}");
        }
        // Canonical public PEM stays useful; ambiguous END cannot terminate a
        // private block, and therefore discards the complete remaining suffix.
        let public = "-----BEGIN CERTIFICATE-----\npublic\n-----END CERTIFICATE-----";
        assert_eq!(redact(public), (public.into(), 0));
        let end = "safe\n-----BEGIN PRIVATE KEY-----\nHIDDENMATERIAL\n-----END PRIVATE KEY -----\nambiguous suffix";
        assert_eq!(redact(end), ("safe\n***".into(), 1));
    }

    #[test]
    fn pem_unicode_separator_whitespace_fails_closed_without_slicing_utf8() {
        for separator in [
            '\u{85}', '\u{a0}', '\u{1680}', '\u{2000}', '\u{2001}', '\u{2002}', '\u{2003}',
            '\u{2004}', '\u{2005}', '\u{2006}', '\u{2007}', '\u{2008}', '\u{2009}', '\u{200a}',
            '\u{2028}', '\u{2029}', '\u{202f}', '\u{205f}', '\u{3000}',
        ] {
            for gap in [separator.to_string(), format!("\t{separator}\x1b[31m ")] {
                let input = format!("préfix😀\n-----{gap}BEGIN PRIVATE KEY-----\nUNICODEMATERIAL\n-----END PRIVATE KEY-----\nuncertain suffix");
                let result = std::panic::catch_unwind(|| redact(&input));
                assert_eq!(
                    result.unwrap(),
                    ("préfix😀\n***".into(), 1),
                    "{separator:?}"
                );
            }
            // Whitespace before a canonical header is ordinary visible context.
            let input = format!("{separator}-----BEGIN PRIVATE KEY-----\nUNICODEMATERIAL\n-----END PRIVATE KEY-----\nvisible");
            assert_eq!(redact(&input), (format!("{separator}***\nvisible"), 1));
        }
        let input = format!(
            "safe\n-----\u{a0}\u{2003}BEGIN PRIVATE KEY-----\n{}\nUNCERTAINMATERIAL",
            "😀".repeat(262_145)
        );
        assert!(input.len() > 1_048_576);
        assert_eq!(
            std::panic::catch_unwind(|| redact(&input)).unwrap(),
            ("safe\n***".into(), 1)
        );
    }

    #[test]
    fn jwt_shapes_redact_without_markers() {
        let token =
            "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c";
        let (out, n) = redact(&format!("got {token} ok"));
        assert_eq!(n, 1, "{out}");
        assert!(!out.contains("SflKxw"));
        assert!(out.contains("got ") && out.contains(" ok"));
    }
}
