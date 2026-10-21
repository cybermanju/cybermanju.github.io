// CyberManju OS — Local on-device Latin OCR (native/android/CybermanjuScreenOcr.kt).
// Role: Run bundled ML Kit Latin recognition on a caller-owned screen bitmap.
// Exports: CybermanjuScreenOcr.read(Bitmap, callback), close().
// Integrates: ML Kit bundled text recognition; no image upload or network calls.
// Contracts: Caller serializes reads; completion always fires once, even after close, to release its bitmap.
package __PACKAGE__

import android.graphics.Bitmap
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.text.TextRecognition
import com.google.mlkit.vision.text.latin.TextRecognizerOptions

class CybermanjuScreenOcr {
    private val recognizer = TextRecognition.getClient(TextRecognizerOptions.DEFAULT_OPTIONS)
    @Volatile private var closed = false

    fun read(bitmap: Bitmap, complete: (text: String?, error: String?) -> Unit) {
        if (closed) { complete(null, "OCR helper is closed"); return }
        try {
            recognizer.process(InputImage.fromBitmap(bitmap, 0)).addOnCompleteListener { task ->
                // Parent drops stale results but must still receive completion to recycle the image.
                if (closed) complete(null, "OCR helper is closed")
                else if (task.isSuccessful) complete(task.result.text.take(16000), null)
                else complete(null, task.exception?.message ?: "OCR recognition was cancelled")
            }
        } catch (error: Exception) { complete(null, error.message ?: "OCR failed") }
    }

    fun close() {
        if (!closed) { closed = true; recognizer.close() }
    }
}
