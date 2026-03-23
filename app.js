const api = "https://api.signaturesi.com";

let keys = JSON.parse(localStorage.getItem("keys") || "[]");

function save() {
    localStorage.setItem("keys", JSON.stringify(keys));
    render();
}

function render() {
    const box = document.getElementById("keys");
    if (!box) return;

    box.innerHTML = "";
    keys.forEach((k, i) => {
        const div = document.createElement("div");
        div.className = "key-item";
        div.innerHTML = `
            <code class="key-code">${k}</code>
            <div class="key-actions">
                <button class="icon-btn" data-tooltip="Copy key" onclick="copy('${k}')">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                        <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                    </svg>
                </button>
                <button class="icon-btn" data-tooltip="Delete key" onclick="removeKey(${i})">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <polyline points="3 6 5 6 21 6"></polyline>
                        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                    </svg>
                </button>
                <button class="icon-btn" data-tooltip="Check balance" onclick="balance('${k}')">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <line x1="12" y1="1" x2="12" y2="23"></line>
                        <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"></path>
                    </svg>
                </button>
            </div>
        `;
        box.appendChild(div);
    });
}

async function generateKey() {
    try {
        const r = await fetch(api + "/v1/user/new-key", { method: "POST" });
        const d = await r.json();
        if (d.api_key) {
            keys.push(d.api_key);
            save();
        } else {
            alert("Error: " + (d.error || "Unknown error"));
        }
    } catch (err) {
        alert("Failed to generate key: " + err.message);
    }
}

function copy(k) {
    navigator.clipboard.writeText(k);
    alert("✓ API key copied");
}

function removeKey(i) {
    keys.splice(i, 1);
    save();
}

async function balance(k) {
    try {
        const r = await fetch(api + "/v1/user/balance?api_key=" + k);
        const d = await r.json();
        alert(`Balance: ${d.balance}`);
    } catch (err) {
        alert("Error checking balance: " + err.message);
    }
}

async function askAI() {
    const key = document.getElementById("apiKey").value.trim();
    const prompt = document.getElementById("prompt").value.trim();
    if (!key || !prompt) return alert("Please fill in both fields");

    try {
        const r = await fetch(api + "/v1/chat/completions", {
            method: "POST",
            headers: {
                Authorization: "Bearer " + key,
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                model: "Neo-L1.0",
                messages: [{ role: "user", content: prompt }]
            })
        });

        const d = await r.json();
        const responseEl = document.getElementById("response");
        if (d.choices && d.choices[0]) {
            responseEl.innerText = d.choices[0].message.content;
        } else {
            responseEl.innerText = "Error: " + (d.error || "unknown error");
        }
    } catch (err) {
        alert("Request failed: " + err.message);
    }
}

render();