// neo.js – Complete Frontend Application (All Fixes Included)

(function () {
    "use strict";

    // ============================================================
    // CONSTANTS
    // ============================================================
    const MAX_FILE_SIZE_BYTES = 4 * 1024 * 1024;
    const MAX_ATTACHED_FILES = 5;
    const MEDIA_BUCKET = "uploads";
    const SIGNED_URL_EXPIRY_SECONDS = 300;
    const MEDIA_UPLOAD_TIMEOUT_MS = 60_000;

    const SUPABASE_URL = "https://ujclhweqqifgoiscvqmd.supabase.co";
    const SUPABASE_ANON_KEY = "sb_publishable_soPYxakWGl9MTrzCjdjt2w_fR1jsVVf";

    // ============================================================
    // STATE
    // ============================================================
    let currentUser = { id: null, username: "user" };
    let conversation = [];
    let attachedFiles = [];
    let currentConversationId = null;
    let isGenerating = false;
    let activePopupChatId = null;
    let isDeepResearchMode = false;
    let recognition = null;
    let isListening = false;

    let audioCtx = null, analyser = null, micStream = null, animFrameId = null;
    let selectedModel = "l1.0";
    let userPlan = "free";

    // Temporary preview storage (cleared on page unload)
    const sessionMediaPreviews = new Map();

    // ============================================================
    // DOM ELEMENTS (with null‑safety)
    // ============================================================
    const $ = (id) => document.getElementById(id);
    const chatInput = $("chatInput");
    const sendBtn = $("sendBtn");
    const chatMessages = $("chatMessages");
    const scrollArea = $("scrollArea");
    const heroSection = $("heroSection");
    const historyList = $("historyList");
    const sidebar = $("sidebar");
    const sidebarToggleBtn = $("sidebarToggleBtn");
    const collapseSidebarBtn = $("collapseSidebarBtn");
    const newChatBtn = $("newChatBtn");
    const topBarDarkModeToggle = $("topBarDarkModeToggle");
    const sidebarDarkModeToggle = $("sidebarDarkModeToggle");
    const sidebarScrim = $("sidebarScrim");
    const userAvatar = $("userAvatar");
    const userNameDisplay = $("userNameDisplay");
    const userPlanBadge = $("userPlanBadge");
    const userProfileBtn = $("userProfileBtn");
    const userPopupMenu = $("userPopupMenu");
    const historyPopupMenu = $("historyPopupMenu");
    const hpDeleteBtn = $("hpDeleteBtn");
    const hpShareBtn = $("hpShareBtn");
    const hpPinBtn = $("hpPinBtn");
    const hpRenameBtn = $("hpRenameBtn");

    const attachBtn = $("attachBtn");
    const attachPopupMenu = $("attachPopupMenu");
    const addFilesMenuBtn = $("addFilesMenuBtn");
    const deepResearchToggleBtn = $("deepResearchToggleBtn");
    const personalMemoryBtn = $("personalMemoryBtn");
    const hiddenFileInput = $("hiddenFileInput");
    const liveSuggestions = $("liveSuggestions");
    const attachedChipsWrapper = $("attachedChipsWrapper");
    const composerWrapper = $("composerWrapper");
    const dragDropOverlay = $("dragDropOverlay");
    const micBtn = $("micBtn");
    const stopRecBtn = $("stopRecBtn");
    const composerInputRow = document.querySelector(".composer-input-row");
    const glassInputContainer = $("glassInputContainer");

    const modelBadgeBtn = $("modelBadgeBtn");
    const modelDropdownMenu = $("modelDropdownMenu");
    const currentModelDisplay = $("currentModelDisplay");
    const optL10 = $("optL10");
    const optL12 = $("optL12");
    const upgradeModal = $("upgradeModal");
    const modalCloseBtn = $("modalCloseBtn");
    const modalMaybeLaterBtn = $("modalMaybeLaterBtn");
    const upgradeActionBtn = $("upgradeActionBtn");

    const neoSettingsOverlay = $("neoSettingsOverlay");
    const sidebarPersonalitiesBtn = $("sidebarPersonalitiesBtn");

    // Settings UI
    const settingsCloseBtn = $("settingsCloseBtn");
    const settingsTabs = document.querySelectorAll(".neo-settings-tab");
    const settingsPanels = document.querySelectorAll(".neo-settings-panel");
    const settingsSaveBtn = $("settingsSaveBtn");
    const settingsResetBtn = $("settingsResetBtn");
    const settingsBillingBtn = $("settingsBillingBtn");
    const settingsThemeBtn = $("settingsThemeBtn");

    // ============================================================
    //  INIT
    // ============================================================
    async function init() {
        if (window.lucide) window.lucide.createIcons();
        setupTheme();
        configureSecurityHooks();
        initializeSidebarState();
        setupEventListeners();
        setupFreemiumLogic();
        setupDragAndDrop();
        setupPasteUpload();
        setupSpeechRecognition();
        renderAdaptiveSuggestions();
        updateComposerShape();
        setupSettingsUI();

        const authenticated = await restoreSecureSession();
        if (!authenticated) return;

        try {
            await renderUserProfile();
        } catch (error) {
            console.warn("Profile init failed:", error);
        }
        try {
            await loadHistoryFromSupabase();
        } catch (error) {
            console.warn("History init failed:", error);
        }

        chatInput?.focus();
    }

    // ============================================================
    //  SESSION & AUTH
    // ============================================================
    async function restoreSecureSession() {
        try {
            const res = await fetch("/api/auth", {
                method: "GET",
                credentials: "include",
                headers: { Accept: "application/json" },
                cache: "no-store"
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok || !data.authenticated || !data.user) {
                clearLegacyUserStorage();
                window.location.replace("signup.html");
                return false;
            }
            const rawPlan = String(data.user.planType || "free").trim().toLowerCase();
            userPlan = ["pro", "neo_pro", "neo-pro", "premium", "business", "suite"].includes(rawPlan)
                ? "pro" : "free";
            currentUser = {
                id: data.user.id,
                username: data.user.username || "user",
                planType: userPlan
            };
            localStorage.setItem("signaturesi_user", JSON.stringify(currentUser));
            return true;
        } catch (error) {
            console.error("Session restore failed:", error);
            window.location.replace("signup.html");
            return false;
        }
    }

    function clearLegacyUserStorage() {
        localStorage.removeItem("signaturesi_user");
        localStorage.removeItem("bean_user");
        localStorage.removeItem("user");
        localStorage.removeItem("userData");
    }

    // ============================================================
    //  SECURITY & THEME
    // ============================================================
    function configureSecurityHooks() {
        if (!window.DOMPurify) return;
        window.DOMPurify.addHook("afterSanitizeAttributes", function (node) {
            if ("target" in node) {
                node.setAttribute("target", "_blank");
                node.setAttribute("rel", "noopener noreferrer");
            }
        });
    }

    function setupTheme() {
        const isDark = localStorage.getItem("neo_theme") === "dark";
        document.body.classList.toggle("dark-mode", isDark);
        const toggle = () => {
            document.body.classList.toggle("dark-mode");
            localStorage.setItem("neo_theme", document.body.classList.contains("dark-mode") ? "dark" : "light");
        };
        topBarDarkModeToggle?.addEventListener("click", toggle);
        sidebarDarkModeToggle?.addEventListener("click", toggle);
    }

    // ============================================================
    //  SANITIZATION
    // ============================================================
    function sanitizeHTML(value) {
        const el = document.createElement("div");
        el.textContent = String(value || "");
        return el.innerHTML;
    }

    function safeParseMarkdown(text) {
        const source = String(text || "");
        if (window.marked && window.DOMPurify) {
            try {
                const parsed = window.marked.parse(source);
                return window.DOMPurify.sanitize(parsed, {
                    USE_PROFILES: { html: true },
                    FORBID_TAGS: ["script", "style", "iframe", "object", "embed", "form", "input", "button", "textarea", "select", "option"],
                    FORBID_ATTR: ["style", "srcdoc", "formaction", "onerror", "onload", "onclick", "onmouseover", "onfocus"]
                });
            } catch {
                return sanitizeHTML(source).replace(/\n/g, "<br>");
            }
        }
        return sanitizeHTML(source).replace(/\n/g, "<br>");
    }

    // ============================================================
    //  API HELPER
    // ============================================================
    async function readJsonResponse(response) {
        const data = await response.json().catch(() => ({}));
        if (response.status === 401) {
            clearLegacyUserStorage();
            window.location.replace("signup.html");
            throw new Error("Session expired. Please log in again.");
        }
        if (!response.ok) {
            const msg = data?.error || data?.error?.message || "Request failed.";
            throw new Error(msg);
        }
        return data;
    }

    // ============================================================
    //  COMPOSER SHAPE
    // ============================================================
    function updateComposerShape() {
        if (!glassInputContainer) return;
        const hasText = Boolean(chatInput?.value.trim());
        const isMultiLine = Boolean(chatInput && chatInput.scrollHeight > 38);
        const hasFiles = attachedFiles.length > 0;
        glassInputContainer.classList.toggle("is-expanded", hasText || isMultiLine || hasFiles);
    }

    // ============================================================
    //  FREEMIUM LOGIC
    // ============================================================
    function setupFreemiumLogic() {
        modelBadgeBtn?.addEventListener("click", (e) => {
            e.stopPropagation();
            modelDropdownMenu?.classList.toggle("show");
        });

        optL10?.addEventListener("click", () => {
            selectedModel = "l1.0";
            if (currentModelDisplay) currentModelDisplay.textContent = "NEO L1.0";
            optL10.classList.add("active");
            optL12?.classList.remove("active");
            modelDropdownMenu?.classList.remove("show");
        });

        optL12?.addEventListener("click", () => {
            modelDropdownMenu?.classList.remove("show");
            if (userPlan === "free") {
                upgradeModal?.classList.add("show");
                return;
            }
            selectedModel = "l1.2";
            if (currentModelDisplay) currentModelDisplay.textContent = "NEO L1.2 Pro";
            optL12.classList.add("active");
            optL10?.classList.remove("active");
        });

        const closeModal = () => upgradeModal?.classList.remove("show");
        modalCloseBtn?.addEventListener("click", closeModal);
        modalMaybeLaterBtn?.addEventListener("click", closeModal);
        upgradeModal?.addEventListener("click", (e) => {
            if (e.target === upgradeModal) closeModal();
        });

        upgradeActionBtn?.addEventListener("click", async () => {
            const originalText = upgradeActionBtn.textContent;
            upgradeActionBtn.disabled = true;
            upgradeActionBtn.textContent = "Opening secure checkout...";
            try {
                const res = await fetch("/api/checkout", {
                    method: "POST",
                    credentials: "include",
                    cache: "no-store",
                    headers: { "Content-Type": "application/json", Accept: "application/json" },
                    body: JSON.stringify({})
                });
                const data = await res.json().catch(() => ({}));
                if (!res.ok || !data?.url) throw new Error(data?.error || "Checkout unavailable.");
                window.location.assign(data.url);
            } catch (error) {
                alert(error.message);
            } finally {
                upgradeActionBtn.disabled = false;
                upgradeActionBtn.textContent = originalText;
            }
        });
    }

    function checkFilePermissionForPlan(file) {
        const ext = file.name.split(".").pop().toLowerCase();
        if (["mp3", "wav", "mp4", "webm", "mov", "m4a"].includes(ext) && userPlan === "free") {
            upgradeModal?.classList.add("show");
            return false;
        }
        return true;
    }

    // ============================================================
    //  AUDIO VISUALIZER
    // ============================================================
    async function startAudioVisualizer() {
        try {
            micStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
            const AudioContextClass = window.AudioContext || window.webkitAudioContext;
            audioCtx = new AudioContextClass();
            analyser = audioCtx.createAnalyser();
            analyser.fftSize = 64;
            analyser.smoothingTimeConstant = 0.75;
            const source = audioCtx.createMediaStreamSource(micStream);
            source.connect(analyser);
            const waveSpans = document.querySelectorAll(".wave-dots-bar span");
            const dataArray = new Uint8Array(analyser.frequencyBinCount);
            function updateWave() {
                if (!isListening) return;
                analyser.getByteFrequencyData(dataArray);
                waveSpans.forEach((span, index) => {
                    const value = dataArray[index % dataArray.length] || 0;
                    const height = Math.max(4, Math.min(26, (value / 255) * 28));
                    span.style.height = `${height}px`;
                    span.style.opacity = value > 12 ? "1" : "0.4";
                    span.style.backgroundColor = value > 12 ? "var(--focus-ring)" : "var(--text-muted)";
                });
                animFrameId = requestAnimationFrame(updateWave);
            }
            updateWave();
        } catch (error) {
            console.warn("Microphone visualizer failed:", error);
        }
    }

    function stopAudioVisualizer() {
        if (animFrameId) { cancelAnimationFrame(animFrameId); animFrameId = null; }
        if (micStream) { micStream.getTracks().forEach(track => track.stop()); micStream = null; }
        if (audioCtx && audioCtx.state !== "closed") { audioCtx.close(); audioCtx = null; }
        const waveSpans = document.querySelectorAll(".wave-dots-bar span");
        waveSpans.forEach(span => {
            span.style.height = "4px";
            span.style.opacity = "0.4";
            span.style.backgroundColor = "var(--text-muted)";
        });
    }

    // ============================================================
    //  SPEECH RECOGNITION
    // ============================================================
    function setupSpeechRecognition() {
        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (!SpeechRecognition) return;
        try {
            recognition = new SpeechRecognition();
            recognition.continuous = true;
            recognition.interimResults = true;
            recognition.lang = "en-US";
            recognition.onstart = () => {
                isListening = true;
                composerInputRow?.classList.add("is-transcribing");
                startAudioVisualizer();
            };
            recognition.onresult = (event) => {
                const transcript = Array.from(event.results).map(result => result[0].transcript).join("");
                if (chatInput) {
                    chatInput.value = transcript;
                    chatInput.style.height = "auto";
                    chatInput.style.height = `${Math.min(chatInput.scrollHeight, 160)}px`;
                    updateComposerShape();
                }
            };
            recognition.onerror = stopListening;
            recognition.onend = stopListening;
            micBtn?.addEventListener("click", (e) => {
                e.stopPropagation();
                if (isListening) { recognition.stop(); return; }
                try { recognition.start(); } catch { stopListening(); }
            });
            stopRecBtn?.addEventListener("click", (e) => {
                e.stopPropagation();
                recognition?.stop();
                stopListening();
            });
        } catch (error) {
            console.warn("Speech recognition setup failed:", error);
        }
    }

    function stopListening() {
        isListening = false;
        composerInputRow?.classList.remove("is-transcribing");
        stopAudioVisualizer();
    }

    // ============================================================
    //  HISTORY LOADING
    // ============================================================
    async function loadHistoryFromSupabase() {
        if (!historyList) return;
        try {
            const res = await fetch("/api/history", {
                method: "GET",
                credentials: "include",
                cache: "no-store",
                headers: { Accept: "application/json" }
            });
            const data = await readJsonResponse(res);
            const conversations = data.conversations || [];
            historyList.innerHTML = "";
            conversations.forEach(item => {
                const row = document.createElement("button");
                row.type = "button";
                row.className = "history-item";
                row.textContent = item.title || "New conversation";
                row.addEventListener("click", () => loadChatMessages(item.id));
                row.addEventListener("contextmenu", (e) => {
                    e.preventDefault();
                    activePopupChatId = item.id;
                    historyPopupMenu.style.display = "block";
                    historyPopupMenu.classList.add("show");
                    historyPopupMenu.style.left = `${e.clientX}px`;
                    historyPopupMenu.style.top = `${e.clientY}px`;
                });
                historyList.appendChild(row);
            });
        } catch (error) {
            console.error("History load failed:", error);
        }
    }

    async function loadChatMessages(conversationId) {
        if (!conversationId) return;
        try {
            const res = await fetch("/api/history", {
                method: "POST",
                credentials: "include",
                headers: { "Content-Type": "application/json", Accept: "application/json" },
                cache: "no-store",
                body: JSON.stringify({ action: "get", conversationId })
            });
            const data = await readJsonResponse(res);
            currentConversationId = conversationId;
            conversation = (data.messages || []).map(msg => ({
                role: msg.role,
                content: msg.content || "",
                displayContent: typeof msg.displayContent === "string" ? msg.displayContent : msg.content || "",
                attachments: Array.isArray(msg.attachments) ? msg.attachments.map(serializeAttachment) : []
            }));
            chatMessages.innerHTML = "";
            if (heroSection) heroSection.style.display = "none";
            conversation.forEach((msg, idx) => {
                if (msg.role !== "system") {
                    const contentToRender = msg.role === "user" ? msg.displayContent : msg.content;
                    renderMessageToUI(msg.role, contentToRender, idx, false, msg.attachments || []);
                }
            });
            await loadHistoryFromSupabase();
            if (window.innerWidth < 768) {
                sidebar?.classList.add("collapsed");
                sidebarScrim?.classList.remove("visible");
                updateBodySidebarState();
            }
        } catch (error) {
            alert(error.message);
        }
    }

    // ============================================================
    //  RENDER MESSAGES (with image fallback)
    // ============================================================
    function renderMessageToUI(role, content, msgIndex = null, isThinking = false, attachments = []) {
        if (!chatMessages) return null;
        const message = document.createElement("div");
        message.className = `message ${role}${isThinking ? " is-thinking" : ""}`;
        if (msgIndex !== null) message.setAttribute("data-msg-index", String(msgIndex));

        if (role === "user") {
            renderUserMessageWrapper(message, content, msgIndex, attachments);
        } else {
            const contentEl = document.createElement("div");
            contentEl.className = "message-content";
            if (isThinking) {
                const span = document.createElement("span");
                span.className = "thinking-shimmer";
                span.textContent = "Thinking...";
                contentEl.appendChild(span);
            } else {
                contentEl.innerHTML = safeParseMarkdown(content);
            }
            message.appendChild(contentEl);
            const actions = document.createElement("div");
            actions.className = "message-actions";
            actions.innerHTML = `
                <button class="msg-action-btn copy-msg-btn" title="Copy"><i data-lucide="copy" size="16"></i></button>
                <button class="msg-action-btn share-msg-btn" title="Share"><i data-lucide="share-2" size="16"></i></button>
                <button class="msg-action-btn regen-msg-btn" title="Regenerate"><i data-lucide="rotate-cw" size="16"></i></button>
            `;
            message.appendChild(actions);
        }
        chatMessages.appendChild(message);
        if (scrollArea) scrollArea.scrollTop = scrollArea.scrollHeight;
        if (window.lucide) window.lucide.createIcons();
        return message;
    }

    function renderUserMessageWrapper(container, textContent, index, attachments = []) {
        container.innerHTML = "";
        const wrapper = document.createElement("div");
        wrapper.className = "message-wrapper";

        const content = document.createElement("div");
        content.className = "message-content";
        content.textContent = textContent || "";
        wrapper.appendChild(content);

        if (attachments && attachments.length > 0) {
            const grid = document.createElement("div");
            grid.className = "message-media-grid";
            attachments.forEach(file => {
                if (isImageAttachment(file)) {
                    const preview = getAttachmentPreviewUrl(file);
                    if (preview) {
                        const img = document.createElement("img");
                        img.alt = file.name || "Image";
                        img.src = preview;
                        grid.appendChild(img);
                    } else {
                        const pill = document.createElement("div");
                        pill.className = "message-file-pill image-file-pill";
                        const icon = document.createElement("i");
                        icon.setAttribute("data-lucide", "image");
                        const name = document.createElement("span");
                        name.textContent = file.name || "Image";
                        pill.append(icon, name);
                        grid.appendChild(pill);
                    }
                } else {
                    const pill = document.createElement("div");
                    pill.className = "message-file-pill";
                    pill.textContent = file.name || "File";
                    grid.appendChild(pill);
                }
            });
            wrapper.appendChild(grid);
        }

        const actions = document.createElement("div");
        actions.className = "user-msg-actions";
        const editBtn = document.createElement("button");
        editBtn.className = "user-action-btn user-edit-btn";
        editBtn.type = "button";
        editBtn.title = "Edit";
        editBtn.innerHTML = '<i data-lucide="pencil" size="14"></i>';
        editBtn.onclick = () => enableUserMessageEdit(container, textContent, index, attachments);
        const copyBtn = document.createElement("button");
        copyBtn.className = "user-action-btn user-copy-btn";
        copyBtn.type = "button";
        copyBtn.title = "Copy";
        copyBtn.innerHTML = '<i data-lucide="copy" size="14"></i>';
        copyBtn.onclick = () => copyWithFeedback(textContent, copyBtn, 14);
        actions.append(editBtn, copyBtn);
        wrapper.appendChild(actions);
        container.appendChild(wrapper);
        if (window.lucide) window.lucide.createIcons();
    }

    function enableUserMessageEdit(messageElement, originalText, index, originalAttachments = []) {
        if (isGenerating) return;
        messageElement.innerHTML = "";
        const editBox = document.createElement("div");
        editBox.className = "edit-message-box";
        const textarea = document.createElement("textarea");
        textarea.className = "edit-textarea";
        textarea.rows = 2;
        textarea.value = originalText;
        const actions = document.createElement("div");
        actions.className = "edit-actions";
        const cancelBtn = document.createElement("button");
        cancelBtn.className = "edit-btn-cancel";
        cancelBtn.type = "button";
        cancelBtn.textContent = "Cancel";
        const saveBtn = document.createElement("button");
        saveBtn.className = "edit-btn-save";
        saveBtn.type = "button";
        saveBtn.textContent = "Save & Submit";
        actions.append(cancelBtn, saveBtn);
        editBox.append(textarea, actions);
        messageElement.appendChild(editBox);
        textarea.focus();
        cancelBtn.onclick = () => renderUserMessageWrapper(messageElement, originalText, index, originalAttachments);
        saveBtn.onclick = () => {
            const updated = textarea.value.trim();
            if (updated) handleEditedSend(updated, index, messageElement, originalAttachments);
        };
    }

    async function handleEditedSend(newText, targetIndex, messageElement, originalAttachments) {
        if (isGenerating) return;
        const cleaned = String(newText || "").trim();
        if (!cleaned && originalAttachments.length === 0) return;
        isGenerating = true;
        try {
            let actualIndex = Number.isInteger(targetIndex) ? targetIndex : -1;
            if (actualIndex < 0 || actualIndex >= conversation.length) {
                actualIndex = conversation.findIndex(m => m.role === "user" && m.content === cleaned);
            }
            if (actualIndex >= 0 && actualIndex < conversation.length) {
                conversation = conversation.slice(0, actualIndex);
                let current = messageElement;
                while (current?.nextElementSibling) current.nextElementSibling.remove();
            }
            renderUserMessageWrapper(messageElement, cleaned, conversation.length, originalAttachments);
            const apiContent = cleaned || createAttachmentPrompt(originalAttachments);
            conversation.push({
                role: "user",
                content: apiContent,
                displayContent: cleaned,
                attachments: originalAttachments.map(serializeAttachment)
            });
            const aiBubble = renderMessageToUI("assistant", "", null, true);
            await submitChatRequest(aiBubble, cleaned, originalAttachments);
        } catch (error) {
            console.error("Edited send failed:", error);
            isGenerating = false;
        }
    }

    function copyWithFeedback(text, button, size = 16) {
        if (!navigator.clipboard || !button) return;
        navigator.clipboard.writeText(text).then(() => {
            button.innerHTML = `<i data-lucide="check" size="${size}" style="color:#10b981;"></i>`;
            if (window.lucide) window.lucide.createIcons();
            setTimeout(() => {
                button.innerHTML = `<i data-lucide="copy" size="${size}"></i>`;
                if (window.lucide) window.lucide.createIcons();
            }, 2000);
        }).catch(() => {});
    }

    // ============================================================
    //  CHAT ACTIONS (Regenerate, Copy, Share)
    // ============================================================
    chatMessages?.addEventListener("click", (event) => {
        const button = event.target.closest(".msg-action-btn");
        if (!button) return;
        const message = button.closest(".message");
        const text = message?.querySelector(".message-content")?.innerText || "";
        if (button.classList.contains("copy-msg-btn")) {
            copyWithFeedback(text, button);
            return;
        }
        if (button.classList.contains("share-msg-btn") && navigator.share) {
            navigator.share({ text }).catch(() => {});
            return;
        }
        if (button.classList.contains("regen-msg-btn")) {
            if (isGenerating) return;
            const lastUserIndex = findLastUserMessageIndex();
            if (lastUserIndex === -1) return;
            const lastUserMsg = conversation[lastUserIndex];
            conversation = conversation.slice(0, lastUserIndex);
            let current = message;
            while (current?.nextElementSibling) current.nextElementSibling.remove();
            renderUserMessageWrapper(message, lastUserMsg.displayContent || lastUserMsg.content, conversation.length, lastUserMsg.attachments);
            conversation.push({
                role: "user",
                content: lastUserMsg.content,
                displayContent: lastUserMsg.displayContent || lastUserMsg.content,
                attachments: lastUserMsg.attachments
            });
            const aiBubble = renderMessageToUI("assistant", "", null, true);
            submitChatRequest(aiBubble, lastUserMsg.displayContent || lastUserMsg.content, lastUserMsg.attachments);
        }
    });

    function findLastUserMessageIndex() {
        for (let i = conversation.length - 1; i >= 0; i--) {
            if (conversation[i].role === "user") return i;
        }
        return -1;
    }

    // ============================================================
    //  MEDIA SERVICE
    // ============================================================
    const mediaService = {
        async upload(file) {
            if (!(file instanceof File)) throw new Error("Invalid file.");
            if (!currentUser?.id) throw new Error("User session not ready.");
            if (file.size > MAX_FILE_SIZE_BYTES) throw new Error(`${file.name} too large. Max 4MB.`);
            const category = getFileCategory(file);
            const safeName = sanitizeStorageFileName(file.name);
            const objectPath = ["users", currentUser.id, category, `${crypto.randomUUID()}-${safeName}`].join("/");
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), MEDIA_UPLOAD_TIMEOUT_MS);
            try {
                const signedRes = await fetch("/api/media/upload-url", {
                    method: "POST",
                    credentials: "include",
                    cache: "no-store",
                    signal: controller.signal,
                    headers: { "Content-Type": "application/json", Accept: "application/json" },
                    body: JSON.stringify({
                        bucket: MEDIA_BUCKET,
                        path: objectPath,
                        fileName: file.name,
                        mimeType: file.type || "application/octet-stream",
                        size: file.size
                    })
                });
                const signedData = await readJsonResponse(signedRes);
                if (!signedData?.uploadUrl || !signedData?.path) throw new Error("Upload URL not returned.");
                const uploadRes = await fetch(signedData.uploadUrl, {
                    method: "PUT",
                    signal: controller.signal,
                    headers: { "Content-Type": file.type || "application/octet-stream" },
                    body: file
                });
                if (!uploadRes.ok) throw new Error(`Upload failed with status ${uploadRes.status}.`);
                return {
                    provider: "supabase",
                    bucket: MEDIA_BUCKET,
                    path: signedData.path,
                    name: file.name,
                    mimeType: file.type || "application/octet-stream",
                    type: file.type || "application/octet-stream",
                    category,
                    size: file.size
                };
            } catch (error) {
                if (error?.name === "AbortError") throw new Error("Upload timed out.");
                throw error;
            } finally {
                clearTimeout(timeoutId);
            }
        },

        async getSignedUrl(path) {
            const clean = String(path || "").trim();
            if (!clean) throw new Error("Media path missing.");
            const res = await fetch("/api/media/download-url", {
                method: "POST",
                credentials: "include",
                cache: "no-store",
                headers: { "Content-Type": "application/json", Accept: "application/json" },
                body: JSON.stringify({ bucket: MEDIA_BUCKET, path: clean, expiresIn: SIGNED_URL_EXPIRY_SECONDS })
            });
            const data = await readJsonResponse(res);
            if (!data?.signedUrl) throw new Error("Download URL not returned.");
            return data.signedUrl;
        },

        async delete(path) {
            const clean = String(path || "").trim();
            if (!clean) return;
            const res = await fetch("/api/media/delete", {
                method: "POST",
                credentials: "include",
                cache: "no-store",
                headers: { "Content-Type": "application/json", Accept: "application/json" },
                body: JSON.stringify({ bucket: MEDIA_BUCKET, path: clean })
            });
            await readJsonResponse(res);
        }
    };

    function sanitizeStorageFileName(fileName) {
        const original = String(fileName || "file").trim().toLowerCase();
        const dotIndex = original.lastIndexOf(".");
        const extension = dotIndex >= 0 ? original.slice(dotIndex + 1).replace(/[^a-z0-9]/g, "").slice(0, 10) : "";
        const baseName = (dotIndex >= 0 ? original.slice(0, dotIndex) : original)
            .normalize("NFKD").replace(/[^\w.-]+/g, "-").replace(/-+/g, "-").replace(/^[.-]+|[.-]+$/g, "").slice(0, 80) || "file";
        return extension ? `${baseName}.${extension}` : baseName;
    }

    // ============================================================
    //  FILE PROCESSING & HELPERS
    // ============================================================
    async function handleFileProcessing(files) {
        const selected = Array.from(files || []).slice(0, MAX_ATTACHED_FILES);
        for (const file of selected) {
            if (attachedFiles.length >= MAX_ATTACHED_FILES) {
                alert(`Maximum ${MAX_ATTACHED_FILES} files.`);
                break;
            }
            if (!(file instanceof File)) continue;
            if (file.size > MAX_FILE_SIZE_BYTES) {
                alert(`${file.name} too large. Max 4MB.`);
                continue;
            }
            if (!checkFilePermissionForPlan(file)) continue;
            const category = getFileCategory(file);
            let previewUrl = "";
            if (category === "image") previewUrl = URL.createObjectURL(file);
            attachedFiles.push({
                localId: crypto.randomUUID(),
                name: file.name,
                type: file.type || "application/octet-stream",
                mimeType: file.type || "application/octet-stream",
                category,
                size: file.size,
                rawFile: file,
                previewUrl,
                uploadState: "ready"
            });
        }
        renderAttachedChips();
        renderAdaptiveSuggestions();
        updateComposerShape();
    }

    function getAttachmentPreviewUrl(file) {
        if (!file) return "";
        if (file.previewUrl?.startsWith("blob:")) return file.previewUrl;
        if (file.localId && sessionMediaPreviews.has(file.localId)) return sessionMediaPreviews.get(file.localId);
        return "";
    }

    function isImageAttachment(file) {
        if (!file) return false;
        if (file.type?.startsWith("image/")) return true;
        if (file.mimeType?.startsWith("image/")) return true;
        if (file.category === "image") return true;
        return /\.(png|jpg|jpeg|webp|gif)$/i.test(file.name || "");
    }

    function getFileCategory(file) {
        const type = file.type || "";
        if (type.startsWith("image/")) return "image";
        if (type.startsWith("audio/")) return "audio";
        if (type.startsWith("video/")) return "video";
        if (type.includes("pdf")) return "pdf";
        return "text";
    }

    function getCategoryFromMimeType(mimeType) {
        if (!mimeType) return "file";
        if (mimeType.startsWith("image/")) return "image";
        if (mimeType.startsWith("audio/")) return "audio";
        if (mimeType.startsWith("video/")) return "video";
        if (mimeType.includes("pdf")) return "pdf";
        return "file";
    }

    // ============================================================
    //  ATTACHMENT CHIPS
    // ============================================================
    function renderAttachedChips() {
        if (!attachedChipsWrapper) return;
        attachedChipsWrapper.innerHTML = "";
        attachedFiles.forEach((file, index) => {
            const card = document.createElement("div");
            card.className = "attachment-preview-card";
            if (isImageAttachment(file)) {
                const img = document.createElement("img");
                img.alt = file.name || "Image";
                img.src = getAttachmentPreviewUrl(file) || "";
                card.appendChild(img);
            } else {
                const box = document.createElement("div");
                box.className = "attachment-preview-file";
                box.textContent = file.name || "File";
                card.appendChild(box);
            }
            const remove = document.createElement("button");
            remove.type = "button";
            remove.className = "attachment-remove-btn";
            remove.textContent = "×";
            remove.addEventListener("click", () => {
                const previewUrl = attachedFiles[index]?.previewUrl;
                if (previewUrl?.startsWith("blob:")) URL.revokeObjectURL(previewUrl);
                attachedFiles.splice(index, 1);
                renderAttachedChips();
                updateComposerShape();
            });
            card.appendChild(remove);
            attachedChipsWrapper.appendChild(card);
        });
    }

    // ============================================================
    //  HANDLE SEND (with rollback)
    // ============================================================
    async function handleSend() {
        if (isGenerating) return;
        const text = chatInput?.value.trim() || "";
        if (!text && attachedFiles.length === 0) return;

        isGenerating = true;
        const pendingFiles = [...attachedFiles];
        let userMsgEl = null;

        try {
            chatInput && (chatInput.value = "");
            chatInput && (chatInput.style.height = "auto");
            if (heroSection) heroSection.style.display = "none";

            const msgIndex = conversation.length;
            userMsgEl = renderMessageToUI("user", text, msgIndex, false, pendingFiles);
            attachedFiles = [];
            renderAttachedChips();
            renderAdaptiveSuggestions();
            updateComposerShape();

            const uploaded = [];
            const successful = [];
            try {
                for (const file of pendingFiles) {
                    file.uploadState = "uploading";
                    const result = await mediaService.upload(file.rawFile);
                    result.localId = file.localId;
                    if (file.previewUrl) {
                        sessionMediaPreviews.set(file.localId, file.previewUrl);
                        result.previewUrl = file.previewUrl;
                    }
                    uploaded.push(result);
                    successful.push(result);
                }
            } catch (uploadError) {
                for (const f of successful) {
                    try { await mediaService.delete(f.path); } catch {}
                }
                throw uploadError;
            }

            const apiContent = text || createAttachmentPrompt(uploaded);
            conversation.push({
                role: "user",
                content: apiContent,
                displayContent: text,
                attachments: uploaded.map(serializeAttachment)
            });
            if (userMsgEl) renderUserMessageWrapper(userMsgEl, text, msgIndex, uploaded);

            const aiBubble = renderMessageToUI("assistant", "", null, true);
            await submitChatRequest(aiBubble, apiContent, uploaded);
        } catch (error) {
            userMsgEl?.remove();
            if (attachedFiles.length === 0 && pendingFiles.length > 0) attachedFiles = pendingFiles;
            renderAttachedChips();
            renderAdaptiveSuggestions();
            updateComposerShape();
            isGenerating = false;
            alert(error.message || "Send failed.");
        }
    }

    // ============================================================
    //  SUBMIT CHAT REQUEST (with attachments payload)
    // ============================================================
    async function submitChatRequest(aiBubble, userText, files) {
        let data;
        const title = makeConversationTitle(userText, files);

        const apiMessages = conversation
            .filter(m => m && ["user", "assistant", "system"].includes(m.role))
            .map(m => ({
                role: m.role,
                content: String(m.content || "").trim(),
                attachments: Array.isArray(m.attachments) ? m.attachments.map(serializeAttachment) : []
            }))
            .filter(m => Boolean(m.content) || m.attachments.length > 0);

        const finalMsg = apiMessages[apiMessages.length - 1];
        if (!finalMsg || finalMsg.role !== "user") {
            showAssistantError(aiBubble, new Error("Last message must be user."));
            return;
        }

        try {
            const res = await fetch("/api/chat", {
                method: "POST",
                credentials: "include",
                cache: "no-store",
                headers: { "Content-Type": "application/json", Accept: "application/json" },
                body: JSON.stringify({
                    messages: apiMessages,
                    attachments: conversation.at(-1)?.attachments || [],
                    conversationId: currentConversationId,
                    model: selectedModel,
                    isDeepResearch: isDeepResearchMode,
                    title
                })
            });
            data = await readJsonResponse(res);
        } catch (error) {
            console.error("Chat API request failed:", error);
            showAssistantError(aiBubble, error);
            return;
        }

        const replyValue = data?.reply || data?.choices?.[0]?.message?.content || data?.message?.content || data?.content || data?.text;
        const reply = typeof replyValue === "string" ? replyValue.trim() : "";
        if (!reply) {
            showAssistantError(aiBubble, new Error("AI response empty."));
            return;
        }

        if (typeof data.conversationId === "string" && data.conversationId.trim()) {
            currentConversationId = data.conversationId.trim();
        }

        try {
            if (aiBubble) {
                aiBubble.classList.remove("is-thinking");
                const contentEl = aiBubble.querySelector(".message-content");
                if (contentEl) {
                    contentEl.style.color = "";
                    contentEl.innerHTML = safeParseMarkdown(reply);
                }
            }
            conversation.push({ role: "assistant", content: reply });
            if (scrollArea) scrollArea.scrollTop = scrollArea.scrollHeight;
        } catch (renderError) {
            console.error("AI reply rendering failed:", renderError);
            if (aiBubble) {
                aiBubble.classList.remove("is-thinking");
                const contentEl = aiBubble.querySelector(".message-content");
                if (contentEl) {
                    contentEl.textContent = reply;
                    contentEl.style.color = "";
                }
            }
            if (!conversation.some(m => m.role === "assistant" && m.content === reply)) {
                conversation.push({ role: "assistant", content: reply });
            }
        } finally {
            isGenerating = false;
        }

        if (window.lucide) try { window.lucide.createIcons(); } catch {}
        try { await loadHistoryFromSupabase(); } catch (historyError) { console.warn("History refresh failed:", historyError); }
    }

    // ============================================================
    //  UTILITY FUNCTIONS
    // ============================================================
    function makeConversationTitle(text, files = []) {
        const clean = String(text || "").trim();
        if (clean) return clean.slice(0, 48);
        if (files.length > 0) {
            const imgCount = files.filter(f => f.type?.startsWith("image/")).length;
            if (imgCount > 0) return imgCount === 1 ? "Image upload" : `${imgCount} images uploaded`;
            return files.length === 1 ? "File upload" : `${files.length} files uploaded`;
        }
        return "New conversation";
    }

    function serializeAttachment(file) {
        return {
            localId: file.localId || "",
            provider: file.provider || "supabase",
            bucket: file.bucket || MEDIA_BUCKET,
            path: file.path || "",
            name: file.name || "Attached file",
            mimeType: file.mimeType || file.type || "application/octet-stream",
            type: file.type || file.mimeType || "application/octet-stream",
            category: file.category || "file",
            size: Number(file.size || 0)
        };
    }

    function createAttachmentPrompt(attachments) {
        if (!attachments || attachments.length === 0) return "The user sent an attachment.";
        return `The user uploaded: ${attachments.map(a => `${a.category}: ${a.name}`).join(", ")}.`;
    }

    function showAssistantError(aiBubble, error) {
        if (!aiBubble) { isGenerating = false; return; }
        aiBubble.classList.remove("is-thinking");
        const contentEl = aiBubble.querySelector(".message-content");
        if (contentEl) {
            contentEl.textContent = `Error: ${error?.message || "Request failed."}`;
            contentEl.style.color = "#ef4444";
        }
        isGenerating = false;
    }

    function startNewConversation() {
        conversation = [];
        attachedFiles = [];
        currentConversationId = null;
        activePopupChatId = null;
        if (chatMessages) chatMessages.innerHTML = "";
        if (heroSection) heroSection.style.display = "block";
        renderAttachedChips();
        renderAdaptiveSuggestions();
        updateComposerShape();
        loadHistoryFromSupabase();
    }

    async function logoutUser() {
        try {
            await fetch("/api/auth", {
                method: "POST",
                credentials: "include",
                headers: { "Content-Type": "application/json", Accept: "application/json" },
                body: JSON.stringify({ action: "logout" })
            });
        } catch {}
        clearLegacyUserStorage();
        localStorage.removeItem("neo_user_memories");
        window.location.replace("signup.html");
    }

    // ============================================================
    //  SETTINGS UI
    // ============================================================
    function setupSettingsUI() {
        settingsCloseBtn?.addEventListener("click", () => neoSettingsOverlay?.classList.remove("show"));
        neoSettingsOverlay?.addEventListener("click", (e) => {
            if (e.target === neoSettingsOverlay) neoSettingsOverlay.classList.remove("show");
        });
        settingsTabs?.forEach(tab => {
            tab.addEventListener("click", () => {
                settingsTabs.forEach(t => t.classList.remove("active"));
                tab.classList.add("active");
                const panelId = tab.dataset.settingsTab;
                settingsPanels?.forEach(p => p.classList.remove("active"));
                document.getElementById(`settingsPanel${panelId}`)?.classList.add("active");
            });
        });
        settingsSaveBtn?.addEventListener("click", () => alert("Settings saved (placeholder)"));
        settingsResetBtn?.addEventListener("click", () => alert("Settings reset (placeholder)"));
        settingsBillingBtn?.addEventListener("click", () => window.location.href = "/billing");
        settingsThemeBtn?.addEventListener("click", () => topBarDarkModeToggle?.click());
    }

    // ============================================================
    //  EVENT LISTENERS
    // ============================================================
    function setupEventListeners() {
        sendBtn?.addEventListener("click", handleSend);
        chatInput?.addEventListener("keydown", (e) => {
            if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); }
        });
        chatInput?.addEventListener("input", function () {
            this.style.height = "auto";
            this.style.height = `${Math.min(this.scrollHeight, 160)}px`;
            updateComposerShape();
            renderAdaptiveSuggestions();
        });
        attachBtn?.addEventListener("click", (e) => { e.stopPropagation(); attachPopupMenu?.classList.toggle("show"); });
        addFilesMenuBtn?.addEventListener("click", () => { attachPopupMenu?.classList.remove("show"); hiddenFileInput?.click(); });
        deepResearchToggleBtn?.addEventListener("click", (e) => {
            e.stopPropagation();
            isDeepResearchMode = !isDeepResearchMode;
            deepResearchToggleBtn.classList.toggle("active-mode", isDeepResearchMode);
        });
        personalMemoryBtn?.addEventListener("click", (e) => {
            e.stopPropagation();
            attachPopupMenu?.classList.remove("show");
            const memory = prompt("Update Memory:", localStorage.getItem("neo_user_memories") || "");
            if (memory !== null) localStorage.setItem("neo_user_memories", memory.trim());
        });
        hiddenFileInput?.addEventListener("change", (e) => {
            const files = Array.from(e.target.files || []);
            if (files.length) handleFileProcessing(files);
            e.target.value = "";
        });

        const toggleSidebar = () => {
            if (!sidebar) return;
            sidebar.classList.toggle("collapsed");
            const isOpen = !sidebar.classList.contains("collapsed");
            const mobile = window.matchMedia("(max-width: 767px)").matches;
            sidebarScrim?.classList.toggle("visible", mobile && isOpen);
            updateBodySidebarState();
        };
        sidebarToggleBtn?.addEventListener("click", toggleSidebar);
        collapseSidebarBtn?.addEventListener("click", toggleSidebar);
        sidebarScrim?.addEventListener("click", toggleSidebar);
        newChatBtn?.addEventListener("click", () => {
            startNewConversation();
            if (window.innerWidth < 768) {
                sidebar?.classList.add("collapsed");
                sidebarScrim?.classList.remove("visible");
                updateBodySidebarState();
            }
        });

        document.querySelectorAll("[data-prompt]").forEach(btn => {
            btn.addEventListener("click", () => {
                if (!chatInput) return;
                chatInput.value = btn.getAttribute("data-prompt") || "";
                handleSend();
            });
        });

        userProfileBtn?.addEventListener("click", (e) => { e.stopPropagation(); userPopupMenu?.classList.toggle("show"); });
        sidebarPersonalitiesBtn?.addEventListener("click", () => {
            userPopupMenu?.classList.remove("show");
            neoSettingsOverlay?.classList.add("show");
            neoSettingsOverlay?.setAttribute("aria-hidden", "false");
            settingsTabs?.forEach(tab => tab.classList.toggle("active", tab.dataset.settingsTab === "personalities"));
            settingsPanels?.forEach(p => p.classList.remove("active"));
            document.getElementById("settingsPanelPersonalities")?.classList.add("active");
        });

        // History popup actions
        hpDeleteBtn?.addEventListener("click", async () => {
            if (!activePopupChatId) return;
            try {
                const res = await fetch("/api/history", {
                    method: "POST",
                    credentials: "include",
                    headers: { "Content-Type": "application/json", Accept: "application/json" },
                    body: JSON.stringify({ action: "delete", conversationId: activePopupChatId })
                });
                await readJsonResponse(res);
                if (currentConversationId === activePopupChatId) startNewConversation();
                else await loadHistoryFromSupabase();
            } catch (error) { alert(error.message); }
            finally { activePopupChatId = null; historyPopupMenu?.classList.remove("show"); }
        });
        hpShareBtn?.addEventListener("click", () => { alert("Share not implemented"); historyPopupMenu?.classList.remove("show"); });
        hpPinBtn?.addEventListener("click", () => { alert("Pin not implemented"); historyPopupMenu?.classList.remove("show"); });
        hpRenameBtn?.addEventListener("click", async () => {
            if (!activePopupChatId) return;
            const newTitle = prompt("Enter new title:");
            if (newTitle !== null && newTitle.trim()) {
                try {
                    const res = await fetch("/api/history", {
                        method: "POST",
                        credentials: "include",
                        headers: { "Content-Type": "application/json", Accept: "application/json" },
                        body: JSON.stringify({ action: "rename", conversationId: activePopupChatId, title: newTitle.trim() })
                    });
                    await readJsonResponse(res);
                    await loadHistoryFromSupabase();
                } catch (error) { alert(error.message); }
            }
            historyPopupMenu?.classList.remove("show");
        });

        document.addEventListener("click", (e) => {
            if (!userProfileBtn?.contains(e.target) && !userPopupMenu?.contains(e.target)) userPopupMenu?.classList.remove("show");
            if (!historyPopupMenu?.contains(e.target) && !e.target.closest(".history-action-btn")) historyPopupMenu?.classList.remove("show");
            if (!attachBtn?.contains(e.target) && !attachPopupMenu?.contains(e.target)) attachPopupMenu?.classList.remove("show");
            if (!modelBadgeBtn?.contains(e.target) && !modelDropdownMenu?.contains(e.target)) modelDropdownMenu?.classList.remove("show");
        });

        let lastResponsiveMode = window.matchMedia("(max-width: 767px)").matches;
        window.addEventListener("resize", () => {
            const mobile = window.matchMedia("(max-width: 767px)").matches;
            if (mobile === lastResponsiveMode) return;
            lastResponsiveMode = mobile;
            initializeSidebarState();
        }, { passive: true });

        document.getElementById("brandBtn")?.addEventListener("click", () => window.location.href = "index.html");
        document.getElementById("logoutBtn")?.addEventListener("click", logoutUser);
    }

    // ============================================================
    //  SIDEBAR STATE
    // ============================================================
    function initializeSidebarState() {
        const isMobile = window.matchMedia("(max-width: 767px)").matches;
        if (isMobile) {
            document.body.classList.add("sidebar-collapsed");
            sidebar?.classList.add("collapsed");
            sidebarScrim?.classList.remove("visible");
        } else {
            document.body.classList.remove("sidebar-collapsed");
            sidebar?.classList.remove("collapsed");
            sidebarScrim?.classList.remove("visible");
        }
        updateBodySidebarState();
    }

    function updateBodySidebarState() {
        const collapsed = sidebar?.classList.contains("collapsed");
        document.body.classList.toggle("sidebar-collapsed", Boolean(collapsed));
    }

    // ============================================================
    //  DRAG & DROP + PASTE
    // ============================================================
    function setupDragAndDrop() {
        if (!composerWrapper) return;
        ["dragenter", "dragover"].forEach(name => {
            composerWrapper.addEventListener(name, (e) => {
                e.preventDefault();
                e.stopPropagation();
                dragDropOverlay?.classList.add("show");
            });
        });
        ["dragleave", "drop"].forEach(name => {
            composerWrapper.addEventListener(name, (e) => {
                e.preventDefault();
                e.stopPropagation();
                dragDropOverlay?.classList.remove("show");
            });
        });
        composerWrapper.addEventListener("drop", (e) => {
            const files = Array.from(e.dataTransfer?.files || []);
            if (files.length) handleFileProcessing(files);
        });
    }

    function setupPasteUpload() {
        document.addEventListener("paste", (e) => {
            const files = Array.from(e.clipboardData?.files || []);
            if (files.length) handleFileProcessing(files);
        });
    }

    // ============================================================
    //  ADAPTIVE SUGGESTIONS
    // ============================================================
    function renderAdaptiveSuggestions() {
        if (!liveSuggestions || !chatInput) return;
        const text = chatInput.value.trim().toLowerCase();
        const base = ["Write code", "Summarize this", "Make a plan", "Improve text", "Research this"];
        const code = ["Fix this code", "Explain this error", "Make it production ready", "Find bugs", "Write cleaner version"];
        const business = ["Make launch plan", "Improve pricing", "Write marketing copy", "Find risks", "Make growth strategy"];
        let suggestions = base;
        if (text.includes("code") || text.includes("error") || text.includes("js") || text.includes("css") || text.includes("html")) {
            suggestions = code;
        }
        if (text.includes("business") || text.includes("launch") || text.includes("pricing") || text.includes("grow")) {
            suggestions = business;
        }
        liveSuggestions.innerHTML = "";
        suggestions.forEach(label => {
            const btn = document.createElement("button");
            btn.type = "button";
            btn.className = "suggestion-chip";
            btn.textContent = label;
            btn.addEventListener("click", () => {
                chatInput.value = label;
                chatInput.focus();
                updateComposerShape();
                renderAdaptiveSuggestions();
            });
            liveSuggestions.appendChild(btn);
        });
    }

    // ============================================================
    //  PROFILE RENDERING (secure)
    // ============================================================
    async function renderUserProfile() {
        let profile = null;
        try {
            const res = await fetch("/api/profile", {
                credentials: "include",
                cache: "no-store",
                headers: { Accept: "application/json" }
            });
            if (res.ok) profile = await res.json();
        } catch {}
        const username = profile?.user?.username || currentUser.username || "user";
        const plan = profile?.user?.planType || currentUser.planType || userPlan || "free";
        if (userNameDisplay) userNameDisplay.textContent = `@${username}`;
        if (userPlanBadge) userPlanBadge.textContent = plan === "pro" ? "Pro Plan" : "Free Plan";
        const avatarUrl = profile?.profile?.avatarUrl || profile?.avatarUrl || "";
        if (userAvatar) {
            userAvatar.replaceChildren();
            if (avatarUrl) {
                try {
                    const parsed = new URL(avatarUrl, window.location.origin);
                    const allowed = parsed.origin === window.location.origin ||
                        parsed.hostname === "ujclhweqqifgoiscvqmd.supabase.co";
                    if (!allowed) throw new Error("Unsupported host");
                    const img = document.createElement("img");
                    img.src = parsed.href;
                    img.alt = username;
                    img.loading = "lazy";
                    img.referrerPolicy = "no-referrer";
                    userAvatar.appendChild(img);
                } catch {
                    userAvatar.textContent = username.charAt(0).toUpperCase();
                }
            } else {
                userAvatar.textContent = username.charAt(0).toUpperCase();
            }
        }
    }

    // ============================================================
    //  MEMORY CLEANUP
    // ============================================================
    function revokeAttachedFilePreviews(files) {
        Array.from(files || []).forEach(f => {
            const url = f?.previewUrl;
            if (url?.startsWith("blob:")) URL.revokeObjectURL(url);
        });
    }
    window.addEventListener("beforeunload", () => {
        revokeAttachedFilePreviews(attachedFiles);
        sessionMediaPreviews.forEach(url => {
            if (url?.startsWith("blob:")) URL.revokeObjectURL(url);
        });
        sessionMediaPreviews.clear();
    });

    // ============================================================
    //  BOOT
    // ============================================================
    document.addEventListener("DOMContentLoaded", () => {
        document.documentElement.dataset.neoRuntime = "ready";
        init().catch(err => {
            console.error("NEO init failed:", err);
            if (chatInput) chatInput.placeholder = "Initialization error. Check console.";
        });
    });
})();
