import SwiftUI
import WebKit

private let kokAppURL = URL(string: "https://kok-meet.vercel.app")!
private let kokPrivacyURL = URL(string: "https://kok-meet.vercel.app/privacy.html")!
private let kokSupportURL = URL(string: "https://kok-meet.vercel.app/support.html")!
private let kokAllowedHosts = Set(["kok-meet.vercel.app", "kok-choim2013-3130s-projects.vercel.app"])

private func isKoKURL(_ url: URL) -> Bool {
    guard url.scheme == "https", let host = url.host?.lowercased() else {
        return false
    }

    return kokAllowedHosts.contains(host)
}

private func normalizeKoKAppURL(_ url: URL) -> URL? {
    guard isKoKURL(url), var components = URLComponents(url: url, resolvingAgainstBaseURL: false) else {
        return nil
    }

    if components.path == "/invite" {
        components.path = "/"
    }

    return components.url
}

final class WebViewModel: ObservableObject {
    @Published var currentURL: URL = kokAppURL
    @Published var errorMessage: String?
    @Published var isLoading = false
    @Published var progress = 0.0
    @Published var canGoBack = false

    weak var webView: WKWebView?

    func reload() {
        errorMessage = nil

        if let webView {
            if webView.url == nil {
                webView.load(URLRequest(url: kokAppURL))
            } else {
                webView.reload()
            }
        }
    }

    func goBack() {
        guard webView?.canGoBack == true else {
            return
        }

        webView?.goBack()
    }

    func load(_ url: URL) {
        errorMessage = nil
        currentURL = url
        webView?.load(URLRequest(url: url, cachePolicy: .returnCacheDataElseLoad, timeoutInterval: 30))
    }

    func loadUniversalLink(_ url: URL) {
        guard let appURL = normalizeKoKAppURL(url) else {
            return
        }

        load(appURL)
    }
}

struct WebShellView: View {
    @StateObject private var model = WebViewModel()

