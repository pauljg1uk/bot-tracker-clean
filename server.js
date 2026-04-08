require('dotenv').config();
const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

const auth = (req, res, next) => {
  let encoded = null;
  const authHeader = req.headers.authorization;
  if (authHeader) {
    encoded = authHeader.split(' ')[1];
  } else if (req.query.auth) {
    encoded = req.query.auth;
  }
  if (!encoded) return res.status(401).json({ error: 'Unauthorised' });
  const [, pwd] = Buffer.from(encoded, 'base64').toString().split(':');
  if (pwd === process.env.DASHBOARD_PASSWORD) {
    next();
  } else {
    res.status(401).json({ error: 'Invalid password' });
  }
};

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.post('/api/hit', async (req, res) => {
  const { api_key, url, bot_name, user_agent, status_code, country, referrer } = req.body;
  try {
    const clientResult = await pool.query('SELECT id FROM clients WHERE api_key = $1', [api_key]);
    if (clientResult.rows.length === 0) return res.status(401).json({ error: 'Invalid API key' });
    const client_id = clientResult.rows[0].id;
    await pool.query(
      `INSERT INTO bot_hits (client_id, url, bot_name, user_agent, status_code, country, referrer) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [client_id, url, bot_name, user_agent, status_code, country, referrer]
    );
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

app.get('/api/clients', auth, async (req, res) => {
  try {
    const result = await pool.query('SELECT id, name, domain, api_key, tracking_method, created_at FROM clients ORDER BY created_at DESC');
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/clients', auth, async (req, res) => {
  const { name, domain, tracking_method } = req.body;
  const api_key = Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
  try {
    const result = await pool.query(
      'INSERT INTO clients (name, domain, api_key, tracking_method) VALUES ($1, $2, $3, $4) RETURNING *',
      [name, domain, api_key, tracking_method || 'cloudflare']
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

app.get('/api/clients/:clientId/php-script', auth, async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM clients WHERE id = $1', [req.params.clientId]);
    if (result.rows.length === 0) return res.status(4
