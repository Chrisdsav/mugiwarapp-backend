// ============================================
// MUGIWARAPP BACKEND — Buscador de ENLACES DIRECTOS
// (Funciona como Cuevana: encuentra mp4, m3u8 de Streamtape, Dood, Filemoon, etc.)
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

// ===== LISTA DE SITIOS DONDE BUSCAR ENLACES =====
const SOURCES = {
  // SITIOS DE ALMACENAMIENTO (donde están los videos REALES)
  videoHosts: [
    'streamtape', 'doodstream', 'dood', 'filemoon', 'ok.ru', 'okru',
    'mega.nz', 'mega', 'mixdrop', 'uqload', 'mp4upload', 'sendvid',
    'vidlox', 'waaw', 'voe.sx', 'upstream', 'fembed', 'streamwish'
  ],
  // SITIOS DE BÚSQUEDA (como Cuevana)
  searchSites: [
    { name: 'Cuevana', url: 'https://cuevana3.com', scraper: scrapeCuevana },
    { name: 'Pelisplus', url: 'https://pelisplus.app', scraper: scrapePelisplus },
    { name: 'Gnula', url: 'https://gnula.nu', scraper: scrapeGnula },
    { name: 'Repelis', url: 'https://repelis24.co', scraper: scrapeRepelis }
  ]
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

// ===== LO MÁS IMPORTANTE: EXTRAER ENLACES DIRECTOS DE VIDEO =====
function extractDirectVideoLinks(html, pageUrl = '') {
  if (!html) return [];
  const $ = cheerio.load(html);
  const sources = new Map(); // Usar Map para evitar duplicados

  // 1. Buscar en iframes (muchos sitios ponen el video dentro de iframes)
  $('iframe').each((_, el) => {
    const src = $(el).attr('src') || $(el).attr('data-src') || '';
    if (src && isVideoHost(src)) {
      sources.set(src, { url: fixUrl(src), type: 'iframe', quality: 'Auto' });
    }
  });

  // 2. Buscar etiquetas video y source directas
  $('video source').each((_, el) => {
    const src = $(el).attr('src');
    if (src && isVideoHost(src)) {
      sources.set(src, { url: fixUrl(src), type: 'direct', quality: $(el).attr('quality') || 'Auto' });
    }
  });

  // 3. Buscar enlaces dentro de scripts (donde suelen estar los enlaces reales)
  const scripts = $('script').map((_, el) => $(el).html()).get().join('\n');
  
  // Patrones para encontrar enlaces a video
  const patterns = [
    // Streamtape, Doodstream, Filemoon
    /(?:src|file|source|video_url|file_url|link|url)\s*[:=]\s*['"]([^'"]*?(?:streamtape|dood|filemoon|ok\.ru|okru|mixdrop|uqload|mp4upload|sendvid|vidlox|waaw|voe|upstream|fembed|streamwish)[^'"]*?)['"]/gi,
    // Enlaces directos .mp4 .m3u8
    /(?:src|file|source|video_url|file_url|link|url)\s*[:=]\s*['"]([^'"]*?\.(?:mp4|m3u8|mkv|webm)[^'"]*?)['"]/gi,
    // Enlaces en formato JSON
    /"file"\s*:\s*"([^"]*?\.(?:mp4|m3u8)[^"]*?)"/gi,
    /"url"\s*:\s*"([^"]*?\.(?:mp4|m3u8)[^"]*?)"/gi,
    /"link"\s*:\s*"([^"]*?\.(?:mp4|m3u8)[^"]*?)"/gi,
    // Enlaces en texto plano
    /(https?:\/\/[^\s"'<>]+\.(?:mp4|m3u8|mkv|webm)[^\s"'<>]*)/gi,
    // Ok.ru específico
    /(?:src|data-url)\s*[:=]\s*['"]([^'"]*?ok\.ru[^'"]*?)['"]/gi,
  ];

  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(scripts)) !== null) {
      const url = match[1];
      if (url && (isVideoHost(url) || url.match(/\.(mp4|m3u8|mkv|webm)$/i))) {
        if (!sources.has(url)) {
          sources.set(url, { url: fixUrl(url), type: 'script', quality: detectQuality(url) });
        }
      }
    }
  }

  // 4. Buscar en atributos data-*
  $('[data-video], [data-src-video], [data-url]').each((_, el) => {
    const dataVideo = $(el).attr('data-video') || $(el).attr('data-src-video') || $(el).attr('data-url');
    if (dataVideo && isVideoHost(dataVideo)) {
      sources.set(dataVideo, { url: fixUrl(dataVideo), type: 'data', quality: 'Auto' });
    }
  });

  return Array.from(sources.values());
}

// Verificar si una URL es de un sitio que aloja videos
function isVideoHost(url) {
  if (!url) return false;
  const urlLower = url.toLowerCase();
  return SOURCES.videoHosts.some(host => urlLower.includes(host));
}

// Detectar calidad del video
function detectQuality(url) {
  const urlLower = url.toLowerCase();
  if (urlLower.includes('1080') || urlLower.includes('1080p')) return '1080p';
  if (urlLower.includes('720') || urlLower.includes('720p')) return '720p';
  if (urlLower.includes('480') || urlLower.includes('480p')) return '480p';
  return 'Auto';
}

