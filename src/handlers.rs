//! HTTP handlers: the PWA shell, static assets, the PWA manifest/service worker, and
//! the item APIs that proxy to Home Assistant. A faithful port of `app.py`'s routes —
//! status codes, JSON shapes, and error strings are preserved exactly.

use axum::{
    Json,
    body::Bytes,
    extract::{Path, RawQuery, State},
    http::{HeaderMap, StatusCode},
    response::{Html, IntoResponse, Response},
};
use regex::Regex;
use serde_json::{Map, Value, json};
use std::sync::LazyLock;

use crate::{AppState, Config};

// Frontend assets are baked into the binary so the container ships one file and never
// reaches out to a CDN. Paths are relative to this source file (src/).
const INDEX_HTML: &str = include_str!("../templates/index.html");
const SW_JS: &str = include_str!("../static/sw.js");
const PICO_CSS: &str = include_str!("../static/css/pico.min.css");
const STYLE_CSS: &str = include_str!("../static/css/style.css");
const ALPINE_JS: &str = include_str!("../static/js/alpine.min.js");
const SCRIPT_JS: &str = include_str!("../static/js/script.js");
const ICON_PNG: &[u8] = include_bytes!("../static/img/icon.png");

const JS_CT: &str = "application/javascript; charset=UTF-8";
const CSS_CT: &str = "text/css; charset=UTF-8";

/// `validate_item_name`'s character class (app.py:40): letters, digits, whitespace,
/// hyphen, apostrophe, period, comma, parentheses. `\s` is Unicode-aware, matching
/// Python `re` on a `str`. Compiled once.
static NAME_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"^[a-zA-Z0-9\s\-\'\.\,\(\)]+$").unwrap());

// ---- helpers ----

/// `(status, {"error": msg})` as JSON — Bottle serializes returned dicts to JSON.
fn json_status(status: StatusCode, body: Value) -> Response {
    (status, Json(body)).into_response()
}

/// Last value of the `key` query param, percent-decoded. Bottle's `request.query.get`
/// returns the last value for duplicates; a malformed query yields `None` (never a 400).
/// Returns `Some("")` for a present-but-empty `?key=` (distinct from absent).
fn query_key(raw: &Option<String>) -> Option<String> {
    let q = raw.as_deref()?;
    let pairs: Vec<(String, String)> = serde_urlencoded::from_str(q).ok()?;
    pairs
        .into_iter()
        .rev()
        .find(|(k, _)| k == "key")
        .map(|(_, v)| v)
}

/// The key only when "truthy" (Python `if key:` treats `""` as falsy). Used for building
/// the manifest href / start_url, where an empty `?key=` behaves like no key at all.
fn truthy_key(key: &Option<String>) -> Option<&str> {
    key.as_deref().filter(|k| !k.is_empty())
}

/// Reproduces the `require_auth` decorator (app.py:18-26). `None` = allow; `Some(resp)` =
/// reject with 403 JSON. Auth is enforced only when `SHOPPING_LIST_KEY` is set, and the
/// `?key=` query value must match exactly.
fn check_auth(cfg: &Config, key: &Option<String>) -> Option<Response> {
    match &cfg.auth_key {
        None => None,
        Some(secret) if key.as_deref() == Some(secret.as_str()) => None,
        Some(_) => Some(json_status(
            StatusCode::FORBIDDEN,
            json!({"error": "Authentication required"}),
        )),
    }
}

/// Python truthiness for a parsed JSON value (used for the `request.json or {}` logic).
fn is_truthy(v: &Value) -> bool {
    match v {
        Value::Null => false,
        Value::Bool(b) => *b,
        Value::Number(n) => n.as_f64().map(|f| f != 0.0).unwrap_or(true),
        Value::String(s) => !s.is_empty(),
        Value::Array(a) => !a.is_empty(),
        Value::Object(o) => !o.is_empty(),
    }
}

