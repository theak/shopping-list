# Home Assistant Shopping List Proxy

A minimal web app to proxy your Home Assistant Shopping List so you (and other family members) can view and update it, even externally when out on the go by exposing this app externally, without exposing much else. It works offline, installs to your home screen, and is blazingly fast (Rust backend, ~30kB frontend, docker container uses only ~1MB of RAM).

<img width="451" height="417" alt="image" src="https://github.com/user-attachments/assets/e965e50d-c96c-4c62-b3af-529f68de0402" />

## Environment Variables

- `HA_URL` - Your Home Assistant URL (e.g., `http://homeassistant.local:8123`)
- `HA_TOKEN` - Your Home Assistant Long-lived Access Token
- `SHOPPING_LIST_KEY` (optional) - Require ?key= parameter for access

## Quick Start with Docker

```bash
docker run -p 42780:42780 \
  -e HA_URL="http://your-ha-url:8123" \
  -e HA_TOKEN="your-long-lived-token" \
  -e SHOPPING_LIST_KEY="your-secret-key" \
  akshaykannan/shopping-list
```

Visit `http://localhost:42780?key=your-secret-key`

## Or Use Docker Compose

Create a `docker-compose.yml`:

```yaml
services:
  shopping-list:
    image: akshaykannan/shopping-list
    ports:
      - "42780:42780"
    environment:
      - HA_URL=${HA_URL}
      - HA_TOKEN=${HA_TOKEN}
      - SHOPPING_LIST_KEY=${SHOPPING_LIST_KEY}
    restart: unless-stopped
```

Create a `.env` file:

```bash
# .env file
HA_URL=http://your-ha-url:8123
HA_TOKEN=your-long-lived-token
SHOPPING_LIST_KEY=your-secret-key
```

Then run:

```bash
docker compose up -d
```

## Getting a Home Assistant Token

1. Go to your Home Assistant Profile page
2. Scroll to "Long-lived access tokens"
3. Click "Create token"
4. Give it a name and copy the token
5. Use this token as your `HA_TOKEN`

## Features

- 🛒 Display shopping list items from Home Assistant
- ✅ Click items to mark as completed/incomplete (syncs with HA)
- ➕ Add new items directly in the app
- 🔒 Optional key-based authentication
- 🎨 Modern, responsive design

## Notes

- Requires Home Assistant's shopping list integration to be enabled
- If `SHOPPING_LIST_KEY` is set, all access requires `?key=your-secret-key` parameter

---

## Development

The server is written in Rust (axum) and runs as a single static binary. The frontend
(`static/`, `templates/`) is plain Alpine.js + Pico CSS.

Run locally:

```bash
HA_URL="http://your-ha-url:8123" HA_TOKEN="your-long-lived-token" cargo run
```

Run the tests:

```bash
cargo test          # Rust backend
npm ci && npm test  # frontend (jsdom)
```

Build the Docker image:

```bash
docker build . -t shopping-list
```
