package uz.navo.player;

import android.app.Activity;
import android.content.ContentResolver;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.provider.DocumentsContract;
import androidx.activity.result.ActivityResult;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.Arrays;
import java.util.HashSet;
import java.util.Locale;
import java.util.Set;

/**
 * Watched music folders on Android: the user picks a folder once (Storage Access
 * Framework, permission kept across restarts), Navo lists the audio files in it and
 * copies new ones into the app's cache so the web layer can import them.
 */
@CapacitorPlugin(name = "NavoFolders")
public class NavoFoldersPlugin extends Plugin {

    private static final Set<String> AUDIO = new HashSet<>(Arrays.asList(
        "mp3", "flac", "wav", "ogg", "oga", "opus", "m4a", "mp4", "aac", "webm", "weba", "wma", "ape", "wv",
        "aiff", "aif", "aifc", "amr", "awb", "3gp", "mka", "ac3", "m4b", "caf", "mp2", "mpga", "alac"));

    @PluginMethod
    public void pick(PluginCall call) {
        Intent i = new Intent(Intent.ACTION_OPEN_DOCUMENT_TREE);
        i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION);
        startActivityForResult(call, i, "picked");
    }

    @ActivityCallback
    private void picked(PluginCall call, ActivityResult result) {
        if (call == null) return;
        if (result.getResultCode() != Activity.RESULT_OK || result.getData() == null || result.getData().getData() == null) {
            call.resolve(new JSObject());   // cancelled
            return;
        }
        Uri tree = result.getData().getData();
        try {
            getContext().getContentResolver().takePersistableUriPermission(tree, Intent.FLAG_GRANT_READ_URI_PERMISSION);
        } catch (Exception ignored) {}
        JSObject o = new JSObject();
        o.put("uri", tree.toString());
        o.put("name", displayName(tree));
        call.resolve(o);
    }

    private String displayName(Uri tree) {
        String id = DocumentsContract.getTreeDocumentId(tree);
        Uri doc = DocumentsContract.buildDocumentUriUsingTree(tree, id);
        try (Cursor c = getContext().getContentResolver().query(doc,
                new String[] { DocumentsContract.Document.COLUMN_DISPLAY_NAME }, null, null, null)) {
            if (c != null && c.moveToFirst()) return c.getString(0);
        } catch (Exception ignored) {}
        int colon = id.lastIndexOf(':');
        return colon >= 0 && colon < id.length() - 1 ? id.substring(colon + 1) : id;
    }

    /** Lists every audio file under the folder (sub-folders included). */
    @PluginMethod
    public void scan(PluginCall call) {
        String s = call.getString("uri");
        if (s == null) { call.reject("no uri"); return; }
        Uri tree = Uri.parse(s);
        JSArray files = new JSArray();
        try {
            walk(getContext().getContentResolver(), tree, DocumentsContract.getTreeDocumentId(tree), files, 0);
        } catch (SecurityException e) {
            call.reject("denied");   // permission was revoked: the user has to pick the folder again
            return;
        } catch (Exception e) {
            call.reject("failed");
            return;
        }
        JSObject o = new JSObject();
        o.put("files", files);
        call.resolve(o);
    }

    private void walk(ContentResolver cr, Uri tree, String parentId, JSArray out, int depth) {
        if (depth > 8 || out.length() > 20000) return;
        Uri kids = DocumentsContract.buildChildDocumentsUriUsingTree(tree, parentId);
        String[] cols = {
            DocumentsContract.Document.COLUMN_DOCUMENT_ID, DocumentsContract.Document.COLUMN_DISPLAY_NAME,
            DocumentsContract.Document.COLUMN_MIME_TYPE, DocumentsContract.Document.COLUMN_SIZE,
            DocumentsContract.Document.COLUMN_LAST_MODIFIED };
        try (Cursor c = cr.query(kids, cols, null, null, null)) {
            if (c == null) return;
            while (c.moveToNext()) {
                String id = c.getString(0), name = c.getString(1), mime = c.getString(2);
                if (name == null || name.startsWith(".")) continue;
                if (DocumentsContract.Document.MIME_TYPE_DIR.equals(mime)) { walk(cr, tree, id, out, depth + 1); continue; }
                int dot = name.lastIndexOf('.');
                String ext = dot >= 0 ? name.substring(dot + 1).toLowerCase(Locale.ROOT) : "";
                if (!AUDIO.contains(ext) && (mime == null || !mime.startsWith("audio/"))) continue;
                long size = c.isNull(3) ? 0 : c.getLong(3);
                if (size <= 0) continue;   // still being copied
                JSObject f = new JSObject();
                f.put("uri", DocumentsContract.buildDocumentUriUsingTree(tree, id).toString());
                f.put("name", name);
                f.put("size", size);
                f.put("modified", c.isNull(4) ? 0 : c.getLong(4));
                f.put("mime", mime);
                out.put(f);
            }
        }
    }

    /** Copies one document into the cache so the WebView can read it as a local file. */
    @PluginMethod
    public void copy(PluginCall call) {
        String s = call.getString("uri");
        if (s == null) { call.reject("no uri"); return; }
        File dir = new File(getContext().getCacheDir(), "watch-import");
        //noinspection ResultOfMethodCallIgnored
        dir.mkdirs();
        File out = new File(dir, "f" + Integer.toHexString(s.hashCode()) + ".bin");
        try (InputStream in = getContext().getContentResolver().openInputStream(Uri.parse(s));
             OutputStream os = new FileOutputStream(out)) {
            if (in == null) throw new Exception("no stream");
            byte[] buf = new byte[1 << 16];
            int n;
            while ((n = in.read(buf)) > 0) os.write(buf, 0, n);
        } catch (Exception e) {
            //noinspection ResultOfMethodCallIgnored
            out.delete();
            call.reject("copy failed");
            return;
        }
        JSObject o = new JSObject();
        o.put("path", out.getAbsolutePath());
        call.resolve(o);
    }

    @PluginMethod
    public void clear(PluginCall call) {
        File dir = new File(getContext().getCacheDir(), "watch-import");
        File[] list = dir.listFiles();
        if (list != null) for (File f : list) {
            //noinspection ResultOfMethodCallIgnored
            f.delete();
        }
        call.resolve();
    }

    @PluginMethod
    public void release(PluginCall call) {
        String s = call.getString("uri");
        if (s != null) {
            try {
                getContext().getContentResolver().releasePersistableUriPermission(Uri.parse(s), Intent.FLAG_GRANT_READ_URI_PERMISSION);
            } catch (Exception ignored) {}
        }
        call.resolve();
    }
}
