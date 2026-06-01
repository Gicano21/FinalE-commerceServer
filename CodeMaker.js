require('dotenv').config();
const express = require("express");
const cors = require("cors");
const mysql = require("mysql2/promise");
const fs = require("fs");
const path = require("path");

const app = express();
app.use(cors());
app.use(express.json());

// --- Database Setup (MySQL) ---
const pool = mysql.createPool({
  host: process.env.DB_HOST || '127.0.0.1',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'techstore',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
});

// Initialize Products Table on Startup
async function initializeProductsTable() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS products (
        id INT PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        price DECIMAL(10, 2) NOT NULL,
        originalPrice DECIMAL(10, 2),
        image LONGTEXT NOT NULL,
        category VARCHAR(100) NOT NULL,
        description LONGTEXT NOT NULL,
        rating DECIMAL(3, 1) NOT NULL,
        reviews INT NOT NULL,
        inStock INT NOT NULL,
        featured BOOLEAN DEFAULT false
      )
    `);

    const [rows] = await pool.query('SELECT COUNT(*) as count FROM products');
    
    if (rows[0].count === 0) {
      const seedPath = path.join(__dirname, 'seedProducts.json');
      const seedData = JSON.parse(fs.readFileSync(seedPath, 'utf-8'));
      
      for (const product of seedData) {
        await pool.query(
          `INSERT INTO products (id, name, price, originalPrice, image, category, description, rating, reviews, inStock, featured)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            product.id,
            product.name,
            product.price,
            product.originalPrice || null,
            product.image,
            product.category,
            product.description,
            product.rating,
            product.reviews,
            typeof product.inStock === 'number' ? product.inStock : (product.inStock ? 1 : 0),
            product.featured ? 1 : 0
          ]
        );
      }
      console.log('Products table seeded with', seedData.length, 'products');
    } else {
      console.log('Products table already seeded');
    }
  } catch (error) {
    console.error("Error initializing products table:", error);
  }
}

initializeProductsTable();

// --- Formatting Helpers ---
function formatUser(row) {
  if (!row) return null;
  return {
    ...row,
    cart: typeof row.cart === 'string' ? JSON.parse(row.cart) : (row.cart || [])
  };
}

function formatProduct(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    price: parseFloat(row.price),
    originalPrice: row.originalPrice ? parseFloat(row.originalPrice) : undefined,
    image: row.image,
    category: row.category,
    description: row.description,
    rating: parseFloat(row.rating),
    reviews: row.reviews,
    inStock: Number(row.inStock || 0),
    featured: row.featured === 1 || row.featured === true
  };
}

// --- Outbound Email Queue (Processed by isolated emailWorker.js) ---
let emailQueue = [];

