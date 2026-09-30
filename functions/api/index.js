const SERVER_POOLS = Object.freeze({
  "0022": [
    "http://rekgol.top",
    "http://aptxu.com"
  ],
  "PFAST": [
    "http://wrb-tv.top",
    "http://p1fast.com"
  ]
});

const REQUEST_TIMEOUT_MS = 8000;

function normalizeServer(value) {
  let server = String(value || "").trim();
  if (!server) return "";
  if (!/^https?:\/\//i.test(server)) server = `http://${server}`;
  return server.replace(/\/+$/, "");
}

function resolveServerCandidates(server, providedCandidates = []) {
  const raw = String(server || "").trim();
  const key = raw.toUpperCase();

  if (SERVER_POOLS[key]) return [...SERVER_POOLS[key]];

  const candidates = [raw, ...(Array.isArray(providedCandidates) ? providedCandidates : [])]
    .map(normalizeServer)
    .filter(Boolean);

  return [...new Set(candidates)];
}

async function fetchWithTimeout(url, options = {}) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: {
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "GET, HEAD, POST, OPTIONS",
      "access-control-allow-headers": "Range, Content-Type, Accept, Authorization",
      "access-control-expose-headers": "Content-Range, Content-Length, Accept-Ranges",
      "access-control-max-age": "86400",
    },
  });
}

