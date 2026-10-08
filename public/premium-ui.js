(() => {
  const languages = [
    ['English', 'United States', 'en-US'],
    ['English', 'United Kingdom', 'en-GB'],
    ['اردو', 'Urdu', 'ur-PK'],
    ['العربية', 'Arabic', 'ar'],
    ['বাংলা', 'Bengali', 'bn'],
    ['中文', 'Chinese', 'zh'],
    ['Čeština', 'Czech', 'cs'],
    ['Dansk', 'Danish', 'da'],
    ['Nederlands', 'Dutch', 'nl'],
    ['Eesti', 'Estonian', 'et'],
    ['Filipino', 'Filipino', 'fil'],
    ['Suomi', 'Finnish', 'fi'],
    ['Français', 'Canada', 'fr-CA'],
    ['Français', 'France', 'fr-FR'],
    ['Deutsch', 'German', 'de'],
    ['Ελληνικά', 'Greek', 'el'],
    ['हिन्दी', 'Hindi', 'hi'],
    ['Bahasa Indonesia', 'Indonesian', 'id'],
    ['Italiano', 'Italian', 'it'],
    ['日本語', 'Japanese', 'ja'],
    ['한국어', 'Korean', 'ko'],
    ['Norsk', 'Norwegian', 'no'],
    ['Polski', 'Polish', 'pl'],
    ['Português', 'Brazil', 'pt-BR'],
    ['Português', 'Portugal', 'pt-PT'],
    ['Română', 'Romanian', 'ro'],
    ['Русский', 'Russian', 'ru'],
    ['Español', 'Spain', 'es-ES'],
    ['Español', 'Latin America', 'es-419'],
    ['Svenska', 'Swedish', 'sv'],
    ['Türkçe', 'Turkish', 'tr']
  ];

  const globe = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><circle cx="12" cy="12" r="9"></circle><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"></path></svg>';
  const check = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="m5 12 4 4L19 6"></path></svg>';
  const close = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"></path></svg>';
  const searchIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" aria-hidden="true"><circle cx="11" cy="11" r="7"></circle><path d="m20 20-4-4"></path></svg>';

  const init = () => {
    const trigger = document.querySelector('.footer-meta button[aria-label*="language" i]');
    if (!trigger || trigger.dataset.premiumReady) return;

    const stored = localStorage.getItem('signaturesi-language') || 'en-US';
    const current = languages.find((item) => item[2] === stored) || languages[0];
    trigger.dataset.premiumReady = 'true';
    trigger.classList.add('footer-language-trigger');
    trigger.innerHTML = `${globe}<span class="language-name">${current[0]}</span><span class="language-region">${current[1]}</span>`;

    const overlay = document.createElement('div');
    overlay.className = 'language-overlay';
    overlay.setAttribute('aria-hidden', 'true');
    overlay.innerHTML = `
      <section class="language-dialog" role="dialog" aria-modal="true" aria-labelledby="language-title">
        <header class="language-dialog-header">
          <h2 id="language-title" class="language-dialog-title">Select language</h2>
          <button class="language-close" type="button" aria-label="Close language selector">${close}</button>
        </header>
        <div class="language-list" role="radiogroup" aria-label="Languages"></div>
        <div class="language-search-wrap">
          <label class="language-search">${searchIcon}<input type="search" aria-label="Search languages" placeholder="Search"></label>
        </div>
      </section>`;
    document.body.appendChild(overlay);

    const list = overlay.querySelector('.language-list');
    const input = overlay.querySelector('input');
    const closeButton = overlay.querySelector('.language-close');

    const render = (query = '') => {
      const normalized = query.trim().toLowerCase();
      list.innerHTML = '';
      languages
        .filter(([name, region]) => `${name} ${region}`.toLowerCase().includes(normalized))
        .forEach(([name, region, code]) => {
          const option = document.createElement('button');
          option.type = 'button';
          option.className = 'language-option';
          option.setAttribute('role', 'radio');
          option.setAttribute('aria-checked', String(code === (localStorage.getItem('signaturesi-language') || stored)));
          option.innerHTML = `<span><strong>${name}${region && name !== region ? ` <span style="color:rgba(17,17,19,.48);font-weight:520">${region}</span>` : ''}</strong><small>${name}${region ? ` · ${region}` : ''}</small></span><span class="language-check">${check}</span>`;
          option.addEventListener('click', () => {
            localStorage.setItem('signaturesi-language', code);
            document.documentElement.lang = code;
            trigger.innerHTML = `${globe}<span class="language-name">${name}</span><span class="language-region">${region}</span>`;
            render(input.value);
            closeDialog();
          });
          list.appendChild(option);
        });
    };

    const openDialog = () => {
      overlay.classList.add('is-open');
      overlay.setAttribute('aria-hidden', 'false');
      document.body.classList.add('language-modal-open');
      window.setTimeout(() => input.focus(), 80);
    };
    const closeDialog = () => {
      overlay.classList.remove('is-open');
      overlay.setAttribute('aria-hidden', 'true');
      document.body.classList.remove('language-modal-open');
      trigger.focus();
    };

    trigger.addEventListener('click', openDialog);
    closeButton.addEventListener('click', closeDialog);
    overlay.addEventListener('click', (event) => { if (event.target === overlay) closeDialog(); });
    input.addEventListener('input', () => render(input.value));
    document.addEventListener('keydown', (event) => { if (event.key === 'Escape' && overlay.classList.contains('is-open')) closeDialog(); });
    render();
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
