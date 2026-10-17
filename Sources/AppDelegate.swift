import Cocoa
import WebKit
import ServiceManagement
import IOKit.pwr_mgt

final class AppDelegate: NSObject, NSApplicationDelegate, NSWindowDelegate, NSMenuDelegate, WKScriptMessageHandler {
    private var window: NSWindow!
    private var web: WKWebView!
    private var schemeHandler: AppSchemeHandler!
    private let stats = StatsProvider()
    private let location = LocationService()

    /// Settings, mirrored from the page ("theme", "layout", ...) plus a few native keys
    /// ("screenID", "fullscreen", "keepAwake"). Saved in UserDefaults.
    private var store: [String: String] = [:]
    private var awakeAssertion: IOPMAssertionID = 0
    private var afterExitFullScreen: (() -> Void)?
    private var isTransitioning = false          // a full-screen animation is running
    private var transitionToken = 0              // lets a stale safety timer be ignored
    private var quietUntil = Date.distantPast    // while in the future, display changes are ours or the system's, not the user's choice
    private var reconcileWork: DispatchWorkItem?

    private let layouts: [(id: String, name: String)] = [
        ("dashboard", "Dashboard"), ("clock", "Big Clock"), ("analog", "Analog + Calendar"),
        ("monitor", "System Monitor"), ("focus", "Focus Timer"), ("world", "World Clocks"), ("ambient", "Ambient"),
    ]
    private let themes: [(id: String, name: String)] = [
        ("neon", "Neon Night"), ("aurora", "Aurora"), ("synth", "Synthwave"), ("terminal", "Terminal"),
        ("cosmos", "Cosmos"), ("ocean", "Deep Ocean"), ("sakura", "Sakura"), ("embers", "Embers"),
        ("rain", "Rainfall"), ("snow", "Midnight Snow"), ("mono", "Mono"), ("paper", "Paper"),
    ]
    private let animations: [(id: String, name: String)] = [
        ("smooth", "Smooth"), ("eco", "Eco (fewer frames)"), ("off", "Still (no animation)"),
    ]
    private let options: [(id: String, name: String)] = [
        ("h24", "24-Hour Clock"), ("sec", "Show Seconds"), ("scan", "Scanlines"), ("unit", "Temperature in °F"),
    ]

    // MARK: Launch

