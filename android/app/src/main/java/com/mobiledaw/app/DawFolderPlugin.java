package com.mobiledaw.app;

import android.app.Activity;
import android.content.ContentResolver;
import android.content.Intent;
import android.content.UriPermission;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.provider.DocumentsContract;
import android.provider.DocumentsContract.Document;
import android.util.Base64;
import androidx.activity.result.ActivityResult;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.ByteArrayOutputStream;
import java.io.FileNotFoundException;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

// The MobileDAW folder on the phone's storage (Storage Access Framework). The person picks a folder once in the system picker; the app keeps
// read/write permission for it (persisted URI permission) and works inside it by path ("/Samples/kick.wav"), like the web version does with
// the File System Access API. js/safdir.js wraps these calls in FileSystemDirectoryHandle-like objects for js/storage.js.
// Reading big files does not go through here: the WebView fetches the content:// URI from `uri` directly (Capacitor.convertFileSrc).
@CapacitorPlugin(name = "DawFolder")
public class DawFolderPlugin extends Plugin {
    private static final String[] COLS = { Document.COLUMN_DOCUMENT_ID, Document.COLUMN_DISPLAY_NAME, Document.COLUMN_MIME_TYPE, Document.COLUMN_SIZE, Document.COLUMN_LAST_MODIFIED };
    private final Map<String, String> ids = new ConcurrentHashMap<>();   // tree + "|" + path -> document id

    private ContentResolver cr() { return getContext().getContentResolver(); }

