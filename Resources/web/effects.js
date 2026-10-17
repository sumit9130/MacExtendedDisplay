/* effects.js - lightweight animated backgrounds.
 *
 * CPU-friendly by design:
 *  - each effect draws on a SMALL canvas (0.08x - 1x of the screen) that CSS scales up
 *  - frame rate is capped (24 fps "smooth", 12 fps "eco") and "off" draws one still frame
 *  - requestAnimationFrame stops by itself when the window is hidden or covered
 *  - particles are drawn in batches (one path, one fill) instead of one call each
 */
(function () {
  "use strict";
  const cv = document.getElementById("bg");
  const ctx = cv.getContext("2d");
  const rnd = (a, b) => a + Math.random() * (b - a);
  const TAU = Math.PI * 2;
  const rgba = (hex, a) => {
    const n = parseInt(hex.slice(1), 16);
    return "rgba(" + (n >> 16 & 255) + "," + (n >> 8 & 255) + "," + (n & 255) + "," + a + ")";
  };

  let W = 2, H = 2, fx = null, name = "none", colors = ["#ffffff", "#888888"];
  let level = "smooth", raf = 0, last = 0, T = 0;
  // per-effect frame rate: slow drifting effects don't need more. Eco = half of this.
  const FPS = { lava: 12, aurora: 15, synth: 15, matrix: 20, stars: 20, waves: 15, petals: 18, embers: 18, rain: 20, snow: 18 };

  /* ------------------------------------------------------------ effects */
  const E = {};

  E.none = { scale: 0.1, init() {}, draw() { ctx.clearRect(0, 0, W, H); }, still: true };

  // soft drifting colour blobs (tiny canvas, upscaled = free blur)
  E.lava = {
    scale: 0.08, opacity: 0.42,
    init() {
      this.b = [];
      for (let i = 0; i < 5; i++) {
        this.b.push({ x: rnd(0, W), y: rnd(0, H), r: rnd(0.45, 0.8) * H,
          vx: rnd(-2.2, 2.2), vy: rnd(-1.6, 1.6), c: colors[i % colors.length] });
      }
    },
    draw(dt) {
      ctx.clearRect(0, 0, W, H);
      ctx.globalCompositeOperation = "lighter";
      for (const b of this.b) {
        b.x += b.vx * dt; b.y += b.vy * dt;
        if (b.x < 0 || b.x > W) b.vx *= -1;
        if (b.y < 0 || b.y > H) b.vy *= -1;
        const g = ctx.createRadialGradient(b.x, b.y, 0, b.x, b.y, b.r);
        g.addColorStop(0, rgba(b.c, 0.6));
        g.addColorStop(1, rgba(b.c, 0));
        ctx.fillStyle = g;
        ctx.fillRect(b.x - b.r, b.y - b.r, b.r * 2, b.r * 2);
      }
      ctx.globalCompositeOperation = "source-over";
    },
  };

  // flowing aurora curtains
  E.aurora = {
    scale: 0.2, opacity: 0.8,
    init() {},
    draw(dt, t) {
      ctx.clearRect(0, 0, W, H);
      ctx.globalCompositeOperation = "lighter";
      for (let k = 0; k < 3; k++) {
        const y0 = H * (0.3 + 0.1 * k), amp = H * (0.07 + 0.02 * k), bottom = y0 + H * 0.5;
        ctx.beginPath();
        ctx.moveTo(0, bottom);
        for (let x = 0; x <= W + 6; x += 6) {
          const y = y0 + Math.sin(x * 0.011 + t * 0.32 + k * 1.9) * amp +
                    Math.sin(x * 0.027 - t * 0.21 + k) * amp * 0.5;
          ctx.lineTo(x, y);
        }
        ctx.lineTo(W, bottom);
        ctx.closePath();
        const g = ctx.createLinearGradient(0, y0 - amp, 0, bottom);
        const c = k === 1 ? colors[1] : colors[0];
        g.addColorStop(0, rgba(c, 0.5));
        g.addColorStop(1, rgba(c, 0));
        ctx.fillStyle = g;
        ctx.fill();
      }
      ctx.globalCompositeOperation = "source-over";
    },
  };

  // retro sun + scrolling perspective grid
  E.synth = {
    scale: 0.5, opacity: 0.7,
    init() {},
    draw(dt, t) {
      ctx.clearRect(0, 0, W, H);
      const hz = H * 0.6, cx = W / 2, r = H * 0.22;
      const sg = ctx.createLinearGradient(0, hz - r * 1.6, 0, hz);
      sg.addColorStop(0, colors[1]);
      sg.addColorStop(1, colors[0]);
      ctx.fillStyle = sg;
      ctx.beginPath();
      ctx.arc(cx, hz - r * 0.55, r, 0, TAU);
      ctx.fill();
      ctx.globalCompositeOperation = "destination-out";
      for (let i = 0; i < 6; i++) {
        const y = hz - r * 0.55 + r * (0.12 + i * 0.15);
        ctx.fillRect(cx - r, y, r * 2, 1 + i * 0.7);
      }
      ctx.globalCompositeOperation = "source-over";
      ctx.fillStyle = "rgba(0,0,0,0.55)";
      ctx.fillRect(0, hz, W, H - hz);
      ctx.strokeStyle = rgba(colors[0], 0.75);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, hz); ctx.lineTo(W, hz);
      const phase = (t * 0.3) % 1;
      for (let k = 0; k < 12; k++) {
        const p = (k + phase) / 12;
        const y = hz + (H - hz) * p * p;
        ctx.moveTo(0, y); ctx.lineTo(W, y);
      }
      for (let i = -12; i <= 12; i++) {
        ctx.moveTo(cx + i * 3, hz);
        ctx.lineTo(cx + i * W * 0.09, H);
      }
      ctx.stroke();
    },
  };

  // falling code
  E.matrix = {
    scale: 1, opacity: 0.55, still: false,
    init() {
      this.fs = 16;
      this.cols = Math.ceil(W / this.fs);
      this.y = [];
      for (let i = 0; i < this.cols; i++) this.y.push(Math.floor(rnd(-30, H / this.fs)));
      this.acc = 0;
      this.chars = "ｱｲｳｴｵｶｷｸｹｺｻｼｽｾｿﾀﾁﾂﾃﾄﾅﾆﾇﾈﾉ0123456789ABCDEF<>/+*";
    },
    draw(dt) {
      this.acc += dt * 12;               // ~12 steps per second whatever the fps
      if (this.acc < 1) return;
      this.acc -= 1;
      ctx.globalCompositeOperation = "destination-out";
      ctx.fillStyle = "rgba(0,0,0,0.11)";
      ctx.fillRect(0, 0, W, H);
      ctx.globalCompositeOperation = "source-over";
      ctx.font = this.fs + "px monospace";
      for (let i = 0; i < this.cols; i++) {
        const y = this.y[i];
        if (y >= 0) {
          ctx.fillStyle = colors[0];
          ctx.fillText(this.chars[(Math.random() * this.chars.length) | 0], i * this.fs, y * this.fs);
        }
        this.y[i] = (y * this.fs > H && Math.random() > 0.96) ? Math.floor(rnd(-12, 0)) : y + 1;
      }
    },
  };

  // slow starfield drifting outwards + the odd shooting star
  E.stars = {
    scale: 0.5, opacity: 0.95,
    init() {
      const n = Math.max(60, Math.round(W * H / 3600));
      this.s = [];
      for (let i = 0; i < n; i++) this.s.push({ a: rnd(0, TAU), d: Math.random(), v: rnd(0.4, 1.2), c: i % 3 });
      this.R = Math.max(W, H) * 0.62;
      this.shoot = null; this.nextShoot = rnd(4, 9);
    },
    draw(dt) {
      ctx.clearRect(0, 0, W, H);
      const cx = W / 2, cy = H / 2;
      for (let c = 0; c < 3; c++) {
        ctx.fillStyle = c === 0 ? "#ffffff" : colors[c - 1];
        ctx.beginPath();
        for (const s of this.s) {
          if (s.c !== c) continue;
          s.d += s.v * dt * (0.012 + s.d * 0.05);
          if (s.d > 1.05) { s.d = rnd(0, 0.08); s.a = rnd(0, TAU); }
          const x = cx + Math.cos(s.a) * s.d * this.R, y = cy + Math.sin(s.a) * s.d * this.R;
          const z = 0.5 + s.d * 1.3;
          ctx.rect(x, y, z, z);
        }
        ctx.globalAlpha = c === 0 ? 0.9 : 0.75;
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      this.nextShoot -= dt;
      if (this.nextShoot <= 0 && !this.shoot) {
        this.shoot = { x: rnd(0.1, 0.9) * W, y: rnd(0, 0.35) * H, l: 0 };
        this.nextShoot = rnd(7, 15);
      }
      if (this.shoot) {
        const s = this.shoot; s.l += dt * 1.6;
        ctx.strokeStyle = rgba("#ffffff", Math.max(0, 1 - s.l));
        ctx.beginPath();
        ctx.moveTo(s.x + s.l * 90, s.y + s.l * 45);
        ctx.lineTo(s.x + s.l * 90 - 24, s.y + s.l * 45 - 12);
        ctx.stroke();
        if (s.l >= 1) this.shoot = null;
      }
    },
  };

  // layered sea waves with a few bubbles
  E.waves = {
    scale: 0.25, opacity: 0.9,
    init() {
      this.b = [];
      for (let i = 0; i < 14; i++) this.b.push({ x: rnd(0, W), y: rnd(0, H), r: rnd(0.8, 2.4), v: rnd(5, 16) });
    },
    draw(dt, t) {
      ctx.clearRect(0, 0, W, H);
      for (let k = 0; k < 4; k++) {
        const y0 = H * (0.66 + 0.08 * k), amp = H * (0.05 - 0.008 * k);
        ctx.beginPath();
        ctx.moveTo(0, H);
        for (let x = 0; x <= W + 4; x += 4) {
          ctx.lineTo(x, y0 + Math.sin(x * 0.02 * (1 + k * 0.25) + t * (0.5 + 0.18 * k) + k * 2) * amp +
                        Math.sin(x * 0.011 - t * 0.3) * amp * 0.6);
        }
        ctx.lineTo(W, H);
        ctx.closePath();
        ctx.fillStyle = rgba(colors[k % 2], 0.16 + k * 0.06);
        ctx.fill();
      }
      ctx.fillStyle = rgba("#ffffff", 0.35);
      ctx.beginPath();
      for (const b of this.b) {
        b.y -= b.v * dt;
        if (b.y < -4) { b.y = H + 4; b.x = rnd(0, W); }
        ctx.moveTo(b.x + b.r, b.y);
        ctx.arc(b.x, b.y, b.r, 0, TAU);
      }
      ctx.fill();
    },
  };

  // drifting petals
  E.petals = {
    scale: 0.5, opacity: 0.85,
    init() {
      this.p = [];
      const n = Math.max(14, Math.round(W / 22));
      for (let i = 0; i < n; i++) {
        this.p.push({ x: rnd(0, W), y: rnd(0, H), s: rnd(3, 6), vy: rnd(14, 30), vx: rnd(-6, 8),
          r: rnd(0, TAU), vr: rnd(-1.2, 1.2), ph: rnd(0, TAU), c: i % 2 });
      }
    },
    draw(dt, t) {
      ctx.clearRect(0, 0, W, H);
      for (let c = 0; c < 2; c++) {
        ctx.fillStyle = rgba(colors[c], 0.75);
        for (const p of this.p) {
          if (p.c !== c) continue;
          p.y += p.vy * dt;
          p.x += (p.vx + Math.sin(t * 0.9 + p.ph) * 12) * dt;
          p.r += p.vr * dt;
          if (p.y > H + 10) { p.y = -10; p.x = rnd(0, W); }
          if (p.x > W + 10) p.x = -10; else if (p.x < -10) p.x = W + 10;
          const co = Math.cos(p.r), si = Math.sin(p.r);
          ctx.setTransform(co, si, -si, co, p.x, p.y);
          ctx.beginPath();
          ctx.ellipse(0, 0, p.s, p.s * 0.55, 0, 0, TAU);
          ctx.fill();
        }
      }
      ctx.setTransform(1, 0, 0, 1, 0, 0);
    },
  };

  // rising embers
  E.embers = {
    scale: 0.5, opacity: 0.9,
    init() {
      this.p = [];
      const n = Math.max(30, Math.round(W * H / 5500));
      for (let i = 0; i < n; i++) this.p.push(this.make(true));
    },
    make(anywhere) {
      return { x: rnd(0, W), y: anywhere ? rnd(0, H) : H + 4, vy: rnd(14, 44), vx: rnd(-6, 6),
        r: rnd(0.7, 2), life: rnd(0.4, 1), ph: rnd(0, TAU), c: (Math.random() * 3) | 0 };
    },
    draw(dt, t) {
      ctx.clearRect(0, 0, W, H);
      ctx.globalCompositeOperation = "lighter";
      const cs = [colors[0], colors[1], "#ff7a2e"];
      for (let c = 0; c < 3; c++) {
        ctx.fillStyle = rgba(cs[c], 0.8);
        ctx.beginPath();
        for (let i = 0; i < this.p.length; i++) {
          let p = this.p[i];
          p.y -= p.vy * dt; p.x += (p.vx + Math.sin(t + p.ph) * 5) * dt; p.life -= dt * 0.08;
          if (p.y < -6 || p.life <= 0) p = this.p[i] = this.make(false);
          if (p.c !== c) continue;
          ctx.moveTo(p.x + p.r, p.y);
          ctx.arc(p.x, p.y, p.r * (0.7 + 0.3 * Math.sin(t * 5 + p.ph)), 0, TAU);
        }
        ctx.fill();
      }
      ctx.globalCompositeOperation = "source-over";
    },
  };

  // diagonal rain streaks
  E.rain = {
    scale: 0.5, opacity: 0.8,
    init() {
      this.d = [];
      const n = Math.max(40, Math.round(W / 5));
      for (let i = 0; i < n; i++) this.d.push({ x: rnd(0, W + 40), y: rnd(0, H), l: rnd(7, 17), v: rnd(300, 520), n: i % 2 });
    },
    draw(dt) {
      ctx.clearRect(0, 0, W, H);
      for (let k = 0; k < 2; k++) {
        ctx.strokeStyle = rgba(colors[k], k ? 0.45 : 0.25);
        ctx.beginPath();
        for (const d of this.d) {
          if (d.n !== k) continue;
          d.y += d.v * dt; d.x -= d.v * dt * 0.12;
          if (d.y > H) { d.y = -d.l; d.x = rnd(0, W + 40); }
          ctx.moveTo(d.x, d.y);
          ctx.lineTo(d.x - d.l * 0.12, d.y + d.l);
        }
        ctx.stroke();
      }
    },
  };

  // snowfall
  E.snow = {
    scale: 0.5, opacity: 0.9,
    init() {
      this.f = [];
      const n = Math.max(40, Math.round(W * H / 4200));
      for (let i = 0; i < n; i++) this.f.push({ x: rnd(0, W), y: rnd(0, H), r: rnd(0.7, 2.3), ph: rnd(0, TAU) });
    },
    draw(dt, t) {
      ctx.clearRect(0, 0, W, H);
      ctx.fillStyle = "rgba(255,255,255,0.85)";
      ctx.beginPath();
      for (const f of this.f) {
        f.y += (6 + f.r * 8) * dt;
        f.x += Math.sin(t * 0.6 + f.ph) * 8 * dt;
        if (f.y > H + 3) { f.y = -3; f.x = rnd(0, W); }
        ctx.moveTo(f.x + f.r, f.y);
        ctx.arc(f.x, f.y, f.r, 0, TAU);
      }
      ctx.fill();
    },
  };

  /* ------------------------------------------------------------ engine */
  function size() {
    const sc = fx ? fx.scale : 0.1;
    W = Math.max(8, Math.round(innerWidth * sc));
    H = Math.max(8, Math.round(innerHeight * sc));
    cv.width = W; cv.height = H;
  }

  function stop() { cancelAnimationFrame(raf); raf = 0; }

  function warm(steps) {
    for (let i = 0; i < steps; i++) { T += 0.08; fx.draw(0.08, T); }
  }

  function loop(now) {
    raf = requestAnimationFrame(loop);
    const base = FPS[name] || 15, fps = level === "eco" ? Math.max(6, base / 2) : base;
    if (now - last < 1000 / fps - 3) return;
    const dt = Math.min((now - last) / 1000, 0.2);
    last = now;
    T += dt;
    fx.draw(dt, T);
  }

  function restart() {
    stop();
    if (!fx) return;
    size();
    fx.init();
    cv.style.opacity = fx.opacity == null ? 1 : fx.opacity;
    if (level === "off" || fx === E.none) {
      warm(name === "matrix" ? 90 : 25);   // a populated still frame
      return;
    }
    if (name === "matrix") warm(40);
    last = 0;
    raf = requestAnimationFrame(loop);
  }

  window.FX = {
    set(n, c, lv) {
      name = E[n] ? n : "none";
      fx = E[name];
      colors = c && c.length ? c : colors;
      if (lv) level = lv;
      restart();
    },
    setLevel(lv) {
      if (lv === level) return;
      level = lv;
      restart();
    },
    names: Object.keys(E),
  };

  let rt = 0;
  addEventListener("resize", () => { clearTimeout(rt); rt = setTimeout(restart, 250); });
})();