// --- Native Database Engine Core ---
async function processDbTask({ action, payload = {}, params = {}, query = {} }) {
  try {
    switch (action) {
      case 'GET_USERS': {
        const [rows] = await pool.query('SELECT * FROM users');
        return { status: 200, data: rows.map(formatUser) };
      }

      case 'SEARCH_USERS': {
        const searchTerm = `%${query.q || ''}%`;
        const [rows] = await pool.query(
          'SELECT * FROM users WHERE username LIKE ? OR email LIKE ?',
          [searchTerm, searchTerm]
        );
        return { status: 200, data: rows.map(formatUser) };
      }

      case 'CREATE_USER': {
        if (!payload.username || !payload.email || !payload.password) {
          return { status: 400, data: { error: 'Missing fields' } };
        }
        
        const [existing] = await pool.query(
          'SELECT id FROM users WHERE email = ? OR username = ?',
          [payload.email, payload.username]
        );
        if (existing.length > 0) return { status: 400, data: { error: 'User exists' } };
        
        const id = `user_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        const createdAt = new Date().toISOString();
        const emptyCart = JSON.stringify([]);

        await pool.query(
          'INSERT INTO users (id, username, email, password, createdAt, cart) VALUES (?, ?, ?, ?, ?, ?)',
          [id, payload.username, payload.email, payload.password, createdAt, emptyCart]
        );

        return { 
          status: 201, 
          data: { id, username: payload.username, email: payload.email, createdAt, cart: [] } 
        };
      }

      case 'AUTH_USER': {
        const [rows] = await pool.query(
          'SELECT * FROM users WHERE email = ? AND password = ?',
          [payload.email, payload.password]
        );
        return rows.length > 0 
          ? { status: 200, data: formatUser(rows[0]) } 
          : { status: 401, data: { error: 'Invalid credentials' } };
      }

      case 'GET_USER_BY_ID': {
        const [rows] = await pool.query('SELECT * FROM users WHERE id = ?', [params.id]);
        return rows.length > 0 
          ? { status: 200, data: formatUser(rows[0]) } 
          : { status: 404, data: { error: 'Not found' } };
      }

      case 'UPDATE_USER': {
        const keys = Object.keys(payload);
        if (keys.length === 0) return { status: 400, data: { error: 'No fields to update' } };

        const setClause = keys.map(k => `${k} = ?`).join(', ');
        const values = keys.map(k => payload[k]);
        
        const [result] = await pool.query(`UPDATE users SET ${setClause} WHERE id = ?`, [...values, params.id]);
        if (result.affectedRows === 0) return { status: 404, data: { error: 'Not found' } };
        
        const [updatedRows] = await pool.query('SELECT * FROM users WHERE id = ?', [params.id]);
        return { status: 200, data: formatUser(updatedRows[0]) };
      }

      case 'DELETE_USER': {
        const [result] = await pool.query('DELETE FROM users WHERE id = ?', [params.id]);
        if (result.affectedRows === 0) return { status: 404, data: { error: 'Not found' } };
        return { status: 200, data: { message: 'Deleted' } };
      }

      case 'ADD_CART_ITEM': {
        const [rows] = await pool.query('SELECT cart FROM users WHERE id = ?', [params.id]);
        if (rows.length === 0) return { status: 404, data: { error: 'Not found' } };

        let cart = formatUser(rows[0]).cart;
        const existingItem = cart.find(item => item.id === payload.id);
        
        if (existingItem) existingItem.quantity += payload.quantity;
        else cart.push(payload);
        
        await pool.query('UPDATE users SET cart = ? WHERE id = ?', [JSON.stringify(cart), params.id]);
        return { status: 200, data: cart };
      }

      case 'UPDATE_CART_ITEM': {
        const [uRows] = await pool.query('SELECT cart FROM users WHERE id = ?', [params.id]);
        if (uRows.length === 0) return { status: 404, data: { error: 'Not found' } };

        let uCart = formatUser(uRows[0]).cart;
        const uItem = uCart.find(item => item.id === parseInt(params.itemId));
        if (!uItem) return { status: 404, data: { error: 'Item not found' } };
        
        Object.assign(uItem, payload);
        await pool.query('UPDATE users SET cart = ? WHERE id = ?', [JSON.stringify(uCart), params.id]);
        return { status: 200, data: uCart };
      }

      case 'REMOVE_CART_ITEM': {
        const [rRows] = await pool.query('SELECT cart FROM users WHERE id = ?', [params.id]);
        if (rRows.length === 0) return { status: 404, data: { error: 'Not found' } };

        let rCart = formatUser(rRows[0]).cart;
        rCart = rCart.filter(item => item.id !== parseInt(params.itemId));
        
        await pool.query('UPDATE users SET cart = ? WHERE id = ?', [JSON.stringify(rCart), params.id]);
        return { status: 200, data: rCart };
      }

      case 'CLEAR_CART': {
        const [result] = await pool.query('UPDATE users SET cart = ? WHERE id = ?', [JSON.stringify([]), params.id]);
        if (result.affectedRows === 0) return { status: 404, data: { error: 'Not found' } };
        return { status: 200, data: [] };
      }

      case 'CHECKOUT': {
        const items = payload.items;
        if (!Array.isArray(items) || items.length === 0) {
          return { status: 400, data: { error: 'No items provided for checkout' } };
        }

        const [userRows] = await pool.query('SELECT cart FROM users WHERE id = ?', [params.id]);
        if (userRows.length === 0) return { status: 404, data: { error: 'User not found' } };

        const cart = formatUser(userRows[0]).cart;
        if (!Array.isArray(cart) || cart.length === 0) return { status: 400, data: { error: 'Cart is empty' } };

        const productIds = items.map((item) => item.id);
        const [productRows] = await pool.query(
          `SELECT * FROM products WHERE id IN (${productIds.map(() => '?').join(',')})`,
          productIds
        );

        const availableProducts = productRows.map(formatProduct);
        const productMap = new Map(availableProducts.map((product) => [product?.id, product]));
        const missingProductId = productIds.find((id) => !productMap.has(id));

        if (missingProductId !== undefined) {
          return {
            status: 404,
            data: { error: `Product with ID ${missingProductId} could not be found. Please update your cart before checkout.` },
          };
        }

        const unavailable = items.find((item) => {
          const product = productMap.get(item.id);
          return !product || product.inStock <= 0 || product.inStock < item.quantity;
        });

        if (unavailable) {
          const product = productMap.get(unavailable.id);
          return {
            status: 409,
            data: { error: `Product ${product?.name || 'unknown'} does not have enough stock. Please reduce quantity or remove it before checkout.` },
          };
        }

        for (const item of items) {
          await pool.query(
            'UPDATE products SET inStock = GREATEST(inStock - ?, 0) WHERE id = ?',
            [item.quantity, item.id]
          );
        }

        await pool.query('UPDATE users SET cart = ? WHERE id = ?', [JSON.stringify([]), params.id]);
        return { status: 200, data: { message: 'Checkout complete', purchasedItems: items } };
      }

      case 'GET_PRODUCTS': {
        const [rows] = await pool.query('SELECT * FROM products ORDER BY id ASC');
        return { status: 200, data: rows.map(formatProduct) };
      }

      case 'GET_PRODUCT_BY_ID': {
        const [rows] = await pool.query('SELECT * FROM products WHERE id = ?', [params.id]);
        return rows.length > 0
          ? { status: 200, data: formatProduct(rows[0]) }
          : { status: 404, data: { error: 'Product not found' } };
      }

      case 'CLEAR_DB': {
        await pool.query('TRUNCATE TABLE users');
        return { status: 200, data: { message: 'Database cleared' } };
      }

      default:
        return { status: 400, data: { error: "Unknown DB action" } };
    }
  } catch (error) {
    console.error("Internal Database processing error:", error);
    return { status: 500, data: { error: "Database Engine Processing Failure", details: error.message } };
  }
}

// ==========================================
// FRONT-END ROUTES (Direct Execution Architecture)
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

// --- User Database Operations ---
app.get('/api/users', async (req, res) => {
  const result = await processDbTask({ action: 'GET_USERS' });
  res.status(result.status).json(result.data);
});

app.get('/api/users/search', async (req, res) => {
  const result = await processDbTask({ action: 'SEARCH_USERS', query: req.query });
  res.status(result.status).json(result.data);
});

app.post('/api/users', async (req, res) => {
  const result = await processDbTask({ action: 'CREATE_USER', payload: req.body });
  res.status(result.status).json(result.data);
});

app.post('/api/auth', async (req, res) => {
  const result = await processDbTask({ action: 'AUTH_USER', payload: req.body });
  res.status(result.status).json(result.data);
});

app.get('/api/users/:id', async (req, res) => {
  const result = await processDbTask({ action: 'GET_USER_BY_ID', params: req.params });
  res.status(result.status).json(result.data);
});

app.patch('/api/users/:id', async (req, res) => {
  const result = await processDbTask({ action: 'UPDATE_USER', payload: req.body, params: req.params });
  res.status(result.status).json(result.data);
});

app.delete('/api/users/:id', async (req, res) => {
  const result = await processDbTask({ action: 'DELETE_USER', params: req.params });
  res.status(result.status).json(result.data);
});

// --- Cart Operations ---
app.post('/api/users/:id/cart', async (req, res) => {
  const result = await processDbTask({ action: 'ADD_CART_ITEM', payload: req.body, params: req.params });
  res.status(result.status).json(result.data);
});

app.patch('/api/users/:id/cart/:itemId', async (req, res) => {
  const result = await processDbTask({ action: 'UPDATE_CART_ITEM', payload: req.body, params: req.params });
  res.status(result.status).json(result.data);
});

app.delete('/api/users/:id/cart/:itemId', async (req, res) => {
  const result = await processDbTask({ action: 'REMOVE_CART_ITEM', params: req.params });
  res.status(result.status).json(result.data);
});

app.delete('/api/users/:id/cart', async (req, res) => {
  const result = await processDbTask({ action: 'CLEAR_CART', params: req.params });
  res.status(result.status).json(result.data);
});

app.post('/api/users/:id/checkout', async (req, res) => {
  const result = await processDbTask({ action: 'CHECKOUT', payload: req.body, params: req.params });
  res.status(result.status).json(result.data);
});

// --- Product Routes ---
app.get('/api/products', async (req, res) => {
  const result = await processDbTask({ action: 'GET_PRODUCTS' });
  res.status(result.status).json(result.data);
});

app.get('/api/products/:id', async (req, res) => {
  const result = await processDbTask({ action: 'GET_PRODUCT_BY_ID', params: req.params });
  res.status(result.status).json(result.data);
});

app.post('/api/database/clear', async (req, res) => {
  const result = await processDbTask({ action: 'CLEAR_DB' });
  res.status(result.status).json(result.data);
});

// ==========================================
// EMAIL WORKER ROUTE (For emailWorker.js to poll outbound messages)
// ==========================================
app.get("/worker/poll", (req, res) => {
  res.json({ emails: emailQueue, databaseTasks: [] });
  emailQueue = []; // Reset email queue upon successful fetch
});

const CODEMAKER_PORT = process.env.CODEMAKER_PORT || 3000;
app.listen(CODEMAKER_PORT, () => console.log(`CodeMaker (Merged Native API Gateway) running on port ${CODEMAKER_PORT}`));