    func applicationDidFinishLaunching(_ notification: Notification) {
        store = (UserDefaults.standard.dictionary(forKey: "store") as? [String: String]) ?? [:]
        stats.start()
        buildMenus()
        buildWindow()
        setAwake(flag("keepAwake", default: true))
        NSApp.activate(ignoringOtherApps: true)

        // Follow displays being plugged in / unplugged and the Mac or its displays waking up.
        NotificationCenter.default.addObserver(self, selector: #selector(displaysChanged(_:)),
                                               name: NSApplication.didChangeScreenParametersNotification, object: nil)
        let workspace = NSWorkspace.shared.notificationCenter
        workspace.addObserver(self, selector: #selector(systemWoke(_:)), name: NSWorkspace.didWakeNotification, object: nil)
        workspace.addObserver(self, selector: #selector(systemWoke(_:)), name: NSWorkspace.screensDidWakeNotification, object: nil)
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }

    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        window?.makeKeyAndOrderFront(nil)
        return true
    }

    // MARK: Settings storage

    private func flag(_ key: String, default value: Bool) -> Bool {
        if let v = store[key] { return v == "1" }
        return value
    }

    private func setStore(_ key: String, _ value: String) {
        store[key] = value
        UserDefaults.standard.set(store, forKey: "store")
    }

    // MARK: Window

    /// A stable id for a physical display: vendor, model and serial number, plus the unit number
    /// when the monitor reports no serial, so two identical monitors are told apart.
    private func displayID(_ screen: NSScreen) -> String {
        guard let number = screen.deviceDescription[NSDeviceDescriptionKey("NSScreenNumber")] as? NSNumber else {
            return screen.localizedName
        }
        let id = CGDirectDisplayID(number.uint32Value)
        let vendor = CGDisplayVendorNumber(id)
        let model = CGDisplayModelNumber(id)
        let serial = CGDisplaySerialNumber(id)
        if serial != 0 { return "\(vendor)-\(model)-\(serial)" }
        return "\(vendor)-\(model)-0-\(CGDisplayUnitNumber(id))"
    }

    /// The display the user wants MacDisplay on, if it is connected right now.
    private func storedScreen() -> NSScreen? {
        let screens = NSScreen.screens
        if let id = store["screenID"] {
            return screens.first(where: { displayID($0) == id })     // nil = chosen display is not connected
        }
        if let name = store["screenName"], let match = screens.first(where: { $0.localizedName == name }) { return match }
        // First run: screens[0] has the menu bar, so prefer the other display when there is one.
        return screens.count > 1 ? screens[1] : nil
    }

    private func chooseScreen() -> NSScreen {
        if let s = storedScreen() { return s }
        return NSScreen.screens.count > 1 ? NSScreen.screens[1] : NSScreen.screens[0]
    }

    private func windowFrame(on screen: NSScreen) -> NSRect {
        let vf = screen.visibleFrame
        let w = min(1280, vf.width * 0.85)
        let h = min(800, vf.height * 0.85)
        return NSRect(x: vf.midX - w / 2, y: vf.midY - h / 2, width: w, height: h)
    }

    private func buildWindow() {
        let webRoot = (Bundle.main.resourceURL ?? URL(fileURLWithPath: ".")).appendingPathComponent("web")
        schemeHandler = AppSchemeHandler(root: webRoot, stats: stats)

        let config = WKWebViewConfiguration()
        config.setURLSchemeHandler(schemeHandler, forURLScheme: "macdisplay")
        let controller = WKUserContentController()
        controller.add(self, name: "native")
        let storeJSON = jsonString(store)
        controller.addUserScript(WKUserScript(source: "window.__MD_STORE = \(storeJSON);",
                                              injectionTime: .atDocumentStart, forMainFrameOnly: true))
        config.userContentController = controller

        web = WKWebView(frame: .zero, configuration: config)
        web.underPageBackgroundColor = .black

        let screen = chooseScreen()
        window = NSWindow(contentRect: windowFrame(on: screen),
                          styleMask: [.titled, .closable, .miniaturizable, .resizable],
                          backing: .buffered, defer: false)
        window.title = "MacDisplay"
        window.titlebarAppearsTransparent = true
        window.backgroundColor = .black
        window.appearance = NSAppearance(named: .darkAqua)
        window.isReleasedWhenClosed = false
        window.minSize = NSSize(width: 640, height: 400)
        window.collectionBehavior = [.fullScreenPrimary]
        window.delegate = self
        window.contentView = web
        window.makeKeyAndOrderFront(nil)
        window.makeFirstResponder(web)

        web.load(URLRequest(url: URL(string: "macdisplay://app/index.html")!))

        // Start full screen on the second display when there is one (the point of the app).
        if NSScreen.screens.count > 1 {
            if store["screenID"] == nil { setStore("screenID", displayID(screen)) }
            // If the saved display isn't connected yet, reconcileDisplays enters full screen when it appears.
            if flag("fullscreen", default: true), storedScreen() != nil {
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.8) { [weak self] in
                    guard let self = self, !self.window.styleMask.contains(.fullScreen) else { return }
                    if !self.toggleFS() { self.scheduleReconcile(after: 1) }
                }
            }
        }
    }

    /// All full-screen toggles go through here so two animations never overlap.
    /// Returns false (and does nothing) if one is already running.
    @discardableResult
    private func toggleFS() -> Bool {
        guard !isTransitioning else { return false }
        isTransitioning = true
        transitionToken += 1
        let token = transitionToken
        window.toggleFullScreen(nil)
        DispatchQueue.main.asyncAfter(deadline: .now() + 4) { [weak self] in
            if self?.transitionToken == token { self?.isTransitioning = false }
        }
        return true
    }

    // MARK: Displays coming and going

    @objc private func displaysChanged(_ note: Notification) {
        quietUntil = Date().addingTimeInterval(8)
        scheduleReconcile(after: 2)
    }

    @objc private func systemWoke(_ note: Notification) {
        quietUntil = Date().addingTimeInterval(10)
        scheduleReconcile(after: 3)      // displays take a moment to reappear after wake
    }

    private func scheduleReconcile(after delay: TimeInterval) {
        reconcileWork?.cancel()
        let work = DispatchWorkItem { [weak self] in self?.reconcileDisplays() }
        reconcileWork = work
        DispatchQueue.main.asyncAfter(deadline: .now() + delay, execute: work)
    }

