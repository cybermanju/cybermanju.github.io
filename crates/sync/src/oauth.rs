// CyberManju OS — OAuth2 flows
//
// Authorization-code + PKCE (RFC 7636) for Google / GitHub / GitLab, token
// refresh, a passphrase-protected credential store, and the `resolve_token`
// entry point AGENT-1 calls before every authenticated provider request.
//
// <<< AGENT-3 OAUTH: this file owns the *flow*; `crates/sync/src/backends.rs`
// keeps owning the *transport*. >>>

use std::collections::HashMap;
use std::path::PathBuf;

use base64::Engine;
use cybermanju_crypto::keystore;
use cybermanju_types::sync::{SyncBackendType, SyncConfig};
use reqwest::blocking::Client;
use serde::{Deserialize, Serialize};

/// The single `OAuthCredentials` type is defined in `cybermanju-types` and
/// re-exported here so `crate::oauth::OAuthCredentials` keeps working.
pub use cybermanju_types::sync::OAuthCredentials;

// ─── Provider catalogue ───────────────────────────────────────────────

/// Authorize/token endpoints and scopes for one provider.
#[derive(Debug, Clone)]
pub struct ProviderEndpoints {
    pub provider: &'static str,
    pub authorize_url: &'static str,
    pub token_url: &'static str,
    pub scope: &'static str,
}

/// Look up a provider by its route slug (`google` / `github` / `gitlab`).
pub fn provider_endpoints(provider: &str) -> Result<ProviderEndpoints, String> {
    match provider.trim().to_ascii_lowercase().as_str() {
        "google" | "google-drive" | "gdrive" => Ok(ProviderEndpoints {
            provider: "google",
            authorize_url: "https://accounts.google.com/o/oauth2/v2/auth",
            token_url: "https://oauth2.googleapis.com/token",
            scope: "https://www.googleapis.com/auth/drive.file",
        }),
        "github" => Ok(ProviderEndpoints {
            provider: "github",
            authorize_url: "https://github.com/login/oauth/authorize",
            token_url: "https://github.com/login/oauth/access_token",
            scope: "repo read:user",
        }),
        "gitlab" => Ok(ProviderEndpoints {
            provider: "gitlab",
            authorize_url: "https://gitlab.com/oauth/authorize",
            token_url: "https://gitlab.com/oauth/token",
            scope: "api read_user",
        }),
        other => Err(format!(
            "unsupported: OAuth provider '{}' is not supported",
            other
        )),
    }
}

/// Map a sync backend onto its OAuth provider slug.
pub fn backend_slug(backend: &SyncBackendType) -> Result<&'static str, String> {
    match backend {
        SyncBackendType::GoogleDrive => Ok("google"),
        SyncBackendType::GitHub => Ok("github"),
        SyncBackendType::GitLab => Ok("gitlab"),
        other => Err(format!("Backend does not use OAuth: {}", other)),
    }
}

/// OAuth client credentials from the environment.
///
/// `CYBERMANJU_OAUTH_GOOGLE_CLIENT_ID` / `..._CLIENT_SECRET` (and the
/// `GITHUB` / `GITLAB` equivalents). The secret stays out of the database.
pub fn client_credentials(provider: &str) -> Result<(String, Option<String>), String> {
    let provider = provider.trim().to_ascii_lowercase();
    let provider = match provider.as_str() {
        "google" | "google-drive" | "gdrive" => "GOOGLE",
        "github" => "GITHUB",
        "gitlab" => "GITLAB",
        other => {
            return Err(format!(
                "unsupported: OAuth provider '{}' is not supported",
                other
            ))
        }
    };

    let id_var = format!("CYBERMANJU_OAUTH_{}_CLIENT_ID", provider);
    let secret_var = format!("CYBERMANJU_OAUTH_{}_CLIENT_SECRET", provider);

    let client_id = std::env::var(&id_var)
        .ok()
        .map(|v| v.trim().to_string())
        .filter(|v| !v.is_empty())
        .ok_or_else(|| format!("{} is not set", id_var))?;

    let client_secret = std::env::var(&secret_var)
        .ok()
        .map(|v| v.trim().to_string())
        .filter(|v| !v.is_empty());

    Ok((client_id, client_secret))
}

