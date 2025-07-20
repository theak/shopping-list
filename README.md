# Home Assistant Shopping List Proxy

A simple vibe coded web proxy that displays your Home Assistant shopping list in a clean, modern interface with local completion toggling.

## Environment Variables

- `HA_URL` - Your Home Assistant URL (e.g., `http://homeassistant.local:8123`)
- `HA_TOKEN` - Your Home Assistant Long-lived Access Token

## Quick Start with Docker

```bash
docker build . -t shopping-list
docker run -p 42780:42780 \
  -e HA_URL="http://your-ha-url:8123" \
  -e HA_TOKEN="your-long-lived-token" \
  shopping-list
```

Visit `http://localhost:42780`

## Docker Compose

Create a `docker-compose.yml`:

```yaml
services:
  shopping-list:
    build: .
    ports:
      - "42780:42780"
    environment:
      - HA_URL=${HA_URL}
      - HA_TOKEN=${HA_TOKEN}
    restart: unless-stopped
```

Set your environment variables on the host:

```bash
export HA_URL="http://your-ha-url:8123"
export HA_TOKEN="your-long-lived-token"
```

Then run:

```bash
docker compose up -d
```

**Alternative:** Create a `.env` file in the same directory:

```bash
# .env file
HA_URL=http://your-ha-url:8123
HA_TOKEN=your-long-lived-token
```

Docker Compose will automatically load these variables.

## Manual Setup

1. Install dependencies:
```bash
pip install -r requirements.txt
```

2. Set environment variables:
```bash
export HA_URL="http://your-ha-url:8123"
export HA_TOKEN="your-long-lived-token"
```

3. Run the app:
```bash
python app.py
```

## Getting a Home Assistant Token

1. Go to your Home Assistant Profile page
2. Scroll to "Long-lived access tokens"
3. Click "Create token"
4. Give it a name and copy the token
5. Use this token as your `HA_TOKEN`

## Notes

- Item completion status is local only and resets on page refresh
- The "Edit" button opens the Home Assistant todo interface
- Requires Home Assistant's shopping list integration to be enabled