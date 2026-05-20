//CodeMaker.js
require('dotenv').config();
const express = require("express");
const cors = require("cors");

const app = express();
app.use(cors());
app.use(express.json());

// --- The Queues ---
let emailQueue = [];
let dbQueue = [];
let taskResults = {}; // Stores the answers from the Local Worker

// --- Helper: Put frontend on hold while asking Local Worker ---
function askLocalWorker(action, payload = {}, params = {}, query = {}) {
  return new Promise((resolve) => {
    const jobId = `job_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    // 1. Add task to the queue
    dbQueue.push({ id: jobId, action, payload, params, query });

    // 2. Check every 100ms if the Local Worker has provided an answer
    const interval = setInterval(() => {
      if (taskResults[jobId]) {
        clearInterval(interval);
        const response = taskResults[jobId];
        delete taskResults[jobId]; // Clean up memory
        resolve(response);
      }
    }, 100);

    // 3. Timeout after 15 seconds if Local Worker (EmailSender) is offline
    setTimeout(() => {
      clearInterval(interval);
      if (!taskResults[jobId]) {
        resolve({ status: 504, data: { error: "Local Database is offline." } });
      }
    }, 15000);
  });
}

// ==========================================
// FRONT-END ROUTES (Zero changes needed on Frontend)
// ==========================================

// --- Emails ---
app.post("/register", (req, res) => {
  const code = (Math.floor(Math.random() * 9000) + 1000).toString();
  emailQueue.push({ id: Date.now().toString(), type: "code", Email: req.body.Email, code });
  res.json({ message: "Verification code generated", code });
});

app.post("/feedback", (req, res) => {
  emailQueue.push({ id: Date.now().toString(), type: "feedback", ...req.body });
  res.json({ message: "Feedback queued" });
});

// --- Database Operations ---
app.get('/api/users', async (req, res) => {
  const result = await askLocalWorker('GET_USERS');
  res.status(result.status).json(result.data);
});

app.get('/api/users/search', async (req, res) => {
  const result = await askLocalWorker('SEARCH_USERS', {}, {}, req.query);
  res.status(result.status).json(result.data);
});

app.post('/api/users', async (req, res) => {
  const result = await askLocalWorker('CREATE_USER', req.body);
  res.status(result.status).json(result.data);
});

app.post('/api/auth', async (req, res) => {
  const result = await askLocalWorker('AUTH_USER', req.body);
  res.status(result.status).json(result.data);
});

app.get('/api/users/:id', async (req, res) => {
  const result = await askLocalWorker('GET_USER_BY_ID', {}, req.params);
  res.status(result.status).json(result.data);
});

app.patch('/api/users/:id', async (req, res) => {
  const result = await askLocalWorker('UPDATE_USER', req.body, req.params);
  res.status(result.status).json(result.data);
});

app.delete('/api/users/:id', async (req, res) => {
  const result = await askLocalWorker('DELETE_USER', {}, req.params);
  res.status(result.status).json(result.data);
});

app.post('/api/users/:id/cart', async (req, res) => {
  const result = await askLocalWorker('ADD_CART_ITEM', req.body, req.params);
  res.status(result.status).json(result.data);
});

app.patch('/api/users/:id/cart/:itemId', async (req, res) => {
  const result = await askLocalWorker('UPDATE_CART_ITEM', req.body, req.params);
  res.status(result.status).json(result.data);
});

app.delete('/api/users/:id/cart/:itemId', async (req, res) => {
  const result = await askLocalWorker('REMOVE_CART_ITEM', {}, req.params);
  res.status(result.status).json(result.data);
});

app.delete('/api/users/:id/cart', async (req, res) => {
  const result = await askLocalWorker('CLEAR_CART', {}, req.params);
  res.status(result.status).json(result.data);
});

app.post('/api/users/:id/checkout', async (req, res) => {
  const result = await askLocalWorker('CHECKOUT', req.body, req.params);
  res.status(result.status).json(result.data);
});

// --- Product Routes ---
app.get('/api/products', async (req, res) => {
  const result = await askLocalWorker('GET_PRODUCTS');
  res.status(result.status).json(result.data);
});

app.get('/api/products/:id', async (req, res) => {
  const result = await askLocalWorker('GET_PRODUCT_BY_ID', {}, req.params);
  res.status(result.status).json(result.data);
});

app.post('/api/database/clear', async (req, res) => {
  const result = await askLocalWorker('CLEAR_DB');
  res.status(result.status).json(result.data);
});

// ==========================================
// WORKER ROUTES (For EmailSender.js to poll)
// ==========================================

app.get("/worker/poll", (req, res) => {
  res.json({ emails: emailQueue, databaseTasks: dbQueue });
  emailQueue = []; // Clear queues after sending to worker
  dbQueue = [];
});

app.post("/worker/resolve", (req, res) => {
  const { jobId, status, data } = req.body;
  taskResults[jobId] = { status, data }; // Store answer for frontend
  res.json({ success: true });
});

const CODEMAKER_PORT = process.env.CODEMAKER_PORT || 3000;
app.listen(CODEMAKER_PORT, () => console.log(`CodeMaker (Cloud RPC Gateway) running on port ${CODEMAKER_PORT}`));