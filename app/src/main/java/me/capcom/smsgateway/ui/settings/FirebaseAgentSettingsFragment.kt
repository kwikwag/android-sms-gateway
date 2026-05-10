package me.capcom.smsgateway.ui.settings

import android.os.Bundle
import me.capcom.smsgateway.R

class FirebaseAgentSettingsFragment : BasePreferenceFragment() {
    override fun onCreatePreferences(savedInstanceState: Bundle?, rootKey: String?) {
        setPreferencesFromResource(R.xml.firebase_agent_preferences, rootKey)
    }
}
