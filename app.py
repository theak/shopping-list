#!/usr/bin/env python3
import os
import requests
from flask import Flask, render_template, request, jsonify

app = Flask(__name__)

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
                                    complete_items=complete_items,
                                    ha_url=ha_url)
        
    except Exception as e:
        return render_template('index.html', error=f'Error: {str(e)}')

@app.route('/api/complete_item', methods=['POST'])
def complete_item():
    ha_url = os.getenv('HA_URL')
    ha_token = os.getenv('HA_TOKEN')
    
    if not ha_url or not ha_token:
        return jsonify({'error': 'HA configuration missing'}), 500
    
    try:
        data = request.get_json()
        item_name = data.get('name')
        
        if not item_name:
            return jsonify({'error': 'Item name required'}), 400
        
        headers = {
            'Authorization': f'Bearer {ha_token}',
            'Content-Type': 'application/json'
        }
        
        # Call Home Assistant service to mark item as complete
        service_data = {
            'name': item_name
        }
        
        response = requests.post(
            f"{ha_url}/api/services/shopping_list/complete_item",
            headers=headers,
            json=service_data
        )
        response.raise_for_status()
        
        return jsonify({'success': True})
        
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/incomplete_item', methods=['POST'])
def incomplete_item():
    ha_url = os.getenv('HA_URL')
    ha_token = os.getenv('HA_TOKEN')
    
    if not ha_url or not ha_token:
        return jsonify({'error': 'HA configuration missing'}), 500
    
    try:
        data = request.get_json()
        item_name = data.get('name')
        
        if not item_name:
            return jsonify({'error': 'Item name required'}), 400
        
        headers = {
            'Authorization': f'Bearer {ha_token}',
            'Content-Type': 'application/json'
        }
        
        # Call Home Assistant service to mark item as incomplete
        service_data = {
            'name': item_name
        }
        
        response = requests.post(
            f"{ha_url}/api/services/shopping_list/incomplete_item",
            headers=headers,
            json=service_data
        )
        response.raise_for_status()
        
        return jsonify({'success': True})
        
    except Exception as e:
        return jsonify({'error': str(e)}), 500

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=42780, debug=True)