// ─── PKCE (RFC 7636, S256) ───────────────────────────────────────────

/// A PKCE code verifier / challenge pair.
#[derive(Debug, Clone)]
pub struct Pkce {
    /// Sent to the token endpoint verbatim.
    pub verifier: String,
    /// Sent to the authorize endpoint (base64url of SHA-256(verifier)).
    pub challenge: String,
}

/// Generate a fresh PKCE pair.
pub fn generate_pkce() -> Pkce {
    let verifier = random_url_safe(32);
    let challenge = pkce_challenge(&verifier);
    Pkce {
        verifier,
        challenge,
    }
}

/// base64url(SHA-256(ascii `verifier`)) — the S256 transform.
pub fn pkce_challenge(verifier: &str) -> String {
    use sha2::{Digest, Sha256};
    let digest = Sha256::digest(verifier.as_bytes());
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(digest)
}

/// Random URL-safe string of `bytes` entropy.
pub fn random_url_safe(bytes: usize) -> String {
    use rand_core::RngCore;
    let mut buf = vec![0u8; bytes];
    rand_core::OsRng.fill_bytes(&mut buf);
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(buf)
}

// ─── Authorization-code flow ─────────────────────────────────────────

/// Build the provider's authorize URL for a `/start` request.
pub fn authorize_url(
    provider: &str,
    client_id: &str,
    redirect_uri: &str,
    state: &str,
    challenge: &str,
) -> Result<String, String> {
    let endpoints = provider_endpoints(provider)?;
    Ok(format!(
        "{}?response_type=code&client_id={}&redirect_uri={}&scope={}&state={}&code_challenge={}&code_challenge_method=S256&access_type=offline&prompt=consent",
        endpoints.authorize_url,
        encode(client_id),
        encode(redirect_uri),
        encode(endpoints.scope),
        encode(state),
        encode(challenge),
    ))
}

/// Redeem an authorization code for an [`OAuthCredentials`] set.
pub fn exchange_code(
    provider: &str,
    client_id: &str,
    client_secret: Option<&str>,
    code: &str,
    redirect_uri: &str,
    verifier: &str,
) -> Result<OAuthCredentials, String> {
    let endpoints = provider_endpoints(provider)?;

    let mut params: Vec<(&str, &str)> = vec![
        ("grant_type", "authorization_code"),
        ("code", code),
        ("redirect_uri", redirect_uri),
        ("client_id", client_id),
        ("code_verifier", verifier),
    ];
    if let Some(secret) = client_secret {
        params.push(("client_secret", secret));
    }

    let response = http_client()?
        .post(endpoints.token_url)
        .header("Accept", "application/json")
        .form(&params)
        .send()
        .map_err(|_| "Token exchange request failed".to_string())?;

    let status = response.status().as_u16();
    let body = response
        .text()
        .map_err(|_| "Failed to read token exchange response".to_string())?;
    if !(200..300).contains(&status) {
        return Err(format!("Token exchange failed ({})", status));
    }

    let token: TokenResponse = serde_json::from_str(&body)
        .map_err(|_| "Failed to parse token exchange response".to_string())?;

    Ok(credentials_from_token(client_id, client_secret, token))
}

/// Build the stored credential set from a token endpoint response.
fn credentials_from_token(
    client_id: &str,
    client_secret: Option<&str>,
    token: TokenResponse,
) -> OAuthCredentials {
    let expires_at = token.expires_in.map(|secs| unix_now() + secs);
    OAuthCredentials {
        access_token: token.access_token,
        refresh_token: token.refresh_token,
        expires_at,
        client_id: client_id.to_string(),
        client_secret: client_secret.map(str::to_string),
    }
}

