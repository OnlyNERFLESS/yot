package pro.nerfless.toolbox

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
