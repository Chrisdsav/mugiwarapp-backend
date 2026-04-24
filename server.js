// ============================================
// MUGIWARAPP BACKEND — Scraper de streams
// ============================================

const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

// Headers para simular un navegador real
const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'es-MX,es;q=0.9,en;q=0.8',
  'Accept-Encoding': 'gzip, deflate, br',
  'Referer': 'https://www.google.com/',
};

// ===== UTILIDADES =====

async function fetchPage(url, extraHeaders = {}) {
  try {
    const res = await axios.get(url, {
      headers: { ...HEADERS, ...extraHeaders },
      timeout: 15000,
      maxRedirects: 5,
    });
    return res.data;
  } catch (err) {
    console.error(`Error fetching ${url}:`, err.message);
    return null;
  }
}

// Extraer iframes y fuentes de video de una página
function extractSources(html) {
  if (!html) return [];
  const $ = cheerio.load(html);
  const sources = [];

  // Buscar iframes
  $('iframe').each((_, el) => {
    const src = $(el).attr('src') || $(el).attr('data-src');
    if (src && isVideoSource(src)) {
      sources.push({ type: 'iframe', url: fixUrl(src) });
    }
  });

  // Buscar fuentes de video directas
  $('source').each((_, el) => {
    const src = $(el).attr('src');
    if (src) sources.push({ type: 'direct', url: fixUrl(src) });
  });

  // Buscar en scripts
  const scriptContent = $('script').map((_, el) => $(el).html()).get().join('\n');
  const patterns = [
    /file:\s*["']([^"']+\.m3u8[^"']*)/g,
    /source:\s*["']([^"']+\.mp4[^"']*)/g,
    /["'](https?:\/\/[^"']*\.m3u8[^"']*)/g,
    /["'](https?:\/\/[^"']*filemoon[^"']*)/g,
    /["'](https?:\/\/[^"']*streamtape[^"']*)/g,
    /["'](https?:\/\/[^"']*dood[^"']*)/g,
    /["'](https?:\/\/[^"']*okru[^"']*)/g,
    /["'](https?:\/\/[^"']*ok\.ru[^"']*)/g,
  ];

  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(scriptContent)) !== null) {
      if (isVideoSource(match[1])) {
        sources.push({ type: 'script', url: fixUrl(match[1]) });
      }
    }
  }

  return [...new Map(sources.map(s => [s.url, s])).values()];
}

function isVideoSource(url) {
  if (!url) return false;
  const videoHosts = [
    'filemoon', 'streamtape', 'doodstream', 'dood.',
    'okru', 'ok.ru', 'fembed', 'streamwish',
    'upstream', 'voe.sx', 'mixdrop', 'uqload',
    'mp4upload', 'sendvid', 'vidlox', 'waaw',
    'm3u8', '.mp4', 'hlsplay', 'cloudvideo',
  ];
  return videoHosts.some(h => url.toLowerCase().includes(h));
}

function fixUrl(url) {
  if (url.startsWith('//')) return 'https:' + url;
  if (url.startsWith('/')) return url;
  return url;
}

function detectLanguage(url, text = '') {
  const combined = (url + text).toLowerCase();
  if (combined.includes('latino') || combined.includes('lat') || combined.includes('es-la')) return 'Latino';
  if (combined.includes('castellano') || combined.includes('spain') || combined.includes('es-es')) return 'España';
  if (combined.includes('sub') || combined.includes('subtitulo')) return 'Subtitulado';
  if (combined.includes('english') || combined.includes('eng')) return 'Inglés';
  return 'Latino'; // Por defecto asumimos latino
}

// ===== SCRAPERS POR SITIO =====

// Cuevana3
async function scrapeCuevana(tmdbId, type, season, episode) {
  try {
    const baseUrl = 'https://cuevana3.me';
    const searchUrl = `${baseUrl}/buscar?q=${tmdbId}`;
    const searchHtml = await fetchPage(searchUrl);
    if (!searchHtml) return [];

    const $ = cheerio.load(searchHtml);
    let contentUrl = '';

    $('a').each((_, el) => {
      const href = $(el).attr('href') || '';
      if (type === 'movie' && href.includes('/pelicula/')) contentUrl = href;
      if (type === 'tv' && href.includes('/serie/')) contentUrl = href;
    });

    if (!contentUrl) return [];

    let targetUrl = contentUrl.startsWith('http') ? contentUrl : baseUrl + contentUrl;

    if (type === 'tv') {
      targetUrl = `${targetUrl}/season/${season}/episode/${episode}`;
    }

    const html = await fetchPage(targetUrl, { Referer: baseUrl });
    const sources = extractSources(html);

    // Intentar extraer opciones de servidor de Cuevana
    const $page = cheerio.load(html);
    const serverLinks = [];
    $page('.server-item, .option, [data-player]').each((_, el) => {
      const url = $page(el).attr('data-player') || $page(el).attr('href') || '';
      const lang = $page(el).text().trim();
      if (url) serverLinks.push({ url: fixUrl(url), lang: detectLanguage(url, lang) });
    });

    return [...serverLinks, ...sources.map(s => ({ url: s.url, lang: 'Latino' }))];
  } catch (e) {
    console.error('Cuevana error:', e.message);
    return [];
  }
}