/// Validate an item name (app.py:29-43). Returns the trimmed name or the exact error
/// string. Only a non-empty JSON string proceeds past the first guard.
pub(crate) fn validate_item_name(name: Option<&Value>) -> Result<String, &'static str> {
    // `if not name or not isinstance(name, str)` — only a non-empty string survives.
    let s = match name {
        Some(Value::String(s)) if !s.is_empty() => s,
        _ => return Err("Item name is required"),
    };
    let trimmed = s.trim();
    if trimmed.is_empty() {
        return Err("Item name cannot be empty");
    }
    // Python `len` counts code points, not bytes.
    if trimmed.chars().count() > 100 {
        return Err("Item name too long (max 100 characters)");
    }
    if !NAME_RE.is_match(trimmed) {
        return Err("Item name contains invalid characters");
    }
    Ok(trimmed.to_string())
}

/// Reproduce Bottle's `data = request.json or {}` truth table, returning the dict to
/// `.get()` on. `Err(())` marks the cases where Python would raise inside the handler's
/// `try` (malformed JSON, or `.get` on a truthy non-dict) → the caller maps that to 500.
fn parse_body_map(headers: &HeaderMap, body: &Bytes) -> Result<Map<String, Value>, ()> {
    // Bottle only parses JSON when the media type is application/json[-rpc].
    let is_json = headers
        .get("content-type")
        .and_then(|v| v.to_str().ok())
        .map(|ct| {
            let mt = ct.split(';').next().unwrap_or("").trim().to_ascii_lowercase();
            mt == "application/json" || mt == "application/json-rpc"
        })
        .unwrap_or(false);

    // Non-JSON content type or empty body → request.json is None → `or {}` → {}.
    if !is_json || body.is_empty() {
        return Ok(Map::new());
    }

    let value: Value = match serde_json::from_slice(body) {
        Ok(v) => v,
        Err(_) => return Err(()), // malformed JSON → Bottle raises → caught → 500
    };

    match value {
        Value::Object(map) => Ok(map),          // dict → .get works (empty dict included)
        other if is_truthy(&other) => Err(()),  // truthy non-dict → .get AttributeError → 500
        _ => Ok(Map::new()),                     // falsy scalar/array → `or {}` → {}
    }
}

/// `(HA_URL, HA_TOKEN)` when both are configured (app.py:46-51).
fn ha_config(state: &AppState) -> Option<(&str, &str)> {
    match (&state.cfg.ha_url, &state.cfg.ha_token) {
        (Some(u), Some(t)) => Some((u.as_str(), t.as_str())),
        _ => None,
    }
}

/// GET `{HA_URL}/api/shopping_list` → parsed JSON (or `null` for an empty body, matching
/// `json.loads(body) if body else None`). Any failure (incl. missing config) → `Err`.
async fn ha_get_items(state: &AppState) -> Result<Value, ()> {
    let (url, token) = ha_config(state).ok_or(())?;
    let resp = state
        .client
        .get(format!("{url}/api/shopping_list"))
        .header("Authorization", format!("Bearer {token}"))
        .header("Content-Type", "application/json")
        .send()
        .await
        .map_err(|_| ())?
        .error_for_status()
        .map_err(|_| ())?; // urllib raises on HTTP >= 400; reqwest needs this explicitly
    let bytes = resp.bytes().await.map_err(|_| ())?;
    if bytes.is_empty() {
        Ok(Value::Null)
    } else {
        serde_json::from_slice(&bytes).map_err(|_| ())
    }
}

/// POST `{HA_URL}/api/services/shopping_list/{service}` with body `{"name": ...}`.
async fn call_ha_service(
    state: &AppState,
    url: &str,
    token: &str,
    service: &str,
    name: &str,
) -> Result<(), ()> {
    state
        .client
        .post(format!("{url}/api/services/shopping_list/{service}"))
        .header("Authorization", format!("Bearer {token}"))
        .json(&json!({ "name": name }))
        .send()
        .await
        .map_err(|_| ())?
        .error_for_status()
        .map_err(|_| ())?;
    Ok(())
}

// ---- routes ----

