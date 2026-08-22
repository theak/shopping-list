//! Minimal backend tests: pure validation, plus router-level `oneshot` tests that drive
//! the item APIs against a small in-process fake Home Assistant server. The Python app
//! had no backend tests; these lock the contract that `app.py` implemented and that the
//! (unchanged) JS/jsdom frontend suite depends on.

use crate::{AppState, Config, build_router, handlers};
use axum::{
    Json, Router,
    body::{Body, Bytes},
    extract::{Path, State},
    http::{HeaderMap, Request, StatusCode},
    response::{IntoResponse, Response},
    routing::{get, post},
};
use http_body_util::BodyExt;
use serde_json::{Value, json};
use std::sync::{Arc, Mutex as StdMutex};
use std::time::Duration;
use tower::ServiceExt;

// ---- fake Home Assistant ----

#[derive(Clone)]
struct FakeState {
    calls: Arc<StdMutex<Vec<(String, String)>>>, // (service, name)
    fail: bool,
    items: Arc<Value>,
}

fn bearer_ok(headers: &HeaderMap) -> bool {
    headers.get("authorization").and_then(|v| v.to_str().ok()) == Some("Bearer test-token")
}

async fn fake_items(State(st): State<FakeState>, headers: HeaderMap) -> Response {
    if !bearer_ok(&headers) {
        return (StatusCode::UNAUTHORIZED, "no auth").into_response();
    }
    if st.fail {
        return (StatusCode::INTERNAL_SERVER_ERROR, "boom").into_response();
    }
    Json((*st.items).clone()).into_response()
}

async fn fake_service(
    State(st): State<FakeState>,
    Path(service): Path<String>,
    headers: HeaderMap,
    body: Bytes,
) -> Response {
    if !bearer_ok(&headers) {
        return (StatusCode::UNAUTHORIZED, "no auth").into_response();
    }
    if st.fail {
        return (StatusCode::INTERNAL_SERVER_ERROR, "boom").into_response();
    }
    let v: Value = serde_json::from_slice(&body).unwrap_or(Value::Null);
    let name = v
        .get("name")
        .and_then(|n| n.as_str())
        .unwrap_or("")
        .to_string();
    st.calls.lock().unwrap().push((service, name));
    Json(json!([])).into_response()
}

/// Spawn a fake HA server on an ephemeral port; returns `(base_url, recorded_calls)`.
async fn spawn_fake_ha(fail: bool, items: Value) -> (String, Arc<StdMutex<Vec<(String, String)>>>) {
    let calls = Arc::new(StdMutex::new(Vec::new()));
    let st = FakeState {
        calls: calls.clone(),
        fail,
        items: Arc::new(items),
    };
    let app = Router::new()
        .route("/api/shopping_list", get(fake_items))
        .route("/api/services/shopping_list/{service}", post(fake_service))
        .with_state(st);
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });
    (format!("http://{addr}"), calls)
}

// ---- app-under-test harness ----

fn test_client() -> reqwest::Client {
    reqwest::Client::builder()
        .timeout(Duration::from_secs(10))
        .build()
        .unwrap()
}

fn state(ha_url: Option<String>, auth_key: Option<String>) -> AppState {
    AppState {
        cfg: Arc::new(Config {
            ha_url,
            ha_token: Some("test-token".to_string()),
            auth_key,
        }),
        client: test_client(),
    }
}

async fn send(st: &AppState, req: Request<Body>) -> Response {
    build_router(st.clone()).oneshot(req).await.unwrap()
}

fn req(uri: &str) -> Request<Body> {
    Request::builder().uri(uri).body(Body::empty()).unwrap()
}

fn post_raw(uri: &str, body: &str, ctype: Option<&str>) -> Request<Body> {
    let mut b = Request::builder().method("POST").uri(uri);
    if let Some(c) = ctype {
        b = b.header("content-type", c);
    }
    b.body(Body::from(body.to_string())).unwrap()
}

fn post_json(uri: &str, body: &str) -> Request<Body> {
    post_raw(uri, body, Some("application/json"))
}

async fn json_body(resp: Response) -> Value {
    let bytes = resp.into_body().collect().await.unwrap().to_bytes();
    serde_json::from_slice(&bytes).unwrap()
}

async fn text_body(resp: Response) -> String {
    let bytes = resp.into_body().collect().await.unwrap().to_bytes();
    String::from_utf8(bytes.to_vec()).unwrap()
}

fn header(resp: &Response, name: &str) -> Option<String> {
    resp.headers()
        .get(name)
        .and_then(|v| v.to_str().ok())
        .map(|s| s.to_string())
}

// ---- tests ----

