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
    pwd = decoded.includes(':') ? decoded.split(':').slice(1).join(':') : decoded;
  } catch(e) { pwd = encoded; }
  if (pwd === process.env.DASHBOARD_PASSWORD) next();
  else res.status(401).json({ error: 'Invalid password' });
};

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ── RECEIVE BOT HIT ──
app.post('/api/hit', async (req, res) => {
  const { api_key, url, bot_name, user_agent, status_code, country, referrer } = req.body;
  try {
    const clientResult = await pool.query('SELECT id FROM clients WHERE api_key = $1', [api_key]);
    if (clientResult.rows.length === 0) return res.status(401).json({ error: 'Invalid API key' });
    const client_id = clientResult.rows[0].id;
    await pool.query(
      `INSERT INTO bot_hits (client_id, url, bot_name, user_agent, status_code, country, referrer) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [client_id, url, bot_name, user_agent, status_code, country, referrer]
    );
    res.json({ success: true });
  } catch (err) {
    console.error('Hit error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── AUTH CHECK ──
app.post('/api/auth', (req, res) => {
  const { password } = req.body;
  if (password === process.env.DASHBOARD_PASSWORD) {
    res.json({ success: true });
  } else {
    res.status(401).json({ error: 'Invalid password' });
  }
});

// ── GET CLIENTS ──
app.get('/api/clients', auth, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT id, name, domain, api_key, tracking_method, created_at FROM clients ORDER BY created_at DESC'
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Get clients error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── CREATE CLIENT ──
app.post('/api/clients', auth, async (req, res) => {
  const { name, domain, tracking_method } = req.body;
  const api_key = Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
  try {
    const result = await pool.query(
      'INSERT INTO clients (name, domain, api_key, tracking_method) VALUES ($1,$2,$3,$4) RETURNING id, name, domain, api_key, tracking_method, created_at',
      [name, domain, api_key, tracking_method || 'cloudflare']
    );
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Create client error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── UPDATE CLIENT ──
app.put('/api/clients/:id', auth, async (req, res) => {
  const { name, domain } = req.body;
  try {
    const result = await pool.query(
      'UPDATE clients SET name=$1, domain=$2 WHERE id=$3 RETURNING id, name, domain, api_key, tracking_method, created_at',
      [name, domain, req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Client not found' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Update client error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── DELETE CLIENT ──
app.delete('/api/clients/:id', auth, async (req, res) => {
  try {
    await pool.query('DELETE FROM bot_hits WHERE client_id = $1', [req.params.id]);
    await pool.query('DELETE FROM clients WHERE id = $1', [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    console.error('Delete client error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── PHP SCRIPT DOWNLOAD ──
app.get('/api/clients/:clientId/php-script', auth, async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM clients WHERE id = $1', [req.params.clientId]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Client not found' });
    const client = result.rows[0];
    const appUrl = (process.env.APP_URL || 'https://aicrawler.befoundsearch.com').replace(/\/$/, '');
    const phpScript = `<?php
/**
 * BeFound AI Tracker
 * Client : ${client.name} (${client.domain})
 *
 * INSTALLATION (choose ONE method):
 *
 * METHOD A — WordPress sites (RECOMMENDED):
 *   1. Upload this file to your WordPress root (same folder as wp-config.php)
 *   2. Add these lines near the top of your functions.php (Appearance > Theme File Editor):
 *
 *   add_action('init', function() {
 *     require_once ABSPATH . 'ai-search-tracker.php';
 *   });
 *
 * METHOD B — Non-WordPress PHP sites:
 *   Add this line to the top of every PHP page you want to track (e.g. index.php, header.php):
 *   <?php require_once __DIR__ . '/ai-search-tracker.php'; ?>
 *
 * DO NOT use .htaccess or php.ini — these almost always cause a 500 error on shared hosting.
 *
 * Do NOT edit the API key below.
 */

define('BF_TRACKER_API', '${appUrl}/api/hit');
define('BF_CLIENT_KEY',  '${client.api_key}');

if (!defined('BF_BOT_TRACKER_LOADED')) {
  define('BF_BOT_TRACKER_LOADED', true);

  $AI_BOTS = [
    'GPTBot'=>'GPTBot','ChatGPT-User'=>'ChatGPT-User','OAI-SearchBot'=>'OAI-SearchBot',
    'ClaudeBot'=>'ClaudeBot','Claude-Web'=>'Claude-Web','Anthropic'=>'anthropic-ai',
    'Google-Extended'=>'Google-Extended','Gemini'=>'Gemini','PerplexityBot'=>'PerplexityBot',
    'Bytespider'=>'Bytespider','CCBot'=>'CCBot','Meta-ExternalAgent'=>'Meta-ExternalAgent',
    'FacebookBot'=>'FacebookBot','Cohere'=>'cohere-ai','YouBot'=>'YouBot',
    'Diffbot'=>'Diffbot','Applebot-Extended'=>'Applebot-Extended',
    'Amazonbot'=>'Amazonbot','DuckAssistBot'=>'DuckAssistBot',
  ];

  $ua  = $_SERVER['HTTP_USER_AGENT'] ?? '';
  $bot = null;
  foreach ($AI_BOTS as $name => $pattern) {
    if (stripos($ua, $pattern) !== false) { $bot = $name; break; }
  }

  if ($bot) {
    $payload = json_encode([
      'api_key'     => BF_CLIENT_KEY,
      'url'         => $_SERVER['REQUEST_URI'] ?? '/',
      'bot_name'    => $bot,
      'user_agent'  => $ua,
      'status_code' => http_response_code() ?: 200,
      'country'     => $_SERVER['HTTP_CF_IPCOUNTRY'] ?? null,
      'referrer'    => $_SERVER['HTTP_REFERER']      ?? null,
    ]);

    if (function_exists('curl_init')) {
      $ch = curl_init(BF_TRACKER_API);
      curl_setopt_array($ch, [
        CURLOPT_POST           => true,
        CURLOPT_POSTFIELDS     => $payload,
        CURLOPT_HTTPHEADER     => ['Content-Type: application/json'],
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT        => 3,
        CURLOPT_CONNECTTIMEOUT => 2,
        CURLOPT_SSL_VERIFYPEER => false,
      ]);
      @curl_exec($ch);
      curl_close($ch);
    } elseif (ini_get('allow_url_fopen')) {
      $ctx = stream_context_create(['http' => [
        'method'  => 'POST',
        'header'  => "Content-Type: application/json\r\nContent-Length: " . strlen($payload),
        'content' => $payload,
        'timeout' => 2,
      ]]);
      @file_get_contents(BF_TRACKER_API, false, $ctx);
    }
  }
}
`;
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', 'attachment; filename="ai-search-tracker.php"');
    res.send(phpScript);
  } catch (err) {
    console.error('PHP script error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── WORKER SCRIPT DOWNLOAD ──
app.get('/api/clients/:clientId/worker-script', auth, async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM clients WHERE id = $1', [req.params.clientId]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Client not found' });
    const client = result.rows[0];
    const appUrl = (process.env.APP_URL || 'https://aicrawler.befoundsearch.com').replace(/\/$/, '');
    const workerScript = `// BeFound AI Tracker
// Client: ${client.name} (${client.domain})
// Do NOT edit the API_URL or CLIENT_API_KEY values below.

const API_URL = '${appUrl}/api/hit';
const CLIENT_API_KEY = '${client.api_key}';

const AI_BOTS = [
  'GPTBot', 'ChatGPT-User', 'OAI-SearchBot', 'ClaudeBot', 'Claude-Web',
  'anthropic-ai', 'Google-Extended', 'Gemini', 'PerplexityBot', 'Bytespider',
  'CCBot', 'Meta-ExternalAgent', 'FacebookBot', 'cohere-ai', 'YouBot',
  'Diffbot', 'Applebot-Extended', 'Amazonbot', 'DuckAssistBot'
];

export default {
  async fetch(request, env, ctx) {
    const ua = request.headers.get('User-Agent') || '';
    const bot = AI_BOTS.find(b => ua.toLowerCase().includes(b.toLowerCase()));
    if (bot) {
      const url = new URL(request.url);
      ctx.waitUntil(fetch(API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          api_key: CLIENT_API_KEY,
          url: url.pathname + url.search,
          bot_name: bot,
          user_agent: ua,
          status_code: 200,
          country: request.cf?.country || null,
          referrer: request.headers.get('Referer') || null,
        }),
      }));
    }
    return fetch(request);
  }
};
`;
    res.setHeader('Content-Type', 'application/javascript');
    res.setHeader('Content-Disposition', 'attachment; filename="bf-worker.js"');
    res.send(workerScript);
  } catch (err) {
    console.error('Worker script error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── STATS ──
app.get('/api/stats/:clientId', auth, async (req, res) => {
  const { clientId } = req.params;
  const days = parseInt(req.query.days) || 30;
  try {
    const [totalHits, prevTotal, byBot, topPages, overTime] = await Promise.all([
      pool.query(`SELECT COUNT(*) as total FROM bot_hits WHERE client_id=$1 AND timestamp > NOW() - INTERVAL '${days} days'`, [clientId]),
      pool.query(`SELECT COUNT(*) as total FROM bot_hits WHERE client_id=$1 AND timestamp BETWEEN NOW() - INTERVAL '${days*2} days' AND NOW() - INTERVAL '${days} days'`, [clientId]),
      pool.query(`SELECT bot_name, COUNT(*) as hits,
        (SELECT COUNT(*) FROM bot_hits b2 WHERE b2.client_id=$1 AND b2.bot_name=b.bot_name AND b2.timestamp BETWEEN NOW() - INTERVAL '${days*2} days' AND NOW() - INTERVAL '${days} days') as previous_hits,
        MAX(timestamp) as last_active
        FROM bot_hits b WHERE client_id=$1 AND timestamp > NOW() - INTERVAL '${days} days'
        GROUP BY bot_name ORDER BY hits DESC`, [clientId]),
      pool.query(`SELECT url, COUNT(*) as hits,
        (SELECT COUNT(*) FROM bot_hits b2 WHERE b2.client_id=$1 AND b2.url=b.url AND b2.timestamp BETWEEN NOW() - INTERVAL '${days*2} days' AND NOW() - INTERVAL '${days} days') as previous_hits,
        json_agg(DISTINCT jsonb_build_object('bot_name', bot_name, 'hits', bot_count)) as bots
        FROM (SELECT url, bot_name, COUNT(*) as bot_count FROM bot_hits WHERE client_id=$1 AND timestamp > NOW() - INTERVAL '${days} days' GROUP BY url, bot_name) b
        GROUP BY url ORDER BY hits DESC LIMIT 20`, [clientId]),
      pool.query(`SELECT DATE(timestamp) as date, COUNT(*) as hits FROM bot_hits WHERE client_id=$1 AND timestamp > NOW() - INTERVAL '${days} days' GROUP BY DATE(timestamp) ORDER BY date ASC`, [clientId])
    ]);
    res.json({
      total: parseInt(totalHits.rows[0].total),
      previousTotal: parseInt(prevTotal.rows[0].total),
      byBot: byBot.rows.map(b => ({ ...b, hits: parseInt(b.hits), previous_hits: parseInt(b.previous_hits) })),
      topPages: topPages.rows.map(p => ({ ...p, hits: parseInt(p.hits), previous_hits: parseInt(p.previous_hits) })),
      overTime: overTime.rows
    });
  } catch (err) {
    console.error('Stats error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── PAGE INTELLIGENCE ──
app.get('/api/clients/:clientId/page-intel', auth, async (req, res) => {
  const { clientId } = req.params;
  const days = parseInt(req.query.days) || 30;
  const REALTIME = ['ChatGPT-User', 'OAI-SearchBot', 'PerplexityBot', 'Claude-Web'];
  try {
    const [mostCrawled, realtimePages, coldPages, statusRaw, referrers] = await Promise.all([
      pool.query(
        `SELECT url, COUNT(*) as hits, COUNT(DISTINCT bot_name) as unique_bots,
           MAX(timestamp) as last_seen, json_agg(DISTINCT bot_name) as bot_names
         FROM bot_hits WHERE client_id=$1 AND timestamp > NOW() - INTERVAL '${days} days'
         GROUP BY url ORDER BY hits DESC LIMIT 25`,
        [clientId]
      ),
      pool.query(
        `SELECT url, bot_name, COUNT(*) as hits, MAX(timestamp) as last_seen
         FROM bot_hits WHERE client_id=$1 AND bot_name = ANY($2)
           AND timestamp > NOW() - INTERVAL '${days} days'
         GROUP BY url, bot_name ORDER BY hits DESC LIMIT 25`,
        [clientId, REALTIME]
      ),
      pool.query(
        `SELECT url, COUNT(*) as total_hits, MAX(timestamp) as last_seen
         FROM bot_hits WHERE client_id=$1 AND timestamp > NOW() - INTERVAL '${days} days'
         GROUP BY url HAVING MAX(timestamp) < NOW() - INTERVAL '14 days'
         ORDER BY last_seen DESC LIMIT 20`,
        [clientId]
      ),
      pool.query(
        `SELECT status_code, COUNT(*) as hits
         FROM bot_hits WHERE client_id=$1 AND timestamp > NOW() - INTERVAL '${days} days'
         GROUP BY status_code ORDER BY hits DESC`,
        [clientId]
      ),
      pool.query(
        `SELECT referrer, COUNT(*) as hits
         FROM bot_hits WHERE client_id=$1 AND referrer IS NOT NULL AND referrer != ''
           AND timestamp > NOW() - INTERVAL '${days} days'
         GROUP BY referrer ORDER BY hits DESC LIMIT 10`,
        [clientId]
      ),
    ]);
    res.json({
      mostCrawled:    mostCrawled.rows.map(r => ({ ...r, hits: parseInt(r.hits), unique_bots: parseInt(r.unique_bots) })),
      realtimePages:  realtimePages.rows.map(r => ({ ...r, hits: parseInt(r.hits) })),
      coldPages:      coldPages.rows.map(r => ({ ...r, total_hits: parseInt(r.total_hits) })),
      statusBreakdown: statusRaw.rows.map(r => ({ ...r, hits: parseInt(r.hits) })),
      referrers:      referrers.rows.map(r => ({ ...r, hits: parseInt(r.hits) })),
    });
  } catch (err) {
    console.error('Page intel error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── HITS ──
app.get('/api/hits/:clientId', auth, async (req, res) => {
  const days = parseInt(req.query.days) || 30;
  try {
    const result = await pool.query(
      `SELECT * FROM bot_hits WHERE client_id=$1 AND timestamp > NOW() - INTERVAL '${days} days' ORDER BY timestamp DESC LIMIT 500`,
      [req.params.clientId]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── PAGE DETAIL ──
app.get('/api/page-detail/:clientId', auth, async (req, res) => {
  const { clientId } = req.params;
  const { url, days = 30 } = req.query;
  try {
    const [total, byBot, overTime, hourly] = await Promise.all([
      pool.query(`SELECT COUNT(*) as total FROM bot_hits WHERE client_id=$1 AND url=$2 AND timestamp > NOW() - INTERVAL '${days} days'`, [clientId, url]),
      pool.query(`SELECT bot_name, COUNT(*) as hits, MIN(timestamp) as first_seen, MAX(timestamp) as last_seen FROM bot_hits WHERE client_id=$1 AND url=$2 AND timestamp > NOW() - INTERVAL '${days} days' GROUP BY bot_name ORDER BY hits DESC`, [clientId, url]),
      pool.query(`SELECT DATE(timestamp) as date, COUNT(*) as hits FROM bot_hits WHERE client_id=$1 AND url=$2 AND timestamp > NOW() - INTERVAL '${days} days' GROUP BY DATE(timestamp) ORDER BY date`, [clientId, url]),
      pool.query(`SELECT EXTRACT(HOUR FROM timestamp) as hour, COUNT(*) as hits FROM bot_hits WHERE client_id=$1 AND url=$2 AND timestamp > NOW() - INTERVAL '${days} days' GROUP BY hour ORDER BY hour`, [clientId, url])
    ]);
    const hourlyPattern = Array(24).fill(0);
    hourly.rows.forEach(r => { hourlyPattern[parseInt(r.hour)] = parseInt(r.hits); });
    const botsWithInterval = byBot.rows.map(b => {
      const diffHours = b.first_seen && b.last_seen && b.hits > 1
        ? (new Date(b.last_seen) - new Date(b.first_seen)) / (1000 * 60 * 60) / (b.hits - 1)
        : null;
      return { ...b, hits: parseInt(b.hits), avg_interval_hours: diffHours };
    });
    res.json({ url, total_hits: parseInt(total.rows[0].total), byBot: botsWithInterval, overTime: overTime.rows, hourlyPattern });
  } catch (err) {
    console.error('Page detail error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── CADENCE ──
app.get('/api/cadence/:clientId', auth, async (req, res) => {
  const { clientId } = req.params;
  const days = parseInt(req.query.days) || 30;
  try {
    const botsResult = await pool.query(
      `SELECT bot_name, COUNT(*) as hits, MIN(timestamp) as first_seen, MAX(timestamp) as last_seen FROM bot_hits WHERE client_id=$1 AND timestamp > NOW() - INTERVAL '${days} days' GROUP BY bot_name ORDER BY hits DESC`,
      [clientId]
    );
    const cadence = await Promise.all(botsResult.rows.map(async b => {
      const [hourly, topPages] = await Promise.all([
        pool.query(`SELECT EXTRACT(HOUR FROM timestamp) as hour, COUNT(*) as hits FROM bot_hits WHERE client_id=$1 AND bot_name=$2 AND timestamp > NOW() - INTERVAL '${days} days' GROUP BY hour ORDER BY hour`, [clientId, b.bot_name]),
        pool.query(`SELECT url, COUNT(*) as hits FROM bot_hits WHERE client_id=$1 AND bot_name=$2 AND timestamp > NOW() - INTERVAL '${days} days' GROUP BY url ORDER BY hits DESC LIMIT 5`, [clientId, b.bot_name])
      ]);
      const hourlyPattern = Array(24).fill(0);
      hourly.rows.forEach(r => { hourlyPattern[parseInt(r.hour)] = parseInt(r.hits); });
      const peakHour = hourlyPattern.indexOf(Math.max(...hourlyPattern));
      const totalHits = parseInt(b.hits);
      const daySpan = Math.max(1, (new Date(b.last_seen) - new Date(b.first_seen)) / (1000 * 60 * 60 * 24));
      const avgIntervalHours = totalHits > 1 ? (new Date(b.last_seen) - new Date(b.first_seen)) / (1000 * 60 * 60) / (totalHits - 1) : null;
      return {
        bot_name: b.bot_name,
        total_hits: totalHits,
        visits_per_day: totalHits / Math.max(1, days),
        avg_interval_hours: avgIntervalHours,
        peak_hour: peakHour,
        hourly_pattern: hourlyPattern,
        top_pages: topPages.rows.map(p => ({ url: p.url, hits: parseInt(p.hits) }))
      };
    }));
    res.json({ cadence });
  } catch (err) {
    console.error('Cadence error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── PAGE TITLE ──
app.get('/api/page-title', auth, async (req, res) => {
  const { url } = req.query;
  try {
    const https = require('https');
    const http = require('http');
    const lib = url.startsWith('https') ? https : http;
    const req2 = lib.get(url, { timeout: 3000, headers: { 'User-Agent': 'Mozilla/5.0' } }, (r) => {
      let data = '';
      r.on('data', chunk => { data += chunk; if (data.length > 50000) r.destroy(); });
      r.on('end', () => {
        const match = data.match(/<title[^>]*>([^<]+)<\/title>/i);
        res.json({ title: match ? match[1].trim() : null });
      });
    });
    req2.on('error', () => res.json({ title: null }));
    req2.on('timeout', () => { req2.destroy(); res.json({ title: null }); });
  } catch (err) {
    res.json({ title: null });
  }
});

// ── EXPORT ──
app.get('/api/export/:clientId', auth, async (req, res) => {
  const { clientId } = req.params;
  const { days = 30, type = 'hits' } = req.query;
  try {
    let csv = '';
    if (type === 'hits') {
      const result = await pool.query(
        `SELECT timestamp, bot_name, url, country, status_code, user_agent FROM bot_hits WHERE client_id=$1 AND timestamp > NOW() - INTERVAL '${days} days' ORDER BY timestamp DESC`,
        [clientId]
      );
      csv = 'Timestamp,Bot,URL,Country,Status,User Agent\n' +
        result.rows.map(r => `"${r.timestamp}","${r.bot_name}","${r.url}","${r.country||''}","${r.status_code||''}","${(r.user_agent||'').replace(/"/g,'""')}"`).join('\n');
      res.setHeader('Content-Disposition', `attachment; filename="hits-${days}d.csv"`);
    } else if (type === 'pages') {
      const result = await pool.query(
        `SELECT url, COUNT(*) as hits FROM bot_hits WHERE client_id=$1 AND timestamp > NOW() - INTERVAL '${days} days' GROUP BY url ORDER BY hits DESC`,
        [clientId]
      );
      csv = 'URL,Hits\n' + result.rows.map(r => `"${r.url}","${r.hits}"`).join('\n');
      res.setHeader('Content-Disposition', `attachment; filename="pages-${days}d.csv"`);
    } else if (type === 'cadence') {
      const result = await pool.query(
        `SELECT bot_name, COUNT(*) as hits, MIN(timestamp) as first_seen, MAX(timestamp) as last_seen FROM bot_hits WHERE client_id=$1 AND timestamp > NOW() - INTERVAL '${days} days' GROUP BY bot_name ORDER BY hits DESC`,
        [clientId]
      );
      csv = 'Bot,Hits,First Seen,Last Seen\n' + result.rows.map(r => `"${r.bot_name}","${r.hits}","${r.first_seen}","${r.last_seen}"`).join('\n');
      res.setHeader('Content-Disposition', `attachment; filename="cadence-${days}d.csv"`);
    }
    res.setHeader('Content-Type', 'text/csv;charset=utf-8');
    res.send('\uFEFF' + csv);
  } catch (err) {
    console.error('Export error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = app;