/// GET `/` (auth) — the PWA shell, with `{{manifest_href}}` substituted (app.py:106-111).
pub async fn index(State(state): State<AppState>, RawQuery(q): RawQuery) -> Response {
    let key = query_key(&q);
    if let Some(resp) = check_auth(&state.cfg, &key) {
        return resp;
    }
    let href = match truthy_key(&key) {
        Some(k) => format!("/manifest.json?key={k}"),
        None => "/manifest.json".to_string(),
    };
    Html(INDEX_HTML.replace("{{manifest_href}}", &href)).into_response()
}

/// GET `/api/items` (auth) — proxy the HA list; ANY failure → 502 (app.py:114-121).
pub async fn api_items(State(state): State<AppState>, RawQuery(q): RawQuery) -> Response {
    let key = query_key(&q);
    if let Some(resp) = check_auth(&state.cfg, &key) {
        return resp;
    }
    match ha_get_items(&state).await {
        Ok(items) => Json(json!({ "items": items })).into_response(),
        Err(()) => json_status(
            StatusCode::BAD_GATEWAY,
            json!({"error": "Unable to load shopping list"}),
        ),
    }
}

/// GET `/static/{*filepath}` (open) — embedded assets with explicit Content-Type.
pub async fn serve_static(Path(filepath): Path<String>) -> Response {
    let (ct, body): (&str, &[u8]) = match filepath.as_str() {
        "css/pico.min.css" => (CSS_CT, PICO_CSS.as_bytes()),
        "css/style.css" => (CSS_CT, STYLE_CSS.as_bytes()),
        "js/alpine.min.js" => (JS_CT, ALPINE_JS.as_bytes()),
        "js/script.js" => (JS_CT, SCRIPT_JS.as_bytes()),
        "img/icon.png" => ("image/png", ICON_PNG),
        _ => return (StatusCode::NOT_FOUND, "not found").into_response(),
    };
    ([("content-type", ct)], body).into_response()
}

/// GET `/sw.js` (open) — served from root so the SW scope covers `/` (app.py:129-135).
pub async fn service_worker() -> Response {
    (
        [
            ("content-type", JS_CT),
            ("cache-control", "no-cache"),
            ("service-worker-allowed", "/"),
        ],
        SW_JS,
    )
        .into_response()
}

/// GET `/manifest.json` (open) — PWA manifest (app.py:138-155).
pub async fn manifest(RawQuery(q): RawQuery) -> Response {
    let key = query_key(&q);
    let start_url = match truthy_key(&key) {
        Some(k) => format!("/?key={k}"),
        None => "/".to_string(),
    };
    let data = json!({
        "name": "Shopping List",
        "short_name": "Shopping",
        "start_url": start_url,
        "scope": "/",
        "display": "standalone",
        "background_color": "#f5f5f5",
        "theme_color": "#1976d2",
        "icons": [
            {"src": "/static/img/icon.png", "sizes": "192x192", "type": "image/png", "purpose": "any"},
            {"src": "/static/img/icon.png", "sizes": "512x512", "type": "image/png", "purpose": "any maskable"}
        ]
    });
    (
        [("content-type", "application/manifest+json")],
        serde_json::to_string(&data).unwrap(),
    )
        .into_response()
}

/// Shared mutation flow for complete/incomplete/add (app.py:74-96). Order of checks —
/// auth → config → body parse → validate → HA call — is preserved exactly.
async fn handle_item_request(
    state: &AppState,
    key: &Option<String>,
    headers: &HeaderMap,
    body: &Bytes,
    service: &str,
    error_message: &str,
    include_item: bool,
) -> Response {
    if let Some(resp) = check_auth(&state.cfg, key) {
        return resp;
    }
    // Config check runs before the body/validation (app.py:75-78, ahead of the try).
    let (url, token) = match ha_config(state) {
        Some(c) => c,
        None => {
            return json_status(
                StatusCode::INTERNAL_SERVER_ERROR,
                json!({"error": "Configuration error"}),
            );
        }
    };
    let data = match parse_body_map(headers, body) {
        Ok(m) => m,
        Err(()) => {
            return json_status(
                StatusCode::INTERNAL_SERVER_ERROR,
                json!({ "error": error_message }),
            );
        }
    };
    let name = match validate_item_name(data.get("name")) {
        Ok(n) => n,
        Err(msg) => return json_status(StatusCode::BAD_REQUEST, json!({ "error": msg })),
    };
    match call_ha_service(state, url, token, service, &name).await {
        Ok(()) => {
            let mut resp = json!({ "success": true });
            if include_item {
                resp["item"] = json!({ "name": name, "complete": false });
            }
            Json(resp).into_response()
        }
        Err(()) => json_status(
            StatusCode::INTERNAL_SERVER_ERROR,
            json!({ "error": error_message }),
        ),
    }
}

