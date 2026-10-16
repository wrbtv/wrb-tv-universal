# WRB-TV Android

**Public stable APK download for Downloader:**  
https://github.com/wrbtv/wrb-tv-universal/releases/download/android-stable/WRB-PLAY-ANDROID.apk

This folder and its build workflow are isolated from the Windows, macOS, Linux and web release files. The Android app checks the public Android-only stable release at startup and periodically while running. It downloads a new APK and opens Android's package installer when a newer version is available; Android/Fire OS can require the user to authorize installs and confirm each update.

Increment the version in `pubspec.yaml` with each new Android release. The workflow compiles, publishes a versioned release, and replaces the APK at the stable Downloader URL. It also preserves the signing-key cache and blocks updates if that key disappears.
