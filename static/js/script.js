// Register the service worker (enables offline + installable PWA).
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
}

// Preserve the optional ?key= auth param on API requests.
const authKey = new URLSearchParams(location.search).get('key');
const apiUrl = (path) => authKey ? `${path}?key=${encodeURIComponent(authKey)}` : path;

document.addEventListener('alpine:init', () => {
    Alpine.data('list', () => ({
        items: [],
        offline: false,
        lastSync: localStorage.getItem('lastSync') || '',
        newItem: '',
        editing: null,     // name of the item being edited, or null
        editText: '',

        init() {
            this.refresh();
            setInterval(() => this.refresh(), 30000);
            document.addEventListener('visibilitychange', () => {
                if (document.visibilityState === 'visible') this.refresh();
            });
            window.addEventListener('offline', () => this.offline = true);
            window.addEventListener('online', () => this.refresh());
        },

        get incomplete() { return this.items.filter(i => !i.complete); },
        get complete() { return this.items.filter(i => i.complete); },

        // Poll the list. A cached (X-From-Cache) or failed response means we're offline.
        async refresh() {
            try {
                const res = await fetch(apiUrl('/api/items'), { cache: 'no-store' });
                if (!res.ok) throw new Error(res.status);
                this.items = (await res.json()).items || [];
                this.offline = res.headers.get('X-From-Cache') === '1';
                if (!this.offline) {
                    this.lastSync = new Date().toLocaleString([],
                        { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
                    localStorage.setItem('lastSync', this.lastSync);
                }
            } catch (_) {
                this.offline = true;
            }
        },

        post(path, body) {
            return fetch(apiUrl(path), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
            }).then(r => r.json());
        },

        // Read-only when offline: alert and block the mutation.
        blocked() {
            if (!this.offline) return false;
            alert("You're offline — changes won't be saved.");
            return true;
        },

        async toggle(item) {
            if (this.blocked()) return;
            item.complete = !item.complete;   // optimistic; Alpine re-renders
            await this.post(item.complete ? '/api/complete_item' : '/api/incomplete_item', { name: item.name });
        },

        async add() {
            const name = this.newItem.trim();
            if (!name || this.blocked()) return;
            const data = await this.post('/api/add_item', { name });
            if (data.success) { this.items.push({ name: data.item.name, complete: false }); this.newItem = ''; }
            else alert(data.error || 'Failed to add item');
        },

        startEdit(item) {
            if (this.blocked()) return;
            this.editing = item.name;
            this.editText = item.name;
        },

        cancelEdit() { this.editing = null; this.editText = ''; },

        async save(item) {
            const newName = this.editText.trim();
            if (!newName || newName === item.name) return this.cancelEdit();
            const data = await this.post('/api/update_item', { old_name: item.name, new_name: newName });
            if (data.success) { item.name = newName; this.cancelEdit(); }
            else alert(data.error || 'Failed to update item');
        },
    }));
});
