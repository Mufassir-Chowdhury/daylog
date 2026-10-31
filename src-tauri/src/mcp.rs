//! daylog as an MCP server for Claude Desktop and Claude Code, so a Claude
//! subscription can use daylog's tools (src/lib/ai/mcp.ts).
//!
//! - `POST /mcp` on the local server (server.rs) takes JSON-RPC messages
//!   (MCP's Streamable HTTP transport, JSON replies only). Each one is relayed
//!   to the signed-in main window, which runs the tool and answers through
//!   `mcp_reply`. Off until switched on in Settings; every request needs the
//!   bearer token kept in the prefs, and requests from web pages (any `Origin`)
//!   are refused, so a website can't reach it through the browser.
//! - `daylog --mcp` is the stdio bridge Claude starts (see `bridge`): it reads
//!   one message per line, posts it to the running app with the token, and
//!   prints the reply. It never opens a window.

use crate::{prefs, server, windows};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::io::{BufRead, Read, Write};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::mpsc::{self, Sender};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::{AppHandle, Manager};
use tiny_http::{Header, Method, Request, Response};

/// Saved in the prefs (`mcp`).
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Settings {
    pub enabled: bool,
    /// A fresh random token each time access is switched on.
    pub token: String,
}

/// How long a tool may take in the window before Claude is told it didn't answer.
const TIMEOUT: Duration = Duration::from_secs(90);
const MAX_BODY: usize = 4 * 1024 * 1024;

/// The main window is signed in and listening.
static READY: AtomicBool = AtomicBool::new(false);
static NEXT_ID: AtomicU64 = AtomicU64::new(1);
static PENDING: Mutex<Vec<(u64, Sender<Option<String>>)>> = Mutex::new(Vec::new());

const NOT_READY: &str =
    "daylog is running but not signed in (or still starting). Open daylog, sign in, and try again.";
const NO_ANSWER: &str = "daylog didn't answer in time. Make sure it's open and signed in.";
const NOT_RUNNING: &str =
    "daylog isn't running. Open the daylog desktop app (it can stay in the tray) and try again.";
const SWITCHED_OFF: &str =
    "Claude access is off. Turn it on in daylog → Settings → Use daylog from Claude.";

// ——— Settings, from the page.

pub fn status(app: &AppHandle) -> Value {
    let settings = prefs::store().get().mcp.unwrap_or_default();
    let port = app.state::<crate::AppState>().port;
    let exe = std::env::current_exe()
        .map(|p| p.display().to_string())
        .unwrap_or_default();
    json!({
        "enabled": settings.enabled,
        "exe": exe,
        "url": format!("http://127.0.0.1:{port}/mcp"),
        "dev": tauri::is_dev(),
    })
}

/// Switching on makes a new token; switching off forgets it, so old clients stop working.
pub fn set(app: &AppHandle, enabled: bool) -> Value {
    let token = if enabled { new_token() } else { None };
    prefs::store().update(|p| {
        p.mcp = Some(Settings {
            enabled: enabled && token.is_some(),
            token: token.unwrap_or_default(),
        })
    });
    status(app)
}

pub fn set_ready(ready: bool) {
    READY.store(ready, Ordering::SeqCst);
}

pub fn reply(id: u64, body: Option<String>) {
    let mut pending = PENDING.lock().unwrap();
    if let Some(i) = pending.iter().position(|(pid, _)| *pid == id) {
        let (_, sender) = pending.swap_remove(i);
        let _ = sender.send(body);
    }
}

fn new_token() -> Option<String> {
    let mut bytes = [0u8; 32];
    getrandom::fill(&mut bytes).ok()?;
    Some(bytes.iter().map(|b| format!("{b:02x}")).collect())
}

// ——— The HTTP endpoint.

/// `/mcp` on the local server. Runs on its own thread: the tool can take a while.
pub fn handle(app: &AppHandle, request: Request) {
    let app = app.clone();
    std::thread::spawn(move || serve(&app, request));
}

fn header(name: &str, value: &str) -> Header {
    Header::from_bytes(name.as_bytes(), value.as_bytes()).unwrap()
}

fn header_value<'a>(request: &'a Request, name: &'static str) -> Option<&'a str> {
    request
        .headers()
        .iter()
        .find(|h| h.field.equiv(name))
        .map(|h| h.value.as_str())
}

fn plain(request: Request, status: u16, text: &str) {
    let response = Response::from_string(text)
        .with_status_code(status)
        .with_header(header("Content-Type", "text/plain; charset=utf-8"));
    let _ = request.respond(response);
}