/// POST `/api/complete_item` (auth).
pub async fn complete_item(
    State(state): State<AppState>,
    RawQuery(q): RawQuery,
    headers: HeaderMap,
    body: Bytes,
) -> Response {
    let key = query_key(&q);
    handle_item_request(
        &state,
        &key,
        &headers,
        &body,
        "complete_item",
        "Failed to update item",
        false,
    )
    .await
}

/// POST `/api/incomplete_item` (auth).
pub async fn incomplete_item(
    State(state): State<AppState>,
    RawQuery(q): RawQuery,
    headers: HeaderMap,
    body: Bytes,
) -> Response {
    let key = query_key(&q);
    handle_item_request(
        &state,
        &key,
        &headers,
        &body,
        "incomplete_item",
        "Failed to update item",
        false,
    )
    .await
}

/// POST `/api/add_item` (auth) — success includes the new item (app.py:170-174).
pub async fn add_item(
    State(state): State<AppState>,
    RawQuery(q): RawQuery,
    headers: HeaderMap,
    body: Bytes,
) -> Response {
    let key = query_key(&q);
    handle_item_request(
        &state,
        &key,
        &headers,
        &body,
        "add_item",
        "Failed to add item",
        true,
    )
    .await
}

/// POST `/api/update_item` (auth) — rename = HA `remove_item(old)` then `add_item(new)`
/// (app.py:177-204). The two calls run in sequence; if the remove fails, add is skipped.
pub async fn update_item(
    State(state): State<AppState>,
    RawQuery(q): RawQuery,
    headers: HeaderMap,
    body: Bytes,
) -> Response {
    const ERR: &str = "Failed to update item";
    let key = query_key(&q);
    if let Some(resp) = check_auth(&state.cfg, &key) {
        return resp;
    }
    let (url, token) = match ha_config(&state) {
        Some(c) => c,
        None => {
            return json_status(
                StatusCode::INTERNAL_SERVER_ERROR,
                json!({"error": "Configuration error"}),
            );
        }
    };
    let data = match parse_body_map(&headers, &body) {
        Ok(m) => m,
        Err(()) => return json_status(StatusCode::INTERNAL_SERVER_ERROR, json!({ "error": ERR })),
    };
    let old = match validate_item_name(data.get("old_name")) {
        Ok(n) => n,
        Err(msg) => {
            return json_status(
                StatusCode::BAD_REQUEST,
                json!({"error": format!("Old item name: {msg}")}),
            );
        }
    };
    let new = match validate_item_name(data.get("new_name")) {
        Ok(n) => n,
        Err(msg) => {
            return json_status(
                StatusCode::BAD_REQUEST,
                json!({"error": format!("New item name: {msg}")}),
            );
        }
    };
    if call_ha_service(&state, url, token, "remove_item", &old)
        .await
        .is_err()
    {
        return json_status(StatusCode::INTERNAL_SERVER_ERROR, json!({ "error": ERR }));
    }
    if call_ha_service(&state, url, token, "add_item", &new)
        .await
        .is_err()
    {
        return json_status(StatusCode::INTERNAL_SERVER_ERROR, json!({ "error": ERR }));
    }
    Json(json!({"success": true, "item": {"name": new}})).into_response()
}
