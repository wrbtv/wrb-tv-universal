import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';
import 'package:webview_flutter/webview_flutter.dart';
import 'package:webview_flutter_android/webview_flutter_android.dart';

import 'services/local_server.dart';

const _updaterChannel = MethodChannel('com.wrbtv.player.iptv_mobile/updater');
const _releaseApiUrl =
    'https://api.github.com/repos/wrbtv/wrb-tv-universal/releases/tags/android-stable';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  await SystemChrome.setPreferredOrientations(const [
    DeviceOrientation.portraitUp,
    DeviceOrientation.portraitDown,
    DeviceOrientation.landscapeLeft,
    DeviceOrientation.landscapeRight,
  ]);
  final localServer = LocalServerService();
  final initialUrl = await localServer.start();
  runApp(WRBTVApp(server: localServer, initialUrl: initialUrl));
}

class WRBTVApp extends StatefulWidget {
  final LocalServerService server;
  final String initialUrl;

  const WRBTVApp({super.key, required this.server, required this.initialUrl});

  @override
  State<WRBTVApp> createState() => _WRBTVAppState();
}

class _WRBTVAppState extends State<WRBTVApp> {
  late final WebViewController _controller;
  Timer? _updateTimer;
  bool _checkingForUpdate = false;
  bool _deviceProfileApplied = false;

  @override
  void initState() {
    super.initState();
    _controller = WebViewController()
      ..setJavaScriptMode(JavaScriptMode.unrestricted)
      ..setBackgroundColor(Colors.black)
      ..addJavaScriptChannel(
        'AndroidSession',
        onMessageReceived: (message) {
          unawaited(_handleSessionBridgeMessage(message.message));
        },
      )
      ..addJavaScriptChannel(
        'AndroidOrientation',
        onMessageReceived: (message) async {
          switch (message.message.toLowerCase().trim()) {
            case 'landscape':
              await SystemChrome.setPreferredOrientations(const [
                DeviceOrientation.landscapeLeft,
                DeviceOrientation.landscapeRight,
              ]);
              break;
            case 'immersive':
              await SystemChrome.setEnabledSystemUIMode(SystemUiMode.immersiveSticky);
              break;
            case 'edge':
              await SystemChrome.setEnabledSystemUIMode(SystemUiMode.edgeToEdge);
              break;
            case 'portrait':
              await SystemChrome.setPreferredOrientations(const [
                DeviceOrientation.portraitUp,
                DeviceOrientation.portraitDown,
              ]);
              break;
          }
        },
      )
      ..setNavigationDelegate(
        NavigationDelegate(
          onNavigationRequest: (_) => NavigationDecision.navigate,
          onPageFinished: (_) { _applyDeviceProfile(); },
        ),
      );

    unawaited(_configureMediaPlaybackAndLoad());

    if (Platform.isAndroid) {
      // Check after startup and repeat every six hours while the app is running.
      Future<void>.delayed(const Duration(seconds: 12), _checkForUpdates);
      _updateTimer = Timer.periodic(
        const Duration(hours: 6),
        (_) => _checkForUpdates(),
      );
    }
  }

  Future<void> _configureMediaPlaybackAndLoad() async {
    // The embedded IPTV player uses HLS/MPEG-TS, whose playback request often
    // happens after asynchronous manifest loading. Android WebView otherwise
    // blocks that request behind a second Play tap.
    if (Platform.isAndroid && _controller.platform is AndroidWebViewController) {
      await (_controller.platform as AndroidWebViewController)
          .setMediaPlaybackRequiresUserGesture(false);
    }
    await _controller.loadRequest(Uri.parse(widget.initialUrl));
  }

  Future<void> _applyDeviceProfile() async {
    if (!Platform.isAndroid || _deviceProfileApplied) return;
    try {
      final info = await _updaterChannel.invokeMapMethod<String, dynamic>('getAppInfo');
      if (!mounted) return;
      final isTv = info?['isTv'] == true;
      await _controller.runJavaScript('''
        (() => {
          const isTv = ${isTv ? 'true' : 'false'};
          document.documentElement.classList.toggle('wrbtv-tv-device', isTv);
          if (document.body) {
            document.body.classList.toggle('wrbtv-tv-device', isTv);
            document.body.dataset.wrbtvFormFactor = isTv ? 'tv' : 'touch';
          }
        })();
      ''');
      _deviceProfileApplied = true;
    } catch (_) {
      // The app remains usable if hardware-profile detection is unavailable.
    }
  }

  int _compareVersions(String left, String right) {
    final a = left.split('.').map((v) => int.tryParse(v) ?? 0).toList();
    final b = right.split('.').map((v) => int.tryParse(v) ?? 0).toList();
    for (var i = 0; i < 3; i++) {
      final av = i < a.length ? a[i] : 0;
      final bv = i < b.length ? b[i] : 0;
      if (av != bv) return av.compareTo(bv);
    }
    return 0;
  }

