#!/usr/bin/env python3
import os
import re
import json
import requests
from functools import wraps
from flask import Flask, render_template, request, jsonify, Response, send_from_directory

app = Flask(__name__)

def require_auth(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        required_key = os.getenv('SHOPPING_LIST_KEY')
        if required_key:
            provided_key = request.args.get('key')
            if not provided_key or provided_key != required_key:
                return jsonify({'error': 'Authentication required'}), 403
        return f(*args, **kwargs)
    return decorated

def validate_item_name(name):
    """Validate item name for security and sanity"""
    if not name or not isinstance(name, str):
        return False, "Item name is required"
    
    name = name.strip()
    if len(name) == 0:
        return False, "Item name cannot be empty"
    
    if len(name) > 100:
        return False, "Item name too long (max 100 characters)"
    
    # Allow alphanumeric, spaces, and basic punctuation
    if not re.match(r'^[a-zA-Z0-9\s\-\'\.\,\(\)]+$', name):
        return False, "Item name contains invalid characters"
    
    return True, name.strip()

def get_ha_config():
    """Get and validate Home Assistant configuration"""
    ha_url = os.getenv('HA_URL')
    ha_token = os.getenv('HA_TOKEN')
    
    if not ha_url or not ha_token:
        return None, None, "Configuration error"
    
    return ha_url, ha_token, None

def create_ha_headers(token):
    """Create Home Assistant API headers"""
    return {
        'Authorization': f'Bearer {token}',
        'Content-Type': 'application/json'
    }

def call_ha_service(ha_url, ha_token, service_name, service_data):
    """Make a call to Home Assistant service API"""
    headers = create_ha_headers(ha_token)
    
    response = requests.post(
        f"{ha_url}/api/services/shopping_list/{service_name}",
        headers=headers,
        json=service_data
    )
    response.raise_for_status()
    return response

def handle_item_request(service_name, error_message="Failed to update item", extra_response_func=None):
    """Unified handler for shopping list item operations"""
    # Get configuration
    ha_url, ha_token, config_error = get_ha_config()
    if config_error:
        return jsonify({'error': config_error}), 500
    
    try:
        # Get and validate input
        data = request.get_json()
        item_name = data.get('name')
        
        is_valid, result = validate_item_name(item_name)
        if not is_valid:
            return jsonify({'error': result}), 400
        
        item_name = result
        service_data = {'name': item_name}
        
        # Call Home Assistant service
        call_ha_service(ha_url, ha_token, service_name, service_data)
        
        # Build response
        response = {'success': True}
        if extra_response_func:
            response.update(extra_response_func(item_name))
        
        return jsonify(response)
        
    except Exception as e:
        return jsonify({'error': error_message}), 500

def fetch_ha_items():
    """Fetch the raw shopping list from Home Assistant. Raises on config/HTTP error."""
    ha_url, ha_token, err = get_ha_config()
    if err:
        raise RuntimeError(err)

    response = requests.get(
        f"{ha_url}/api/shopping_list",
        headers=create_ha_headers(ha_token)
    )
    response.raise_for_status()
    return response.json()

@app.route('/')
@require_auth
def shopping_list():
    # The page is a shell; the client fetches the list from /api/items.
    return render_template('index.html')

@app.route('/api/items')
@require_auth
def api_items():
    """JSON read endpoint used by the client for in-place auto-refresh."""
    try:
        return jsonify({'items': fetch_ha_items()})
    except Exception as e:
        return jsonify({'error': 'Unable to load shopping list'}), 502

@app.route('/sw.js')
def service_worker():
    """Serve the service worker from root so its scope covers '/'."""
    resp = send_from_directory(app.static_folder, 'sw.js', mimetype='application/javascript')
    resp.headers['Cache-Control'] = 'no-cache'
    resp.headers['Service-Worker-Allowed'] = '/'
    return resp

@app.route('/manifest.json')
def manifest():
    """Templated so start_url can carry the ?key= auth param for homescreen launches."""
    key = request.args.get('key')
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
    return Response(json.dumps(data), mimetype='application/manifest+json')

@app.route('/api/complete_item', methods=['POST'])
@require_auth
def complete_item():
    return handle_item_request('complete_item')

@app.route('/api/incomplete_item', methods=['POST'])
@require_auth
def incomplete_item():
    return handle_item_request('incomplete_item')

@app.route('/api/add_item', methods=['POST'])
@require_auth
def add_item():
    # For add_item, we need to include the item data in the response
    extra_response_func = lambda item_name: {'item': {'name': item_name, 'complete': False}}
    return handle_item_request('add_item', 'Failed to add item', extra_response_func)

@app.route('/api/update_item', methods=['POST'])
@require_auth
def update_item():
    """Update an item by removing the old one and adding the new one"""
    # Get configuration
    ha_url, ha_token, config_error = get_ha_config()
    if config_error:
        return jsonify({'error': config_error}), 500
    
    try:
        # Get and validate input
        data = request.get_json()
        old_name = data.get('old_name')
        new_name = data.get('new_name')
        
        is_valid_old, result_old = validate_item_name(old_name)
        if not is_valid_old:
            return jsonify({'error': f"Old item name: {result_old}"}), 400
        
        is_valid_new, result_new = validate_item_name(new_name)
        if not is_valid_new:
            return jsonify({'error': f"New item name: {result_new}"}), 400
        
        # Remove the old item and add the new one
        # (Only incomplete items can be edited, so no need to preserve completion state)
        remove_data = {'name': result_old}
        call_ha_service(ha_url, ha_token, 'remove_item', remove_data)
        
        add_data = {'name': result_new}
        call_ha_service(ha_url, ha_token, 'add_item', add_data)
        
        return jsonify({
            'success': True, 
            'item': {'name': result_new}
        })
        
    except Exception as e:
        return jsonify({'error': 'Failed to update item'}), 500

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=42780, debug=False)