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
  if (authHeader) encoded = authHeader.split(' ')[1];
  else if (req.query.auth) encoded = req.query.auth;
  if (!encoded) return res.status(401).json({ error: 'Unauthorised' });
  
  let pwd = '';
  try {
    const decoded = Buffer.from(encoded, 'base64').toString();
    pwd = decoded.includes(':') ? decoded.split(':')[1] : decoded;
  } catch(e) {
    pwd = encoded;
  }
  
  if (pwd === process.env.DASHBOARD_PASSWORD) next();
  else res.status(401).json({ error: 'Invalid password' });
};

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});
app.post('/api/auth', (req, res) => {
  const { password } = req.body;
  if (password === process.env.DASHBOARD_PASSWORD) {
    res.json({ success: true, token: Buffer.from('admin:' + password).toString('base64') });
  } else {
    res.status(401).json({ error: 'Invalid password' });
  }
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
    console.error('DB ERROR:', err.message, err.stack);
    res.status(500).json({ error: err.message });
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
    if (result.rows.length === 0) return res.status(404).json({ error: 'Client not found' });
    const client = result.rows[0];
    const appUrl = process.env.APP_URL || 'https://bot-tracker-clean.vercel.app';
    const phpScript = `<?php
define('TRACKER_API', '${appUrl}/api/hit');
define('CLIENT_API_KEY', '${client.api_key}');
$AI_BOTS = ['GPTBot'=>'GPTBot','ChatGPT-User'=>'ChatGPT-User','ClaudeBot'=>'ClaudeBot','Anthropic'=>'anthropic-ai','Google-Extended'=>'Google-Extended','PerplexityBot'=>'PerplexityBot','Bytespider'=>'Bytespider','CCBot'=>'CCBot','Meta-ExternalAgent'=>'Meta-ExternalAgent','Cohere'=>'cohere-ai','YouBot'=>'YouBot','Diffbot'=>'Diffbot','Applebot-Extended'=>'Applebot-Extended'];
$userAgent = $_SERVER['HTTP_USER_AGENT'] ?? '';
$matchedBot = null;
foreach ($AI_BOTS as $name => $pattern) { if (stripos($userAgent, $pattern) !== false) { $matchedBot = $name; break; } }
if ($matchedBot) {
  $payload = json_encode(['api_key'=>CLIENT_API_KEY,'url'=>$_SERVER['REQUEST_URI']??'/','bot_name'=>$matchedBot,'user_agent'=>$userAgent,'status_code'=>http_response_code(),'country'=>$_SERVER['HTTP_CF_IPCOUNTRY']??null,'referrer'=>$_SERVER['HTTP_REFERER']??null]);
  $context = stream_context_create(['http'=>['method'=>'POST','header'=>"Content-Type: application/json\r\nContent-Length: ".strlen($payload),'content'=>$payload,'timeout'=>2]]);
  @file_get_contents(TRACKER_API, false, $context);
}`;
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', 'attachment; filename="bot-tracker.php"');
    res.send(phpScript);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

app.get('/api/stats/:clientId', auth, async (req, res) => {
  const { clientId } = req.params;
  const days = parseInt(req.query.days) || 30;
  try {
    const [totalHits, byBot, topPages, overTime] = await Promise.all([
      pool.query(`SELECT COUNT(*) as total FROM bot_hits WHERE client_id = $1 AND timestamp > NOW() - INTERVAL '${days} days'`, [clientId]),
      pool.query(`SELECT bot_name, COUNT(*) as hits FROM bot_hits WHERE client_id = $1 AND timestamp > NOW() - INTERVAL '${days} days' GROUP BY bot_name ORDER BY hits DESC`, [clientId]),
      pool.query(`SELECT url, COUNT(*) as hits FROM bot_hits WHERE client_id = $1 AND timestamp > NOW() - INTERVAL '${days} days' GROUP BY url ORDER BY hits DESC LIMIT 10`, [clientId]),
      pool.query(`SELECT DATE(timestamp) as date, COUNT(*) as hits FROM bot_hits WHERE client_id = $1 AND timestamp > NOW() - INTERVAL '${days} days' GROUP BY DATE(timestamp) ORDER BY date ASC`, [clientId])
    ]);
    res.json({ total: totalHits.rows[0].total, byBot: byBot.rows, topPages: topPages.rows, overTime: overTime.rows });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

app.get('/api/hits/:clientId', auth, async (req, res) => {
  const { clientId } = req.params;
  const days = parseInt(req.query.days) || 30;
  try {
    const result = await pool.query(
      `SELECT * FROM bot_hits WHERE client_id = $1 AND timestamp > NOW() - INTERVAL '${days} days' ORDER BY timestamp DESC LIMIT 200`,
      [clientId]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = app;