// Detectar idioma (ahora priorizamos latino)
function detectLanguageFromUrl(url, context = '') {
  const combined = (url + context).toLowerCase();
  if (combined.includes('latino') || combined.includes('lat') || combined.includes('es-la') || combined.includes('spanish')) return 'Latino';
  if (combined.includes('castellano') || combined.includes('spain') || combined.includes('es-es')) return 'España';
  if (combined.includes('sub') || combined.includes('subtitulo') || combined.includes('subtitle')) return 'Subtitulado';
  if (combined.includes('english') || combined.includes('eng')) return 'Inglés';
  return 'Latino'; // Por defecto latino porque es lo que buscamos
}

function fixUrl(url) {
  if (!url) return '';
  if (url.startsWith('//')) return 'https:' + url;
  return url;
}

// ===== SCRAPERS PARA CADA SITIO (BUSCAN ENLACES DIRECTOS) =====

// Scraper genérico para cualquier sitio
async function scrapeSite(baseUrl, searchPath, tmdbId, type, season, episode) {
  try {
    let searchUrl;
    if (type === 'movie') {
      searchUrl = `${baseUrl}/pelicula/${tmdbId}`;
    } else {
      searchUrl = `${baseUrl}/serie/${tmdbId}/temporada-${season}/episodio-${episode}`;
    }
    
    const html = await fetchPage(searchUrl, { Referer: baseUrl });
    if (!html) return [];
    
    const videoLinks = extractDirectVideoLinks(html, searchUrl);
    return videoLinks.map(link => ({
      url: link.url,
      quality: link.quality,
      lang: detectLanguageFromUrl(link.url, html),
      source: baseUrl
    }));
  } catch (e) {
    console.error(`Error scraping ${baseUrl}:`, e.message);
    return [];
  }
}

// Scraper específico para Cuevana
async function scrapeCuevana(tmdbId, type, season, episode) {
  try {
    const baseUrl = 'https://cuevana3.com';
    let targetUrl;
    
    if (type === 'movie') {
      targetUrl = `${baseUrl}/pelicula/${tmdbId}`;
    } else {
      targetUrl = `${baseUrl}/serie/${tmdbId}/temporada-${season}/episodio-${episode}`;
    }
    
    const html = await fetchPage(targetUrl, { Referer: baseUrl });
    if (!html) return [];
    
    const $ = cheerio.load(html);
    const sources = [];
    
    // Buscar los servidores que ofrece Cuevana (Streamtape, Dood, etc.)
    $('.server-item, .option-server, [data-server]').each((_, el) => {
      const serverData = $(el).attr('data-server') || $(el).attr('data-link') || '';
      const serverUrl = $(el).attr('data-url') || $(el).attr('href') || '';
      const serverName = $(el).text().toLowerCase();
      
      if (serverData && isVideoHost(serverData)) {
        sources.push({ url: fixUrl(serverData), quality: '1080p', lang: 'Latino' });
      }
      if (serverUrl && isVideoHost(serverUrl)) {
        sources.push({ url: fixUrl(serverUrl), quality: '1080p', lang: 'Latino' });
      }
      if (serverName.includes('streamtape') || serverName.includes('dood') || serverName.includes('filemoon')) {
        // El enlace puede estar en un atributo onclick
        const onclick = $(el).attr('onclick') || '';
        const urlMatch = onclick.match(/['"](https?:\/\/[^'"]+)['"]/);
        if (urlMatch && isVideoHost(urlMatch[1])) {
          sources.push({ url: fixUrl(urlMatch[1]), quality: '1080p', lang: 'Latino' });
        }
      }
    });
    
    // También extraer de iframes
    const iframeSources = extractDirectVideoLinks(html);
    sources.push(...iframeSources);
    
    return sources;
  } catch (e) {
    console.error('Cuevana error:', e.message);
    return [];
  }
}

// Scraper para Pelisplus
async function scrapePelisplus(tmdbId, type, season, episode) {
  try {
    const baseUrl = 'https://pelisplus.app';
    let targetUrl;
    
    if (type === 'movie') {
      targetUrl = `${baseUrl}/ver-pelicula/${tmdbId}`;
    } else {
      targetUrl = `${baseUrl}/ver-serie/${tmdbId}/temporada-${season}/episodio-${episode}`;
    }
    
    const html = await fetchPage(targetUrl, { Referer: baseUrl });
    if (!html) return [];
    
    return extractDirectVideoLinks(html).map(link => ({
      url: link.url,
      quality: link.quality,
      lang: 'Latino',
      source: 'pelisplus'
    }));
  } catch (e) {
    console.error('Pelisplus error:', e.message);
    return [];
  }
}

