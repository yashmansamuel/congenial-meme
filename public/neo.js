// neo.js – Complete Frontend Application

(function () {
    "use strict";

    // SECURITY CONSTANTS & CONFIGS
    const MAX_FILE_SIZE_BYTES = 4 * 1024 * 1024;
    const MAX_ATTACHED_FILES = 5;
    const MEDIA_BUCKET = "uploads";
    const SIGNED_URL_EXPIRY_SECONDS = 300;
    const MEDIA_UPLOAD_TIMEOUT_MS = 60_000;

    const SUPABASE_URL =
        "https://ujclhweqqifgoiscvqmd.supabase.co";

    const SUPABASE_ANON_KEY =
        "sb_publishable_soPYxakWGl9MTrzCjdjt2w_fR1jsVVf";

    let supabaseClient = null;

    if (
        window.supabase &&
        window.supabase.createClient
    ) {
        supabaseClient =
            window.supabase.createClient(
                SUPABASE_URL,
                SUPABASE_ANON_KEY
            );
    }

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
    let selectedModel = "l1.0";
    let userPlan = "free";

    // MEDIA PREVIEW MAP (local session only)
    const sessionMediaPreviews = new Map();

    // DOM ELEMENTS
    const chatInput =
        document.getElementById("chatInput");

    const sendBtn =
        document.getElementById("sendBtn");

    const chatMessages =
        document.getElementById("chatMessages");

    const scrollArea =
        document.getElementById("scrollArea");

    const heroSection =
        document.getElementById("heroSection");

    const historyList =
        document.getElementById("historyList");

    const sidebar =
        document.getElementById("sidebar");

    const sidebarToggleBtn =
        document.getElementById(
            "sidebarToggleBtn"
        );

    const collapseSidebarBtn =
        document.getElementById(
            "collapseSidebarBtn"
        );

    const newChatBtn =
        document.getElementById("newChatBtn");

    const topBarDarkModeToggle =
        document.getElementById(
            "topBarDarkModeToggle"
        );

    const sidebarDarkModeToggle =
        document.getElementById(
            "sidebarDarkModeToggle"
        );

    const sidebarScrim =
        document.getElementById(
            "sidebarScrim"
        );

    const userAvatar =
        document.getElementById(
            "userAvatar"
        );

    const userNameDisplay =
        document.getElementById(
            "userNameDisplay"
        );

    const userPlanBadge =
        document.getElementById(
            "userPlanBadge"
        );

    const userProfileBtn =
        document.getElementById(
            "userProfileBtn"
        );

    const userPopupMenu =
        document.getElementById(
            "userPopupMenu"
        );

    const historyPopupMenu =
        document.getElementById(
            "historyPopupMenu"
        );

    const hpDeleteBtn =
        document.getElementById(
            "hpDeleteBtn"
        );

    const hpShareBtn =
        document.getElementById("hpShareBtn");
    const hpPinBtn =
        document.getElementById("hpPinBtn");
    const hpRenameBtn =
        document.getElementById("hpRenameBtn");

    // COMPOSER ELEMENTS
    const attachBtn =
        document.getElementById(
            "attachBtn"
        );

    const attachPopupMenu =
        document.getElementById(
            "attachPopupMenu"
        );

    const addFilesMenuBtn =
        document.getElementById(
            "addFilesMenuBtn"
        );

    const deepResearchToggleBtn =
        document.getElementById(
            "deepResearchToggleBtn"
        );

    const personalMemoryBtn =
        document.getElementById(
            "personalMemoryBtn"
        );

    const hiddenFileInput =
        document.getElementById(
            "hiddenFileInput"
        );

    const liveSuggestions =
        document.getElementById(
            "liveSuggestions"
        );

    const attachedChipsWrapper =
        document.getElementById(
            "attachedChipsWrapper"
        );

    const composerWrapper =
        document.getElementById(
            "composerWrapper"
        );

    const dragDropOverlay =
        document.getElementById(
            "dragDropOverlay"
        );

    const micBtn =
        document.getElementById("micBtn");

    const stopRecBtn =
        document.getElementById(
            "stopRecBtn"
        );

    const composerInputRow =
        document.querySelector(
            ".composer-input-row"
        );

    const glassInputContainer =
        document.getElementById(
            "glassInputContainer"
        );

    // FREEMIUM ELEMENTS
    const modelBadgeBtn =
        document.getElementById(
            "modelBadgeBtn"
        );

    const modelDropdownMenu =
        document.getElementById(
            "modelDropdownMenu"
        );

    const currentModelDisplay =
        document.getElementById(
            "currentModelDisplay"
        );

    const optL10 =
        document.getElementById(
            "optL10"
        );

    const optL12 =
        document.getElementById(
            "optL12"
        );

    const upgradeModal =
        document.getElementById(
            "upgradeModal"
        );

    const modalCloseBtn =
        document.getElementById(
            "modalCloseBtn"
        );

    const modalMaybeLaterBtn =
        document.getElementById(
            "modalMaybeLaterBtn"
        );

    const upgradeActionBtn =
        document.getElementById(
            "upgradeActionBtn"
        );

    // NEW DOM ELEMENTS FOR SETTINGS & PERSONALITIES
    const neoSettingsOverlay =
        document.getElementById(
            "neoSettingsOverlay"
        );

    const sidebarPersonalitiesBtn =
        document.getElementById(
            "sidebarPersonalitiesBtn"
        );

    // ---- Settings UI Elements (assumed present) ----
    const settingsCloseBtn =
        document.getElementById("settingsCloseBtn");
    const settingsTabs =
        document.querySelectorAll(".neo-settings-tab");
    const settingsPanels =
        document.querySelectorAll(".neo-settings-panel");
    const settingsSaveBtn =
        document.getElementById("settingsSaveBtn");
    const settingsResetBtn =
        document.getElementById("settingsResetBtn");
    const settingsBillingBtn =
        document.getElementById("settingsBillingBtn");
    const settingsThemeBtn =
        document.getElementById("settingsThemeBtn");

    // --------------------------------------------------------
    //  HELPER: makeConversationTitle
    // --------------------------------------------------------
    function makeConversationTitle(text, files = []) {
        const cleanText = String(text || "").trim();

        if (cleanText) {
            return cleanText.slice(0, 48);
        }

        if (files.length > 0) {
            const imageCount = files.filter(file => file.type && file.type.startsWith("image/")).length;

            if (imageCount > 0) {
                return imageCount === 1 ? "Image upload" : `${imageCount} images uploaded`;
            }

            return files.length === 1 ? "File upload" : `${files.length} files uploaded`;
        }

        return "New conversation";
    }

    // --------------------------------------------------------
    //  INIT
    // --------------------------------------------------------
    async function init() {
        if (window.lucide) {
            window.lucide.createIcons();
        }

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

        const authenticated =
            await restoreSecureSession();

        if (!authenticated) {
            return;
        }

        try {
            await renderUserProfile();
        } catch (error) {
            console.warn(
                "Profile initialization failed:",
                error
            );
        }

        try {
            await loadHistoryFromSupabase();
        } catch (error) {
            console.warn(
                "History initialization failed:",
                error
            );
        }

        chatInput?.focus();
    }

    // --------------------------------------------------------
    //  SESSION / AUTH
    // --------------------------------------------------------
    async function restoreSecureSession() {
        try {
            const response =
                await fetch(
                    "/api/auth",
                    {
                        method: "GET",
                        credentials: "include",

                        headers: {
                            Accept:
                                "application/json"
                        },

                        cache: "no-store"
                    }
                );

            const data =
                await response
                    .json()
                    .catch(() => ({}));

            if (
                !response.ok ||
                !data.authenticated ||
                !data.user
            ) {
                clearLegacyUserStorage();

                window.location.replace(
                    "signup.html"
                );

                return false;
            }

            const rawPlan =
                String(
                    data.user.planType ||
                        "free"
                )
                    .trim()
                    .toLowerCase();

            userPlan = [
                "pro",
                "neo_pro",
                "neo-pro",
                "premium",
                "business",
                "suite"
            ].includes(rawPlan)
                ? "pro"
                : "free";

            currentUser = {
                id:
                    data.user.id,

                username:
                    data.user.username ||
                    "user",

                planType:
                    userPlan
            };

            localStorage.setItem(
                "signaturesi_user",
                JSON.stringify(
                    currentUser
                )
            );

            return true;
        } catch (error) {
            console.error(
                "Session restore failed:",
                error
            );

            window.location.replace(
                "signup.html"
            );

            return false;
        }
    }

    function clearLegacyUserStorage() {
        localStorage.removeItem(
            "signaturesi_user"
        );

        localStorage.removeItem(
            "bean_user"
        );

        localStorage.removeItem(
            "user"
        );

        localStorage.removeItem(
            "userData"
        );
    }

    // --------------------------------------------------------
    //  SECURITY / THEME
    // --------------------------------------------------------
    function configureSecurityHooks() {
        if (!window.DOMPurify) {
            return;
        }

        window.DOMPurify.addHook(
            "afterSanitizeAttributes",

            function (node) {
                if ("target" in node) {
                    node.setAttribute(
                        "target",
                        "_blank"
                    );

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
            localStorage.getItem(
                "neo_theme"
            ) === "dark";

        document.body.classList.toggle(
            "dark-mode",
            isDark
        );

        const toggle = () => {
            document.body.classList.toggle(
                "dark-mode"
            );

            localStorage.setItem(
                "neo_theme",

                document.body.classList.contains(
                    "dark-mode"
                )
                    ? "dark"
                    : "light"
            );
        };

        topBarDarkModeToggle
            ?.addEventListener(
                "click",
                toggle
            );

        sidebarDarkModeToggle
            ?.addEventListener(
                "click",
                toggle
            );
    }

    // --------------------------------------------------------
    //  SANITIZATION & MARKDOWN
    // --------------------------------------------------------
    function sanitizeHTML(value) {
        const source =
            String(value || "");

        const element =
            document.createElement(
                "div"
            );

        element.textContent = source;

        return element.innerHTML;
    }

    function safeParseMarkdown(text) {
        const source =
            String(text || "");

        if (
            window.marked &&
            window.DOMPurify
        ) {
            let parsed;

            try {
                parsed =
                    window.marked.parse(
                        source
                    );
            } catch (error) {
                console.warn(
                    "Markdown parsing failed:",
                    error
                );

                return sanitizeHTML(
                    source
                ).replace(
                    /\n/g,
                    "<br>"
                );
            }

            return window.DOMPurify.sanitize(
                parsed,

                {
                    USE_PROFILES: {
                        html: true
                    },

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
                        "select",
                        "option"
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
                }
            );
        }

        return sanitizeHTML(
            source
        ).replace(
            /\n/g,
            "<br>"
        );
    }

    // --------------------------------------------------------
    //  API HELPER
    // --------------------------------------------------------
    async function readJsonResponse(
        response
    ) {
        const data =
            await response
                .json()
                .catch(() => ({}));

        if (response.status === 401) {
            clearLegacyUserStorage();

            window.location.replace(
                "signup.html"
            );

            throw new Error(
                "Your session has expired. Please log in again."
            );
        }

        if (!response.ok) {
            const errorValue =
                data?.error;

            const errorMessage =
                typeof errorValue ===
                "string"
                    ? errorValue
                    : errorValue
                          ?.message ||
                      "The request failed.";

            throw new Error(
                errorMessage
            );
        }

        return data;
    }

    // --------------------------------------------------------
    //  COMPOSER SHAPE
    // --------------------------------------------------------
    function updateComposerShape() {
        if (!glassInputContainer) {
            return;
        }

        const hasText =
            Boolean(
                chatInput?.value.trim()
            );

        const isMultiLine =
            Boolean(
                chatInput &&
                    chatInput.scrollHeight >
                        38
            );

        const hasFiles =
            attachedFiles.length > 0;

        glassInputContainer
            .classList
            .toggle(
                "is-expanded",

                hasText ||
                    isMultiLine ||
                    hasFiles
            );
    }

    // --------------------------------------------------------
    //  FREEMIUM
    // --------------------------------------------------------
    function setupFreemiumLogic() {
        modelBadgeBtn
            ?.addEventListener(
                "click",

                event => {
                    event.stopPropagation();

                    modelDropdownMenu
                        ?.classList
                        .toggle(
                            "show"
                        );
                }
            );

        optL10
            ?.addEventListener(
                "click",

                () => {
                    selectedModel =
                        "l1.0";

                    if (
                        currentModelDisplay
                    ) {
                        currentModelDisplay
                            .textContent =
                            "NEO L1.0";
                    }

                    optL10.classList.add(
                        "active"
                    );

                    optL12
                        ?.classList
                        .remove(
                            "active"
                        );

                    modelDropdownMenu
                        ?.classList
                        .remove(
                            "show"
                        );
                }
            );

        optL12
            ?.addEventListener(
                "click",

                () => {
                    modelDropdownMenu
                        ?.classList
                        .remove(
                            "show"
                        );

                    if (
                        userPlan ===
                        "free"
                    ) {
                        upgradeModal
                            ?.classList
                            .add(
                                "show"
                            );
                        return;
                    }

                    selectedModel =
                        "l1.2";

                    if (
                        currentModelDisplay
                    ) {
                        currentModelDisplay
                            .textContent =
                            "NEO L1.2 Pro";
                    }

                    optL12.classList.add(
                        "active"
                    );

                    optL10
                        ?.classList
                        .remove(
                            "active"
                        );
                }
            );

        const closeModal = () => {
            upgradeModal
                ?.classList
                .remove(
                    "show"
                );
        };

        modalCloseBtn
            ?.addEventListener(
                "click",
                closeModal
            );

        modalMaybeLaterBtn
            ?.addEventListener(
                "click",
                closeModal
            );

        upgradeModal
            ?.addEventListener(
                "click",

                event => {
                    if (
                        event.target ===
                        upgradeModal
                    ) {
                        closeModal();
                    }
                }
            );

        async function startNeoProCheckout() {
            if (!upgradeActionBtn) {
                return;
            }

            const originalText =
                upgradeActionBtn
                    .textContent;

            upgradeActionBtn.disabled =
                true;

            upgradeActionBtn.textContent =
                "Opening secure checkout...";

            try {
                const response =
                    await fetch(
                        "/api/checkout",

                        {
                            method:
                                "POST",

                            credentials:
                                "include",

                            cache:
                                "no-store",

                            headers: {
                                "Content-Type":
                                    "application/json",

                                Accept:
                                    "application/json"
                            },

                            body:
                                JSON.stringify(
                                    {}
                                )
                        }
                    );

                const data =
                    await response
                        .json()
                        .catch(
                            () => ({})
                        );

                if (
                    !response.ok ||
                    !data?.url
                ) {
                    throw new Error(
                        data?.error ||
                            "Unable to open secure checkout."
                    );
                }

                window.location.assign(
                    data.url
                );
            } catch (error) {
                console.error(
                    "NEO Pro checkout failed:",
                    error
                );

                alert(
                    error?.message ||
                        "Checkout could not be opened. Please try again."
                );
            } finally {
                upgradeActionBtn.disabled =
                    false;

                upgradeActionBtn.textContent =
                    originalText;
            }
        }

        upgradeActionBtn
            ?.addEventListener(
                "click",
                startNeoProCheckout
            );
    }

    function checkFilePermissionForPlan(
        file
    ) {
        const extension =
            file.name
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
            upgradeModal
                ?.classList
                .add(
                    "show"
                );

            return false;
        }

        return true;
    }

    // --------------------------------------------------------
    //  AUDIO VISUALIZER
    // --------------------------------------------------------
    async function startAudioVisualizer() {
        try {
            micStream =
                await navigator
                    .mediaDevices
                    .getUserMedia({
                        audio: true,
                        video: false
                    });

            const AudioContextClass =
                window.AudioContext ||
                window.webkitAudioContext;

            audioCtx =
                new AudioContextClass();

            analyser =
                audioCtx.createAnalyser();

            analyser.fftSize = 64;

            analyser
                .smoothingTimeConstant =
                0.75;

            const source =
                audioCtx
                    .createMediaStreamSource(
                        micStream
                    );

            source.connect(
                analyser
            );

            const waveSpans =
                document.querySelectorAll(
                    ".wave-dots-bar span"
                );

            const dataArray =
                new Uint8Array(
                    analyser
                        .frequencyBinCount
                );

            function updateWave() {
                if (!isListening) {
                    return;
                }

                analyser
                    .getByteFrequencyData(
                        dataArray
                    );

                waveSpans.forEach(
                    (
                        span,
                        index
                    ) => {
                        const value =
                            dataArray[
                                index %
                                    dataArray
                                        .length
                            ] || 0;

                        const height =
                            Math.max(
                                4,

                                Math.min(
                                    26,

                                    (
                                        value /
                                        255
                                    ) * 28
                                )
                            );

                        span.style.height =
                            `${height}px`;

                        span.style.opacity =
                            value > 12
                                ? "1"
                                : "0.4";

                        span.style
                            .backgroundColor =
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
            cancelAnimationFrame(
                animFrameId
            );

            animFrameId = null;
        }

        if (micStream) {
            micStream
                .getTracks()
                .forEach(
                    track =>
                        track.stop()
                );

            micStream = null;
        }

        if (
            audioCtx &&
            audioCtx.state !==
                "closed"
        ) {
            audioCtx.close();
            audioCtx = null;
        }

        const waveSpans =
            document.querySelectorAll(
                ".wave-dots-bar span"
            );

        waveSpans.forEach(
            span => {
                span.style.height =
                    "4px";

                span.style.opacity =
                    "0.4";

                span.style
                    .backgroundColor =
                    "var(--text-muted)";
            }
        );
    }

    // --------------------------------------------------------
    //  SPEECH RECOGNITION
    // --------------------------------------------------------
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

            recognition.continuous =
                true;

            recognition.interimResults =
                true;

            recognition.lang =
                "en-US";

            recognition.onstart =
                () => {
                    isListening =
                        true;

                    composerInputRow
                        ?.classList
                        .add(
                            "is-transcribing"
                        );

                    startAudioVisualizer();
                };

            recognition.onresult =
                event => {
                    const transcript =
                        Array.from(
                            event.results
                        )
                            .map(
                                result =>
                                    result[0]
                                        .transcript
                            )
                            .join("");

                    if (chatInput) {
                        chatInput.value =
                            transcript;

                        chatInput.style
                            .height =
                            "auto";

                        chatInput.style
                            .height =
                            `${Math.min(
                                chatInput
                                    .scrollHeight,
                                160
                            )}px`;

                        updateComposerShape();
                    }
                };

            recognition.onerror =
                stopListening;

            recognition.onend =
                stopListening;

            micBtn
                ?.addEventListener(
                    "click",

                    event => {
                        event
                            .stopPropagation();

                        if (
                            isListening
                        ) {
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

            stopRecBtn
                ?.addEventListener(
                    "click",

                    event => {
                        event
                            .stopPropagation();

                        recognition
                            ?.stop();

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
        composerInputRow?.classList.remove("is-transcribing");
        stopAudioVisualizer();
    }

    // --------------------------------------------------------
    //  HISTORY / CONVERSATION
    // --------------------------------------------------------
    hpDeleteBtn
        ?.addEventListener(
            "click",

            async () => {
                if (
                    !activePopupChatId
                ) {
                    return;
                }

                const conversationToDelete =
                    activePopupChatId;

                try {
                    const response =
                        await fetch(
                            "/api/history",

                            {
                                method:
                                    "POST",

                                credentials:
                                    "include",

                                headers: {
                                    "Content-Type":
                                        "application/json",

                                    Accept:
                                        "application/json"
                                },

                                body:
                                    JSON.stringify(
                                        {
                                            action:
                                                "delete",

                                            conversationId:
                                                conversationToDelete
                                        }
                                    )
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

                    alert(
                        error.message
                    );
                } finally {
                    activePopupChatId =
                        null;

                    historyPopupMenu
                        ?.classList
                        .remove(
                            "show"
                        );
                }
            }
        );

    // History popup actions (Share, Pin, Rename)
    if (hpShareBtn) {
        hpShareBtn.addEventListener("click", () => {
            alert("Share conversation – not implemented yet");
            historyPopupMenu?.classList.remove("show");
        });
    }
    if (hpPinBtn) {
        hpPinBtn.addEventListener("click", () => {
            alert("Pin conversation – not implemented yet");
            historyPopupMenu?.classList.remove("show");
        });
    }
    if (hpRenameBtn) {
        hpRenameBtn.addEventListener("click", async () => {
            if (!activePopupChatId) return;
            const newTitle = prompt("Enter new title:");
            if (newTitle !== null && newTitle.trim()) {
                try {
                    const response = await fetch("/api/history", {
                        method: "POST",
                        credentials: "include",
                        headers: {
                            "Content-Type": "application/json",
                            Accept: "application/json"
                        },
                        body: JSON.stringify({
                            action: "rename",
                            conversationId: activePopupChatId,
                            title: newTitle.trim()
                        })
                    });
                    await readJsonResponse(response);
                    await loadHistoryFromSupabase();
                } catch (error) {
                    alert(error.message);
                }
            }
            historyPopupMenu?.classList.remove("show");
        });
    }

    async function loadChatMessages(
        conversationId
    ) {
        if (!conversationId) {
            return;
        }

        try {
            const response =
                await fetch(
                    "/api/history",

                    {
                        method:
                            "POST",

                        credentials:
                            "include",

                        headers: {
                            "Content-Type":
                                "application/json",

                            Accept:
                                "application/json"
                        },

                        cache:
                            "no-store",

                        body:
                            JSON.stringify(
                                {
                                    action:
                                        "get",

                                    conversationId
                                }
                            )
                    }
                );

            const data =
                await readJsonResponse(
                    response
                );

            currentConversationId =
                conversationId;

            conversation =
                (data.messages || []).map(message => ({
                    role: message.role,
                    content: message.content || "",
                    displayContent: typeof message.displayContent === "string"
                        ? message.displayContent
                        : message.content || "",
                    attachments: Array.isArray(message.attachments)
                        ? message.attachments.map(serializeAttachment)
                        : []
                }));

            if (chatMessages) {
                chatMessages.innerHTML =
                    "";
            }

            if (heroSection) {
                heroSection.style.display =
                    "none";
            }

            conversation.forEach(
                (
                    message,
                    index
                ) => {
                    if (
                        message.role !==
                        "system"
                    ) {
                        // Use displayContent for user messages
                        const contentToRender =
                            message.role === "user"
                                ? message.displayContent
                                : message.content;
                        renderMessageToUI(
                            message.role,
                            contentToRender,
                            index,
                            false,
                            message.attachments || []
                        );
                    }
                }
            );

            await loadHistoryFromSupabase();

            if (
                window.innerWidth <
                768
            ) {
                sidebar
                    ?.classList
                    .add(
                        "collapsed"
                    );

                sidebarScrim
                    ?.classList
                    .remove(
                        "visible"
                    );

                updateBodySidebarState();
            }
        } catch (error) {
            console.error(
                "Conversation loading failed:",
                error
            );

            alert(
                error.message
            );
        }
    }

    // --------------------------------------------------------
    //  UI RENDERERS
    // --------------------------------------------------------
    function renderMessageToUI(
        role,
        content,
        messageIndex = null,
        isThinking = false,
        attachments = []
    ) {
        if (!chatMessages) {
            return null;
        }

        const message =
            document.createElement(
                "div"
            );

        message.className =
            `message ${role} ${
                isThinking
                    ? "is-thinking"
                    : ""
            }`;

        if (
            messageIndex !== null
        ) {
            message.setAttribute(
                "data-msg-index",
                String(
                    messageIndex
                )
            );
        }

        if (role === "user") {
            renderUserMessageWrapper(
                message,
                content,
                messageIndex,
                attachments
            );
        } else {
            const contentElement =
                document
                    .createElement(
                        "div"
                    );

            contentElement.className =
                "message-content";

            if (isThinking) {
                const thinking =
                    document
                        .createElement(
                            "span"
                        );

                thinking.className =
                    "thinking-shimmer";

                thinking.textContent =
                    "Thinking...";

                contentElement
                    .appendChild(
                        thinking
                    );
            } else {
                contentElement.innerHTML =
                    safeParseMarkdown(
                        content
                    );
            }

            message.appendChild(
                contentElement
            );

            const actions =
                document
                    .createElement(
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

            message.appendChild(
                actions
            );
        }

        chatMessages.appendChild(
            message
        );

        if (scrollArea) {
            scrollArea.scrollTop =
                scrollArea.scrollHeight;
        }

        if (window.lucide) {
            window.lucide
                .createIcons();
        }

        return message;
    }

    function renderUserMessageWrapper(
        containerElement,
        textContent,
        index,
        attachments = []
    ) {
        containerElement.innerHTML =
            "";

        const wrapper =
            document.createElement(
                "div"
            );

        wrapper.className =
            "message-wrapper";

        // Text content
        const content =
            document.createElement(
                "div"
            );

        content.className =
            "message-content";

        content.textContent = textContent || "";

        wrapper.appendChild(content);

        // Attachments (media grid)
        if (attachments && attachments.length > 0) {
            const mediaGrid = document.createElement("div");
            mediaGrid.className = "message-media-grid";

            attachments.forEach(file => {
                if (isImageAttachment(file)) {
                    const previewUrl = getAttachmentPreviewUrl(file);
                    if (previewUrl) {
                        const img = document.createElement("img");
                        img.alt = file.name || "Uploaded image";
                        img.src = previewUrl;
                        mediaGrid.appendChild(img);
                    } else {
                        // Fallback: show pill with image icon
                        const pill = document.createElement("div");
                        pill.className = "message-file-pill image-file-pill";

                        const icon = document.createElement("i");
                        icon.setAttribute("data-lucide", "image");

                        const name = document.createElement("span");
                        name.textContent = file.name || "Uploaded image";

                        pill.append(icon, name);
                        mediaGrid.appendChild(pill);
                    }
                } else {
                    const pill = document.createElement("div");
                    pill.className = "message-file-pill";
                    pill.textContent = file.name || "Attached file";
                    mediaGrid.appendChild(pill);
                }
            });

            wrapper.appendChild(mediaGrid);
        }

        // Actions (edit/copy)
        const actions =
            document.createElement(
                "div"
            );

        actions.className =
            "user-msg-actions";

        const editButton =
            document.createElement(
                "button"
            );

        editButton.className =
            "user-action-btn user-edit-btn";

        editButton.type =
            "button";

        editButton.title =
            "Edit message";

        editButton.innerHTML =
            '<i data-lucide="pencil" size="14"></i>';

        editButton.onclick =
            () => {
                enableUserMessageEdit(
                    containerElement,
                    textContent,
                    index,
                    attachments
                );
            };

        const copyButton =
            document.createElement(
                "button"
            );

        copyButton.className =
            "user-action-btn user-copy-btn";

        copyButton.type =
            "button";

        copyButton.title =
            "Copy text";

        copyButton.innerHTML =
            '<i data-lucide="copy" size="14"></i>';

        copyButton.onclick =
            () => {
                copyWithFeedback(
                    textContent,
                    copyButton,
                    14
                );
            };

        actions.appendChild(
            editButton
        );

        actions.appendChild(
            copyButton
        );

        wrapper.appendChild(
            actions
        );

        containerElement
            .appendChild(
                wrapper
            );

        if (window.lucide) {
            window.lucide
                .createIcons();
        }
    }

    function enableUserMessageEdit(
        messageElement,
        originalText,
        index,
        originalAttachments = []
    ) {
        if (isGenerating) {
            return;
        }

        messageElement.innerHTML =
            "";

        const editBox =
            document.createElement(
                "div"
            );

        editBox.className =
            "edit-message-box";

        const textarea =
            document.createElement(
                "textarea"
            );

        textarea.className =
            "edit-textarea";

        textarea.rows = 2;

        textarea.value =
            originalText;

        const actions =
            document.createElement(
                "div"
            );

        actions.className =
            "edit-actions";

        const cancelButton =
            document.createElement(
                "button"
            );

        cancelButton.className =
            "edit-btn-cancel";

        cancelButton.type =
            "button";

        cancelButton.textContent =
            "Cancel";

        const saveButton =
            document.createElement(
                "button"
            );

        saveButton.className =
            "edit-btn-save";

        saveButton.type =
            "button";

        saveButton.textContent =
            "Save & Submit";

        actions.appendChild(
            cancelButton
        );

        actions.appendChild(
            saveButton
        );

        editBox.appendChild(
            textarea
        );

        editBox.appendChild(
            actions
        );

        messageElement.appendChild(
            editBox
        );

        textarea.focus();

        cancelButton.onclick =
            () => {
                renderUserMessageWrapper(
                    messageElement,
                    originalText,
                    index,
                    originalAttachments
                );
            };

        saveButton.onclick =
            () => {
                const updatedText =
                    textarea.value.trim();

                if (updatedText) {
                    handleEditedSend(
                        updatedText,
                        index,
                        messageElement,
                        originalAttachments
                    );
                }
            };
    }

    async function handleEditedSend(
        newText,
        targetIndex,
        messageElement,
        originalAttachments
    ) {
        if (isGenerating) {
            return;
        }

        const cleanedText =
            String(
                newText || ""
            ).trim();

        if (!cleanedText && originalAttachments.length === 0) {
            return;
        }

        isGenerating = true;

        try {
            let actualIndex =
                Number.isInteger(
                    targetIndex
                )
                    ? targetIndex
                    : -1;

            if (
                actualIndex < 0 ||
                actualIndex >=
                    conversation.length
            ) {
                actualIndex =
                    conversation
                        .findIndex(
                            message =>
                                message.role ===
                                    "user" &&
                                message.content ===
                                    cleanedText
                        );
            }

            if (
                actualIndex >= 0 &&
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
                    current
                        ?.nextElementSibling
                ) {
                    current
                        .nextElementSibling
                        .remove();
                }
            }

            renderUserMessageWrapper(
                messageElement,
                cleanedText,
                conversation.length,
                originalAttachments
            );

            // Build API content
            const apiContent =
                cleanedText ||
                createAttachmentPrompt(
                    originalAttachments
                );

            conversation.push({
                role:
                    "user",
                content: apiContent,
                displayContent: cleanedText,
                attachments: originalAttachments.map(serializeAttachment)
            });

            const aiBubble =
                renderMessageToUI(
                    "assistant",
                    "",
                    null,
                    true
                );

            await submitChatRequest(
                aiBubble,
                cleanedText,
                originalAttachments
            );
        } catch (error) {
            console.error(
                "Edited message send failed:",
                error
            );

            isGenerating =
                false;
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
            .then(
                () => {
                    button.innerHTML =
                        `<i data-lucide="check" size="${size}" style="color:#10b981;"></i>`;

                    if (
                        window.lucide
                    ) {
                        window.lucide
                            .createIcons();
                    }

                    setTimeout(
                        () => {
                            button.innerHTML =
                                `<i data-lucide="copy" size="${size}"></i>`;

                            if (
                                window.lucide
                            ) {
                                window.lucide
                                    .createIcons();
                            }
                        },
                        2000
                    );
                }
            )
            .catch(
                () => {}
            );
    }

    // --------------------------------------------------------
    //  CHAT ACTIONS
    // --------------------------------------------------------
    chatMessages
        ?.addEventListener(
            "click",

            event => {
                const button =
                    event.target
                        .closest(
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
                        ?.innerText ||
                    "";

                if (
                    button.classList
                        .contains(
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
                    button.classList
                        .contains(
                            "share-msg-btn"
                        ) &&
                    navigator.share
                ) {
                    navigator
                        .share({
                            text
                        })
                        .catch(
                            () => {}
                        );

                    return;
                }

                if (
                    button.classList
                        .contains(
                            "regen-msg-btn"
                        )
                ) {
                    // Proper regenerate: find last user message, truncate after it, and re-submit
                    if (isGenerating) return;
                    const lastUserIndex = findLastUserMessageIndex();
                    if (lastUserIndex === -1) return;

                    const lastUserMsg = conversation[lastUserIndex];
                    // Remove the user message and any assistant messages after it
                    conversation = conversation.slice(0, lastUserIndex);
                    // Remove UI messages after the user message
                    let current = message;
                    while (current?.nextElementSibling) {
                        current.nextElementSibling.remove();
                    }
                    // Re-render the user message (preserve attachments)
                    renderUserMessageWrapper(
                        message,
                        lastUserMsg.displayContent || lastUserMsg.content,
                        conversation.length,
                        lastUserMsg.attachments
                    );

                    // Re-add user message to conversation
                    conversation.push({
                        role: "user",
                        content: lastUserMsg.content,
                        displayContent: lastUserMsg.displayContent || lastUserMsg.content,
                        attachments: lastUserMsg.attachments
                    });

                    const aiBubble = renderMessageToUI("assistant", "", null, true);
                    submitChatRequest(aiBubble, lastUserMsg.displayContent || lastUserMsg.content, lastUserMsg.attachments);
                }
            }
        );

    function findLastUserMessageIndex() {
        for (let i = conversation.length - 1; i >= 0; i--) {
            if (conversation[i].role === "user") return i;
        }
        return -1;
    }

    // --------------------------------------------------------
    //  MEDIA SERVICE
    // --------------------------------------------------------
    const mediaService = {
        async upload(file) {
            if (!(file instanceof File)) {
                throw new Error("Invalid file selected.");
            }

            if (!currentUser?.id) {
                throw new Error("User session is not ready.");
            }

            if (file.size > MAX_FILE_SIZE_BYTES) {
                throw new Error(
                    `${file.name} is too large. Maximum file size is 4MB.`
                );
            }

            const category = getFileCategory(file);

            const safeName = sanitizeStorageFileName(file.name);

            const objectPath = [
                "users",
                currentUser.id,
                category,
                `${crypto.randomUUID()}-${safeName}`
            ].join("/");

            const controller = new AbortController();

            const timeoutId = window.setTimeout(() => {
                controller.abort();
            }, MEDIA_UPLOAD_TIMEOUT_MS);

            try {
                const signedResponse = await fetch(
                    "/api/media/upload-url",
                    {
                        method: "POST",
                        credentials: "include",
                        cache: "no-store",
                        signal: controller.signal,

                        headers: {
                            "Content-Type": "application/json",
                            Accept: "application/json"
                        },

                        body: JSON.stringify({
                            bucket: MEDIA_BUCKET,
                            path: objectPath,
                            fileName: file.name,
                            mimeType:
                                file.type ||
                                "application/octet-stream",
                            size: file.size
                        })
                    }
                );

                const signedData =
                    await readJsonResponse(signedResponse);

                if (
                    !signedData?.uploadUrl ||
                    !signedData?.path
                ) {
                    throw new Error(
                        "The media upload URL was not returned."
                    );
                }

                const uploadResponse = await fetch(
                    signedData.uploadUrl,
                    {
                        method: "PUT",
                        signal: controller.signal,

                        headers: {
                            "Content-Type":
                                file.type ||
                                "application/octet-stream"
                        },

                        body: file
                    }
                );

                if (!uploadResponse.ok) {
                    throw new Error(
                        `Upload failed with status ${uploadResponse.status}.`
                    );
                }

                return {
                    provider: "supabase",
                    bucket: MEDIA_BUCKET,
                    path: signedData.path,
                    name: file.name,
                    mimeType:
                        file.type ||
                        "application/octet-stream",
                    type:
                        file.type ||
                        "application/octet-stream",
                    category,
                    size: file.size
                };
            } catch (error) {
                if (error?.name === "AbortError") {
                    throw new Error(
                        "Media upload timed out. Please try again."
                    );
                }

                throw error;
            } finally {
                window.clearTimeout(timeoutId);
            }
        },

        async getSignedUrl(path) {
            const cleanPath = String(path || "").trim();

            if (!cleanPath) {
                throw new Error("Media path is missing.");
            }

            const response = await fetch(
                "/api/media/download-url",
                {
                    method: "POST",
                    credentials: "include",
                    cache: "no-store",

                    headers: {
                        "Content-Type": "application/json",
                        Accept: "application/json"
                    },

                    body: JSON.stringify({
                        bucket: MEDIA_BUCKET,
                        path: cleanPath,
                        expiresIn:
                            SIGNED_URL_EXPIRY_SECONDS
                    })
                }
            );

            const data =
                await readJsonResponse(response);

            if (!data?.signedUrl) {
                throw new Error(
                    "The media download URL was not returned."
                );
            }

            return data.signedUrl;
        },

        async delete(path) {
            const cleanPath = String(path || "").trim();

            if (!cleanPath) {
                return;
            }

            const response = await fetch(
                "/api/media/delete",
                {
                    method: "POST",
                    credentials: "include",
                    cache: "no-store",

                    headers: {
                        "Content-Type": "application/json",
                        Accept: "application/json"
                    },

                    body: JSON.stringify({
                        bucket: MEDIA_BUCKET,
                        path: cleanPath
                    })
                }
            );

            await readJsonResponse(response);
        }
    };

    function sanitizeStorageFileName(fileName) {
        const original =
            String(fileName || "file")
                .trim()
                .toLowerCase();

        const dotIndex =
            original.lastIndexOf(".");

        const extension =
            dotIndex >= 0
                ? original
                      .slice(dotIndex + 1)
                      .replace(/[^a-z0-9]/g, "")
                      .slice(0, 10)
                : "";

        const baseName =
            (dotIndex >= 0
                ? original.slice(0, dotIndex)
                : original
            )
                .normalize("NFKD")
                .replace(/[^\w.-]+/g, "-")
                .replace(/-+/g, "-")
                .replace(/^[.-]+|[.-]+$/g, "")
                .slice(0, 80) || "file";

        return extension
            ? `${baseName}.${extension}`
            : baseName;
    }

    function readFileAsPayload(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();

            reader.onerror = () => {
                reject(new Error(`Unable to read ${file.name}`));
            };

            reader.onload = () => {
                resolve(reader.result || "");
            };

            const category = getFileCategory(file);

            if (category === "text") {
                reader.readAsText(file);
            } else {
                reader.readAsDataURL(file);
            }
        });
    }

    // --------------------------------------------------------
    //  FILE PROCESSING & HELPERS
    // --------------------------------------------------------
    async function handleFileProcessing(files) {
        const selected =
            Array.from(files || [])
                .slice(
                    0,
                    MAX_ATTACHED_FILES
                );

        for (const file of selected) {
            if (
                attachedFiles.length >=
                MAX_ATTACHED_FILES
            ) {
                alert(
                    `Maximum ${MAX_ATTACHED_FILES} files can be attached.`
                );

                break;
            }

            if (!(file instanceof File)) {
                continue;
            }

            if (
                file.size >
                MAX_FILE_SIZE_BYTES
            ) {
                alert(
                    `${file.name} is too large. Maximum file size is 4MB.`
                );

                continue;
            }

            if (
                !checkFilePermissionForPlan(
                    file
                )
            ) {
                continue;
            }

            const category =
                getFileCategory(file);

            let previewUrl = "";

            if (category === "image") {
                previewUrl =
                    URL.createObjectURL(file);
            }

            attachedFiles.push({
                localId:
                    crypto.randomUUID(),

                name:
                    file.name,

                type:
                    file.type ||
                    "application/octet-stream",

                mimeType:
                    file.type ||
                    "application/octet-stream",

                category,

                size:
                    file.size,

                rawFile:
                    file,

                previewUrl,

                uploadState:
                    "ready"
            });
        }

        renderAttachedChips();
        renderAdaptiveSuggestions();
        updateComposerShape();
    }

    function getAttachmentPreviewUrl(file) {
        if (!file) {
            return "";
        }

        // Current session preview only.
        if (
            typeof file.previewUrl === "string" &&
            file.previewUrl.startsWith("blob:")
        ) {
            return file.previewUrl;
        }

        if (
            file.localId &&
            sessionMediaPreviews.has(
                file.localId
            )
        ) {
            return sessionMediaPreviews.get(
                file.localId
            );
        }

        // Never automatically return persistent URLs here.
        // This prevents old chat images from downloading after refresh.
        return "";
    }

    function isImageAttachment(file) {
        if (!file) return false;

        if (file.type && file.type.startsWith("image/")) return true;
        if (file.mimeType && file.mimeType.startsWith("image/")) return true;
        if (file.category === "image") return true;

        if (typeof file.data === "string" && file.data.startsWith("data:image/")) {
            return true;
        }

        const name = (file.name || "").toLowerCase();
        return /\.(png|jpg|jpeg|webp|gif)$/i.test(name);
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

    // --------------------------------------------------------
    //  ATTACHMENT CHIPS & PREVIEW
    // --------------------------------------------------------
    function renderAttachedChips() {
        if (!attachedChipsWrapper) return;

        attachedChipsWrapper.innerHTML = "";

        attachedFiles.forEach((file, index) => {
            const card = document.createElement("div");
            card.className = "attachment-preview-card";

            if (isImageAttachment(file)) {
                const img = document.createElement("img");
                img.alt = file.name || "Uploaded image";
                img.src = getAttachmentPreviewUrl(file) || "";
                card.appendChild(img);
            } else {
                const box = document.createElement("div");
                box.className = "attachment-preview-file";
                box.textContent = file.name || "Attached file";
                card.appendChild(box);
            }

            const remove = document.createElement("button");
            remove.type = "button";
            remove.className = "attachment-remove-btn";
            remove.textContent = "×";

            remove.addEventListener("click", () => {
                const previewUrl = attachedFiles[index]?.previewUrl;

                if (previewUrl && previewUrl.startsWith("blob:")) {
                    URL.revokeObjectURL(previewUrl);
                }

                attachedFiles.splice(index, 1);
                renderAttachedChips();
                updateComposerShape();
            });

            card.appendChild(remove);
            attachedChipsWrapper.appendChild(card);
        });
    }

    // --------------------------------------------------------
    //  HANDLE SEND (with upload)
    // --------------------------------------------------------
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

        const pendingFiles =
            [...attachedFiles];

        let userMessageElement = null;

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

            const messageIndex =
                conversation.length;

            // Immediately show local previews before network upload.
            userMessageElement =
                renderMessageToUI(
                    "user",
                    text,
                    messageIndex,
                    false,
                    pendingFiles
                );

            attachedFiles = [];

            renderAttachedChips();
            renderAdaptiveSuggestions();
            updateComposerShape();

            // Upload all selected files to Supabase Storage.
            const uploadedAttachments = [];
            const successfullyUploaded = []; // for rollback

            try {
                for (
                    const pendingFile
                    of pendingFiles
                ) {
                    pendingFile.uploadState =
                        "uploading";

                    const uploaded =
                        await mediaService.upload(
                            pendingFile.rawFile
                        );

                    uploaded.localId =
                        pendingFile.localId;

                    if (
                        pendingFile.previewUrl
                    ) {
                        sessionMediaPreviews.set(
                            pendingFile.localId,
                            pendingFile.previewUrl
                        );

                        uploaded.previewUrl =
                            pendingFile.previewUrl;
                    }

                    uploadedAttachments.push(
                        uploaded
                    );
                    successfullyUploaded.push(uploaded);
                }
            } catch (uploadError) {
                // Rollback: delete already uploaded files
                for (const uploaded of successfullyUploaded) {
                    try {
                        await mediaService.delete(uploaded.path);
                    } catch (deleteError) {
                        console.warn("Failed to delete orphan file:", uploaded.path, deleteError);
                    }
                }
                throw uploadError;
            }

            // Attachment-only messages must still have valid text for the AI API.
            const apiContent =
                text ||
                createAttachmentPrompt(
                    uploadedAttachments
                );

            conversation.push({
                role: "user",
                content: apiContent,
                displayContent: text,
                attachments:
                    uploadedAttachments.map(
                        serializeAttachment
                    )
            });

            // Re-render the user bubble with the final uploaded metadata.
            if (userMessageElement) {
                renderUserMessageWrapper(
                    userMessageElement,
                    text,
                    messageIndex,
                    uploadedAttachments
                );
            }

            const aiBubble =
                renderMessageToUI(
                    "assistant",
                    "",
                    null,
                    true
                );

            await submitChatRequest(
                aiBubble,
                apiContent,
                uploadedAttachments
            );
        } catch (error) {
            console.error(
                "Send failed:",
                error
            );

            // Remove the unsaved optimistic message.
            userMessageElement?.remove();

            if (
                attachedFiles.length === 0 &&
                pendingFiles.length > 0
            ) {
                attachedFiles =
                    pendingFiles;
            }

            renderAttachedChips();
            renderAdaptiveSuggestions();
            updateComposerShape();

            isGenerating = false;

            alert(
                error?.message ||
                    "Unable to upload or send the message."
            );
        }
    }

    function serializeAttachment(file) {
        return {
            localId: file.localId || "",
            provider:
                file.provider ||
                "supabase",

            bucket:
                file.bucket ||
                MEDIA_BUCKET,

            path:
                file.path ||
                "",

            name:
                file.name ||
                "Attached file",

            mimeType:
                file.mimeType ||
                file.type ||
                "application/octet-stream",

            type:
                file.type ||
                file.mimeType ||
                "application/octet-stream",

            category:
                file.category ||
                getCategoryFromMimeType(
                    file.mimeType ||
                    file.type
                ),

            size:
                Number(
                    file.size || 0
                )
        };
    }

    function createAttachmentPrompt(
        attachments
    ) {
        if (
            !Array.isArray(attachments) ||
            attachments.length === 0
        ) {
            return "The user sent an attachment.";
        }

        const descriptions =
            attachments.map(
                attachment => {
                    const category =
                        attachment.category ||
                        "file";

                    const name =
                        attachment.name ||
                        "unnamed file";

                    return `${category}: ${name}`;
                }
            );

        return `The user uploaded the following attachment${
            descriptions.length > 1
                ? "s"
                : ""
        }: ${descriptions.join(", ")}.`;
    }

    function showAssistantError(
        aiBubble,
        error
    ) {
        if (!aiBubble) {
            isGenerating = false;
            return;
        }

        aiBubble.classList.remove(
            "is-thinking"
        );

        const content =
            aiBubble.querySelector(
                ".message-content"
            );

        if (content) {
            content.textContent =
                `Error: ${
                    error?.message ||
                    "The request failed."
                }`;

            content.style.color =
                "#ef4444";
        }

        isGenerating = false;
    }

    // ----------------------------------------------------------------
    //  UPDATED submitChatRequest with attachments payload
    // ----------------------------------------------------------------
    async function submitChatRequest(
        aiBubble,
        userText,
        files
    ) {
        let data;

        const title = makeConversationTitle(userText, files);

        // Prepare messages: filter, map with attachments
        const apiMessages =
            conversation
                .filter(message => {
                    return (
                        message &&
                        ["user", "assistant", "system"]
                            .includes(
                                message.role
                            )
                    );
                })
                .map(message => ({
                    role:
                        message.role,

                    content:
                        String(
                            message.content || ""
                        ).trim(),

                    attachments:
                        Array.isArray(
                            message.attachments
                        )
                            ? message.attachments.map(
                                  serializeAttachment
                              )
                            : []
                }))
                .filter(message => {
                    return (
                        Boolean(message.content) ||
                        message.attachments.length > 0
                    );
                });

        const finalMessage =
            apiMessages[
                apiMessages.length - 1
            ];

        if (
            !finalMessage ||
            finalMessage.role !== "user"
        ) {
            showAssistantError(
                aiBubble,
                new Error(
                    "Your final message must be a valid user message."
                )
            );

            return;
        }

        try {
            const response =
                await fetch(
                    "/api/chat",

                    {
                        method:
                            "POST",

                        credentials:
                            "include",

                        cache:
                            "no-store",

                        headers: {
                            "Content-Type":
                                "application/json",

                            Accept:
                                "application/json"
                        },

                        body:
                            JSON.stringify(
                                {
                                    messages:
                                        apiMessages,

                                    attachments:
                                        conversation.at(-1)?.attachments || [],   // <-- added

                                    conversationId:
                                        currentConversationId,

                                    model:
                                        selectedModel,

                                    isDeepResearch:
                                        isDeepResearchMode,

                                    title
                                }
                            )
                    }
                );

            data =
                await readJsonResponse(
                    response
                );
        } catch (error) {
            console.error(
                "Chat API request failed:",
                error
            );

            showAssistantError(
                aiBubble,
                error
            );

            return;
        }

        const replyValue =
            data?.reply ??
            data?.choices?.[0]
                ?.message
                ?.content ??
            data?.message?.content ??
            data?.content ??
            data?.text;

        const reply =
            typeof replyValue ===
            "string"
                ? replyValue.trim()
                : "";

        if (!reply) {
            const error =
                new Error(
                    "The AI response was empty."
                );

            console.error(
                "Invalid AI response:",
                data
            );

            showAssistantError(
                aiBubble,
                error
            );

            return;
        }

        if (
            typeof data
                .conversationId ===
                "string" &&
            data.conversationId
                .trim()
        ) {
            currentConversationId =
                data.conversationId
                    .trim();
        }

        try {
            if (aiBubble) {
                aiBubble.classList
                    .remove(
                        "is-thinking"
                    );

                const content =
                    aiBubble
                        .querySelector(
                            ".message-content"
                        );

                if (content) {
                    content.style.color =
                        "";

                    content.innerHTML =
                        safeParseMarkdown(
                            reply
                        );
                }
            }

            conversation.push({
                role:
                    "assistant",

                content:
                    reply
            });

            if (scrollArea) {
                scrollArea.scrollTop =
                    scrollArea
                        .scrollHeight;
            }
        } catch (
            renderError
        ) {
            console.error(
                "AI reply rendering failed:",
                renderError
            );

            if (aiBubble) {
                aiBubble.classList
                    .remove(
                        "is-thinking"
                    );

                const content =
                    aiBubble
                        .querySelector(
                            ".message-content"
                        );

                if (content) {
                    content.textContent =
                        reply;

                    content.style.color =
                        "";
                }
            }

            const alreadyStored =
                conversation.some(
                    message =>
                        message.role ===
                            "assistant" &&
                        message.content ===
                            reply
                );

            if (!alreadyStored) {
                conversation.push({
                    role:
                        "assistant",

                    content:
                        reply
                });
            }
        } finally {
            isGenerating =
                false;
        }

        if (window.lucide) {
            try {
                window.lucide
                    .createIcons();
            } catch (
                iconError
            ) {
                console.warn(
                    "Icon refresh failed:",
                    iconError
                );
            }
        }

        try {
            await loadHistoryFromSupabase();
        } catch (
            historyError
        ) {
            console.warn(
                "History refresh failed after successful reply:",
                historyError
            );
        }
    }

    function startNewConversation() {
        conversation = [];
        attachedFiles = [];
        currentConversationId = null;
        activePopupChatId = null;

        if (chatMessages) {
            chatMessages.innerHTML =
                "";
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
            await fetch(
                "/api/auth",

                {
                    method:
                        "POST",

                    credentials:
                        "include",

                    headers: {
                        "Content-Type":
                            "application/json",

                        Accept:
                            "application/json"
                    },

                    body:
                        JSON.stringify(
                            {
                                action:
                                    "logout"
                            }
                        )
                }
            );
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

    // --------------------------------------------------------
    //  SETTINGS UI
    // --------------------------------------------------------
    function setupSettingsUI() {
        // Close settings overlay
        settingsCloseBtn?.addEventListener("click", () => {
            neoSettingsOverlay?.classList.remove("show");
        });
        neoSettingsOverlay?.addEventListener("click", (e) => {
            if (e.target === neoSettingsOverlay) {
                neoSettingsOverlay.classList.remove("show");
            }
        });

        // Tab switching
        settingsTabs?.forEach(tab => {
            tab.addEventListener("click", () => {
                settingsTabs.forEach(t => t.classList.remove("active"));
                tab.classList.add("active");
                const panelId = tab.dataset.settingsTab;
                settingsPanels?.forEach(p => p.classList.remove("active"));
                document.getElementById(`settingsPanel${panelId}`)?.classList.add("active");
            });
        });

        // Save / Reset / Billing / Theme buttons (placeholders)
        settingsSaveBtn?.addEventListener("click", () => {
            alert("Settings saved (not yet implemented)");
        });
        settingsResetBtn?.addEventListener("click", () => {
            alert("Settings reset (not yet implemented)");
        });
        settingsBillingBtn?.addEventListener("click", () => {
            // Redirect to billing page
            window.location.href = "/billing";
        });
        settingsThemeBtn?.addEventListener("click", () => {
            // Toggle dark/light mode
            topBarDarkModeToggle?.click();
        });
    }

    // --------------------------------------------------------
    //  EVENT LISTENERS
    // --------------------------------------------------------
    function setupEventListeners() {
        sendBtn
            ?.addEventListener(
                "click",
                handleSend
            );

        chatInput
            ?.addEventListener(
                "keydown",

                event => {
                    if (
                        event.key ===
                            "Enter" &&
                        !event.shiftKey
                    ) {
                        event
                            .preventDefault();

                        handleSend();
                    }
                }
            );

        chatInput
            ?.addEventListener(
                "input",

                function () {
                    this.style.height =
                        "auto";

                    this.style.height =
                        `${Math.min(
                            this.scrollHeight,
                            160
                        )}px`;

                    updateComposerShape();
                    renderAdaptiveSuggestions(); // Added
                }
            );

        attachBtn
            ?.addEventListener(
                "click",

                event => {
                    event
                        .stopPropagation();

                    attachPopupMenu
                        ?.classList
                        .toggle(
                            "show"
                        );
                }
            );

        addFilesMenuBtn
            ?.addEventListener(
                "click",

                () => {
                    attachPopupMenu
                        ?.classList
                        .remove(
                            "show"
                        );

                    hiddenFileInput
                        ?.click();
                }
            );

        deepResearchToggleBtn
            ?.addEventListener(
                "click",

                event => {
                    event
                        .stopPropagation();

                    isDeepResearchMode =
                        !isDeepResearchMode;

                    deepResearchToggleBtn
                        .classList
                        .toggle(
                            "active-mode",
                            isDeepResearchMode
                        );
                }
            );

        personalMemoryBtn
            ?.addEventListener(
                "click",

                event => {
                    event
                        .stopPropagation();

                    attachPopupMenu
                        ?.classList
                        .remove(
                            "show"
                        );

                    const memory =
                        prompt(
                            "Update Memory:",

                            localStorage
                                .getItem(
                                    "neo_user_memories"
                                ) ||
                                ""
                        );

                    if (
                        memory !== null
                    ) {
                        localStorage
                            .setItem(
                                "neo_user_memories",
                                memory.trim()
                            );
                    }
                }
            );

        hiddenFileInput
            ?.addEventListener(
                "change",

                event => {
                    const files = Array.from(event.target.files || []);
                    if (files.length > 0) {
                        handleFileProcessing(files);
                    }
                    event.target.value = "";
                }
            );

        const toggleSidebar =
            () => {
                if (!sidebar) {
                    return;
                }

                sidebar
                    .classList
                    .toggle(
                        "collapsed"
                    );

                const isOpen =
                    !sidebar
                        .classList
                        .contains(
                            "collapsed"
                        );

                const mobile =
                    window
                        .matchMedia(
                            "(max-width: 767px)"
                        )
                        .matches;

                sidebarScrim
                    ?.classList
                    .toggle(
                        "visible",

                        mobile &&
                            isOpen
                    );

                updateBodySidebarState();
            };

        sidebarToggleBtn
            ?.addEventListener(
                "click",
                toggleSidebar
            );

        collapseSidebarBtn
            ?.addEventListener(
                "click",
                toggleSidebar
            );

        sidebarScrim
            ?.addEventListener(
                "click",
                toggleSidebar
            );

        newChatBtn
            ?.addEventListener(
                "click",

                () => {
                    startNewConversation();

                    if (
                        window.innerWidth <
                        768
                    ) {
                        sidebar
                            ?.classList
                            .add(
                                "collapsed"
                            );

                        sidebarScrim
                            ?.classList
                            .remove(
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
            .forEach(
                button => {
                    button
                        .addEventListener(
                            "click",

                            () => {
                                if (
                                    !chatInput
                                ) {
                                    return;
                                }

                                chatInput.value =
                                    button
                                        .getAttribute(
                                            "data-prompt"
                                        ) ||
                                    "";

                                handleSend();
                            }
                        );
                }
            );

        userProfileBtn
            ?.addEventListener(
                "click",

                event => {
                    event
                        .stopPropagation();

                    userPopupMenu
                        ?.classList
                        .toggle(
                            "show"
                        );
                }
            );

        // sidebarPersonalitiesBtn listener
        sidebarPersonalitiesBtn
            ?.addEventListener(
                "click",

                () => {
                    userPopupMenu?.classList.remove("show");

                    neoSettingsOverlay?.classList.add("show");
                    neoSettingsOverlay?.setAttribute("aria-hidden", "false");

                    document.querySelectorAll(".neo-settings-tab").forEach(tab => {
                        tab.classList.toggle(
                            "active",
                            tab.dataset.settingsTab === "personalities"
                        );
                    });

                    document.querySelectorAll(".neo-settings-panel").forEach(panel => {
                        panel.classList.remove("active");
                    });

                    document.getElementById("settingsPanelPersonalities")?.classList.add("active");
                }
            );

        document.addEventListener(
            "click",

            event => {
                if (
                    !userProfileBtn
                        ?.contains(
                            event.target
                        ) &&
                    !userPopupMenu
                        ?.contains(
                            event.target
                        )
                ) {
                    userPopupMenu
                        ?.classList
                        .remove(
                            "show"
                        );
                }

                if (
                    !historyPopupMenu
                        ?.contains(
                            event.target
                        ) &&
                    !event.target.closest(
                        ".history-action-btn"
                    )
                ) {
                    historyPopupMenu
                        ?.classList
                        .remove(
                            "show"
                        );
                }

                if (
                    !attachBtn
                        ?.contains(
                            event.target
                        ) &&
                    !attachPopupMenu
                        ?.contains(
                            event.target
                        )
                ) {
                    attachPopupMenu
                        ?.classList
                        .remove(
                            "show"
                        );
                }

                if (
                    !modelBadgeBtn
                        ?.contains(
                            event.target
                        ) &&
                    !modelDropdownMenu
                        ?.contains(
                            event.target
                        )
                ) {
                    modelDropdownMenu
                        ?.classList
                        .remove(
                            "show"
                        );
                }
            }
        );

        let lastResponsiveMode =
            window
                .matchMedia(
                    "(max-width: 767px)"
                )
                .matches;

        window.addEventListener(
            "resize",

            () => {
                const mobile =
                    window
                        .matchMedia(
                            "(max-width: 767px)"
                        )
                        .matches;

                if (
                    mobile ===
                    lastResponsiveMode
                ) {
                    return;
                }

                lastResponsiveMode =
                    mobile;

                initializeSidebarState();
            },

            {
                passive:
                    true
            }
        );

        document
            .getElementById(
                "brandBtn"
            )
            ?.addEventListener(
                "click",

                () => {
                    window.location.href =
                        "index.html";
                }
            );

        document
            .getElementById(
                "logoutBtn"
            )
            ?.addEventListener(
                "click",
                logoutUser
            );
    }

    // --------------------------------------------------------
    //  ADDITIONAL FUNCTIONS
    // --------------------------------------------------------

    // --- Dynamic adaptive suggestions ---
    function renderAdaptiveSuggestions() {
        if (!liveSuggestions || !chatInput) return;

        const text = chatInput.value.trim().toLowerCase();

        const baseSuggestions = [
            "Write code",
            "Summarize this",
            "Make a plan",
            "Improve text",
            "Research this"
        ];

        const codeSuggestions = [
            "Fix this code",
            "Explain this error",
            "Make it production ready",
            "Find bugs",
            "Write cleaner version"
        ];

        const businessSuggestions = [
            "Make launch plan",
            "Improve pricing",
            "Write marketing copy",
            "Find risks",
            "Make growth strategy"
        ];

        let suggestions = baseSuggestions;

        if (
            text.includes("code") ||
            text.includes("error") ||
            text.includes("js") ||
            text.includes("css") ||
            text.includes("html")
        ) {
            suggestions = codeSuggestions;
        }

        if (
            text.includes("business") ||
            text.includes("launch") ||
            text.includes("pricing") ||
            text.includes("grow")
        ) {
            suggestions = businessSuggestions;
        }

        liveSuggestions.innerHTML = "";

        suggestions.forEach(label => {
            const button = document.createElement("button");
            button.type = "button";
            button.className = "suggestion-chip";
            button.textContent = label;

            button.addEventListener("click", () => {
                chatInput.value = label;
                chatInput.focus();
                updateComposerShape();
                renderAdaptiveSuggestions();
            });

            liveSuggestions.appendChild(button);
        });
    }

    // --- Sidebar state management ---
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

    // --- Enhanced drag & drop ---
    function setupDragAndDrop() {
        if (!composerWrapper) return;

        ["dragenter", "dragover"].forEach(eventName => {
            composerWrapper.addEventListener(eventName, event => {
                event.preventDefault();
                event.stopPropagation();
                dragDropOverlay?.classList.add("show");
            });
        });

        ["dragleave", "drop"].forEach(eventName => {
            composerWrapper.addEventListener(eventName, event => {
                event.preventDefault();
                event.stopPropagation();
                dragDropOverlay?.classList.remove("show");
            });
        });

        composerWrapper.addEventListener("drop", event => {
            const files = Array.from(event.dataTransfer?.files || []);
            if (files.length) handleFileProcessing(files);
        });
    }

    // --- Paste upload ---
    function setupPasteUpload() {
        document.addEventListener("paste", event => {
            const files = Array.from(event.clipboardData?.files || []);
            if (files.length) handleFileProcessing(files);
        });
    }

    // --- Profile rendering (safe) ---
    async function renderUserProfile() {
        let profile = null;

        try {
            const response = await fetch("/api/profile", {
                credentials: "include",
                cache: "no-store",
                headers: { Accept: "application/json" }
            });

            if (response.ok) {
                profile = await response.json();
            }
        } catch (error) {
            console.warn("Profile request failed:", error);
        }

        const username =
            profile?.user?.username ||
            currentUser.username ||
            "user";

        const plan =
            profile?.user?.planType ||
            currentUser.planType ||
            userPlan ||
            "free";

        if (userNameDisplay) {
            userNameDisplay.textContent = `@${username}`;
        }

        if (userPlanBadge) {
            userPlanBadge.textContent = plan === "pro" ? "Pro Plan" : "Free Plan";
        }

        const avatarUrl =
            profile?.profile?.avatarUrl ||
            profile?.avatarUrl ||
            "";

        if (userAvatar) {
            userAvatar.replaceChildren();

            if (avatarUrl) {
                try {
                    const parsedUrl = new URL(
                        avatarUrl,
                        window.location.origin
                    );

                    const allowed =
                        parsedUrl.origin === window.location.origin ||
                        parsedUrl.hostname ===
                            "ujclhweqqifgoiscvqmd.supabase.co";

                    if (!allowed) {
                        throw new Error("Unsupported avatar host");
                    }

                    const img = document.createElement("img");
                    img.src = parsedUrl.href;
                    img.alt = username;
                    img.loading = "lazy";
                    img.referrerPolicy = "no-referrer";

                    userAvatar.appendChild(img);
                } catch {
                    userAvatar.textContent =
                        username.charAt(0).toUpperCase();
                }
            } else {
                userAvatar.textContent =
                    username.charAt(0).toUpperCase();
            }
        }
    }

    // --- History loading (with contextmenu) ---
    async function loadHistoryFromSupabase() {
        if (!historyList) return;

        try {
            const response = await fetch("/api/history", {
                method: "GET",
                credentials: "include",
                cache: "no-store",
                headers: { Accept: "application/json" }
            });

            const data = await readJsonResponse(response);
            const conversations = data.conversations || [];

            historyList.innerHTML = "";

            conversations.forEach(item => {
                const row = document.createElement("button");
                row.type = "button";
                row.className = "history-item";
                row.textContent = item.title || "New conversation";

                row.addEventListener("click", () => {
                    loadChatMessages(item.id);
                });

                // contextmenu listener for each history row
                row.addEventListener("contextmenu", event => {
                    event.preventDefault();
                    activePopupChatId = item.id;
                    historyPopupMenu.style.display = "block";
                    historyPopupMenu.classList.add("show");
                    historyPopupMenu.style.left = `${event.clientX}px`;
                    historyPopupMenu.style.top = `${event.clientY}px`;
                });

                historyList.appendChild(row);
            });
        } catch (error) {
            console.warn("History load failed:", error);
        }
    }

    // --------------------------------------------------------
    //  MEMORY CLEANUP
    // --------------------------------------------------------
    function revokeAttachedFilePreviews(files) {
        Array.from(files || [])
            .forEach(file => {
                const previewUrl =
                    file?.previewUrl;

                if (
                    typeof previewUrl ===
                        "string" &&
                    previewUrl.startsWith(
                        "blob:"
                    )
                ) {
                    URL.revokeObjectURL(
                        previewUrl
                    );
                }
            });
    }

    window.addEventListener(
        "beforeunload",

        () => {
            revokeAttachedFilePreviews(
                attachedFiles
            );

            sessionMediaPreviews.forEach(
                previewUrl => {
                    if (
                        typeof previewUrl ===
                            "string" &&
                        previewUrl.startsWith(
                            "blob:"
                        )
                    ) {
                        URL.revokeObjectURL(
                            previewUrl
                        );
                    }
                }
            );

            sessionMediaPreviews.clear();
        }
    );

    // --------------------------------------------------------
    //  BOOT
    // --------------------------------------------------------
    document.addEventListener(
        "DOMContentLoaded",

        () => {
            document
                .documentElement
                .dataset
                .neoRuntime =
                "ready";

            init().catch(
                error => {
                    console.error(
                        "NEO initialization failed:",
                        error
                    );

                    const input =
                        document
                            .getElementById(
                                "chatInput"
                            );

                    if (input) {
                        input.placeholder =
                            "NEO could not initialize. Check console.";
                    }
                }
            );
        }
    );
})();
