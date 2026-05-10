package me.capcom.smsgateway.modules.firebaseagent

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import androidx.core.content.ContextCompat
import com.google.firebase.Timestamp
import com.google.firebase.auth.FirebaseAuth
import com.google.firebase.firestore.FieldValue
import com.google.firebase.firestore.FirebaseFirestore
import me.capcom.smsgateway.domain.EntitySource
import me.capcom.smsgateway.domain.MessageContent
import me.capcom.smsgateway.modules.logs.LogsService
import me.capcom.smsgateway.modules.logs.db.LogEntry
import me.capcom.smsgateway.modules.messages.MessagesService
import me.capcom.smsgateway.modules.messages.data.Message
import me.capcom.smsgateway.modules.messages.data.SendParams
import me.capcom.smsgateway.modules.messages.data.SendRequest
import java.util.Date

class FirebaseSmsAgentService(
    private val context: Context,
    private val settings: FirebaseAgentSettings,
    private val messagesService: MessagesService,
    private val logsService: LogsService,
) {
    private val db = FirebaseFirestore.getInstance()
    private val auth = FirebaseAuth.getInstance()

    fun start() {
        if (!settings.enabled) return
        if (auth.currentUser == null) auth.signInAnonymously()
        db.collection("sms_jobs").whereEqualTo("status", "queued").limit(5)
            .addSnapshotListener { snap, err ->
                if (err != null || snap == null) return@addSnapshotListener
                snap.documents.forEach { doc -> claimAndSend(doc.id) }
            }
    }

    private fun claimAndSend(id: String) {
        val ref = db.collection("sms_jobs").document(id)
        db.runTransaction { tx ->
            val s = tx.get(ref)
            if (s.getString("status") != "queued") return@runTransaction false
            tx.update(ref, mapOf("status" to "claimed", "claimedBy" to settings.deviceId, "claimedAt" to FieldValue.serverTimestamp(), "attemptCount" to ((s.getLong("attemptCount")?:0)+1)))
            true
        }.addOnSuccessListener { claimed -> if (claimed == true) doSend(id) }
    }

    private fun doSend(id: String) {
        val ref = db.collection("sms_jobs").document(id)
        ref.get().addOnSuccessListener { doc ->
            if (ContextCompat.checkSelfPermission(context, Manifest.permission.SEND_SMS) != PackageManager.PERMISSION_GRANTED) {
                ref.update(mapOf("status" to "failed", "failedAt" to FieldValue.serverTimestamp(), "error" to "SEND_SMS permission missing")); return@addOnSuccessListener
            }
            val to = doc.getString("to") ?: return@addOnSuccessListener
            val body = doc.getString("body") ?: return@addOnSuccessListener
            val sim = doc.getLong("simSlot")?.toInt()
            try {
                messagesService.enqueueMessage(SendRequest(EntitySource.Local, Message(id, MessageContent.Text(body), listOf(to), false, Date()), SendParams(false, false, sim, null, null, null)))
                ref.update(mapOf("status" to "sent", "sentAt" to FieldValue.serverTimestamp(), "error" to null, "claimedBy" to settings.deviceId))
                db.collection("devices").document(settings.deviceId).set(mapOf("enabled" to true, "lastSeenAt" to Timestamp.now(), "model" to android.os.Build.MODEL, "appVersion" to "unknown"))
            } catch (e: Throwable) {
                logsService.insert(LogEntry.Priority.ERROR, "firebase-agent", "Failed to send firebase job", mapOf("error" to (e.message ?: "unknown")))
                ref.update(mapOf("status" to "failed", "failedAt" to FieldValue.serverTimestamp(), "error" to (e.message ?: "send failed")))
            }
        }
    }
}