fn refresh_params<'a>(
    credentials: &'a OAuthCredentials,
    refresh_token: &'a str,
) -> Vec<(&'static str, &'a str)> {
    let mut params = vec![
        ("grant_type", "refresh_token"),
        ("refresh_token", refresh_token),
        ("client_id", credentials.client_id.as_str()),
    ];
    if let Some(secret) = credentials.client_secret.as_deref() {
        params.push(("client_secret", secret));
    }
    params
}

/// OAuth2 token response from providers.
#[derive(Clone, Serialize, Deserialize)]
pub struct TokenResponse {
    pub access_token: String,
    #[serde(default)]
    pub token_type: String,
    #[serde(default)]
    pub expires_in: Option<u64>,
    #[serde(default)]
    pub refresh_token: Option<String>,
    #[serde(default)]
    pub scope: Option<String>,
}

// ─── Refresh ──────────────────────────────────────────────────────────

/// Refresh `credentials` against `token_url`.
///
/// Kept as a free function because `OAuthCredentials` lives in another
/// crate (inherent impls are only allowed in the defining crate).
pub fn refresh(credentials: &mut OAuthCredentials, token_url: &str) -> Result<(), String> {
    let refresh_token = credentials
        .refresh_token
        .as_deref()
        .ok_or("No refresh token available")?;

    let params = refresh_params(credentials, refresh_token);

    let response = http_client()?
        .post(token_url)
        .header("Accept", "application/json")
        .form(&params)
        .send()
        .map_err(|_| "Token refresh request failed".to_string())?;

    let status = response.status().as_u16();
    let body = response
        .text()
        .map_err(|_| "Failed to read token refresh response".to_string())?;
    if !(200..300).contains(&status) {
        return Err(format!("Token refresh failed ({})", status));
    }

    let token: TokenResponse = serde_json::from_str(&body)
        .map_err(|_| "Failed to parse token refresh response".to_string())?;

    credentials.access_token = token.access_token;
    if let Some(refresh_token) = token.refresh_token {
        credentials.refresh_token = Some(refresh_token);
    }
    if let Some(expires_in) = token.expires_in {
        credentials.expires_at = Some(unix_now() + expires_in);
    }
    Ok(())
}

/// Google OAuth2 token refresh.
pub fn refresh_google_token(credentials: &mut OAuthCredentials) -> Result<(), String> {
    refresh(credentials, "https://oauth2.googleapis.com/token")
}

/// GitHub OAuth2 token refresh (GitHub doesn't actually support refresh
/// tokens for PATs, but this works for OAuth apps).
pub fn refresh_github_token(credentials: &mut OAuthCredentials) -> Result<(), String> {
    refresh(credentials, "https://github.com/login/oauth/access_token")
}

/// GitLab OAuth2 token refresh.
pub fn refresh_gitlab_token(
    credentials: &mut OAuthCredentials,
    instance_url: Option<&str>,
) -> Result<(), String> {
    let base = instance_url.unwrap_or("https://gitlab.com");
    let token_url = format!("{}/oauth/token", base.trim_end_matches('/'));
    refresh(credentials, &token_url)
}

/// Get a valid access token, refreshing if necessary.
pub fn get_valid_token(
    credentials: &mut OAuthCredentials,
    token_url: &str,
    buffer_seconds: u64,
) -> Result<String, String> {
    if credentials.is_expired(buffer_seconds) {
        refresh(credentials, token_url)?;
    }
    Ok(credentials.access_token.clone())
}

// ─── Credential persistence ───────────────────────────────────────────

/// Envelope written to disk — the payload is encrypted at rest.
#[derive(Debug, Serialize, Deserialize)]
struct StoreEnvelope {
    version: u32,
    payload: String,
}

/// Wire shape of one stored credential set (the public type redacts its
/// secrets on serialize, so the store uses its own representation).
#[derive(Clone, Serialize, Deserialize)]
struct StoredCredentials {
    access_token: String,
    refresh_token: Option<String>,
    expires_at: Option<u64>,
    client_id: String,
    client_secret: Option<String>,
}