    // ---- choose the folder
    @PluginMethod
    public void pick(PluginCall call) {
        Intent i = new Intent(Intent.ACTION_OPEN_DOCUMENT_TREE);
        i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION | Intent.FLAG_GRANT_PREFIX_URI_PERMISSION);
        if (Build.VERSION.SDK_INT >= 26) i.putExtra(DocumentsContract.EXTRA_INITIAL_URI, DocumentsContract.buildDocumentUri("com.android.externalstorage.documents", "primary:Documents"));
        startActivityForResult(call, i, "picked");
    }

    @ActivityCallback
    private void picked(PluginCall call, ActivityResult result) {
        if (call == null) return;
        Intent data = result.getData();
        if (result.getResultCode() != Activity.RESULT_OK || data == null || data.getData() == null) {
            JSObject o = new JSObject();
            o.put("cancelled", true);
            call.resolve(o);
            return;
        }
        Uri tree = data.getData();
        try {
            cr().takePersistableUriPermission(tree, Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
        } catch (SecurityException e) {
            call.reject("Izin folder tidak bisa disimpan: " + e.getMessage());
            return;
        }
        JSObject o = new JSObject();
        o.put("tree", tree.toString());
        o.put("name", displayName(tree, DocumentsContract.getTreeDocumentId(tree)));
        call.resolve(o);
    }

    // Permission still held (it survives restarts; it is lost when the folder is deleted or the person revokes it)
    @PluginMethod
    public void check(PluginCall call) {
        String t = call.getString("tree", "");
        boolean ok = false;
        for (UriPermission p : cr().getPersistedUriPermissions()) {
            if (p.getUri().toString().equals(t) && p.isReadPermission() && p.isWritePermission()) { ok = true; break; }
        }
        if (ok) {
            Uri tree = Uri.parse(t);
            ok = displayName(tree, DocumentsContract.getTreeDocumentId(tree)) != null;
        }
        JSObject o = new JSObject();
        o.put("granted", ok);
        call.resolve(o);
    }

    @PluginMethod
    public void release(PluginCall call) {
        String t = call.getString("tree", "");
        try { cr().releasePersistableUriPermission(Uri.parse(t), Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION); } catch (Exception ignored) { }
        ids.clear();
        call.resolve();
    }

    @PluginMethod
    public void reset(PluginCall call) { ids.clear(); call.resolve(); }

    // ---- folder content: one query per folder (DocumentFile.listFiles would cost one call per file)
    @PluginMethod
    public void list(PluginCall call) {
        retry(call, () -> {
            Uri tree = Uri.parse(call.getString("tree"));
            String path = call.getString("path", "");
            String id = resolve(tree, path, false, true);
            if (id == null) throw new FileNotFoundException(path);
            JSArray out = new JSArray();
            try (Cursor c = cr().query(DocumentsContract.buildChildDocumentsUriUsingTree(tree, id), COLS, null, null, null)) {
                while (c != null && c.moveToNext()) {
                    String cid = c.getString(0), name = c.getString(1);
                    if (name == null) continue;
                    ids.put(tree + "|" + join(path, name), cid);
                    out.put(entry(tree, cid, name, c.getString(2), c.isNull(3) ? 0 : c.getLong(3), c.isNull(4) ? 0 : c.getLong(4)));
                }
            }
            JSObject o = new JSObject();
            o.put("entries", out);
            call.resolve(o);
        });
    }

    @PluginMethod
    public void stat(PluginCall call) {
        retry(call, () -> {
            Uri tree = Uri.parse(call.getString("tree"));
            String path = call.getString("path", "");
            String id = resolve(tree, path, false, false);
            JSObject o = new JSObject();
            if (id == null) { o.put("exists", false); call.resolve(o); return; }
            try (Cursor c = cr().query(DocumentsContract.buildDocumentUriUsingTree(tree, id), COLS, null, null, null)) {
                if (c == null || !c.moveToFirst()) { o.put("exists", false); call.resolve(o); return; }
                o = entry(tree, id, c.getString(1), c.getString(2), c.isNull(3) ? 0 : c.getLong(3), c.isNull(4) ? 0 : c.getLong(4));
                o.put("exists", true);
            }
            call.resolve(o);
        });
    }

    @PluginMethod
    public void mkdir(PluginCall call) {
        retry(call, () -> {
            Uri tree = Uri.parse(call.getString("tree"));
            if (resolve(tree, call.getString("path", ""), true, true) == null) throw new FileNotFoundException(call.getString("path"));
            call.resolve();
        });
    }

    // data = base64; append = false truncates (the first piece of a file), true adds the next piece
    @PluginMethod
    public void write(PluginCall call) {
        retry(call, () -> {
            Uri tree = Uri.parse(call.getString("tree"));
            String path = call.getString("path", "");
            boolean append = Boolean.TRUE.equals(call.getBoolean("append", false));
            String id = resolve(tree, path, true, false);
            if (id == null) throw new FileNotFoundException(path);
            byte[] bytes = Base64.decode(call.getString("data", ""), Base64.DEFAULT);
            try (OutputStream os = cr().openOutputStream(DocumentsContract.buildDocumentUriUsingTree(tree, id), append ? "wa" : "wt")) {
                if (os == null) throw new FileNotFoundException(path);
                os.write(bytes);
            }
            call.resolve();
        });
    }

    // Fallback read (base64) for when the WebView cannot fetch the content:// URI itself
    @PluginMethod
    public void read(PluginCall call) {
        retry(call, () -> {
            Uri tree = Uri.parse(call.getString("tree"));
            String path = call.getString("path", "");
            String id = resolve(tree, path, false, false);
            if (id == null) throw new FileNotFoundException(path);
            ByteArrayOutputStream buf = new ByteArrayOutputStream();
            try (InputStream is = cr().openInputStream(DocumentsContract.buildDocumentUriUsingTree(tree, id))) {
                if (is == null) throw new FileNotFoundException(path);
                byte[] b = new byte[1 << 16];
                for (int n; (n = is.read(b)) > 0; ) buf.write(b, 0, n);
            }
            JSObject o = new JSObject();
            o.put("data", Base64.encodeToString(buf.toByteArray(), Base64.NO_WRAP));
            call.resolve(o);
        });
    }

    @PluginMethod
    public void remove(PluginCall call) {
        retry(call, () -> {
            Uri tree = Uri.parse(call.getString("tree"));
            String path = call.getString("path", "");
            String id = resolve(tree, path, false, false);
            if (id == null) throw new FileNotFoundException(path);
            DocumentsContract.deleteDocument(cr(), DocumentsContract.buildDocumentUriUsingTree(tree, id));
            String key = tree + "|" + norm(path);
            ids.keySet().removeIf((k) -> k.equals(key) || k.startsWith(key + "/"));
            call.resolve();
        });
    }

    // ---- helpers
    private interface Job { void run() throws Exception; }

    // A cached document id can go stale when the folder is changed from outside the app: forget the cache and try once more.
    private void retry(PluginCall call, Job job) {
        try { job.run(); return; } catch (Exception first) { ids.clear(); }
        try { job.run(); } catch (Exception e) {
            call.reject(e.getClass().getSimpleName() + ": " + e.getMessage(), e instanceof FileNotFoundException ? "NotFoundError" : "IOError");
        }
    }

    private static String norm(String path) {
        StringBuilder b = new StringBuilder();
        for (String p : path.split("/")) if (!p.isEmpty()) b.append('/').append(p);
        return b.toString();
    }
    private static String join(String dir, String name) { return norm(dir) + "/" + name; }

    // path ("/Samples/Drums/kick.wav") -> document id; with create, missing folders (and the file itself unless dir) are made
    private String resolve(Uri tree, String path, boolean create, boolean dir) throws Exception {
        String cur = DocumentsContract.getTreeDocumentId(tree), acc = "";
        String[] parts = norm(path).split("/");
        for (int k = 0; k < parts.length; k++) {
            String part = parts[k];
            if (part.isEmpty()) continue;
            acc = acc + "/" + part;
            String key = tree + "|" + acc, id = ids.get(key);
            if (id == null) id = findChild(tree, cur, acc.substring(0, acc.length() - part.length() - 1), part);
            if (id == null) {
                if (!create) return null;
                boolean last = k == parts.length - 1;
                Uri made = DocumentsContract.createDocument(cr(), DocumentsContract.buildDocumentUriUsingTree(tree, cur), last && !dir ? "application/octet-stream" : Document.MIME_TYPE_DIR, part);
                if (made == null) return null;
                id = DocumentsContract.getDocumentId(made);
                ids.put(key, id);
            }
            cur = id;
        }
        return cur;
    }

    private String findChild(Uri tree, String parentId, String parentPath, String name) {
        String found = null;
        try (Cursor c = cr().query(DocumentsContract.buildChildDocumentsUriUsingTree(tree, parentId), new String[] { Document.COLUMN_DOCUMENT_ID, Document.COLUMN_DISPLAY_NAME }, null, null, null)) {
            while (c != null && c.moveToNext()) {
                String cid = c.getString(0), n = c.getString(1);
                if (n == null) continue;
                ids.put(tree + "|" + join(parentPath, n), cid);
                if (n.equals(name)) found = cid;
            }
        }
        return found;
    }

    private String displayName(Uri tree, String id) {
        try (Cursor c = cr().query(DocumentsContract.buildDocumentUriUsingTree(tree, id), new String[] { Document.COLUMN_DISPLAY_NAME }, null, null, null)) {
            if (c != null && c.moveToFirst()) return c.getString(0);
        } catch (Exception ignored) { }
        return null;
    }

    private static JSObject entry(Uri tree, String id, String name, String mime, long size, long time) {
        JSObject o = new JSObject();
        o.put("name", name);
        o.put("dir", Document.MIME_TYPE_DIR.equals(mime));
        o.put("size", size);
        o.put("time", time);
        o.put("uri", DocumentsContract.buildDocumentUriUsingTree(tree, id).toString());
        return o;
    }
}