#[test]
fn validate_item_name_rules() {
    use handlers::validate_item_name as v;
    // Only a non-empty JSON string proceeds; everything else → "required".
    assert_eq!(v(None), Err("Item name is required"));
    assert_eq!(v(Some(&json!(5))), Err("Item name is required"));
    assert_eq!(v(Some(&json!(true))), Err("Item name is required"));
    assert_eq!(v(Some(&json!([1]))), Err("Item name is required"));
    assert_eq!(v(Some(&json!(""))), Err("Item name is required"));
    // Whitespace-only trims to empty.
    assert_eq!(v(Some(&json!("   "))), Err("Item name cannot be empty"));
    // Length is counted after trim; 101 chars too long, 100 ok.
    let s101 = "a".repeat(101);
    assert_eq!(
        v(Some(&json!(s101))),
        Err("Item name too long (max 100 characters)")
    );
    let s100 = "a".repeat(100);
    assert_eq!(v(Some(&json!(s100.clone()))), Ok(s100));
    // Disallowed character.
    assert_eq!(
        v(Some(&json!("Milk!"))),
        Err("Item name contains invalid characters")
    );
    // Valid characters, trimmed on the way out.
    assert_eq!(
        v(Some(&json!("  Milk (2), low-fat - O'Brien's.  "))),
        Ok("Milk (2), low-fat - O'Brien's.".to_string())
    );
}

