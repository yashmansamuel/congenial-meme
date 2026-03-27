(function() {
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
})();
