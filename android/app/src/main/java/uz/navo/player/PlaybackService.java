package uz.navo.player;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Canvas;
import android.graphics.LinearGradient;
import android.graphics.Paint;
import android.graphics.Shader;
import android.os.Build;
import android.os.IBinder;
import android.os.PowerManager;
import android.os.SystemClock;
import android.support.v4.media.MediaMetadataCompat;
import android.support.v4.media.session.MediaSessionCompat;
import android.support.v4.media.session.PlaybackStateCompat;
import android.util.Base64;
import androidx.core.app.NotificationCompat;

/**
 * Keeps Navo alive while music plays in the background and shows a media
 * notification: cover art, colours taken from the cover, a seek bar and
 * like / previous / play-pause / next / close buttons.
 */
public class PlaybackService extends Service {

    public static final String ACTION_UPDATE = "uz.navo.player.UPDATE";
    public static final String ACTION_STOP = "uz.navo.player.STOP";
    public static final String ACTION_TOGGLE = "uz.navo.player.TOGGLE";
    public static final String ACTION_NEXT = "uz.navo.player.NEXT";
    public static final String ACTION_PREV = "uz.navo.player.PREV";
    public static final String ACTION_FAV = "uz.navo.player.FAV";
    public static final String ACTION_CLOSE = "uz.navo.player.CLOSE";

    private static final String CHANNEL = "navo_playback";
    private static final int NOTIF_ID = 1207;
    private static final String CUSTOM_FAV = "navo.fav";

    private PowerManager.WakeLock wakeLock;
    private boolean foreground = false;
    private MediaSessionCompat session;

