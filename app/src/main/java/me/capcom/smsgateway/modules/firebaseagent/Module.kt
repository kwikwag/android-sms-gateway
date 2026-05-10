package me.capcom.smsgateway.modules.firebaseagent

import me.capcom.smsgateway.modules.settings.PreferencesStorage
import org.koin.core.module.dsl.singleOf
import org.koin.dsl.module

val firebaseAgentModule = module {
    factory { FirebaseAgentSettings(PreferencesStorage(get(), "firebaseagent")) }
    singleOf(::FirebaseSmsAgentService)
}