export async function onRequestPost(context) {
  const { request } = context;

  const jsonHeaders = {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET, POST, OPTIONS",
    "access-control-allow-headers": "Content-Type",
  };

  let b;
  try {
    b = await request.json();
  } catch {
    return Response.json({ error: "JSON inválido." }, { status: 400, headers: jsonHeaders });
  }

  try {
    const requestedServer = String(b.server || "").trim();
    const serverCandidates = resolveServerCandidates(requestedServer, b.serverCandidates);
    const u = String(b.user || "");
    const p = String(b.pass || "");

    if (b.action !== "m3u" && (!serverCandidates.length || !u || !p)) {
      return Response.json({ error: "Servidor, usuário e senha são obrigatórios." }, { status: 400, headers: jsonHeaders });
    }

    const userAgents = [
      "IPTVSmartersPro/1.0.0",
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
      "VLC/3.0.18 LibVLC/3.0.18"
    ];

    async function smartFetch(url) {
      let lastResponse = null;
      for (const ua of userAgents) {
        try {
          const r = await fetchWithTimeout(url, {
            redirect: "follow",
            headers: {
              "user-agent": ua,
              "accept": "application/json, text/plain, */*",
              "accept-language": "pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7"
            }
          });
          lastResponse = r;
          if (r.ok || r.status !== 403) return r;
        } catch {
          // continuar tentando
        }
      }
      if (lastResponse) return lastResponse;
      throw new Error("Tempo esgotado ao conectar ao servidor.");
    }

    async function fetchXtreamFromServer(server, query) {
      const base = `${server}/player_api.php?username=${encodeURIComponent(u)}&password=${encodeURIComponent(p)}`;
      const url = `${base}&${query}`;
      const r = await smartFetch(url);
      if (!r.ok) return { ok: false, status: r.status, data: null };
      try {
        return { ok: true, status: r.status, data: await r.json() };
      } catch {
        return { ok: false, status: 502, data: null };
      }
    }

    async function fetchXtream(query) {
      for (const candidate of serverCandidates) {
        try {
          const result = await fetchXtreamFromServer(candidate, query);
          if (result.ok) return { ...result, server: candidate };
        } catch {
          // tenta o próximo servidor do pool
        }
      }
      return { ok: false, status: 502, data: null, server: null };
    }

    // 1. LOGIN & CATEGORIAS RÁPIDAS
    if (b.action === "login") {
      let selectedServer = null;
      let auth = null;
      let lastError = "Não foi possível conectar aos servidores configurados.";

      for (const candidate of serverCandidates) {
        try {
          const base = `${candidate}/player_api.php?username=${encodeURIComponent(u)}&password=${encodeURIComponent(p)}`;
          const authR = await smartFetch(base);

          if (!authR.ok) {
            lastError = `Servidor respondeu HTTP ${authR.status} ao validar o acesso.`;
            continue;
          }

          const candidateAuth = await authR.json();
          if (Number(candidateAuth?.user_info?.auth) === 1) {
            selectedServer = candidate;
            auth = candidateAuth;
            break;
          }

          lastError = candidateAuth?.user_info?.message || "Usuário ou senha inválidos.";
        } catch (error) {
          lastError = error?.message || lastError;
        }
      }

      if (!selectedServer || !auth) {
        return Response.json({ auth: false, error: lastError }, { status: 502, headers: jsonHeaders });
      }

      const selectedCandidates = [selectedServer, ...serverCandidates.filter(x => x !== selectedServer)];

      async function fetchSelectedXtream(query) {
        const base = `${selectedServer}/player_api.php?username=${encodeURIComponent(u)}&password=${encodeURIComponent(p)}`;
        const r = await smartFetch(`${base}&${query}`);
        if (!r.ok) return [];
        try { return await r.json(); } catch { return []; }
      }

      const [liveCats, vodCats, seriesCats] = await Promise.all([
        fetchSelectedXtream("action=get_live_categories"),
        fetchSelectedXtream("action=get_vod_categories"),
        fetchSelectedXtream("action=get_series_categories")
      ]);

      return Response.json({
        auth: true,
        server: selectedServer,
        serverCode: SERVER_POOLS[requestedServer.toUpperCase()] ? requestedServer.toUpperCase() : null,
        serverCandidates: selectedCandidates,
        userInfo: auth.user_info,
        serverInfo: auth.server_info,
        categories: {
          live: Array.isArray(liveCats) ? liveCats : [],
          movies: Array.isArray(vodCats) ? vodCats : [],
          series: Array.isArray(seriesCats) ? seriesCats : []
        }
      }, { headers: jsonHeaders });
    }

    // 2. BUSCAR CONTEÚDO DE UMA CATEGORIA
    if (b.action === "get_category_streams") {
      const catId = b.categoryId != null ? String(b.categoryId) : "";
      const type = b.type || "live";
      let actionName = "get_live_streams";
      if (type === "movies") actionName = "get_vod_streams";
      else if (type === "series") actionName = "get_series";

      const query = catId && catId !== "*" ? `action=${actionName}&category_id=${encodeURIComponent(catId)}` : `action=${actionName}`;
      const result = await fetchXtream(query);
      if (!result.ok) {
        return Response.json({ error: "Não foi possível carregar o conteúdo em nenhum dos servidores disponíveis." }, { status: 502, headers: jsonHeaders });
      }

      const items = result.data;
      const activeServer = result.server || serverCandidates[0];

      let formatted = [];
      if (Array.isArray(items)) {
        if (type === "live") {
          formatted = items.map(x => ({
            id: x.stream_id,
            name: x.name,
            categoryId: String(x.category_id ?? ""),
            logo: x.stream_icon || "",
            url: `${activeServer}/live/${encodeURIComponent(u)}/${encodeURIComponent(p)}/${x.stream_id}.m3u8`,
            urlTs: `${activeServer}/live/${encodeURIComponent(u)}/${encodeURIComponent(p)}/${x.stream_id}.ts`,
            epgId: x.epg_channel_id || "",
            type: "live"
          }));
        } else if (type === "movies") {
          formatted = items.map(x => ({
            id: x.stream_id,
            name: x.name,
            categoryId: String(x.category_id ?? ""),
            logo: x.stream_icon || "",
            rating: x.rating || x.rating_5based || "",
            year: x.year || "",
            url: `${activeServer}/movie/${encodeURIComponent(u)}/${encodeURIComponent(p)}/${x.stream_id}.${x.container_extension || "mp4"}`,
            containerExtension: x.container_extension || "mp4",
            type: "movies"
          }));
        } else if (type === "series") {
          formatted = items.map(x => ({
            id: x.series_id,
            seriesId: x.series_id,
            name: x.name,
            categoryId: String(x.category_id ?? ""),
            logo: x.cover || "",
            rating: x.rating || "",
            plot: x.plot || "",
            genre: x.genre || "",
            releaseDate: x.releaseDate || "",
            type: "series"
          }));
        }
      }

      return Response.json({ success: true, server: activeServer, serverCandidates: [activeServer, ...serverCandidates.filter(x => x !== activeServer)], items: formatted }, { headers: jsonHeaders });
    }

    // 3. DETALHES DE UMA SÉRIE
    if (b.action === "get_series_info") {
      const seriesId = b.seriesId;
      if (!seriesId) return Response.json({ error: "ID da série é obrigatório." }, { status: 400, headers: jsonHeaders });

      const result = await fetchXtream(`action=get_series_info&series_id=${encodeURIComponent(seriesId)}`);
      if (!result.ok) {
        return Response.json({ error: "Não foi possível carregar os detalhes da série em nenhum dos servidores disponíveis." }, { status: 502, headers: jsonHeaders });
      }

      const info = result.data || {};
      const activeServer = result.server || serverCandidates[0];
      const seasonsData = info.seasons || [];
      const episodesData = info.episodes || {};
      const formattedEpisodes = {};

      for (const [seasonNum, epList] of Object.entries(episodesData)) {
        if (Array.isArray(epList)) {
          formattedEpisodes[seasonNum] = epList.map(ep => ({
            id: ep.id,
            episodeNum: ep.episode_num,
            title: ep.title || `Episódio ${ep.episode_num}`,
            containerExtension: ep.container_extension || "mp4",
            info: ep.info || {},
            url: `${activeServer}/series/${encodeURIComponent(u)}/${encodeURIComponent(p)}/${ep.id}.${ep.container_extension || "mp4"}`
          }));
        }
      }

      return Response.json({
        success: true,
        server: activeServer,
        serverCandidates: [activeServer, ...serverCandidates.filter(x => x !== activeServer)],
        info: info.info || {},
        seasons: seasonsData,
        episodes: formattedEpisodes
      }, { headers: jsonHeaders });
    }

    // 4. M3U PLAYLIST PROXY
    if (b.action === "m3u") {
      const url = String(b.url || "").trim();
      if (!/^https?:\/\//i.test(url)) return Response.json({ error: "URL M3U inválida." }, { status: 400, headers: jsonHeaders });
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 25000);
        const r = await fetch(url, {
          signal: controller.signal,
          redirect: "follow",
          headers: {
            "user-agent": "IPTVSmartersPro/1.0.0",
            "accept": "*/*"
          }
        });
        clearTimeout(timeoutId);
        if (!r.ok) return Response.json({ error: `O servidor respondeu HTTP ${r.status} ao solicitar a playlist.` }, { status: 502, headers: jsonHeaders });
        const text = await r.text();
        return Response.json({ text }, { headers: jsonHeaders });
      } catch (fetchErr) {
        if (fetchErr.name === "AbortError") {
          return Response.json({ error: "Tempo esgotado ao baixar a lista M3U." }, { status: 504, headers: jsonHeaders });
        }
        throw fetchErr;
      }
    }

    return Response.json({ error: "Ação inválida." }, { status: 400, headers: jsonHeaders });
  } catch (e) {
    return Response.json({ error: "Falha de rede: " + (e?.message || "erro") }, { status: 502, headers: jsonHeaders });
  }
}

