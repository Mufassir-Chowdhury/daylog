//! The assistant's calls to AI providers (Claude, Gemini, and ElevenLabs for
//! voice). Each API key lives in
//! the OS credential store — Windows Credential Manager, the macOS Keychain or
//! the Secret Service on Linux — and never reaches the web page: the page sends
//! its request without a key, and this module adds the key, only for that
//! provider's own API host.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::time::Duration;

const SERVICE: &str = "daylog";

#[derive(Clone, Copy, Debug, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Provider {
    Anthropic,
    Gemini,
    /// Voice: speech to text and text to speech (voice.rs sends the audio).
    Elevenlabs,
}

impl Provider {
    pub const ALL: [Provider; 3] = [Provider::Anthropic, Provider::Gemini, Provider::Elevenlabs];

    pub fn id(self) -> &'static str {
        match self {
            Provider::Anthropic => "anthropic",
            Provider::Gemini => "gemini",
            Provider::Elevenlabs => "elevenlabs",
        }
    }

    fn host(self) -> &'static str {
        match self {
            Provider::Anthropic => "api.anthropic.com",
            Provider::Gemini => "generativelanguage.googleapis.com",
            Provider::Elevenlabs => "api.elevenlabs.io",
        }
    }

    pub(crate) fn key_header(self) -> &'static str {
        match self {
            Provider::Anthropic => "x-api-key",
            Provider::Gemini => "x-goog-api-key",
            Provider::Elevenlabs => "xi-api-key",
        }
    }
}

fn entry(provider: Provider) -> Result<keyring::Entry, String> {
    keyring::Entry::new(SERVICE, &format!("ai-{}", provider.id())).map_err(|e| e.to_string())
}

pub fn has_key(provider: Provider) -> bool {
    entry(provider)
        .and_then(|e| e.get_password().map_err(|e| e.to_string()))
        .is_ok_and(|key| !key.is_empty())
}

/// Saves the key, or forgets it with `None`.
pub fn set_key(provider: Provider, key: Option<&str>) -> Result<(), String> {
    let entry = entry(provider)?;
    match key.map(str::trim).filter(|k| !k.is_empty()) {
        Some(key) => entry.set_password(key).map_err(|e| e.to_string()),
        None => match entry.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(e) => Err(e.to_string()),
        },
    }
}

pub(crate) fn get_key(provider: Provider) -> Result<String, String> {
    match entry(provider)?.get_password() {
        Ok(key) if !key.is_empty() => Ok(key),
        Ok(_) | Err(keyring::Error::NoEntry) => Err("No API key saved on this computer".into()),
        Err(e) => Err(e.to_string()),
    }
}

#[derive(Debug, Deserialize)]
pub struct HttpRequest {
    provider: Provider,
    url: String,
    method: String,
    #[serde(default)]
    headers: HashMap<String, String>,
    body: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct HttpResponse {
    status: u16,
    headers: HashMap<String, String>,
    body: String,
}

pub(crate) fn agent() -> ureq::Agent {
    // The OS's TLS and certificate store, like the updater.
    let tls = ureq::tls::TlsConfig::builder()
        .provider(ureq::tls::TlsProvider::NativeTls)
        .root_certs(ureq::tls::RootCerts::PlatformVerifier)
        .build();
    ureq::Agent::config_builder()
        .tls_config(tls)
        .timeout_connect(Some(Duration::from_secs(20)))
        .timeout_global(Some(Duration::from_secs(600)))
        .http_status_as_error(false)
        .max_redirects(0)
        .build()
        .into()
}

/// Headers the page may not set: the key is ours to add, the rest belongs to the connection.
fn passes(name: &str, provider: Provider) -> bool {
    let name = name.to_ascii_lowercase();
    name != provider.key_header()
        && !matches!(
            name.as_str(),
            "host"
                | "content-length"
                | "connection"
                | "authorization"
                | "x-api-key"
                | "x-goog-api-key"
                | "xi-api-key"
        )
}

/// Sends the request with the provider's key added. Only that provider's API host is reachable.
pub fn fetch(request: HttpRequest) -> Result<HttpResponse, String> {
    let provider = request.provider;
    if !request
        .url
        .starts_with(&format!("https://{}/", provider.host()))
    {
        return Err(format!(
            "{} requests must go to {}",
            provider.id(),
            provider.host()
        ));
    }
    let key = get_key(provider)?;
    let agent = agent();
    let headers = request
        .headers
        .iter()
        .filter(|(name, _)| passes(name, provider));

    let response = match request.method.to_ascii_uppercase().as_str() {
        "GET" => {
            let mut builder = agent.get(&request.url);
            for (name, value) in headers {
                builder = builder.header(name, value);
            }
            builder.header(provider.key_header(), &key).call()
        }
        "POST" => {
            let mut builder = agent.post(&request.url);
            for (name, value) in headers {
                builder = builder.header(name, value);
            }
            builder
                .header(provider.key_header(), &key)
                .send(request.body.unwrap_or_default())
        }
        other => return Err(format!("{other} is not allowed")),
    };
    let mut response = response.map_err(|e| e.to_string())?;

    let headers = response
        .headers()
        .iter()
        .filter_map(|(name, value)| Some((name.to_string(), value.to_str().ok()?.to_string())))
        .collect();
    let body = response
        .body_mut()
        .with_config()
        .limit(32 * 1024 * 1024)
        .read_to_string()
        .map_err(|e| e.to_string())?;
    Ok(HttpResponse {
        status: response.status().as_u16(),
        headers,
        body,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn request(provider: Provider, url: &str) -> HttpRequest {
        HttpRequest {
            provider,
            url: url.into(),
            method: "POST".into(),
            headers: HashMap::new(),
            body: None,
        }
    }

    #[test]
    fn keys_only_go_to_the_providers_own_host() {
        for url in [
            "https://evil.example/v1/messages",
            "https://api.anthropic.com.evil.example/v1/messages",
            "http://api.anthropic.com/v1/messages",
            "https://generativelanguage.googleapis.com/v1beta/models",
        ] {
            assert!(fetch(request(Provider::Anthropic, url)).is_err(), "{url}");
        }
        assert!(fetch(request(
            Provider::Gemini,
            "https://api.anthropic.com/v1/messages"
        ))
        .is_err());
        assert!(fetch(request(
            Provider::Elevenlabs,
            "https://api.anthropic.com/v1/messages"
        ))
        .is_err());
    }

    #[test]
    fn the_page_cannot_set_key_headers() {
        assert!(!passes("X-Api-Key", Provider::Anthropic));
        assert!(!passes("x-goog-api-key", Provider::Anthropic));
        assert!(!passes("Authorization", Provider::Gemini));
        assert!(passes("anthropic-version", Provider::Anthropic));
        assert!(passes("content-type", Provider::Gemini));
        assert!(!passes("xi-api-key", Provider::Anthropic));
        assert!(!passes("XI-API-KEY", Provider::Elevenlabs));
    }
}
