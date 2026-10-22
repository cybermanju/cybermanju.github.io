#!/usr/bin/env python3
# CyberManju OS — Android widget host installer (scripts/android-widgets.py).
# Role: Copy the native host into generated Android projects and preserve Tauri result callbacks.
# Integrates: android-configure.sh, CybermanjuWidgets.kt, generated MainActivity and R8.
# Contracts: Idempotent, fail closed on unknown custom result overrides; no exported components or overlay permission.
import re
import sys
from pathlib import Path
import xml.etree.ElementTree as ET

ANDROID = "http://schemas.android.com/apk/res/android"
ET.register_namespace("android", ANDROID)
ROOT = Path(__file__).resolve().parents[1]
BEGIN = "    // BEGIN CyberManju widget results"
END = "    // END CyberManju widget results"
BLOCK = '''    // BEGIN CyberManju widget results
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: android.content.Intent?) {
        // Preserve Tauri/plugins for every result, including widget-owned requests.
        super.onActivityResult(requestCode, resultCode, data)
        CybermanjuWidgets.onActivityResult(this, requestCode, resultCode, data)
    }
    // END CyberManju widget results'''


def install(base):
    base = Path(base).resolve()
    main = base / "app/src/main"
    candidates = list((main / "java").rglob("MainActivity.kt")) + list((main / "kotlin").rglob("MainActivity.kt"))
    if len(candidates) != 1:
        raise SystemExit("android-widgets: expected exactly one generated MainActivity")
    activity = candidates[0]
    source = activity.read_text()
    package = re.search(r"^\s*package\s+([A-Za-z_][\w]*(?:\.[A-Za-z_][\w]*)*)", source, re.M)
    if not package:
        raise SystemExit("android-widgets: MainActivity package missing")
    if BEGIN in source or END in source:
        if source.count(BEGIN) != 1 or source.count(END) != 1 or source.index(BEGIN) > source.index(END):
            raise SystemExit("android-widgets: incomplete widget result markers")
        source = re.sub(re.escape(BEGIN) + r".*?" + re.escape(END), lambda _: BLOCK, source, count=1, flags=re.S)
    else:
        if re.search(r"override\s+fun\s+onActivityResult\s*\(", source):
            raise SystemExit("android-widgets: custom onActivityResult requires deliberate merge")
        if not re.search(r"class\s+MainActivity\s*:\s*TauriActivity\s*\(\s*\)", source) or source.rfind("}") < 0:
            raise SystemExit("android-widgets: unexpected MainActivity template")
        end = source.rfind("}")
        source = source[:end] + BLOCK + "\n" + source[end:]
    manifest = main / "AndroidManifest.xml"
    tree = ET.parse(manifest, parser=ET.XMLParser(target=ET.TreeBuilder(insert_comments=True)))
    root = tree.getroot()
    permission = "android.permission.BIND_APPWIDGET"
    if not any(item.get(f"{{{ANDROID}}}name") == permission for item in root.findall("uses-permission")):
        ET.SubElement(root, "uses-permission", {f"{{{ANDROID}}}name": permission})
    queries = root.find("queries")
    if queries is None:
        queries = ET.SubElement(root, "queries")
    action = "android.appwidget.action.APPWIDGET_UPDATE"
    if not any(item.get(f"{{{ANDROID}}}name") == action for item in queries.findall("intent/action")):
        intent = ET.SubElement(queries, "intent")
        ET.SubElement(intent, "action", {f"{{{ANDROID}}}name": action})
    gradle = base / "app/build.gradle.kts"
    gradle_source = gradle.read_text()
    rules_name = "cybermanju-widgets.pro"
    if f'proguardFiles("{rules_name}")' not in gradle_source:
        gradle_source += '\n// Native widget JNI entrypoint, including minified release builds.\nandroid { buildTypes { getByName("release") { proguardFiles("cybermanju-widgets.pro") } } }\n'
    # Validate everything before modifying generated sources.
    activity.write_text(source)
    kotlin = (ROOT / "native/android/CybermanjuWidgets.kt").read_text().replace("__PACKAGE__", package.group(1))
    (activity.parent / "CybermanjuWidgets.kt").write_text(kotlin)
    gradle.write_text(gradle_source)
    (base / "app" / rules_name).write_text(
        f"-keep class {package.group(1)}.CybermanjuWidgets {{ public static java.lang.String dispatch(android.app.Activity,java.lang.String,java.lang.String); public static boolean onActivityResult(android.app.Activity,int,int,android.content.Intent); }}\n")
    tree.write(manifest, encoding="utf-8", xml_declaration=True)
    print(f"Android widget host configured: {activity}")


if __name__ == "__main__":
    if len(sys.argv) != 2:
        raise SystemExit("usage: android-widgets.py gen/android")
    install(sys.argv[1])
