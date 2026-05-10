package me.capcom.smsgateway.modules.firebaseagent

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import androidx.core.content.ContextCompat
import com.google.firebase.Timestamp
import com.google.firebase.auth.FirebaseAuth
import com.google.firebase.firestore.FieldValue
import com.google.firebase.firestore.FirebaseFirestore
import com.google.firebase.firestore.ListenerRegistration
import me.capcom.smsgateway.domain.EntitySource
import me.capcom.smsgateway.domain.MessageContent
import me.capcom.smsgateway.domain.ProcessingState
import me.capcom.smsgateway.modules.events.EventBus
import me.capcom.smsgateway.modules.logs.LogsService
import me.capcom.smsgateway.modules.logs.db.LogEntry
import me.capcom.smsgateway.modules.messages.MessagesService
import me.capcom.smsgateway.modules.messages.data.Message
import me.capcom.smsgateway.modules.messages.data.SendParams
import me.capcom.smsgateway.modules.messages.data.SendRequest
import me.capcom.smsgateway.modules.messages.events.MessageStateChangedEvent
import android.util.Log
import java.util.Date
import java.util.concurrent.ConcurrentHashMap

class FirebaseSmsAgentService(
    private val context: Context,
    private val settings: FirebaseAgentSettings,
    private val messagesService: MessagesService,
    private val logsService: LogsService,
) {
    private val db = FirebaseFirestore.getInstance()
    private val auth = FirebaseAuth.getInstance()

    // Track Firestore doc IDs enqueued by this service so EventBus updates are scoped correctly.
    private val activeJobIds: MutableSet<String> = ConcurrentHashMap.newKeySet()

    private var listenerRegistration: ListenerRegistration? = null
    private val eventsReceiver = JobStateReceiver()

    fun start() {
        if (!settings.enabled) return
        if (auth.currentUser == null) {
            auth.signInAnonymously()
                .addOnSuccessListener { Log.i(TAG, "Signed in anonymously: ${it.user?.uid}") }
                .addOnFailureListener { Log.e(TAG, "Anonymous sign-in failed", it) }
        } else {
            Log.i(TAG, "Already signed in: ${auth.currentUser?.uid}")
        }

        if (listenerRegistration != null) return  // already started

        eventsReceiver.start()

        listenerRegistration = db.collection("sms_jobs")
            .whereEqualTo("status", "queued")
            .limit(5)
            .addSnapshotListener { snap, err ->
                if (err != null) {
                    Log.e(TAG, "Firestore listener error: ${err.code} ${err.message}")
                    return@addSnapshotListener
                }
                if (snap == null) return@addSnapshotListener
                Log.d(TAG, "Snapshot received: ${snap.size()} queued job(s)")
                snap.documents.forEach { doc -> claimAndSend(doc.id) }
            }
    }

    fun stop() {
        listenerRegistration?.remove()
        listenerRegistration = null
        eventsReceiver.stop()
    }

    private fun claimAndSend(id: String) {
        val ref = db.collection("sms_jobs").document(id)
        db.runTransaction { tx ->
            val s = tx.get(ref)
            if (s.getString("status") != "queued") return@runTransaction null
            val expiresAt = s.getTimestamp("expiresAt")
            if (expiresAt != null && expiresAt.toDate().before(Date())) {
                tx.update(ref, mapOf("status" to "failed", "error" to "expired"))
                return@runTransaction null
            }
            tx.update(ref, mapOf(
                "status" to "claimed",
                "claimedBy" to settings.deviceId,
                "claimedAt" to FieldValue.serverTimestamp(),
                "attemptCount" to ((s.getLong("attemptCount") ?: 0) + 1)
            ))
            // Return the fields needed for sending so doSend() doesn't re-fetch.
            Triple(
                s.getString("to") ?: "",
                s.getString("body") ?: "",
                s.getLong("simSlot")?.toInt()
            )
        }.addOnSuccessListener { job -> if (job != null) doSend(id, job.first, job.second, job.third) }
    }

    private fun doSend(id: String, to: String, body: String, simSlot: Int?) {
        val ref = db.collection("sms_jobs").document(id)
        if (ContextCompat.checkSelfPermission(context, Manifest.permission.SEND_SMS) != PackageManager.PERMISSION_GRANTED) {
            ref.update(mapOf(
                "status" to "failed",
                "failedAt" to FieldValue.serverTimestamp(),
                "error" to "SEND_SMS permission missing"
            ))
            return
        }
        if (to.isEmpty() || body.isEmpty()) {
            ref.update(mapOf("status" to "failed", "failedAt" to FieldValue.serverTimestamp(), "error" to "missing to/body"))
            return
        }
        // simSlot in Firestore is 0-based; SendParams.simNumber is 1-based.
        val simNumber = simSlot?.plus(1)
            try {
            activeJobIds.add(id)
            messagesService.enqueueMessage(
                SendRequest(
                    EntitySource.Local,
                    Message(id, MessageContent.Text(body), listOf(to), false, Date()),
                    SendParams(false, false, simNumber, null, null, null)
                )
            )
            db.collection("devices").document(settings.deviceId)
                .set(mapOf(
                    "enabled" to true,
                    "lastSeenAt" to Timestamp.now(),
                    "model" to android.os.Build.MODEL,
                    "appVersion" to me.capcom.smsgateway.BuildConfig.VERSION_NAME
                ))
        } catch (e: Throwable) {
            activeJobIds.remove(id)
            logsService.insert(LogEntry.Priority.ERROR, "firebase-agent", "Failed to enqueue firebase job", mapOf("error" to (e.message ?: "unknown")))
            ref.update(mapOf(
                "status" to "failed",
                "failedAt" to FieldValue.serverTimestamp(),
                "error" to (e.message ?: "send failed")
            ))
        }
    }

    companion object {
        private const val TAG = "firebase-agent"
    }

    // Listens on the EventBus and updates Firestore when a job reaches a terminal state.
    private inner class JobStateReceiver : me.capcom.smsgateway.modules.events.EventsReceiver() {
        override suspend fun collect(eventBus: EventBus) {
            eventBus.collect<MessageStateChangedEvent> handler@{ event ->
                if (!activeJobIds.contains(event.id)) return@handler
                val ref = db.collection("sms_jobs").document(event.id)
                when (event.state) {
                    ProcessingState.Sent -> {
                        activeJobIds.remove(event.id)
                        ref.update(mapOf(
                            "status" to "sent",
                            "sentAt" to FieldValue.serverTimestamp(),
                            "error" to null
                        ))
                    }
                    ProcessingState.Failed -> {
                        activeJobIds.remove(event.id)
                        ref.update(mapOf(
                            "status" to "failed",
                            "failedAt" to FieldValue.serverTimestamp(),
                            "error" to (event.error ?: "send failed")
                        ))
                    }
                    else -> {}
                }
            }
        }
    }
}
