package me.capcom.smsgateway.modules.firebaseagent

import com.aventrix.jnanoid.jnanoid.NanoIdUtils
import me.capcom.smsgateway.modules.settings.KeyValueStorage
import me.capcom.smsgateway.modules.settings.get

class FirebaseAgentSettings(private val storage: KeyValueStorage) {
    var enabled: Boolean
        get() = storage.get<Boolean>("ENABLED") ?: false
        set(value) = storage.set("ENABLED", value)

    var deviceId: String
        get() = storage.get<String>("DEVICE_ID") ?: NanoIdUtils.randomNanoId().also { storage.set("DEVICE_ID", it) }
        set(value) = storage.set("DEVICE_ID", value)
}
