# CI build image of the gates (.gitea/workflows/gates.yml): everything the jobs used to download on every run.
# Built by the gates' `image` job with kaniko (job containers have no Docker) and pushed to the Gitea container
# registry as catexam/catexam-ci:<hash of this file, package-lock.json and the Gradle wrapper properties>.
# Build context: the repository root.
FROM node:22-bookworm
# Links the package to this repository in Gitea, so the jobs' own token (GITEA_TOKEN) may push and pull it.
LABEL org.opencontainers.image.source="https://factory-core.taildc5540.ts.net:8443/catexam/catexam"

# Caches at fixed paths, so they are found whatever HOME the runner gives the job.
ENV npm_config_cache=/root/.npm \
    electron_config_cache=/root/.cache/electron \
    ELECTRON_CACHE=/root/.cache/electron \
    ELECTRON_BUILDER_CACHE=/root/.cache/electron-builder \
    GRADLE_USER_HOME=/root/.gradle \
    JAVA_HOME=/opt/jdk \
    ANDROID_HOME=/opt/android-sdk \
    WINEDEBUG=-all

# smoke: Xvfb and Electron's libraries. windows-installer: wine (32-bit too; electron-builder runs the 32-bit NSIS
# uninstaller stub under wine) and `file`. android-apk: unzip.
RUN dpkg --add-architecture i386 \
 && apt-get update -qq \
 && apt-get install -y -qq --no-install-recommends \
      xvfb xauth libnss3 libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 libgtk-3-0 libgbm1 libasound2 libxss1 \
      libxshmfence1 libxkbcommon0 libxcomposite1 libxdamage1 libxrandr2 \
      wine wine32 wine64 file unzip python3-pytest \
 && rm -rf /var/lib/apt/lists/* \
 && wine --version

# JDK 21 and the Android SDK (platform 36, build tools 36.0.0). java on PATH via /usr/local/bin: apksigner runs
# `java` from PATH, not from JAVA_HOME.
SHELL ["/bin/bash", "-o", "pipefail", "-c"]
RUN mkdir -p /opt/jdk /opt/android-sdk/cmdline-tools \
 && curl -fsSL "https://api.adoptium.net/v3/binary/latest/21/ga/linux/x64/jdk/hotspot/normal/eclipse" \
      | tar xz -C /opt/jdk --strip-components=1 \
 && ln -s /opt/jdk/bin/* /usr/local/bin/ \
 && curl -fsSL -o /tmp/cmdline-tools.zip \
      https://dl.google.com/android/repository/commandlinetools-linux-13114758_latest.zip \
 && unzip -q /tmp/cmdline-tools.zip -d /opt/android-sdk/cmdline-tools \
 && mv /opt/android-sdk/cmdline-tools/cmdline-tools /opt/android-sdk/cmdline-tools/latest \
 && rm /tmp/cmdline-tools.zip \
 && /opt/android-sdk/cmdline-tools/latest/bin/sdkmanager --licenses < <(yes) >/dev/null \
 && /opt/android-sdk/cmdline-tools/latest/bin/sdkmanager "platforms;android-36" "build-tools;36.0.0" >/dev/null

# Warm the caches with one real build of each artefact: npm packages, the Electron binaries, electron-builder's
# NSIS/winCodeSign, the Gradle distribution and the Gradle dependencies. The sources are thrown away afterwards.
COPY . /tmp/warm
RUN cd /tmp/warm \
 && npm ci \
 && { npm run dist:win -- --publish never || npm run dist:win -- --publish never; } \
 && npm run dist:android \
 && cd / && rm -rf /tmp/warm /root/.gradle/daemon /root/.android/cache
