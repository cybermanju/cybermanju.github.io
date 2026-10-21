// CyberManju OS — Native Compression Tests (src-tauri/src/native_compression_tests.rs).
// Role: Exercise production decoding and private artifact creation.
// Exports: native compression unit tests; full IPC cases live in native_crypto_tests.
// Integrates: TripleCompressor and the command module's real filesystem writer.
// Contracts: codecs are not authentication; integrity rejection is tested through stored hashes over IPC.
use super::{decode_artifact, write_new_private};
use crate::compression::TripleCompressor;

#[test]
fn production_decoder_roundtrips_each_codec_and_all_layers() {
    let compressor = TripleCompressor::new();
    let original = b"production compression regression payload ".repeat(256);
    for layer in ["lz4", "zstd", "brotli"] {
        let (artifact, _) = compressor.compress_data(&original, layer).unwrap();
        assert_eq!(
            decode_artifact(&compressor, &artifact, layer).unwrap(),
            original
        );
    }
    let (artifact, stats) = compressor.compress_triple(&original).unwrap();
    let layer = if stats.layer.starts_with("skipped") {
        "identity"
    } else {
        "all"
    };
    assert_eq!(
        decode_artifact(&compressor, &artifact, layer).unwrap(),
        original
    );
    assert!(decode_artifact(&compressor, &artifact, "unsupported").is_err());
}

#[test]
fn production_writer_is_private_and_never_overwrites() {
    let path = std::env::temp_dir().join(format!("native-artifact-{}", uuid::Uuid::new_v4()));
    write_new_private(&path, b"original artifact").unwrap();
    assert!(write_new_private(&path, b"replacement").is_err());
    assert_eq!(std::fs::read(&path).unwrap(), b"original artifact");
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        assert_eq!(
            std::fs::metadata(&path).unwrap().permissions().mode() & 0o777,
            0o600
        );
    }
    std::fs::remove_file(path).unwrap();
}
