use wasm_bindgen::prelude::*;

#[wasm_bindgen]
pub fn compress_lz4(data: &[u8]) -> Vec<u8> {
    lz4_flex::compress_prepend_size(data)
}

#[wasm_bindgen]
pub fn decompress_lz4(data: &[u8]) -> Result<Vec<u8>, JsValue> {
    lz4_flex::decompress_size_prepended(data)
        .map_err(|e| JsValue::from_str(&format!("LZ4 decompression failed: {}", e)))
}

#[wasm_bindgen]
pub fn compress_brotli(data: &[u8], quality: u32) -> Vec<u8> {
    use std::io::Write;
    let mut compressor = brotli::CompressorWriter::new(Vec::new(), 4096, quality, 22);
    compressor.write_all(data).expect("Brotli write failed");
    compressor.into_inner()
}

#[wasm_bindgen]
pub fn decompress_brotli(data: &[u8]) -> Result<Vec<u8>, JsValue> {
    use std::io::Write;
    let mut decompressor = brotli::DecompressorWriter::new(Vec::new(), 4096);
    decompressor
        .write_all(data)
        .map_err(|e| JsValue::from_str(&format!("Brotli decompression failed: {}", e)))?;
    // `into_inner` returns `Result<W, W>`: the `Err` arm hands back the
    // partial output, not an error value, so report it as bytes written.
    decompressor.into_inner().map_err(|partial| {
        JsValue::from_str(&format!(
            "Brotli stream incomplete ({} bytes of output)",
            partial.len()
        ))
    })
}

#[wasm_bindgen]
pub fn compress_lz4_probe_ratio(data: &[u8]) -> f64 {
    let compressed = lz4_flex::compress_prepend_size(data);
    if data.is_empty() {
        1.0
    } else {
        compressed.len() as f64 / data.len() as f64
    }
}
