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
        const item = e.target.closest('.item');
        if (!item) return;
        
        const itemName = item.dataset.name;
        const isComplete = item.classList.contains('complete');
        
        // Toggle UI immediately
        item.classList.toggle('complete');
        item.classList.toggle('incomplete');
        
        // Sync with server
        syncWithServer(itemName, !isComplete);
        
        // Update sections visibility
        updateSectionsVisibility();
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
            newItem.textContent = data.item.name;
            
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