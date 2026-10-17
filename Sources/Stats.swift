import Foundation
import Darwin
import AppKit
import IOKit.ps
import CoreWLAN

/// Collects system stats once a second on a background queue and keeps the latest
/// snapshot, so answering the page's requests is just reading a cached value.
/// Same JSON shape as browser/server.py.
final class StatsProvider {
    // Shared with the main thread, guarded by `lock`.
    private let lock = NSLock()
    private var snapshot: [String: Any] = [:]
    private var processes: [[String: Any]] = []
    private var nowPlaying: Any = NSNull()

    // Touched only on `queue`.
    private let queue = DispatchQueue(label: "macdisplay.stats", qos: .utility)
    private let playerQueue = DispatchQueue(label: "macdisplay.nowplaying", qos: .utility)
    private var timer: DispatchSourceTimer?
    private var tickCount = 0
    private var prevCPU: [[UInt32]] = []
    private var prevRx: UInt32 = 0
    private var prevTx: UInt32 = 0
    private var prevTime = Date()
    private var haveNet = false
    private var down = 0.0
    private var up = 0.0
    private var slow: [String: Any] = [:]      // disk, host, ip, wifi
    private var battery: Any = NSNull()
    private var processCount = 0

    func start() {
        let t = DispatchSource.makeTimerSource(queue: queue)
        t.schedule(deadline: .now(), repeating: 1.0, leeway: .milliseconds(100))
        t.setEventHandler { [weak self] in self?.sample() }
        t.resume()
        timer = t
    }

    // MARK: Answers for the web page

    func statsJSON(procs: Int, cores: Bool) -> Data? {
        lock.lock()
        var d = snapshot
        let p = processes
        lock.unlock()
        if d.isEmpty { return nil }
        if !cores { d.removeValue(forKey: "cores") }
        if procs > 0 { d["procs"] = Array(p.prefix(procs)) }
        return try? JSONSerialization.data(withJSONObject: d)
    }

    func nowPlayingJSON() -> Data {
        lock.lock()
        let np = nowPlaying
        lock.unlock()
        if let dict = np as? [String: Any], let data = try? JSONSerialization.data(withJSONObject: dict) {
            return data
        }
        return Data("null".utf8)
    }

    // MARK: Sampling

    private func sample() {
        tickCount += 1

        let cpu = sampleCPU()

        let (rx, tx) = netCounters()
        let now = Date()
        let dt = max(now.timeIntervalSince(prevTime), 0.001)
        if haveNet {
            down = finite(Double(rx &- prevRx) / dt)
            up = finite(Double(tx &- prevTx) / dt)
        }
        haveNet = true
        prevRx = rx
        prevTx = tx
        prevTime = now

        let mem = sampleMemory()
        let swap = sampleSwap()

        if tickCount == 1 || tickCount % 30 == 0 { slow = sampleSlow() }
        if tickCount == 1 || tickCount % 4 == 0 {
            let (list, count) = sampleProcesses()
            lock.lock()
            processes = list
            lock.unlock()
            processCount = count
        }
        if tickCount == 1 || tickCount % 5 == 0 {
            battery = sampleBattery()
            playerQueue.async { [weak self] in
                guard let self = self else { return }
                let value = self.fetchNowPlaying()
                self.lock.lock()
                self.nowPlaying = value
                self.lock.unlock()
            }
        }

        var d: [String: Any] = [
            "cpu": round1(cpu.total),
            "cores": cpu.cores.map { round1($0) },
            "ncores": cpu.cores.count,
            "ram": mem.total > 0 ? round1(Double(mem.used) / Double(mem.total) * 100) : 0.0,
            "ram_used": mem.used,
            "ram_total": mem.total,
            "swap": swap.total > 0 ? round1(Double(swap.used) / Double(swap.total) * 100) : 0.0,
            "swap_used": swap.used,
            "swap_total": swap.total,
            "down": down,
            "up": up,
            "battery": battery,
            "uptime": uptimeSeconds(),
            "load": loadAverages(),
            "nproc": processCount,
        ]
        for (k, v) in slow { d[k] = v }

        lock.lock()
        snapshot = d
        lock.unlock()
    }