#[tokio::test]
async fn index_requires_key_when_set() {
    let st = state(None, Some("s3cret".to_string()));

    // No key → 403 JSON (auth runs before HTML).
    let r = send(&st, req("/")).await;
    assert_eq!(r.status(), StatusCode::FORBIDDEN);
    assert_eq!(header(&r, "content-type").as_deref(), Some("application/json"));
    assert_eq!(json_body(r).await, json!({"error": "Authentication required"}));

    // Correct key → 200 HTML with the keyed manifest href and no leftover token.
    let r = send(&st, req("/?key=s3cret")).await;
    assert_eq!(r.status(), StatusCode::OK);
    let body = text_body(r).await;
    assert!(body.contains(r#"href="/manifest.json?key=s3cret""#));
    assert!(!body.contains("{{manifest_href}}"));
}

#[tokio::test]
async fn static_and_service_worker_are_open() {
    let st = state(None, Some("s3cret".to_string())); // key set, but these routes are open

    let r = send(&st, req("/sw.js")).await;
    assert_eq!(r.status(), StatusCode::OK);
    assert_eq!(
        header(&r, "content-type").as_deref(),
        Some("application/javascript; charset=UTF-8")
    );
    assert_eq!(header(&r, "cache-control").as_deref(), Some("no-cache"));
    assert_eq!(header(&r, "service-worker-allowed").as_deref(), Some("/"));

    let r = send(&st, req("/static/js/script.js")).await;
    assert_eq!(r.status(), StatusCode::OK);
    assert_eq!(
        header(&r, "content-type").as_deref(),
        Some("application/javascript; charset=UTF-8")
    );

    let r = send(&st, req("/static/img/icon.png")).await;
    assert_eq!(r.status(), StatusCode::OK);
    assert_eq!(header(&r, "content-type").as_deref(), Some("image/png"));
    let bytes = r.into_body().collect().await.unwrap().to_bytes();
    assert_eq!(&bytes[..4], b"\x89PNG");

    assert_eq!(
        send(&st, req("/static/nope.txt")).await.status(),
        StatusCode::NOT_FOUND
    );
}

#[tokio::test]
async fn manifest_is_open_and_keyed() {
    let st = state(None, Some("s3cret".to_string()));

    // Open even when a key is required, and start_url carries the raw query key.
    let r = send(&st, req("/manifest.json?key=abc")).await;
    assert_eq!(r.status(), StatusCode::OK);
    assert_eq!(
        header(&r, "content-type").as_deref(),
        Some("application/manifest+json")
    );
    assert_eq!(json_body(r).await["start_url"], "/?key=abc");

    let v = json_body(send(&st, req("/manifest.json")).await).await;
    assert_eq!(v["start_url"], "/");
}

#[tokio::test]
async fn api_items_success_and_errors() {
    // Success: HA array passed through verbatim under "items".
    let (base, _) = spawn_fake_ha(false, json!([{"name":"Milk","complete":false}])).await;
    let st = state(Some(base), None);
    let r = send(&st, req("/api/items")).await;
    assert_eq!(r.status(), StatusCode::OK);
    assert_eq!(
        json_body(r).await,
        json!({"items": [{"name":"Milk","complete":false}]})
    );

    // HA failure → 502.
    let (base, _) = spawn_fake_ha(true, json!([])).await;
    let r = send(&state(Some(base), None), req("/api/items")).await;
    assert_eq!(r.status(), StatusCode::BAD_GATEWAY);
    assert_eq!(
        json_body(r).await,
        json!({"error":"Unable to load shopping list"})
    );

    // Missing config → 502 (NOT 500), because the fetch raises and is caught generically.
    let r = send(&state(None, None), req("/api/items")).await;
    assert_eq!(r.status(), StatusCode::BAD_GATEWAY);
}

#[tokio::test]
async fn add_item_flow() {
    let (base, calls) = spawn_fake_ha(false, json!([])).await;
    let st = state(Some(base), None);

    // Success: name is trimmed, HA `add_item` called, response includes the item.
    let r = send(&st, post_json("/api/add_item", r#"{"name":" Bread "}"#)).await;
    assert_eq!(r.status(), StatusCode::OK);
    assert_eq!(
        json_body(r).await,
        json!({"success": true, "item": {"name":"Bread","complete":false}})
    );
    assert_eq!(
        *calls.lock().unwrap(),
        vec![("add_item".to_string(), "Bread".to_string())]
    );

    // Invalid name → 400 and no further HA call.
    let before = calls.lock().unwrap().len();
    let r = send(&st, post_json("/api/add_item", r#"{"name":"Milk!"}"#)).await;
    assert_eq!(r.status(), StatusCode::BAD_REQUEST);
    assert_eq!(
        json_body(r).await,
        json!({"error":"Item name contains invalid characters"})
    );
    assert_eq!(calls.lock().unwrap().len(), before);

    // Missing config → 500 "Configuration error".
    let r = send(&state(None, None), post_json("/api/add_item", r#"{"name":"Bread"}"#)).await;
    assert_eq!(r.status(), StatusCode::INTERNAL_SERVER_ERROR);
    assert_eq!(json_body(r).await, json!({"error":"Configuration error"}));
}

#[tokio::test]
async fn complete_and_incomplete() {
    let (base, calls) = spawn_fake_ha(false, json!([])).await;
    let st = state(Some(base), None);

    let r = send(&st, post_json("/api/complete_item", r#"{"name":"Milk"}"#)).await;
    assert_eq!(r.status(), StatusCode::OK);
    assert_eq!(json_body(r).await, json!({"success": true}));

    let r = send(&st, post_json("/api/incomplete_item", r#"{"name":"Milk"}"#)).await;
    assert_eq!(r.status(), StatusCode::OK);

    assert_eq!(
        *calls.lock().unwrap(),
        vec![
            ("complete_item".to_string(), "Milk".to_string()),
            ("incomplete_item".to_string(), "Milk".to_string()),
        ]
    );

    // HA failure → 500 "Failed to update item".
    let (base, _) = spawn_fake_ha(true, json!([])).await;
    let r = send(
        &state(Some(base), None),
        post_json("/api/complete_item", r#"{"name":"Milk"}"#),
    )
    .await;
    assert_eq!(r.status(), StatusCode::INTERNAL_SERVER_ERROR);
    assert_eq!(json_body(r).await, json!({"error":"Failed to update item"}));
}

#[tokio::test]
async fn update_item_flow() {
    let (base, calls) = spawn_fake_ha(false, json!([])).await;
    let st = state(Some(base), None);

    let r = send(
        &st,
        post_json(
            "/api/update_item",
            r#"{"old_name":"Milk","new_name":"Almond Milk"}"#,
        ),
    )
    .await;
    assert_eq!(r.status(), StatusCode::OK);
    assert_eq!(
        json_body(r).await,
        json!({"success": true, "item": {"name":"Almond Milk"}})
    );
    // remove_item(old) THEN add_item(new), in that order.
    assert_eq!(
        *calls.lock().unwrap(),
        vec![
            ("remove_item".to_string(), "Milk".to_string()),
            ("add_item".to_string(), "Almond Milk".to_string()),
        ]
    );

    // Invalid new_name → 400 with the "New item name:" prefix.
    let r = send(
        &st,
        post_json("/api/update_item", r#"{"old_name":"Milk","new_name":"x!"}"#),
    )
    .await;
    assert_eq!(r.status(), StatusCode::BAD_REQUEST);
    assert_eq!(
        json_body(r).await,
        json!({"error":"New item name: Item name contains invalid characters"})
    );
}

#[tokio::test]
async fn lenient_body_parsing() {
    let (base, calls) = spawn_fake_ha(false, json!([])).await;
    let st = state(Some(base), None);

    // Empty body → name absent → 400 "required".
    let r = send(&st, post_raw("/api/add_item", "", Some("application/json"))).await;
    assert_eq!(r.status(), StatusCode::BAD_REQUEST);
    assert_eq!(json_body(r).await, json!({"error":"Item name is required"}));

    // Valid JSON but no content-type → Bottle ignores it → name absent → 400 "required".
    let r = send(&st, post_raw("/api/add_item", r#"{"name":"Milk"}"#, None)).await;
    assert_eq!(r.status(), StatusCode::BAD_REQUEST);
    assert_eq!(json_body(r).await, json!({"error":"Item name is required"}));

    // Empty JSON object → 400 "required".
    let r = send(&st, post_json("/api/add_item", "{}")).await;
    assert_eq!(r.status(), StatusCode::BAD_REQUEST);

    // Malformed JSON with a JSON content-type → 500 (Python would raise → caught).
    let r = send(&st, post_json("/api/add_item", "{bad")).await;
    assert_eq!(r.status(), StatusCode::INTERNAL_SERVER_ERROR);
    assert_eq!(json_body(r).await, json!({"error":"Failed to add item"}));

    // None of the above reached HA.
    assert!(calls.lock().unwrap().is_empty());
}
