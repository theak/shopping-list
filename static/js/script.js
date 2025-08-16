document.addEventListener('DOMContentLoaded', function() {
    // Initialize pull-to-refresh
    PullToRefresh.init({
        mainElement: 'body',
        onRefresh() {
            window.location.reload();
        }
    });
    
    // Add click handlers to initial incomplete items
    const incompleteItems = document.querySelectorAll('.item.incomplete');
    incompleteItems.forEach(item => {
        addIncompleteClickHandler(item);
    });
    
    // Add click handlers to initial complete items
    const completeItems = document.querySelectorAll('.item.complete');
    completeItems.forEach(item => {
        addCompleteClickHandler(item);
    });
});

function addIncompleteClickHandler(item) {
    item.style.cursor = 'pointer';
    item.title = 'Click to mark as completed';
    
    item.addEventListener('click', function() {
        // Get item name (remove any leading/trailing whitespace)
        const itemName = item.textContent.trim();
        
        // Update UI immediately for responsiveness
        item.classList.remove('incomplete');
        item.classList.add('complete');
        
        // Add strikethrough to text
        const text = item.querySelector('strong');
        if (text) {
            text.outerHTML = `<s>${text.innerHTML}</s>`;
        }
        
        // Move to completed section and add new click handler
        const newItem = moveToCompletedSection(item);
        addCompleteClickHandler(newItem);
        
        // Sync with server
        fetch('/api/complete_item', {
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
                // Optionally revert UI change on failure
            }
        })
        .catch(error => {
            console.error('Error syncing with server:', error);
        });
    });
}

function addCompleteClickHandler(item) {
    item.style.cursor = 'pointer';
    item.title = 'Click to mark as incomplete';
    
    item.addEventListener('click', function() {
        // Get item name (remove any leading/trailing whitespace and strikethrough)
        let itemName = item.textContent.trim();
        
        // Update UI immediately for responsiveness
        item.classList.remove('complete');
        item.classList.add('incomplete');
        
        // Remove strikethrough from text
        const text = item.querySelector('s');
        if (text) {
            text.outerHTML = `<strong>${text.innerHTML}</strong>`;
        }
        
        // Move back to incomplete section and add click handler
        const newItem = moveToIncompleteSection(item);
        addIncompleteClickHandler(newItem);
        
        // Sync with server
        fetch('/api/incomplete_item', {
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
                // Optionally revert UI change on failure
            }
        })
        .catch(error => {
            console.error('Error syncing with server:', error);
        });
    });
}

function moveToCompletedSection(item) {
    // Check if completed section exists
    let completedSection = document.querySelector('.completed-section');
    
    if (!completedSection) {
        // Create completed section
        const content = document.querySelector('.content');
        const sectionTitle = document.createElement('div');
        sectionTitle.className = 'section-title';
        sectionTitle.textContent = 'Completed Items';
        
        completedSection = document.createElement('div');
        completedSection.className = 'completed-section';
        
        content.appendChild(sectionTitle);
        content.appendChild(completedSection);
    }
    
    // Remove all event listeners by cloning
    const newItem = item.cloneNode(true);
    item.parentNode.replaceChild(newItem, item);
    
    // Move item to completed section
    completedSection.appendChild(newItem);
    
    // Check if all items are now completed
    const incompleteContainer = document.querySelector('.incomplete-container');
    const incompleteItems = document.querySelectorAll('.item.incomplete');
    if (incompleteItems.length === 0) {
        // Show "All items completed" message
        if (!document.querySelector('.empty-state')) {
            const emptyState = document.createElement('div');
            emptyState.className = 'empty-state';
            emptyState.textContent = '🎉 All items completed!';
            
            const content = document.querySelector('.content');
            const sectionTitle = document.querySelector('.section-title');
            if (sectionTitle) {
                content.insertBefore(emptyState, sectionTitle);
            } else {
                content.insertBefore(emptyState, content.firstChild);
            }
        }
        
        // Remove empty incomplete container if it exists
        if (incompleteContainer && incompleteContainer.children.length === 0) {
            incompleteContainer.remove();
        }
    }
    
    return newItem;
}

function moveToIncompleteSection(item) {
    // Remove "All items completed" message if it exists
    const emptyState = document.querySelector('.empty-state');
    if (emptyState) {
        emptyState.remove();
    }
    
    // Find the incomplete items container or create one
    let incompleteContainer = document.querySelector('.incomplete-container');
    
    if (!incompleteContainer) {
        // Find where to insert incomplete items (before completed section)
        const content = document.querySelector('.content');
        const completedTitle = content.querySelector('.section-title');
        
        incompleteContainer = document.createElement('div');
        incompleteContainer.className = 'incomplete-container';
        
        if (completedTitle) {
            content.insertBefore(incompleteContainer, completedTitle);
        } else {
            content.appendChild(incompleteContainer);
        }
    }
    
    // Remove all event listeners by cloning
    const newItem = item.cloneNode(true);
    item.parentNode.replaceChild(newItem, item);
    
    // Move item to incomplete section
    incompleteContainer.appendChild(newItem);
    
    // Check if completed section is now empty and remove it
    const completedSection = document.querySelector('.completed-section');
    if (completedSection && completedSection.children.length === 0) {
        completedSection.remove();
        // Also remove the section title
        const sectionTitle = document.querySelector('.section-title');
        if (sectionTitle) {
            sectionTitle.remove();
        }
    }
    
    return newItem;
}