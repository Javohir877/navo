package uz.navo.player;

import android.Manifest;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Build;
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/** Bridge between the web player and PlaybackService. */
@CapacitorPlugin(name = "NavoMedia")
public class NavoMediaPlugin extends Plugin {

    private static NavoMediaPlugin instance;
    private boolean askedNotif = false;

    @Override
    public void load() {
        instance = this;
    }

    static void emit(String action) {
        if (instance == null) return;
        JSObject o = new JSObject();
        o.put("action", action);
        instance.notifyListeners("action", o, true);
    }

    @PluginMethod
    public void update(PluginCall call) {
        boolean playing = Boolean.TRUE.equals(call.getBoolean("playing", false));
        Intent i = new Intent(getContext(), PlaybackService.class)
            .setAction(PlaybackService.ACTION_UPDATE)
            .putExtra("title", call.getString("title", "Navo"))
            .putExtra("artist", call.getString("artist", ""))
            .putExtra("playing", playing);
        try {
            if (playing && Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                getContext().startForegroundService(i);
            } else {
                getContext().startService(i);
            }
        } catch (Exception ignored) {
            // Background-start restrictions: the notification simply isn't updated.
        }
        if (playing) askNotificationPermission();
        call.resolve();
    }

    @PluginMethod
    public void stop(PluginCall call) {
        try {
            getContext().startService(new Intent(getContext(), PlaybackService.class).setAction(PlaybackService.ACTION_STOP));
        } catch (Exception ignored) {}
        call.resolve();
    }

    private void askNotificationPermission() {
        if (askedNotif || Build.VERSION.SDK_INT < 33 || getActivity() == null) return;
        askedNotif = true;
        if (ContextCompat.checkSelfPermission(getContext(), Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            ActivityCompat.requestPermissions(getActivity(), new String[] { Manifest.permission.POST_NOTIFICATIONS }, 4207);
        }
    }
}