    // Last known state, so partial updates (e.g. only play/pause) keep the rest.
    private String title = "Navo", artist = "", album = "";
    private boolean playing = false, fav = false;
    private long duration = 0, position = 0;
    private float rate = 1f;
    private int color = 0xFF7C5CFF;
    private Bitmap art;

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    @Override
    public void onCreate() {
        super.onCreate();
        session = new MediaSessionCompat(this, "Navo");
        session.setCallback(new MediaSessionCompat.Callback() {
            @Override public void onPlay() { NavoMediaPlugin.emit("play"); }
            @Override public void onPause() { NavoMediaPlugin.emit("pause"); }
            @Override public void onSkipToNext() { NavoMediaPlugin.emit("next"); }
            @Override public void onSkipToPrevious() { NavoMediaPlugin.emit("prev"); }
            @Override public void onStop() { NavoMediaPlugin.emit("pause"); }
            @Override public void onSeekTo(long pos) {
                position = pos;
                pushState();
                NavoMediaPlugin.emitSeek(pos / 1000.0);
            }
            @Override public void onCustomAction(String action, android.os.Bundle extras) {
                if (CUSTOM_FAV.equals(action)) NavoMediaPlugin.emit("fav");
            }
        });
        Intent open = new Intent(this, MainActivity.class).setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        session.setSessionActivity(PendingIntent.getActivity(this, 0, open, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT));
        session.setActive(true);
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
            case ACTION_FAV:
                NavoMediaPlugin.emit("fav");
                return START_NOT_STICKY;
            case ACTION_CLOSE:
                NavoMediaPlugin.emit("pause");
                // fall through: remove the notification
            case ACTION_STOP:
                releaseWakeLock();
                stopForegroundCompat(true);
                NotificationManager nm0 = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
                if (nm0 != null) nm0.cancel(NOTIF_ID);
                stopSelf();
                return START_NOT_STICKY;
            case ACTION_UPDATE:
            default:
                readState(intent);
                pushMetadata();
                pushState();
                Notification n = build();
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

    private void readState(Intent i) {
        if (i.hasExtra("title")) {
            String t = i.getStringExtra("title");
            title = t == null || t.isEmpty() ? "Navo" : t;
        }
        if (i.hasExtra("artist")) artist = nz(i.getStringExtra("artist"));
        if (i.hasExtra("album")) album = nz(i.getStringExtra("album"));
        playing = i.getBooleanExtra("playing", playing);
        fav = i.getBooleanExtra("fav", fav);
        duration = i.getLongExtra("duration", duration);
        position = i.getLongExtra("position", position);
        rate = i.getFloatExtra("rate", rate);
        color = i.getIntExtra("color", color);
        if (i.getBooleanExtra("artReset", false)) art = null;
        String a = i.getStringExtra("art");
        if (a != null && !a.isEmpty()) {
            try {
                int comma = a.indexOf(',');
                byte[] b = Base64.decode(comma >= 0 ? a.substring(comma + 1) : a, Base64.DEFAULT);
                Bitmap bm = BitmapFactory.decodeByteArray(b, 0, b.length);
                if (bm != null) art = bm;
            } catch (Exception ignored) {}
        }
    }

    private static String nz(String s) { return s == null ? "" : s; }

    /** A soft gradient in the cover's colour, used when a track has no cover. */
    private Bitmap placeholder() {
        int s = 256;
        Bitmap bm = Bitmap.createBitmap(s, s, Bitmap.Config.ARGB_8888);
        Canvas c = new Canvas(bm);
        Paint p = new Paint(Paint.ANTI_ALIAS_FLAG);
        p.setShader(new LinearGradient(0, 0, s, s, color, darker(color, 0.45f), Shader.TileMode.CLAMP));
        c.drawRect(0, 0, s, s, p);
        // Navo's five bars in the middle.
        Paint w = new Paint(Paint.ANTI_ALIAS_FLAG);
        w.setColor(0xE6FFFFFF);
        float[] h = { 0.16f, 0.36f, 0.54f, 0.30f, 0.12f };
        float bw = s * 0.07f, gap = s * 0.055f, x = (s - (5 * bw + 4 * gap)) / 2f;
        for (float hh : h) {
            float half = s * hh / 2f;
            c.drawRoundRect(x, s / 2f - half, x + bw, s / 2f + half, bw / 2f, bw / 2f, w);
            x += bw + gap;
        }
        return bm;
    }

    private static int darker(int c, float f) {
        int r = (int) (((c >> 16) & 0xFF) * f), g = (int) (((c >> 8) & 0xFF) * f), b = (int) ((c & 0xFF) * f);
        return 0xFF000000 | (r << 16) | (g << 8) | b;
    }

    private void pushMetadata() {
        MediaMetadataCompat.Builder m = new MediaMetadataCompat.Builder()
            .putString(MediaMetadataCompat.METADATA_KEY_TITLE, title)
            .putString(MediaMetadataCompat.METADATA_KEY_ARTIST, artist)
            .putString(MediaMetadataCompat.METADATA_KEY_ALBUM, album)
            .putBitmap(MediaMetadataCompat.METADATA_KEY_ALBUM_ART, art != null ? art : placeholder());
        if (duration > 0) m.putLong(MediaMetadataCompat.METADATA_KEY_DURATION, duration);
        session.setMetadata(m.build());
    }

    private void pushState() {
        long actions = PlaybackStateCompat.ACTION_PLAY | PlaybackStateCompat.ACTION_PAUSE
            | PlaybackStateCompat.ACTION_PLAY_PAUSE | PlaybackStateCompat.ACTION_SKIP_TO_NEXT
            | PlaybackStateCompat.ACTION_SKIP_TO_PREVIOUS | PlaybackStateCompat.ACTION_STOP;
        if (duration > 0) actions |= PlaybackStateCompat.ACTION_SEEK_TO;
        PlaybackStateCompat st = new PlaybackStateCompat.Builder()
            .setActions(actions)
            .setState(playing ? PlaybackStateCompat.STATE_PLAYING : PlaybackStateCompat.STATE_PAUSED,
                      position, playing ? rate : 0f, SystemClock.elapsedRealtime())
            // Android 13+ builds its media controls from the session: the heart lives here.
            .addCustomAction(new PlaybackStateCompat.CustomAction.Builder(
                CUSTOM_FAV, fav ? "Sevimlilardan olish" : "Sevimlilarga",
                fav ? R.drawable.ic_n_heart : R.drawable.ic_n_heart_o).build())
            .build();
        session.setPlaybackState(st);
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

    private Notification build() {
        NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && nm != null && nm.getNotificationChannel(CHANNEL) == null) {
            NotificationChannel ch = new NotificationChannel(CHANNEL, "Ijro", NotificationManager.IMPORTANCE_LOW);
            ch.setDescription("Navo — hozir ijro etilayotgan qo'shiq");
            ch.setShowBadge(false);
            nm.createNotificationChannel(ch);
        }

        String sub = artist.isEmpty() ? "Navo" : artist;
        return new NotificationCompat.Builder(this, CHANNEL)
            .setSmallIcon(R.drawable.ic_stat_navo)
            .setLargeIcon(art != null ? art : placeholder())
            .setContentTitle(title)
            .setContentText(sub)
            .setSubText(album.isEmpty() ? null : album)
            .setContentIntent(session.getController().getSessionActivity())
            .setOngoing(playing)
            .setShowWhen(false)
            .setOnlyAlertOnce(true)
            .setSilent(true)
            .setColor(color)
            .setColorized(true)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setCategory(NotificationCompat.CATEGORY_TRANSPORT)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .addAction(fav ? R.drawable.ic_n_heart : R.drawable.ic_n_heart_o, fav ? "Sevimlilardan olish" : "Sevimlilarga", action(ACTION_FAV, 5))
            .addAction(R.drawable.ic_n_prev, "Oldingi", action(ACTION_PREV, 1))
            .addAction(playing ? R.drawable.ic_n_pause : R.drawable.ic_n_play, playing ? "Pauza" : "Ijro", action(ACTION_TOGGLE, 2))
            .addAction(R.drawable.ic_n_next, "Keyingi", action(ACTION_NEXT, 3))
            .addAction(R.drawable.ic_n_close, "Yopish", action(ACTION_CLOSE, 6))
            .setStyle(new androidx.media.app.NotificationCompat.MediaStyle()
                .setMediaSession(session.getSessionToken())
                .setShowActionsInCompactView(1, 2, 3)
                .setShowCancelButton(true)
                .setCancelButtonIntent(action(ACTION_STOP, 4)))
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
        if (session != null) { session.setActive(false); session.release(); }
        super.onDestroy();
    }
}
