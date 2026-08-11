# Orderak ProGuard/R8 rules (Stage 6 hardens further)
-keepattributes *Annotation*
-keepclassmembers class kotlinx.serialization.json.** { *; }
-keep,includedescriptorclasses class app.orderak.seller.**$$serializer { *; }
-keepclassmembers class app.orderak.seller.** { *** Companion; }

