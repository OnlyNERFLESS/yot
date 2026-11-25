package pro.nerfless.toolbox

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.location.LocationManager
import android.net.Uri
import android.provider.Settings
import androidx.core.content.ContextCompat
import androidx.core.location.LocationManagerCompat
import android.os.Bundle
import android.webkit.JavascriptInterface
import android.webkit.WebView
import androidx.activity.enableEdgeToEdge
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat

class MainActivity : TauriActivity() {
  // Edge to edge, the page draws under the status bar and the camera cutout,
  // and Android's WebView reports no safe-area insets to CSS. These hold the
  // real system-bar sizes in CSS pixels for the page to read (main.tsx).
  @Volatile private var topDp = 0f
  @Volatile private var bottomDp = 0f

  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
  }

  override fun onWebViewCreate(webView: WebView) {
    super.onWebViewCreate(webView)
    webView.addJavascriptInterface(object {
      @JavascriptInterface fun top(): Float = topDp
      @JavascriptInterface fun bottom(): Float = bottomDp
    }, "YotInsets")
    // Android's WebView has no navigator.share; this opens the system share
    // sheet (WhatsApp, Telegram, SMS, ...) with plain text, from the UI thread.
    webView.addJavascriptInterface(object {
      @JavascriptInterface fun text(subject: String, body: String) {
        runOnUiThread {
          val send = Intent(Intent.ACTION_SEND).apply {
            type = "text/plain"
            putExtra(Intent.EXTRA_SUBJECT, subject)
            putExtra(Intent.EXTRA_TEXT, body)
          }
          startActivity(Intent.createChooser(send, subject))
        }
      }
    }, "YotShare")
    // Location help: whether the phone's location switch is on, and the two
    // settings screens a person may need when "Allow" alone cannot fix it
    // (location switched off, or permission refused with "don't ask again").
    webView.addJavascriptInterface(object {
      @JavascriptInterface fun locationOn(): Boolean {
        val lm = getSystemService(LOCATION_SERVICE) as LocationManager
        return LocationManagerCompat.isLocationEnabled(lm)
      }
      // What Android itself says is granted: "fine", "coarse" or "none". The
      // geolocation plugin's own check rejects outright while the location
      // switch is off, which made a granted permission look refused.
      @JavascriptInterface fun locationGranted(): String {
        val ok = { p: String -> ContextCompat.checkSelfPermission(this@MainActivity, p) == PackageManager.PERMISSION_GRANTED }
        return when {
          ok(Manifest.permission.ACCESS_FINE_LOCATION) -> "fine"
          ok(Manifest.permission.ACCESS_COARSE_LOCATION) -> "coarse"
          else -> "none"
        }
      }
      @JavascriptInterface fun openLocationSettings() {
        runOnUiThread { startActivity(Intent(Settings.ACTION_LOCATION_SOURCE_SETTINGS)) }
      }
      @JavascriptInterface fun openAppSettings() {
        runOnUiThread {
          startActivity(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.fromParts("package", packageName, null)))
        }
      }
    }, "YotSys")
    ViewCompat.setOnApplyWindowInsetsListener(webView) { v, insets ->
      val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout())
      val d = resources.displayMetrics.density
      topDp = bars.top / d
      bottomDp = bars.bottom / d
      (v as WebView).evaluateJavascript("window.__yotInsets && window.__yotInsets()", null)
      insets
    }
    ViewCompat.requestApplyInsets(webView)
  }
}
