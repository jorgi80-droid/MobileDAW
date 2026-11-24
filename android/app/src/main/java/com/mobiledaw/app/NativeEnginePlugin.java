package com.mobiledaw.app;

import android.os.Handler;
import android.os.HandlerThread;
import android.util.Base64;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import org.json.JSONArray;

// Bridge between the web app (js/engine/nativesink.js) and the C++ audio engine (native/ + src/main/cpp/bridge.cpp, Oboe output).
// Plugin calls run one after another on Capacitor's plugin thread, so commands reach the engine in the order the UI sent them.
// The UI never waits for the audio thread: commands are queued (lock-free) and the call returns at once. Position, meters and CPU
// come back as a "poll" event about 30 times per second while the native engine is the one playing.
@CapacitorPlugin(name = "NativeEngine")
public class NativeEnginePlugin extends Plugin {
    private static boolean loaded = false;
    static {
        try { System.loadLibrary("mobiledaw"); loaded = true; } catch (Throwable t) { loaded = false; }
    }

    static native String nStart(int sr);
    static native String nCmd(String text);
    static native void nSampleBegin(int id, int frames, boolean stereo);
    static native void nSampleData(int id, int ch, int at, byte[] data);
    static native boolean nSampleEnd(int id);
    static native boolean nActive(boolean on);
    static native boolean nPoll(double[] out);
    static native String nErrors();
    static native void nStats(double[] out, boolean reset);
    static native void nWatch(int[] pairs);
    static native int nDevOut(int k, float[] out, long[] key);

    private static final int NSTRIPS = 73;
    private final double[] snap = new double[7 + NSTRIPS * 2];   // bridge.cpp NSNAP
    private final float[] devBuf = new float[4096]; private final long[] devKey = new long[1];
    private volatile int nWatched = 0;

    // devices whose displays are open: list = [[strip, device], ...] (same as the worklet's 'watch')
    @PluginMethod
    public void watch(PluginCall call) {
        JSArray l = call.getArray("list"); int n = l == null ? 0 : Math.min(8, l.length());
        int[] p = new int[n * 2];
        try { for (int k = 0; k < n; k++) { JSONArray q = l.getJSONArray(k); p[k * 2] = q.getInt(0); p[k * 2 + 1] = q.getInt(1); } } catch (Exception e) { n = 0; p = new int[0]; }
        if (loaded) nWatch(p);
        nWatched = n;
        call.resolve();
    }
    private HandlerThread pollThread;
    private Handler poller;
    private volatile boolean polling = false;

    @PluginMethod
    public void start(PluginCall call) {
        if (!loaded) { call.reject("library not loaded"); return; }
        int sr = call.getInt("sr", 48000);
        String[] parts = nStart(sr).split(";", -1);
        JSObject o = new JSObject();
        o.put("sr", Integer.parseInt(parts[0]));
        o.put("inst", list(parts.length > 1 ? parts[1] : ""));
        o.put("dev", list(parts.length > 2 ? parts[2] : ""));
        call.resolve(o);
    }

    private static JSArray list(String csv) {
        JSArray a = new JSArray();
        for (String s : csv.split(",")) if (!s.isEmpty()) a.put(Integer.parseInt(s));
        return a;
    }

    @PluginMethod
    public void cmd(PluginCall call) {
        String err = loaded ? nCmd(call.getString("text", "")) : "library not loaded";
        JSObject o = new JSObject();
        o.put("errors", err);
        call.resolve(o);
    }

    @PluginMethod
    public void sampleBegin(PluginCall call) {
        nSampleBegin(call.getInt("id", -1), call.getInt("frames", 0), Boolean.TRUE.equals(call.getBoolean("stereo", false)));
        call.resolve();
    }

    @PluginMethod
    public void sampleData(PluginCall call) {
        byte[] bytes = Base64.decode(call.getString("data", ""), Base64.DEFAULT);
        nSampleData(call.getInt("id", -1), call.getInt("ch", 0), call.getInt("at", 0), bytes);
        call.resolve();
    }

    @PluginMethod
    public void sampleEnd(PluginCall call) {
        JSObject o = new JSObject();
        o.put("ok", nSampleEnd(call.getInt("id", -1)));
        call.resolve(o);
    }

    @PluginMethod
    public void setActive(PluginCall call) {
        boolean on = Boolean.TRUE.equals(call.getBoolean("on", false));
        boolean ok = loaded && nActive(on);
        if (on && ok) startPolling(); else stopPolling();
        JSObject o = new JSObject();
        o.put("ok", ok);
        call.resolve(o);
    }

    // CPU per audio block (percent of the block's time budget), underruns, buffer: for the Web vs Native measurement
    @PluginMethod
    public void stats(PluginCall call) {
        double[] s = new double[11];
        if (loaded) nStats(s, Boolean.TRUE.equals(call.getBoolean("reset", false)));
        JSObject o = new JSObject();
        o.put("blocks", s[0]); o.put("mean", s[1]); o.put("p50", s[2]); o.put("p99", s[3]); o.put("max", s[4]);
        o.put("xruns", s[5]); o.put("bad", s[6]); o.put("burst", s[7]); o.put("buffer", s[8]); o.put("sampleRate", s[9]); o.put("latencyMs", s[10]);
        call.resolve(o);
    }

    private void startPolling() {
        if (polling) return;
        polling = true;
        if (pollThread == null) { pollThread = new HandlerThread("daw-poll"); pollThread.start(); poller = new Handler(pollThread.getLooper()); }
        poller.post(new Runnable() {
            @Override
            public void run() {
                if (!polling) return;
                if (nPoll(snap)) {
                    JSObject o = new JSObject();
                    o.put("pos", snap[0]); o.put("playing", snap[1] != 0); o.put("cin", (int) snap[2]); o.put("cpu", (int) snap[3]);
                    o.put("xruns", (int) snap[4]); o.put("bad", (int) snap[5]);
                    JSArray m = new JSArray();
                    for (int i = 0; i < NSTRIPS * 2; i++) m.put((int) snap[6 + i]);
                    o.put("m", m); o.put("lat", (int) snap[6 + NSTRIPS * 2]);   // PDC: frames the output trails the song
                    if (nWatched > 0) {
                        JSObject dev = new JSObject();
                        for (int k = 0; k < nWatched; k++) {
                            int n = nDevOut(k, devBuf, devKey); if (n <= 0) continue;
                            JSArray a = new JSArray();
                            try { for (int i = 0; i < n; i++) { float f = devBuf[i]; a.put(Float.isFinite(f) ? (double) f : 0.0); } } catch (org.json.JSONException e) { continue; }   // put(double) only throws for NaN / Inf, filtered above
                            dev.put((devKey[0] >> 16) + "," + (devKey[0] & 0xffff), a);
                        }
                        o.put("dev", dev);
                    }
                    String err = nErrors();
                    if (!err.isEmpty()) o.put("errors", err);
                    notifyListeners("poll", o);
                }
                poller.postDelayed(this, 33);
            }
        });
    }

    private void stopPolling() { polling = false; }

    @Override
    protected void handleOnDestroy() { stopPolling(); if (loaded) nActive(false); if (pollThread != null) pollThread.quitSafely(); }
}
