import json
from flask import Flask, render_template, jsonify, request, session
from flask_cors import CORS
import os

app = Flask(__name__)
app.secret_key = 'your-secret-key-here'  # change in production
CORS(app)  # allow cross-origin requests (for development)

# Sample data – could be fetched from a database
FEATURES = [
    {
        "icon": "brain",
        "title": "Step‑by‑step reasoning",
        "description": "Every conclusion is broken down into transparent thought processes.",
        "bgImage": "card.png",
        "clickable": False
    },
    {
        "icon": "layout",
        "title": "Multi‑format output",
        "description": "Tables, code blocks, lists – always beautifully formatted.",
        "bgImage": "card1.png",
        "clickable": False
    },
    {
        "icon": "zap",
        "title": "Lightning fast",
        "description": "Optimized inference, delivered with minimal latency.",
        "bgImage": "card3.png",
        "clickable": False
    },
    {
        "icon": "users",
        "title": "Group Chat",
        "description": "Collaborate with your team in real‑time. Click to join.",
        "bgImage": "card4.png",
        "clickable": True
    }
]

REASONING = [
    {
        "userBubble": "What is the capital of France?",
        "thoughtProcess": "⚡ User asks about capital of France. Need to recall geography.<br>⚡ France is a country in Europe. Its capital is Paris.",
        "conclusion": "<h3>Conclusion</h3><p>The capital of France is <strong>Paris</strong>.</p>"
    },
    {
        "userBubble": "Show a quick sort in Python.",
        "thoughtProcess": "⚡ Request: quicksort implementation in Python.",
        "conclusion": """
            <h3>Python quicksort</h3>
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
            </div>
        """
    }
]

@app.route('/')
def index():
    """Serve the main page."""
    return render_template('index.html')

@app.route('/api/features', methods=['GET'])
def get_features():
    """Return the list of features."""
    return jsonify(FEATURES)

@app.route('/api/reasoning', methods=['GET'])
def get_reasoning():
    """Return the list of reasoning examples."""
    return jsonify(REASONING)

@app.route('/api/login', methods=['POST'])
def login():
    """Simulate login – returns a success message."""
    data = request.get_json()
    # In a real app, validate credentials and create a session
    session['user'] = data.get('username', 'guest')
    return jsonify({"status": "success", "message": "Logged in successfully!"})

@app.route('/api/logout', methods=['POST'])
def logout():
    """Logout the current user."""
    session.pop('user', None)
    return jsonify({"status": "success", "message": "Logged out."})

@app.route('/api/session', methods=['GET'])
def get_session():
    """Return current session info."""
    return jsonify({"user": session.get('user')})

if __name__ == '__main__':
    app.run(debug=True)