    var body: some View {
        ZStack(alignment: .top) {
            Color(red: 0.973, green: 0.984, blue: 0.969)
                .ignoresSafeArea()

            KoKWebView(model: model)

            if model.isLoading {
                ProgressView(value: model.progress)
                    .progressViewStyle(.linear)
                    .tint(Color("AccentColor"))
            }

            if let errorMessage = model.errorMessage {
                VStack(spacing: 16) {
                    Image(systemName: "wifi.exclamationmark")
                        .font(.system(size: 36, weight: .semibold))
                        .foregroundStyle(Color("AccentColor"))

                    Text("연결을 확인해 주세요")
                        .font(.headline)

                    Text(errorMessage)
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                        .multilineTextAlignment(.center)

                    Button {
                        model.reload()
                    } label: {
                        Label("다시 시도", systemImage: "arrow.clockwise")
                    }
                    .buttonStyle(.borderedProminent)
                    .tint(Color("AccentColor"))
                }
                .padding(24)
                .frame(maxWidth: 320)
                .background(.regularMaterial)
                .clipShape(RoundedRectangle(cornerRadius: 24, style: .continuous))
                .padding()
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        .overlay(alignment: .bottomTrailing) {
            HStack(spacing: 10) {
                if model.canGoBack {
                    Button {
                        model.goBack()
                    } label: {
                        Image(systemName: "chevron.backward")
                    }
                    .accessibilityLabel("뒤로 가기")
                }

                Button {
                    model.reload()
                } label: {
                    Image(systemName: "arrow.clockwise")
                }
                .accessibilityLabel("새로고침")

                ShareLink(item: model.currentURL) {
                    Image(systemName: "square.and.arrow.up")
                }
                .accessibilityLabel("공유")

                Menu {
                    Button {
                        model.load(kokPrivacyURL)
                    } label: {
                        Label("개인정보처리방침", systemImage: "lock.shield")
                    }

                    Button {
                        model.load(kokSupportURL)
                    } label: {
                        Label("지원", systemImage: "questionmark.circle")
                    }
                } label: {
                    Image(systemName: "ellipsis.circle")
                }
                .accessibilityLabel("앱 정보")
            }
            .font(.system(size: 16, weight: .semibold))
            .foregroundStyle(Color("AccentColor"))
            .padding(.horizontal, 14)
            .padding(.vertical, 12)
            .background(.ultraThinMaterial)
            .clipShape(Capsule())
            .shadow(color: .black.opacity(0.12), radius: 16, x: 0, y: 8)
            .padding(.trailing, 14)
            .padding(.bottom, 14)
        }
        .onContinueUserActivity(NSUserActivityTypeBrowsingWeb) { activity in
            guard let url = activity.webpageURL else {
                return
            }

            model.loadUniversalLink(url)
        }
        .onOpenURL { url in
            model.loadUniversalLink(url)
        }
    }
}

struct KoKWebView: UIViewRepresentable {
    @ObservedObject var model: WebViewModel

    func makeCoordinator() -> Coordinator {
        Coordinator(model: model)
    }

    func makeUIView(context: Context) -> WKWebView {
        let configuration = WKWebViewConfiguration()
        configuration.applicationNameForUserAgent = "KoK-iOS"
        configuration.defaultWebpagePreferences.allowsContentJavaScript = true
        configuration.allowsInlineMediaPlayback = true
        configuration.websiteDataStore = .default()

        let webView = WKWebView(frame: .zero, configuration: configuration)
        webView.allowsBackForwardNavigationGestures = true
        webView.navigationDelegate = context.coordinator
        webView.uiDelegate = context.coordinator
        webView.scrollView.contentInsetAdjustmentBehavior = .never

        model.webView = webView
        context.coordinator.attach(webView)
        webView.load(URLRequest(url: kokAppURL, cachePolicy: .returnCacheDataElseLoad, timeoutInterval: 30))

        return webView
    }

    func updateUIView(_ webView: WKWebView, context: Context) {
        model.webView = webView
    }

    final class Coordinator: NSObject, WKNavigationDelegate, WKUIDelegate {
        private let model: WebViewModel
        private var progressObservation: NSKeyValueObservation?

        init(model: WebViewModel) {
            self.model = model
        }

        func attach(_ webView: WKWebView) {
            progressObservation = webView.observe(\.estimatedProgress, options: [.new]) { [weak self] webView, _ in
                DispatchQueue.main.async {
                    self?.model.progress = webView.estimatedProgress
                }
            }
        }

        func webView(_ webView: WKWebView, didStartProvisionalNavigation navigation: WKNavigation!) {
            model.isLoading = true
            model.errorMessage = nil
            model.canGoBack = webView.canGoBack
        }

        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
            model.isLoading = false
            model.currentURL = webView.url ?? kokAppURL
            model.canGoBack = webView.canGoBack
        }

        func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
            handle(error)
        }

        func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
            handle(error)
        }

        func webView(
            _ webView: WKWebView,
            decidePolicyFor navigationAction: WKNavigationAction,
            decisionHandler: @escaping (WKNavigationActionPolicy) -> Void
        ) {
            guard let url = navigationAction.request.url else {
                decisionHandler(.allow)
                return
            }

            if isKoKURL(url) {
                decisionHandler(.allow)
                return
            }

            if navigationAction.navigationType == .linkActivated || navigationAction.targetFrame == nil {
                UIApplication.shared.open(url)
                decisionHandler(.cancel)
                return
            }

            decisionHandler(.allow)
        }

        func webView(
            _ webView: WKWebView,
            createWebViewWith configuration: WKWebViewConfiguration,
            for navigationAction: WKNavigationAction,
            windowFeatures: WKWindowFeatures
        ) -> WKWebView? {
            if let url = navigationAction.request.url, isKoKURL(url) {
                webView.load(navigationAction.request)
            } else if let url = navigationAction.request.url {
                UIApplication.shared.open(url)
            }

            return nil
        }

        private func handle(_ error: Error) {
            let nsError = error as NSError

            if nsError.domain == NSURLErrorDomain && nsError.code == NSURLErrorCancelled {
                return
            }

            model.isLoading = false
            model.errorMessage = error.localizedDescription
        }

    }
}
