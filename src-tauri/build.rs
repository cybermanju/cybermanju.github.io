// CyberManju OS — Build (src-tauri/build.rs).
// Role: module (see exports below).
// Exports: module root (see items below).
// Integrates: Tauri build plus the Apple SystemConfiguration framework on iOS.
// Contracts: iOS links SystemConfiguration for native network-interface APIs.
fn main() {
    if std::env::var("CARGO_CFG_TARGET_OS").ok().as_deref() == Some("ios") {
        println!("cargo:rustc-link-lib=framework=SystemConfiguration");
    }
    tauri_build::build()
}
