(() => {
  "use strict";

  const MAX_FILES = 5;
  const MAX_FILE_SIZE = 4 * 1024 * 1024;

  const state = {
    user: null,
    plan: "free",
    model: "l1.0",
    personality: "balanced",
    deepResearch: false,
    conversationId: null,
    messages: [],
    files: [],
    generating: false,
    ready: false,
    historySearch: ""
  };

  const personalities = {
    balanced: "Balanced",
    researcher: "Researcher",
    strategist: "Strategist",
    creative: "Creative",
    teacher: "Teacher",
    coding_expert: "Coding Expert",
    business_advisor: "Business Advisor",
    deep_thinker: "Deep Thinker",
    warm_companion: "Warm Companion"
  };

  const $ = id => document.getElementById(id);

  const dom = {
    sidebar: $("sidebar"),
    sidebarScrim: $("sidebarScrim"),
    sidebarToggle: $("sidebarToggleBtn"),
    sidebarClose: $("collapseSidebarBtn"),

    history: $("historyList"),
    historySearch: $("historySearchInput"),
    clearHistorySearch: $("clearHistorySearchBtn"),

    newChat: $("newChatBtn"),
    profile: $("userProfileBtn"),
    profileMenu: $("userPopupMenu"),
    avatar: $("userAvatar"),
    username: $("userNameDisplay"),
    planBadge: $("userPlanBadge"),

    themeTop: $("topBarDarkModeToggle"),
    themeSide: $("sidebarDarkModeToggle"),
    logout: $("logoutBtn"),

    modelBadge: $("modelBadgeBtn"),
    modelMenu: $("modelDropdownMenu"),
    modelText: $("currentModelDisplay"),
    modelL10: $("optL10"),
    modelL12: $("optL12"),

    scroll: $("scrollArea"),
    hero: $("heroSection"),
    messages: $("chatMessages"),

    input: $("chatInput"),
    send: $("sendBtn"),
    composer: $("glassInputContainer"),
    composerWrapper: $("composerWrapper"),

    attached: $("attachedChipsWrapper"),
    suggestions: $("liveSuggestions"),

    attach: $("attachBtn"),
    attachMenu: $("attachPopupMenu"),
    addFiles: $("addFilesMenuBtn"),
    fileInput: $("hiddenFileInput"),
    dropOverlay: $("dragDropOverlay"),

    deepResearch: $("deepResearchToggleBtn"),
    personalities: $("neoPersonalitiesBtn"),
    personalityModal: $("personalityModal"),
    personalityClose: $("personalityModalCloseBtn"),

    upgradeModal: $("upgradeModal"),
    upgradeClose: $("modalCloseBtn"),
    upgradeLater: $("modalMaybeLaterBtn"),
    upgradeAction: $("upgradeActionBtn"),

    mic: $("micBtn"),
    stopMic: $("stopRecBtn"),

    historyMenu: $("historyPopupMenu"),
    deleteHistory: $("hpDeleteBtn")
  };

  let activeHistoryId = null;
  let recognition = null;

  function toast(message, tone = "info") {
    const element = document.createElement("div");
    element.className = `neo-toast neo-toast-${tone}`;
    element.textContent = message;

    document.body.appendChild(element);

    requestAnimationFrame(() => element.classList.add("show"));

    window.setTimeout(() => {
      element.classList.remove("show");
      window.setTimeout(() => element.remove(), 220);
    }, 3600);
  }

  function escapeHtml(value) {
    const element = document.createElement("div");
    element.textContent = String(value || "");
    return element.innerHTML;
  }

  function markdown(value) {
    const text = String(value || "");

    if (!window.marked || !window.DOMPurify) {
      return escapeHtml(text).replace(/\n/g, "<br>");
    }

    try {
      return window.DOMPurify.sanitize(window.marked.parse(text), {
        USE_PROFILES: { html: true },
        FORBID_TAGS: [
          "script",
          "style",
          "iframe",
          "object",
          "embed",
          "form",
          "input",
          "button",
          "textarea",
          "select"
        ],
        FORBID_ATTR: [
          "style",
          "srcdoc",
          "formaction",
          "onerror",
          "onload",
          "onclick",
          "onmouseover",
          "onfocus"
        ]
      });
    } catch {
      return escapeHtml(text).replace(/\n/g, "<br>");
    }
  }

  async function json(response) {
    const data = await response.json().catch(() => ({}));

    if (response.status === 401) {
      window.location.replace("signup.html");
      throw new Error("Your session has expired. Please log in again.");
    }

    if (!response.ok) {
      throw new Error(
        typeof data?.error === "string"
          ? data.error
          : data?.error?.message || "The request failed."
      );
    }

    return data;
  }

  function isPro() {
    return state.plan === "pro";
  }

  function applyTheme() {
    document.body.classList.toggle(
      "dark-mode",
      localStorage.getItem("neo_theme") === "dark"
    );
  }

  function toggleTheme() {
    const dark = !document.body.classList.contains("dark-mode");

    document.body.classList.toggle("dark-mode", dark);
    localStorage.setItem("neo_theme", dark ? "dark" : "light");
  }

  function setSidebar(open) {
    if (!dom.sidebar) return;

    dom.sidebar.classList.toggle("collapsed", !open);
    document.body.classList.toggle("sidebar-collapsed", !open);

    dom.sidebarScrim?.classList.toggle(
      "visible",
      open && window.innerWidth < 768
    );

    if (window.innerWidth >= 768) {
      localStorage.setItem(
        "neo_desktop_sidebar",
        open ? "open" : "collapsed"
      );
    }
  }

  function initialiseSidebar() {
    if (window.innerWidth < 768) {
      setSidebar(false);
      return;
    }

    setSidebar(localStorage.getItem("neo_desktop_sidebar") !== "collapsed");
  }

  function updateComposer() {
    const hasText = Boolean(dom.input?.value.trim());
    const multiline = Boolean(dom.input && dom.input.scrollHeight > 38);

    dom.composer?.classList.toggle(
      "is-expanded",
      hasText || multiline || state.files.length > 0
    );
  }

  function scrollToBottom() {
    if (dom.scroll) dom.scroll.scrollTop = dom.scroll.scrollHeight;
  }

  function renderSuggestions() {
    if (!dom.suggestions) return;

    const items = state.files.length
      ? [
          {
            icon: "search",
            label: "Summarize / Describe",
            prompt: "Analyze and describe the attached files."
          }
        ]
      : [
          {
            icon: "search",
            label: "Research",
            prompt: "Research on: "
          },
          {
            icon: "lightbulb",
            label: "Brainstorm",
            prompt: "Brainstorm ideas for: "
          }
        ];

    dom.suggestions.innerHTML = "";

    items.forEach(item => {
      const button = document.createElement("button");

      button.className = "suggestion-chip";
      button.type = "button";
      button.innerHTML = `
        <i data-lucide="${item.icon}" size="14"></i>
        <span>${item.label}</span>
      `;

      button.addEventListener("click", () => {
        if (!dom.input) return;

        dom.input.value = item.prompt;
        dom.input.focus();
        updateComposer();
      });

      dom.suggestions.appendChild(button);
    });

    window.lucide?.createIcons();
  }

  function renderFiles() {
    if (!dom.attached) return;

    dom.attached.innerHTML = "";

    state.files.forEach(item => {
      const element = document.createElement("div");

      const remove = () => {
        state.files = state.files.filter(file => file.id !== item.id);
        renderFiles();
        renderSuggestions();
        updateComposer();
      };

      if (item.category === "image") {
        element.className = "image-preview-chip";

        element.innerHTML = `
          <img src="${item.data}" alt="">
          <button class="chip-remove-btn" type="button" aria-label="Remove image">×</button>
        `;

        element.querySelector("button")?.addEventListener("click", remove);
      } else {
        element.className = "file-chip";

        element.innerHTML = `
          <i data-lucide="${item.category === "code" ? "code" : "file-text"}" size="14"></i>
          <span></span>
          <button class="file-chip-remove" type="button" aria-label="Remove file">×</button>
        `;

        element.querySelector("span").textContent = item.name;
        element.querySelector("button")?.addEventListener("click", remove);
      }

      dom.attached.appendChild(element);
    });

    window.lucide?.createIcons();
  }

  function supportedFile(file) {
    const type = String(file?.type || "").toLowerCase();
    const extension = String(file?.name || "")
      .split(".")
      .pop()
      .toLowerCase();

    const types = [
      "image/jpeg",
      "image/png",
      "image/webp",
      "application/pdf",
      "text/plain"
    ];

    const extensions = ["jpg", "jpeg", "png", "webp", "pdf", "txt"];

    return types.includes(type) && extensions.includes(extension);
  }

  function readFile(file, image) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();

      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error("Unable to read file."));

      if (image) {
        reader.readAsDataURL(file);
      } else {
        reader.readAsText(file);
      }
    });
  }

  async function addFiles(files) {
    for (const file of files) {
      if (!supportedFile(file)) {
        toast(
          `File "${file.name}" is not supported. Use JPG, PNG, WebP, PDF, or TXT.`,
          "error"
        );
        continue;
      }

      if (state.files.length >= MAX_FILES) {
        toast(`Maximum ${MAX_FILES} files allowed.`, "error");
        break;
      }

      if (file.size > MAX_FILE_SIZE) {
        toast(`File "${file.name}" exceeds 4MB limit.`, "error");
        continue;
      }

      const image = file.type.startsWith("image/");
      const extension = file.name.split(".").pop().toLowerCase();

      const category = image
        ? "image"
        : ["js", "ts", "py", "java", "html", "css", "json", "cpp"].includes(extension)
          ? "code"
          : "document";

      state.files.push({
        id: `file_${crypto.randomUUID?.() || Math.random().toString(36).slice(2)}`,
        name: file.name,
        category,
        data: await readFile(file, image)
      });
    }

    renderFiles();
    renderSuggestions();
    updateComposer();
  }

  function renderMessage(role, content, thinking = false) {
    const message = document.createElement("div");

    message.className = `message ${role}${thinking ? " is-thinking" : ""}`;

    if (role === "user") {
      message.innerHTML = `
        <div class="message-wrapper">
          <div class="message-content"></div>
        </div>
      `;

      message.querySelector(".message-content").textContent = content;
    } else {
      message.innerHTML = `
        <div class="message-content">
          ${
            thinking
              ? '<span class="thinking-shimmer">Thinking...</span>'
              : markdown(content)
          }
        </div>
      `;
    }

    dom.messages?.appendChild(message);
    scrollToBottom();

    return message;
  }

  function setThinkingError(element, error) {
    element?.classList.remove("is-thinking");

    const content = element?.querySelector(".message-content");

    if (content) {
      content.textContent = `Error: ${
        error?.message || "Unable to complete this request."
      }`;

      content.style.color = "#ef4444";
    }
  }

  function selectedPersonality() {
    return personalities[state.personality]
      ? state.personality
      : "balanced";
  }

  function syncPersonality() {
    document.querySelectorAll("[data-neo-personality]").forEach(button => {
      const active =
        button.dataset.neoPersonality === selectedPersonality();

      button.classList.toggle("is-selected", active);
      button.setAttribute("aria-selected", String(active));
    });
  }

  function closePersonalityModal() {
    dom.personalityModal?.classList.remove("show");
    dom.personalityModal?.setAttribute("aria-hidden", "true");
  }

  function openPersonalityModal() {
    syncPersonality();
    dom.personalityModal?.classList.add("show");
    dom.personalityModal?.setAttribute("aria-hidden", "false");
  }

  async function loadHistory() {
    if (!dom.history) return;

    try {
      const response = await fetch("/api/history", {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json"
        },
        body: JSON.stringify({
          action: "list",
          limit: 100
        })
      });

      const data = await json(response);

      const conversations = Array.isArray(data.conversations)
        ? data.conversations
        : [];

      const visible = state.historySearch
        ? conversations.filter(item =>
            String(item.title || "")
              .toLowerCase()
              .includes(state.historySearch)
          )
        : conversations;

      dom.history.innerHTML = "";

      if (!visible.length) {
        dom.history.textContent = conversations.length
          ? "No matching chats"
          : "No recent chats";

        dom.history.style.cssText =
          "padding:10px;color:var(--text-muted);font-size:12px";

        return;
      }

      dom.history.removeAttribute("style");

      visible.forEach(item => {
        const row = document.createElement("div");

        row.className = `history-item${
          state.conversationId === item.id ? " active" : ""
        }`;

        row.innerHTML = `
          <span class="history-item-title"></span>
          <div class="history-item-actions">
            <button class="history-action-btn" type="button" aria-label="Conversation options">
              <i data-lucide="more-horizontal" size="14"></i>
            </button>
          </div>
        `;

        row.querySelector(".history-item-title").textContent =
          item.title || "New Chat";

        row.addEventListener("click", () => {
          loadConversation(item.id);
        });

        row.querySelector("button")?.addEventListener("click", event => {
          event.stopPropagation();

          activeHistoryId = item.id;

          const rect = event.currentTarget.getBoundingClientRect();

          if (dom.historyMenu) {
            dom.historyMenu.style.top = `${rect.bottom}px`;
            dom.historyMenu.style.left = `${rect.left}px`;
            dom.historyMenu.classList.add("show");
          }
        });

        dom.history.appendChild(row);
      });

      window.lucide?.createIcons();
    } catch (error) {
      console.error("History load failed:", error);
    }
  }

  async function loadConversation(id) {
    try {
      const response = await fetch("/api/history", {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json"
        },
        body: JSON.stringify({
          action: "get",
          conversationId: id
        })
      });

      const data = await json(response);

      state.conversationId = id;

      state.messages = (data.messages || []).map(item => ({
        role: item.role,
        content: item.content || ""
      }));

      if (dom.messages) dom.messages.innerHTML = "";
      if (dom.hero) dom.hero.style.display = "none";

      state.messages.forEach(item => {
        if (item.role !== "system") {
          renderMessage(item.role, item.content);
        }
      });

      await loadHistory();

      if (window.innerWidth < 768) {
        setSidebar(false);
      }
    } catch (error) {
      toast(error.message, "error");
    }
  }

  function startNewChat() {
    state.messages = [];
    state.files = [];
    state.conversationId = null;
    activeHistoryId = null;

    if (dom.messages) dom.messages.innerHTML = "";
    if (dom.hero) dom.hero.style.display = "block";

    renderFiles();
    renderSuggestions();
    updateComposer();
    loadHistory();
  }

  async function sendMessage() {
    if (!state.ready || state.generating) return;

    const text = dom.input?.value.trim() || "";

    if (!text && !state.files.length) return;

    state.generating = true;

    const pendingFiles = [...state.files];
    let content = text;

    if (pendingFiles.length) {
      content = `${text}

${pendingFiles
  .map(file => `[Attached ${file.category}: ${file.name}]
${file.data}`)
  .join("\n\n")}`.trim();
    }

    if (content.length > 120000) {
      state.generating = false;
      toast("The message and attached files are too large.", "error");
      return;
    }

    if (dom.input) {
      dom.input.value = "";
      dom.input.style.height = "auto";
    }

    if (dom.hero) dom.hero.style.display = "none";

    renderMessage(
      "user",
      text || `[Uploaded ${pendingFiles.length} file(s)]`
    );

    state.messages.push({
      role: "user",
      content
    });

    state.files = [];

    renderFiles();
    renderSuggestions();
    updateComposer();

    const thinking = renderMessage("assistant", "", true);

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json"
        },
        body: JSON.stringify({
          messages: state.messages,
          conversationId: state.conversationId,
          model: state.model,
          isDeepResearch: state.deepResearch,
          personality: selectedPersonality()
        })
      });

      const data = await json(response);

      const reply = String(
        data.reply || data?.choices?.[0]?.message?.content || ""
      ).trim();

      if (!reply) {
        throw new Error("The AI response was empty.");
      }

      state.conversationId =
        typeof data.conversationId === "string"
          ? data.conversationId
          : state.conversationId;

      thinking.classList.remove("is-thinking");

      const output = thinking.querySelector(".message-content");

      if (output) {
        output.innerHTML = markdown(reply);
      }

      state.messages.push({
        role: "assistant",
        content: reply
      });

      await loadHistory();
    } catch (error) {
      setThinkingError(thinking, error);

      state.files = pendingFiles;
      renderFiles();
      renderSuggestions();
      updateComposer();
    } finally {
      state.generating = false;
      window.lucide?.createIcons();
    }
  }

  async function startCheckout() {
    if (!dom.upgradeAction) return;

    const original = dom.upgradeAction.textContent;

    dom.upgradeAction.disabled = true;
    dom.upgradeAction.textContent = "Opening secure checkout...";

    try {
      const response = await fetch("/api/checkout", {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json"
        },
        body: "{}"
      });

      const data = await json(response);

      if (!data.url) {
        throw new Error("Checkout URL was not returned.");
      }

      window.location.assign(data.url);
    } catch (error) {
      toast(error.message || "Checkout could not be opened.", "error");
    } finally {
      dom.upgradeAction.disabled = false;
      dom.upgradeAction.textContent = original;
    }
  }

  function setupSpeech() {
    const SpeechRecognition =
      window.SpeechRecognition || window.webkitSpeechRecognition;

    if (!SpeechRecognition) return;

    recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = "en-US";

    recognition.onstart = () => {
      document
        .querySelector(".composer-input-row")
        ?.classList.add("is-transcribing");
    };

    recognition.onend = recognition.onerror = () => {
      document
        .querySelector(".composer-input-row")
        ?.classList.remove("is-transcribing");
    };

    recognition.onresult = event => {
      const text = Array.from(event.results)
        .map(result => result[0].transcript)
        .join("");

      if (dom.input) dom.input.value = text;

      updateComposer();
    };

    dom.mic?.addEventListener("click", () => {
      try {
        recognition.start();
      } catch {
        recognition.stop();
      }
    });

    dom.stopMic?.addEventListener("click", () => {
      recognition.stop();
    });
  }

  async function restoreSession() {
    const response = await fetch("/api/auth", {
      method: "GET",
      credentials: "include",
      headers: {
        Accept: "application/json"
      }
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok || !data.authenticated || !data.user) {
      window.location.replace("signup.html");
      return false;
    }

    const plan = String(data.user.planType || "free").toLowerCase();

    state.plan = [
      "pro",
      "neo_pro",
      "neo-pro",
      "premium",
      "business",
      "suite"
    ].includes(plan)
      ? "pro"
      : "free";

    state.user = data.user;

    return true;
  }

  async function renderProfile() {
    const username = String(state.user?.username || "user")
      .replace(/^@/, "")
      .replace(/@bean$/i, "");

    if (dom.username) {
      dom.username.textContent = `@${username}`;
    }

    if (dom.planBadge) {
      dom.planBadge.textContent = isPro() ? "Pro Plan" : "Free Plan";
    }

    if (dom.avatar) {
      dom.avatar.textContent = username.charAt(0).toUpperCase() || "U";
    }
  }

  async function logout() {
    try {
      await fetch("/api/auth", {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          action: "logout"
        })
      });
    } finally {
      window.location.replace("signup.html");
    }
  }

  function setupEvents() {
    applyTheme();

    dom.themeTop?.addEventListener("click", toggleTheme);
    dom.themeSide?.addEventListener("click", toggleTheme);

    dom.sidebarToggle?.addEventListener("click", () => {
      setSidebar(true);
    });

    dom.sidebarClose?.addEventListener("click", () => {
      setSidebar(false);
    });

    dom.sidebarScrim?.addEventListener("click", () => {
      setSidebar(false);
    });

    dom.newChat?.addEventListener("click", startNewChat);

    dom.profile?.addEventListener("click", event => {
      event.stopPropagation();
      dom.profileMenu?.classList.toggle("show");
    });

    dom.logout?.addEventListener("click", logout);

    dom.modelBadge?.addEventListener("click", event => {
      event.stopPropagation();
      dom.modelMenu?.classList.toggle("show");
    });

    dom.modelL10?.addEventListener("click", () => {
      state.model = "l1.0";

      if (dom.modelText) {
        dom.modelText.textContent = "NEO L1.0";
      }

      dom.modelL10.classList.add("active");
      dom.modelL12?.classList.remove("active");
      dom.modelMenu?.classList.remove("show");
    });

    dom.modelL12?.addEventListener("click", () => {
      dom.modelMenu?.classList.remove("show");

      if (!isPro()) {
        dom.upgradeModal?.classList.add("show");
        return;
      }

      state.model = "l1.2";

      if (dom.modelText) {
        dom.modelText.textContent = "NEO L1.2 Pro";
      }

      dom.modelL12.classList.add("active");
      dom.modelL10?.classList.remove("active");
    });

    dom.input?.addEventListener("input", () => {
      dom.input.style.height = "auto";
      dom.input.style.height = `${Math.min(dom.input.scrollHeight, 160)}px`;

      updateComposer();
    });

    dom.input?.addEventListener("keydown", event => {
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        sendMessage();
      }
    });

    dom.send?.addEventListener("click", sendMessage);

    document.querySelectorAll("[data-prompt]").forEach(button => {
      button.addEventListener("click", () => {
        if (dom.input) {
          dom.input.value = button.dataset.prompt || "";
        }

        sendMessage();
      });
    });

    dom.attach?.addEventListener("click", event => {
      event.stopPropagation();
      dom.attachMenu?.classList.toggle("show");
    });

    dom.addFiles?.addEventListener("click", () => {
      dom.attachMenu?.classList.remove("show");
      dom.fileInput?.click();
    });

    dom.fileInput?.addEventListener("change", event => {
      addFiles(Array.from(event.target.files || []));
      event.target.value = "";
    });

    dom.input?.addEventListener("paste", event => {
      const files = Array.from(event.clipboardData?.items || [])
        .filter(item => item.kind === "file")
        .map(item => item.getAsFile())
        .filter(Boolean);

      if (files.length) {
        addFiles(files);
      }
    });

    ["dragenter", "dragover", "dragleave", "drop"].forEach(name => {
      dom.composerWrapper?.addEventListener(name, event => {
        event.preventDefault();
        event.stopPropagation();
      });
    });

    dom.composerWrapper?.addEventListener("dragenter", () => {
      dom.dropOverlay?.classList.add("active");
    });

    dom.composerWrapper?.addEventListener("dragover", () => {
      dom.dropOverlay?.classList.add("active");
    });

    dom.dropOverlay?.addEventListener("dragleave", () => {
      dom.dropOverlay?.classList.remove("active");
    });

    dom.composerWrapper?.addEventListener("drop", event => {
      dom.dropOverlay?.classList.remove("active");

      addFiles(Array.from(event.dataTransfer?.files || []));
    });

    dom.deepResearch?.addEventListener("click", () => {
      if (!isPro()) {
        dom.upgradeModal?.classList.add("show");
        return;
      }

      state.deepResearch = !state.deepResearch;

      dom.deepResearch.classList.toggle(
        "active-mode",
        state.deepResearch
      );
    });

    dom.personalities?.addEventListener("click", () => {
      dom.attachMenu?.classList.remove("show");
      openPersonalityModal();
    });

    dom.personalityClose?.addEventListener(
      "click",
      closePersonalityModal
    );

    dom.personalityModal?.addEventListener("click", event => {
      if (event.target === dom.personalityModal) {
        closePersonalityModal();
      }
    });

    document.querySelectorAll("[data-neo-personality]").forEach(button => {
      button.addEventListener("click", () => {
        const personality = button.dataset.neoPersonality;

        if (!personalities[personality]) return;

        state.personality = personality;
        localStorage.setItem("neo_personality", personality);

        syncPersonality();
        closePersonalityModal();

        toast(`${personalities[personality]} personality selected.`);
      });
    });

    dom.upgradeClose?.addEventListener("click", () => {
      dom.upgradeModal?.classList.remove("show");
    });

    dom.upgradeLater?.addEventListener("click", () => {
      dom.upgradeModal?.classList.remove("show");
    });

    dom.upgradeModal?.addEventListener("click", event => {
      if (event.target === dom.upgradeModal) {
        dom.upgradeModal.classList.remove("show");
      }
    });

    dom.upgradeAction?.addEventListener("click", startCheckout);

    dom.historySearch?.addEventListener("input", event => {
      state.historySearch = String(event.target.value || "")
        .trim()
        .toLowerCase();

      if (dom.clearHistorySearch) {
        dom.clearHistorySearch.hidden = !state.historySearch;
      }

      loadHistory();
    });

    dom.clearHistorySearch?.addEventListener("click", () => {
      if (dom.historySearch) {
        dom.historySearch.value = "";
      }

      state.historySearch = "";

      if (dom.clearHistorySearch) {
        dom.clearHistorySearch.hidden = true;
      }

      loadHistory();
    });

    dom.deleteHistory?.addEventListener("click", async () => {
      if (!activeHistoryId) return;

      try {
        const response = await fetch("/api/history", {
          method: "POST",
          credentials: "include",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            action: "delete",
            conversationId: activeHistoryId
          })
        });

        await json(response);

        if (state.conversationId === activeHistoryId) {
          startNewChat();
        } else {
          loadHistory();
        }
      } catch (error) {
        toast(error.message, "error");
      } finally {
        activeHistoryId = null;
        dom.historyMenu?.classList.remove("show");
      }
    });

    document.addEventListener("click", event => {
      if (
        !dom.profile?.contains(event.target) &&
        !dom.profileMenu?.contains(event.target)
      ) {
        dom.profileMenu?.classList.remove("show");
      }

      if (
        !dom.attach?.contains(event.target) &&
        !dom.attachMenu?.contains(event.target)
      ) {
        dom.attachMenu?.classList.remove("show");
      }

      if (
        !dom.modelBadge?.contains(event.target) &&
        !dom.modelMenu?.contains(event.target)
      ) {
        dom.modelMenu?.classList.remove("show");
      }

      if (
        !dom.historyMenu?.contains(event.target) &&
        !event.target.closest(".history-action-btn")
      ) {
        dom.historyMenu?.classList.remove("show");
      }
    });

    window.addEventListener("resize", initialiseSidebar, {
      passive: true
    });

    $("brandBtn")?.addEventListener("click", () => {
      window.location.href = "index.html";
    });

    setupSpeech();
  }

  async function init() {
    window.lucide?.createIcons();

    state.personality =
      localStorage.getItem("neo_personality") || "balanced";

    if (!personalities[state.personality]) {
      state.personality = "balanced";
    }

    initialiseSidebar();
    setupEvents();
    renderSuggestions();
    updateComposer();
    syncPersonality();

    if (!await restoreSession()) return;

    state.ready = true;

    await renderProfile();
    await loadHistory();

    dom.input?.focus();
  }

  document.addEventListener("DOMContentLoaded", () => {
    init().catch(error => {
      console.error("NEO initialization failed:", error);

      if (dom.input) {
        dom.input.placeholder =
          "NEO could not initialize. Please refresh.";
      }
    });
  });
})();
