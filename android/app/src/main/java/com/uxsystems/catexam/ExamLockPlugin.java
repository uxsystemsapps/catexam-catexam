package com.uxsystems.catexam;

import android.app.Activity;
import android.view.WindowManager;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Exam lock of the Android app (the desktop app's lockdown, as far as Android allows an ordinary app):
 * screen pinning (Android asks the candidate to confirm it), no screenshots or screen recording, and the
 * screen stays on. Called from src/mobile/main.ts when the NDA screen opens and when the exam ends.
 */
@CapacitorPlugin(name = "ExamLock")
public class ExamLockPlugin extends Plugin {

    private static final int FLAGS = WindowManager.LayoutParams.FLAG_SECURE | WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON;

    @PluginMethod
    public void lock(PluginCall call) {
        Activity activity = getActivity();
        activity.runOnUiThread(() -> {
            activity.getWindow().addFlags(FLAGS);
            try {
                activity.startLockTask();
            } catch (IllegalStateException | SecurityException e) {
                // Pinning refused by the device policy: the exam still runs, and leaving the app is recorded.
            }
            call.resolve();
        });
    }

    @PluginMethod
    public void unlock(PluginCall call) {
        Activity activity = getActivity();
        activity.runOnUiThread(() -> {
            activity.getWindow().clearFlags(FLAGS);
            try {
                activity.stopLockTask();
            } catch (IllegalStateException | SecurityException e) {
                // Not pinned (the candidate declined, or unpinned it): nothing to undo.
            }
            call.resolve();
        });
    }
}
