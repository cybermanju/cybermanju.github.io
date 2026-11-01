#!/usr/bin/env python3
"""Capture the official Technosutra gallery GLBs as transparent VN reference renders.

The script reads the upstream gallery manifest, renders each available model with
Three.js at a configurable camera azimuth, and writes a provenance manifest.
It does not bundle or retain the upstream GLB binaries.
"""
from __future__ import annotations

import argparse
import concurrent.futures
import http.server
import json
import os
import shutil
import tempfile
import threading
import urllib.error
import urllib.request
from pathlib import Path
from urllib.parse import unquote, urlparse

ROOT = Path(__file__).resolve().parents[3]
PROJECT = ROOT / "integrations" / "renpy-technosutra"
CHAPTERS_FILE = PROJECT / "chapters.json"
OUTPUT = PROJECT / "game" / "images" / "masters" / "source"
GALLERY_COMMIT = "b0f08869b385faf9934548fbc978573dc3fc7b3"
UPSTREAM = "https://raw.githubusercontent.com/technosutra21/technosutra/HEAD"
USER_AGENT = "Cue-Technosutra-GLB-Sprite-Importer/1.0"
WIDTH, HEIGHT = 600, 800

HTML = r'''<!doctype html><meta charset="utf-8"><canvas id="render" width="600" height="800"></canvas>
<script type="importmap">{"imports":{"three":"/node_modules/three/build/three.module.js"}}</script>
<script type="module">
import * as THREE from '/node_modules/three/build/three.module.js';
import { GLTFLoader } from '/node_modules/three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from '/node_modules/three/examples/jsm/libs/meshopt_decoder.module.js';
const canvas = document.querySelector('#render');
const renderer = new THREE.WebGLRenderer({canvas, alpha:true, antialias:true, preserveDrawingBuffer:true});
renderer.setPixelRatio(1); renderer.setSize(600,800,false); renderer.setClearColor(0x000000,0);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.1;
const scene = new THREE.Scene();
scene.add(new THREE.HemisphereLight(0xffffff,0x615146,2.15));
const key = new THREE.DirectionalLight(0xffffff,2.7); key.position.set(-4,7,8); scene.add(key);
const fill = new THREE.DirectionalLight(0xc8d8ff,1.15); fill.position.set(5,3,-4); scene.add(fill);
const camera = new THREE.PerspectiveCamera(32,600/800,0.01,10000);
let current = null;
function releaseCurrent(){
  if(!current) return;
  scene.remove(current);
  current.traverse(o=>{
    if(o.geometry) o.geometry.dispose();
    if(o.material){ for(const m of (Array.isArray(o.material)?o.material:[o.material])){
      for(const v of Object.values(m)) if(v && v.isTexture) v.dispose();
      m.dispose();
    }}
  });
  current=null;
}
window.renderModel = async (url) => {
  releaseCurrent();
  const loader = new GLTFLoader(); loader.setMeshoptDecoder(MeshoptDecoder);
  const gltf = await loader.loadAsync(url);
  current = gltf.scene; scene.add(current); current.updateMatrixWorld(true);
  let bounds = new THREE.Box3().setFromObject(current);
  const size = bounds.getSize(new THREE.Vector3());
  const center = bounds.getCenter(new THREE.Vector3());
  current.position.sub(center); current.updateMatrixWorld(true);
  bounds = new THREE.Box3().setFromObject(current);
  const sphere = new THREE.Sphere(); bounds.getBoundingSphere(sphere);
  // Use the requested azimuth; 90deg faces models oriented toward +X.
  const phi = THREE.MathUtils.degToRad(75), theta = THREE.MathUtils.degToRad(__CAMERA_THETA_DEG__);
  const distance = Math.max(sphere.radius * 3.25, 0.5);
  camera.position.set(
    sphere.center.x + Math.sin(theta)*Math.sin(phi)*distance,
    sphere.center.y + Math.cos(phi)*distance,
    sphere.center.z + Math.cos(theta)*Math.sin(phi)*distance
  );
  camera.lookAt(sphere.center); camera.updateProjectionMatrix();
  renderer.render(scene,camera);
  const animations = gltf.animations.map(a=>a.name);
  const morphTargets = [];
  current.traverse(o=>{
    if(o.isMesh && o.morphTargetDictionary){
      morphTargets.push({mesh:o.name, targets:Object.keys(o.morphTargetDictionary)});
    }
  });
  return {size:size.toArray(), animations, morphTargets, meshCount: (()=>{let n=0;current.traverse(o=>{if(o.isMesh)n++});return n})()};
};
window.renderReady = true;
</script>'''


def fetch_bytes(url: str, timeout: int = 90) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=timeout) as response:
        return response.read()


def download_model(filename: str, destination: Path) -> tuple[str, str | None]:
    url = f"{UPSTREAM}/models/{filename}"
    for attempt in range(3):
        try:
            data = fetch_bytes(url)
            if len(data) < 12 or data[:4] != b"glTF":
                raise ValueError("download did not contain a valid GLB header")
            destination.write_bytes(data)
            return filename, None
        except Exception as exc:  # retry transient upstream/network failures
            if attempt == 2:
                return filename, f"{type(exc).__name__}: {exc}"
    return filename, "download failed"


