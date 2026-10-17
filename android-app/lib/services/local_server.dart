
import 'dart:convert';
import 'dart:io';
import 'package:flutter/services.dart';
import 'package:shared_preferences/shared_preferences.dart';

class LocalServerService {
  HttpServer? _server;
  String? _html;

  static const pools = <String, List<String>>{
    '0022': ['http://brokuxt.top', 'http://aptxu.com', 'http://genialplay.net', 'http://genialplay.eu'],
    'PFAST': ['http://wrb-tv.top', 'http://p1fast.com'],
  };

  static const _sessionBootstrapStart = '<!-- WRB-TV-NATIVE-SESSION-BOOTSTRAP-START -->';
  static const _sessionBootstrapEnd = '<!-- WRB-TV-NATIVE-SESSION-BOOTSTRAP-END -->';

  Future<String> start() async {
    if (_server != null) return 'http://127.0.0.1:' + _server!.port.toString();
    _html ??= await rootBundle.loadString('assets/index.html');
    final preferences = await SharedPreferences.getInstance();
    final savedLogin = preferences.getString('wrbtv_saved_login');
    if (savedLogin != null && !_html!.contains(_sessionBootstrapStart)) {
      try {
        final saved = jsonDecode(savedLogin);
        if (saved is Map && saved['server'] != null && saved['user'] != null && saved['pass'] != null) {
          // Escape angle brackets so a stored credential cannot terminate the injected script.
          final safeJson = jsonEncode(saved).replaceAll('<', r'\u003C');
          final bootstrap = '$_sessionBootstrapStart<script>'
              'window.__WRB_NATIVE_SAVED_SESSION = $safeJson;'
              'document.documentElement.classList.add("wrbtv-session-booting");'
              '</script>$_sessionBootstrapEnd';
          _html = _html!.replaceFirst('<head>', '<head>\n$bootstrap');
        }
      } catch (_) {
        // Ignore corrupt storage and show the regular login screen.
      }
    }
    _server = await HttpServer.bind(InternetAddress.loopbackIPv4, 0);
    _server!.listen(_handle);
    return 'http://127.0.0.1:' + _server!.port.toString();
  }

  void clearSessionBootstrap() {
    if (_html == null) return;
    final start = _html!.indexOf(_sessionBootstrapStart);
    if (start < 0) return;
    final end = _html!.indexOf(_sessionBootstrapEnd, start);
    if (end < 0) return;
    _html = _html!.replaceRange(start, end + _sessionBootstrapEnd.length, '');
  }

  Future<void> stop() async {
    final s = _server;
    _server = null;
    await s?.close(force: true);
  }

  Future<void> _handle(HttpRequest req) async {
    try {
      req.response.headers.set('Access-Control-Allow-Origin', '*');
      req.response.headers.set('Access-Control-Allow-Methods', 'GET, HEAD, POST, OPTIONS');
      req.response.headers.set('Access-Control-Allow-Headers', '*');
      req.response.headers.set('Access-Control-Expose-Headers', 'Content-Range, Content-Length, Accept-Ranges');

      if (req.method == 'OPTIONS') {
        req.response.statusCode = 204;
        await req.response.close();
        return;
      }

      if (req.method == 'POST' && req.uri.path == '/api') {
        final body = await utf8.decoder.bind(req).join();
        final payload = jsonDecode(body) as Map<String, dynamic>;
        final result = await _api(payload);
        req.response.statusCode = result.status;
        req.response.headers.contentType = ContentType.json;
        req.response.add(utf8.encode(jsonEncode(result.data)));
        await req.response.close();
        return;
      }

      if ((req.method == 'GET' || req.method == 'HEAD') &&
          (req.uri.path == '/api/stream' || req.uri.path == '/stream')) {
        await _stream(req);
        return;
      }

      if (req.method == 'GET' && (req.uri.path == '/' || req.uri.path == '/index.html')) {
        req.response.headers.contentType = ContentType.html;
        req.response.headers.set('Cache-Control', 'no-store');
        req.response.add(utf8.encode(_html!));
        await req.response.close();
        return;
      }

      req.response.statusCode = 404;
      req.response.write('Not Found');
      await req.response.close();
    } catch (e) {
      req.response.statusCode = 500;
      req.response.headers.contentType = ContentType.json;
      req.response.write(jsonEncode({'error': e.toString()}));
      await req.response.close();
    }
  }

