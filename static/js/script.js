// Get auth key from URL if present
const urlParams = new URLSearchParams(window.location.search);
const authKey = urlParams.get('key');

document.addEventListener('DOMContentLoaded', function() {
    
    // Initialize pull-to-refresh
    PullToRefresh.init({
        mainElement: 'body',
        onRefresh() {
            window.location.reload();
        }
    });
    
    // Add item form handling
    const addButton = document.getElementById('add-button');
    const addForm = document.getElementById('add-form');
    const addInput = document.getElementById('add-input');
    const submitButton = document.getElementById('submit-add');
    const cancelButton = document.getElementById('cancel-add');
    
    addButton.addEventListener('click', function() {
        addForm.style.display = 'block';
        addInput.focus();
    });
    
    cancelButton.addEventListener('click', function() {
        addForm.style.display = 'none';
        addInput.value = '';
    });
    
    submitButton.addEventListener('click', function() {
        const itemName = addInput.value.trim();
        if (itemName) {
            addItem(itemName);
        }
    });
    
    addInput.addEventListener('keypress', function(e) {
        if (e.key === 'Enter') {
            const itemName = addInput.value.trim();
            if (itemName) {
                addItem(itemName);
            }
        }
    });
    
    // Single event delegation for all items
    document.querySelector('.content').addEventListener('click', function(e) {
        // Check if save button was clicked
        if (e.target.classList.contains('save-edit-btn')) {
            e.stopPropagation();
            const item = e.target.closest('.item');
            saveEdit(item);
            return;
        }
        
        // Check if cancel button was clicked
        if (e.target.classList.contains('cancel-edit-btn')) {
            e.stopPropagation();
            const item = e.target.closest('.item');
            cancelEdit(item);
            return;
        }
        
        // Check if checkbox was clicked
        if (e.target.classList.contains('item-checkbox')) {
            e.stopPropagation();
            const item = e.target.closest('.item');
            
            // Don't toggle completion if currently editing
            if (item.classList.contains('editing')) return;
            
            const itemName = item.dataset.name;
            const isComplete = item.classList.contains('complete');
            
            // Toggle UI immediately
            item.classList.toggle('complete');
            item.classList.toggle('incomplete');
            
            // Sync with server
            syncWithServer(itemName, !isComplete);
            
            // Update sections visibility
            updateSectionsVisibility();
            return;
        }
        
        // Check if text area was clicked (only for incomplete items)
        if (e.target.classList.contains('item-text')) {
            e.stopPropagation();
            const item = e.target.closest('.item');
            
            // Only allow editing of incomplete items
            if (item.classList.contains('complete')) return;
            
            // Don't enter edit mode if already editing
            if (item.classList.contains('editing')) return;
            
            startEdit(item);
            return;
        }
    });
});

function syncWithServer(itemName, markComplete) {
    const endpoint = markComplete ? '/api/complete_item' : '/api/incomplete_item';
    const url = authKey ? `${endpoint}?key=${encodeURIComponent(authKey)}` : endpoint;
    
    fetch(url, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ name: itemName })
    })
    .then(response => response.json())
    .then(data => {
        if (!data.success) {
            console.error('Failed to sync with server:', data.error);
            // Could revert the change here if needed
        }
    })
    .catch(error => {
        console.error('Error syncing with server:', error);
    });
}