class AssetHandler(http.server.SimpleHTTPRequestHandler):
    temp_root: Path
    root: Path

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(self.root), **kwargs)

    def translate_path(self, path: str) -> str:
        clean = unquote(urlparse(path).path).lstrip("/")
        if clean == "render.html":
            return str(self.temp_root / "render.html")
        if clean.startswith("models/"):
            return str(self.temp_root / clean)
        return str(self.root / clean)

    def log_message(self, fmt: str, *args) -> None:
        pass


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--theta-deg", type=float, default=90.0, help="Camera azimuth in degrees; 90 is front-facing for the tested model orientation.")
    parser.add_argument("--chapter", type=int, action="append", dest="chapters", help="Render only this chapter/model ID; repeat to select more than one.")
    parser.add_argument("--output", type=Path, default=OUTPUT, help="Directory for captures and capture_manifest.json.")
    args = parser.parse_args()
    output_dir = args.output
    chapters = json.loads(CHAPTERS_FILE.read_text(encoding="utf-8"))["chapters"]
    chapter_by_id = {int(c["number"]): c for c in chapters}
    gallery = json.loads(fetch_bytes(f"{UPSTREAM}/models/models.json").decode("utf-8"))
    items = [m for m in gallery["models"] if m.get("available") and m.get("filename")]
    available_model_count = len(items)
    if args.chapters:
        selected = set(args.chapters)
        items = [m for m in items if int(m["id"]) in selected]
    if not items:
        raise SystemExit("No available GLBs matched the requested selection.")

    output_dir.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="technosutra-glb-captures-") as temp_name:
        temp = Path(temp_name)
        render_html = HTML.replace("__CAMERA_THETA_DEG__", str(args.theta_deg))
        (temp / "render.html").write_text(render_html, encoding="utf-8")
        (temp / "models").mkdir()
        with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
            futures = [
                pool.submit(download_model, item["filename"], temp / "models" / item["filename"])
                for item in items
            ]
            download_errors = dict(future.result() for future in concurrent.futures.as_completed(futures))

        handler = type("BoundAssetHandler", (AssetHandler,), {"temp_root": temp, "root": ROOT})
        server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), handler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        records: list[dict] = []
        try:
            try:
                from playwright.sync_api import sync_playwright
            except ImportError as exc:
                raise SystemExit("Python Playwright is required for GLB rendering.") from exc
            with sync_playwright() as playwright:
                browser = playwright.chromium.launch(
                    executable_path=os.environ.get("CHROMIUM", "/usr/bin/chromium"),
                    headless=True,
                    args=["--no-sandbox", "--enable-webgl", "--use-gl=angle", "--use-angle=swiftshader", "--disable-dev-shm-usage"],
                )
                page = browser.new_page(viewport={"width": WIDTH, "height": HEIGHT}, device_scale_factor=1)
                page.goto(f"http://127.0.0.1:{server.server_port}/render.html", wait_until="domcontentloaded", timeout=30000)
                page.wait_for_function("window.renderReady === true", timeout=30000)
                for item in items:
                    number = int(item["id"])
                    filename = item["filename"]
                    chapter = chapter_by_id.get(number, {})
                    record = {
                        "chapter": number,
                        "chapterTitle": chapter.get("title", f"Chapter {number}"),
                        "upstreamFile": f"models/{filename}",
                        "sourceUrl": f"https://github.com/technosutra21/technosutra/blob/{GALLERY_COMMIT}/models/{filename}",
                        "capture": f"model_{number:02d}.png",
                        "width": WIDTH,
                        "height": HEIGHT,
                        "downloadError": download_errors.get(filename),
                    }
                    if record["downloadError"]:
                        records.append(record)
                        print(f"SKIP chapter {number}: {record['downloadError']}", flush=True)
                        continue
                    try:
                        details = page.evaluate("url => window.renderModel(url)", f"/models/{filename}")
                        target = output_dir / record["capture"]
                        page.locator("#render").screenshot(path=str(target), omit_background=True, timeout=120000)
                        record.update({"render": details, "renderError": None})
                        print(f"CAPTURE {number:02d}/56 {chapter.get('title','')} → {target.name}", flush=True)
                    except Exception as exc:
                        record.update({"render": None, "renderError": f"{type(exc).__name__}: {exc}"})
                        print(f"ERROR chapter {number}: {record['renderError']}", flush=True)
                    records.append(record)
                browser.close()
        finally:
            server.shutdown()
            server.server_close()

    manifest = {
        "title": "Technosutra gallery GLB reference captures",
        "sourceRepository": "https://github.com/technosutra21/technosutra",
        "sourceCommit": GALLERY_COMMIT,
        "captureMethod": f"Three.js transparent render at 600x800 with camera azimuth {args.theta_deg:g}deg and polar angle 75deg.",
        "licenseCaution": "The upstream README claims MIT, but the published LICENSE contains conflict markers and GPLv3 text. Confirm asset rights before public redistribution.",
        "galleryAvailableModelCount": available_model_count,
        "captures": records,
    }
    (output_dir / "capture_manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    succeeded = sum(bool((output_dir / item["capture"]).exists()) for item in records)
    print(f"Captured {succeeded}/{len(items)} GLBs. Manifest: {output_dir / 'capture_manifest.json'}")
    return 0 if succeeded == len(items) else 1


if __name__ == "__main__":
    raise SystemExit(main())
