// script.js — all interactivity, now fetches data from backend API
(function() {
    // ----- THEME MANAGEMENT -----
    const body = document.body;
    const toggleBtn = document.getElementById('themeToggle');
    const toggleMobile = document.getElementById('themeToggleMobile');

    function setTheme(theme) {
        if (theme === 'dark') {
            body.classList.add('dark');
            body.classList.remove('light');
        } else {
            body.classList.add('light');
            body.classList.remove('dark');
        }
        localStorage.setItem('theme', theme);
        const themeColorMeta = document.querySelector('meta[name="theme-color"]');
        if (themeColorMeta) {
            themeColorMeta.setAttribute('content', theme === 'dark' ? '#1a1a1a' : '#000000');
        }
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
    if (toggleMobile) {
        toggleMobile.addEventListener('click', () => {
            const newTheme = body.classList.contains('dark') ? 'light' : 'dark';
            setTheme(newTheme);
            closeMobileMenu();
        });
    }

    // ----- CUSTOM MODAL (Coming Soon Card) -----
    const modal = document.getElementById('comingSoonModal');
    const closeModalBtn = document.getElementById('modalCloseBtn');
    const actionBtn = document.getElementById('modalActionBtn');

    function showComingSoonModal() {
        if (modal) modal.classList.add('active');
    }

    function hideModal() {
        if (modal) modal.classList.remove('active');
    }

    if (closeModalBtn) closeModalBtn.addEventListener('click', hideModal);
    if (actionBtn) actionBtn.addEventListener('click', hideModal);
    if (modal) {
        modal.addEventListener('click', (e) => {
            if (e.target === modal) hideModal();
        });
    }

    // ----- GLOBAL COPY FUNCTION -----
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

    // ----- FETCH DATA FROM BACKEND -----
    async function loadFeatures() {
        try {
            const response = await fetch('/api/features');
            const features = await response.json();
            const container = document.getElementById('dynamic-features');
            if (container) {
                container.innerHTML = '';
                features.forEach(f => {
                    const wrapper = document.createElement('div');
                    wrapper.className = 'feature-item';

                    const card = document.createElement('div');
                    card.className = 'feature-card';
                    if (f.clickable) card.classList.add('clickable-card');
                    if (f.bgImage) {
                        card.style.backgroundImage = `url('/static/${f.bgImage}')`;
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
                            showComingSoonModal();
                        });
                    }

                    const textBlock = document.createElement('div');
                    textBlock.className = 'feature-text';
                    textBlock.innerHTML = `<h3>${f.title}</h3><p>${f.description}</p>`;

                    wrapper.appendChild(card);
                    wrapper.appendChild(textBlock);
                    container.appendChild(wrapper);
                });
                lucide.createIcons(); // refresh icons
            }
        } catch (err) {
            console.error('Failed to load features:', err);
        }
    }

    async function loadReasoning() {
        try {
            const response = await fetch('/api/reasoning');
            const reasoning = await response.json();
            const container = document.getElementById('dynamic-reasoning');
            if (container) {
                container.innerHTML = '';
                reasoning.forEach(r => {
                    const card = document.createElement('div');
                    card.className = 'reasoning-card';
                    card.innerHTML = `
                        <div class="user-bubble">${r.userBubble}</div>
                        <div class="thought-process">${r.thoughtProcess}</div>
                        <div class="conclusion">${r.conclusion}</div>
                    `;
                    container.appendChild(card);
                });
                lucide.createIcons(); // refresh icons for copy buttons
            }
        } catch (err) {
            console.error('Failed to load reasoning:', err);
        }
    }

    // ----- MOBILE MENU FUNCTIONALITY -----
    const mobileMenuBtn = document.getElementById('mobileMenuBtn');
    const mobileMenuOverlay = document.getElementById('mobileMenuOverlay');
    const mobileMenuClose = document.getElementById('mobileMenuClose');
    const mobileDropdownBtns = document.querySelectorAll('.mobile-dropbtn');

    function openMobileMenu() {
        mobileMenuOverlay.classList.add('active');
        document.body.style.overflow = 'hidden';
    }

    function closeMobileMenu() {
        mobileMenuOverlay.classList.remove('active');
        document.body.style.overflow = '';
        document.querySelectorAll('.mobile-dropdown.active').forEach(drop => {
            drop.classList.remove('active');
        });
    }

    if (mobileMenuBtn) mobileMenuBtn.addEventListener('click', openMobileMenu);
    if (mobileMenuClose) mobileMenuClose.addEventListener('click', closeMobileMenu);
    if (mobileMenuOverlay) {
        mobileMenuOverlay.addEventListener('click', (e) => {
            if (e.target === mobileMenuOverlay) closeMobileMenu();
        });
    }

    mobileDropdownBtns.forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const parent = btn.closest('.mobile-dropdown');
            parent.classList.toggle('active');
        });
    });

    // ----- LOGIN BUTTON (using API) -----
    const loginBtn = document.getElementById('loginBtn');
    if (loginBtn) {
        loginBtn.addEventListener('click', async (e) => {
            e.preventDefault();
            // Show a simple prompt (or a modal) – for demo purposes
            const username = prompt('Enter username (demo):', 'guest');
            if (username) {
                try {
                    const res = await fetch('/api/login', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ username })
                    });
                    const data = await res.json();
                    alert(data.message);
                } catch (err) {
                    alert('Login failed: ' + err.message);
                }
            }
        });
    }

    // ----- INTERCEPT ALL LINKS (Coming Soon) -----
    function bindComingSoonToLinks() {
        const navLinks = document.querySelectorAll('.nav-links a, .dropdown-content a, .cta .btn-primary, .cta .btn-outline, .mobile-menu-links a, .mobile-dropdown-content a');
        navLinks.forEach(link => {
            const href = link.getAttribute('href');
            if (href && href !== '/' && !href.startsWith('#') && href !== '') {
                link.addEventListener('click', (e) => {
                    e.preventDefault();
                    showComingSoonModal();
                    closeMobileMenu();
                });
            }
        });
    }

    // Initialize
    loadFeatures();
    loadReasoning();
    bindComingSoonToLinks();
})();
