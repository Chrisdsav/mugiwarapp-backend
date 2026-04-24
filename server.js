// ============================================
// MUGIWARAPP BACKEND — Scraper de streams + Consumet API
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

// ===== CONFIGURACIÓN CONSUMET =====
const CONSUMET_API = 'https://api.consumet.org';

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
  return 'Latino';
}

// ===== SCRAPERS POR SITIO (RESPALDO) =====

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

// ===== NUEVA FUNCIÓN: CONSUMET API =====
async function fetchFromConsumet(tmdbId, type, season, episode) {
  try {
    let consumetUrl;
    
    if (type === 'movie') {
      consumetUrl = `${CONSUMET_API}/movies/tmdb/watch/${tmdbId}`;
    } else {
      consumetUrl = `${CONSUMET_API}/meta/tmdb/watch/${tmdbId}?season=${season}&episode=${episode}`;
    }
    
    console.log(`Consultando Consumet: ${consumetUrl}`);
    
    const response = await axios.get(consumetUrl, {
      headers: HEADERS,
      timeout: 15000
    });
    
    const data = response.data;
    const sources = [];
    
    // Procesar las fuentes de Consumet
    if (data.sources && Array.isArray(data.sources)) {
      for (const source of data.sources) {
        let lang = 'Latino';
        const urlLower = (source.url + '').toLowerCase();
        if (urlLower.includes('es-es') || urlLower.includes('spain')) lang = 'España';
        else if (urlLower.includes('sub') || urlLower.includes('subtitle')) lang = 'Subtitulado';
        else if (urlLower.includes('eng')) lang = 'Inglés';
        
        sources.push({
          url: source.url,
          quality: source.quality || 'Auto',
          lang: lang,
          source: 'consumet'
        });
      }
    } else if (data.url) {
      sources.push({
        url: data.url,
        quality: data.quality || 'Auto',
        lang: 'Latino',
        source: 'consumet'
      });
    }
    
    return sources;
  } catch (error) {
    console.error('Consumet error:', error.message);
    return [];
  }
}

// ===== API ENDPOINTS =====

// Health check
app.get('/', (req, res) => {
  res.json({ status: 'ok', app: 'Mugiwarapp Backend', version: '2.0' });
});

// Endpoint principal: buscar streams (CONSUMET PRIORITARIO)
app.get('/api/streams', async (req, res) => {
  const { tmdbId, type, season = 1, episode = 1, title = '' } = req.query;

  if (!tmdbId) {
    return res.status(400).json({ error: 'tmdbId es requerido' });
  }

  console.log(`Buscando: ${type} ID:${tmdbId} T${season}E${episode}`);

  try {
    // 1. PRIMERO: Intentar con Consumet (más confiable)
    let consumetSources = await fetchFromConsumet(tmdbId, type, season, episode);
    
    let allSources = [...consumetSources];
    
    // 2. SEGUNDO: Si Consumet no dio resultados, usar scrapers como respaldo
    if (consumetSources.length === 0) {
      console.log('Consumet sin resultados, usando scrapers...');
      const [cuevana, pelisplus, gnula] = await Promise.allSettled([
        scrapeCuevana(tmdbId, type, season, episode),
        scrapePelisplus(tmdbId, type, season, episode),
        scrapeGnula(title, type, season, episode),
      ]);
      
      const scrapedSources = [
        ...(cuevana.value || []),
        ...(pelisplus.value || []),
        ...(gnula.value || []),
      ];
      
      allSources = [...allSources, ...scrapedSources];
    }
    
    // 3. TERCERO: Fallback a vidsrc si todo lo demás falla
    if (allSources.length === 0) {
      const cleanId = tmdbId.startsWith('tt') ? tmdbId : `tt${tmdbId}`;
      const fallbackUrl = type === 'movie'
        ? `https://vidsrc.xyz/embed/movie/${cleanId}`
        : `https://vidsrc.xyz/embed/tv/${cleanId}/${season}/${episode}`;
      
      allSources.push({
        url: fallbackUrl,
        lang: 'Latino',
        quality: 'Auto',
        fallback: true
      });
    }
    
    // Deduplicar y ordenar
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
    
    console.log(`Encontradas ${ordered.length} fuentes (Consumet: ${consumetSources.length})`);
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