fn json_reply(request: Request, body: String) {
    let response = Response::from_string(body)
        .with_header(header("Content-Type", "application/json"))
        .with_header(header("Cache-Control", "no-store"));
    let _ = request.respond(response);
}

fn serve(app: &AppHandle, mut request: Request) {
    // Browsers send Origin with every cross-site POST; Claude's clients don't.
    if header_value(&request, "Origin").is_some() {
        return plain(request, 403, "Not available to web pages.");
    }
    let settings = prefs::store().get().mcp.unwrap_or_default();
    if !settings.enabled || settings.token.is_empty() {
        return plain(request, 403, SWITCHED_OFF);
    }
    let expected = format!("Bearer {}", settings.token);
    let authorized = header_value(&request, "Authorization")
        .is_some_and(|got| constant_time_eq(got.as_bytes(), expected.as_bytes()));
    if !authorized {
        return plain(request, 401, "Missing or wrong token.");
    }
    if *request.method() != Method::Post {
        // No server-sent event stream: every answer comes back with its request.
        let response = Response::from_string("POST only.")
            .with_status_code(405)
            .with_header(header("Allow", "POST"));
        let _ = request.respond(response);
        return;
    }
    let mut body = Vec::new();
    if request
        .as_reader()
        .take(MAX_BODY as u64 + 1)
        .read_to_end(&mut body)
        .is_err()
        || body.len() > MAX_BODY
    {
        return plain(request, 413, "Too large.");
    }
    let Ok(message) = serde_json::from_slice::<Value>(&body) else {
        let error = json!({ "jsonrpc": "2.0", "id": null, "error": { "code": -32700, "message": "Parse error." } });
        return json_reply(request, error.to_string());
    };
    if !wants_reply(&message) {
        let _ = request.respond(Response::empty(202));
        return;
    }
    match relay(app, String::from_utf8_lossy(&body).into_owned()) {
        Relayed::Reply(reply) => json_reply(request, reply),
        Relayed::Nothing => {
            let _ = request.respond(Response::empty(202));
        }
        Relayed::NotReady => json_reply(request, errors_for(&message, NOT_READY)),
        Relayed::TimedOut => json_reply(request, errors_for(&message, NO_ANSWER)),
    }
}

enum Relayed {
    Reply(String),
    Nothing,
    NotReady,
    TimedOut,
}

fn relay(app: &AppHandle, body: String) -> Relayed {
    if !READY.load(Ordering::SeqCst) {
        return Relayed::NotReady;
    }
    let id = NEXT_ID.fetch_add(1, Ordering::SeqCst);
    let (sender, receiver) = mpsc::channel();
    PENDING.lock().unwrap().push((id, sender));
    windows::emit_main(app, "mcp:request", json!({ "id": id, "body": body }));
    let result = receiver.recv_timeout(TIMEOUT);
    PENDING.lock().unwrap().retain(|(pid, _)| *pid != id);
    match result {
        Ok(Some(reply)) => Relayed::Reply(reply),
        Ok(None) => Relayed::Nothing,
        Err(_) => Relayed::TimedOut,
    }
}

/// A request (method and id) is owed an answer; notifications and responses aren't.
fn wants_reply(message: &Value) -> bool {
    match message {
        Value::Array(items) => items.iter().any(wants_reply),
        Value::Object(obj) => {
            obj.contains_key("method") && obj.get("id").is_some_and(|id| !id.is_null())
        }
        _ => false,
    }
}

/// A JSON-RPC error for each request in `message`, so the client sees why.
fn errors_for(message: &Value, text: &str) -> String {
    let error = |id: &Value| json!({ "jsonrpc": "2.0", "id": id, "error": { "code": -32000, "message": text } });
    match message {
        Value::Array(items) => Value::Array(
            items
                .iter()
                .filter(|m| wants_reply(m))
                .map(|m| error(&m["id"]))
                .collect(),
        )
        .to_string(),
        _ => error(&message["id"]).to_string(),
    }
}

fn constant_time_eq(a: &[u8], b: &[u8]) -> bool {
    a.len() == b.len() && a.iter().zip(b).fold(0u8, |acc, (x, y)| acc | (x ^ y)) == 0
}

// ——— `daylog --mcp`: the stdio bridge.

