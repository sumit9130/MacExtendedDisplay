import Cocoa

// MacDisplay: a live dashboard for a second display.
// The interface is the web UI in Resources/web, shown in a WKWebView; the app supplies
// the window, menus, system stats, location and settings storage.

let app = NSApplication.shared
let appDelegate = AppDelegate()
app.delegate = appDelegate
app.setActivationPolicy(.regular)
app.run()
