#!/usr/bin/env python3
# CyberManju OS — Android voice service installer (scripts/android-voice-services.py).
# Role: Install native voice bridge and manifest/accessibility resources into generated Android projects.
# Exports: CLI gen/android path.
# Integrates: native/android Kotlin sources and AndroidManifest.xml.
# Contracts: stdlib only, namespace-aware, idempotent, preserves unrelated manifest entries.
import re
import sys
from pathlib import Path
import xml.etree.ElementTree as ET

ANDROID = "http://schemas.android.com/apk/res/android"
ET.register_namespace("android", ANDROID)
ROOT = Path(__file__).resolve().parents[1]


def fail(message):
    raise SystemExit(f"android-voice-services: {message}")


def install(android_dir):
    base = Path(android_dir).resolve()
    main = base / "app/src/main"
    manifest = main / "AndroidManifest.xml"
    if not manifest.is_file():
        fail(f"manifest not found: {manifest}")
    mains = list((main / "java").rglob("MainActivity.kt")) + list((main / "kotlin").rglob("MainActivity.kt"))
    mains = list(dict.fromkeys(mains))
    if not mains:
        fail("MainActivity.kt not found")
    text = mains[0].read_text(encoding="utf-8")
    match = re.search(r"^\s*package\s+([A-Za-z_][\w]*(?:\.[A-Za-z_][\w]*)*)", text, re.M)
    if not match:
        fail("cannot identify MainActivity package")
    package = match.group(1)
    source_dir = ROOT / "native/android"
    # Use the same generated source root as MainActivity (Java or Kotlin).
    dest = mains[0].parent
    dest.mkdir(parents=True, exist_ok=True)
    for name in ("CybermanjuVoiceServices.kt", "CybermanjuVoiceAccessibility.kt"):
        content = (source_dir / name).read_text(encoding="utf-8").replace("__PACKAGE__", package)
        (dest / name).write_text(content, encoding="utf-8")
    gradle = base / "app/build.gradle.kts"
    if not gradle.is_file():
        fail(f"unsupported generated Android layout: missing {gradle}")
    gradle_text = gradle.read_text(encoding="utf-8")
    # JNI entry points are invisible to R8. Current Tauri templates collect
    # *.pro with fileTree rather than naming proguard-rules.pro in this file.
    # Bind our own rules explicitly; never infer protection from a filename.
    def gradle_block(source, pattern):
        found = re.search(pattern + r"\s*\{", source)
        if not found:
            return None
        start = found.end(); depth = 1; pos = start
        while pos < len(source) and depth:
            if source[pos] == "{": depth += 1
            elif source[pos] == "}": depth -= 1
            pos += 1
        return (start, pos - 1) if depth == 0 else None
    build_types = gradle_block(gradle_text, r"\bbuildTypes")
    release = None
    if build_types is not None:
        start, end = build_types
        pattern = r'''(?:\b(?:getByName|named)\(\s*["']release["']\s*\)|\brelease)'''
        release = gradle_block(gradle_text[start:end], pattern)
    if release is None:
        fail("unsupported Gradle layout: cannot find/parse buildTypes.release")
    release_start = start + release[0]
    release_end = start + release[1]
    rule_name = "cybermanju-voice.pro"
    reference = f'proguardFiles("{rule_name}")'
    if reference not in gradle_text[release_start:release_end]:
        gradle_text = (gradle_text[:release_start] + "\n            " + reference +
                       " // CyberManju native voice JNI\n" + gradle_text[release_start:])
        gradle.write_text(gradle_text, encoding="utf-8")
    rules = base / "app" / rule_name
    keep = f"-keep class {package}.CybermanjuVoiceServices {{ public static java.lang.String dispatch(android.app.Activity,java.lang.String,java.lang.String); }}"
    existing = rules.read_text(encoding="utf-8") if rules.exists() else ""
    if keep not in existing:
        rules.write_text(existing + ("" if not existing or existing.endswith("\n") else "\n") + keep + "\n", encoding="utf-8")
    xml_dir = main / "res/xml"
    xml_dir.mkdir(parents=True, exist_ok=True)
    (xml_dir / "cybermanju_voice_accessibility.xml").write_text(
        '<?xml version="1.0" encoding="utf-8"?>\n'
        '<accessibility-service xmlns:android="http://schemas.android.com/apk/res/android"\n'
        '    android:description="@string/cybermanju_voice_accessibility_description"\n'
        '    android:accessibilityEventTypes="typeWindowsChanged|typeViewFocused"\n'
        '    android:accessibilityFeedbackType="feedbackGeneric"\n'
        '    android:notificationTimeout="100"\n'
        '    android:canRetrieveWindowContent="true"\n'
        '    android:isAccessibilityTool="false" />\n', encoding="utf-8")
    strings = main / "res/values/strings.xml"
    strings.parent.mkdir(parents=True, exist_ok=True)
    s = strings.read_text(encoding="utf-8") if strings.exists() else '<?xml version="1.0" encoding="utf-8"?>\n<resources>\n</resources>\n'
    values = {
        "cybermanju_voice_accessibility_description": "Fill a focused non-password field only after confirmation. Does not send messages or read content for the assistant.",
        "cybermanju_voice_notification_label": "CyberManju VozPonte - selected app notifications",
        "cybermanju_voice_accessibility_label": "CyberManju VozPonte - assisted text filling",
    }
    for name, value in values.items():
        if not re.search(r'<string\s+name="' + name + r'"', s):
            s = re.sub(r"</resources>", f'    <string name="{name}">{value}</string>\n</resources>', s, count=1)
    strings.write_text(s, encoding="utf-8")
    parser = ET.XMLParser(target=ET.TreeBuilder(insert_comments=True))
    tree = ET.parse(manifest, parser=parser)
    root = tree.getroot()
    app = root.find("application")
    if app is None:
        fail("manifest has no application")
    # Queries are merged into the existing element; no QUERY_ALL_PACKAGES permission.
    queries = root.find("queries")
    if queries is None:
        queries = ET.Element("queries")
        root.insert(list(root).index(app), queries)
    for action in ("android.speech.RecognitionService", "android.speech.action.RECOGNIZE_SPEECH", "android.intent.action.TTS_SERVICE"):
        if not any(x.get(f"{{{ANDROID}}}name") == action for q in queries.findall("intent") for x in q.findall("action")):
            intent = ET.SubElement(queries, "intent")
            ET.SubElement(intent, "action", {f"{{{ANDROID}}}name": action})
    services = [(".CybermanjuVoiceNotificationListener", "android.permission.BIND_NOTIFICATION_LISTENER_SERVICE", "android.service.notification.NotificationListenerService", None),
                (".CybermanjuVoiceAccessibility", "android.permission.BIND_ACCESSIBILITY_SERVICE", "android.accessibilityservice.AccessibilityService", "@xml/cybermanju_voice_accessibility")]
    for name, permission, action, meta in services:
        existing = next((e for e in app.findall("service") if e.get(f"{{{ANDROID}}}name") in (name, package + name)), None)
        if existing is None:
            existing = ET.SubElement(app, "service", {f"{{{ANDROID}}}name": name, f"{{{ANDROID}}}permission": permission, f"{{{ANDROID}}}exported": "true"})
        existing.set(f"{{{ANDROID}}}permission", permission)
        existing.set(f"{{{ANDROID}}}exported", "true")
        label = "cybermanju_voice_accessibility_label" if meta else "cybermanju_voice_notification_label"
        existing.set(f"{{{ANDROID}}}label", "@string/" + label)
        # Retain existing service content/attributes (including legacy messages component).
        if not any(a.get(f"{{{ANDROID}}}name") == action for f in existing.findall("intent-filter") for a in f.findall("action")):
            f = ET.SubElement(existing, "intent-filter")
            ET.SubElement(f, "action", {f"{{{ANDROID}}}name": action})
        if meta and not any(m.get(f"{{{ANDROID}}}name") == "android.accessibilityservice" for m in existing.findall("meta-data")):
            ET.SubElement(existing, "meta-data", {f"{{{ANDROID}}}name": "android.accessibilityservice", f"{{{ANDROID}}}resource": meta})
    # ElementTree normalizes XML only on first install; subsequent output is byte-stable.
    tree.write(manifest, encoding="utf-8", xml_declaration=True)


if __name__ == "__main__":
    if len(sys.argv) != 2:
        fail("usage: android-voice-services.py gen/android")
    install(sys.argv[1])
