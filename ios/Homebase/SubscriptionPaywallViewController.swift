import UIKit
import SwiftUI

@available(iOS 16.0, *)
class SubscriptionPaywallViewController: UIViewController {
  override func viewDidLoad() {
    super.viewDidLoad()

    let hosting = UIHostingController(rootView: SubscriptionPaywallView())
    addChild(hosting)
    hosting.view.translatesAutoresizingMaskIntoConstraints = false
    view.addSubview(hosting.view)

    NSLayoutConstraint.activate([
      hosting.view.topAnchor.constraint(equalTo: view.topAnchor),
      hosting.view.bottomAnchor.constraint(equalTo: view.bottomAnchor),
      hosting.view.leadingAnchor.constraint(equalTo: view.leadingAnchor),
      hosting.view.trailingAnchor.constraint(equalTo: view.trailingAnchor)
    ])

    hosting.didMove(toParent: self)
  }
}