function addItem(itemName) {
    const addForm = document.getElementById('add-form');
    const addInput = document.getElementById('add-input');
    const submitButton = document.getElementById('submit-add');
    
    // Disable form during request
    submitButton.disabled = true;
    submitButton.textContent = 'Adding...';
    
    const url = authKey ? `/api/add_item?key=${encodeURIComponent(authKey)}` : '/api/add_item';
    
    fetch(url, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ name: itemName })
    })
    .then(response => response.json())
    .then(data => {
        if (data.success) {
            // Add item to DOM immediately
            const content = document.querySelector('.content');
            const emptyState = document.querySelector('.empty-state');
            
            // Hide empty state if visible
            if (emptyState) {
                emptyState.style.display = 'none';
            }
            
            // Create new item element
            const newItem = document.createElement('div');
            newItem.className = 'item incomplete';
            newItem.dataset.name = data.item.name;
            newItem.innerHTML = `
                <div class="item-checkbox"></div>
                <div class="item-text">${data.item.name}</div>
                <div class="edit-form" style="display: none;">
                    <input type="text" class="edit-input" value="${data.item.name}" maxlength="100">
                    <button class="save-edit-btn">Save</button>
                    <button class="cancel-edit-btn">Cancel</button>
                </div>
            `;
            
            // Find where to insert (before completed items or section title)
            const sectionTitle = document.querySelector('.section-title');
            const firstCompleteItem = document.querySelector('.item.complete');
            
            if (sectionTitle && sectionTitle.style.display !== 'none') {
                content.insertBefore(newItem, sectionTitle);
            } else if (firstCompleteItem) {
                content.insertBefore(newItem, firstCompleteItem);
            } else {
                content.appendChild(newItem);
            }
            
            // Reset form
            addForm.style.display = 'none';
            addInput.value = '';
        } else {
            alert(data.error || 'Failed to add item');
        }
    })
    .catch(error => {
        console.error('Error adding item:', error);
        alert('Failed to add item');
    })
    .finally(() => {
        // Re-enable form
        submitButton.disabled = false;
        submitButton.textContent = 'Add';
    });
}

function updateSectionsVisibility() {
    const incompleteItems = document.querySelectorAll('.item.incomplete');
    const completeItems = document.querySelectorAll('.item.complete');
    const emptyState = document.querySelector('.empty-state');
    const completedTitle = document.querySelector('.section-title');
    
    // Show/hide empty state
    if (emptyState) {
        emptyState.style.display = incompleteItems.length === 0 ? 'block' : 'none';
    }
    
    // Show/hide completed section title
    if (completedTitle) {
        completedTitle.style.display = completeItems.length > 0 ? 'block' : 'none';
    }
}

function startEdit(item) {
    // Prevent multiple items from being edited simultaneously
    const currentlyEditing = document.querySelector('.item.editing');
    if (currentlyEditing && currentlyEditing !== item) {
        cancelEdit(currentlyEditing);
    }
    
    item.classList.add('editing');
    const editForm = item.querySelector('.edit-form');
    const editInput = item.querySelector('.edit-input');
    
    // Show the edit form
    editForm.style.display = 'flex';
    
    // Focus and select the text
    editInput.focus();
    editInput.select();
    
    // Add keyboard event listeners
    editInput.addEventListener('keydown', handleEditKeydown);
}

function cancelEdit(item) {
    item.classList.remove('editing');
    const editForm = item.querySelector('.edit-form');
    const editInput = item.querySelector('.edit-input');
    
    // Hide the edit form
    editForm.style.display = 'none';
    
    // Reset input value to original
    const originalName = item.dataset.name;
    editInput.value = originalName;
    
    // Remove keyboard event listeners
    editInput.removeEventListener('keydown', handleEditKeydown);
}

function saveEdit(item) {
    const editInput = item.querySelector('.edit-input');
    const saveButton = item.querySelector('.save-edit-btn');
    const newName = editInput.value.trim();
    const oldName = item.dataset.name;
    
    // Don't save if name hasn't changed or is empty
    if (!newName || newName === oldName) {
        cancelEdit(item);
        return;
    }
    
    // Disable save button during request
    saveButton.disabled = true;
    saveButton.textContent = 'Saving...';
    
    const url = authKey ? `/api/update_item?key=${encodeURIComponent(authKey)}` : '/api/update_item';
    
    fetch(url, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ 
            old_name: oldName, 
            new_name: newName 
        })
    })
    .then(response => response.json())
    .then(data => {
        if (data.success) {
            // Update the item in the DOM
            item.dataset.name = newName;
            item.querySelector('.item-text').textContent = newName;
            
            // Exit edit mode
            cancelEdit(item);
        } else {
            alert(data.error || 'Failed to update item');
        }
    })
    .catch(error => {
        console.error('Error updating item:', error);
        alert('Failed to update item');
    })
    .finally(() => {
        // Re-enable save button
        saveButton.disabled = false;
        saveButton.textContent = 'Save';
    });
}

function handleEditKeydown(e) {
    const item = e.target.closest('.item');
    
    if (e.key === 'Enter') {
        e.preventDefault();
        saveEdit(item);
    } else if (e.key === 'Escape') {
        e.preventDefault();
        cancelEdit(item);
    }
}