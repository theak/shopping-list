# Home Assistant Shopping List Proxy

A minimal web app to surface your Home Assistant shopping list entity in a read-only way to the public internet so you can view it externally when you're out shopping, without exposing much else.

## Environment Variables

- `HA_URL` - Your Home Assistant URL (e.g., `http://homeassistant.local:8123`)
- `HA_TOKEN` - Your Home Assistant Long-lived Access Token

## Quick Start with Docker

```bash
docker run -p 42780:42780 \
  -e HA_URL="http://your-ha-url:8123" \
  -e HA_TOKEN="your-long-lived-token" \
  akshaykannan/shopping-list
```

Visit `http://localhost:42780`

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
    restart: unless-stopped
```

Create a `.env` file:

```bash
# .env file
HA_URL=http://your-ha-url:8123
HA_TOKEN=your-long-lived-token
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
- ✅ Click items to mark as completed (local only)
- ↩️ Click completed items to mark as incomplete
- 📝 Direct link to edit list in Home Assistant
- 🎨 Modern, responsive design

## Notes

- Item completion status is local only and resets on page refresh (this app is read-only and will not expose write access to the public internet)
- The "Edit" button opens the Home Assistant todo interface locally (will only work on your local network)
- Requires Home Assistant's shopping list integration to be enabled

---

## Development

To build from source:

```bash
docker build . -t shopping-list
```
