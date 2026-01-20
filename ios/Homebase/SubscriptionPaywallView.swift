  function openSubscriptionStoreView(fallbackProductId?: string) {
    const hasNative = Platform.OS === "ios" && !!SubscriptionPaywallModule?.present;
    setIapDebug(
      `open_native_paywall hasNative=${hasNative} platform=${Platform.OS} ownership=${Constants.appOwnership}`
    );

    if (hasNative) {
      try {
        SubscriptionPaywallModule.present();
        return;
      } catch (e: any) {
        console.log("HB native paywall present() error:", e);
        Alert.alert("Paywall error", "Unable to open the subscription screen.");
        return;
      }
    }

    // If native module isn't available, don't fail silently.
    Alert.alert(
      "Native paywall not available",
      "The SubscriptionStoreView module wasn't found in this build. This usually means the iOS native files weren't compiled into the target."
    );

    // Optional fallback (explicit) so the app is still usable during debugging.
    if (fallbackProductId) {
      startSubscription(fallbackProductId).catch(() => {});
    }
  }