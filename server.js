require('dotenv').config();
const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
const path = require('path');
const https = require('https');
const http = require('http');

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
    const appUrl = 'https://aicrawler.befoundsearch.com';
    const phpScript = `<?php
/**
 * BeFound AI Tracker v1.4
 * Client : ${client.name} (${client.domain})
 * =====================================================================
 *
 * INSTALLATION — WordPress (RECOMMENDED METHOD):
 *   1. Upload this file to:  wp-content/mu-plugins/bf-tracker.php
 *      (Create the mu-plugins folder if it does not exist)
 *   That is all. No functions.php edit needed. It loads automatically.
 *
 * INSTALLATION — Non-WordPress PHP:
 *   Add to the very top of every PHP page (before any output):
 *   <?php require_once '/path/to/bf-tracker.php'; ?>
 *
 * ── IMPORTANT: CACHING BYPASS ─────────────────────────────────────
 * AI bots receive cached pages by default, which means PHP never runs
 * and visits go untracked. You MUST bypass cache for known bot UAs:
 *
 *  WP Rocket  → Settings › Advanced Rules › Never Cache User Agent
 *  W3 Total Cache → Performance › Page Cache › Rejected User Agents
 *  WP Super Cache → Settings › Advanced › Accepted Filenames & Rejected UAs
 *  LiteSpeed Cache → Cache › Exclude › Do Not Cache User Agents
 *
 * Paste this list into whichever field your plugin provides:
 *   GPTBot
 *   ChatGPT-User
 *   OAI-SearchBot
 *   ClaudeBot
 *   Claude-Web
 *   Google-Extended
 *   Googlebot
 *   PerplexityBot
 *   Perplexity-User
 *   bingbot
 *   CopilotBot
 *   Applebot
 *
 * ── VERIFY INSTALLATION ───────────────────────────────────────────
 * Visit this URL to confirm the plugin is working:
 *   ${client.domain.replace(/\/$/, '')}/?bf_verify=${client.api_key.slice(0,8)}
 * You should see: {"status":"active","client":"${client.name}"}
 *
 * Do NOT edit the API key below.
 */

if (defined('BF_BOT_TRACKER_LOADED')) return;
define('BF_BOT_TRACKER_LOADED', true);
define('BF_TRACKER_API',  '${appUrl}/api/hit');
define('BF_CLIENT_KEY',   '${client.api_key}');
define('BF_VERIFY_TOKEN', '${client.api_key.slice(0,8)}');

// ── Cache bypass: tell PHP-level caching plugins not to cache this request ──
define('DONOTCACHEPAGE',    true);
define('DONOTCACHEDB',      true);
define('DONOTMINIFY',       true);

// ── Verify endpoint: ?bf_verify=XXXXXXXX ────────────────────────────────────
if (isset($_GET['bf_verify']) && $_GET['bf_verify'] === BF_VERIFY_TOKEN) {
  @header('Content-Type: application/json');
  @header('Cache-Control: no-store');
  echo json_encode(['status' => 'active', 'client' => '${client.name}', 'v' => '1.4']);
  exit;
}

// ── Bot detection ────────────────────────────────────────────────────────────
$BF_BOTS = [
  // OpenAI
  'GPTBot'             => 'GPTBot',
  'ChatGPT-User'       => 'ChatGPT-User',
  'OAI-SearchBot'      => 'OAI-SearchBot',
  // Anthropic / Claude
  'ClaudeBot'          => 'ClaudeBot',
  'Claude-Web'         => 'Claude-Web',
  'anthropic-ai'       => 'anthropic-ai',
  // Google AI (AI Overviews)
  'Google-Extended'    => 'Google-Extended',
  'Googlebot'          => 'Googlebot',
  // Perplexity
  'PerplexityBot'      => 'PerplexityBot',
  'Perplexity-User'    => 'Perplexity-User',
  // Microsoft Copilot / Bing
  'bingbot'            => 'bingbot',
  'CopilotBot'         => 'CopilotBot',
  // Apple Intelligence
  'Applebot-Extended'  => 'Applebot-Extended',
  'Applebot'           => 'Applebot',
  // xAI / Grok
  'Grok'               => 'Grok',
  'xAI'                => 'xAI',
  // Meta AI
  'Meta-ExternalAgent' => 'Meta-ExternalAgent',
  'FacebookBot'        => 'FacebookBot',
  // DuckDuckGo AI
  'DuckAssistBot'      => 'DuckAssistBot',
  // Mistral AI
  'MistralBot'         => 'MistralBot',
  // Brave AI
  'BraveBot'           => 'BraveBot',
  // Others
  'Bytespider'         => 'Bytespider',
  'CCBot'              => 'CCBot',
  'cohere-ai'          => 'cohere-ai',
  'YouBot'             => 'YouBot',
  'Diffbot'            => 'Diffbot',
  'Amazonbot'          => 'Amazonbot',
  'AI2Bot'             => 'AI2Bot',
  'Timpibot'           => 'Timpibot',
];

$bf_ua  = isset($_SERVER['HTTP_USER_AGENT']) ? $_SERVER['HTTP_USER_AGENT'] : '';
$bf_bot = null;
foreach ($BF_BOTS as $name => $pattern) {
  if (stripos($bf_ua, $pattern) !== false) { $bf_bot = $name; break; }
}

if ($bf_bot) {
  $bf_payload = json_encode([
    'api_key'     => BF_CLIENT_KEY,
    'url'         => isset($_SERVER['REQUEST_URI']) ? $_SERVER['REQUEST_URI'] : '/',
    'bot_name'    => $bf_bot,
    'user_agent'  => $bf_ua,
    'status_code' => (function_exists('http_response_code') ? http_response_code() : null) ?: 200,
    'country'     => isset($_SERVER['HTTP_CF_IPCOUNTRY']) ? $_SERVER['HTTP_CF_IPCOUNTRY'] : null,
    'referrer'    => isset($_SERVER['HTTP_REFERER'])      ? $_SERVER['HTTP_REFERER']      : null,
  ]);

  // Send tracking request — use whichever non-blocking method is available
  $bf_api = BF_TRACKER_API;

  if (function_exists('wp_remote_post')) {
    // Best method on WordPress/SiteGround: built-in non-blocking HTTP
    // blocking=>false returns immediately without waiting for response
    wp_remote_post($bf_api, [
      'method'    => 'POST',
      'timeout'   => 1,
      'blocking'  => false,
      'sslverify' => false,
      'headers'   => ['Content-Type' => 'application/json'],
      'body'      => $bf_payload,
    ]);
  } elseif (function_exists('fastcgi_finish_request')) {
    // PHP-FPM without WordPress: close connection then send in background
    register_shutdown_function(function() use ($bf_api, $bf_payload) {
      fastcgi_finish_request();
      bf_send_hit($bf_api, $bf_payload);
    });
  } else {
    // Non-FPM fallback: direct send with short timeout
    bf_send_hit($bf_api, $bf_payload);
  }
}

function bf_send_hit($url, $payload) {
  if (function_exists('curl_init')) {
    $ch = curl_init($url);
    curl_setopt_array($ch, [
      CURLOPT_POST           => true,
      CURLOPT_POSTFIELDS     => $payload,
      CURLOPT_HTTPHEADER     => ['Content-Type: application/json'],
      CURLOPT_RETURNTRANSFER => true,
      CURLOPT_TIMEOUT        => 4,
      CURLOPT_CONNECTTIMEOUT => 3,
      CURLOPT_SSL_VERIFYPEER => false,
      CURLOPT_NOSIGNAL       => 1,
    ]);
    @curl_exec($ch);
    curl_close($ch);
  } elseif (ini_get('allow_url_fopen')) {
    @file_get_contents($url, false, stream_context_create(['http' => [
      'method'  => 'POST',
      'header'  => "Content-Type: application/json\r\nContent-Length: " . strlen($payload),
      'content' => $payload,
      'timeout' => 3,
    ]]));
  }
}
`;
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', 'attachment; filename="bf-tracker.php"');
    res.send(phpScript);
  } catch (err) {
    console.error('PHP script error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── PAGE DATE FETCHER ──
function extractModifiedDate(html, lastModHeader) {
  let m;
  m = html.match(/<meta[^>]+property=["']article:modified_time["'][^>]+content=["']([^"']+)["']/i)
     || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']article:modified_time["']/i);
  if (m) return m[1];
  m = html.match(/"dateModified"\s*:\s*"([^"]+)"/);
  if (m) return m[1];
  return lastModHeader || null;
}

function extractPageDates(html, lastModHeader) {
  let m;
  // article:published_time (Open Graph / WordPress Yoast)
  m = html.match(/<meta[^>]+property=["']article:published_time["'][^>]+content=["']([^"']+)["']/i)
     || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']article:published_time["']/i);
  if (m) return { published: m[1], modified: extractModifiedDate(html, lastModHeader), source: 'og:article' };
  // meta name=datePublished
  m = html.match(/<meta[^>]+name=["']datePublished["'][^>]+content=["']([^"']+)["']/i)
     || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+name=["']datePublished["']/i);
  if (m) return { published: m[1], modified: extractModifiedDate(html, lastModHeader), source: 'meta:datePublished' };
  // JSON-LD datePublished
  m = html.match(/"datePublished"\s*:\s*"([^"]+)"/);
  if (m) return { published: m[1], modified: extractModifiedDate(html, lastModHeader), source: 'json-ld' };
  // pubdate / DC.date
  m = html.match(/<meta[^>]+name=["']pubdate["'][^>]+content=["']([^"']+)["']/i)
     || html.match(/<meta[^>]+name=["']DC\.date["'][^>]+content=["']([^"']+)["']/i);
  if (m) return { published: m[1], modified: extractModifiedDate(html, lastModHeader), source: 'meta:pubdate' };
  // Last-Modified header as last resort
  if (lastModHeader) return { published: null, modified: lastModHeader, source: 'http-header' };
  return { published: null, modified: null, source: null };
}

function fetchPageDates(url, domain, redirectCount) {
  redirectCount = redirectCount || 0;
  return new Promise((resolve) => {
    let fullUrl = url;
    if (url.startsWith('/')) fullUrl = 'https://' + domain.replace(/^https?:\/\//, '').replace(/\/$/, '') + url;
    const done = (result) => resolve({ url, ...result });
    let resolved = false;
    const finish = (result) => { if (!resolved) { resolved = true; done(result); } };
    const timer = setTimeout(() => finish({ published: null, modified: null, source: 'timeout' }), 8000);
    try {
      const mod = fullUrl.startsWith('https') ? https : http;
      const req = mod.get(fullUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; BeFound-AITracker/1.0)',
          'Accept': 'text/html',
          'Accept-Encoding': 'identity'   // prevents gzip so we can read raw HTML
        },
        timeout: 6000
      }, (res) => {
        // follow redirects (301 / 302 / 303 / 307 / 308)
        if ([301,302,303,307,308].includes(res.statusCode) && res.headers.location && redirectCount < 3) {
          try { req.destroy(); } catch(e) {}
          clearTimeout(timer);
          const loc = res.headers.location;
          const nextUrl = loc.startsWith('http') ? loc : fullUrl.replace(/^(https?:\/\/[^/]+).*/, '$1') + loc;
          return resolve(fetchPageDates(nextUrl, domain, redirectCount + 1).then(r => ({ ...r, url })));
        }
        const lastMod = res.headers['last-modified'] || null;
        let chunks = [];
        let totalLen = 0;
        res.on('data', chunk => {
          chunks.push(chunk);
          totalLen += chunk.length;
          // peek as text to detect </head> so we can bail early
          const preview = Buffer.concat(chunks).toString('latin1');
          if (preview.includes('</head>') || totalLen > 120000) { try { req.destroy(); } catch(e) {} }
        });
        res.on('close', () => {
          clearTimeout(timer);
          const html = Buffer.concat(chunks).toString('utf8');
          finish(extractPageDates(html, lastMod));
        });
        res.on('error', () => { clearTimeout(timer); finish({ published: null, modified: null, source: 'error' }); });
      });
      req.on('error', () => { clearTimeout(timer); finish({ published: null, modified: null, source: 'error' }); });
      req.on('timeout', () => { try { req.destroy(); } catch(e) {} clearTimeout(timer); finish({ published: null, modified: null, source: 'timeout' }); });
    } catch(e) {
      clearTimeout(timer);
      finish({ published: null, modified: null, source: 'error' });
    }
  });
}

app.get('/api/clients/:clientId/page-dates', auth, async (req, res) => {
  try {
    const { days = 30 } = req.query;
    const clientResult = await pool.query('SELECT domain FROM clients WHERE id = $1', [req.params.clientId]);
    if (!clientResult.rows.length) return res.status(404).json({ error: 'Not found' });
    const domain = clientResult.rows[0].domain;
    const daysInt = Math.min(parseInt(days) || 30, 90);
    const pagesResult = await pool.query(
      `SELECT url, COUNT(*) AS hits FROM bot_hits
       WHERE client_id = $1 AND timestamp >= NOW() - INTERVAL '${daysInt} days'
       GROUP BY url ORDER BY hits DESC LIMIT 25`,
      [req.params.clientId]
    );
    const urls = pagesResult.rows.map(r => r.url);
    const results = [];
    for (let i = 0; i < urls.length; i += 5) {
      const batch = await Promise.all(urls.slice(i, i + 5).map(u => fetchPageDates(u, domain)));
      results.push(...batch);
    }
    res.json({ pages: results });
  } catch (err) {
    console.error('page-dates error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── WORKER SCRIPT DOWNLOAD ──
app.get('/api/clients/:clientId/worker-script', auth, async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM clients WHERE id = $1', [req.params.clientId]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Client not found' });
    const client = result.rows[0];
    const appUrl = 'https://aicrawler.befoundsearch.com';
    const workerScript = `// BeFound AI Tracker
// Client: ${client.name} (${client.domain})
// Do NOT edit the API_URL or CLIENT_API_KEY values below.

const API_URL = '${appUrl}/api/hit';
const CLIENT_API_KEY = '${client.api_key}';

const AI_BOTS = [
  // OpenAI
  'GPTBot', 'ChatGPT-User', 'OAI-SearchBot',
  // Anthropic / Claude
  'ClaudeBot', 'Claude-Web', 'anthropic-ai',
  // Google AI (Gemini, AI Overviews)
  'Google-Extended', 'Googlebot',
  // Perplexity
  'PerplexityBot', 'Perplexity-User',
  // Microsoft Copilot / Bing
  'bingbot', 'CopilotBot',
  // Apple Intelligence
  'Applebot-Extended', 'Applebot',
  // Meta AI
  'Meta-ExternalAgent', 'FacebookBot',
  // Others
  'Bytespider', 'CCBot', 'cohere-ai', 'YouBot', 'Diffbot',
  'Amazonbot', 'DuckAssistBot', 'AI2Bot', 'Timpibot',
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

// ── VERIFY PLUGIN INSTALLATION ──
app.get('/api/clients/:clientId/verify', auth, async (req, res) => {
  try {
    const result = await pool.query('SELECT domain, api_key, name FROM clients WHERE id=$1', [req.params.clientId]);
    if (!result.rows.length) return res.status(404).json({ error: 'Client not found' });
    const { domain, api_key, name } = result.rows[0];
    const token = api_key.slice(0, 8);
    let base = domain.trim().replace(/\/$/, '');
    if (!base.startsWith('http')) base = 'https://' + base;
    const verifyUrl = base + '/?bf_verify=' + token;
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 8000);
      const resp = await fetch(verifyUrl, {
        headers: { 'User-Agent': 'BeFound-Verify/1.0', 'Accept': 'application/json' },
        signal: controller.signal,
        redirect: 'follow',
      });
      clearTimeout(timeout);
      const text = await resp.text();
      let json = null;
      try { json = JSON.parse(text); } catch(e) {}
      if (json && json.status === 'active') {
        res.json({ ok: true, message: 'Plugin is active on ' + name, version: json.v || '?' });
      } else {
        res.json({ ok: false, message: 'Plugin not detected. Make sure the file is installed in wp-content/mu-plugins/ and not still in the WordPress root.' });
      }
    } catch(fetchErr) {
      res.json({ ok: false, message: 'Could not reach ' + base + ' — check the domain is correct and the site is online.' });
    }
  } catch(err) {
    res.status(500).json({ error: err.message });
  }
});

// ── SEND TEST HIT (simulates a bot visit for testing) ──
app.post('/api/clients/:clientId/test-hit', auth, async (req, res) => {
  try {
    const result = await pool.query('SELECT id, name FROM clients WHERE id=$1', [req.params.clientId]);
    if (!result.rows.length) return res.status(404).json({ error: 'Not found' });
    const clientId = result.rows[0].id;
    await pool.query(
      `INSERT INTO bot_hits (client_id, url, bot_name, user_agent, status_code, country, referrer)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [clientId, '/', 'GPTBot', 'Mozilla/5.0 (compatible; GPTBot/1.1; +https://openai.com/gptbot) [BeFound-Test]', 200, 'GB', null]
    );
    res.json({ ok: true, message: 'Test hit recorded as GPTBot on /' });
  } catch(err) {
    res.status(500).json({ error: err.message });
  }
});

// ── LIVE ACTIVITY (last 5 minutes) ──
app.get('/api/live/:clientId', auth, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT bot_name, url, timestamp, country
       FROM bot_hits
       WHERE client_id=$1 AND timestamp > NOW() - INTERVAL '5 minutes'
       ORDER BY timestamp DESC LIMIT 20`,
      [req.params.clientId]
    );
    res.json({ hits: result.rows, count: result.rows.length, serverTime: new Date().toISOString() });
  } catch(err) {
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