impl From<OAuthCredentials> for StoredCredentials {
    fn from(c: OAuthCredentials) -> Self {
        Self {
            access_token: c.access_token,
            refresh_token: c.refresh_token,
            expires_at: c.expires_at,
            client_id: c.client_id,
            client_secret: c.client_secret,
        }
    }
}

impl From<StoredCredentials> for OAuthCredentials {
    fn from(c: StoredCredentials) -> Self {
        Self {
            access_token: c.access_token,
            refresh_token: c.refresh_token,
            expires_at: c.expires_at,
            client_id: c.client_id,
            client_secret: c.client_secret,
        }
    }
}

/// Where the encrypted credential store lives.
///
/// Resolution: `CYBERMANJU_DATA_DIR` → parent of `DB_PATH` → `~/.cybermanju`.
pub fn credentials_path() -> PathBuf {
    if let Ok(dir) = std::env::var("CYBERMANJU_DATA_DIR") {
        if !dir.trim().is_empty() {
            return PathBuf::from(dir).join("oauth_credentials.enc");
        }
    }
    if let Ok(path) = std::env::var("DB_PATH") {
        if let Some(parent) = std::path::Path::new(&path).parent() {
            if !parent.as_os_str().is_empty() {
                return parent.join("oauth_credentials.enc");
            }
        }
    }
    if let Ok(home) = std::env::var("HOME") {
        return PathBuf::from(home)
            .join(".cybermanju")
            .join("oauth_credentials.enc");
    }
    std::env::temp_dir().join("cybermanju.oauth_credentials.enc")
}

/// Load every stored credential set, or an empty map.
fn read_store() -> HashMap<String, StoredCredentials> {
    let raw = match std::fs::read_to_string(credentials_path()) {
        Ok(raw) => raw,
        Err(_) => return HashMap::new(),
    };
    let envelope: StoreEnvelope = match serde_json::from_str(&raw) {
        Ok(e) => e,
        Err(_) => return HashMap::new(),
    };
    let passphrase = match keystore::master_passphrase() {
        Some(p) => p,
        None => return HashMap::new(),
    };
    let plain = match keystore::open_sealed_str(&passphrase, &envelope.payload) {
        Ok(plain) => plain,
        Err(_) => return HashMap::new(),
    };
    serde_json::from_str(&plain).unwrap_or_default()
}

/// Persist the whole store, encrypted, with owner-only permissions.
fn write_store(store: &HashMap<String, StoredCredentials>) -> Result<(), String> {
    if store.is_empty() {
        let _ = std::fs::remove_file(credentials_path());
        return Ok(());
    }
    let passphrase = keystore::master_passphrase()
        .ok_or_else(|| "No master passphrase available to encrypt OAuth credentials".to_string())?;
    let plain = serde_json::to_string(store).map_err(|e| e.to_string())?;
    let payload = keystore::seal_str(&passphrase, plain.as_bytes())?;
    let envelope = StoreEnvelope {
        version: 1,
        payload,
    };
    let encoded = serde_json::to_string(&envelope).map_err(|e| e.to_string())?;

    let path = credentials_path();
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let _ = std::fs::set_permissions(parent, std::fs::Permissions::from_mode(0o700));
        }
    }
    std::fs::write(&path, encoded)
        .map_err(|e| format!("Could not write {}: {}", path.display(), e))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600));
    }
    Ok(())
}

/// Store the credentials produced by an authorization-code exchange.
pub fn save_credentials(config_id: &str, credentials: &OAuthCredentials) -> Result<(), String> {
    let mut store = read_store();
    store.insert(
        config_id.to_string(),
        StoredCredentials::from(clone_credentials(credentials)),
    );
    write_store(&store)
}

/// Read the credentials stored for a sync configuration.
pub fn load_credentials(config_id: &str) -> Option<OAuthCredentials> {
    read_store().remove(config_id).map(OAuthCredentials::from)
}

/// Forget the credentials stored for a sync configuration.
pub fn clear_credentials(config_id: &str) -> Result<(), String> {
    let mut store = read_store();
    store.remove(config_id);
    write_store(&store)
}

