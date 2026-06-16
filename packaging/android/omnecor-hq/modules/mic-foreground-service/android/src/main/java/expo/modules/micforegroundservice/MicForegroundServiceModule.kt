package expo.modules.micforegroundservice

import android.content.Intent
import android.os.Build
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class MicForegroundServiceModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("MicForegroundService")

    Function("startService") { title: String?, body: String? ->
      val ctx = appContext.reactContext
      if (ctx != null) {
        val intent = Intent(ctx, MicForegroundService::class.java).apply {
          putExtra(MicForegroundService.EXTRA_TITLE, title ?: "Omnecor")
          putExtra(MicForegroundService.EXTRA_BODY, body ?: "Listening")
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
          ctx.startForegroundService(intent)
        } else {
          ctx.startService(intent)
        }
      }
    }

    Function("stopService") {
      val ctx = appContext.reactContext
      if (ctx != null) {
        ctx.stopService(Intent(ctx, MicForegroundService::class.java))
      }
    }
  }
}
