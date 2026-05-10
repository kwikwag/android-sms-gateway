package me.capcom.smsgateway.ui.settings

import android.os.Bundle
import androidx.appcompat.app.AlertDialog
import androidx.preference.Preference
import androidx.preference.SwitchPreferenceCompat
import com.google.firebase.auth.FirebaseAuth
import me.capcom.smsgateway.R
import me.capcom.smsgateway.modules.firebaseagent.FirebaseSmsAgentService
import org.koin.android.ext.android.inject

class FirebaseAgentSettingsFragment : BasePreferenceFragment() {

    private val agentService: FirebaseSmsAgentService by inject()
    private val auth = FirebaseAuth.getInstance()

    private val authStateListener = FirebaseAuth.AuthStateListener { auth ->
        val uid = auth.currentUser?.uid
        findPreference<Preference>("firebaseagent.firebase_uid")?.summary =
            uid ?: "(not signed in — enable agent to sign in)"
    }

    override fun onCreatePreferences(savedInstanceState: Bundle?, rootKey: String?) {
        setPreferencesFromResource(R.xml.firebase_agent_preferences, rootKey)

        findPreference<SwitchPreferenceCompat>("firebaseagent.ENABLED")
            ?.setOnPreferenceChangeListener { _, newValue ->
                if (newValue == true) agentService.start()
                true
            }

        findPreference<Preference>("firebaseagent.rotate_uid")
            ?.setOnPreferenceClickListener {
                AlertDialog.Builder(requireContext())
                    .setTitle("Rotate UID")
                    .setMessage("This will sign out and generate a new anonymous UID. You must update firestore.rules with the new UID afterwards, or the agent will lose access to Firestore.\n\nContinue?")
                    .setPositiveButton("Rotate") { _, _ ->
                        agentService.stop()
                        auth.signOut()
                        auth.signInAnonymously()
                            .addOnSuccessListener { agentService.start() }
                    }
                    .setNegativeButton("Cancel", null)
                    .show()
                true
            }
    }

    override fun onResume() {
        super.onResume()
        FirebaseAuth.getInstance().addAuthStateListener(authStateListener)
    }

    override fun onPause() {
        super.onPause()
        FirebaseAuth.getInstance().removeAuthStateListener(authStateListener)
    }
}
