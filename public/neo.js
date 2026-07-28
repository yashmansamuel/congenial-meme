(function () {
    "use strict";

    // SECURITY CONSTANTS & CONFIGS
    const MAX_FILE_SIZE_BYTES = Number.MAX_SAFE_INTEGER;
    const MAX_ATTACHED_FILES = 5;

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
    let activePopupChatPinned = false;
    let activePopupChatTitle = "";
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

    const hpRenameBtn =
        document.getElementById("hpRenameBtn");

    const hpPinBtn =
        document.getElementById("hpPinBtn");

    const hpShareBtn =
        document.getElementById("hpShareBtn");

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

    // SETTINGS DOM ELEMENTS
    const neoSettingsOverlay =
        document.getElementById(
            "neoSettingsOverlay"
        );

    const sidebarPersonalitiesBtn =
        document.getElementById(
            "sidebarPersonalitiesBtn"
        );

    const settingsBtn =
        document.getElementById("settingsBtn");

    const neoSettingsCloseBtn =
        document.getElementById(
            "neoSettingsCloseBtn"
        );

    const settingsTabs =
        document.querySelectorAll(
            ".neo-settings-tab"
        );

    const settingsPanels =
        document.querySelectorAll(
            ".neo-settings-panel"
        );

    const settingsThemeBtn =
        document.getElementById(
            "settingsThemeBtn"
        );

    const saveProfileSettingsBtn =
        document.getElementById(
            "saveProfileSettingsBtn"
        );

    const resetProfileSettingsBtn =
        document.getElementById(
            "resetProfileSettingsBtn"
        );

    const settingsUpgradeBtn =
        document.getElementById(
            "settingsUpgradeBtn"
        );

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
    //  NEO PROFESSIONAL TOAST NOTIFICATIONS
    // --------------------------------------------------------
    function getToastStack() {
        let stack =
            document.querySelector(
                ".neo-toast-stack"
            );

        if (!stack) {
            stack =
                document.createElement(
                    "div"
                );

            stack.className =
                "neo-toast-stack";

            stack.setAttribute(
                "aria-live",
                "polite"
            );

            stack.setAttribute(
                "aria-atomic",
                "true"
            );

            document.body.appendChild(
                stack
            );
        }

        return stack;
    }

    function showToast(
        message,
        type = "info",
        duration = 3600
    ) {
        const cleanMessage =
            String(
                message ||
                "Something went wrong."
            ).trim();

        const allowedTypes = [
            "success",
            "error",
            "warning",
            "info"
        ];

        const safeType =
            allowedTypes.includes(type)
                ? type
                : "info";

        const iconMap = {
            success: "check",
            error: "circle-alert",
            warning: "triangle-alert",
            info: "info"
        };

        const stack =
            getToastStack();

        const toast =
            document.createElement(
                "div"
            );

        toast.className =
            `neo-toast ${safeType}`;

        const icon =
            document.createElement(
                "span"
            );

        icon.className =
            "neo-toast-icon";

        icon.innerHTML =
            `<i data-lucide="${iconMap[safeType]}" size="16"></i>`;

        const text =
            document.createElement(
                "span"
            );

        text.className =
            "neo-toast-message";

        text.textContent =
            cleanMessage;

        const close =
            document.createElement(
                "button"
            );

        close.type =
            "button";

        close.className =
            "neo-toast-close";

        close.setAttribute(
            "aria-label",
            "Close notification"
        );

        close.innerHTML =
            '<i data-lucide="x" size="14"></i>';

        let removed = false;

        const removeToast = () => {
            if (removed) {
                return;
            }

            removed = true;

            toast.classList.add(
                "is-leaving"
            );

            setTimeout(
                () => toast.remove(),
                170
            );
        };

        close.addEventListener(
            "click",
            removeToast
        );

        toast.append(
            icon,
            text,
            close
        );

        stack.appendChild(
            toast
        );

        if (window.lucide) {
            window.lucide.createIcons();
        }

        if (duration > 0) {
            setTimeout(
                removeToast,
                duration
            );
        }

        return toast;
    }

    // --------------------------------------------------------
    // POPUP HELPERS
    // --------------------------------------------------------
    function closeHistoryPopup() {
        activePopupChatId = null;
        activePopupChatPinned = false;
        activePopupChatTitle = "";

        historyPopupMenu?.classList.remove("show");

        if (historyPopupMenu) {
            historyPopupMenu.style.display = "none";
            historyPopupMenu.style.left = "";
            historyPopupMenu.style.top = "";
        }
    }

    function closeUserPopup() {
        userPopupMenu
            ?.classList.remove("show");

        userPopupMenu
            ?.setAttribute(
                "aria-hidden",
                "true"
            );

        userProfileBtn
            ?.setAttribute(
                "aria-expanded",
                "false"
            );
    }

    function openHistoryPopup({
        conversationId,
        title,
        isPinned,
        anchorElement,
        clientX,
        clientY
    }) {
        if (!historyPopupMenu || !conversationId) {
            return;
        }

        closeUserPopup();

        activePopupChatId = conversationId;
        activePopupChatPinned = Boolean(isPinned);
        activePopupChatTitle =
            String(title || "New conversation");

        if (hpPinBtn) {
            hpPinBtn.innerHTML = activePopupChatPinned
                ? '<i data-lucide="pin-off" size="16"></i> Unpin'
                : '<i data-lucide="pin" size="16"></i> Pin';
        }

        historyPopupMenu.style.display = "block";
        historyPopupMenu.classList.add("show");

        const menuWidth = 208;
        const menuHeight = 188;

        let left = Number(clientX);
        let top = Number(clientY);

        if (
            anchorElement &&
            typeof anchorElement.getBoundingClientRect === "function"
        ) {
            const rect =
                anchorElement.getBoundingClientRect();

            left = rect.right - menuWidth;
            top = rect.bottom + 6;
        }

        left = Math.max(
            12,
            Math.min(
                Number.isFinite(left) ? left : 12,
                window.innerWidth - menuWidth - 12
            )
        );

        top = Math.max(
            12,
            Math.min(
                Number.isFinite(top) ? top : 12,
                window.innerHeight - menuHeight - 12
            )
        );

        historyPopupMenu.style.left =
            `${left}px`;

        historyPopupMenu.style.top =
            `${top}px`;

        window.lucide?.createIcons();
    }

    // --------------------------------------------------------
    // SETTINGS HELPERS
    // --------------------------------------------------------
    function activateSettingsTab(
        tabName = "general"
    ) {
        const panelMap = {
            general:
                "settingsPanelGeneral",

            profile:
                "settingsPanelProfile",

            notifications:
                "settingsPanelNotifications",

            personalities:
                "settingsPanelPersonalities",

            billing:
                "settingsPanelBilling"
        };

        settingsTabs.forEach(tab => {
            tab.classList.toggle(
                "active",
                tab.dataset.settingsTab ===
                    tabName
            );
        });

        settingsPanels.forEach(panel => {
            panel.classList.remove(
                "active"
            );
        });

        const panelId =
            panelMap[tabName] ||
            panelMap.general;

        document
            .getElementById(panelId)
            ?.classList.add("active");
    }

    function openNeoSettings(
        tabName = "general"
    ) {
        closeUserPopup();
        closeHistoryPopup();

        activateSettingsTab(tabName);

        neoSettingsOverlay
            ?.classList.add("show");

        neoSettingsOverlay
            ?.setAttribute(
                "aria-hidden",
                "false"
            );
    }

    function closeNeoSettings() {
        neoSettingsOverlay
            ?.classList.remove("show");

        neoSettingsOverlay
            ?.setAttribute(
                "aria-hidden",
                "true"
            );
    }

    // --------------------------------------------------------
    // PROFESSIONAL RENAME DIALOG
    // --------------------------------------------------------
    function requestNeoText({
        title,
        value = "",
        placeholder = "",
        confirmText = "Save"
    }) {
        return new Promise(resolve => {
            const overlay =
                document.createElement("div");

            overlay.className =
                "neo-dialog-overlay";

            const card =
                document.createElement("div");

            card.className =
                "neo-dialog-card";

            const heading =
                document.createElement("h3");

            heading.textContent =
                title;

            const input =
                document.createElement("input");

            input.type = "text";
            input.className =
                "neo-dialog-input";

            input.value = value;
            input.placeholder =
                placeholder;

            input.maxLength = 100;

            const actions =
                document.createElement("div");

            actions.className =
                "neo-dialog-actions";

            const cancel =
                document.createElement("button");

            cancel.type = "button";
            cancel.className =
                "neo-dialog-cancel";

            cancel.textContent =
                "Cancel";

            const confirm =
                document.createElement("button");

            confirm.type = "button";
            confirm.className =
                "neo-dialog-confirm";

            confirm.textContent =
                confirmText;

            const close = result => {
                overlay.remove();
                resolve(result);
            };

            cancel.addEventListener(
                "click",
                () => close(null)
            );

            confirm.addEventListener(
                "click",
                () => {
                    const result =
                        input.value.trim();

                    close(
                        result || null
                    );
                }
            );

            input.addEventListener(
                "keydown",
                event => {
                    if (event.key === "Enter") {
                        event.preventDefault();
                        confirm.click();
                    }

                    if (event.key === "Escape") {
                        cancel.click();
                    }
                }
            );

            overlay.addEventListener(
                "click",
                event => {
                    if (event.target === overlay) {
                        cancel.click();
                    }
                }
            );

            actions.append(
                cancel,
                confirm
            );

            card.append(
                heading,
                input,
                actions
            );

            overlay.appendChild(card);
            document.body.appendChild(overlay);

            requestAnimationFrame(() => {
                overlay.classList.add("show");
                input.focus();
                input.select();
            });
        });
    }

    // --------------------------------------------------------
    //  INIT
    // --------------------------------------------------------
    async function init() {
        // Force clear any stuck transcription state
        composerInputRow?.classList.remove("is-transcribing");
        isListening = false;

        if (window.lucide) {
            window.lucide.createIcons();
        }

        setupTheme();
        configureSecurityHooks();
        initializeSidebarState();
        setupEventListeners();
        setupPremiumTooltips();   // premium tooltip system
        setupFreemiumLogic();
        setupDragAndDrop();
        setupPasteUpload();
        setupSpeechRecognition();
        renderAdaptiveSuggestions();
        updateComposerShape();

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
    // PREMIUM NEO TOOLTIPS — FIXED
    // --------------------------------------------------------
    function setupPremiumTooltips() {
        let tooltip = null;
        let activeTarget = null;
        let showTimer = null;
        let hideTimer = null;

        function createTooltip() {
            if (tooltip) {
                return tooltip;
            }

            tooltip = document.createElement("div");
            tooltip.className = "neo-tooltip";
            tooltip.setAttribute("role", "tooltip");
            tooltip.setAttribute("aria-hidden", "true");

            const text = document.createElement("span");
            text.className = "neo-tooltip-text";

            const arrow = document.createElement("span");
            arrow.className = "neo-tooltip-arrow";

            tooltip.append(text, arrow);
            document.body.appendChild(tooltip);

            return tooltip;
        }

        function getTooltipTarget(element) {
            if (!(element instanceof Element)) {
                return null;
            }

            return element.closest(
                "[data-tooltip], [title], [data-neo-native-title]"
            );
        }

        function getTooltipText(target) {
            if (!target) {
                return "";
            }

            return String(
                target.dataset.tooltip ||
                target.getAttribute("title") ||
                target.dataset.neoNativeTitle ||
                ""
            ).trim();
        }

        function suppressNativeTooltip(target) {
            const nativeTitle =
                target.getAttribute("title");

            if (nativeTitle) {
                target.dataset.neoNativeTitle =
                    nativeTitle;

                target.removeAttribute("title");
            }
        }

        function restoreNativeTooltip(target) {
            if (!target?.dataset?.neoNativeTitle) {
                return;
            }

            target.setAttribute(
                "title",
                target.dataset.neoNativeTitle
            );

            delete target.dataset.neoNativeTitle;
        }

        function positionTooltip(target) {
            if (!tooltip || !target) {
                return;
            }

            const targetRect =
                target.getBoundingClientRect();

            const tooltipRect =
                tooltip.getBoundingClientRect();

            const viewportPadding = 10;
            const distance = 9;

            let top =
                targetRect.top -
                tooltipRect.height -
                distance;

            let placement = "top";

            if (top < viewportPadding) {
                top =
                    targetRect.bottom +
                    distance;

                placement = "bottom";
            }

            let left =
                targetRect.left +
                targetRect.width / 2 -
                tooltipRect.width / 2;

            left = Math.max(
                viewportPadding,
                Math.min(
                    left,
                    window.innerWidth -
                    tooltipRect.width -
                    viewportPadding
                )
            );

            const targetCenter =
                targetRect.left +
                targetRect.width / 2;

            const arrowX =
                Math.max(
                    12,
                    Math.min(
                        targetCenter - left,
                        tooltipRect.width - 12
                    )
                );

            tooltip.style.left =
                `${Math.round(left)}px`;

            tooltip.style.top =
                `${Math.round(top)}px`;

            tooltip.style.setProperty(
                "--neo-tooltip-arrow-x",
                `${Math.round(arrowX)}px`
            );

            tooltip.classList.toggle(
                "is-bottom",
                placement === "bottom"
            );
        }

        function showTooltip(target) {
            clearTimeout(hideTimer);

            const text =
                getTooltipText(target);

            if (!text) {
                return;
            }

            if (
                activeTarget &&
                activeTarget !== target
            ) {
                restoreNativeTooltip(
                    activeTarget
                );
            }

            activeTarget = target;

            suppressNativeTooltip(target);

            const element =
                createTooltip();

            element.querySelector(
                ".neo-tooltip-text"
            ).textContent = text;

            element.classList.remove(
                "is-visible"
            );

            element.setAttribute(
                "aria-hidden",
                "false"
            );

            requestAnimationFrame(() => {
                positionTooltip(target);

                requestAnimationFrame(() => {
                    element.classList.add(
                        "is-visible"
                    );
                });
            });
        }

        function scheduleShow(target) {
            clearTimeout(showTimer);
            clearTimeout(hideTimer);

            showTimer = setTimeout(
                () => showTooltip(target),
                380
            );
        }

        function hideTooltip({
            immediate = false
        } = {}) {
            clearTimeout(showTimer);
            clearTimeout(hideTimer);

            if (!tooltip) {
                if (activeTarget) {
                    restoreNativeTooltip(
                        activeTarget
                    );

                    activeTarget = null;
                }

                return;
            }

            const close = () => {
                tooltip.classList.remove(
                    "is-visible"
                );

                tooltip.setAttribute(
                    "aria-hidden",
                    "true"
                );

                if (activeTarget) {
                    restoreNativeTooltip(
                        activeTarget
                    );
                }

                activeTarget = null;
            };

            if (immediate) {
                close();
                return;
            }

            hideTimer = setTimeout(
                close,
                20
            );
        }

        document.addEventListener(
            "pointerover",
            event => {
                if (
                    event.pointerType ===
                    "touch"
                ) {
                    return;
                }

                const target =
                    getTooltipTarget(
                        event.target
                    );

                if (!target) {
                    return;
                }

                if (
                    event.relatedTarget &&
                    target.contains(
                        event.relatedTarget
                    )
                ) {
                    return;
                }

                scheduleShow(target);
            }
        );

        document.addEventListener(
            "pointerout",
            event => {
                const target =
                    getTooltipTarget(event.target) ||
                    (
                        activeTarget?.contains(event.target)
                            ? activeTarget
                            : null
                    );

                if (!target) {
                    return;
                }

                if (
                    event.relatedTarget &&
                    target.contains(event.relatedTarget)
                ) {
                    return;
                }

                hideTooltip({
                    immediate: true
                });
            }
        );

        document.addEventListener(
            "focusin",
            event => {
                const target =
                    getTooltipTarget(
                        event.target
                    );

                if (target) {
                    scheduleShow(target);
                }
            }
        );

        document.addEventListener(
            "focusout",
            event => {
                const target =
                    getTooltipTarget(
                        event.target
                    );

                if (target) {
                    hideTooltip({
                        immediate: true
                    });
                }
            }
        );

        document.addEventListener(
            "keydown",
            event => {
                if (event.key === "Escape") {
                    hideTooltip({
                        immediate: true
                    });
                }
            }
        );

        window.addEventListener(
            "resize",
            () => {
                if (
                    tooltip?.classList.contains(
                        "is-visible"
                    ) &&
                    activeTarget
                ) {
                    positionTooltip(
                        activeTarget
                    );
                }
            },
            {
                passive: true
            }
        );

        document.addEventListener(
            "scroll",
            () => {
                if (
                    tooltip?.classList.contains(
                        "is-visible"
                    )
                ) {
                    hideTooltip({
                        immediate: true
                    });
                }
            },
            true
        );
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

                showToast(
                    error?.message ||
                    "Checkout could not be opened. Please try again.",
                    "error"
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

    function checkFilePermissionForPlan() {
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

    // --- stopListening (clean version) ---
    function stopListening() {
        isListening = false;

        composerInputRow?.classList.remove(
            "is-transcribing"
        );

        if (sendBtn) {
            sendBtn.style.display = "";
        }

        if (micBtn) {
            micBtn.style.display = "";
        }

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

                    showToast(
                        "Conversation deleted.",
                        "success"
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

                    showToast(
                        error?.message ||
                        "Conversation could not be deleted.",
                        "error"
                    );
                } finally {
                    closeHistoryPopup();
                }
            }
        );

    // ----- RENAME conversation (now throws error) -----
    async function renameConversation(conversationId, newTitle) {
        const response = await fetch("/api/history", {
            method: "POST",
            credentials: "include",
            headers: {
                "Content-Type": "application/json",
                Accept: "application/json"
            },
            body: JSON.stringify({
                action: "rename",
                conversationId,
                title: newTitle
            })
        });
        await readJsonResponse(response);
        await loadHistoryFromSupabase();
        if (currentConversationId === conversationId) {
            // Optionally update UI header if needed
        }
    }

    // ----- PIN / UNPIN conversation (now throws error) -----
    async function togglePinConversation(conversationId, pin) {
        const response = await fetch("/api/history", {
            method: "POST",
            credentials: "include",
            headers: {
                "Content-Type": "application/json",
                Accept: "application/json"
            },
            body: JSON.stringify({
                action: pin ? "pin" : "unpin",
                conversationId
            })
        });
        await readJsonResponse(response);
        await loadHistoryFromSupabase();
    }

    // ----- loadChatMessages (with signed URLs) -----
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
                    attachments: Array.isArray(message.attachments)
                        ? message.attachments
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
                        renderMessageToUI(
                            message.role,
                            message.content,
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

            showToast(
                error?.message ||
                "Unable to load conversation.",
                "error"
            );
        }
    }

    // --------------------------------------------------------
    //  UI RENDERERS
    // --------------------------------------------------------

    // ----- File icon helper -----
    function getFileIcon(file) {
        const mime = (file.mimeType || file.type || "").toLowerCase();
        const name = (file.name || "").toLowerCase();
        if (mime.startsWith("image/")) return "image";
        if (mime.startsWith("audio/")) return "audio-lines";
        if (mime.startsWith("video/")) return "video";
        if (mime.includes("pdf")) return "file-text";
        if (mime.includes("zip") || mime.includes("rar") || name.endsWith(".zip") || name.endsWith(".rar")) return "archive";
        if (mime.includes("doc") || name.endsWith(".doc") || name.endsWith(".docx")) return "file-text";
        if (mime.includes("sheet") || name.endsWith(".xls") || name.endsWith(".xlsx")) return "table";
        if (mime.includes("presentation") || name.endsWith(".ppt") || name.endsWith(".pptx")) return "presentation";
        if (mime.includes("javascript") || mime.includes("json") || name.endsWith(".js") || name.endsWith(".ts") || name.endsWith(".py") || name.endsWith(".java") || name.endsWith(".cpp") || name.endsWith(".c") || name.endsWith(".html") || name.endsWith(".css")) return "code";
        return "file";
    }

    // ----- renderMessageToUI (with signed URLs) -----
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

    // ----- renderUserMessageWrapper (with signed URLs and icons, secure file names) -----
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

        // Attachments (media grid) — secure file names
        if (attachments && attachments.length > 0) {
            const mediaGrid = document.createElement("div");
            mediaGrid.className = "message-media-grid";

            attachments.forEach(file => {
                if (isImageAttachment(file)) {
                    const previewUrl =
                        getAttachmentPreviewUrl(file);

                    if (previewUrl) {
                        const img = document.createElement("img");
                        img.alt = file.name || "Uploaded image";
                        img.src = previewUrl;
                        mediaGrid.appendChild(img);
                    } else {
                        const pill = document.createElement("div");
                        pill.className = "message-file-pill";
                        const icon = getFileIcon(file);
                        const nameSpan = document.createElement("span");
                        nameSpan.textContent = file.name || "Uploaded image";
                        pill.innerHTML = `<i data-lucide="${icon}" size="14"></i>`;
                        pill.appendChild(nameSpan);
                        mediaGrid.appendChild(pill);
                    }
                } else {
                    const pill = document.createElement("div");
                    pill.className = "message-file-pill";
                    const icon = getFileIcon(file);
                    const nameSpan = document.createElement("span");
                    nameSpan.textContent = file.name || "Attached file";
                    pill.innerHTML = `<i data-lucide="${icon}" size="14"></i>`;
                    pill.appendChild(nameSpan);
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
                    index
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

    // ----- enableUserMessageEdit (unchanged) -----
    function enableUserMessageEdit(
        messageElement,
        originalText,
        index
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
                    index
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
                        messageElement
                    );
                }
            };
    }

    // ----- handleEditedSend (unchanged) -----
    async function handleEditedSend(
        newText,
        targetIndex,
        messageElement
    ) {
        if (isGenerating) {
            return;
        }

        const cleanedText =
            String(
                newText || ""
            ).trim();

        if (!cleanedText) {
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
                conversation.length
            );

            conversation.push({
                role:
                    "user",

                content:
                    cleanedText
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

            isGenerating =
                false;
        }
    }

    // ----- copyWithFeedback (unchanged) -----
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
    //  CHAT ACTIONS (unchanged)
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

    // --------------------------------------------------------
    //  UPLOAD FUNCTION
    // --------------------------------------------------------
    async function uploadFileToStorage(fileEntry) {
        const file = fileEntry?.rawFile;

        if (!(file instanceof File)) {
            throw new Error("Invalid file selected.");
        }

        if (!supabaseClient) {
            throw new Error("Upload service is not ready.");
        }

        const response = await fetch("/api/upload", {
            method: "POST",
            credentials: "include",
            cache: "no-store",

            headers: {
                "Content-Type": "application/json",
                Accept: "application/json"
            },

            body: JSON.stringify({
                filename: file.name,
                mimeType:
                    file.type ||
                    "application/octet-stream",
                size: file.size
            })
        });

        const data = await readJsonResponse(response);
        const upload = data?.upload;

        if (
            !upload?.bucket ||
            !upload?.path ||
            !upload?.token
        ) {
            throw new Error(
                "Upload information was not returned."
            );
        }

        const { error } = await supabaseClient
            .storage
            .from(upload.bucket)
            .uploadToSignedUrl(
                upload.path,
                upload.token,
                file,
                {
                    contentType:
                        file.type ||
                        "application/octet-stream"
                }
            );

        if (error) {
            throw new Error(
                error.message ||
                "File upload failed."
            );
        }

        return {
            provider: "supabase",
            bucket: upload.bucket,
            path: upload.path,
            name: file.name,
            mimeType:
                file.type ||
                "application/octet-stream",
            type:
                file.type ||
                "application/octet-stream",
            category:
                getFileCategory(file),
            size: file.size,
            previewUrl:
                fileEntry.previewUrl || ""
        };
    }

    // --------------------------------------------------------
    //  HANDLE SEND
    // --------------------------------------------------------
    async function handleSend() {
        if (isGenerating) {
            return;
        }

        const text =
            chatInput?.value.trim() || "";

        if (
            !text &&
            attachedFiles.length === 0
        ) {
            return;
        }

        isGenerating = true;

        const pendingFiles =
            [...attachedFiles];

        try {
            const uploadedAttachments =
                [];

            for (const fileEntry of pendingFiles) {
                const uploaded =
                    await uploadFileToStorage(
                        fileEntry
                    );

                uploadedAttachments.push(
                    uploaded
                );
            }

            const apiContent =
                text ||
                "Please analyze the attached file.";

            const messageIndex =
                conversation.length;

            if (chatInput) {
                chatInput.value = "";
                chatInput.style.height =
                    "auto";
            }

            if (heroSection) {
                heroSection.style.display =
                    "none";
            }

            renderMessageToUI(
                "user",
                text,
                messageIndex,
                false,
                uploadedAttachments
            );

            conversation.push({
                role: "user",
                content: apiContent,
                attachments:
                    uploadedAttachments.map(
                        file => ({
                            provider:
                                file.provider,
                            bucket:
                                file.bucket,
                            path:
                                file.path,
                            name:
                                file.name,
                            mimeType:
                                file.mimeType,
                            type:
                                file.type,
                            category:
                                file.category,
                            size:
                                file.size
                        })
                    )
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
                aiBubble,
                apiContent,
                uploadedAttachments
            );
        } catch (error) {
            console.error(
                "Upload/send failed:",
                error
            );

            attachedFiles =
                pendingFiles;

            renderAttachedChips();
            renderAdaptiveSuggestions();
            updateComposerShape();

            isGenerating = false;

            showToast(
                error?.message ||
                "Unable to upload the file.",
                "error"
            );
        }
    }

    // --------------------------------------------------------
    //  SUBMIT CHAT REQUEST
    // --------------------------------------------------------
    async function submitChatRequest(
        aiBubble,
        userText,
        files
    ) {
        let data;

        const title = makeConversationTitle(userText, files);

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
                                        conversation,

                                    attachments:
                                        conversation.at(-1)
                                            ?.attachments || [],

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
    //  SETTINGS UI — fully connected
    // --------------------------------------------------------
    function setupSettingsUI() {
        // Open settings from user popup
        settingsBtn?.addEventListener(
            "click",
            event => {
                event.preventDefault();
                event.stopPropagation();

                closeUserPopup();
                closeHistoryPopup();

                neoSettingsOverlay?.classList.add("show");
                neoSettingsOverlay?.setAttribute("aria-hidden", "false");
            }
        );

        // Close settings
        neoSettingsCloseBtn?.addEventListener(
            "click",
            () => {
                neoSettingsOverlay?.classList.remove("show");
                neoSettingsOverlay?.setAttribute("aria-hidden", "true");
            }
        );

        // Close on backdrop click
        neoSettingsOverlay?.addEventListener(
            "click",
            event => {
                if (event.target === neoSettingsOverlay) {
                    neoSettingsOverlay?.classList.remove("show");
                    neoSettingsOverlay?.setAttribute("aria-hidden", "true");
                }
            }
        );

        // Tab switching
        settingsTabs.forEach(tab => {
            tab.addEventListener(
                "click",
                () => {
                    settingsTabs.forEach(t => {
                        t.classList.remove("active");
                    });
                    tab.classList.add("active");

                    const target = tab.dataset.settingsTab;
                    settingsPanels.forEach(panel => {
                        panel.classList.remove("active");
                    });
                    const panel = document.getElementById(`settingsPanel${target.charAt(0).toUpperCase() + target.slice(1)}`);
                    if (panel) {
                        panel.classList.add("active");
                    }
                }
            );
        });

        // Theme button (syncs with main theme toggle)
        settingsThemeBtn?.addEventListener(
            "click",
            () => {
                const isDark = document.body.classList.contains("dark-mode");
                document.body.classList.toggle("dark-mode", !isDark);
                localStorage.setItem(
                    "neo_theme",
                    !isDark ? "dark" : "light"
                );
                // Update button text to reflect new state
                settingsThemeBtn.textContent = !isDark ? "Dark" : "Light";
            }
        );

        // Profile save (placeholder)
        saveProfileSettingsBtn?.addEventListener(
            "click",
            () => {
                const displayName = document.getElementById("settingsDisplayNameInput")?.value?.trim() || "";
                const username = document.getElementById("settingsUsernameInput")?.value?.trim() || "";
                const avatarUrl = document.getElementById("settingsAvatarUrlInput")?.value?.trim() || "";

                if (displayName || username || avatarUrl) {
                    showToast("Profile updated successfully.", "success");
                } else {
                    showToast("No changes to save.", "info");
                }
            }
        );

        // Profile reset (placeholder)
        resetProfileSettingsBtn?.addEventListener(
            "click",
            () => {
                document.getElementById("settingsDisplayNameInput").value = "";
                document.getElementById("settingsUsernameInput").value = "";
                document.getElementById("settingsAvatarUrlInput").value = "";
                showToast("Profile reset to defaults.", "info");
            }
        );

        // Settings upgrade button (reuses checkout logic)
        settingsUpgradeBtn?.addEventListener(
            "click",
            () => {
                if (userPlan === "pro") {
                    showToast("You are already on Pro plan.", "info");
                    return;
                }
                upgradeActionBtn?.click();
            }
        );
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

        // ---- Rename, Pin, Share listeners ----
        hpRenameBtn?.addEventListener(
            "click",
            async event => {
                event.stopPropagation();

                const conversationId =
                    activePopupChatId;

                const currentTitle =
                    activePopupChatTitle;

                if (!conversationId) {
                    return;
                }

                closeHistoryPopup();

                const newTitle =
                    await requestNeoText({
                        title:
                            "Rename conversation",
                        value:
                            currentTitle,
                        placeholder:
                            "Conversation name",
                        confirmText:
                            "Rename"
                    });

                if (!newTitle) {
                    return;
                }

                try {
                    await renameConversation(
                        conversationId,
                        newTitle
                    );
                    showToast(
                        "Conversation renamed.",
                        "success"
                    );
                } catch (error) {
                    showToast(
                        error?.message ||
                        "Conversation could not be renamed.",
                        "error"
                    );
                }
            }
        );

        hpPinBtn?.addEventListener(
            "click",
            async event => {
                event.stopPropagation();

                const conversationId =
                    activePopupChatId;

                const shouldPin =
                    !activePopupChatPinned;

                if (!conversationId) {
                    return;
                }

                closeHistoryPopup();

                try {
                    await togglePinConversation(
                        conversationId,
                        shouldPin
                    );
                    showToast(
                        shouldPin
                            ? "Conversation pinned."
                            : "Conversation unpinned.",
                        "success"
                    );
                } catch (error) {
                    showToast(
                        error?.message ||
                        "Conversation pin could not be changed.",
                        "error"
                    );
                }
            }
        );

        hpShareBtn?.addEventListener(
            "click",
            async event => {
                event.stopPropagation();

                const title =
                    activePopupChatTitle ||
                    "NEO conversation";

                closeHistoryPopup();

                try {
                    if (navigator.share) {
                        await navigator.share({
                            title,
                            text: title,
                            url:
                                window.location.href
                        });

                        return;
                    }

                    await navigator.clipboard.writeText(
                        window.location.href
                    );

                    showToast(
                        "Conversation link copied.",
                        "success"
                    );
                } catch (error) {
                    if (
                        error?.name !==
                        "AbortError"
                    ) {
                        showToast(
                            "Conversation could not be shared.",
                            "error"
                        );
                    }
                }
            }
        );

        // ---- User profile button ----
        userProfileBtn?.addEventListener(
            "click",
            event => {
                event.preventDefault();
                event.stopPropagation();

                closeHistoryPopup();

                const willOpen =
                    !userPopupMenu
                        ?.classList.contains(
                            "show"
                        );

                userPopupMenu
                    ?.classList.toggle(
                        "show",
                        willOpen
                    );

                userPopupMenu
                    ?.setAttribute(
                        "aria-hidden",
                        String(!willOpen)
                    );

                userProfileBtn.setAttribute(
                    "aria-expanded",
                    String(willOpen)
                );
            }
        );

        // ---- Sidebar personalities button ----
        sidebarPersonalitiesBtn
            ?.addEventListener(
                "click",

                () => {
                    userPopupMenu?.classList.remove("show");

                    neoSettingsOverlay?.classList.add("show");
                    neoSettingsOverlay?.setAttribute("aria-hidden", "false");

                    settingsTabs.forEach(tab => {
                        tab.classList.toggle(
                            "active",
                            tab.dataset.settingsTab === "personalities"
                        );
                    });

                    settingsPanels.forEach(panel => {
                        panel.classList.remove("active");
                    });

                    document.getElementById("settingsPanelPersonalities")?.classList.add("active");
                }
            );

        // ---- Connect Settings UI ----
        setupSettingsUI();

        // ---- Global outside-click handling ----
        document.addEventListener(
            "click",

            event => {
                // Close history popup
                if (
                    !historyPopupMenu?.contains(
                        event.target
                    ) &&
                    !event.target.closest(
                        ".history-three-dot"
                    )
                ) {
                    closeHistoryPopup();
                }

                // Close user popup
                if (
                    !userProfileBtn?.contains(
                        event.target
                    ) &&
                    !userPopupMenu?.contains(
                        event.target
                    )
                ) {
                    closeUserPopup();
                }

                // Close attachment popup
                if (
                    !attachBtn?.contains(
                        event.target
                    ) &&
                    !attachPopupMenu?.contains(
                        event.target
                    )
                ) {
                    attachPopupMenu
                        ?.classList
                        .remove(
                            "show"
                        );
                }

                // Close model dropdown
                if (
                    !modelBadgeBtn?.contains(
                        event.target
                    ) &&
                    !modelDropdownMenu?.contains(
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

    // --------------------------------------------------------
    //  Image attachment helpers & enhanced rendering
    // --------------------------------------------------------

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

    function getAttachmentPreviewUrl(file) {
        if (!file) return "";

        // Use signedUrl from backend first
        if (file.signedUrl) return file.signedUrl;

        // Fallback to existing previewUrl or data
        if (file.previewUrl) return file.previewUrl;

        if (typeof file.data === "string" && file.data.startsWith("data:image/")) {
            return file.data;
        }

        const raw = file.rawFile || file.file || file.blob || file;

        if (raw instanceof Blob && raw.type && raw.type.startsWith("image/")) {
            file.previewUrl = URL.createObjectURL(raw);
            return file.previewUrl;
        }

        return "";
    }

    // --- renderAttachedChips (secure file names) ---
    function renderAttachedChips() {
        if (!attachedChipsWrapper) return;

        attachedChipsWrapper.innerHTML = "";

        attachedFiles.forEach((file, index) => {
            const card = document.createElement("div");
            card.className = "attachment-preview-card";

            const icon = getFileIcon(file);

            if (isImageAttachment(file)) {
                const img = document.createElement("img");
                img.alt = file.name || "Uploaded image";
                img.src = getAttachmentPreviewUrl(file);
                card.appendChild(img);
            } else {
                const box = document.createElement("div");
                box.className = "attachment-preview-file";
                const iconEl = document.createElement("i");
                iconEl.setAttribute("data-lucide", icon);
                iconEl.style.width = "18px";
                iconEl.style.height = "18px";
                const nameSpan = document.createElement("span");
                nameSpan.textContent = file.name || "Attached file";
                box.appendChild(iconEl);
                box.appendChild(nameSpan);
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

        if (window.lucide) {
            window.lucide.createIcons();
        }
    }

    // --- getFileCategory ---
    function getFileCategory(file) {
        const type = file.type || "";

        if (type.startsWith("image/")) return "image";
        if (type.startsWith("audio/")) return "audio";
        if (type.startsWith("video/")) return "video";
        if (type.includes("pdf")) return "pdf";

        return "text";
    }

    // --- handleFileProcessing ---
    async function handleFileProcessing(files) {
        const selected =
            Array.from(files || [])
                .slice(0, MAX_ATTACHED_FILES);

        for (const file of selected) {
            if (
                attachedFiles.length >=
                MAX_ATTACHED_FILES
            ) {
                showToast(
                    `Maximum ${MAX_ATTACHED_FILES} files can be attached.`,
                    "warning"
                );
                break;
            }

            if (!(file instanceof File)) {
                continue;
            }

            const category =
                getFileCategory(file);

            attachedFiles.push({
                name: file.name,
                type:
                    file.type ||
                    "application/octet-stream",
                mimeType:
                    file.type ||
                    "application/octet-stream",
                category,
                size: file.size,
                rawFile: file,
                previewUrl:
                    category === "image"
                        ? URL.createObjectURL(file)
                        : ""
            });
        }

        renderAttachedChips();
        renderAdaptiveSuggestions();
        updateComposerShape();
    }

    // --- Profile rendering ---
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
            if (avatarUrl) {
                userAvatar.innerHTML =
                    `<img src="${sanitizeHTML(avatarUrl)}" alt="${sanitizeHTML(username)}">`;
            } else {
                userAvatar.textContent = username.charAt(0).toUpperCase();
            }
        }
    }

    // --- loadHistoryFromSupabase (with three-dot button, rename, pin/unpin) ---
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
                const row = document.createElement("div");
                row.className = "history-item-wrapper";
                row.style.position = "relative";
                row.style.display = "flex";
                row.style.alignItems = "center";
                row.style.gap = "4px";
                row.style.padding = "2px 4px";
                row.style.borderRadius = "10px";
                row.style.transition = "background 0.15s ease";

                const button = document.createElement("button");
                button.type = "button";
                button.className = "history-item";
                button.textContent = item.title || "New conversation";
                button.style.flex = "1";
                button.style.minHeight = "36px";
                button.style.padding = "8px 10px";
                button.style.background = "transparent";
                button.style.border = "none";
                button.style.color = "var(--text-primary)";
                button.style.textAlign = "left";
                button.style.cursor = "pointer";
                button.style.overflow = "hidden";
                button.style.whiteSpace = "nowrap";
                button.style.textOverflow = "ellipsis";
                button.style.borderRadius = "8px";
                button.style.fontSize = "14px";
                button.style.lineHeight = "20px";
                button.style.height = "36px";
                button.style.minHeight = "36px";

                button.addEventListener("click", () => {
                    loadChatMessages(item.id);
                });

                // Three-dot button (always visible)
                const dotBtn = document.createElement("button");
                dotBtn.type = "button";
                dotBtn.className = "history-three-dot";
                dotBtn.innerHTML = '<i data-lucide="more-vertical" size="16"></i>';
                dotBtn.style.background = "transparent";
                dotBtn.style.border = "none";
                dotBtn.style.color = "var(--text-muted)";
                dotBtn.style.cursor = "pointer";
                dotBtn.style.padding = "4px 6px";
                dotBtn.style.borderRadius = "6px";
                dotBtn.style.display = "flex";
                dotBtn.style.alignItems = "center";
                dotBtn.style.justifyContent = "center";
                dotBtn.style.transition = "background 0.12s ease, color 0.12s ease";
                dotBtn.style.flexShrink = "0";

                dotBtn.addEventListener(
                    "click",
                    event => {
                        event.preventDefault();
                        event.stopPropagation();

                        openHistoryPopup({
                            conversationId:
                                item.id,

                            title:
                                item.title,

                            isPinned:
                                item.is_pinned,

                            anchorElement:
                                dotBtn
                        });
                    }
                );

                row.appendChild(button);
                row.appendChild(dotBtn);
                historyList.appendChild(row);

                // Pin indicator (optional)
                if (item.is_pinned) {
                    const pinIcon = document.createElement("span");
                    pinIcon.style.marginLeft = "6px";
                    pinIcon.style.color = "var(--text-muted)";
                    pinIcon.innerHTML = '<i data-lucide="pin" size="12"></i>';
                    button.appendChild(pinIcon);
                }

                row.dataset.id = item.id;

                // ---- Context menu (right-click) ----
                row.addEventListener(
                    "contextmenu",
                    event => {
                        event.preventDefault();
                        event.stopPropagation();

                        openHistoryPopup({
                            conversationId:
                                item.id,

                            title:
                                item.title,

                            isPinned:
                                item.is_pinned,

                            clientX:
                                event.clientX,

                            clientY:
                                event.clientY
                        });
                    }
                );
            });

            if (window.lucide) {
                window.lucide.createIcons();
            }

        } catch (error) {
            console.warn("History load failed:", error);
        }
    }

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
