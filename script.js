// script.js — all interactivity, dynamic content, and "Coming Soon" handlers
(function() {
    // ----- THEME MANAGEMENT -----
    const body = document.body;
    const toggleBtn = document.getElementById('themeToggle');

    function setTheme(theme) {
        if (theme === 'dark') {
            body.classList.add('dark');
            body.classList.remove('light');
        } else {
            body.classList.add('light');
            body.classList.remove('dark');
        }
        localStorage.setItem('theme', theme);
    }

    const savedTheme = localStorage.getItem('theme');
    if (savedTheme === 'dark' || savedTheme === 'light') {
        setTheme(savedTheme);
    } else {
        setTheme(window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    }

    if (toggleBtn) {
        toggleBtn.addEventListener('click', () => {
            const newTheme = body.classList.contains('dark') ? 'light' : 'dark';
            setTheme(newTheme);
        });
    }

    // ----- "COMING SOON" ALERT HELPER -----
    function comingSoonAlert(e) {
        e.preventDefault();
        alert('✨ Coming soon — we\'re working on something special!');
    }

    // ----- GLOBAL COPY FUNCTION (for code blocks) -----
    window.copyCode = function(btn) {
        const codeWrapper = btn.closest('.code-wrapper');
        const codeBlock = codeWrapper?.querySelector('.code-block code');
        const codeText = codeBlock?.innerText;
        if (!codeText) return;
        navigator.clipboard.writeText(codeText).then(() => {
            const icon = btn.querySelector('i');
            if (icon) {
                const originalIcon = icon.getAttribute('data-lucide');
                icon.setAttribute('data-lucide', 'check');
                lucide.createIcons();
                setTimeout(() => {
                    icon.setAttribute('data-lucide', originalIcon || 'copy');
                    lucide.createIcons();
                }, 1500);
            }
        }).catch(() => {});
    };

    // ----- DYNAMIC CONTENT: FEATURES & REASONING EXAMPLES -----
    const featuresData = [
        { icon: 'brain', title: 'Step‑by‑step reasoning', description: 'Every conclusion is broken down into transparent thought processes.', bgImage: 'card.png', clickable: false },
        { icon: 'layout', title: 'Multi‑format output', description: 'Tables, code blocks, lists – always beautifully formatted.', bgImage: 'card1.png', clickable: false },
        { icon: 'zap', title: 'Lightning fast', description: 'Optimized inference, delivered with minimal latency.', bgImage: 'card3.png', clickable: false },
        { icon: 'users', title: 'Group Chat', description: 'Collaborate with your team in real‑time. Click to join.', bgImage: 'card4.png', clickable: true }
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

    const featuresContainer = document.getElementById('dynamic-features');
    const reasoningContainer = document.getElementById('dynamic-reasoning');

    if (featuresContainer) {
        featuresContainer.innerHTML = '';
        featuresData.forEach(f => {
            const wrapper = document.createElement('div');
            wrapper.className = 'feature-item';

            const card = document.createElement('div');
            card.className = 'feature-card';
            if (f.clickable) card.classList.add('clickable-card');
            if (f.bgImage) {
                card.style.backgroundImage = `url('${f.bgImage}')`;
            }
            card.innerHTML = `
                <div class="feature-icon">
                    <i data-lucide="${f.icon}" style="width: 48px; height: 48px; stroke-width: 1.5;"></i>
                </div>
            `;
            
            if (f.clickable) {
                card.addEventListener('click', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    alert('✨ Group Chat is coming soon — stay tuned!');
                });
            }

            const textBlock = document.createElement('div');
            textBlock.className = 'feature-text';
            textBlock.innerHTML = `<h3>${f.title}</h3><p>${f.description}</p>`;

            wrapper.appendChild(card);
            wrapper.appendChild(textBlock);
            featuresContainer.appendChild(wrapper);
        });
    }

    if (reasoningContainer) {
        reasoningContainer.innerHTML = '';
        reasoningData.forEach(r => {
            const card = document.createElement('div');
            card.className = 'reasoning-card';
            card.innerHTML = `
                <div class="user-bubble">${r.userBubble}</div>
                <div class="thought-process">${r.thoughtProcess}</div>
                <div class="conclusion">${r.conclusion}</div>
            `;
            reasoningContainer.appendChild(card);
        });
    }

    // ----- LUCIDE ICONS INIT (after dynamic content) -----
    if (typeof lucide !== 'undefined') {
        lucide.createIcons();
    }

    // ----- INTERCEPT ALL NAVIGATION LINKS THAT LEAD TO OTHER PAGES (except index.html) -----
    function bindComingSoonToLinks() {
        // All navigation links in navbar, dropdown, and CTA buttons
        const navLinks = document.querySelectorAll('.nav-links a, .dropdown-content a, .cta .btn-primary, .cta .btn-outline');
        navLinks.forEach(link => {
            const href = link.getAttribute('href');
            if (href && href !== 'index.html' && !href.startsWith('#') && href !== '') {
                link.addEventListener('click', comingSoonAlert);
            }
        });
        
        // Special handling for login button
        const loginButton = document.getElementById('loginBtn');
        if (loginButton) {
            loginButton.addEventListener('click', (e) => {
                e.preventDefault();
                alert('🔐 Login portal is coming soon — we’ll notify you!');
            });
        }
    }

    // Also handle any potential "Get started" / "Try playground" double protection
    // run after DOM ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', bindComingSoonToLinks);
    } else {
        bindComingSoonToLinks();
    }

    // Additional safeguard: if any link inside .cta or .dropdown-content changes dynamically, but we covered static ones.
    // Also intercept "Research" and "Stories" explicitly if needed (already covered by .nav-links a)
})();
