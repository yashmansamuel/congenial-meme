// ========================
// Theme Toggle
// ========================
function initTheme() {
    const storedTheme = localStorage.getItem('theme');
    const body = document.body;
    if (storedTheme === 'dark') {
        body.classList.remove('light');
        body.classList.add('dark');
    } else if (storedTheme === 'light') {
        body.classList.remove('dark');
        body.classList.add('light');
    } else {
        // Default light
        body.classList.add('light');
    }
    updateThemeIcon();
}

function updateThemeIcon() {
    const isDark = document.body.classList.contains('dark');
    const sunIcon = document.querySelector('.theme-toggle .sun');
    const moonIcon = document.querySelector('.theme-toggle .moon');
    if (sunIcon && moonIcon) {
        if (isDark) {
            sunIcon.style.display = 'none';
            moonIcon.style.display = 'inline';
        } else {
            sunIcon.style.display = 'inline';
            moonIcon.style.display = 'none';
        }
    }
}

function toggleTheme() {
    const body = document.body;
    if (body.classList.contains('light')) {
        body.classList.remove('light');
        body.classList.add('dark');
        localStorage.setItem('theme', 'dark');
    } else {
        body.classList.remove('dark');
        body.classList.add('light');
        localStorage.setItem('theme', 'light');
    }
    updateThemeIcon();
}

// ========================
// Features & Reasoning Data (from original inline script)
// ========================
const featuresData = [
    { icon: 'brain', title: 'Step‑by‑step reasoning', description: 'Every conclusion is broken down into transparent thought processes.', bgImage: 'card.png' },
    { icon: 'layout', title: 'Multi‑format output', description: 'Tables, code blocks, lists – always beautifully formatted.', bgImage: 'card1.png' },
    { icon: 'zap', title: 'Lightning fast', description: 'Optimized inference, delivered with minimal latency.', bgImage: 'card3.png' },
    { icon: 'users', title: 'Group Chat', description: 'Collaborate with your team in real‑time. Click to join.', bgImage: 'card4.png', link: 'group-chat.html' }
];

const reasoningData = [
    {
        userBubble: 'What is the capital of France?',
        thoughtProcess: '⚡ User asks about capital of France. Need to recall geography.<br>⚡ France is a country in Europe. Its capital is Paris.',
        conclusion: '<h3>Conclusion</h3><p>The capital of France is <strong>Paris</strong>.</p>'
    },
    {
        userBubble: 'Show a quick sort in Python.',
        thoughtProcess: '⚡ Request: quicksort implementation in Python.',
        conclusion: `<h3>Python quicksort</h3>
            <div class="code-wrapper">
                <div class="code-header">
                    <span class="code-lang">python</span>
                    <button class="code-copy" onclick="copyCode(this)">
                        <i data-lucide="copy" style="width: 14px; height: 14px;"></i>
                    </button>
                </div>
                <pre class="code-block"><code>def quicksort(arr):
    if len(arr) <= 1: return arr
    pivot = arr[len(arr)//2]
    left = [x for x in arr if x < pivot]
    middle = [x for x in arr if x == pivot]
    right = [x for x in arr if x > pivot]
    return quicksort(left) + middle + quicksort(right)</code></pre>
            </div>`
    }
];

function renderFeatures() {
    const container = document.getElementById('dynamic-features');
    if (!container) return;
    container.innerHTML = '';
    featuresData.forEach(f => {
        const wrapper = document.createElement('div');
        wrapper.className = 'feature-item';

        const card = document.createElement('div');
        card.className = 'feature-card';
        if (f.bgImage) {
            card.style.backgroundImage = `url('${f.bgImage}')`;
        }
        if (f.link) {
            card.addEventListener('click', () => window.location.href = f.link);
        }
        card.innerHTML = `
            <div class="feature-icon">
                <i data-lucide="${f.icon}" style="width: 48px; height: 48px; stroke-width: 1.5;"></i>
            </div>
        `;

        const textBlock = document.createElement('div');
        textBlock.className = 'feature-text';
        textBlock.innerHTML = `<h3>${f.title}</h3><p>${f.description}</p>`;

        wrapper.appendChild(card);
        wrapper.appendChild(textBlock);
        container.appendChild(wrapper);
    });
}

function renderReasoning() {
    const container = document.getElementById('dynamic-reasoning');
    if (!container) return;
    container.innerHTML = '';
    reasoningData.forEach(r => {
        const card = document.createElement('div');
        card.className = 'reasoning-card';
        card.innerHTML = `
            <div class="user-bubble">${r.userBubble}</div>
            <div class="thought-process">${r.thoughtProcess}</div>
            <div class="conclusion">${r.conclusion}</div>
        `;
        container.appendChild(card);
    });
}

// Copy code function (global for onclick)
window.copyCode = function(btn) {
    const code = btn.closest('.code-wrapper')?.querySelector('.code-block code')?.innerText;
    if (!code) return;
    navigator.clipboard.writeText(code).then(() => {
        const icon = btn.querySelector('i');
        if (icon) {
            icon.setAttribute('data-lucide', 'check');
            lucide.createIcons();
            setTimeout(() => {
                icon.setAttribute('data-lucide', 'copy');
                lucide.createIcons();
            }, 1500);
        }
    });
};

// ========================
// Coming Soon Modal Logic
// ========================
const modal = document.getElementById('comingSoonModal');
const researchLink = document.getElementById('researchLink');
const storiesLink = document.getElementById('storiesLink');
const closeModalBtn = document.getElementById('closeModalBtn');
const modalConfirmBtn = document.getElementById('modalConfirmBtn');

function showComingSoonModal() {
    if (modal) {
        modal.style.display = 'flex';
        // Re-initialize Lucide icons inside modal (in case they aren't rendered)
        lucide.createIcons();
    }
}

function hideModal() {
    if (modal) {
        modal.style.display = 'none';
    }
}

// Attach event listeners for Research and Stories links
if (researchLink) {
    researchLink.addEventListener('click', (e) => {
        e.preventDefault();
        showComingSoonModal();
    });
}
if (storiesLink) {
    storiesLink.addEventListener('click', (e) => {
        e.preventDefault();
        showComingSoonModal();
    });
}
if (closeModalBtn) {
    closeModalBtn.addEventListener('click', hideModal);
}
if (modalConfirmBtn) {
    modalConfirmBtn.addEventListener('click', hideModal);
}
// Close modal when clicking outside the modal content
if (modal) {
    modal.addEventListener('click', (e) => {
        if (e.target === modal) {
            hideModal();
        }
    });
}

// ========================
// Login button (simple alert)
// ========================
const loginBtn = document.getElementById('loginBtn');
if (loginBtn) {
    loginBtn.addEventListener('click', () => {
        alert('Login functionality is coming soon. Stay tuned!');
    });
}

// ========================
// Initialize everything on DOMContentLoaded
// ========================
document.addEventListener('DOMContentLoaded', function() {
    initTheme();
    renderFeatures();
    renderReasoning();
    lucide.createIcons();

    // Theme toggle button
    const themeToggle = document.getElementById('themeToggle');
    if (themeToggle) {
        themeToggle.addEventListener('click', toggleTheme);
    }

    // Optional: if there are any code copy buttons initially (none, but just in case)
    // The copyCode is already global, so it works.
});