// Pelisplus
async function scrapePelisplus(tmdbId, type, season, episode) {
  try {
    const baseUrl = 'https://pelisplus.app';
    const searchUrl = `${baseUrl}/search?q=${tmdbId}`;
    const searchHtml = await fetchPage(searchUrl);
    if (!searchHtml) return [];

    const $ = cheerio.load(searchHtml);
    let contentUrl = '';

    $('a').each((_, el) => {
      const href = $(el).attr('href') || '';
      if (type === 'movie' && href.includes('/pelicula/')) contentUrl = href;
      if (type === 'tv' && href.includes('/serie/')) contentUrl = href;
    });

    if (!contentUrl) return [];

    let targetUrl = contentUrl.startsWith('http') ? contentUrl : baseUrl + contentUrl;
    if (type === 'tv') targetUrl = `${targetUrl}/season/${season}/episode/${episode}`;

    const html = await fetchPage(targetUrl, { Referer: baseUrl });
    return extractSources(html).map(s => ({
      url: s.url,
      lang: detectLanguage(s.url),
    }));
  } catch (e) {
    console.error('Pelisplus error:', e.message);
    return [];
  }
}

// Gnula
async function scrapeGnula(title, type, season, episode) {
  try {
    const baseUrl = 'https://gnula.nu';
    const searchUrl = `${baseUrl}/?s=${encodeURIComponent(title)}`;
    const searchHtml = await fetchPage(searchUrl);
    if (!searchHtml) return [];

    const $ = cheerio.load(searchHtml);
    let contentUrl = '';

    $('.result-item a, article a').each((_, el) => {
      if (!contentUrl) contentUrl = $(el).attr('href') || '';
    });

    if (!contentUrl) return [];

    let targetUrl = type === 'tv'
      ? `${contentUrl}season/${season}/episode/${episode}/`
      : contentUrl;

    const html = await fetchPage(targetUrl, { Referer: baseUrl });
    return extractSources(html).map(s => ({
      url: s.url,
      lang: detectLanguage(s.url),
    }));
  } catch (e) {
    console.error('Gnula error:', e.message);
    return [];
  }
}

// ===== API ENDPOINTS =====

// Health check
app.get('/', (req, res) => {
  res.json({ status: 'ok', app: 'Mugiwarapp Backend', version: '1.0' });
});

// Endpoint principal: buscar streams
app.get('/api/streams', async (req, res) => {
  const { tmdbId, type, season = 1, episode = 1, title = '' } = req.query;

  if (!tmdbId) {
    return res.status(400).json({ error: 'tmdbId es requerido' });
  }

  console.log(`Buscando: ${type} ID:${tmdbId} T${season}E${episode}`);

  try {
    // Buscar en paralelo en todos los sitios
    const [cuevana, pelisplus, gnula] = await Promise.allSettled([
      scrapeCuevana(tmdbId, type, season, episode),
      scrapePelisplus(tmdbId, type, season, episode),
      scrapeGnula(title, type, season, episode),
    ]);

    const allSources = [
      ...(cuevana.value || []),
      ...(pelisplus.value || []),
      ...(gnula.value || []),
    ];

    // Deduplicar y ordenar: Latino primero
    const seen = new Set();
    const unique = allSources.filter(s => {
      if (!s.url || seen.has(s.url)) return false;
      seen.add(s.url);
      return true;
    });

    const ordered = [
      ...unique.filter(s => s.lang === 'Latino'),
      ...unique.filter(s => s.lang === 'España'),
      ...unique.filter(s => s.lang === 'Subtitulado'),
      ...unique.filter(s => s.lang === 'Inglés'),
      ...unique.filter(s => !['Latino','España','Subtitulado','Inglés'].includes(s.lang)),
    ];

    console.log(`Encontradas ${ordered.length} fuentes`);
    res.json({ sources: ordered, total: ordered.length });

  } catch (err) {
    console.error('Error general:', err);
    res.status(500).json({ error: 'Error buscando streams', sources: [] });
  }
});

// Proxy para iframes (evita bloqueos CORS)
app.get('/api/proxy', async (req, res) => {
  const { url } = req.query;
  if (!url) return res.status(400).json({ error: 'URL requerida' });

  try {
    const response = await axios.get(decodeURIComponent(url), {
      headers: HEADERS,
      timeout: 10000,
      responseType: 'text',
    });
    res.setHeader('Content-Type', 'text/html');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.send(response.data);
  } catch (err) {
    res.status(500).json({ error: 'Error en proxy' });
  }
});

app.listen(PORT, () => {
  console.log(`Mugiwarapp Backend corriendo en puerto ${PORT}`);
});