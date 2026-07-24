(function () {
    "use strict";

    // SECURITY CONSTANTS & CONFIGS
    const MAX_FILE_SIZE_BYTES = 15 * 1024 * 1024;
    const MAX_ATTACHED_FILES = 5;


    // AUTHENTICATED USER COMES FROM SECURE SERVER COOKIE
    let currentUser = {
        id: null,
        username: "user"
    };

    // STATE VARIABLES
    let conversation = [];
    let attachedFiles = [];
    let currentConversationId = null;
    let isGenerating = false;
    let activePopupChatId = null;
    let isDeepResearchMode = false;
    let recognition = null;
    let isListening = false;

    // REAL-TIME AUDIO VISUALIZER STATE
    let audioCtx = null;
    let analyser = null;
    let micStream = null;
    let animFrameId = null;

    // FREEMIUM STATE
    let selectedModel = "free";
    let userPlan = "free";

    // DOM ELEMENTS
    const chatInput = document.getElementById("chatInput");
    const sendBtn = document.getElementById("sendBtn");
    const chatMessages = document.getElementById("chatMessages");
    const scrollArea = document.getElementById("scrollArea");
    const heroSection = document.getElementById("heroSection");
    const historyList = document.getElementById("historyList");
    const sidebar = document.getElementById("sidebar");
    const sidebarToggleBtn = document.getElementById("sidebarToggleBtn");
    const collapseSidebarBtn = document.getElementById("collapseSidebarBtn");
    const newChatBtn = document.getElementById("newChatBtn");
    const topBarDarkModeToggle = document.getElementById(
        "topBarDarkModeToggle"
    );
    const sidebarDarkModeToggle = document.getElementById(
        "sidebarDarkModeToggle"
    );
    const sidebarScrim = document.getElementById("sidebarScrim");
    const userAvatar = document.getElementById("userAvatar");
    const userNameDisplay = document.getElementById("userNameDisplay");
    const userPlanBadge = document.getElementById("userPlanBadge");
    const userProfileBtn = document.getElementById("userProfileBtn");
    const userPopupMenu = document.getElementById("userPopupMenu");

    const historyPopupMenu = document.getElementById("historyPopupMenu");
    const hpDeleteBtn = document.getElementById("hpDeleteBtn");

    // COMPOSER ELEMENTS
    const attachBtn = document.getElementById("attachBtn");
    const attachPopupMenu = document.getElementById("attachPopupMenu");
    const addFilesMenuBtn = document.getElementById("addFilesMenuBtn");
    const deepResearchToggleBtn = document.getElementById(
        "deepResearchToggleBtn"
    );
    const personalMemoryBtn = document.getElementById("personalMemoryBtn");
    const hiddenFileInput = document.getElementById("hiddenFileInput");
    const liveSuggestions = document.getElementById("liveSuggestions");
    const attachedChipsWrapper = document.getElementById(
        "attachedChipsWrapper"
    );
    const composerWrapper = document.getElementById("composerWrapper");
    const dragDropOverlay = document.getElementById("dragDropOverlay");
    const micBtn = document.getElementById("micBtn");
    const stopRecBtn = document.getElementById("stopRecBtn");
    const composerInputRow = document.querySelector(".composer-input-row");
    const glassInputContainer = document.getElementById(
        "glassInputContainer"
    );

    // FREEMIUM ELEMENTS
    const modelBadgeBtn = document.getElementById("modelBadgeBtn");
    const modelDropdownMenu = document.getElementById("modelDropdownMenu");
    const currentModelDisplay = document.getElementById(
        "currentModelDisplay"
    );
    const optL10 = document.getElementById("optL10");
    const optL12 = document.getElementById("optL12");
    const upgradeModal = document.getElementById("upgradeModal");
    const modalCloseBtn = document.getElementById("modalCloseBtn");
    const modalMaybeLaterBtn = document.getElementById(
        "modalMaybeLaterBtn"
    );
    const upgradeActionBtn = document.getElementById("upgradeActionBtn");

    if ("serviceWorker" in navigator && location.protocol === "https:") {
        navigator.serviceWorker.register("/sw.js").catch(() => {});
    }

    async function init() {
        if (window.lucide) {
            window.lucide.createIcons();
        }

        setupTheme();
        configureSecurityHooks();

        setupEventListeners();
        setupFreemiumLogic();
        setupDragAndDrop();
        setupPasteUpload();
        setupSpeechRecognition();

        const authenticated = await restoreSecureSession();

        if (!authenticated) {
            return;
        }

        await renderUserProfile().catch((error) => {
            console.warn('Profile rendering failed:', error);
        });

        await loadHistoryFromSupabase().catch((error) => {
            console.warn('History loading failed:', error);
        });

        updateBodySidebarState();
        renderAdaptiveSuggestions();
        updateComposerShape();
    }

    async function restoreSecureSession() {
        try {
            const response = await fetch("/api/auth", {
                method: "GET",
                credentials: "include",
                headers: {
                    Accept: "application/json"
                },
                cache: "no-store"
            });

            const data = await response.json().catch(() => ({}));

            if (
                !response.ok ||
                !data.authenticated ||
                !data.user
            ) {
                clearLegacyUserStorage();
                window.location.replace("signup.html");
                return false;
            }

            currentUser = {
                id: data.user.id,
                username: data.user.username || "user"
            };

            /*
             * Temporary compatibility for parts of the existing UI
             * that may still read the old local session object.
             *
             * Authentication does not trust this value. The backend
             * always uses the signed HttpOnly session cookie.
             */
            localStorage.setItem(
                "signaturesi_user",
                JSON.stringify(currentUser)
            );

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

    function configureSecurityHooks() {
        if (!window.DOMPurify) {
            return;
        }

        window.DOMPurify.addHook(
            "afterSanitizeAttributes",
            function (node) {
                if ("target" in node) {
                    node.setAttribute("target", "_blank");
                    node.setAttribute(
                        "rel",
                        "noopener noreferrer"
                    );
                }
            }
        );
    }

    function setupTheme() {
        const isDark =
            localStorage.getItem("neo_theme") === "dark";

        document.body.classList.toggle(
            "dark-mode",
            isDark
        );

        const toggle = () => {
            document.body.classList.toggle("dark-mode");

            localStorage.setItem(
                "neo_theme",
                document.body.classList.contains("dark-mode")
                    ? "dark"
                    : "light"
            );
        };

        topBarDarkModeToggle?.addEventListener(
            "click",
            toggle
        );

        sidebarDarkModeToggle?.addEventListener(
            "click",
            toggle
        );
    }

    function sanitizeHTML(str) {
        if (window.DOMPurify) {
            return window.DOMPurify.sanitize(str || "");
        }

        const temp = document.createElement("div");
        temp.textContent = str || "";
        return temp.innerHTML;
    }

    function safeParseMarkdown(text) {
        if (window.marked) {
            const rawParsed = window.marked.parse(
                String(text || "")
            );

            if (window.DOMPurify) {
                return window.DOMPurify.sanitize(rawParsed);
            }

            return sanitizeHTML(String(text || ""));
        }

        return sanitizeHTML(text);
    }

    async function readJsonResponse(response) {
        const data = await response
            .json()
            .catch(() => ({}));

        if (response.status === 401) {
            clearLegacyUserStorage();
            window.location.replace("signup.html");
            throw new Error(
                "Your session has expired. Please log in again."
            );
        }

        if (!response.ok) {
            if (data?.code === "FREE_LIMIT_REACHED" || data?.code === "FREE_FILE_LIMIT_REACHED") {
                upgradeModal?.classList.add("show");
            }
            const errorValue = data?.error;

            const errorMessage =
                typeof errorValue === "string"
                    ? errorValue
                    : errorValue?.message ||
                      "The request failed.";

            throw new Error(errorMessage);
        }

        return data;
    }

    // DYNAMIC COMPOSER SHAPE MANAGEMENT
    function updateComposerShape() {
        if (!glassInputContainer) {
            return;
        }

        const hasText =
            Boolean(chatInput?.value.trim());

        const isMultiLine =
            Boolean(
                chatInput &&
                chatInput.scrollHeight > 38
            );

        const hasFiles =
            attachedFiles.length > 0;

        glassInputContainer.classList.toggle(
            "is-expanded",
            hasText || isMultiLine || hasFiles
        );
    }

    // FREEMIUM LOGIC
    function setupFreemiumLogic() {
        modelBadgeBtn?.addEventListener(
            "click",
            event => {
                event.stopPropagation();

                modelDropdownMenu?.classList.toggle(
                    "show"
                );
            }
        );

        optL10?.addEventListener("click", () => {
            selectedModel = "free";

            if (currentModelDisplay) {
                currentModelDisplay.textContent =
                    "NEO Free";
            }

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

            selectedModel = "pro";

            if (currentModelDisplay) {
                currentModelDisplay.textContent =
                    "NEO Pro";
            }

            optL12.classList.add("active");
            optL10?.classList.remove("active");
        });

        const closeModal = () => {
            upgradeModal?.classList.remove("show");
        };

        modalCloseBtn?.addEventListener(
            "click",
            closeModal
        );

        modalMaybeLaterBtn?.addEventListener(
            "click",
            closeModal
        );

        upgradeModal?.addEventListener(
            "click",
            event => {
                if (event.target === upgradeModal) {
                    closeModal();
                }
            }
        );

        upgradeActionBtn?.addEventListener(
            "click",
            async () => {
                upgradeActionBtn.disabled = true;
                const originalText = upgradeActionBtn.textContent;
                upgradeActionBtn.textContent = "Opening secure checkout…";
                try {
                    const response = await fetch("/api/checkout", { method: "POST", credentials: "include", headers: { Accept: "application/json" } });
                    const data = await readJsonResponse(response);
                    if (!data.url) throw new Error("Checkout URL is unavailable.");
                    window.location.assign(data.url);
                } catch (error) {
                    alert(error.message);
                } finally {
                    upgradeActionBtn.disabled = false;
                    upgradeActionBtn.textContent = originalText;
                }
            }
        );
    }

    function checkFilePermissionForPlan(file) {
        const extension = file.name
            .split(".")
            .pop()
            .toLowerCase();

        const isAudioVideo = [
            "mp3",
            "wav",
            "mp4",
            "webm",
            "mov",
            "m4a"
        ].includes(extension);

        if (
            isAudioVideo &&
            userPlan === "free"
        ) {
            upgradeModal?.classList.add("show");
            return false;
        }

        return true;
    }

    // REAL-TIME MICROPHONE AUDIO VISUALIZER
    async function startAudioVisualizer() {
        try {
            micStream =
                await navigator.mediaDevices.getUserMedia({
                    audio: true,
                    video: false
                });

            const AudioContextClass =
                window.AudioContext ||
                window.webkitAudioContext;

            audioCtx = new AudioContextClass();
            analyser = audioCtx.createAnalyser();
            analyser.fftSize = 64;
            analyser.smoothingTimeConstant = 0.75;

            const source =
                audioCtx.createMediaStreamSource(
                    micStream
                );

            source.connect(analyser);

            const waveSpans =
                document.querySelectorAll(
                    ".wave-dots-bar span"
                );

            const dataArray =
                new Uint8Array(
                    analyser.frequencyBinCount
                );

            function updateWave() {
                if (!isListening) {
                    return;
                }

                analyser.getByteFrequencyData(
                    dataArray
                );

                waveSpans.forEach(
                    (span, index) => {
                        const value =
                            dataArray[
                                index %
                                dataArray.length
                            ] || 0;

                        const height = Math.max(
                            4,
                            Math.min(
                                26,
                                (value / 255) * 28
                            )
                        );

                        span.style.height =
                            `${height}px`;

                        span.style.opacity =
                            value > 12
                                ? "1"
                                : "0.4";

                        span.style.backgroundColor =
                            value > 12
                                ? "var(--focus-ring)"
                                : "var(--text-muted)";
                    }
                );

                animFrameId =
                    requestAnimationFrame(
                        updateWave
                    );
            }

            updateWave();
        } catch (error) {
            console.warn(
                "Microphone visualizer initialization failed:",
                error
            );
        }
    }

    function stopAudioVisualizer() {
        if (animFrameId) {
            cancelAnimationFrame(animFrameId);
            animFrameId = null;
        }

        if (micStream) {
            micStream
                .getTracks()
                .forEach(track => track.stop());

            micStream = null;
        }

        if (
            audioCtx &&
            audioCtx.state !== "closed"
        ) {
            audioCtx.close();
            audioCtx = null;
        }

        const waveSpans =
            document.querySelectorAll(
                ".wave-dots-bar span"
            );

        waveSpans.forEach(span => {
            span.style.height = "4px";
            span.style.opacity = "0.4";
            span.style.backgroundColor =
                "var(--text-muted)";
        });
    }

    // SPEECH RECOGNITION
    function setupSpeechRecognition() {
        const SpeechRecognition =
            window.SpeechRecognition ||
            window.webkitSpeechRecognition;

        if (!SpeechRecognition) {
            return;
        }

        try {
            recognition =
                new SpeechRecognition();

            recognition.continuous = true;
            recognition.interimResults = true;
            recognition.lang = "en-US";

            recognition.onstart = () => {
                isListening = true;

                composerInputRow?.classList.add(
                    "is-transcribing"
                );

                startAudioVisualizer();
            };

            recognition.onresult = event => {
                const transcript =
                    Array.from(event.results)
                        .map(
                            result =>
                                result[0].transcript
                        )
                        .join("");

                if (chatInput) {
                    chatInput.value = transcript;
                    chatInput.style.height = "auto";

                    chatInput.style.height =
                        `${Math.min(
                            chatInput.scrollHeight,
                            160
                        )}px`;

                    updateComposerShape();
                }
            };

            recognition.onerror =
                stopListening;

            recognition.onend =
                stopListening;

            micBtn?.addEventListener(
                "click",
                event => {
                    event.stopPropagation();

                    if (isListening) {
                        recognition.stop();
                        return;
                    }

                    try {
                        recognition.start();
                    } catch {
                        stopListening();
                    }
                }
            );

            stopRecBtn?.addEventListener(
                "click",
                event => {
                    event.stopPropagation();

                    recognition?.stop();
                    stopListening();
                }
            );
        } catch (error) {
            console.warn(
                "Speech recognition setup failed:",
                error
            );
        }
    }

    function stopListening() {
        isListening = false;

        composerInputRow?.classList.remove(
            "is-transcribing"
        );

        stopAudioVisualizer();
    }

    async function renderUserProfile() {
        if (!userAvatar) {
            return;
        }

        const rawUsername =
            currentUser?.username ||
            currentUser?.name ||
            "user";

        const baseUsername =
            String(rawUsername)
                .trim()
                .toLowerCase()
                .replace(/^@/, "")
                .replace(/@bean$/i, "");

        if (userNameDisplay) {
            userNameDisplay.textContent =
                `@${baseUsername}`;
        }

        if (userPlanBadge) {
            userPlanBadge.textContent =
                userPlan === "free"
                    ? "Free Plan"
                    : "Pro Plan";
        }

        userAvatar.style.backgroundImage = "none";

        userAvatar.textContent =
            baseUsername.charAt(0).toUpperCase() ||
            "U";

        if (!supabaseClient) {
            return;
        }

        try {
            const { data: profiles } =
                await supabaseClient
                    .from("profiles")
                    .select(
                        "username, avatar_url"
                    )
                    .in("username", [
                        rawUsername,
                        baseUsername,
                        `${baseUsername}@bean`
                    ]);

            const profile =
                profiles?.[0];

            const avatarPath =
                profile?.avatar_url ||
                currentUser?.avatar_url;

            if (!avatarPath) {
                return;
            }

            const finalAvatarUrl =
                avatarPath.startsWith("http")
                    ? avatarPath
                    : `${SUPABASE_URL}/storage/v1/object/public/avatars/${encodeURIComponent(
                          avatarPath
                              .split("/")
                              .pop()
                      )}`;

            const image = new Image();

            image.onload = () => {
                userAvatar.style.backgroundImage =
                    `url("${finalAvatarUrl}")`;

                userAvatar.textContent = "";
            };

            image.src = finalAvatarUrl;
        } catch (error) {
            console.warn(
                "Avatar loading failed:",
                error
            );
        }
    }

    function updateBodySidebarState() {
        const isCollapsed =
            sidebar?.classList.contains(
                "collapsed"
            );

        document.body.classList.toggle(
            "sidebar-collapsed",
            Boolean(isCollapsed)
        );
    }

    // FILE PROCESSING
    function getFileTypeCategory(file) {
        const mime =
            file.type.toLowerCase();

        const extension =
            file.name
                .split(".")
                .pop()
                .toLowerCase();

        if (mime.startsWith("image/")) {
            return "image";
        }

        if (
            [
                "js",
                "ts",
                "py",
                "java",
                "html",
                "css",
                "json",
                "cpp"
            ].includes(extension)
        ) {
            return "code";
        }

        return "document";
    }

    function getCategoryIcon(category) {
        if (category === "image") {
            return "image";
        }

        if (category === "code") {
            return "code";
        }

        return "file-text";
    }

    async function handleFileProcessing(files) {
        if (!files || files.length === 0) {
            return;
        }

        for (const file of files) {
            if (!checkFilePermissionForPlan(file)) {
                continue;
            }

            if (
                attachedFiles.length >=
                MAX_ATTACHED_FILES
            ) {
                alert(
                    `Maximum ${MAX_ATTACHED_FILES} files allowed.`
                );

                break;
            }

            if (
                file.size >
                MAX_FILE_SIZE_BYTES
            ) {
                alert(
                    `File "${file.name}" exceeds 15MB limit.`
                );

                continue;
            }

            const category =
                getFileTypeCategory(file);

            const fileData =
                category === "image"
                    ? await readFileAsBase64(file)
                    : await readFileAsText(file);

            attachedFiles.push({
                id:
                    "file_" +
                    Math.random()
                        .toString(36)
                        .substring(2, 9),
                fileObject: file,
                name: file.name,
                category,
                data: fileData
            });
        }

        renderAttachedChips();
        renderAdaptiveSuggestions();
        updateComposerShape();
    }

    function readFileAsBase64(file) {
        return new Promise(
            (resolve, reject) => {
                const reader =
                    new FileReader();

                reader.onload = () =>
                    resolve(reader.result);

                reader.onerror = () =>
                    reject(
                        new Error(
                            "Unable to read file."
                        )
                    );

                reader.readAsDataURL(file);
            }
        );
    }

    function readFileAsText(file) {
        return new Promise(
            (resolve, reject) => {
                const reader =
                    new FileReader();

                reader.onload = () =>
                    resolve(reader.result);

                reader.onerror = () =>
                    reject(
                        new Error(
                            "Unable to read file."
                        )
                    );

                reader.readAsText(file);
            }
        );
    }

    function renderAttachedChips() {
        if (!attachedChipsWrapper) {
            return;
        }

        attachedChipsWrapper.innerHTML = "";

        attachedFiles.forEach(item => {
            if (item.category === "image") {
                const imageChip =
                    document.createElement("div");

                imageChip.className =
                    "image-preview-chip";

                const image =
                    document.createElement("img");

                image.src = item.data;
                image.alt = item.name;
                image.title = item.name;

                const removeButton =
                    document.createElement("button");

                removeButton.className =
                    "chip-remove-btn";

                removeButton.type = "button";
                removeButton.textContent = "×";

                removeButton.onclick = () => {
                    attachedFiles =
                        attachedFiles.filter(
                            file =>
                                file.id !== item.id
                        );

                    renderAttachedChips();
                    renderAdaptiveSuggestions();
                    updateComposerShape();
                };

                imageChip.appendChild(image);
                imageChip.appendChild(
                    removeButton
                );

                attachedChipsWrapper.appendChild(
                    imageChip
                );

                return;
            }

            const chip =
                document.createElement("div");

            chip.className = "file-chip";

            const icon =
                document.createElement("i");

            icon.setAttribute(
                "data-lucide",
                getCategoryIcon(
                    item.category
                )
            );

            icon.setAttribute("size", "14");

            const nameSpan =
                document.createElement("span");

            nameSpan.textContent = item.name;
            nameSpan.title = item.name;

            const removeButton =
                document.createElement("button");

            removeButton.className =
                "file-chip-remove";

            removeButton.type = "button";
            removeButton.textContent = "×";

            removeButton.onclick = () => {
                attachedFiles =
                    attachedFiles.filter(
                        file =>
                            file.id !== item.id
                    );

                renderAttachedChips();
                renderAdaptiveSuggestions();
                updateComposerShape();
            };

            chip.appendChild(icon);
            chip.appendChild(nameSpan);
            chip.appendChild(removeButton);

            attachedChipsWrapper.appendChild(
                chip
            );
        });

        if (window.lucide) {
            window.lucide.createIcons();
        }

        updateComposerShape();
    }

    function renderAdaptiveSuggestions() {
        if (!liveSuggestions) {
            return;
        }

        const suggestions =
            attachedFiles.length > 0
                ? [
                      {
                          icon: "search",
                          label:
                              "Summarize / Describe",
                          prompt:
                              "Analyze and describe the attached files."
                      }
                  ]
                : [
                      {
                          icon: "search",
                          label: "Research",
                          prefix:
                              "Research on: "
                      },
                      {
                          icon: "lightbulb",
                          label: "Brainstorm",
                          prefix:
                              "Brainstorm ideas for: "
                      }
                  ];

        liveSuggestions.innerHTML = "";

        suggestions.forEach(item => {
            const button =
                document.createElement(
                    "button"
                );

            button.className =
                "suggestion-chip";

            const icon =
                document.createElement("i");

            icon.setAttribute(
                "data-lucide",
                item.icon
            );

            icon.setAttribute("size", "14");

            const label =
                document.createElement("span");

            label.textContent = item.label;

            button.appendChild(icon);
            button.appendChild(label);

            button.onclick = () => {
                if (!chatInput) {
                    return;
                }

                chatInput.value =
                    item.prompt ||
                    item.prefix ||
                    "";

                chatInput.focus();
                updateComposerShape();
            };

            liveSuggestions.appendChild(
                button
            );
        });

        if (window.lucide) {
            window.lucide.createIcons();
        }
    }

    function setupDragAndDrop() {
        if (
            !composerWrapper ||
            !dragDropOverlay
        ) {
            return;
        }

        [
            "dragenter",
            "dragover",
            "dragleave",
            "drop"
        ].forEach(eventName => {
            composerWrapper.addEventListener(
                eventName,
                event => {
                    event.preventDefault();
                    event.stopPropagation();
                }
            );
        });

        composerWrapper.addEventListener(
            "dragenter",
            () => {
                dragDropOverlay.classList.add(
                    "active"
                );
            }
        );

        composerWrapper.addEventListener(
            "dragover",
            () => {
                dragDropOverlay.classList.add(
                    "active"
                );
            }
        );

        dragDropOverlay.addEventListener(
            "dragleave",
            () => {
                dragDropOverlay.classList.remove(
                    "active"
                );
            }
        );

        composerWrapper.addEventListener(
            "drop",
            event => {
                dragDropOverlay.classList.remove(
                    "active"
                );

                if (
                    event.dataTransfer?.files
                ) {
                    handleFileProcessing(
                        Array.from(
                            event.dataTransfer.files
                        )
                    );
                }
            }
        );
    }

    function setupPasteUpload() {
        chatInput?.addEventListener(
            "paste",
            event => {
                const files =
                    Array.from(
                        event.clipboardData
                            ?.items || []
                    )
                        .filter(
                            item =>
                                item.kind ===
                                "file"
                        )
                        .map(item =>
                            item.getAsFile()
                        )
                        .filter(Boolean);

                if (files.length > 0) {
                    handleFileProcessing(files);
                }
            }
        );
    }

    async function loadHistoryFromSupabase() {
        if (!historyList) {
            return;
        }

        try {
            const response = await fetch(
                "/api/history",
                {
                    method: "POST",
                    credentials: "include",
                    headers: {
                        "Content-Type":
                            "application/json",
                        Accept:
                            "application/json"
                    },
                    cache: "no-store",
                    body: JSON.stringify({
                        action: "list",
                        limit: 100
                    })
                }
            );

            const data =
                await readJsonResponse(
                    response
                );

            historyList.innerHTML = "";

            const conversations =
                Array.isArray(
                    data.conversations
                )
                    ? data.conversations
                    : Array.isArray(
                          data.history
                      )
                    ? data.history
                    : [];

            if (
                conversations.length === 0
            ) {
                const emptyState =
                    document.createElement(
                        "div"
                    );

                emptyState.style.padding =
                    "10px";

                emptyState.style.color =
                    "var(--text-muted)";

                emptyState.style.fontSize =
                    "12px";

                emptyState.textContent =
                    "No recent chats";

                historyList.appendChild(
                    emptyState
                );

                return;
            }

            conversations.forEach(chat => {
                const item =
                    document.createElement(
                        "div"
                    );

                item.className =
                    `history-item ${
                        currentConversationId ===
                        chat.id
                            ? "active"
                            : ""
                    }`;

                const title =
                    document.createElement(
                        "span"
                    );

                title.className =
                    "history-item-title";

                title.textContent =
                    chat.title ||
                    "New Chat";

                const actions =
                    document.createElement(
                        "div"
                    );

                actions.className =
                    "history-item-actions";

                const actionButton =
                    document.createElement(
                        "button"
                    );

                actionButton.className =
                    "history-action-btn";

                actionButton.type =
                    "button";

                actionButton.setAttribute(
                    "aria-label",
                    "Conversation options"
                );

                actionButton.innerHTML =
                    '<i data-lucide="more-horizontal" size="14"></i>';

                actionButton.onclick =
                    event => {
                        event.stopPropagation();

                        activePopupChatId =
                            chat.id;

                        const rect =
                            event.currentTarget.getBoundingClientRect();

                        historyPopupMenu?.classList.add(
                            "show"
                        );

                        if (
                            historyPopupMenu
                        ) {
                            historyPopupMenu.style.top =
                                `${rect.bottom}px`;

                            historyPopupMenu.style.left =
                                `${rect.left}px`;
                        }
                    };

                actions.appendChild(
                    actionButton
                );

                item.appendChild(title);
                item.appendChild(actions);

                item.onclick = () => {
                    loadChatMessages(chat.id);
                };

                historyList.appendChild(item);
            });

            if (window.lucide) {
                window.lucide.createIcons();
            }
        } catch (error) {
            console.error(
                "History loading failed:",
                error
            );

            if (historyList) {
                historyList.innerHTML = "";

                const errorState =
                    document.createElement(
                        "div"
                    );

                errorState.style.padding =
                    "10px";

                errorState.style.color =
                    "var(--text-muted)";

                errorState.style.fontSize =
                    "12px";

                errorState.textContent =
                    "Unable to load recent chats";

                historyList.appendChild(
                    errorState
                );
            }
        }
    }

    hpDeleteBtn?.addEventListener(
        "click",
        async () => {
            if (!activePopupChatId) {
                return;
            }

            const conversationToDelete =
                activePopupChatId;

            try {
                const response = await fetch(
                    "/api/history",
                    {
                        method: "POST",
                        credentials:
                            "include",
                        headers: {
                            "Content-Type":
                                "application/json",
                            Accept:
                                "application/json"
                        },
                        body: JSON.stringify({
                            action: "delete",
                            conversationId:
                                conversationToDelete
                        })
                    }
                );

                await readJsonResponse(
                    response
                );

                if (
                    currentConversationId ===
                    conversationToDelete
                ) {
                    startNewConversation();
                } else {
                    await loadHistoryFromSupabase();
                }
            } catch (error) {
                console.error(
                    "Conversation deletion failed:",
                    error
                );

                alert(error.message);
            } finally {
                activePopupChatId = null;

                historyPopupMenu?.classList.remove(
                    "show"
                );
            }
        }
    );

    async function loadChatMessages(
        conversationId
    ) {
        if (!conversationId) {
            return;
        }

        try {
            const response = await fetch(
                "/api/history",
                {
                    method: "POST",
                    credentials: "include",
                    headers: {
                        "Content-Type":
                            "application/json",
                        Accept:
                            "application/json"
                    },
                    cache: "no-store",
                    body: JSON.stringify({
                        action: "get",
                        conversationId
                    })
                }
            );

            const data =
                await readJsonResponse(
                    response
                );

            currentConversationId =
                conversationId;

            conversation = (
                data.messages || []
            ).map(message => ({
                role: message.role,
                content:
                    message.content || ""
            }));

            if (chatMessages) {
                chatMessages.innerHTML = "";
            }

            if (heroSection) {
                heroSection.style.display =
                    "none";
            }

            conversation.forEach(
                (message, index) => {
                    if (
                        message.role !==
                        "system"
                    ) {
                        renderMessageToUI(
                            message.role,
                            message.content,
                            index
                        );
                    }
                }
            );

            await loadHistoryFromSupabase();

            if (
                window.innerWidth < 768
            ) {
                sidebar?.classList.add(
                    "collapsed"
                );

                sidebarScrim?.classList.remove(
                    "visible"
                );

                updateBodySidebarState();
            }
        } catch (error) {
            console.error(
                "Conversation loading failed:",
                error
            );

            alert(error.message);
        }
    }

    function renderMessageToUI(
        role,
        content,
        messageIndex = null,
        isThinking = false
    ) {
        if (!chatMessages) {
            return null;
        }

        const message =
            document.createElement("div");

        message.className =
            `message ${role} ${
                isThinking
                    ? "is-thinking"
                    : ""
            }`;

        if (messageIndex !== null) {
            message.setAttribute(
                "data-msg-index",
                String(messageIndex)
            );
        }

        if (role === "user") {
            renderUserMessageWrapper(
                message,
                content,
                messageIndex
            );
        } else {
            const contentElement =
                document.createElement(
                    "div"
                );

            contentElement.className =
                "message-content";

            if (isThinking) {
                const thinking =
                    document.createElement(
                        "span"
                    );

                thinking.className =
                    "thinking-shimmer";

                thinking.textContent =
                    "Thinking...";

                contentElement.appendChild(
                    thinking
                );
            } else {
                contentElement.innerHTML =
                    safeParseMarkdown(content);
            }

            message.appendChild(
                contentElement
            );

            const actions =
                document.createElement(
                    "div"
                );

            actions.className =
                "message-actions";

            actions.innerHTML = `
                <button class="msg-action-btn copy-msg-btn" title="Copy" type="button">
                    <i data-lucide="copy" size="16"></i>
                </button>
                <button class="msg-action-btn share-msg-btn" title="Share" type="button">
                    <i data-lucide="share-2" size="16"></i>
                </button>
                <button class="msg-action-btn regen-msg-btn" title="Regenerate" type="button">
                    <i data-lucide="rotate-cw" size="16"></i>
                </button>
            `;

            message.appendChild(actions);
        }

        chatMessages.appendChild(message);

        if (scrollArea) {
            scrollArea.scrollTop =
                scrollArea.scrollHeight;
        }

        if (window.lucide) {
            window.lucide.createIcons();
        }

        return message;
    }

    function renderUserMessageWrapper(
        containerElement,
        textContent,
        index
    ) {
        containerElement.innerHTML = "";

        const wrapper =
            document.createElement("div");

        wrapper.className =
            "message-wrapper";

        const content =
            document.createElement("div");

        content.className =
            "message-content";

        content.textContent =
            textContent;

        const actions =
            document.createElement("div");

        actions.className =
            "user-msg-actions";

        const editButton =
            document.createElement(
                "button"
            );

        editButton.className =
            "user-action-btn user-edit-btn";

        editButton.type = "button";
        editButton.title =
            "Edit message";

        editButton.innerHTML =
            '<i data-lucide="pencil" size="14"></i>';

        editButton.onclick = () => {
            enableUserMessageEdit(
                containerElement,
                textContent,
                index
            );
        };

        const copyButton =
            document.createElement(
                "button"
            );

        copyButton.className =
            "user-action-btn user-copy-btn";

        copyButton.type = "button";
        copyButton.title =
            "Copy text";

        copyButton.innerHTML =
            '<i data-lucide="copy" size="14"></i>';

        copyButton.onclick = () => {
            copyWithFeedback(
                textContent,
                copyButton,
                14
            );
        };

        actions.appendChild(editButton);
        actions.appendChild(copyButton);

        wrapper.appendChild(content);
        wrapper.appendChild(actions);

        containerElement.appendChild(
            wrapper
        );

        if (window.lucide) {
            window.lucide.createIcons();
        }
    }

    function enableUserMessageEdit(
        messageElement,
        originalText,
        index
    ) {
        if (isGenerating) {
            return;
        }

        messageElement.innerHTML = "";

        const editBox =
            document.createElement("div");

        editBox.className =
            "edit-message-box";

        const textarea =
            document.createElement(
                "textarea"
            );

        textarea.className =
            "edit-textarea";

        textarea.rows = 2;
        textarea.value = originalText;

        const actions =
            document.createElement("div");

        actions.className =
            "edit-actions";

        const cancelButton =
            document.createElement(
                "button"
            );

        cancelButton.className =
            "edit-btn-cancel";

        cancelButton.type = "button";
        cancelButton.textContent =
            "Cancel";

        const saveButton =
            document.createElement(
                "button"
            );

        saveButton.className =
            "edit-btn-save";

        saveButton.type = "button";
        saveButton.textContent =
            "Save & Submit";

        actions.appendChild(
            cancelButton
        );

        actions.appendChild(
            saveButton
        );

        editBox.appendChild(textarea);
        editBox.appendChild(actions);

        messageElement.appendChild(
            editBox
        );

        textarea.focus();

        cancelButton.onclick = () => {
            renderUserMessageWrapper(
                messageElement,
                originalText,
                index
            );
        };

        saveButton.onclick = () => {
            const updatedText =
                textarea.value.trim();

            if (updatedText) {
                handleEditedSend(
                    updatedText,
                    index,
                    messageElement
                );
            }
        };
    }

    async function handleEditedSend(
        newText,
        targetIndex,
        messageElement
    ) {
        if (isGenerating) {
            return;
        }

        isGenerating = true;

        try {
            let actualIndex =
                targetIndex;

            if (
                actualIndex === null ||
                actualIndex === undefined ||
                actualIndex < 0
            ) {
                actualIndex =
                    conversation.findIndex(
                        message =>
                            message.role ===
                                "user" &&
                            message.content ===
                                newText
                    );
            }

            if (
                actualIndex !== -1 &&
                actualIndex <
                    conversation.length
            ) {
                conversation =
                    conversation.slice(
                        0,
                        actualIndex
                    );

                let current =
                    messageElement;

                while (
                    current.nextElementSibling
                ) {
                    current.nextElementSibling.remove();
                }
            }

            renderUserMessageWrapper(
                messageElement,
                newText,
                conversation.length
            );

            conversation.push({
                role: "user",
                content: newText
            });

            const aiBubble =
                renderMessageToUI(
                    "assistant",
                    "",
                    null,
                    true
                );

            await submitChatRequest(
                aiBubble
            );
        } catch (error) {
            console.error(
                "Edited message send failed:",
                error
            );

            isGenerating = false;
        }
    }

    function copyWithFeedback(
        text,
        button,
        size = 16
    ) {
        if (
            !navigator.clipboard ||
            !button
        ) {
            return;
        }

        navigator.clipboard
            .writeText(text)
            .then(() => {
                button.innerHTML =
                    `<i data-lucide="check" size="${size}" style="color:#10b981;"></i>`;

                if (window.lucide) {
                    window.lucide.createIcons();
                }

                setTimeout(() => {
                    button.innerHTML =
                        `<i data-lucide="copy" size="${size}"></i>`;

                    if (window.lucide) {
                        window.lucide.createIcons();
                    }
                }, 2000);
            })
            .catch(() => {});
    }

    chatMessages?.addEventListener(
        "click",
        event => {
            const button =
                event.target.closest(
                    ".msg-action-btn"
                );

            if (!button) {
                return;
            }

            const message =
                button.closest(
                    ".message"
                );

            const text =
                message
                    ?.querySelector(
                        ".message-content"
                    )
                    ?.innerText || "";

            if (
                button.classList.contains(
                    "copy-msg-btn"
                )
            ) {
                copyWithFeedback(
                    text,
                    button
                );

                return;
            }

            if (
                button.classList.contains(
                    "share-msg-btn"
                ) &&
                navigator.share
            ) {
                navigator
                    .share({ text })
                    .catch(() => {});

                return;
            }

            if (
                button.classList.contains(
                    "regen-msg-btn"
                )
            ) {
                const lastUser =
                    conversation
                        .slice()
                        .reverse()
                        .find(
                            item =>
                                item.role ===
                                "user"
                        );

                if (
                    lastUser &&
                    !isGenerating &&
                    chatInput
                ) {
                    chatInput.value =
                        lastUser.content;

                    handleSend();
                }
            }
        }
    );

    async function handleSend() {
        if (isGenerating) {
            return;
        }

        const text =
            chatInput?.value.trim() ||
            "";

        if (
            !text &&
            attachedFiles.length === 0
        ) {
            return;
        }

        isGenerating = true;

        try {
            if (chatInput) {
                chatInput.value = "";
                chatInput.style.height =
                    "auto";
            }

            if (heroSection) {
                heroSection.style.display =
                    "none";
            }

            let fullContent = text;

            if (
                attachedFiles.length > 0
            ) {
                const attachments =
                    attachedFiles
                        .map(
                            file =>
                                `[Attached ${file.category}: ${file.name}]\n${file.data}`
                        )
                        .join("\n\n");

                fullContent =
                    `${text}\n\n${attachments}`.trim();
            }

            const messageIndex =
                conversation.length;

            renderMessageToUI(
                "user",
                text ||
                    `[Uploaded ${attachedFiles.length} file(s)]`,
                messageIndex
            );

            conversation.push({
                role: "user",
                content: fullContent
            });

            attachedFiles = [];

            renderAttachedChips();
            renderAdaptiveSuggestions();
            updateComposerShape();

            const aiBubble =
                renderMessageToUI(
                    "assistant",
                    "",
                    null,
                    true
                );

            await submitChatRequest(
                aiBubble
            );
        } catch (error) {
            console.error(
                "Send failed:",
                error
            );

            isGenerating = false;
        }
    }

    async function submitChatRequest(
        aiBubble
    ) {
        try {
            const response = await fetch(
                "/api/chat",
                {
                    method: "POST",
                    credentials: "include",
                    headers: {
                        "Content-Type":
                            "application/json",
                        Accept:
                            "application/json"
                    },
                    body: JSON.stringify({
                        messages:
                            conversation,
                        conversationId:
                            currentConversationId,
                        isDeepResearch:
                            isDeepResearchMode,
                        memoryContext:
                            localStorage.getItem(
                                "neo_user_memories"
                            ) || ""
                    })
                }
            );

            const data =
                await readJsonResponse(
                    response
                );

            if (data.conversationId) {
                currentConversationId =
                    data.conversationId;
            }

            const reply =
                data?.choices?.[0]
                    ?.message?.content;

            if (
                typeof reply !==
                    "string" ||
                !reply.trim()
            ) {
                throw new Error(
                    "The AI response was empty."
                );
            }

            if (aiBubble) {
                aiBubble.classList.remove(
                    "is-thinking"
                );

                const content =
                    aiBubble.querySelector(
                        ".message-content"
                    );

                if (content) {
                    content.style.color = "";
                    content.innerHTML =
                        safeParseMarkdown(
                            reply
                        );
                }

                if (window.lucide) {
                    window.lucide.createIcons();
                }
            }

            conversation.push({
                role: "assistant",
                content: reply
            });

            await loadHistoryFromSupabase();
        } catch (error) {
            console.error(
                "Chat request failed:",
                error
            );

            if (aiBubble) {
                aiBubble.classList.remove(
                    "is-thinking"
                );

                const content =
                    aiBubble.querySelector(
                        ".message-content"
                    );

                if (content) {
                    content.textContent =
                        `Error: ${error.message}`;

                    content.style.color =
                        "#ef4444";
                }
            }
        } finally {
            isGenerating = false;
        }
    }

    function startNewConversation() {
        conversation = [];
        attachedFiles = [];
        currentConversationId = null;
        activePopupChatId = null;

        if (chatMessages) {
            chatMessages.innerHTML = "";
        }

        if (heroSection) {
            heroSection.style.display =
                "block";
        }

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
                headers: {
                    "Content-Type":
                        "application/json",
                    Accept:
                        "application/json"
                },
                body: JSON.stringify({
                    action: "logout"
                })
            });
        } catch (error) {
            console.warn(
                "Server logout failed:",
                error
            );
        } finally {
            clearLegacyUserStorage();

            localStorage.removeItem(
                "neo_user_memories"
            );

            window.location.replace(
                "signup.html"
            );
        }
    }

    function setupEventListeners() {
        sendBtn?.addEventListener(
            "click",
            handleSend
        );

        chatInput?.addEventListener(
            "keydown",
            event => {
                if (
                    event.key === "Enter" &&
                    !event.shiftKey
                ) {
                    event.preventDefault();
                    handleSend();
                }
            }
        );

        chatInput?.addEventListener(
            "input",
            function () {
                this.style.height = "auto";

                this.style.height =
                    `${Math.min(
                        this.scrollHeight,
                        160
                    )}px`;

                updateComposerShape();
            }
        );

        attachBtn?.addEventListener(
            "click",
            event => {
                event.stopPropagation();

                attachPopupMenu?.classList.toggle(
                    "show"
                );
            }
        );

        addFilesMenuBtn?.addEventListener(
            "click",
            () => {
                attachPopupMenu?.classList.remove(
                    "show"
                );

                hiddenFileInput?.click();
            }
        );

        deepResearchToggleBtn?.addEventListener(
            "click",
            event => {
                event.stopPropagation();

                isDeepResearchMode =
                    !isDeepResearchMode;

                deepResearchToggleBtn.classList.toggle(
                    "active-mode",
                    isDeepResearchMode
                );
            }
        );

        personalMemoryBtn?.addEventListener(
            "click",
            event => {
                event.stopPropagation();

                attachPopupMenu?.classList.remove(
                    "show"
                );

                const memory = prompt(
                    "Update Memory:",
                    localStorage.getItem(
                        "neo_user_memories"
                    ) || ""
                );

                if (memory !== null) {
                    localStorage.setItem(
                        "neo_user_memories",
                        memory.trim()
                    );
                }
            }
        );

        hiddenFileInput?.addEventListener(
            "change",
            event => {
                if (
                    event.target.files
                ) {
                    handleFileProcessing(
                        Array.from(
                            event.target.files
                        )
                    );
                }

                event.target.value = "";
            }
        );

        const toggleSidebar = () => {
            sidebar?.classList.toggle(
                "collapsed"
            );

            const isOpen =
                !sidebar?.classList.contains(
                    "collapsed"
                );

            sidebarScrim?.classList.toggle(
                "visible",
                isOpen
            );

            updateBodySidebarState();
        };

        sidebarToggleBtn?.addEventListener(
            "click",
            toggleSidebar
        );

        collapseSidebarBtn?.addEventListener(
            "click",
            toggleSidebar
        );

        sidebarScrim?.addEventListener(
            "click",
            toggleSidebar
        );

        newChatBtn?.addEventListener(
            "click",
            () => {
                startNewConversation();

                if (
                    window.innerWidth <
                    768
                ) {
                    sidebar?.classList.add(
                        "collapsed"
                    );

                    sidebarScrim?.classList.remove(
                        "visible"
                    );

                    updateBodySidebarState();
                }
            }
        );

        document
            .querySelectorAll(
                "[data-prompt]"
            )
            .forEach(button => {
                button.addEventListener(
                    "click",
                    () => {
                        if (!chatInput) {
                            return;
                        }

                        chatInput.value =
                            button.getAttribute(
                                "data-prompt"
                            ) || "";

                        handleSend();
                    }
                );
            });

        userProfileBtn?.addEventListener(
            "click",
            event => {
                event.stopPropagation();

                userPopupMenu?.classList.toggle(
                    "show"
                );
            }
        );

        document.addEventListener(
            "click",
            event => {
                if (
                    !userProfileBtn?.contains(
                        event.target
                    ) &&
                    !userPopupMenu?.contains(
                        event.target
                    )
                ) {
                    userPopupMenu?.classList.remove(
                        "show"
                    );
                }

                if (
                    !historyPopupMenu?.contains(
                        event.target
                    ) &&
                    !event.target.closest(
                        ".history-action-btn"
                    )
                ) {
                    historyPopupMenu?.classList.remove(
                        "show"
                    );
                }

                if (
                    !attachBtn?.contains(
                        event.target
                    ) &&
                    !attachPopupMenu?.contains(
                        event.target
                    )
                ) {
                    attachPopupMenu?.classList.remove(
                        "show"
                    );
                }

                if (
                    !modelBadgeBtn?.contains(
                        event.target
                    ) &&
                    !modelDropdownMenu?.contains(
                        event.target
                    )
                ) {
                    modelDropdownMenu?.classList.remove(
                        "show"
                    );
                }
            }
        );

        document
            .getElementById("brandBtn")
            ?.addEventListener(
                "click",
                () => {
                    window.location.href =
                        "index.html";
                }
            );

        document
            .getElementById("logoutBtn")
            ?.addEventListener(
                "click",
                logoutUser
            );
    }

    document.addEventListener('DOMContentLoaded', () => {
        init().catch((error) => {
            console.error('NEO initialization failed:', error);
            const banner = document.createElement('div');
            banner.className = 'neo-runtime-error';
            banner.textContent = 'NEO could not initialize. Refresh the page or redeploy the latest build.';
            document.body.appendChild(banner);
        });
    });
})();
