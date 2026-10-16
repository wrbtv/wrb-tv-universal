async function proxyStreamRequest(req, rawTarget) {
  try {
    const requestUrl = new URL(req.url);
    const targetUrl = new URL(rawTarget);
    if (!["http:", "https:"].includes(targetUrl.protocol) || !targetUrl.hostname) {
      return new Response("URL de mídia inválida.", { status: 400 });
    }
    // This is a public streaming endpoint. Block obvious loopback, private and cloud-metadata targets.
    const host = targetUrl.hostname.toLowerCase().replace(/^\[|\]$/g, "");
    const ipv4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
    if (
      host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") ||
      host === "metadata.google.internal" ||
      host === "::1" || host === "::" || host.startsWith("fc") || host.startsWith("fd") ||
      host.startsWith("fe80:") ||
      (ipv4 && (
        Number(ipv4[1]) === 0 || Number(ipv4[1]) === 10 ||
        Number(ipv4[1]) === 127 || Number(ipv4[1]) >= 224 ||
        (Number(ipv4[1]) === 169 && Number(ipv4[2]) === 254) ||
        (Number(ipv4[1]) === 172 && Number(ipv4[2]) >= 16 && Number(ipv4[2]) <= 31) ||
        (Number(ipv4[1]) === 192 && Number(ipv4[2]) === 168)
      ))
    ) {
      return new Response("Destino de mídia não permitido.", { status: 400 });
    }
    if (targetUrl.origin === requestUrl.origin && targetUrl.pathname.startsWith("/api/stream")) {
      return new Response("Destino de proxy inválido.", { status: 400 });
    }

    const requestHeaders = new Headers({
      "user-agent": "VLC/3.0.18 LibVLC/3.0.18",
      "accept": "*/*"
    });
    const range = req.headers.get("range");
    if (range) requestHeaders.set("range", range);
    const ifRange = req.headers.get("if-range");
    if (ifRange) requestHeaders.set("if-range", ifRange);

    const upstream = await fetch(targetUrl.toString(), {
      method: req.method === "HEAD" ? "HEAD" : "GET",
      headers: requestHeaders,
      redirect: "follow"
    });

    const contentType = (upstream.headers.get("content-type") || "").toLowerCase();
    const isPlaylistUrl = /\.(m3u8?|m3u)(?:$|[?#])/i.test(targetUrl.toString());
    const isPlaylistType = contentType.includes("mpegurl") || contentType.includes("vnd.apple");
    const headers = new Headers({
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "GET, HEAD, OPTIONS",
      "access-control-allow-headers": "Range, If-Range",
      "access-control-expose-headers": "Accept-Ranges, Content-Range, Content-Length",
      "cache-control": "no-store"
    });
    for (const name of ["content-type", "accept-ranges", "content-range", "last-modified", "etag"]) {
      const value = upstream.headers.get(name);
      if (value) headers.set(name, value);
    }

    if (req.method !== "HEAD" && (isPlaylistUrl || isPlaylistType)) {
      const playlistBody = await upstream.text();
      if (playlistBody.trimStart().startsWith("#EXTM3U")) {
        const resolvedBase = upstream.url || targetUrl.toString();
        const wrapReference = (reference) => {
          try {
            const absolute = new URL(reference, resolvedBase);
            if (!["http:", "https:"].includes(absolute.protocol)) return reference;
            const proxied = new URL("/api/stream", requestUrl.origin);
            proxied.searchParams.set("url", absolute.toString());
            return proxied.toString();
          } catch (_) {
            return reference;
          }
        };
        const rewritten = playlistBody.split(/\r?\n/).map((line) => {
          const trimmed = line.trim();
          if (!trimmed) return line;
          if (trimmed.startsWith("#")) {
            return line.replace(/URI="([^"]+)"/g, (_, uri) => 'URI="' + wrapReference(uri) + '"');
          }
          const leading = line.match(/^\s*/)?.[0] || "";
          const trailing = line.match(/\s*$/)?.[0] || "";
          return leading + wrapReference(trimmed) + trailing;
        }).join("\n");
        headers.set("content-type", "application/vnd.apple.mpegurl; charset=utf-8");
        return new Response(rewritten, { status: upstream.status, headers });
      }
      headers.set("content-type", contentType || "application/octet-stream");
      return new Response(playlistBody, { status: upstream.status, headers });
    }

    return new Response(req.method === "HEAD" ? null : upstream.body, {
      status: upstream.status,
      headers
    });
  } catch (error) {
    return new Response("Falha ao buscar o fluxo de mídia: " + (error?.message || "erro"), {
      status: 502,
      headers: { "access-control-allow-origin": "*", "cache-control": "no-store" }
    });
  }
}

export default async (req) => {
  const requestUrl = new URL(req.url);
  if ((req.method === "GET" || req.method === "HEAD") && requestUrl.searchParams.has("url")) {
    return proxyStreamRequest(req, requestUrl.searchParams.get("url"));
  }
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "access-control-allow-origin": "*",
        "access-control-allow-methods": "GET, HEAD, POST, OPTIONS",
        "access-control-allow-headers": "Content-Type, Range, If-Range"
      }
    });
  }
  if (req.method !== "POST") {
    return Response.json({ error: "Método não permitido." }, { status: 405 });
  }

  let b;
  try {
    b = await req.json();
  } catch {
    return Response.json({ error: "JSON inválido." }, { status: 400 });
  }

  const jsonHeaders = {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "access-control-allow-origin": "*"
  };

  try {
    const serverPools = {
      "0022": ["http://rekgol.top", "http://aptxu.com"],
      "PFAST": ["http://wrb-tv.top", "http://p1fast.com"]
    };
    const rawServer = String(b.server || b.serverCode || "").trim();
    const serverCode = String(b.serverCode || rawServer).trim().toUpperCase();
    const normalizeServer = (value) => {
      let normalized = String(value || "").trim();
      if (!normalized) return "";
      if (!/^https?:\/\//i.test(normalized)) normalized = "http://" + normalized;
      return normalized.replace(/\/+$/, "");
    };
    const serverCandidates = [];
    const addServer = (value) => {
      const normalized = normalizeServer(value);
      if (/^https?:\/\//i.test(normalized) && !serverCandidates.includes(normalized)) {
        serverCandidates.push(normalized);
      }
    };
    if (serverPools[serverCode]) serverPools[serverCode].forEach(addServer);
    if (!serverPools[rawServer.toUpperCase()]) addServer(rawServer);
    if (Array.isArray(b.serverCandidates)) b.serverCandidates.forEach(addServer);
    let server = serverCandidates[0] || "";
    const u = String(b.user || "");
    const p = String(b.pass || "");
    const makeBase = (host) => `${host}/player_api.php?username=${encodeURIComponent(u)}&password=${encodeURIComponent(p)}`;
    let base = server ? makeBase(server) : "";

    async function fetchXtream(query) {
      if (!base) return [];
      const url = `${base}&${query}`;
      const r = await fetch(url, {
        redirect: "follow",
        headers: {
          "user-agent": "IPTVSmartersPro/1.0.0",
          "accept": "application/json"
        }
      });
      if (!r.ok) return [];
      try {
        return await r.json();
      } catch {
        return [];
      }
    }

    // 1. LOGIN & INICIALIZAÇÃO RÁPIDA (Retorna categorias instantaneamente)
    if (b.action === "login") {
      if (!serverCandidates.length || !u || !p) {
        return Response.json({ error: "Servidor, usuário e senha são obrigatórios." }, { status: 400 });
      }

      let authenticatedUser = null;
      let lastAuthError = "";
      let lastNetworkError = "";
      let hadReachableServer = false;
      for (const candidate of serverCandidates) {
        server = candidate;
        base = makeBase(server);
        try {
          const authR = await fetch(base, {
            redirect: "follow",
            headers: { "user-agent": "IPTVSmartersPro/1.0.0", "accept": "application/json" }
          });
          if (!authR.ok) {
            lastNetworkError = `Servidor respondeu HTTP ${authR.status} ao validar o acesso.`;
            continue;
          }
          hadReachableServer = true;
          const candidateAuth = await authR.json();
          if (Number(candidateAuth?.user_info?.auth) === 1) {
            authenticatedUser = candidateAuth;
            break;
          }
          lastAuthError = candidateAuth?.user_info?.message || "Usuário ou senha inválidos.";
        } catch (error) {
          lastNetworkError = error?.message || "Falha de conexão com o servidor.";
        }
      }

      if (!authenticatedUser) {
        if (hadReachableServer) {
          return Response.json({ auth: false, error: lastAuthError || "Usuário ou senha inválidos." }, { status: 401, headers: jsonHeaders });
        }
        return Response.json({ error: lastNetworkError || "Não foi possível acessar os servidores informados." }, { status: 502, headers: jsonHeaders });
      }

      const [liveCats, vodCats, seriesCats] = await Promise.all([
        fetchXtream("action=get_live_categories"),
        fetchXtream("action=get_vod_categories"),
        fetchXtream("action=get_series_categories")
      ]);

      return Response.json({
        auth: true,
        server,
        serverCode: serverPools[serverCode] ? serverCode : null,
        serverCandidates,
        userInfo: authenticatedUser.user_info,
        serverInfo: authenticatedUser.server_info,
        categories: {
          live: Array.isArray(liveCats) ? liveCats : [],
          movies: Array.isArray(vodCats) ? vodCats : [],
          series: Array.isArray(seriesCats) ? seriesCats : []
        }
      }, { headers: jsonHeaders });
    }

    // 2. BUSCAR ITENS DE UMA CATEGORIA ESPECÍFICA (Lazy Loading)
    if (b.action === "get_category_streams") {
      const catId = b.categoryId != null ? String(b.categoryId) : "";
      const type = b.type || "live";
      let actionName = "get_live_streams";
      if (type === "movies") actionName = "get_vod_streams";
      else if (type === "series") actionName = "get_series";

      const query = catId && catId !== "*" ? `action=${actionName}&category_id=${encodeURIComponent(catId)}` : `action=${actionName}`;
      const items = await fetchXtream(query);

      let formatted = [];
      if (Array.isArray(items)) {
        if (type === "live") {
          formatted = items.map(x => ({
            id: x.stream_id,
            name: x.name,
            categoryId: String(x.category_id ?? ""),
            logo: x.stream_icon || "",
            url: `${server}/live/${encodeURIComponent(u)}/${encodeURIComponent(p)}/${x.stream_id}.m3u8`,
            urlTs: `${server}/live/${encodeURIComponent(u)}/${encodeURIComponent(p)}/${x.stream_id}.ts`,
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
            url: `${server}/movie/${encodeURIComponent(u)}/${encodeURIComponent(p)}/${x.stream_id}.${x.container_extension || "mp4"}`,
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

      return Response.json({ success: true, items: formatted }, { headers: jsonHeaders });
    }

    // 3. DETALHES DE UMA SÉRIE (Temporadas e Episódios)
    if (b.action === "get_series_info") {
      const seriesId = b.seriesId;
      if (!seriesId) return Response.json({ error: "ID da série é obrigatório." }, { status: 400 });

      const info = await fetchXtream(`action=get_series_info&series_id=${encodeURIComponent(seriesId)}`);

      // Formatar temporadas e episódios com URLs diretas
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
            url: `${server}/series/${encodeURIComponent(u)}/${encodeURIComponent(p)}/${ep.id}.${ep.container_extension || "mp4"}`
          }));
        }
      }

      return Response.json({
        success: true,
        info: info.info || {},
        seasons: seasonsData,
        episodes: formattedEpisodes
      }, { headers: jsonHeaders });
    }

    // 4. M3U PLAYLIST PROXY
    if (b.action === "m3u") {
      const url = String(b.url || "").trim();
      if (!/^https?:\/\//i.test(url)) return Response.json({ error: "URL M3U inválida." }, { status: 400 });
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 20000); // 20s timeout max
        const r = await fetch(url, {
          signal: controller.signal,
          redirect: "follow",
          headers: {
            "user-agent": "IPTVSmartersPro/1.0.0",
            "accept": "*/*"
          }
        });
        clearTimeout(timeoutId);
        if (!r.ok) return Response.json({ error: `O servidor respondeu HTTP ${r.status} ao solicitar a playlist.` }, { status: 502 });
        const text = await r.text();
        return Response.json({ text }, { headers: jsonHeaders });
      } catch (fetchErr) {
        if (fetchErr.name === "AbortError") {
          return Response.json({ error: "Tempo esgotado ao baixar a lista M3U (servidor remoto muito lento ou offline)." }, { status: 504 });
        }
        throw fetchErr;
      }
    }

    // Compatibilidade com a versão anterior (xtream full dump)
    if (b.action === "xtream") {
      const [lc, vc, sc, live, vod, series] = await Promise.all([
        fetchXtream("action=get_live_categories"),
        fetchXtream("action=get_vod_categories"),
        fetchXtream("action=get_series_categories"),
        fetchXtream("action=get_live_streams"),
        fetchXtream("action=get_vod_streams"),
        fetchXtream("action=get_series")
      ]);
      const cm = a => Object.fromEntries((Array.isArray(a) ? a : []).map(x => [String(x.category_id), x.category_name]));
      const L = cm(lc), V = cm(vc), S = cm(sc);
      return Response.json({
        auth: true,
        live: (Array.isArray(live) ? live : []).map(x => ({ id: x.stream_id, name: x.name, group: L[String(x.category_id)] || "TV ao vivo", categoryId: String(x.category_id ?? ""), logo: x.stream_icon || "", url: `${server}/live/${encodeURIComponent(u)}/${encodeURIComponent(p)}/${x.stream_id}.m3u8`, type: "live" })),
        movies: (Array.isArray(vod) ? vod : []).map(x => ({ id: x.stream_id, name: x.name, group: V[String(x.category_id)] || "Filmes", categoryId: String(x.category_id ?? ""), logo: x.stream_icon || "", url: `${server}/movie/${encodeURIComponent(u)}/${encodeURIComponent(p)}/${x.stream_id}.${x.container_extension || "mp4"}`, type: "movies" })),
        series: (Array.isArray(series) ? series : []).map(x => ({ id: x.series_id, name: x.name, group: S[String(x.category_id)] || "Séries", categoryId: String(x.category_id ?? ""), logo: x.cover || "", url: null, type: "series", seriesId: x.series_id }))
      }, { headers: jsonHeaders });
    }

    return Response.json({ error: "Ação inválida." }, { status: 400 });
  } catch (e) {
    return Response.json({ error: "Falha de rede: " + (e?.message || "erro") }, { status: 502 });
  }
};