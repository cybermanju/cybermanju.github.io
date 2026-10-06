pub mod agent;
pub mod artifact;
pub mod canal;
pub mod compression;
pub mod crypto;
pub mod db;
pub mod opfs_backend;
pub mod os;

use wasm_bindgen::prelude::*;

pub use compression::*;
pub use crypto::*;
pub use db::*;
pub use os::*;

#[wasm_bindgen(start)]
pub fn init() {
    wasm_logger::init(wasm_logger::Config::default());
    log::info!("CyberManju OS WASM module initialized");
}
