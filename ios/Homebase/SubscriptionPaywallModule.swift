import Foundation
import UIKit

@objc(SubscriptionPaywallModule)
class SubscriptionPaywallModule: NSObject {

  @objc static func requiresMainQueueSetup() -> Bool { false }

  @objc(present) func present() {
    DispatchQueue.main.async {
      guard #available(iOS 17.0, *) else { return }

      let vc = SubscriptionPaywallViewController()
      vc.modalPresentationStyle = .pageSheet

      let root = UIApplication.shared.connectedScenes
        .compactMap { $0 as? UIWindowScene }
        .flatMap { $0.windows }
        .first { $0.isKeyWindow }?
        .rootViewController

      var top = root
      while let presented = top?.presentedViewController {
        top = presented
      }

      top?.present(vc, animated: true)
    }
  }
}
