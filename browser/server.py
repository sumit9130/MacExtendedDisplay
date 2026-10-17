#!/usr/bin/env python3
"""MacDisplay server: serves the web UI and a tiny JSON stats API.

Low-CPU design: one background thread samples CPU / network once per second;
requests just read cached values. Expensive things (process list, battery,
now-playing) are cached for several seconds and only computed when asked for.
"""
import json
import mimetypes
import os
import platform
import socket
import subprocess
import sys
import threading
import time
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

try:
    import psutil
except ImportError:
    print("psutil is missing. Run:  pip3 install psutil")
    sys.exit(1)

HERE = os.path.dirname(os.path.abspath(__file__))
WEB = os.path.realpath(os.path.join(HERE, "..", "Resources", "web"))
PORT = int(os.environ.get("MACDISPLAY_PORT", "8765"))

# ---------------------------------------------------------------- sampler
SAMPLE = {"cpu": 0.0, "cores": [], "down": 0.0, "up": 0.0}


def _net_totals():
    """Bytes in/out over physical interfaces only (skip loopback and tunnels)."""
    try:
        nics = psutil.net_io_counters(pernic=True)
    except Exception:
        return 0, 0
    pick = {k: v for k, v in nics.items() if k.startswith("en")} or \
           {k: v for k, v in nics.items() if not k.startswith("lo")}
    return (sum(v.bytes_recv for v in pick.values()),
            sum(v.bytes_sent for v in pick.values()))


def sampler():
    psutil.cpu_percent(None, percpu=True)
    rx0, tx0 = _net_totals()
    t0 = time.time()
    while True:
        time.sleep(1.0)
        now = time.time()
        rx, tx = _net_totals()
        dt = max(now - t0, 0.001)
        SAMPLE["down"] = max((rx - rx0) / dt, 0.0)
        SAMPLE["up"] = max((tx - tx0) / dt, 0.0)
        rx0, tx0, t0 = rx, tx, now
        cores = psutil.cpu_percent(None, percpu=True)
        SAMPLE["cores"] = cores
        SAMPLE["cpu"] = sum(cores) / len(cores) if cores else 0.0


# ---------------------------------------------------------------- caching
_cache = {}
_cache_lock = threading.Lock()


def cached(key, ttl, fn):
    now = time.time()
    with _cache_lock:
        hit = _cache.get(key)
        if hit and now - hit[0] < ttl:
            return hit[1]
    val = fn()
    with _cache_lock:
        _cache[key] = (now, val)
    return val


def local_ip():
    def go():
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        try:
            s.connect(("10.255.255.255", 1))  # no packet is actually sent
            return s.getsockname()[0]
        except Exception:
            return None
        finally:
            s.close()
    return cached("ip", 30, go)


def wifi_name():
    def go():
        try:
            out = subprocess.run(["/usr/sbin/networksetup", "-getairportnetwork", "en0"],
                                 capture_output=True, text=True, timeout=2).stdout
            if ":" in out:
                name = out.split(":", 1)[1].strip()
                if name and "redacted" not in name.lower():
                    return name
        except Exception:
            pass
        return None
    return cached("wifi", 60, go)


def battery():
    def go():
        try:
            b = psutil.sensors_battery()
        except Exception:
            b = None
        if not b:
            return None
        secs = b.secsleft if isinstance(b.secsleft, (int, float)) and b.secsleft > 0 else None
        return {"percent": round(b.percent), "plugged": bool(b.power_plugged), "secs": secs}
    return cached("bat", 5, go)


def top_procs(n):
    def go():
        agg = {}
        for p in psutil.process_iter(["name", "cpu_percent", "memory_percent"]):
            try:
                i = p.info
                name = i.get("name") or "?"
                a = agg.setdefault(name, [0.0, 0.0])
                a[0] += i.get("cpu_percent") or 0.0
                a[1] += i.get("memory_percent") or 0.0
            except Exception:
                pass
        rows = sorted(agg.items(), key=lambda kv: (kv[1][0], kv[1][1]), reverse=True)[:12]
        return [{"name": k, "cpu": round(v[0], 1), "mem": round(v[1], 1)} for k, v in rows]
    return cached("procs", 4, go)[:n]


