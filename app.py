#!/usr/bin/env python3
import os
import re
import requests
from flask import Flask, render_template, request, jsonify

app = Flask(__name__)

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
        
        # Call Home Assistant service
        service_data = {'name': item_name}
        call_ha_service(ha_url, ha_token, service_name, service_data)
        
        # Build response
        response = {'success': True}
        if extra_response_func:
            response.update(extra_response_func(item_name))
        
        return jsonify(response)
        
    except Exception as e:
        return jsonify({'error': error_message}), 500

@app.route('/')
def shopping_list():
    ha_url = os.getenv('HA_URL')
    ha_token = os.getenv('HA_TOKEN')
    
    if not ha_url:
        return render_template('index.html', error='HA_URL environment variable not set')
    
    if not ha_token:
        return render_template('index.html', error='HA_TOKEN environment variable not set')
    
    try:
        headers = {
            'Authorization': f'Bearer {ha_token}',
            'Content-Type': 'application/json'
        }
        
        response = requests.get(f"{ha_url}/api/shopping_list", headers=headers)
        response.raise_for_status()
        
        items = response.json()
        
        incomplete_items = [item for item in items if not item.get('complete', False)]
        complete_items = [item for item in items if item.get('complete', False)]
        
        return render_template('index.html', 
                                    incomplete_items=incomplete_items, 
                                    complete_items=complete_items)
        
    except Exception as e:
        return render_template('index.html', error='Unable to load shopping list')

@app.route('/api/complete_item', methods=['POST'])
def complete_item():
    return handle_item_request('complete_item')

@app.route('/api/incomplete_item', methods=['POST'])
def incomplete_item():
    return handle_item_request('incomplete_item')

@app.route('/api/add_item', methods=['POST'])
def add_item():
    # For add_item, we need to include the item data in the response
    extra_response_func = lambda item_name: {'item': {'name': item_name, 'complete': False}}
    return handle_item_request('add_item', 'Failed to add item', extra_response_func)

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=42780, debug=False)