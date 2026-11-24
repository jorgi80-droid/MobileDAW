package com.mobiledaw.app;

import android.os.Bundle;
import android.view.Display;
import android.view.View;
import android.view.Window;
import android.view.WindowManager;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import com.getcapacitor.BridgeActivity;

// MobileDAW runs immersive full screen: status bar and navigation bar hidden, a swipe from the edge shows them for a moment.
// They are hidden again whenever the window gets focus back (after a dialog, the share sheet, the file picker or the app switcher).
public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(DawFolderPlugin.class);   // MobileDAW folder on the phone's storage (js/safdir.js)
        registerPlugin(NativeEnginePlugin.class);   // C++ audio engine with Oboe (js/engine/nativesink.js)
        super.onCreate(savedInstanceState);
        Window w = getWindow();
        WindowCompat.setDecorFitsSystemWindows(w, false);
        w.addFlags(WindowManager.LayoutParams.FLAG_DRAWS_SYSTEM_BAR_BACKGROUNDS);
        hideSystemBars();
        preferHighRefreshRate();
        // The UI has its own scale (Pengaturan -> Tampilan -> Skala UI): Android's font size setting must not enlarge the WebView text on top of it
        if (getBridge() != null && getBridge().getWebView() != null) getBridge().getWebView().getSettings().setTextZoom(100);
    }

    @Override
    public void onResume() {
        super.onResume();
        hideSystemBars();
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) hideSystemBars();
    }

    // Android gives apps 60/90 Hz unless they ask: pick the fastest display mode at the current resolution (120 / 144 Hz panels)
    // so the arrangement, piano roll and meters can run at the full refresh rate.
    private void preferHighRefreshRate() {
        try {
            Display d = getWindowManager().getDefaultDisplay();
            Display.Mode cur = d.getMode(), best = cur;
            for (Display.Mode m : d.getSupportedModes()) {
                if (m.getPhysicalWidth() == cur.getPhysicalWidth() && m.getPhysicalHeight() == cur.getPhysicalHeight() && m.getRefreshRate() > best.getRefreshRate()) best = m;
            }
            WindowManager.LayoutParams lp = getWindow().getAttributes();
            lp.preferredDisplayModeId = best.getModeId();
            lp.preferredRefreshRate = best.getRefreshRate();
            getWindow().setAttributes(lp);
        } catch (Exception ignored) { }
    }

    private void hideSystemBars() {
        Window w = getWindow();
        View decor = w.getDecorView();
        WindowInsetsControllerCompat c = WindowCompat.getInsetsController(w, decor);
        c.setSystemBarsBehavior(WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
        c.hide(WindowInsetsCompat.Type.systemBars());
    }
}
