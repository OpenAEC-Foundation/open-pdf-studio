// Android activity of Open PDF Studio (#596).
//
// `tauri android init` generates src-tauri/gen/android (not in git) with a
// bare MainActivity. scripts/android-project.mjs replaces that file with this
// one after init, locally and in the release workflow.
//
// 1. System bars: the activity runs edge-to-edge (enforced from targetSdk 35
//    on Android 15, and switched on by enableEdgeToEdge() below for older
//    versions). The WebView then reaches under the status bar and the
//    navigation bar, and env(safe-area-inset-*) stays 0 in the WebView, so
//    the app's top and bottom bars were drawn under them (tapping zoom-in hit
//    Home). The content view gets the system bar, display cutout and keyboard
//    insets as padding, so the WebView only covers the free area.
// 2. File names: a document opened from another app or the file picker is a
//    content:// URI with an opaque id. window.OpdsAndroid.displayName(uri)
//    returns its display name (OpenableColumns.DISPLAY_NAME), see
//    js/core/bestandsnaam.js.
// 3. Delen (#952): window.OpdsAndroid.share(path, mime, title) zet de
//    verzendkopie uit de cachemap (src-tauri/src/email.rs,
//    verzendkopie_schrijven) in het deelvenster van Android, naar mail,
//    Drive, berichten-apps enz. De FileProvider is die van het gegenereerde
//    project (<applicationId>.fileprovider), dezelfde die de bestandskiezer
//    voor camerafoto's gebruikt. Zie js/pdf/delen.js.

package org.openaec.openpdfstudio

import android.app.Activity
import android.content.ClipData
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.provider.OpenableColumns
import android.view.View
import android.webkit.JavascriptInterface
import android.webkit.WebView
import androidx.activity.enableEdgeToEdge
import androidx.core.content.FileProvider
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import java.io.File

class MainActivity : TauriActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)

    val content = findViewById<View>(android.R.id.content)
    ViewCompat.setOnApplyWindowInsetsListener(content) { view, insets ->
      val bars = insets.getInsets(
        WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout()
      )
      val ime = insets.getInsets(WindowInsetsCompat.Type.ime())
      view.setPadding(bars.left, bars.top, bars.right, maxOf(bars.bottom, ime.bottom))
      WindowInsetsCompat.CONSUMED
    }
    ViewCompat.requestApplyInsets(content)
  }

  override fun onWebViewCreate(webView: WebView) {
    super.onWebViewCreate(webView)
    webView.addJavascriptInterface(OpdsAndroidBridge(this), "OpdsAndroid")
  }
}

class OpdsAndroidBridge(private val activity: Activity) {
  @JavascriptInterface
  fun displayName(uri: String?): String? {
    if (uri == null || !uri.startsWith("content://")) return null
    return try {
      activity.contentResolver.query(
        Uri.parse(uri), arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null
      )?.use { cursor ->
        val column = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME)
        if (column >= 0 && cursor.moveToFirst() && !cursor.isNull(column)) cursor.getString(column) else null
      }
    } catch (e: Exception) {
      null
    }
  }

  // Lege tekst = het deelvenster is geopend; anders de foutmelding.
  @JavascriptInterface
  fun share(path: String?, mime: String?, title: String?): String {
    if (path.isNullOrEmpty()) return "no file"
    return try {
      val file = File(path).canonicalFile
      val cache = activity.cacheDir.canonicalFile
      // Alleen een kopie uit de eigen cachemap, nooit een willekeurig pad.
      if (!file.path.startsWith(cache.path + File.separator) || !file.isFile) return "not a send copy: $path"
      val uri = deelUri(file)
      val send = Intent(Intent.ACTION_SEND).apply {
        type = if (mime.isNullOrEmpty()) "application/pdf" else mime
        putExtra(Intent.EXTRA_STREAM, uri)
        putExtra(Intent.EXTRA_SUBJECT, file.name)
        clipData = ClipData.newRawUri(file.name, uri)
        addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
      }
      val chooser = Intent.createChooser(send, title ?: file.name)
      activity.runOnUiThread { activity.startActivity(chooser) }
      ""
    } catch (e: Exception) {
      e.message ?: e.toString()
    }
  }

  private fun deelUri(file: File): Uri {
    val authority = activity.packageName + ".fileprovider"
    return try {
      FileProvider.getUriForFile(activity, authority, file)
    } catch (e: IllegalArgumentException) {
      // De paden van de provider dekken de cachemap niet: via de externe
      // bestandenmap van de app (external-path), die ze wel dekken.
      val map = File(activity.getExternalFilesDir(null), "verzenden").apply { mkdirs() }
      val kopie = File(map, file.name)
      file.copyTo(kopie, overwrite = true)
      FileProvider.getUriForFile(activity, authority, kopie)
    }
  }
}
