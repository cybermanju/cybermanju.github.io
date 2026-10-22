#!/usr/bin/env python3
# CyberManju OS — Android Home-role bridge installer (scripts/android-home-role.py).
# Role: copy the explicit HOME-role JNI bridge into generated Tauri Android projects.
# Exports: install(gen/android).
# Integrates: CybermanjuHomeRole.kt and android-home-activity.py lifecycle hooks.
# Contracts: idempotent, HOME-only package visibility, no role mutation or intent-filter edits.
import re
import sys
from pathlib import Path
import xml.etree.ElementTree as ET

ANDROID = "http://schemas.android.com/apk/res/android"
ET.register_namespace("android", ANDROID)
ROOT = Path(__file__).resolve().parents[1]
RULE_NAME = "cybermanju-home-role.pro"


def fail(message):
    raise SystemExit(f"android-home-role: {message}")


def release_block(source):
    build_types = re.search(r"\bbuildTypes\s*\{", source)
    if not build_types:
        return None
    start = build_types.end()
    depth = 1
    pos = start
    while pos < len(source) and depth:
        if source[pos] == "{":
            depth += 1
        elif source[pos] == "}":
            depth -= 1
        pos += 1
    if depth:
        return None
    section = source[start:pos - 1]
    release = re.search(r'''(?:\b(?:getByName|named)\(\s*["']release["']\s*\)|\brelease)\s*\{''', section)
    if not release:
        return None
    block_start = start + release.end()
    depth = 1
    end = block_start
    while end < pos - 1 and depth:
        if source[end] == "{":
            depth += 1
        elif source[end] == "}":
            depth -= 1
        end += 1
    return (block_start, end - 1) if depth == 0 else None


def install(android_dir):
    base = Path(android_dir).resolve()
    main = base / "app/src/main"
    manifest = main / "AndroidManifest.xml"
    if not manifest.is_file():
        fail(f"manifest not found: {manifest}")
    candidates = list((main / "java").rglob("MainActivity.kt")) + list((main / "kotlin").rglob("MainActivity.kt"))
    candidates = list(dict.fromkeys(candidates))
    if len(candidates) != 1:
        fail("expected exactly one generated MainActivity")
    activity = candidates[0]
    text = activity.read_text(encoding="utf-8")
    match = re.search(r"^\s*package\s+([A-Za-z_][\w]*(?:\.[A-Za-z_][\w]*)*)", text, re.M)
    if not match:
        fail("cannot identify MainActivity package")
    package = match.group(1)
    expected_hooks = (
        "CybermanjuHomeRole.onWebViewCreated(this, webView)",
        "CybermanjuHomeRole.onResume(this, homeWebView)",
        "CybermanjuHomeRole.onPause(this)",
        "CybermanjuHomeRole.onDestroy(this)",
    )
    if any(text.count(hook) != 1 for hook in expected_hooks):
        fail("MainActivity HOME lifecycle hooks are missing or duplicated; regenerate with android-home-activity.py")

    gradle = base / "app/build.gradle.kts"
    if not gradle.is_file():
        fail(f"unsupported generated Android layout: missing {gradle}")
    gradle_source = gradle.read_text(encoding="utf-8")
    release = release_block(gradle_source)
    if release is None:
        fail("unsupported Gradle layout: cannot find/parse buildTypes.release")
    start, end = release
    reference = f'proguardFiles("{RULE_NAME}")'
    gradle_new = gradle_source
    if reference not in gradle_source[start:end]:
        gradle_new = gradle_source[:start] + "\n            " + reference + " // CyberManju HOME role JNI\n" + gradle_source[start:]

    parser = ET.XMLParser(target=ET.TreeBuilder(insert_comments=True))
    try:
        tree = ET.parse(manifest, parser=parser)
    except ET.ParseError as error:
        fail(f"invalid manifest XML: {error}")
    root = tree.getroot()
    queries = root.find("queries")
    if queries is None:
        queries = ET.Element("queries")
        app = root.find("application")
        if app is not None:
            root.insert(list(root).index(app), queries)
        else:
            root.append(queries)
    action_name = "android.intent.action.MAIN"
    category_name = "android.intent.category.HOME"
    found = any(
        any(action.get(f"{{{ANDROID}}}name") == action_name for action in intent.findall("action"))
        and any(category.get(f"{{{ANDROID}}}name") == category_name for category in intent.findall("category"))
        for intent in queries.findall("intent")
    )
    if not found:
        intent = ET.SubElement(queries, "intent")
        ET.SubElement(intent, "action", {f"{{{ANDROID}}}name": action_name})
        ET.SubElement(intent, "category", {f"{{{ANDROID}}}name": category_name})
    for settings_action in (
        "android.settings.HOME_SETTINGS",
        "android.settings.MANAGE_DEFAULT_APPS_SETTINGS",
    ):
        already_visible = any(
            any(item.get(f"{{{ANDROID}}}name") == settings_action for item in intent.findall("action"))
            for intent in queries.findall("intent")
        )
        if not already_visible:
            intent = ET.SubElement(queries, "intent")
            ET.SubElement(intent, "action", {f"{{{ANDROID}}}name": settings_action})

    # Validate all inputs before writing generated outputs.
    kotlin_source = (ROOT / "native/android/CybermanjuHomeRole.kt").read_text(encoding="utf-8")
    if kotlin_source.count("__PACKAGE__") != 1:
        fail("native HOME role source must contain exactly one package placeholder")
    kotlin = kotlin_source.replace("__PACKAGE__", package)
    destination = activity.parent / "CybermanjuHomeRole.kt"
    rules = base / "app" / RULE_NAME
    keep = f"-keep class {package}.CybermanjuHomeRole {{ public static java.lang.String dispatch(android.app.Activity,java.lang.String,java.lang.String); public static void onWebViewCreated(android.app.Activity,android.webkit.WebView); public static void onResume(android.app.Activity,android.webkit.WebView); public static void onPause(android.app.Activity); public static void onDestroy(android.app.Activity); }}"
    existing_rules = rules.read_text(encoding="utf-8") if rules.exists() else ""
    if existing_rules and "CyberManju OS HOME role bridge (scripts/android-home-role.py)" not in existing_rules:
        fail(f"refusing to overwrite unmarked rule file: {rules}")
    rules_new = existing_rules
    marker = "# CyberManju OS HOME role bridge (scripts/android-home-role.py)"
    if marker not in rules_new:
        rules_new += ("" if not rules_new or rules_new.endswith("\n") else "\n") + marker + "\n" + keep + "\n"

    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_text(kotlin, encoding="utf-8")
    if gradle_new != gradle_source:
        gradle.write_text(gradle_new, encoding="utf-8")
    if rules_new != existing_rules:
        rules.write_text(rules_new, encoding="utf-8")
    tree.write(manifest, encoding="utf-8", xml_declaration=True)
    print(f"Android Home role bridge configured: {destination}")


if __name__ == "__main__":
    if len(sys.argv) != 2:
        fail("usage: android-home-role.py gen/android")
    install(sys.argv[1])