fn clone_credentials(credentials: &OAuthCredentials) -> OAuthCredentials {
    OAuthCredentials {
        access_token: credentials.access_token.clone(),
        refresh_token: credentials.refresh_token.clone(),
        expires_at: credentials.expires_at,
        client_id: credentials.client_id.clone(),
        client_secret: credentials.client_secret.clone(),
    }
}

// ─── Entry point for provider transports ──────────────────────────────

/// Resolve the bearer token AGENT-1 must send to a provider.
///
/// Order:
///   1. the stored OAuth credentials (refreshing when they are within 60s of
///      expiry), written by the authorization-code flow;
///   2. the raw `config.token` (PAT / bot token backends);
///   3. `Err("auth: no token")`.
///
/// Safe to call when no OAuth credentials exist at all.
pub fn resolve_token(config: &SyncConfig) -> Result<String, String> {
    if let Some(mut credentials) = load_credentials(&config.id) {
        if credentials.is_expired(60) {
            if let Ok(slug) = backend_slug(&config.backend_type) {
                let endpoints = provider_endpoints(slug)?;
                match refresh(&mut credentials, endpoints.token_url) {
                    Ok(()) => {
                        let _ = save_credentials(&config.id, &credentials);
                    }
                    Err(e) => {
                        // Retry once on a rejected refresh, then fall through
                        // to any raw token before giving up.
                        log::warn!("OAuth refresh failed for {}: {}", config.id, e);
                        if let Err(e) = refresh(&mut credentials, endpoints.token_url) {
                            log::warn!("OAuth refresh retry failed for {}: {}", config.id, e);
                        } else {
                            let _ = save_credentials(&config.id, &credentials);
                        }
                    }
                }
            }
        }
        if !credentials.access_token.is_empty() {
            return Ok(credentials.access_token);
        }
    }

    match config.token.as_deref().filter(|t| !t.is_empty()) {
        Some(token) => Ok(token.to_string()),
        None => Err("auth: no token".to_string()),
    }
}

// ─── Small helpers ────────────────────────────────────────────────────

fn http_client() -> Result<Client, String> {
    Client::builder()
        .user_agent("CyberManjuOS/0.1")
        .connect_timeout(std::time::Duration::from_secs(15))
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|e| format!("Failed to build HTTP client: {}", e))
}

/// RFC 3986 percent-encoding for a query-string component.
fn encode(value: &str) -> String {
    const HEX: &[u8; 16] = b"0123456789ABCDEF";
    let mut out = String::with_capacity(value.len());
    for &byte in value.as_bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(byte as char)
            }
            _ => {
                out.push('%');
                out.push(HEX[(byte >> 4) as usize] as char);
                out.push(HEX[(byte & 0x0f) as usize] as char);
            }
        }
    }
    out
}

