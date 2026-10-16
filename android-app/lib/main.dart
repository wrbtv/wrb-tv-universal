import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';
import 'package:webview_flutter/webview_flutter.dart';

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
  bool _updateDialogVisible = false;
  bool _deviceProfileApplied = false;

  @override
  void initState() {
    super.initState();
    _controller = WebViewController()
      ..setJavaScriptMode(JavaScriptMode.unrestricted)
      ..setBackgroundColor(Colors.black)
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
      )
      ..loadRequest(Uri.parse(widget.initialUrl));

    if (Platform.isAndroid) {
      // Check after startup and repeat every six hours while the app is running.
      Future<void>.delayed(const Duration(seconds: 12), _checkForUpdates);
      _updateTimer = Timer.periodic(
        const Duration(hours: 6),
        (_) => _checkForUpdates(),
      );
    }
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
      if (preferences.getString('wrbtv_update_dismissed_tag') == releaseKey) return;
      await _showUpdateDialog(
        latestVersion: latestVersion,
        releaseTag: releaseKey,
        apkUrl: uri.toString(),
        preferences: preferences,
      );
    } catch (_) {
      // Retry after temporary network errors during the next scheduled check.
    } finally {
      _checkingForUpdate = false;
    }
  }

  Future<void> _showUpdateDialog({
    required String latestVersion,
    required String releaseTag,
    required String apkUrl,
    required SharedPreferences preferences,
  }) async {
    if (!mounted || _updateDialogVisible) return;
    _updateDialogVisible = true;
    try {
      await showDialog<void>(
        context: context,
        barrierDismissible: false,
        builder: (dialogContext) => AlertDialog(
          backgroundColor: const Color(0xFF101924),
          title: const Text(
            'Atualização WRB-TV disponível',
            style: TextStyle(color: Colors.white, fontWeight: FontWeight.w800),
          ),
          content: Text(
            'A versão $latestVersion está disponível. Atualize para receber as correções e melhorias mais recentes.',
            style: const TextStyle(color: Color(0xFFD0DAE4)),
          ),
          actions: [
            TextButton(
              onPressed: () async {
                await preferences.setString('wrbtv_update_dismissed_tag', releaseTag);
                if (dialogContext.mounted) Navigator.of(dialogContext).pop();
              },
              child: const Text('MAIS TARDE'),
            ),
            FilledButton(
              autofocus: true,
              onPressed: () {
                Navigator.of(dialogContext).pop();
                unawaited(_installUpdate(apkUrl));
              },
              child: const Text('ATUALIZAR AGORA'),
            ),
          ],
        ),
      );
    } finally {
      _updateDialogVisible = false;
    }
  }

  Future<void> _installUpdate(String apkUrl) async {
    try {
      final result = await _updaterChannel.invokeMapMethod<String, dynamic>(
        'installUpdate',
        {'url': apkUrl},
      );
      if (!mounted || result?['status'] != 'permission_required') return;
      await showDialog<void>(
        context: context,
        builder: (dialogContext) => AlertDialog(
          backgroundColor: const Color(0xFF101924),
          title: const Text('Autorizar atualização'),
          content: const Text(
            'Ative a permissão para o WRB-TV instalar atualizações nesta tela de configurações do Android. Ao voltar ao aplicativo, o download e a abertura do instalador continuarão automaticamente.',
          ),
          actions: [
            FilledButton(
              autofocus: true,
              onPressed: () => Navigator.of(dialogContext).pop(),
              child: const Text('ENTENDI'),
            ),
          ],
        ),
      );
    } on PlatformException catch (error) {
      if (!mounted) return;
      await showDialog<void>(
        context: context,
        builder: (dialogContext) => AlertDialog(
          backgroundColor: const Color(0xFF101924),
          title: const Text('Não foi possível iniciar a atualização'),
          content: Text(error.message ?? 'Verifique a conexão e tente novamente.'),
          actions: [
            FilledButton(
              autofocus: true,
              onPressed: () => Navigator.of(dialogContext).pop(),
              child: const Text('FECHAR'),
            ),
          ],
        ),
      );
    } catch (_) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Não foi possível abrir o instalador do Android.')),
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