    private func finite(_ x: Double) -> Double { x.isFinite ? max(x, 0) : 0 }
    private func round1(_ x: Double) -> Double { x.isFinite ? (x * 10).rounded() / 10 : 0 }

    // MARK: CPU

    private func sampleCPU() -> (total: Double, cores: [Double]) {
        var cpuCount: natural_t = 0
        var infoPtr: processor_info_array_t? = nil
        var infoCount: mach_msg_type_number_t = 0
        let kr = host_processor_info(mach_host_self(), PROCESSOR_CPU_LOAD_INFO, &cpuCount, &infoPtr, &infoCount)
        guard kr == KERN_SUCCESS, let info = infoPtr else { return (0, []) }

        var current: [[UInt32]] = []
        for i in 0..<Int(cpuCount) {
            let base = Int(CPU_STATE_MAX) * i
            current.append([
                UInt32(bitPattern: info[base + Int(CPU_STATE_USER)]),
                UInt32(bitPattern: info[base + Int(CPU_STATE_SYSTEM)]),
                UInt32(bitPattern: info[base + Int(CPU_STATE_IDLE)]),
                UInt32(bitPattern: info[base + Int(CPU_STATE_NICE)]),
            ])
        }
        _ = vm_deallocate(mach_task_self_,
                          vm_address_t(UInt(bitPattern: info)),
                          vm_size_t(infoCount) * vm_size_t(MemoryLayout<integer_t>.stride))

        var cores: [Double] = []
        if prevCPU.count == current.count {
            for i in 0..<current.count {
                let user = Double(current[i][0] &- prevCPU[i][0])
                let sys = Double(current[i][1] &- prevCPU[i][1])
                let idle = Double(current[i][2] &- prevCPU[i][2])
                let nice = Double(current[i][3] &- prevCPU[i][3])
                let total = user + sys + idle + nice
                cores.append(total > 0 ? (total - idle) / total * 100 : 0)
            }
        } else {
            cores = Array(repeating: 0, count: current.count)
        }
        prevCPU = current
        let avg = cores.isEmpty ? 0 : cores.reduce(0, +) / Double(cores.count)
        return (avg, cores)
    }

    // MARK: Memory

    private func sampleMemory() -> (used: UInt64, total: UInt64) {
        let total = ProcessInfo.processInfo.physicalMemory
        var count = mach_msg_type_number_t(MemoryLayout<vm_statistics64_data_t>.stride / MemoryLayout<integer_t>.stride)
        var stats = vm_statistics64_data_t()
        let kr = withUnsafeMutablePointer(to: &stats) { ptr -> kern_return_t in
            ptr.withMemoryRebound(to: integer_t.self, capacity: Int(count)) { raw in
                host_statistics64(mach_host_self(), HOST_VM_INFO64, raw, &count)
            }
        }
        guard kr == KERN_SUCCESS else { return (0, total) }
        // Same idea as Activity Monitor's "Memory Used": app memory + wired + compressed.
        let page = UInt64(getpagesize())
        let appPages = UInt64(stats.internal_page_count) > UInt64(stats.purgeable_count)
            ? UInt64(stats.internal_page_count) - UInt64(stats.purgeable_count) : 0
        let used = (appPages + UInt64(stats.wire_count) + UInt64(stats.compressor_page_count)) * page
        return (min(used, total), total)
    }

    private func sampleSwap() -> (used: UInt64, total: UInt64) {
        var usage = xsw_usage()
        var size = MemoryLayout<xsw_usage>.stride
        if sysctlbyname("vm.swapusage", &usage, &size, nil, 0) == 0 {
            return (UInt64(usage.xsu_used), UInt64(usage.xsu_total))
        }
        return (0, 0)
    }

    // MARK: Network

