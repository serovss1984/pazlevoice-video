function toggleCategory(slug) {
    const section = document.querySelector('[data-category="' + slug + '"]');
    section.classList.toggle('collapsed');
}

document.addEventListener('DOMContentLoaded', () => {
    const saved = localStorage.getItem('collapsedCategories');
    if (saved) {
        JSON.parse(saved).forEach(slug => {
            const s = document.querySelector('[data-category="' + slug + '"]');
            if (s) s.classList.add('collapsed');
        });
    }

    document.querySelectorAll('.category-header').forEach(h => {
        h.addEventListener('click', function() {
            const slug = this.closest('.category-section').dataset.category;
            const section = document.querySelector('[data-category="' + slug + '"]');
            let collapsed = JSON.parse(localStorage.getItem('collapsedCategories') || '[]');
            if (section.classList.contains('collapsed')) {
                collapsed.push(slug);
            } else {
                collapsed = collapsed.filter(s => s !== slug);
            }
            localStorage.setItem('collapsedCategories', JSON.stringify([...new Set(collapsed)]));
        });
    });
});