function ipToDomain(urlStr) {
  try {
    const u = new URL(urlStr);
    if (/^[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}$/.test(u.hostname)) {
      u.hostname = u.hostname + '.sslip.io';
      return u.href;
    }
  } catch {}
  return urlStr;
}

const redirectCache = new Map();
const CACHE_TTL_MS = 20 * 60 * 1000; // 20 minutos

export async function handleStreamProxy(request) {
  if (request.method === "OPTIONS") {
    return onRequestOptions();
  }

  const reqUrl = new URL(request.url);
  let target = reqUrl.searchParams.get("url");
  if (!target || !/^https?:\/\//i.test(target)) {
    return new Response("Parâmetro 'url' ausente ou inválido.", {
      status: 400,
      headers: {
        "content-type": "text/plain; charset=utf-8",
        "access-control-allow-origin": "*"
      }
    });
  }

  // Prevenir bloqueio de IP direto do Cloudflare Workers (Error 1003)
  target = ipToDomain(target);

  const upstreamHeaders = {
    "user-agent": "IPTVSmartersPro/1.0.0",
    "accept": "*/*",
  };

  const range = request.headers.get("range");
  if (range) {
    upstreamHeaders["range"] = range;
  }

  try {
    // Seguir redirecionamentos manualmente para converter destinos com IP direto em .sslip.io
    // Utiliza cache de redirecionamento para seeking instantâneo em filmes e séries
    let currentUrl = target;
    const cachedRedirect = redirectCache.get(target);
    if (cachedRedirect && (Date.now() - cachedRedirect.time < CACHE_TTL_MS)) {
      currentUrl = cachedRedirect.url;
    }

    let upstream = null;

    for (let hop = 0; hop < 6; hop++) {
      upstream = await fetch(currentUrl, {
        method: request.method === "HEAD" ? "HEAD" : "GET",
        headers: upstreamHeaders,
        redirect: "manual",
      });

      if (upstream.status >= 300 && upstream.status < 400 && upstream.headers.get("location")) {
        const loc = upstream.headers.get("location");
        const resolved = new URL(loc, currentUrl).href;
        currentUrl = ipToDomain(resolved);
        continue;
      }

      // Se falhar e estivesse usando cache expirado, recomeça do target original
      if ((upstream.status === 403 || upstream.status === 404 || upstream.status === 410) && currentUrl !== target) {
        redirectCache.delete(target);
        currentUrl = target;
        continue;
      }
      break;
    }

    if (currentUrl !== target) {
      redirectCache.set(target, { url: currentUrl, time: Date.now() });
      if (redirectCache.size > 500) {
        const firstKey = redirectCache.keys().next().value;
        redirectCache.delete(firstKey);
      }
    }

    if (!upstream) {
      return new Response("Falha ao obter resposta do servidor upstream.", {
        status: 502,
        headers: { "access-control-allow-origin": "*" }
      });
    }

    const contentType = (upstream.headers.get("content-type") || "").toLowerCase();
    const isM3u8 = currentUrl.toLowerCase().includes(".m3u8") || 
                   contentType.includes("mpegurl") || 
                   contentType.includes("application/x-mpegurl");

    if (isM3u8 && request.method !== "HEAD") {
      const text = await upstream.text();
      const baseUrl = currentUrl;
      const origin = reqUrl.origin;
      const proxyBase = `${origin}/api/stream?url=`;

      const lines = text.split(/\r?\n/);
      const rewrittenLines = lines.map(line => {
        const trimmed = line.trim();
        if (!trimmed) return line;

        // Diretivas com URI="..." (#EXT-X-KEY, #EXT-X-MAP, #EXT-X-MEDIA, etc.)
        if (trimmed.startsWith("#")) {
          return line.replace(/URI="([^"]+)"/g, (match, p1) => {
            try {
              const abs = ipToDomain(new URL(p1, baseUrl).href);
              return `URI="${proxyBase}${encodeURIComponent(abs)}"`;
            } catch {
              return match;
            }
          });
        }

        // Linha de segmento ou de playlist variante
        try {
          const abs = ipToDomain(new URL(trimmed, baseUrl).href);
          return `${proxyBase}${encodeURIComponent(abs)}`;
        } catch {
          return line;
        }
      });

      return new Response(rewrittenLines.join("\n"), {
        status: upstream.status,
        headers: {
          "content-type": "application/vnd.apple.mpegurl; charset=utf-8",
          "access-control-allow-origin": "*",
          "access-control-allow-methods": "GET, HEAD, OPTIONS",
          "access-control-allow-headers": "*",
          "cache-control": "no-cache, no-store",
        }
      });
    }

    // Fluxo binário (.ts, .mp4, .mkv, etc.)
    const respHeaders = new Headers();
    respHeaders.set("access-control-allow-origin", "*");
    respHeaders.set("access-control-allow-methods", "GET, HEAD, OPTIONS");
    respHeaders.set("access-control-allow-headers", "*");
    respHeaders.set("access-control-expose-headers", "Content-Range, Content-Length, Accept-Ranges");

    const passHeaders = [
      'content-type',
      'content-length',
      'content-range',
      'accept-ranges',
      'cache-control',
      'last-modified',
      'etag'
    ];
    for (const h of passHeaders) {
      const val = upstream.headers.get(h);
      if (val) respHeaders.set(h, val);
    }

    if (!respHeaders.has("content-type")) {
      if (/\.ts($|\?)/i.test(currentUrl)) {
        respHeaders.set("content-type", "video/mp2t");
      } else if (/\.mp4($|\?)/i.test(currentUrl)) {
        respHeaders.set("content-type", "video/mp4");
      } else {
        respHeaders.set("content-type", "application/octet-stream");
      }
    }

    return new Response(request.method === "HEAD" ? null : upstream.body, {
      status: upstream.status,
      headers: respHeaders
    });
  } catch (err) {
    return new Response(`Erro ao transmitir fluxo: ${err.message}`, {
      status: 502,
      headers: {
        "content-type": "text/plain; charset=utf-8",
        "access-control-allow-origin": "*"
      }
    });
  }
}

export async function onRequestGet(context) {
  return handleStreamProxy(context.request);
}

export async function onRequestHead(context) {
  return handleStreamProxy(context.request);
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // Stream proxy
    if (url.pathname === "/api/stream" || url.pathname === "/stream" || (url.pathname.startsWith("/api") && url.searchParams.has("url"))) {
      if (request.method === "OPTIONS") return onRequestOptions();
      return handleStreamProxy(request);
    }

    // Xtream Codes / M3U API
    if (url.pathname === "/api" || url.pathname.startsWith("/api/")) {
      if (request.method === "OPTIONS") return onRequestOptions();
      if (request.method === "POST") return onRequestPost({ request });
      if (request.method === "GET") return handleStreamProxy(request);
      return new Response("Method not allowed", { status: 405 });
    }

    if (env && env.ASSETS) {
      return env.ASSETS.fetch(request);
    }

    return new Response("Not found", { status: 404 });
  }
};
