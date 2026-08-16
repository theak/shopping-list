#!/usr/bin/env python3
import os
import re
import json
import urllib.request
import urllib.error
from functools import wraps
from bottle import Bottle, request, response, static_file

app = Bottle()

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
STATIC_DIR = os.path.join(BASE_DIR, 'static')
INDEX_HTML = open(os.path.join(BASE_DIR, 'templates', 'index.html')).read()
HA_TIMEOUT = 10


def require_auth(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        required_key = os.getenv('SHOPPING_LIST_KEY')
        if required_key and request.query.get('key') != required_key:
            response.status = 403
            return {'error': 'Authentication required'}
        return f(*args, **kwargs)
    return decorated


def validate_item_name(name):
    if not name or not isinstance(name, str):
        return False, "Item name is required"

    name = name.strip()
    if len(name) == 0:
        return False, "Item name cannot be empty"

    if len(name) > 100:
        return False, "Item name too long (max 100 characters)"

    if not re.match(r'^[a-zA-Z0-9\s\-\'\.\,\(\)]+$', name):
        return False, "Item name contains invalid characters"

    return True, name.strip()


def get_ha_config():
    ha_url = os.getenv('HA_URL')
    ha_token = os.getenv('HA_TOKEN')
    if not ha_url or not ha_token:
        return None, None, "Configuration error"
    return ha_url, ha_token, None


def ha_request(ha_url, ha_token, path, payload=None):
    data = json.dumps(payload).encode() if payload is not None else None
    req = urllib.request.Request(
        f"{ha_url}{path}",
        data=data,
        method='POST' if data is not None else 'GET',
        headers={
            'Authorization': f'Bearer {ha_token}',
            'Content-Type': 'application/json',
        },
    )
    with urllib.request.urlopen(req, timeout=HA_TIMEOUT) as resp:
        body = resp.read()
    return json.loads(body) if body else None


def call_ha_service(ha_url, ha_token, service_name, service_data):
    return ha_request(ha_url, ha_token, f"/api/services/shopping_list/{service_name}", service_data)


def handle_item_request(service_name, error_message="Failed to update item", extra_response_func=None):
    ha_url, ha_token, config_error = get_ha_config()
    if config_error:
        response.status = 500
        return {'error': config_error}

    try:
        data = request.json or {}
        is_valid, result = validate_item_name(data.get('name'))
        if not is_valid:
            response.status = 400
            return {'error': result}

        call_ha_service(ha_url, ha_token, service_name, {'name': result})

        result_body = {'success': True}
        if extra_response_func:
            result_body.update(extra_response_func(result))
        return result_body

    except Exception:
        response.status = 500
        return {'error': error_message}


def fetch_ha_items():
    ha_url, ha_token, err = get_ha_config()
    if err:
        raise RuntimeError(err)
    return ha_request(ha_url, ha_token, "/api/shopping_list")


@app.route('/')
@require_auth
def shopping_list():
    key = request.query.get('key')
    href = f"/manifest.json?key={key}" if key else "/manifest.json"
    return INDEX_HTML.replace('{{manifest_href}}', href)


@app.route('/api/items')
@require_auth
def api_items():
    try:
        return {'items': fetch_ha_items()}
    except Exception:
        response.status = 502
        return {'error': 'Unable to load shopping list'}


@app.route('/static/<filepath:path>')
def serve_static(filepath):
    return static_file(filepath, root=STATIC_DIR)


@app.route('/sw.js')
def service_worker():
    # Served from root so the service worker's scope covers '/'.
    return static_file(
        'sw.js', root=STATIC_DIR, mimetype='application/javascript',
        headers={'Cache-Control': 'no-cache', 'Service-Worker-Allowed': '/'},
    )


@app.route('/manifest.json')
def manifest():
    key = request.query.get('key')
    data = {
        "name": "Shopping List",
        "short_name": "Shopping",
        "start_url": f"/?key={key}" if key else "/",
        "scope": "/",
        "display": "standalone",
        "background_color": "#f5f5f5",
        "theme_color": "#1976d2",
        "icons": [
            {"src": "/static/img/icon.png", "sizes": "192x192", "type": "image/png", "purpose": "any"},
            {"src": "/static/img/icon.png", "sizes": "512x512", "type": "image/png", "purpose": "any maskable"},
        ],
    }
    response.content_type = 'application/manifest+json'
    return json.dumps(data)


@app.route('/api/complete_item', method='POST')
@require_auth
def complete_item():
    return handle_item_request('complete_item')


@app.route('/api/incomplete_item', method='POST')
@require_auth
def incomplete_item():
    return handle_item_request('incomplete_item')


@app.route('/api/add_item', method='POST')
@require_auth
def add_item():
    extra_response_func = lambda item_name: {'item': {'name': item_name, 'complete': False}}
    return handle_item_request('add_item', 'Failed to add item', extra_response_func)


@app.route('/api/update_item', method='POST')
@require_auth
def update_item():
    ha_url, ha_token, config_error = get_ha_config()
    if config_error:
        response.status = 500
        return {'error': config_error}

    try:
        data = request.json or {}
        is_valid_old, result_old = validate_item_name(data.get('old_name'))
        if not is_valid_old:
            response.status = 400
            return {'error': f"Old item name: {result_old}"}

        is_valid_new, result_new = validate_item_name(data.get('new_name'))
        if not is_valid_new:
            response.status = 400
            return {'error': f"New item name: {result_new}"}

        call_ha_service(ha_url, ha_token, 'remove_item', {'name': result_old})
        call_ha_service(ha_url, ha_token, 'add_item', {'name': result_new})

        return {'success': True, 'item': {'name': result_new}}

    except Exception:
        response.status = 500
        return {'error': 'Failed to update item'}


if __name__ == '__main__':
    # waitress, like the container. Bottle's default WSGIRef dev server is
    # single-threaded and stalls concurrent requests.
    app.run(host='0.0.0.0', port=42780, server='waitress')
