import SwiftUI
import StoreKit

@available(iOS 17.0, *)
struct SubscriptionPaywallView: View {
  // Apple subscription group ID
  private let groupID = "21875874"

  // Replace these with your real URLs
  private let privacyURL = URL(string: "https://www.thehomebaseapp.com/privacy-policy")!
  private let deleteAccountURL = URL(string: "https://www.thehomebaseapp.com/delete-account")!
  private let eulaURL = URL(string: "https://www.apple.com/legal/internet-services/itunes/dev/stdeula/")!

  var body: some View {
    VStack(spacing: 16) {
      Text("Homebase")
        .font(.title2)
        .bold()

      Text("Start your free trial")
        .font(.headline)

      Text("Get full access with a 3-day free trial. Cancel anytime in App Store settings.")
        .font(.subheadline)
        .foregroundStyle(.secondary)
        .multilineTextAlignment(.center)
        .padding(.horizontal, 24)

      // Apple’s native subscription UI (includes required price/renewal language)
      SubscriptionStoreView(groupID: groupID)
        .padding(.horizontal, 16)

      HStack(spacing: 14) {
        Button("Restore") {
          Task { try? await AppStore.sync() }
        }

        Link("Privacy", destination: privacyURL)
        Link("Delete account", destination: deleteAccountURL)
        Link("Terms", destination: eulaURL)
      }
      .font(.footnote)
      .foregroundStyle(.secondary)
      .padding(.top, 8)

      Spacer(minLength: 0)
    }
    .padding(.top, 24)
    .padding(.bottom, 16)
  }
}
