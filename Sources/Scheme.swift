import Foundation
import WebKit

/// Serves the bundled web UI and the small JSON API under macdisplay://app/.
/// Because the page fetches "/api/stats" from this same scheme, the web code is
/// identical to the browser version (which talks to browser/server.py instead).
final class AppSchemeHandler: NSObject, WKURLSchemeHandler {
    private let root: URL
    private let stats: StatsProvider

    init(root: URL, stats: StatsProvider) {
        self.root = root.standardizedFileURL
        self.stats = stats
        super.init()
    }

    func webView(_ webView: WKWebView, start urlSchemeTask: WKURLSchemeTask) {
        guard let url = urlSchemeTask.request.url else {
            urlSchemeTask.didFailWithError(URLError(.badURL))
            return
        }
        var path = url.path
        if path.isEmpty || path == "/" { path = "/index.html" }

        if path == "/api/stats" {
            let items = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems ?? []
            let wanted = Int(items.first(where: { $0.name == "procs" })?.value ?? "0") ?? 0
            let withCores = items.contains(where: { $0.name == "cores" })
            if let body = stats.statsJSON(procs: min(max(wanted, 0), 12), cores: withCores) {
                respond(urlSchemeTask, url, 200, "application/json", body)
            } else {
                respond(urlSchemeTask, url, 503, "text/plain", Data("Starting".utf8))
            }
            return
        }
        if path == "/api/nowplaying" {
            respond(urlSchemeTask, url, 200, "application/json", stats.nowPlayingJSON())
            return
        }

        let file = root.appendingPathComponent(String(path.dropFirst())).standardizedFileURL
        guard file.path.hasPrefix(root.path + "/"), let data = try? Data(contentsOf: file) else {
            respond(urlSchemeTask, url, 404, "text/plain", Data("Not found".utf8))
            return
        }
        respond(urlSchemeTask, url, 200, mimeType(for: file.pathExtension), data)
    }

    func webView(_ webView: WKWebView, stop urlSchemeTask: WKURLSchemeTask) {
        // Every request is answered synchronously in start(), so there is nothing to cancel.
    }

    private func respond(_ task: WKURLSchemeTask, _ url: URL, _ status: Int, _ type: String, _ body: Data) {
        let textual = type.hasPrefix("text/") || type.contains("javascript") || type.contains("json")
        let headers = [
            "Content-Type": type + (textual ? "; charset=utf-8" : ""),
            "Content-Length": String(body.count),
            "Cache-Control": "no-store",
        ]
        guard let response = HTTPURLResponse(url: url, statusCode: status, httpVersion: "HTTP/1.1", headerFields: headers) else {
            task.didFailWithError(URLError(.unknown))
            return
        }
        task.didReceive(response)
        task.didReceive(body)
        task.didFinish()
    }

    private func mimeType(for ext: String) -> String {
        switch ext.lowercased() {
        case "html": return "text/html"
        case "css": return "text/css"
        case "js": return "application/javascript"
        case "json": return "application/json"
        case "svg": return "image/svg+xml"
        case "png": return "image/png"
        case "woff2": return "font/woff2"
        default: return "application/octet-stream"
        }
    }
}
