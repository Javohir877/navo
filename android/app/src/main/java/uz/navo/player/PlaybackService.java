package uz.navo.player;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.IBinder;
import android.os.PowerManager;
import androidx.core.app.NotificationCompat;

/**
 * Keeps Navo alive while music plays in the background and shows
 * a notification with previous / play-pause / next buttons.
 */
public class PlaybackService extends Service {

    public static final String ACTION_UPDATE = "uz.navo.player.UPDATE";
    public static final String ACTION_STOP = "uz.navo.player.STOP";
    public static final String ACTION_TOGGLE = "uz.navo.player.TOGGLE";
    public static final String ACTION_NEXT = "uz.navo.player.NEXT";
    public static final String ACTION_PREV = "uz.navo.player.PREV";

    private static final String CHANNEL = "navo_playback";
    private static final int NOTIF_ID = 1207;

    private PowerManager.WakeLock wakeLock;
    private boolean foreground = false;

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        String action = intent != null ? intent.getAction() : null;
        if (action == null) return START_NOT_STICKY;

        switch (action) {
            case ACTION_TOGGLE:
                NavoMediaPlugin.emit("toggle");
                return START_NOT_STICKY;
            case ACTION_NEXT:
                NavoMediaPlugin.emit("next");
                return START_NOT_STICKY;
            case ACTION_PREV:
                NavoMediaPlugin.emit("prev");
                return START_NOT_STICKY;
            case ACTION_STOP:
                releaseWakeLock();
                stopForegroundCompat(true);
                stopSelf();
                return START_NOT_STICKY;
            case ACTION_UPDATE:
            default:
                String title = intent.getStringExtra("title");
                String artist = intent.getStringExtra("artist");
                boolean playing = intent.getBooleanExtra("playing", false);
                Notification n = build(title, artist, playing);
                if (playing) {
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                        startForeground(NOTIF_ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK);
                    } else {
                        startForeground(NOTIF_ID, n);
                    }
                    foreground = true;
                    acquireWakeLock();
                } else {
                    releaseWakeLock();
                    if (foreground) stopForegroundCompat(false);
                    NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
                    if (nm != null) nm.notify(NOTIF_ID, n);
                }
                return START_NOT_STICKY;
        }
    }

    private void stopForegroundCompat(boolean remove) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
            stopForeground(remove ? STOP_FOREGROUND_REMOVE : STOP_FOREGROUND_DETACH);
        } else {
            stopForeground(remove);
        }
        foreground = false;
    }

    private PendingIntent action(String a, int req) {
        Intent i = new Intent(this, PlaybackService.class).setAction(a);
        return PendingIntent.getService(this, req, i, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
    }

    private Notification build(String title, String artist, boolean playing) {
        NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && nm != null && nm.getNotificationChannel(CHANNEL) == null) {
            NotificationChannel ch = new NotificationChannel(CHANNEL, "Ijro", NotificationManager.IMPORTANCE_LOW);
            ch.setDescription("Navo — hozir ijro etilayotgan qo'shiq");
            ch.setShowBadge(false);
            nm.createNotificationChannel(ch);
        }
        Intent open = new Intent(this, MainActivity.class).setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent content = PendingIntent.getActivity(this, 0, open, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);

        return new NotificationCompat.Builder(this, CHANNEL)
            .setSmallIcon(R.drawable.ic_stat_navo)
            .setContentTitle(title == null || title.isEmpty() ? "Navo" : title)
            .setContentText(artist == null ? "" : artist)
            .setContentIntent(content)
            .setOngoing(playing)
            .setShowWhen(false)
            .setOnlyAlertOnce(true)
            .setSilent(true)
            .setColor(0xFFFF5FA2)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setCategory(NotificationCompat.CATEGORY_TRANSPORT)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .addAction(android.R.drawable.ic_media_previous, "Oldingi", action(ACTION_PREV, 1))
            .addAction(playing ? android.R.drawable.ic_media_pause : android.R.drawable.ic_media_play,
                       playing ? "Pauza" : "Ijro", action(ACTION_TOGGLE, 2))
            .addAction(android.R.drawable.ic_media_next, "Keyingi", action(ACTION_NEXT, 3))
            .setDeleteIntent(action(ACTION_STOP, 4))
            .build();
    }

    private void acquireWakeLock() {
        if (wakeLock == null) {
            PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
            if (pm == null) return;
            wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "Navo::Playback");
            wakeLock.setReferenceCounted(false);
        }
        if (!wakeLock.isHeld()) wakeLock.acquire(6 * 60 * 60 * 1000L);
    }

    private void releaseWakeLock() {
        if (wakeLock != null && wakeLock.isHeld()) wakeLock.release();
    }

    @Override
    public void onDestroy() {
        releaseWakeLock();
        super.onDestroy();
    }
}