    /// Sum of byte counters over the "en*" interfaces (Wi-Fi, Ethernet). The counters are
    /// 32-bit, so we keep the sums in UInt32 and take wrapping differences.
    private func netCounters() -> (UInt32, UInt32) {
        var list: UnsafeMutablePointer<ifaddrs>? = nil
        guard getifaddrs(&list) == 0, let first = list else { return (0, 0) }
        defer { freeifaddrs(list) }
        var rx: UInt32 = 0
        var tx: UInt32 = 0
        var cursor: UnsafeMutablePointer<ifaddrs>? = first
        while let p = cursor {
            let name = String(cString: p.pointee.ifa_name)
            if name.hasPrefix("en"),
               let addr = p.pointee.ifa_addr,
               addr.pointee.sa_family == UInt8(AF_LINK),
               let data = p.pointee.ifa_data {
                let d = data.assumingMemoryBound(to: if_data.self).pointee
                rx = rx &+ d.ifi_ibytes
                tx = tx &+ d.ifi_obytes
            }
            cursor = p.pointee.ifa_next
        }
        return (rx, tx)
    }

    private func localIPAddress() -> Any {
        var list: UnsafeMutablePointer<ifaddrs>? = nil
        guard getifaddrs(&list) == 0, let first = list else { return NSNull() }
        defer { freeifaddrs(list) }
        var cursor: UnsafeMutablePointer<ifaddrs>? = first
        while let p = cursor {
            let name = String(cString: p.pointee.ifa_name)
            if name.hasPrefix("en"), let addr = p.pointee.ifa_addr, addr.pointee.sa_family == UInt8(AF_INET) {
                var host = [CChar](repeating: 0, count: Int(NI_MAXHOST))
                if getnameinfo(addr, socklen_t(addr.pointee.sa_len), &host, socklen_t(host.count), nil, 0, NI_NUMERICHOST) == 0 {
                    return String(cString: host)
                }
            }
            cursor = p.pointee.ifa_next
        }
        return NSNull()
    }

    // MARK: Slow-changing values (every 30 s)

    private func sampleSlow() -> [String: Any] {
        var d: [String: Any] = [:]
        let url = URL(fileURLWithPath: "/")
        if let v = try? url.resourceValues(forKeys: [.volumeTotalCapacityKey, .volumeAvailableCapacityForImportantUsageKey]),
           let total = v.volumeTotalCapacity,
           let avail = v.volumeAvailableCapacityForImportantUsage,
           total > 0 {
            let used = max(Double(total) - Double(avail), 0)
            d["disk"] = round1(used / Double(total) * 100)
            d["disk_free"] = avail
            d["disk_total"] = total
        } else {
            d["disk"] = 0.0
            d["disk_free"] = 0
            d["disk_total"] = 0
        }
        // scutil answers instantly; Host.current() can wait on DNS when the network is flaky.
        let computerName = run("/usr/sbin/scutil", ["--get", "ComputerName"], timeout: 2) ?? ""
        d["host"] = computerName.isEmpty ? "Mac" : computerName
        d["ip"] = localIPAddress()
        // The Wi-Fi name is only available once Location Services is allowed for this app.
        if let ssid = CWWiFiClient.shared().interface()?.ssid() {
            d["wifi"] = ssid
        } else {
            d["wifi"] = NSNull()
        }
        return d
    }

    // MARK: Battery, uptime, load

    private func sampleBattery() -> Any {
        guard let info = IOPSCopyPowerSourcesInfo()?.takeRetainedValue(),
              let list = IOPSCopyPowerSourcesList(info)?.takeRetainedValue() as? [CFTypeRef] else {
            return NSNull()
        }
        for source in list {
            guard let desc = IOPSGetPowerSourceDescription(info, source)?.takeUnretainedValue() as? [String: Any] else { continue }
            guard (desc[kIOPSTypeKey] as? String) == kIOPSInternalBatteryType else { continue }
            let percent = desc[kIOPSCurrentCapacityKey] as? Int ?? 0
            let plugged = (desc[kIOPSPowerSourceStateKey] as? String) == kIOPSACPowerValue
            var secs: Any = NSNull()
            if !plugged, let minutes = desc[kIOPSTimeToEmptyKey] as? Int, minutes > 0 { secs = minutes * 60 }
            return ["percent": percent, "plugged": plugged, "secs": secs] as [String: Any]
        }
        return NSNull()
    }

