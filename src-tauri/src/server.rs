//! The local HTTP server the windows load the app from (`http://localhost:47615`),
//! as in the Electron app: Firebase already trusts `localhost` for Google sign-in,
//! and a fixed origin keeps the IndexedDB cache and login across launches.
//!
//! It serves the SPA embedded in the binary (`desktop/app`, from
//! `npm run desktop:build`) and receives the Google tokens that `/desktop-auth`,
//! open in the user's real browser, posts back to `/__desktop-auth`.

use crate::{auth, windows};
use std::io::Read;
use tauri::AppHandle;
use tiny_http::{Header, Method, Request, Response, Server};

pub const PORTS: [u16; 3] = [47615, 47616, 47617];

/// Starts the server on the first free port and returns that port.
pub fn start(app: &AppHandle) -> Option<u16> {
    for port in PORTS {
        let Ok(server) = Server::http(("127.0.0.1", port)) else {
            continue;
        };
        let app = app.clone();
        std::thread::spawn(move || {
            for request in server.incoming_requests() {
                handle(&app, request);
            }
        });
        return Some(port);
    }
    None
}

fn header(name: &str, value: &str) -> Header {
    Header::from_bytes(name.as_bytes(), value.as_bytes()).unwrap()
}

fn handle(app: &AppHandle, request: Request) {
    let path = request
        .url()
        .split(['?', '#'])
        .next()
        .unwrap_or("/")
        .to_string();
    if path == "/__desktop-auth" {
        receive_google_credential(app, request);
        return;
    }
    if path == "/mcp" {
        crate::mcp::handle(app, request);
        return;
    }
    let resolver = app.asset_resolver();
    let rel = percent_decode(path.trim_start_matches('/'));
    if rel.split('/').any(|part| part == "..") {
        let _ = request.respond(Response::empty(403));
        return;
    }
    let asset = if rel.is_empty() {
        None
    } else {
        resolver.get(rel.clone())
    };
    // SPA fallback: the client router takes over.
    let Some(asset) = asset.or_else(|| resolver.get("200.html".into())) else {
        let _ = request.respond(Response::empty(404)); // dev: the app itself comes from Vite
        return;
    };
    let immutable = rel.starts_with("_app/immutable/");
    let cache = if immutable {
        "public, max-age=31536000, immutable"
    } else {
        "no-cache"
    };
    let response = Response::from_data(asset.bytes)
        .with_header(header("Content-Type", &content_type(&asset.mime_type)))
        .with_header(header("Cache-Control", cache));
    let _ = request.respond(response);
}

fn content_type(mime: &str) -> String {
    if mime.starts_with("text/") || mime == "application/javascript" {
        format!("{mime}; charset=utf-8")
    } else {
        mime.to_string()
    }
}

fn percent_decode(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        let hex = |b: u8| (b as char).to_digit(16).map(|d| d as u8);
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            if let (Some(hi), Some(lo)) = (hex(bytes[i + 1]), hex(bytes[i + 2])) {
                out.push(hi << 4 | lo);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

fn receive_google_credential(app: &AppHandle, mut request: Request) {
    // The auth page is same-origin in the packaged app; in dev it's served by Vite.
    let origin = request
        .headers()
        .iter()
        .find(|h| h.field.equiv("Origin"))
        .map(|h| h.value.as_str().to_string());
    let reply = move |request: Request, status: u16, body: serde_json::Value| {
        let mut response = Response::from_string(body.to_string())
            .with_status_code(status)
            .with_header(header("Content-Type", "application/json"));
        if let Some(origin) = origin.as_deref() {
            if is_localhost_origin(origin) {
                response.add_header(header("Access-Control-Allow-Origin", origin));
            }
        }
        let _ = request.respond(response);
    };

    if *request.method() != Method::Post {
        return reply(request, 405, serde_json::json!({ "ok": false }));
    }
    let mut body = Vec::new();
    if request
        .as_reader()
        .take(64 * 1024 + 1)
        .read_to_end(&mut body)
        .is_err()
        || body.len() > 64 * 1024
    {
        return reply(
            request,
            400,
            serde_json::json!({ "ok": false, "error": "Bad request" }),
        );
    }
    let Ok(data) = serde_json::from_slice::<serde_json::Value>(&body) else {
        return reply(
            request,
            400,
            serde_json::json!({ "ok": false, "error": "Bad request" }),
        );
    };
    let state = data.get("state").and_then(|v| v.as_str()).unwrap_or("");
    if !auth::take_if_valid(state) {
        return reply(
            request,
            403,
            serde_json::json!({
                "ok": false,
                "error": "This sign-in link expired — start again from the app."
            }),
        );
    }
    let id_token = data.get("idToken").and_then(|v| v.as_str());
    let access_token = data.get("accessToken").and_then(|v| v.as_str());
    if id_token.is_none() && access_token.is_none() {
        return reply(
            request,
            400,
            serde_json::json!({ "ok": false, "error": "No Google credential received" }),
        );
    }
    windows::emit_main(
        app,
        "auth:google",
        serde_json::json!({ "idToken": id_token, "accessToken": access_token }),
    );
    windows::show_main(app, None);
    reply(request, 200, serde_json::json!({ "ok": true }));
}

/// `http://localhost:<port>` and nothing else.
fn is_localhost_origin(origin: &str) -> bool {
    origin
        .strip_prefix("http://localhost:")
        .is_some_and(|port| !port.is_empty() && port.bytes().all(|b| b.is_ascii_digit()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decodes_percent_escapes() {
        assert_eq!(percent_decode("a%20b"), "a b");
        assert_eq!(percent_decode("caf%C3%A9.txt"), "café.txt");
        assert_eq!(percent_decode("100%"), "100%");
        assert_eq!(percent_decode("%zz"), "%zz");
    }

    #[test]
    fn only_localhost_origins_get_cors() {
        assert!(is_localhost_origin("http://localhost:5173"));
        assert!(!is_localhost_origin("http://localhost:"));
        assert!(!is_localhost_origin("http://localhost:5173.evil.com"));
        assert!(!is_localhost_origin("https://localhost:5173"));
    }
}
