(function() {
    // ---------- Theme handling ----------
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

    const saved = localStorage.getItem('theme');
    if (saved === 'dark' || saved === 'light') {
        setTheme(saved);
    } else {
        setTheme(window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    }

    if (toggleBtn) {
        toggleBtn.addEventListener('click', () => {
            const newTheme = body.classList.contains('dark') ? 'light' : 'dark';
            setTheme(newTheme);
        });
    }

    const loginBtn = document.getElementById('loginBtn');
    if (loginBtn) {
        loginBtn.addEventListener('click', () => {
            alert('Login functionality coming soon!');
        });
    }

    // ---------- Global "Coming soon" for all navigation links ----------
    function showComingSoon(event) {
        event.preventDefault();
        alert('Coming soon! This feature is under development.');
    }

    // Intercept all internal links that point to .html pages (except index.html)
    document.addEventListener('click', function(e) {
        let target = e.target.closest('a');
        if (!target) return;

        const href = target.getAttribute('href');
        if (!href) return;

        // Block any .html link that is not index.html
        if (href.includes('.html') && !href.includes('index.html')) {
            e.preventDefault();
            alert('Coming soon! This feature is under development.');
        }
    });

    // ---------- Dynamic content generation ----------
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

    const featuresContainer = document.getElementById('dynamic-features');
    const reasoningContainer = document.getElementById('dynamic-reasoning');

    if (featuresContainer) {
        featuresContainer.innerHTML = '';
        featuresData.forEach(f => {
            const wrapper = document.createElement('div');
            wrapper.className = 'feature-item';

            const card = document.createElement('div');
            card.className = 'feature-card';
            if (f.bgImage) {
                card.style.backgroundImage = `url('${f.bgImage}')`;
            }

            // For Group Chat: show coming soon alert on click
            if (f.link === 'group-chat.html') {
                card.addEventListener('click', (e) => {
                    e.preventDefault();
                    alert('Coming soon! Group chat is under development.');
                });
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

    // Re-initialize Lucide icons after dynamic content
    if (typeof lucide !== 'undefined') {
        lucide.createIcons();
    }

    // ---------- Helper: copyCode ----------
    window.copyCode = function(btn) {
        const code = btn.closest('.code-wrapper')?.querySelector('.code-block code')?.innerText;
        if (!code) return;
        navigator.clipboard.writeText(code).then(() => {
            const icon = btn.querySelector('i');
            icon.setAttribute('data-lucide', 'check');
            if (typeof lucide !== 'undefined') lucide.createIcons();
            setTimeout(() => {
                icon.setAttribute('data-lucide', 'copy');
                if (typeof lucide !== 'undefined') lucide.createIcons();
            }, 1500);
        });
    };
})();