  Future<void> _checkForUpdates() async {
    if (!Platform.isAndroid || !mounted || _checkingForUpdate) return;
    _checkingForUpdate = true;
    try {
      final appInfo = await _updaterChannel.invokeMapMethod<String, dynamic>('getAppInfo');
      final installedVersion = appInfo?['versionName']?.toString();
      if (installedVersion == null || installedVersion.isEmpty) return;

      final response = await http.get(
        Uri.parse(_releaseApiUrl),
        headers: const {
          'Accept': 'application/vnd.github+json',
          'User-Agent': 'WRB-TV-Android-Updater',
        },
      ).timeout(const Duration(seconds: 20));
      if (response.statusCode != 200) return;

      final dynamic decoded = jsonDecode(response.body);
      if (decoded is! Map<String, dynamic> || decoded['tag_name'] != 'android-stable') return;
      final body = decoded['body']?.toString() ?? '';
      final match = RegExp(r'(?m)^Version:\s*(\d+\.\d+\.\d+)\s*$').firstMatch(body);
      if (match == null) return;
      final latestVersion = match.group(1)!;
      if (_compareVersions(latestVersion, installedVersion) <= 0) return;

      String? apkUrl;
      final assets = decoded['assets'];
      if (assets is List) {
        for (final dynamic asset in assets) {
          if (asset is Map &&
              asset['name'] == 'WRB-PLAY-ANDROID.apk' &&
              asset['browser_download_url'] is String) {
            apkUrl = asset['browser_download_url'] as String;
            break;
          }
        }
      }
      final uri = apkUrl == null ? null : Uri.tryParse(apkUrl);
      if (uri == null || uri.scheme != 'https' || uri.host != 'github.com' ||
          !uri.path.contains('/releases/download/android-stable/') ||
          !uri.path.toLowerCase().endsWith('.apk')) return;

      final preferences = await SharedPreferences.getInstance();
      final releaseKey = 'android-v$latestVersion';
      final lastAttemptKey = 'wrbtv_auto_update_last_attempt_$releaseKey';
      final lastAttemptAt = preferences.getInt(lastAttemptKey) ?? 0;
      final cooldownMs = const Duration(hours: 24).inMilliseconds;
      if (DateTime.now().millisecondsSinceEpoch - lastAttemptAt < cooldownMs) return;

      // Automatically download and open Android's package installer.
      // Stock Android/Fire OS still requires the user to confirm installation.
      await _installUpdate(
        uri.toString(),
        releaseKey: releaseKey,
        preferences: preferences,
      );
    } catch (_) {
      // Retry after temporary network errors during the next scheduled check.
    } finally {
      _checkingForUpdate = false;
    }
  }

  Future<void> _installUpdate(
    String apkUrl, {
    required String releaseKey,
    required SharedPreferences preferences,
  }) async {
    try {
      final result = await _updaterChannel.invokeMapMethod<String, dynamic>(
        'installUpdate',
        {'url': apkUrl},
      );
      if (!mounted) return;
      final status = result?['status']?.toString();
      if (status == 'permission_required' || status == 'installer_launched') {
        await preferences.setInt(
          'wrbtv_auto_update_last_attempt_$releaseKey',
          DateTime.now().millisecondsSinceEpoch,
        );
        // Native Android opens Settings or the system package installer.
        // Do not add another in-app confirmation in front of it.
        return;
      }
    } on PlatformException catch (error) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(
            error.message ?? 'Não foi possível atualizar agora. Tentaremos novamente.',
          ),
        ),
      );
    } catch (_) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('Não foi possível iniciar a atualização. Tentaremos novamente.'),
        ),
      );
    }
  }

  Future<bool> _handleSystemBack() async {
    if (!Platform.isAndroid) return true;
    try {
      final handled = await _controller.runJavaScriptReturningResult(
        'window.__wrbHandleSystemBack ? window.__wrbHandleSystemBack() : false',
      );
      if (handled == true || handled.toString() == 'true') return false;
    } catch (_) {
      // Let the OS handle Back while the WebView is not ready.
    }
    return true;
  }

  Future<void> _handleSessionBridgeMessage(String rawMessage) async {
    try {
      final decoded = jsonDecode(rawMessage);
      if (decoded is! Map<String, dynamic>) return;
      final action = decoded['action']?.toString();
      final preferences = await SharedPreferences.getInstance();
      if (action == 'save') {
        final session = decoded['session'];
        if (session is! Map) return;
        final server = session['server']?.toString() ?? '';
        final user = session['user']?.toString() ?? '';
        final pass = session['pass']?.toString() ?? '';
        if (server.isEmpty || user.isEmpty || pass.isEmpty) return;
        await preferences.setString('wrbtv_saved_login', jsonEncode({
          'server': server,
          'serverCode': session['serverCode'],
          'serverCandidates': session['serverCandidates'] is List
              ? session['serverCandidates']
              : <String>[],
          'user': user,
          'pass': pass,
        }));
      } else if (action == 'clear') {
        await preferences.remove('wrbtv_saved_login');
        widget.server.clearSessionBootstrap();
      }
    } catch (error) {
      debugPrint('[WRB-TV] Session storage bridge error: $error');
    }
  }

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'WRB-TV',
      debugShowCheckedModeBanner: false,
      theme: ThemeData.dark(useMaterial3: true),
      home: WillPopScope(
        onWillPop: _handleSystemBack,
        child: Scaffold(
          backgroundColor: Colors.black,
          body: WebViewWidget(controller: _controller),
        ),
      ),
    );
  }

  @override
  void dispose() {
    _updateTimer?.cancel();
    widget.server.stop();
    super.dispose();
  }
}