fn unix_now() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Read, Write};
    use std::net::TcpListener;
    use std::thread;

    fn mock_token_server(
        response: &'static str,
        status: &'static str,
    ) -> (String, thread::JoinHandle<String>) {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        let handle = thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            let mut request = Vec::new();
            let mut chunk = [0u8; 1024];
            let header_end;
            loop {
                let n = stream.read(&mut chunk).unwrap();
                assert!(n > 0, "client closed before sending request");
                request.extend_from_slice(&chunk[..n]);
                if let Some(pos) = request.windows(4).position(|w| w == b"\r\n\r\n") {
                    header_end = pos + 4;
                    break;
                }
            }
            let headers = String::from_utf8_lossy(&request[..header_end]);
            let length = headers
                .lines()
                .find_map(|line| {
                    let (key, value) = line.split_once(':')?;
                    key.eq_ignore_ascii_case("content-length")
                        .then(|| value.trim().parse::<usize>().unwrap())
                })
                .unwrap();
            while request.len() < header_end + length {
                let n = stream.read(&mut chunk).unwrap();
                assert!(n > 0, "client closed before sending complete body");
                request.extend_from_slice(&chunk[..n]);
            }
            let body =
                String::from_utf8_lossy(&request[header_end..header_end + length]).into_owned();
            write!(stream, "HTTP/1.1 {status}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{response}", response.len()).unwrap();
            body
        });
        (format!("http://{address}/token"), handle)
    }

    fn confidential_credentials() -> OAuthCredentials {
        OAuthCredentials {
            access_token: "old-access".into(),
            refresh_token: Some("old-refresh".into()),
            expires_at: Some(123),
            client_id: "client id".into(),
            client_secret: Some("secret +&/=?".into()),
        }
    }

    #[test]
    fn refresh_sends_escaped_secret_and_rotates_tokens_without_losing_client_credentials() {
        let (url, server) = mock_token_server(
            r#"{"access_token":"new-access","refresh_token":"new-refresh","expires_in":3600,"token_type":"Bearer"}"#,
            "200 OK",
        );
        let mut credentials = confidential_credentials();
        refresh(&mut credentials, &url).unwrap();
        let body = server.join().unwrap();
        assert!(
            body.contains("client_secret=secret+%2B%26%2F%3D%3F"),
            "unexpected form body: {body}"
        );
        assert!(body.contains("client_id=client+id"));
        assert_eq!(credentials.access_token, "new-access");
        assert_eq!(credentials.refresh_token.as_deref(), Some("new-refresh"));
        assert_eq!(credentials.client_id, "client id");
        assert_eq!(credentials.client_secret.as_deref(), Some("secret +&/=?"));
    }

    #[test]
    fn refresh_errors_do_not_leak_response_or_secret_or_mutate_credentials() {
        for (response, status, expected) in [
            (
                r#"{"error":"denied","echo":"secret +&/=?"}"#,
                "400 Bad Request",
                "Token refresh failed (400)",
            ),
            (
                "{ malformed secret +&/= ?",
                "200 OK",
                "Failed to parse token refresh response",
            ),
        ] {
            let (url, server) = mock_token_server(response, status);
            let mut credentials = confidential_credentials();
            let original = credentials.clone();
            let error = refresh(&mut credentials, &url).unwrap_err();
            server.join().unwrap();
            assert_eq!(error, expected);
            assert!(!error.contains("secret"));
            assert!(!error.contains(response));
            assert_eq!(credentials.access_token, original.access_token);
            assert_eq!(credentials.refresh_token, original.refresh_token);
            assert_eq!(credentials.expires_at, original.expires_at);
            assert_eq!(credentials.client_id, original.client_id);
            assert_eq!(credentials.client_secret, original.client_secret);
        }
    }

    #[test]
    fn confidential_exchange_credentials_keep_secret_for_encrypted_store() {
        let token = TokenResponse {
            access_token: "access".into(),
            token_type: "Bearer".into(),
            expires_in: Some(3600),
            refresh_token: Some("refresh".into()),
            scope: None,
        };
        let credentials = credentials_from_token("client", Some("confidential-secret"), token);
        let stored = StoredCredentials::from(credentials);
        assert_eq!(stored.client_secret.as_deref(), Some("confidential-secret"));
        // Exercise the same private serialization and seal/open primitives
        // as write_store/read_store, without global env or filesystem state.
        let plain = serde_json::to_string(&stored).unwrap();
        let payload = keystore::seal_str("test-only-passphrase", plain.as_bytes()).unwrap();
        let envelope = serde_json::to_string(&StoreEnvelope {
            version: 1,
            payload,
        })
        .unwrap();
        assert!(!envelope.contains("confidential-secret"));
        let envelope: StoreEnvelope = serde_json::from_str(&envelope).unwrap();
        let opened = keystore::open_sealed_str("test-only-passphrase", &envelope.payload).unwrap();
        let restored =
            OAuthCredentials::from(serde_json::from_str::<StoredCredentials>(&opened).unwrap());
        assert_eq!(
            restored.client_secret.as_deref(),
            Some("confidential-secret")
        );
        assert!(!serde_json::to_string(&restored)
            .unwrap()
            .contains("confidential-secret"));
    }

    #[test]
    fn refresh_form_includes_secret_only_for_confidential_credentials() {
        let mut credentials = OAuthCredentials {
            access_token: "access".into(),
            refresh_token: Some("refresh".into()),
            expires_at: None,
            client_id: "client".into(),
            client_secret: Some("confidential-secret".into()),
        };
        let params = refresh_params(&credentials, credentials.refresh_token.as_deref().unwrap());
        assert!(params.contains(&("client_secret", "confidential-secret")));
        assert!(params.contains(&("grant_type", "refresh_token")));

        credentials.client_secret = None;
        let params = refresh_params(&credentials, credentials.refresh_token.as_deref().unwrap());
        assert!(!params.iter().any(|(key, _)| *key == "client_secret"));
    }

    #[test]
    fn test_is_expired() {
        let now = unix_now();

        let mut creds = OAuthCredentials {
            access_token: "test".to_string(),
            refresh_token: None,
            expires_at: Some(now + 3600),
            client_id: "test".to_string(),
            client_secret: None,
        };

        // Not expired with 5 minute buffer
        assert!(!creds.is_expired(300));

        // Expired with 2 hour buffer
        assert!(creds.is_expired(7200));

        // No expiry = not expired
        creds.expires_at = None;
        assert!(!creds.is_expired(300));
    }

    #[test]
    fn test_pkce_challenge_is_stable() {
        // RFC 7636 appendix B vector.
        let verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
        assert_eq!(
            pkce_challenge(verifier),
            "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"
        );
    }

    #[test]
    fn test_provider_endpoints() {
        assert!(provider_endpoints("google").is_ok());
        assert!(provider_endpoints("github").is_ok());
        assert!(provider_endpoints("gitlab").is_ok());
        assert!(provider_endpoints("dropbox").is_err());
    }

    #[test]
    fn test_authorize_url_contains_pkce() {
        let url = authorize_url(
            "github",
            "cid",
            "http://127.0.0.1:3456/api/sync/oauth/github/callback",
            "state123",
            "challenge123",
        )
        .unwrap();
        assert!(url.contains("code_challenge=challenge123"));
        assert!(url.contains("code_challenge_method=S256"));
        assert!(url.contains("state=state123"));
    }

    #[test]
    fn test_resolve_token_without_anything() {
        let config = SyncConfig {
            id: "cfg-missing".to_string(),
            backend_type: SyncBackendType::Local,
            enabled: true,
            account_id: None,
            name: None,
            base_path: None,
            repo_name: None,
            branch: None,
            token: None,
            folder_id: None,
            auto_sync: false,
            compress_before_upload: false,
            create_previews: false,
            delete_raw_after_sync: false,
            max_concurrent_uploads: 1,
            encrypt_before_upload: true,
            conflict_policy: Default::default(),
            placement: Default::default(),
            parity: 1,
            require_encryption: false,
            obfuscate_names: false,
            mirror: false,
            key_holder: false,
            oauth_credentials: None,
            created_at: None,
            updated_at: None,
        };
        assert_eq!(resolve_token(&config).unwrap_err(), "auth: no token");
    }

    #[test]
    fn test_resolve_token_falls_back_to_raw_token() {
        let config = SyncConfig {
            id: "cfg-pat".to_string(),
            backend_type: SyncBackendType::GitHub,
            enabled: true,
            account_id: None,
            name: None,
            base_path: None,
            repo_name: None,
            branch: None,
            token: Some("ghp_literal".to_string()),
            folder_id: None,
            auto_sync: false,
            compress_before_upload: false,
            create_previews: false,
            delete_raw_after_sync: false,
            max_concurrent_uploads: 1,
            encrypt_before_upload: true,
            conflict_policy: Default::default(),
            placement: Default::default(),
            parity: 1,
            require_encryption: false,
            obfuscate_names: false,
            mirror: false,
            key_holder: false,
            oauth_credentials: None,
            created_at: None,
            updated_at: None,
        };
        assert_eq!(resolve_token(&config).unwrap(), "ghp_literal");
    }
}