  String normalize(String value) {
    var s = value.trim();
    if (s.isEmpty) return '';
    if (!RegExp(r'^https?://', caseSensitive: false).hasMatch(s)) s = 'http://' + s;
    return s.replaceFirst(RegExp(r'/+$'), '');
  }

  List<String> candidates(String server, dynamic provided) {
    final raw = server.trim();
    final key = raw.toUpperCase();
    if (pools.containsKey(key)) return List<String>.from(pools[key]!);
    final all = <String>[raw];
    if (provided is List) all.addAll(provided.map((e) => e.toString()));
    final out = <String>[];
    final seen = <String>{};
    for (final v in all) {
      final n = normalize(v);
      if (n.isNotEmpty && seen.add(n)) out.add(n);
    }
    return out;
  }

  HttpClient client() {
    final c = HttpClient();
    c.connectionTimeout = const Duration(seconds: 10);
    c.badCertificateCallback = (X509Certificate cert, String host, int port) => true;
    return c;
  }

  Future<_HttpResult?> get(Uri uri) async {
    const uas = [
      'IPTVSmartersPro/1.0.0',
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/122.0.0.0 Safari/537.36',
      'VLC/3.0.18 LibVLC/3.0.18'
    ];

    for (final ua in uas) {
      final c = client();
      try {
        final r = await c.getUrl(uri);
        r.followRedirects = true;
        r.maxRedirects = 6;
        r.headers.set(HttpHeaders.userAgentHeader, ua);
        r.headers.set(HttpHeaders.acceptHeader, 'application/json, text/plain, */*');
        r.headers.set(HttpHeaders.acceptLanguageHeader, 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7');
        final response = await r.close().timeout(const Duration(seconds: 20));
        final body = await utf8.decoder.bind(response).join();
        final result = _HttpResult(response.statusCode, body);
        c.close(force: true);
        if (result.status == 403) continue;
        return result;
      } catch (_) {
        c.close(force: true);
      }
    }
    return null;
  }

  Uri apiUri(String server, String user, String pass, Map<String, String> query) {
    return Uri.parse(server + '/player_api.php').replace(
      queryParameters: {'username': user, 'password': pass, ...query},
    );
  }

  Future<_ApiResult> _api(Map<String, dynamic> b) async {
    try {
      final action = (b['action'] ?? '').toString();
      final serverRaw = (b['server'] ?? '').toString();
      final user = (b['user'] ?? '').toString();
      final pass = (b['pass'] ?? '').toString();
      final cs = candidates(serverRaw, b['serverCandidates']);

      if (action != 'm3u' && (cs.isEmpty || user.isEmpty || pass.isEmpty)) {
        return _ApiResult(400, {'error': 'Servidor, usuário e senha são obrigatórios.'});
      }

      if (action == 'login') {
        String? selected;
        Map<String, dynamic>? auth;
        var lastError = 'Não foi possível conectar aos servidores configurados.';

        for (final c in cs) {
          final r = await get(apiUri(c, user, pass, {}));
          if (r == null) continue;
          if (r.status < 200 || r.status >= 300) {
            lastError = 'Servidor respondeu HTTP ' + r.status.toString() + ' ao validar o acesso.';
            continue;
          }
          try {
            final data = jsonDecode(r.body);
            final ui = data is Map ? data['user_info'] : null;
            if (ui is Map && (ui['auth'] == 1 || ui['auth'].toString() == '1')) {
              selected = c;
              auth = Map<String, dynamic>.from(data as Map);
              break;
            }
            lastError = ui is Map ? (ui['message']?.toString() ?? 'Usuário ou senha inválidos.') : 'Usuário ou senha inválidos.';
          } catch (_) {}
        }

        if (selected == null || auth == null) return _ApiResult(502, {'auth': false, 'error': lastError});

        dynamic listFor(String actionName) async {
          final r = await get(apiUri(selected!, user, pass, {'action': actionName}));
          if (r == null || r.status < 200 || r.status >= 300) return <dynamic>[];
          try {
            final d = jsonDecode(r.body);
            return d is List ? d : <dynamic>[];
          } catch (_) {
            return <dynamic>[];
          }
        }

        final values = await Future.wait<dynamic>([
          listFor('get_live_categories'),
          listFor('get_vod_categories'),
          listFor('get_series_categories'),
        ]);

        final serverCode = pools.containsKey(serverRaw.toUpperCase()) ? serverRaw.toUpperCase() : null;
        return _ApiResult(200, {
          'auth': true,
          'server': selected,
          'serverCode': serverCode,
          'serverCandidates': [selected, ...cs.where((x) => x != selected)],
          'userInfo': auth['user_info'] ?? {},
          'serverInfo': auth['server_info'] ?? {},
          'categories': {
            'live': values[0],
            'movies': values[1],
            'series': values[2],
          },
        });
      }

      if (action == 'get_category_streams') {
        final catId = (b['categoryId'] ?? '').toString();
        final type = (b['type'] ?? 'live').toString();
        final actionName = type == 'movies'
            ? 'get_vod_streams'
            : type == 'series'
                ? 'get_series'
                : 'get_live_streams';

        final query = <String, String>{'action': actionName};
        if (catId.isNotEmpty && catId != '*') query['category_id'] = catId;

        _HttpResult? response;
        String? active;
        for (final c in cs) {
          final r = await get(apiUri(c, user, pass, query));
          if (r != null && r.status >= 200 && r.status < 300) {
            response = r;
            active = c;
            break;
          }
        }

        if (response == null || active == null) {
          return _ApiResult(502, {'error': 'Não foi possível carregar o conteúdo em nenhum dos servidores disponíveis.'});
        }

        dynamic raw;
        try { raw = jsonDecode(response.body); } catch (_) { raw = []; }
        final formatted = <Map<String, dynamic>>[];

        if (raw is List) {
          for (final entry in raw) {
            if (entry is! Map) continue;
            final x = Map<String, dynamic>.from(entry);
            final id = x['stream_id'];
            if (type == 'live') {
              formatted.add({
                'id': id,
                'name': x['name'],
                'categoryId': (x['category_id'] ?? '').toString(),
                'logo': x['stream_icon'] ?? '',
                'url': active + '/live/' + Uri.encodeComponent(user) + '/' + Uri.encodeComponent(pass) + '/' + id.toString() + '.m3u8',
                'urlTs': active + '/live/' + Uri.encodeComponent(user) + '/' + Uri.encodeComponent(pass) + '/' + id.toString() + '.ts',
                'epgId': x['epg_channel_id'] ?? '',
                'type': 'live'
              });
            } else if (type == 'movies') {
              final ext = (x['container_extension'] ?? 'mp4').toString();
              formatted.add({
                'id': id,
                'name': x['name'],
                'categoryId': (x['category_id'] ?? '').toString(),
                'logo': x['stream_icon'] ?? '',
                'rating': x['rating'] ?? x['rating_5based'] ?? '',
                'year': x['year'] ?? '',
                'url': active + '/movie/' + Uri.encodeComponent(user) + '/' + Uri.encodeComponent(pass) + '/' + id.toString() + '.' + ext,
                'containerExtension': ext,
                'type': 'movies'
              });
            } else {
              formatted.add({
                'id': x['series_id'],
                'seriesId': x['series_id'],
                'name': x['name'],
                'categoryId': (x['category_id'] ?? '').toString(),
                'logo': x['cover'] ?? '',
                'rating': x['rating'] ?? '',
                'plot': x['plot'] ?? '',
                'genre': x['genre'] ?? '',
                'releaseDate': x['releaseDate'] ?? '',
                'type': 'series'
              });
            }
          }
        }

        return _ApiResult(200, {
          'success': true,
          'server': active,
          'serverCandidates': [active, ...cs.where((x) => x != active)],
          'items': formatted
        });
      }

      if (action == 'get_series_info') {
        final seriesId = (b['seriesId'] ?? '').toString();
        if (seriesId.isEmpty) return _ApiResult(400, {'error': 'ID da série é obrigatório.'});

        _HttpResult? response;
        String? active;
        for (final c in cs) {
          final r = await get(apiUri(c, user, pass, {
            'action': 'get_series_info',
            'series_id': seriesId
          }));
          if (r != null && r.status >= 200 && r.status < 300) {
            response = r;
            active = c;
            break;
          }
        }

        if (response == null || active == null) {
          return _ApiResult(502, {'error': 'Não foi possível carregar os detalhes da série em nenhum dos servidores disponíveis.'});
        }

        Map<String, dynamic> raw = {};
        try {
          final decoded = jsonDecode(response.body);
          if (decoded is Map) raw = Map<String, dynamic>.from(decoded);
        } catch (_) {}

        final episodes = <String, dynamic>{};
        final epsData = raw['episodes'];
        if (epsData is Map) {
          for (final e in epsData.entries) {
            final season = e.key.toString();
            final list = e.value;
            if (list is List) {
              episodes[season] = list.whereType<Map>().map((ep0) {
                final ep = Map<String, dynamic>.from(ep0);
                final id = ep['id'];
                final ext = (ep['container_extension'] ?? 'mp4').toString();
                return {
                  'id': id,
                  'episodeNum': ep['episode_num'],
                  'title': ep['title'] ?? 'Episódio ' + ep['episode_num'].toString(),
                  'containerExtension': ext,
                  'info': ep['info'] is Map ? ep['info'] : {},
                  'url': active! + '/series/' + Uri.encodeComponent(user) + '/' + Uri.encodeComponent(pass) + '/' + id.toString() + '.' + ext
                };
              }).toList();
            }
          }
        }

        return _ApiResult(200, {
          'success': true,
          'server': active,
          'serverCandidates': [active, ...cs.where((x) => x != active)],
          'info': raw['info'] ?? {},
          'seasons': raw['seasons'] ?? [],
          'episodes': episodes
        });
      }

      if (action == 'm3u') {
        final url = (b['url'] ?? '').toString().trim();
        if (!RegExp(r'^https?://', caseSensitive: false).hasMatch(url)) {
          return _ApiResult(400, {'error': 'URL M3U inválida.'});
        }
        final r = await get(Uri.parse(url));
        if (r == null) return _ApiResult(504, {'error': 'Tempo esgotado ao baixar a lista M3U.'});
        if (r.status < 200 || r.status >= 300) {
          return _ApiResult(502, {'error': 'O servidor respondeu HTTP ' + r.status.toString() + ' ao solicitar a playlist.'});
        }
        return _ApiResult(200, {'text': r.body});
      }

      return _ApiResult(400, {'error': 'Ação inválida.'});
    } catch (e) {
      return _ApiResult(502, {'error': 'Falha de rede: ' + e.toString()});
    }
  }

  Uri sslip(Uri u) {
    if (RegExp(r'^\d{1,3}(\.\d{1,3}){3}$').hasMatch(u.host)) {
      return u.replace(host: u.host + '.sslip.io');
    }
    return u;
  }

  Future<void> _stream(HttpRequest req) async {
    final raw = req.uri.queryParameters['url'];
    if (raw == null || !RegExp(r'^https?://', caseSensitive: false).hasMatch(raw)) {
      req.response.statusCode = 400;
      req.response.write('Parâmetro url inválido.');
      await req.response.close();
      return;
    }

    final client = this.client();
    try {
      Uri current = sslip(Uri.parse(raw));
      HttpClientResponse? upstream;
      final range = req.headers.value(HttpHeaders.rangeHeader);

      for (var hop = 0; hop < 6; hop++) {
        final upReq = await client.openUrl(req.method, current);
        upReq.followRedirects = false;
        upReq.headers.set(HttpHeaders.userAgentHeader, 'IPTVSmartersPro/1.0.0');
        upReq.headers.set(HttpHeaders.acceptHeader, '*/*');
        if (range != null) upReq.headers.set(HttpHeaders.rangeHeader, range);
        upstream = await upReq.close().timeout(const Duration(seconds: 25));

        final location = upstream.headers.value(HttpHeaders.locationHeader);
        if (upstream.statusCode >= 300 && upstream.statusCode < 400 && location != null) {
          current = sslip(current.resolve(location));
          await upstream.drain();
          continue;
        }
        break;
      }

      if (upstream == null) throw Exception('Falha ao obter resposta do servidor.');

      final ct = (upstream.headers.contentType?.toString() ?? '').toLowerCase();
      final isM3u8 = current.path.toLowerCase().contains('.m3u8') || ct.contains('mpegurl');

      if (isM3u8 && req.method != 'HEAD') {
        final playlist = await utf8.decoder.bind(upstream).join();
        final base = current;
        final proxyBase = 'http://127.0.0.1:' + _server!.port.toString() + '/api/stream?url=';
        final rewritten = playlist.split(RegExp(r'\r?\n')).map((line) {
          final t = line.trim();
          if (t.isEmpty) return line;
          if (t.startsWith('#')) {
            return line.replaceAllMapped(RegExp(r'URI="([^"]+)"'), (m) {
              try {
                final abs = sslip(base.resolve(m.group(1)!));
                return 'URI="' + proxyBase + Uri.encodeComponent(abs.toString()) + '"';
              } catch (_) {
                return m.group(0)!;
              }
            });
          }
          try {
            final abs = sslip(base.resolve(t));
            return proxyBase + Uri.encodeComponent(abs.toString());
          } catch (_) {
            return line;
          }
        }).join('\n');

        req.response.statusCode = upstream.statusCode;
        req.response.headers.contentType = ContentType('application', 'vnd.apple.mpegurl', charset: 'utf-8');
        req.response.headers.set('Cache-Control', 'no-cache, no-store');
        req.response.add(utf8.encode(rewritten));
        await req.response.close();
        return;
      }

      req.response.statusCode = upstream.statusCode;
      for (final name in [
        HttpHeaders.contentTypeHeader,
        HttpHeaders.contentLengthHeader,
        HttpHeaders.contentRangeHeader,
        HttpHeaders.acceptRangesHeader,
        HttpHeaders.cacheControlHeader,
        HttpHeaders.lastModifiedHeader,
        HttpHeaders.etagHeader
      ]) {
        final value = upstream.headers.value(name);
        if (value != null) req.response.headers.set(name, value);
      }

      if (req.response.headers.contentType == null) {
        if (current.path.toLowerCase().endsWith('.ts')) {
          req.response.headers.contentType = ContentType('video', 'mp2t');
        } else if (current.path.toLowerCase().endsWith('.mp4')) {
          req.response.headers.contentType = ContentType('video', 'mp4');
        }
      }

      if (req.method == 'HEAD') {
        await req.response.close();
      } else {
        await upstream.pipe(req.response);
      }
    } catch (e) {
      req.response.statusCode = 502;
      req.response.headers.contentType = ContentType.text;
      req.response.write('Erro ao transmitir fluxo: ' + e.toString());
      await req.response.close();
    } finally {
      client.close(force: true);
    }
  }
}

class _HttpResult {
  final int status;
  final String body;
  _HttpResult(this.status, this.body);
}

class _ApiResult {
  final int status;
  final dynamic data;
  _ApiResult(this.status, this.data);
}