/// Relays stdin to the running app until stdin closes. Returns the exit code.
pub fn bridge() -> i32 {
    let agent: ureq::Agent = ureq::Agent::config_builder()
        .http_status_as_error(false)
        .timeout_connect(Some(Duration::from_secs(3)))
        .timeout_global(Some(TIMEOUT + Duration::from_secs(15)))
        .max_redirects(0)
        .build()
        .into();
    let out = Arc::new(Mutex::new(std::io::stdout()));
    let mut workers = Vec::new();
    for line in std::io::stdin().lock().lines() {
        let Ok(line) = line else { break };
        if line.trim().is_empty() {
            continue;
        }
        let agent = agent.clone();
        let out = out.clone();
        // One at a time would hold a ping up behind a slow tool.
        workers.push(std::thread::spawn(move || {
            if let Some(reply) = forward(&agent, &line) {
                let mut out = out.lock().unwrap();
                let _ = writeln!(out, "{reply}");
                let _ = out.flush();
            }
        }));
    }
    for worker in workers {
        let _ = worker.join();
    }
    0
}

/// The reply to print for one line, if any.
fn forward(agent: &ureq::Agent, line: &str) -> Option<String> {
    let Ok(message) = serde_json::from_str::<Value>(line) else {
        return Some(
            json!({ "jsonrpc": "2.0", "id": null, "error": { "code": -32700, "message": "Parse error." } })
                .to_string(),
        );
    };
    let owed = wants_reply(&message);
    let fail = |text: &str| owed.then(|| errors_for(&message, text));
    // Read fresh each time: the app may have switched access or the token since.
    let settings = prefs::read_from_disk().mcp.unwrap_or_default();
    if !settings.enabled || settings.token.is_empty() {
        return fail(SWITCHED_OFF);
    }
    let auth = format!("Bearer {}", settings.token);
    for port in server::PORTS {
        let response = agent
            .post(&format!("http://127.0.0.1:{port}/mcp"))
            .header("Authorization", &auth)
            .header("Content-Type", "application/json")
            .header("Accept", "application/json, text/event-stream")
            .send(line);
        let Ok(mut response) = response else {
            continue; // nothing on this port
        };
        let status = response.status().as_u16();
        let body = response
            .body_mut()
            .with_config()
            .limit(32 * 1024 * 1024)
            .read_to_string()
            .unwrap_or_default();
        return match status {
            200 => one_line(&body).or_else(|| fail("daylog sent back something unreadable.")),
            202 => None,
            404 => continue, // another program on this port
            _ => fail(if body.is_empty() {
                "daylog refused the request."
            } else {
                &body
            }),
        };
    }
    fail(NOT_RUNNING)
}

/// stdio messages are one per line, so the reply mustn't hold a newline.
fn one_line(body: &str) -> Option<String> {
    serde_json::from_str::<Value>(body)
        .ok()
        .map(|v| v.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_requests_are_owed_a_reply() {
        assert!(wants_reply(
            &json!({ "jsonrpc": "2.0", "id": 1, "method": "ping" })
        ));
        assert!(wants_reply(
            &json!({ "jsonrpc": "2.0", "id": "a", "method": "tools/list" })
        ));
        assert!(!wants_reply(
            &json!({ "jsonrpc": "2.0", "method": "notifications/initialized" })
        ));
        assert!(!wants_reply(
            &json!({ "jsonrpc": "2.0", "id": 3, "result": {} })
        ));
        assert!(wants_reply(&json!([
            { "jsonrpc": "2.0", "method": "notifications/initialized" },
            { "jsonrpc": "2.0", "id": 2, "method": "ping" }
        ])));
    }

    #[test]
    fn errors_carry_each_request_id() {
        let single: Value =
            serde_json::from_str(&errors_for(&json!({ "id": 7, "method": "ping" }), "x")).unwrap();
        assert_eq!(single["id"], 7);
        assert_eq!(single["error"]["message"], "x");
        let batch: Value = serde_json::from_str(&errors_for(
            &json!([{ "method": "a" }, { "id": "b", "method": "ping" }]),
            "x",
        ))
        .unwrap();
        assert_eq!(batch.as_array().unwrap().len(), 1);
        assert_eq!(batch[0]["id"], "b");
    }

    #[test]
    fn replies_are_one_line() {
        assert_eq!(
            one_line("{\n  \"a\": \"b\\nc\"\n}").unwrap(),
            "{\"a\":\"b\\nc\"}"
        );
        assert!(one_line("not json").is_none());
    }

    #[test]
    fn tokens_are_long_and_random() {
        let a = new_token().unwrap();
        assert_eq!(a.len(), 64);
        assert_ne!(a, new_token().unwrap());
    }
}