// Scraper para Gnula
async function scrapeGnula(tmdbId, type, season, episode) {
  try {
    const baseUrl = 'https://gnula.nu';
    let targetUrl;
    
    if (type === 'movie') {
      targetUrl = `${baseUrl}/pelicula/${tmdbId}`;
    } else {
      targetUrl = `${baseUrl}/serie/${tmdbId}/temporada-${season}/episodio-${episode}`;
    }
    
    const html = await fetchPage(targetUrl, { Referer: baseUrl });
    if (!html) return [];
    
    return extractDirectVideoLinks(html).map(link => ({
      url: link.url,
      quality: link.quality,
      lang: 'Latino',
      source: 'gnula'
    }));
  } catch (e) {
    console.error('Gnula error:', e.message);
    return [];
  }
}

// Scraper para Repelis
async function scrapeRepelis(tmdbId, type, season, episode) {
  try {
    const baseUrl = 'https://repelis24.co';
    let targetUrl;
    
    if (type === 'movie') {
      targetUrl = `${baseUrl}/pelicula/${tmdbId}`;
    } else {
      targetUrl = `${baseUrl}/serie/${tmdbId}/${season}/${episode}`;
    }
    
    const html = await fetchPage(targetUrl, { Referer: baseUrl });
    if (!html) return [];
    
    return extractDirectVideoLinks(html).map(link => ({
      url: link.url,
      quality: link.quality,
      lang: 'Latino',
      source: 'repelis'
    }));
  } catch (e) {
    console.error('Repelis error:', e.message);
    return [];
  }
}

// ===== API ENDPOINTS =====

// Health check
app.get('/', (req, res) => {
  res.json({ status: 'ok', app: 'Mugiwarapp Backend - Stream Finder', version: '3.0' });
});

// Endpoint principal: buscar enlaces directos de video
app.get('/api/streams', async (req, res) => {
  const { tmdbId, type, season = 1, episode = 1, title = '' } = req.query;

  if (!tmdbId) {
    return res.status(400).json({ error: 'tmdbId es requerido' });
  }

  // Limpiar ID (convertir tt12345 a 12345)
  const cleanId = tmdbId.toString().replace(/^tt/, '');
  console.log(`Buscando: ${type} ID:${cleanId} T${season}E${episode}`);

  try {
    // ===== 1. BUSCAR EN TODOS LOS SITIOS DE SCRAPING (COMO CUEVANA) =====
    console.log('🔍 Buscando en sitios de scraping (Cuevana, Pelisplus, Gnula, Repelis)...');
    
    const scrapers = [
      scrapeCuevana(cleanId, type, season, episode),
      scrapePelisplus(cleanId, type, season, episode),
      scrapeGnula(cleanId, type, season, episode),
      scrapeRepelis(cleanId, type, season, episode)
    ];
    
    const results = await Promise.allSettled(scrapers);
    
    let allSources = [];
    for (const result of results) {
      if (result.value && result.value.length > 0) {
        allSources.push(...result.value);
      }
    }
    
    console.log(`📊 Scrapers encontraron: ${allSources.length} enlaces directos`);
    
    // Filtrar enlaces válidos y eliminar duplicados
    const seen = new Set();
    const uniqueSources = allSources.filter(s => {
      if (!s.url || seen.has(s.url)) return false;
      seen.add(s.url);
      return true;
    });
    
    // Ordenar por calidad (1080p primero)
    const ordered = uniqueSources.sort((a, b) => {
      const qualityOrder = { '1080p': 0, '720p': 1, '480p': 2, 'Auto': 3 };
      return (qualityOrder[a.quality] || 4) - (qualityOrder[b.quality] || 4);
    });
    
    console.log(`✅ Total enlaces únicos: ${ordered.length}`);
    
    // Mostrar algunos ejemplos
    if (ordered.length > 0) {
      console.log(`📹 Ejemplos: ${ordered.slice(0, 3).map(s => s.url.substring(0, 60)).join(', ')}`);
    }
    
    res.json({ 
      sources: ordered, 
      total: ordered.length,
      message: ordered.length === 0 ? 'No se encontraron enlaces. Puede que el contenido no esté disponible en latino.' : null
    });

  } catch (err) {
    console.error('Error general:', err);
    res.status(500).json({ error: 'Error buscando streams', sources: [] });
  }
});

// Proxy para evitar bloqueos CORS
app.get('/api/proxy', async (req, res) => {
  const { url } = req.query;
  
  if (!url) {
    return res.status(400).json({ error: 'URL requerida' });
  }
  
  try {
    const targetUrl = decodeURIComponent(url);
    console.log(`🌐 Proxy: ${targetUrl.substring(0, 100)}...`);
    
    const response = await axios.get(targetUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'es-ES,es;q=0.8,en;q=0.5',
        'Referer': 'https://www.google.com/',
      },
      timeout: 20000,
      maxRedirects: 5,
      responseType: 'text'
    });
    
    res.setHeader('Content-Type', response.headers['content-type'] || 'text/html');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.send(response.data);
    
  } catch (error) {
    console.error('Proxy error:', error.message);
    res.status(500).json({ error: 'Error en proxy', details: error.message });
  }
});

// Iniciar servidor
app.listen(PORT, () => {
  console.log(`🚀 Mugiwarapp Backend corriendo en puerto ${PORT}`);
  console.log(`📹 Modo: Búsqueda de enlaces directos (Streamtape, Dood, Filemoon, etc.)`);
});