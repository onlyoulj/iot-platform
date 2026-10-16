#!/bin/bash
# IoT 移动端 WebView 套壳 APK 构建脚本（无需 Gradle/Android Studio）
set -e
SDK="${LOCALAPPDATA}/Android/Sdk"
JDK="C:/Program Files/Java/jdk-22"
BT="$SDK/build-tools/36.1.0"
PLATFORM="$SDK/platforms/android-35/android.jar"
ROOT="$(cd "$(dirname "$0")" && pwd)"
SRC="$ROOT/app/src/main"
OUT="$ROOT/build"
rm -rf "$OUT"; mkdir -p "$OUT/compiled" "$OUT/dex" "$OUT/obj"

echo "[1/6] aapt2 compile resources"
"$BT/aapt2.exe" compile --dir "$SRC/res" -o "$OUT/compiled/res.zip"

echo "[2/6] aapt2 link (base APK + java R)"
"$BT/aapt2.exe" link -o "$OUT/base.apk" \
  -I "$PLATFORM" \
  --manifest "$SRC/AndroidManifest.xml" \
  --java "$OUT/obj" \
  --auto-add-overlay \
  "$OUT/compiled/res.zip"

echo "[3/6] javac"
(cd "$ROOT" && find build/obj -name "R.java") > "$OUT/sources.txt"
echo "app/src/main/java/com/iot/mobile/MainActivity.java" >> "$OUT/sources.txt"
javac -source 11 -target 11 -classpath "$PLATFORM" -d "$OUT/classes" @"$OUT/sources.txt"

echo "[4/6] d8 dex"
cd "$ROOT" && "$BT/d8.bat" --release --lib "$PLATFORM" --output build/dex $(cd "$ROOT" && find build/classes -name "*.class")

echo "[5/6] package assets + dex (jar append)"
cd "$ROOT/app/src/main"
"$JDK/bin/jar.exe" --update --file "$OUT/base.apk" assets
cd "$OUT/dex"
"$JDK/bin/jar.exe" --update --file "$OUT/base.apk" classes.dex

echo "[6/6] zipalign + sign"
"$BT/zipalign.exe" -f 4 "$OUT/base.apk" "$OUT/aligned.apk"
# 调试签名：不存在则生成
KEYSTORE="$ROOT/debug.keystore"
if [ ! -f "$KEYSTORE" ]; then
  "$JDK/bin/keytool.exe" -genkeypair -v -keystore "$KEYSTORE" -storepass android -keypass android \
    -alias androiddebugkey -dname "CN=IoT Mobile Debug,O=IoT,C=CN" \
    -keyalg RSA -keysize 2048 -validity 10000 > /dev/null 2>&1
fi
"$BT/apksigner.bat" sign --ks "$KEYSTORE" --ks-pass pass:android --key-pass pass:android \
  --out "$ROOT/IoT-Mobile-v1.0.0.apk" "$OUT/aligned.apk"
echo "DONE: $ROOT/IoT-Mobile-v1.0.0.apk"
