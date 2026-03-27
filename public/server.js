const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Simple in‑memory storage for demo (you can replace with a database later)
let reasoningHistory = [];

// API endpoint: simulate reasoning
app.post('/api/reason', (req, res) => {
  const { query } = req.body;
  if (!query) {
    return res.status(400).json({ error: 'Missing query' });
  }

  // Simple mock reasoning response
  const mockResponse = {
    query: query,
    reasoningSteps: [
      "⚡ Analyzing user input...",
      "⚡ Breaking down the problem into smaller parts.",
      "⚡ Applying logical inference.",
      "⚡ Generating final answer."
    ],
    conclusion: `Based on your request: "${query}", the Neo engine suggests thinking deeper and iterating.`,
    timestamp: new Date().toISOString()
  };

  // Store history (optional)
  reasoningHistory.push(mockResponse);
  res.json(mockResponse);
});

// Endpoint to get recent reasoning history
app.get('/api/history', (req, res) => {
  res.json(reasoningHistory.slice(-10)); // last 10 entries
});

// Serve the main HTML for all unmatched routes (SPA support)
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
