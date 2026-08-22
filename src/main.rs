//! Shopping List — a stateless proxy to a Home Assistant `shopping_list` REST API.
//!
//! A faithful Rust port of the original Bottle app (`app.py`). There is no database:
//! all list state lives in Home Assistant; this server forwards reads/writes to HA's
//! REST API and serves the PWA frontend (baked into the binary).

mod handlers;
#[cfg(test)]
mod tests;

use axum::{
    Router,
    routing::{get, post},
};
use std::net::SocketAddr;
use std::sync::Arc;
use std::time::Duration;

/// Runtime configuration, read once at boot.
///
/// Every field is `Option` because the server must still boot and serve the frontend
/// even when Home Assistant is unconfigured — the config error then surfaces per
/// request (500 on mutations, 502 on `/api/items`), mirroring `app.py`'s request-time
/// `os.getenv` checks. This deliberately does NOT fail-fast (unlike sensordash).
pub struct Config {
    pub ha_url: Option<String>,
    pub ha_token: Option<String>,
    pub auth_key: Option<String>,
}

/// Read env into `Config`. An empty string counts as unset, matching Python truthiness
/// (`if not ha_url` / `if required_key`).
pub fn load_config() -> Config {
    fn var(name: &str) -> Option<String> {
        std::env::var(name).ok().filter(|s| !s.is_empty())
    }
    Config {
        ha_url: var("HA_URL"),
        ha_token: var("HA_TOKEN"),
        auth_key: var("SHOPPING_LIST_KEY"),
    }
}

/// Shared, cheaply-cloneable application state. `reqwest::Client` is internally `Arc`.
#[derive(Clone)]
pub struct AppState {
    pub cfg: Arc<Config>,
    pub client: reqwest::Client,
}

/// Build the app router. Kept public and layer-free so tests can drive it via `oneshot`.
pub fn build_router(state: AppState) -> Router {
    Router::new()
        .route("/", get(handlers::index))
        .route("/api/items", get(handlers::api_items))
        .route("/static/{*filepath}", get(handlers::serve_static))
        .route("/sw.js", get(handlers::service_worker))
        .route("/manifest.json", get(handlers::manifest))
        .route("/api/complete_item", post(handlers::complete_item))
        .route("/api/incomplete_item", post(handlers::incomplete_item))
        .route("/api/add_item", post(handlers::add_item))
        .route("/api/update_item", post(handlers::update_item))
        .with_state(state)
}

#[tokio::main]
async fn main() {
    let cfg = load_config();
    if cfg.auth_key.is_some() {
        eprintln!("shopping-list: SHOPPING_LIST_KEY set — access requires ?key=<key>");
    }
    if cfg.ha_url.is_none() || cfg.ha_token.is_none() {
        eprintln!(
            "shopping-list: WARNING — HA_URL/HA_TOKEN not fully set; item APIs will \
             error until configured"
        );
    }

    // One shared client; the 10s timeout mirrors app.py's HA_TIMEOUT (applied per request,
    // so update_item's two sequential calls each get their own window).
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(10))
        .build()
        .expect("failed to build HTTP client");

    let state = AppState {
        cfg: Arc::new(cfg),
        client,
    };

    let port: u16 = std::env::var("PORT")
        .ok()
        .and_then(|s| s.parse().ok())
        .unwrap_or(42780);
    let addr = SocketAddr::from(([0, 0, 0, 0], port));
    let listener = tokio::net::TcpListener::bind(addr)
        .await
        .unwrap_or_else(|e| panic!("failed to bind {addr}: {e}"));
    eprintln!("shopping-list: listening on http://{addr}");

    axum::serve(listener, build_router(state))
        .await
        .expect("server error");
}
