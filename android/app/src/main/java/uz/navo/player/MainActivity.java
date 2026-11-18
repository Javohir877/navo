package uz.navo.player;

import android.os.Build;
import android.os.Bundle;
import android.webkit.WebView;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(NavoMediaPlugin.class);
        registerPlugin(NavoFoldersPlugin.class);
        super.onCreate(savedInstanceState);
        // All sound runs through Web Audio inside the WebView's renderer process.
        // By default Android drops that process's priority as soon as the app is
        // hidden or the screen turns off, the audio thread starves and the sound
        // crackles. Keep it important even when Navo is not visible.
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && getBridge() != null) {
            WebView wv = getBridge().getWebView();
            if (wv != null) wv.setRendererPriorityPolicy(WebView.RENDERER_PRIORITY_IMPORTANT, false);
        }
    }
}
