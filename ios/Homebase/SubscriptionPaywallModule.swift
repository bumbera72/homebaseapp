import Foundation
import UIKit

@objc(SubscriptionPaywallModule)
class SubscriptionPaywallModule: NSObject {

  @objc static func requiresMainQueueSetup() -> Bool { true }

  @objc func present() {
    DispatchQueue.main.async {
      guard #available(iOS 16.0, *) else { return }

      let vc = SubscriptionPaywallViewController()
      vc.modalPresentationStyle = .pageSheet

      let root = UIApplication.shared.connectedScenes
        .compactMap { $0 as? UIWindowScene }
        .flatMap { $0.windows }
        .first { $0.isKeyWindow }?
        .rootViewController

      root?.present(vc, animated: true)
    }
  }
}