def now_playing():
    def go():
        for app in ("Spotify", "Music"):
            try:
                if subprocess.run(["pgrep", "-x", app], capture_output=True, timeout=2).returncode != 0:
                    continue
                script = (f'tell application "{app}"\n'
                          'if player state is playing then\n'
                          'return (name of current track) & linefeed & (artist of current track)\n'
                          'end if\nend tell\nreturn ""')
                out = subprocess.run(["osascript", "-e", script], capture_output=True,
                                     text=True, timeout=2).stdout.strip()
                if out:
                    title, _, artist = out.partition("\n")
                    return {"app": app, "title": title, "artist": artist}
            except Exception:
                continue
        return None
    return cached("np", 4, go)


def stats(nprocs=0, want_cores=False):
    vm = psutil.virtual_memory()
    sw = psutil.swap_memory()
    disk = cached("disk", 30, lambda: psutil.disk_usage("/"))
    boot = cached("boot", 3600, psutil.boot_time)
    d = {
        "cpu": round(SAMPLE["cpu"], 1),
        "ram": vm.percent, "ram_used": vm.used, "ram_total": vm.total,
        "swap": sw.percent, "swap_used": sw.used, "swap_total": sw.total,
        "disk": disk.percent, "disk_free": disk.free, "disk_total": disk.total,
        "down": SAMPLE["down"], "up": SAMPLE["up"],
        "battery": battery(),
        "uptime": time.time() - boot,
        "load": [round(x, 2) for x in os.getloadavg()],
        "nproc": cached("nproc", 5, lambda: len(psutil.pids())),
        "host": cached("host", 600, lambda: platform.node().replace(".local", "")),
        "ip": local_ip(),
        "wifi": wifi_name(),
        "ncores": len(SAMPLE["cores"]) or psutil.cpu_count() or 0,
    }
    if want_cores:
        d["cores"] = [round(c, 1) for c in SAMPLE["cores"]]
    if nprocs:
        d["procs"] = top_procs(nprocs)
    return d


# ---------------------------------------------------------------- http
class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    server_version = "MacDisplay"

    def log_message(self, *args):
        pass

    def _send(self, code, body, ctype, cache="no-store"):
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", cache)
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        u = urlparse(self.path)
        try:
            if u.path == "/api/stats":
                q = parse_qs(u.query)
                n = int((q.get("procs") or ["0"])[0] or 0)
                body = json.dumps(stats(min(n, 12), "cores" in q)).encode()
                return self._send(200, body, "application/json")
            if u.path == "/api/nowplaying":
                return self._send(200, json.dumps(now_playing()).encode(), "application/json")

            rel = "index.html" if u.path in ("", "/") else u.path.lstrip("/")
            full = os.path.realpath(os.path.join(WEB, rel))
            if not full.startswith(WEB + os.sep) or not os.path.isfile(full):
                return self._send(404, b"Not found", "text/plain")
            ctype = mimetypes.guess_type(full)[0] or "application/octet-stream"
            if ctype.startswith("text/") or ctype in ("application/javascript", "application/json"):
                ctype += "; charset=utf-8"
            with open(full, "rb") as f:
                self._send(200, f.read(), ctype)
        except (BrokenPipeError, ConnectionResetError):
            pass
        except Exception as e:  # keep the display alive whatever happens
            try:
                self._send(500, str(e).encode(), "text/plain")
            except Exception:
                pass


class Server(ThreadingHTTPServer):
    daemon_threads = True


def main():
    url = f"http://127.0.0.1:{PORT}"
    try:
        srv = Server(("127.0.0.1", PORT), Handler)
    except OSError:
        print(f"MacDisplay seems to be running already at {url}")
        if "--no-open" not in sys.argv:
            webbrowser.open(url)
        return
    threading.Thread(target=sampler, daemon=True).start()
    print(f"MacDisplay running at {url}   (Ctrl+C to stop)")
    if "--no-open" not in sys.argv:
        threading.Timer(0.8, lambda: webbrowser.open(url)).start()
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
