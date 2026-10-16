package com.wrbtv.player.iptv_mobile

import android.app.UiModeManager
import android.content.Intent
import android.content.pm.PackageManager
import android.content.res.Configuration
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import androidx.core.content.FileProvider
import io.flutter.embedding.android.FlutterActivity
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.plugin.common.MethodChannel
import java.io.File
import java.io.FileOutputStream
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.Executors

class MainActivity : FlutterActivity() {
    private val channelName = "com.wrbtv.player.iptv_mobile/updater"
    private val mainHandler = Handler(Looper.getMainLooper())
    private val updateExecutor = Executors.newSingleThreadExecutor()
    private var pendingInstallUrl: String? = null
    @Volatile private var downloadInProgress = false

    override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
        super.configureFlutterEngine(flutterEngine)
        MethodChannel(flutterEngine.dartExecutor.binaryMessenger, channelName)
            .setMethodCallHandler { call, result ->
                when (call.method) {
                    "getAppInfo" -> {
                        val packageInfo = packageManager.getPackageInfo(packageName, 0)
                        val uiMode = getSystemService(UI_MODE_SERVICE) as? UiModeManager
                        val isTv = packageManager.hasSystemFeature(PackageManager.FEATURE_LEANBACK) ||
                            uiMode?.currentModeType == Configuration.UI_MODE_TYPE_TELEVISION
                        val versionCode = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                            packageInfo.longVersionCode
                        } else {
                            @Suppress("DEPRECATION")
                            packageInfo.versionCode.toLong()
                        }
                        result.success(mapOf(
                            "versionName" to (packageInfo.versionName ?: "0.0.0"),
                            "versionCode" to versionCode,
                            "isTv" to isTv,
                        ))
                    }
                    "installUpdate" -> {
                        val updateUrl = call.argument<String>("url")
                        if (updateUrl.isNullOrBlank() || !isTrustedApkUrl(updateUrl)) {
                            result.error("INVALID_UPDATE_URL", "URL de atualização inválida.", null)
                            return@setMethodCallHandler
                        }
                        pendingInstallUrl = updateUrl
                        if (!canInstallPackages()) {
                            try {
                                startActivity(Intent(
                                    Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                                    Uri.parse("package:$packageName"),
                                ))
                                result.success(mapOf("status" to "permission_required"))
                            } catch (error: Exception) {
                                pendingInstallUrl = null
                                result.error(
                                    "INSTALL_PERMISSION_SETTINGS_FAILED",
                                    error.message ?: "Não foi possível abrir as configurações de instalação.",
                                    null,
                                )
                            }
                        } else {
                            pendingInstallUrl = null
                            startDownloadAndInstall(updateUrl, result)
                        }
                    }
                    else -> result.notImplemented()
                }
            }
    }

    override fun onResume() {
        super.onResume()
        val updateUrl = pendingInstallUrl
        if (updateUrl != null && canInstallPackages() && !downloadInProgress) {
            pendingInstallUrl = null
            startDownloadAndInstall(updateUrl, null)
        }
    }

    private fun canInstallPackages(): Boolean =
        Build.VERSION.SDK_INT < Build.VERSION_CODES.O || packageManager.canRequestPackageInstalls()

    private fun isTrustedApkUrl(value: String): Boolean = try {
        val uri = Uri.parse(value)
        uri.scheme == "https" &&
            uri.host == "github.com" &&
            uri.path.orEmpty().contains("/releases/download/") &&
            uri.path.orEmpty().lowercase().endsWith(".apk")
    } catch (_: Exception) {
        false
    }

    private fun startDownloadAndInstall(updateUrl: String, result: MethodChannel.Result?) {
        if (downloadInProgress) {
            result?.error("UPDATE_ALREADY_RUNNING", "Uma atualização já está em andamento.", null)
            return
        }
        downloadInProgress = true
        updateExecutor.execute {
            var downloadedFile: File? = null
            var errorMessage: String? = null
            try {
                val connection = URL(updateUrl).openConnection() as HttpURLConnection
                connection.instanceFollowRedirects = true
                connection.connectTimeout = 20_000
                connection.readTimeout = 120_000
                connection.setRequestProperty("User-Agent", "WRB-TV-Android-Updater")
                connection.setRequestProperty("Accept", "application/vnd.android.package-archive")
                val status = connection.responseCode
                if (status !in 200..299) {
                    connection.disconnect()
                    throw IOException("O servidor respondeu HTTP $status.")
                }
                val updateDirectory = File(cacheDir, "updates")
                if (!updateDirectory.exists() && !updateDirectory.mkdirs()) {
                    connection.disconnect()
                    throw IOException("Não foi possível preparar a pasta de atualização.")
                }
                val apkFile = File(updateDirectory, "WRB-PLAY-ANDROID.apk")
                connection.inputStream.use { input ->
                    FileOutputStream(apkFile).use { output ->
                        val buffer = ByteArray(64 * 1024)
                        while (true) {
                            val count = input.read(buffer)
                            if (count < 0) break
                            output.write(buffer, 0, count)
                        }
                        output.fd.sync()
                    }
                }
                connection.disconnect()
                if (!apkFile.exists() || apkFile.length() < 1_000_000L) {
                    apkFile.delete()
                    throw IOException("O arquivo APK baixado está incompleto.")
                }
                downloadedFile = apkFile
            } catch (error: Exception) {
                errorMessage = error.message ?: "Falha ao baixar a atualização."
            }

            mainHandler.post {
                downloadInProgress = false
                if (errorMessage != null) {
                    downloadedFile?.delete()
                    result?.error("UPDATE_DOWNLOAD_FAILED", errorMessage, null)
                    return@post
                }
                try {
                    val apkFile = downloadedFile
                        ?: throw IOException("O APK não foi encontrado após o download.")
                    val apkUri = FileProvider.getUriForFile(this, "$packageName.fileprovider", apkFile)
                    val installIntent = Intent(Intent.ACTION_VIEW).apply {
                        setDataAndType(apkUri, "application/vnd.android.package-archive")
                        addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                        addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                    }
                    startActivity(installIntent)
                    result?.success(mapOf("status" to "installer_launched"))
                } catch (error: Exception) {
                    result?.error(
                        "APK_INSTALLER_FAILED",
                        error.message ?: "Não foi possível abrir o instalador do Android.",
                        null,
                    )
                }
            }
        }
    }

    override fun onDestroy() {
        updateExecutor.shutdownNow()
        super.onDestroy()
    }
}