    private func uptimeSeconds() -> Double {
        var tv = timeval()
        var size = MemoryLayout<timeval>.stride
        if sysctlbyname("kern.boottime", &tv, &size, nil, 0) == 0 {
            return max(Date().timeIntervalSince1970 - Double(tv.tv_sec), 0)
        }
        return ProcessInfo.processInfo.systemUptime
    }

    private func loadAverages() -> [Double] {
        var l = [Double](repeating: 0, count: 3)
        getloadavg(&l, 3)
        return l.map { ($0 * 100).rounded() / 100 }
    }

    // MARK: Processes (via ps, every 4 s)

    private func sampleProcesses() -> ([[String: Any]], Int) {
        guard let text = run("/bin/ps", ["-A", "-c", "-o", "pcpu=,pmem=,comm="], timeout: 5) else { return ([], 0) }
        var grouped: [String: (cpu: Double, mem: Double)] = [:]
        var count = 0
        for line in text.split(separator: "\n") {
            let parts = line.split(separator: " ", maxSplits: 2, omittingEmptySubsequences: true)
            guard parts.count == 3, let cpu = Double(parts[0]), let mem = Double(parts[1]) else { continue }
            let name = parts[2].trimmingCharacters(in: .whitespaces)
            var g = grouped[name] ?? (cpu: 0.0, mem: 0.0)
            g.cpu += cpu
            g.mem += mem
            grouped[name] = g
            count += 1
        }
        let top = grouped.sorted { a, b in
            a.value.cpu != b.value.cpu ? a.value.cpu > b.value.cpu : a.value.mem > b.value.mem
        }.prefix(12)
        let list: [[String: Any]] = top.map { item in
            ["name": item.key, "cpu": round1(item.value.cpu), "mem": round1(item.value.mem)]
        }
        return (list, count)
    }

    // MARK: Now playing (Music / Spotify)

    private func fetchNowPlaying() -> Any {
        var running = Set<String>()
        DispatchQueue.main.sync {
            running = Set(NSWorkspace.shared.runningApplications.compactMap { $0.bundleIdentifier })
        }
        let players: [(bundle: String, name: String)] = [("com.apple.Music", "Music"), ("com.spotify.client", "Spotify")]
        for player in players where running.contains(player.bundle) {
            // Only asked when the player is already running, so we never launch it.
            let script = "tell application \"\(player.name)\"\n"
                + "if player state is playing then\n"
                + "return (name of current track) & linefeed & (artist of current track)\n"
                + "end if\n"
                + "end tell\n"
                + "return \"\""
            if let out = run("/usr/bin/osascript", ["-e", script], timeout: 4), !out.isEmpty {
                let lines = out.components(separatedBy: "\n")
                return ["app": player.name, "title": lines[0], "artist": lines.count > 1 ? lines[1] : ""] as [String: Any]
            }
        }
        return NSNull()
    }

    // MARK: Helper: run a tool and capture its output

    private func run(_ path: String, _ args: [String], timeout: TimeInterval) -> String? {
        let process = Process()
        process.executableURL = URL(fileURLWithPath: path)
        process.arguments = args
        let pipe = Pipe()
        process.standardOutput = pipe
        process.standardError = FileHandle.nullDevice
        do { try process.run() } catch { return nil }
        let killer = DispatchWorkItem { if process.isRunning { process.terminate() } }
        DispatchQueue.global().asyncAfter(deadline: .now() + timeout, execute: killer)
        let data = pipe.fileHandleForReading.readDataToEndOfFile()
        process.waitUntilExit()
        killer.cancel()
        guard process.terminationStatus == 0 else { return nil }
        return String(decoding: data, as: UTF8.self).trimmingCharacters(in: .whitespacesAndNewlines)
    }
}