    /// Puts the window where the user wants it: back on their chosen display (full screen) when it is
    /// connected, or in an ordinary window on what is left when it is not.
    private func reconcileDisplays() {
        guard window != nil, !window.isMiniaturized else { return }
        let wantFullScreen = flag("fullscreen", default: true) && NSScreen.screens.count > 1
        if let target = storedScreen() {
            if window.screen != target {
                place(on: target, fullScreen: wantFullScreen)
            } else if wantFullScreen && !window.styleMask.contains(.fullScreen) {
                if !toggleFS() { scheduleReconcile(after: 1) }
            }
        } else if !NSScreen.screens.contains(where: { $0.frame.intersects(window.frame) }) {
            window.setFrame(windowFrame(on: NSScreen.screens[0]), display: true)   // never leave it off-screen
        }
    }

    /// Moves the window to `screen`, leaving and re-entering full screen around the move if needed.
    private func place(on screen: NSScreen, fullScreen wantFullScreen: Bool) {
        quietUntil = Date().addingTimeInterval(6)
        afterExitFullScreen = nil
        let id = displayID(screen)
        let finish: () -> Void = { [weak self] in
            guard let self = self else { return }
            // The display may have been unplugged during the animation: look it up again.
            guard let target = NSScreen.screens.first(where: { self.displayID($0) == id }) else {
                self.scheduleReconcile(after: 1)
                return
            }
            self.window.setFrame(self.windowFrame(on: target), display: true)
            if wantFullScreen {
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) { [weak self] in
                    guard let self = self, !self.window.styleMask.contains(.fullScreen) else { return }
                    if !self.toggleFS() { self.scheduleReconcile(after: 1) }
                }
            }
        }
        if window.styleMask.contains(.fullScreen) {
            afterExitFullScreen = finish
            if !toggleFS() {
                afterExitFullScreen = nil
                scheduleReconcile(after: 1)
            }
        } else {
            finish()
        }
    }

    func windowDidEnterFullScreen(_ notification: Notification) {
        isTransitioning = false
        setStore("fullscreen", "1")
        // Only count it as the user's choice while their chosen display is still connected.
        if Date() >= quietUntil, storedScreen() != nil, let screen = window.screen { setStore("screenID", displayID(screen)) }
    }

    func windowDidExitFullScreen(_ notification: Notification) {
        isTransitioning = false
        if let next = afterExitFullScreen {
            afterExitFullScreen = nil
            next()
        } else if Date() >= quietUntil && storedScreen() != nil {
            // The user left full screen. (If the display vanished, the system did it: keep the preference.)
            setStore("fullscreen", "0")
        }
    }

    func windowDidChangeScreen(_ notification: Notification) {
        // Only a drag by the user counts as choosing a display; automatic moves must not overwrite the choice.
        if Date() >= quietUntil, storedScreen() != nil, !window.styleMask.contains(.fullScreen), let screen = window.screen {
            setStore("screenID", displayID(screen))
        }
    }

    // MARK: Messages from the page

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard let body = message.body as? [String: Any], let cmd = body["cmd"] as? String else { return }
        switch cmd {
        case "set":
            if let key = body["k"] as? String {
                setStore(key, String(describing: body["v"] ?? ""))
            }
        case "fullscreen":
            toggleFS()
        case "locate":
            location.locate { [weak self] result in self?.sendLocation(result) }
        default:
            break
        }
    }

    private func sendLocation(_ r: LocationResult) {
        var d: [String: Any] = ["ok": r.ok]
        if r.ok {
            d["lat"] = r.lat
            d["lon"] = r.lon
            d["name"] = r.name ?? NSNull()
        } else {
            d["error"] = r.error ?? "failed"
        }
        runJS("MacDisplay.locResult(\(jsonString(d)))")
    }

    private func jsonString(_ object: Any) -> String {
        guard let data = try? JSONSerialization.data(withJSONObject: object),
              let text = String(data: data, encoding: .utf8) else { return "null" }
        return text
    }

    private func runJS(_ script: String) {
        web?.evaluateJavaScript(script, completionHandler: nil)
    }

    // MARK: Menus

    private func item(_ title: String, _ action: Selector, key: String = "",
                      mods: NSEvent.ModifierFlags = .command, represents: Any? = nil) -> NSMenuItem {
        let it = NSMenuItem(title: title, action: action, keyEquivalent: key)
        it.keyEquivalentModifierMask = mods
        it.target = self
        it.representedObject = represents
        return it
    }

    private func submenu(_ title: String, in parent: NSMenu) -> NSMenu {
        let holder = NSMenuItem(title: title, action: nil, keyEquivalent: "")
        let menu = NSMenu(title: title)
        menu.delegate = self
        holder.submenu = menu
        parent.addItem(holder)
        return menu
    }

    private func buildMenus() {
        let bar = NSMenu()
        NSApp.mainMenu = bar

        // MacDisplay
        let appMenu = submenu("App", in: bar)
        appMenu.addItem(NSMenuItem(title: "About MacDisplay", action: #selector(NSApplication.orderFrontStandardAboutPanel(_:)), keyEquivalent: ""))
        appMenu.addItem(.separator())
        appMenu.addItem(item("Keep Display Awake", #selector(toggleAwake(_:)), represents: "keepAwake"))
        appMenu.addItem(item("Open at Login", #selector(toggleLogin(_:)), represents: "login"))
        appMenu.addItem(.separator())
        appMenu.addItem(NSMenuItem(title: "Hide MacDisplay", action: #selector(NSApplication.hide(_:)), keyEquivalent: "h"))
        appMenu.addItem(NSMenuItem(title: "Quit MacDisplay", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q"))

        // Layout
        let layoutMenu = submenu("Layout", in: bar)
        for (index, l) in layouts.enumerated() {
            layoutMenu.addItem(item(l.name, #selector(pickLayout(_:)), key: String(index + 1), represents: l.id))
        }
        layoutMenu.addItem(.separator())
        layoutMenu.addItem(item("Next Layout", #selector(nextLayout(_:)), key: "d"))

        // Theme
        let themeMenu = submenu("Theme", in: bar)
        for t in themes {
            themeMenu.addItem(item(t.name, #selector(pickTheme(_:)), represents: t.id))
        }
        themeMenu.addItem(.separator())
        themeMenu.addItem(item("Next Theme", #selector(nextTheme(_:)), key: "]"))
        themeMenu.addItem(item("Previous Theme", #selector(previousTheme(_:)), key: "["))

        // Weather
        let weatherMenu = submenu("Weather", in: bar)
        weatherMenu.addItem(item("Use My Location", #selector(useLocation(_:)), key: "l", represents: "autoLoc"))
        weatherMenu.addItem(item("Choose City…", #selector(chooseCity(_:)), key: "l", mods: [.command, .shift]))

        // View
        let viewMenu = submenu("View", in: bar)
        viewMenu.addItem(item("Enter Full Screen", #selector(toggleFullScreen(_:)), key: "f", mods: [.command, .control]))
        _ = submenu("Display", in: viewMenu)
        viewMenu.addItem(.separator())
        let animMenu = submenu("Animation", in: viewMenu)
        for a in animations {
            animMenu.addItem(item(a.name, #selector(pickAnimation(_:)), represents: a.id))
        }
        let optMenu = submenu("Options", in: viewMenu)
        for o in options {
            optMenu.addItem(item(o.name, #selector(toggleOption(_:)), represents: o.id))
        }
        viewMenu.addItem(.separator())
        viewMenu.addItem(item("World Clock Cities…", #selector(worldCities(_:))))
        viewMenu.addItem(item("Focus Timer Lengths…", #selector(timerLengths(_:))))
        viewMenu.addItem(item("Show Settings Panel", #selector(showSettings(_:))))   // the page also opens it with the M key

        // Window
        let windowMenu = submenu("Window", in: bar)
        windowMenu.addItem(NSMenuItem(title: "Minimize", action: #selector(NSWindow.performMiniaturize(_:)), keyEquivalent: "m"))
        windowMenu.addItem(NSMenuItem(title: "Zoom", action: #selector(NSWindow.performZoom(_:)), keyEquivalent: ""))
        NSApp.windowsMenu = windowMenu
    }

    /// Keeps check marks and the display list in step with the current settings.
    func menuNeedsUpdate(_ menu: NSMenu) {
        switch menu.title {
        case "App":
            for it in menu.items {
                switch it.representedObject as? String {
                case "keepAwake": it.state = flag("keepAwake", default: true) ? .on : .off
                case "login": it.state = SMAppService.mainApp.status == .enabled ? .on : .off
                default: break
                }
            }
        case "Layout":
            let current = store["layout"] ?? "dashboard"
            for it in menu.items { if let id = it.representedObject as? String { it.state = id == current ? .on : .off } }
        case "Theme":
            let current = store["theme"] ?? "neon"
            for it in menu.items { if let id = it.representedObject as? String { it.state = id == current ? .on : .off } }
        case "Animation":
            let current = store["anim"] ?? "smooth"
            for it in menu.items { if let id = it.representedObject as? String { it.state = id == current ? .on : .off } }
        case "Options":
            for it in menu.items {
                guard let id = it.representedObject as? String else { continue }
                switch id {
                case "h24": it.state = store["h24"] == "1" ? .on : .off
                case "sec": it.state = store["sec"] != "0" ? .on : .off
                case "scan": it.state = store["scan"] == "1" ? .on : .off
                case "unit": it.state = store["unit"] == "f" ? .on : .off
                default: break
                }
            }
        case "Weather":
            for it in menu.items where (it.representedObject as? String) == "autoLoc" {
                it.state = store["autoLoc"] != "0" ? .on : .off
            }
        case "Display":
            menu.removeAllItems()
            let names = NSScreen.screens.map { $0.localizedName }
            for (index, screen) in NSScreen.screens.enumerated() {
                var title = screen.localizedName
                if names.filter({ $0 == title }).count > 1 { title += " (\(index + 1))" }   // identical monitors
                let it = item(title, #selector(moveToScreen(_:)), represents: displayID(screen))
                it.state = (window?.screen == screen) ? .on : .off
                menu.addItem(it)
            }
        default:
            break
        }
    }

    // MARK: Menu actions

    @objc private func pickLayout(_ sender: NSMenuItem) {
        if let id = sender.representedObject as? String { runJS("MacDisplay.setLayout('\(id)')") }
    }

    @objc private func pickTheme(_ sender: NSMenuItem) {
        if let id = sender.representedObject as? String { runJS("MacDisplay.applyTheme('\(id)')") }
    }

    @objc private func pickAnimation(_ sender: NSMenuItem) {
        if let id = sender.representedObject as? String { runJS("MacDisplay.setAnim('\(id)')") }
    }

    @objc private func toggleOption(_ sender: NSMenuItem) {
        if let id = sender.representedObject as? String { runJS("MacDisplay.opt('\(id)')") }
    }

    @objc private func nextLayout(_ sender: Any?) { runJS("MacDisplay.nextLayout(1)") }
    @objc private func nextTheme(_ sender: Any?) { runJS("MacDisplay.nextTheme(1)") }
    @objc private func previousTheme(_ sender: Any?) { runJS("MacDisplay.nextTheme(-1)") }
    @objc private func useLocation(_ sender: Any?) { runJS("MacDisplay.useLocation()") }
    @objc private func chooseCity(_ sender: Any?) { runJS("MacDisplay.chooseCity()") }
    @objc private func worldCities(_ sender: Any?) { runJS("MacDisplay.zones()") }
    @objc private func timerLengths(_ sender: Any?) { runJS("MacDisplay.timer()") }
    @objc private func showSettings(_ sender: Any?) { runJS("MacDisplay.menu()") }
    @objc private func toggleFullScreen(_ sender: Any?) { toggleFS() }

    @objc private func toggleAwake(_ sender: NSMenuItem) {
        let on = !flag("keepAwake", default: true)
        setStore("keepAwake", on ? "1" : "0")
        setAwake(on)
    }

    @objc private func toggleLogin(_ sender: NSMenuItem) {
        do {
            if SMAppService.mainApp.status == .enabled {
                try SMAppService.mainApp.unregister()
            } else {
                try SMAppService.mainApp.register()
            }
        } catch {
            let alert = NSAlert()
            alert.messageText = "Couldn't change “Open at Login”"
            alert.informativeText = "\(error.localizedDescription)\n\nTip: move MacDisplay to the Applications folder first, then try again."
            alert.runModal()
        }
    }

    @objc private func moveToScreen(_ sender: NSMenuItem) {
        guard let id = sender.representedObject as? String,
              let screen = NSScreen.screens.first(where: { displayID($0) == id }) else { return }
        setStore("screenID", id)
        if window.screen == screen { return }      // already there: don't bounce out of full screen
        let wantFullScreen = window.styleMask.contains(.fullScreen) || flag("fullscreen", default: true)
        place(on: screen, fullScreen: wantFullScreen && NSScreen.screens.count > 1)
    }

    // MARK: Keep the display awake

    private func setAwake(_ on: Bool) {
        if on && awakeAssertion == 0 {
            var id: IOPMAssertionID = 0
            let result = IOPMAssertionCreateWithName(kIOPMAssertionTypeNoDisplaySleep as CFString,
                                                     IOPMAssertionLevel(kIOPMAssertionLevelOn),
                                                     "MacDisplay is showing a live display" as CFString,
                                                     &id)
            if result == kIOReturnSuccess { awakeAssertion = id }
        } else if !on && awakeAssertion != 0 {
            IOPMAssertionRelease(awakeAssertion)
            awakeAssertion = 0
        }
    }

    func applicationWillTerminate(_ notification: Notification) {
        setAwake(false)
    }
}
