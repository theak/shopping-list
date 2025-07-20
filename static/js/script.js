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
        // Mark as completed
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
    });
}

function addCompleteClickHandler(item) {
    item.style.cursor = 'pointer';
    item.title = 'Click to mark as incomplete';
    
    item.addEventListener('click', function() {
        // Mark as incomplete
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
    
    return newItem;
}

function moveToIncompleteSection(item) {
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
    
    return newItem;
}