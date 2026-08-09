/* ===== 序列帧动画编辑器 ===== */
(() => {
  "use strict";

  // ---------- DOM ----------
  const $ = (id) => document.getElementById(id);
  const charListEl = $("charList");
  const searchInput = $("searchInput");
  const matchCountEl = $("matchCount");
  const totalInfoEl = $("totalInfo");
  const actionTabsEl = $("actionTabs");
  const actionTabList = $("actionTabList");
  const canvas = $("previewCanvas");
  const ctx = canvas.getContext("2d");
  const canvasWrap = $("canvasWrap");
  const emptyHint = $("emptyHint");
  const filmstrip = $("filmstrip");
  const btnPrev = $("btnPrev");
  const btnPlay = $("btnPlay");
  const btnNext = $("btnNext");
  const btnStop = $("btnStop");
  const frameSlider = $("frameSlider");
  const frameLabel = $("frameLabel");
  const fpsSlider = $("fpsSlider");
  const fpsLabel = $("fpsLabel");
  const loopToggle = $("loopToggle");
  const onionToggle = $("onionToggle");
  const zoomSelect = $("zoomSelect");
  const infoChar = $("infoChar");
  const infoAction = $("infoAction");
  const infoFrame = $("infoFrame");
  const infoSize = $("infoSize");
  const btnImportAction = $("btnImportAction");
  const btnExportGif = $("btnExportGif");
  const btnExportSprite = $("btnExportSprite");
  const btnExportAtlas = $("btnExportAtlas");
  const btnPivot = $("btnPivot");
  const pivotCoords = $("pivotCoords");
  const pivotInputX = $("pivotInputX");
  const pivotInputY = $("pivotInputY");
  // 上传弹窗
  const uploadModal = $("uploadModal");
  const uploadClose = $("uploadClose");
  const uploadCancel = $("uploadCancel");
  const uploadCharName = $("uploadCharName");
  const uploadActionName = $("uploadActionName");
  const uploadFiles = $("uploadFiles");
  const uploadFilesLabel = $("uploadFilesLabel");
  const uploadPreview = $("uploadPreview");
  const uploadMsg = $("uploadMsg");
  const uploadSubmit = $("uploadSubmit");

  // ---------- 状态 ----------
  const state = {
    manifest: [],        // 原始清单
    chars: [],           // 过滤后的角色列表
    cur: null,           // 当前角色 {id, actions}
    action: null,        // 当前动作名
    frames: [],          // 当前动作的帧路径
    imgs: [],            // 已加载的 Image
    frameIdx: 0,
    playing: false,
    fps: 10,
    loop: true,
    onion: false,
    triggers: new Set(), // [帧触发器] 当前动作中标记为触发帧的帧索引集合
    _triggersByAction: {}, // [帧触发器] 每个动作的触发器存储 { actionName: Set }
    maxW: 1,
    maxH: 1,
    rafId: null,
    lastTs: 0,
    loaded: false,       // 当前动作图片是否加载完
    upFrames: [],        // 上传暂存的 dataURL 列表
    pivotX: -1,          // 重心点 X（相对 maxW×maxH 画布，-1=未设置/使用中心）
    pivotY: -1,          // 重心点 Y
    pivotMode: false,    // 是否处于重心点设置模式
  };

  // ---------- 工具 ----------
  function debounce(fn, ms) {
    let t;
    return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
  }

  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("加载失败: " + src));
      img.src = src;
    });
  }

  // ---------- 清单加载 ----------
  async function loadManifest() {
    try {
      const res = await fetch("/api/manifest");
      if (!res.ok) throw new Error(res.status);
      state.manifest = await res.json();
    } catch (e) {
      totalInfoEl.textContent = "⚠️ 清单加载失败，请确认服务已启动";
      console.error(e);
      return;
    }
    const total = state.manifest.length;
    totalInfoEl.textContent = `共 ${total} 个角色`;
    state.chars = [...state.manifest];
    renderCharList();
    updateImportBtn();
    updateExportBtns();
  }

  // ---------- 角色列表 ----------
  function renderCharList() {
    const q = searchInput.value.trim().toLowerCase();
    const list = q ? state.manifest.filter((c) => c.id.toLowerCase().includes(q)) : state.manifest;
    state.chars = list;
    matchCountEl.textContent = q ? `${list.length}/${state.manifest.length}` : "";

    charListEl.innerHTML = "";
    list.forEach((c) => {
      const li = document.createElement("li");
      li.className = "char-item" + (state.cur && state.cur.id === c.id ? " active" : "");
      li.dataset.id = c.id;

      const thumb = document.createElement("img");
      thumb.className = "thumb";
      thumb.alt = "";
      const firstPath = firstFramePath(c);
      if (firstPath) {
        thumb.onload = () => {};
        thumb.src = firstPath;
      }

      const name = document.createElement("span");
      name.className = "name";
      name.textContent = c.id;

      const ac = document.createElement("span");
      ac.className = "ac";
      const keys = Object.keys(c.actions);
      ac.textContent = keys.slice(0, 3).join(" / ") + (keys.length > 3 ? " …" : "");

      li.append(thumb, name, ac);
      li.addEventListener("click", () => selectCharacter(c));
      charListEl.appendChild(li);
    });
  }

  function firstFramePath(char) {
    const keys = Object.keys(char.actions);
    if (!keys.length) return null;
    // 优先 Walk / walk，其次任意第一个动作
    const pick = keys.find((k) => k.toLowerCase() === "walk") || keys[0];
    return char.actions[pick][0];
  }

  // ---------- 选择角色 ----------
  function selectCharacter(char) {
    state.cur = char;
    state.playing = false;
    state.action = null;
    state.pivotMode = false;
    updatePivotUI();
    // 默认选中第一个动作
    const keys = Object.keys(char.actions);
    if (keys.length) {
      state.action = keys.find((k) => k.toLowerCase() === "walk") || keys[0];
    }
    state.frameIdx = 0;

    // 高亮列表
    document.querySelectorAll(".char-item").forEach((el) => {
      el.classList.toggle("active", el.dataset.id === char.id);
    });

    renderActionTabs();
    if (state.action) {
      loadActionFrames(state.action, true);
    } else {
      showEmpty("该角色没有可用动作");
    }
    updatePlayBtn();
  }

  // ---------- 动作标签 ----------
  function renderActionTabs() {
    actionTabList.innerHTML = "";
    if (!state.cur) {
      updateImportBtn();
      updateExportBtns();
      return;
    }
    Object.keys(state.cur.actions).forEach((a) => {
      const btn = document.createElement("button");
      btn.className = "action-tab" + (a === state.action ? " active" : "");
      btn.innerHTML = `<span>${a}</span><span class="cnt">${state.cur.actions[a].length}</span>`;
      btn.addEventListener("click", () => {
        if (a === state.action) return;
        state.action = a;
        state.frameIdx = 0;
        state.playing = false;
        renderActionTabs();
        loadActionFrames(a, true);
        updatePlayBtn();
      });
      actionTabList.appendChild(btn);
    });
    updateImportBtn();
    updateExportBtns();
  }

  // ---------- 加载动作帧 ----------
  async function loadActionFrames(actionName, autoplay) {
    if (!state.cur || !state.cur.actions[actionName]) return;
    state.frames = state.cur.actions[actionName];
    state.action = actionName;
    state.loaded = false;
    showEmpty("正在加载帧…");
    hideEmpty(false);

    const paths = state.frames;
    try {
      const imgs = await Promise.all(paths.map((p) => loadImage(p)));
      // 防止快速切换动作时的竞态
      if (state.action !== actionName) return;
      state.imgs = imgs;
      state.loaded = true;

      // 计算最大尺寸
      let w = 1, h = 1;
      imgs.forEach((im) => {
        if (im.naturalWidth > w) w = im.naturalWidth;
        if (im.naturalHeight > h) h = im.naturalHeight;
      });
      state.maxW = w;
      state.maxH = h;

      // 加载已保存的重心点
      loadPivot();
      updatePivotUI();

      state.frameIdx = Math.min(state.frameIdx, paths.length - 1);
      // [帧触发器] 加载已保存的触发器（按动作存储），或初始化为空
      state.triggers = state._triggersByAction[actionName] || new Set();
      updateFrameSlider();
      renderFilmstrip();
      updateInfo();
      draw();
      updateExportBtns();

      if (autoplay) {
        startPlay();
      }
    } catch (e) {
      console.error(e);
      showEmpty("⚠️ 图片加载失败");
    }
  }

  // ---------- 帧带 ----------
  function renderFilmstrip() {
    filmstrip.innerHTML = "";
    if (!state.loaded) return;
    state.frames.forEach((p, i) => {
      const item = document.createElement("div");
      item.className = "film-item" + (i === state.frameIdx ? " active" : "");
      const img = document.createElement("img");
      img.src = p;
      img.alt = "frame " + i;
      const idx = document.createElement("span");
      idx.className = "idx";
      idx.textContent = i;
      // [帧触发器] 触发帧开关
      const trig = document.createElement("button");
      trig.className = "trig-toggle" + (state.triggers.has(i) ? " on" : "");
      trig.title = state.triggers.has(i) ? "触发帧（点击取消）" : "设为触发帧";
      trig.textContent = state.triggers.has(i) ? "⚡" : "○";
      trig.addEventListener("click", (ev) => {
        ev.stopPropagation();
        if (state.triggers.has(i)) {
          state.triggers.delete(i);
        } else {
          state.triggers.add(i);
        }
        state._triggersByAction[state.action] = state.triggers;
        renderFilmstrip();
      });
      item.append(img, idx, trig);
      item.addEventListener("click", () => {
        state.frameIdx = i;
        updateFrameSlider();
        draw();
        renderFilmstrip();
      });
      filmstrip.appendChild(item);
    });
    const active = filmstrip.querySelector(".film-item.active");
    if (active) active.scrollIntoView({ block: "nearest", inline: "nearest" });
  }

  // ---------- 绘制 ----------
  function computeScale() {
    const wrapW = canvasWrap.clientWidth - 20;
    const wrapH = canvasWrap.clientHeight - 20;
    let base = Math.min(wrapW / state.maxW, wrapH / state.maxH);
    if (!isFinite(base) || base <= 0) base = 1;
    const zoom = parseFloat(zoomSelect.value);
    return isNaN(zoom) ? base : base * zoom;
  }

  function setCanvasSize(w, h) {
    const dpr = window.devicePixelRatio || 1;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    canvas.style.width = w + "px";
    canvas.style.height = h + "px";
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function draw() {
    const cw = canvasWrap.clientWidth;
    const ch = canvasWrap.clientHeight;
    if (!state.loaded || !state.imgs.length) {
      setCanvasSize(Math.max(cw - 40, 1), Math.max(ch - 40, 1));
      ctx.clearRect(0, 0, cw, ch);
      return;
    }
    const scale = computeScale();
    const dw = state.maxW * scale;
    const dh = state.maxH * scale;
    setCanvasSize(dw, dh);

    const cx = dw / 2;
    const cy = dh / 2;
    ctx.clearRect(0, 0, dw, dh);

    const img = state.imgs[state.frameIdx];
    if (!img) return;

    // 洋葱皮：绘制上一帧半透明
    if (state.onion && state.frameIdx > 0) {
      const prev = state.imgs[state.frameIdx - 1];
      if (prev) {
        ctx.globalAlpha = 0.25;
        ctx.drawImage(prev, cx - (prev.naturalWidth * scale) / 2,
                          cy - (prev.naturalHeight * scale) / 2,
                          prev.naturalWidth * scale, prev.naturalHeight * scale);
        ctx.globalAlpha = 1;
      }
    }

    ctx.drawImage(img, cx - (img.naturalWidth * scale) / 2,
                       cy - (img.naturalHeight * scale) / 2,
                       img.naturalWidth * scale, img.naturalHeight * scale);

    // 绘制重心点标记到 canvas
    drawPivotOnCanvas(cx, cy, scale);
  }

  function drawPivotOnCanvas(cx, cy, scale) {
    if (!state.loaded) return;
    // 只在已设置重心点或处于重心点编辑模式时显示
    if (!state.pivotMode && state.pivotX < 0 && state.pivotY < 0) return;
    const p = getEffectivePivot();
    const px = p.x * scale;
    const py = p.y * scale;
    const r = 6 + 1 / scale; // 标记半径，随缩放自适应

    ctx.save();
    ctx.strokeStyle = "#ff4444";
    ctx.lineWidth = Math.max(1.5, 2 / scale);
    ctx.shadowColor = "rgba(0,0,0,.8)";
    ctx.shadowBlur = 4;

    // 十字线
    ctx.beginPath();
    ctx.moveTo(px - r, py);
    ctx.lineTo(px + r, py);
    ctx.moveTo(px, py - r);
    ctx.lineTo(px, py + r);
    ctx.stroke();

    // 外圈
    ctx.strokeStyle = "rgba(255,255,255,.8)";
    ctx.lineWidth = Math.max(1, 1.5 / scale);
    ctx.beginPath();
    ctx.arc(px, py, r - 1, 0, Math.PI * 2);
    ctx.stroke();

    ctx.restore();
  }

  function showEmpty(msg) {
    emptyHint.textContent = msg;
    emptyHint.classList.remove("hidden");
  }
  function hideEmpty() {
    emptyHint.classList.add("hidden");
  }

  // ---------- 控制 ----------
  function startPlay() {
    if (state.playing || !state.loaded || state.imgs.length < 2) return;
    state.playing = true;
    state.lastTs = performance.now();
    updatePlayBtn();
    cancelAnimationFrame(state.rafId);
    state.rafId = requestAnimationFrame(tick);
  }

  function pausePlay() {
    state.playing = false;
    cancelAnimationFrame(state.rafId);
    updatePlayBtn();
  }

  function tick(ts) {
    if (!state.playing) return;
    const interval = 1000 / state.fps;
    let dt = ts - state.lastTs;

    // 页面切走/切回等长时间停顿：只按一帧处理，避免猛跳
    if (dt > 500) {
      state.lastTs = ts;
      dt = 0;
    }

    if (dt >= interval) {
      const steps = Math.floor(dt / interval);
      for (let i = 0; i < steps; i++) {
        if (state.frameIdx >= state.frames.length - 1) {
          if (state.loop) {
            state.frameIdx = 0;
          } else {
            state.frameIdx = state.frames.length - 1;
            pausePlay();
            break;
          }
        } else {
          state.frameIdx++;
        }
      }
      // 只消耗已用的时间，保留不足一帧的余量，保证播放速度准确
      state.lastTs += steps * interval;
      updateFrameSlider();
      draw();
      syncFilmstrip();
    }

    // 仍在播放才继续调度
    if (state.playing) state.rafId = requestAnimationFrame(tick);
  }

  function updatePlayBtn() {
    btnPlay.textContent = state.playing ? "⏸" : "▶";
  }

  function setFrame(i) {
    if (!state.loaded) return;
    state.frameIdx = Math.max(0, Math.min(i, state.frames.length - 1));
    updateFrameSlider();
    draw();
    syncFilmstrip();
  }

  function updateFrameSlider() {
    const max = state.loaded ? state.frames.length - 1 : 0;
    frameSlider.max = max;
    frameSlider.value = state.frameIdx;
    frameLabel.textContent = state.loaded ? `${state.frameIdx + 1}/${state.frames.length}` : "0/0";
  }

  function syncFilmstrip() {
    const items = filmstrip.children;
    for (let i = 0; i < items.length; i++) {
      items[i].classList.toggle("active", i === state.frameIdx);
    }
  }

  function updateInfo() {
    infoChar.textContent = state.cur ? state.cur.id : "—";
    infoAction.textContent = state.action || "—";
    infoFrame.textContent = state.loaded
      ? `帧 ${state.frameIdx + 1}/${state.frames.length}`
      : "帧 —";
    infoSize.textContent = state.loaded ? `${state.maxW} × ${state.maxH}` : "—";
  }

  // ---------- 事件 ----------
  btnPlay.addEventListener("click", () => (state.playing ? pausePlay() : startPlay()));
  btnPrev.addEventListener("click", () => {
    pausePlay();
    setFrame(state.frameIdx - 1);
  });
  btnNext.addEventListener("click", () => {
    pausePlay();
    setFrame(state.frameIdx + 1);
  });
  btnStop.addEventListener("click", () => {
    pausePlay();
    setFrame(0);
  });

  frameSlider.addEventListener("input", () => {
    setFrame(parseInt(frameSlider.value, 10));
  });

  fpsSlider.addEventListener("input", () => {
    state.fps = parseInt(fpsSlider.value, 10);
    fpsLabel.textContent = state.fps;
  });

  loopToggle.addEventListener("change", () => { state.loop = loopToggle.checked; });
  onionToggle.addEventListener("change", () => {
    state.onion = onionToggle.checked;
    draw();
  });
  zoomSelect.addEventListener("change", () => draw());

  searchInput.addEventListener("input", debounce(renderCharList, 120));

  window.addEventListener("resize", debounce(draw, 120));

  // 键盘快捷键
  document.addEventListener("keydown", (e) => {
    if (e.target.tagName === "INPUT") return;
    if (e.code === "Space") {
      e.preventDefault();
      state.playing ? pausePlay() : startPlay();
    } else if (e.code === "ArrowLeft") {
      e.preventDefault();
      pausePlay();
      setFrame(state.frameIdx - 1);
    } else if (e.code === "ArrowRight") {
      e.preventDefault();
      pausePlay();
      setFrame(state.frameIdx + 1);
    } else if (e.code === "KeyP") {
      e.preventDefault();
      togglePivotMode();
    }
  });

  // ================= 上传/导入新动作 =================
  function updateImportBtn() {
    btnImportAction.disabled = !state.cur;
  }

  function updateExportBtns() {
    const can = !!(state.loaded && state.imgs && state.imgs.length);
    btnExportGif.disabled = !can;
    btnExportSprite.disabled = !can;
    // 图集以角色为单位，只要选中了有动作的角色即可导出
    const canAtlas = !!(state.cur && state.cur.actions && Object.keys(state.cur.actions).length);
    btnExportAtlas.disabled = !canAtlas;
  }

  function openUploadModal() {
    if (!state.cur) return;
    pausePlay();
    uploadCharName.textContent = state.cur.id;
    uploadActionName.value = "";
    state.upFrames = [];
    uploadFiles.value = "";
    uploadFilesLabel.textContent = "选择 PNG 图片（可多选，按顺序排列）";
    uploadFilesLabel.classList.remove("has-files");
    uploadPreview.innerHTML = "";
    uploadMsg.textContent = "";
    uploadMsg.className = "upload-msg";
    uploadSubmit.disabled = true;
    uploadModal.classList.remove("hidden");
    uploadActionName.focus();
  }

  function closeUploadModal() {
    uploadModal.classList.add("hidden");
  }

  function renderUploadPreview() {
    uploadPreview.innerHTML = "";
    state.upFrames.forEach((d, i) => {
      const item = document.createElement("div");
      item.className = "up-item";
      const img = document.createElement("img");
      img.src = d;
      const idx = document.createElement("span");
      idx.className = "up-idx";
      idx.textContent = i;
      const del = document.createElement("button");
      del.className = "up-del";
      del.textContent = "✕";
      del.title = "移除该帧";
      del.addEventListener("click", () => {
        state.upFrames.splice(i, 1);
        renderUploadPreview();
        updateUploadState();
      });
      item.append(img, idx, del);
      uploadPreview.appendChild(item);
    });
  }

  function updateUploadState() {
    const n = state.upFrames.length;
    if (n > 0) {
      uploadFilesLabel.textContent = `已选择 ${n} 张图片`;
      uploadFilesLabel.classList.add("has-files");
    } else {
      uploadFilesLabel.textContent = "选择 PNG 图片（可多选，按顺序排列）";
      uploadFilesLabel.classList.remove("has-files");
    }
    const name = uploadActionName.value.trim();
    const okName = /^[A-Za-z0-9_\u4e00-\u9fff]{1,40}$/.test(name);
    uploadSubmit.disabled = !(n > 0 && okName);
  }

  function readFilesAsDataURL(files) {
    return Promise.all(
      Array.from(files).map((f) => new Promise((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(r.result);
        r.onerror = () => reject(new Error("读取失败: " + f.name));
        r.readAsDataURL(f);
      }))
    );
  }

  async function submitUpload() {
    const action = uploadActionName.value.trim();
    if (!state.cur || !action || !state.upFrames.length) return;
    pausePlay();
    uploadMsg.textContent = "上传中…";
    uploadMsg.className = "upload-msg";
    uploadSubmit.disabled = true;
    try {
      const res = await fetch("/api/upload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ character: state.cur.id, action, frames: state.upFrames }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || `HTTP ${res.status}`);
      uploadMsg.textContent = `✅ 已上传 ${data.frames.length} 帧到动作「${action}」`;
      uploadMsg.className = "upload-msg ok";
      await refreshManifestAndSelect(action);
      closeUploadModal();
    } catch (e) {
      uploadMsg.textContent = "❌ " + (e && e.message ? e.message : String(e));
      uploadMsg.className = "upload-msg err";
      updateUploadState();
    }
  }

  async function refreshManifestAndSelect(actionName) {
    const charId = state.cur ? state.cur.id : null;
    await loadManifest();
    if (!charId) return;
    const char = state.manifest.find((c) => c.id === charId);
    if (!char) return;
    state.cur = char;
    state.action = actionName;
    state.frameIdx = 0;
    state.playing = false;
    document.querySelectorAll(".char-item").forEach((el) => {
      el.classList.toggle("active", el.dataset.id === charId);
    });
    renderActionTabs();
    if (state.action) loadActionFrames(state.action, true);
    updatePlayBtn();
  }

  btnImportAction.addEventListener("click", openUploadModal);
  uploadClose.addEventListener("click", closeUploadModal);
  uploadCancel.addEventListener("click", closeUploadModal);
  uploadModal.addEventListener("click", (e) => {
    if (e.target === uploadModal) closeUploadModal();
  });
  uploadFiles.addEventListener("change", async () => {
    try {
      const files = Array.from(uploadFiles.files || []);
      const dataURLs = await readFilesAsDataURL(files);
      state.upFrames = state.upFrames.concat(dataURLs);
      renderUploadPreview();
      updateUploadState();
    } catch (e) {
      uploadMsg.textContent = "❌ " + e.message;
      uploadMsg.className = "upload-msg err";
    }
  });
  uploadActionName.addEventListener("input", updateUploadState);
  uploadSubmit.addEventListener("click", submitUpload);

  // ================= 导出 =================
  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 3000);
  }

  // ---------- 最小 ZIP 打包（STORED 无压缩，PNG 本身已压缩） ----------
  const CRC_TABLE = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      t[n] = c >>> 0;
    }
    return t;
  })();

  function crc32(data) {
    let c = 0xFFFFFFFF;
    for (let i = 0; i < data.length; i++) {
      c = CRC_TABLE[(c ^ data[i]) & 0xFF] ^ (c >>> 8);
    }
    return (c ^ 0xFFFFFFFF) >>> 0;
  }

  function makeZip(entries) {
    // entries: [{ name, data: Uint8Array }]
    const enc = new TextEncoder();
    const chunks = [];
    const central = [];
    let offset = 0;

    for (const e of entries) {
      const name = enc.encode(e.name);
      const data = e.data;
      const crc = crc32(data);

      const lfh = new Uint8Array(30);
      const lv = new DataView(lfh.buffer);
      lv.setUint32(0, 0x04034b50, true);       // local file header signature
      lv.setUint16(4, 20, true);               // version needed
      lv.setUint16(6, 0x0800, true);           // flags: UTF-8
      lv.setUint16(8, 0, true);                // method: stored
      lv.setUint32(14, crc, true);             // crc32
      lv.setUint32(18, data.length, true);     // compressed size
      lv.setUint32(22, data.length, true);     // uncompressed size
      lv.setUint16(26, name.length, true);     // file name length

      chunks.push(lfh, name, data);
      central.push({ name, crc, size: data.length, offset });
      offset += 30 + name.length + data.length;
    }

    const cdStart = offset;
    for (const c of central) {
      const cd = new Uint8Array(46);
      const v = new DataView(cd.buffer);
      v.setUint32(0, 0x02014b50, true);        // central directory signature
      v.setUint16(4, 20, true);                // version made by
      v.setUint16(6, 20, true);                // version needed
      v.setUint16(8, 0x0800, true);            // flags: UTF-8
      v.setUint16(10, 0, true);                // method: stored
      v.setUint32(16, c.crc, true);
      v.setUint32(20, c.size, true);           // compressed size
      v.setUint32(24, c.size, true);           // uncompressed size
      v.setUint16(28, c.name.length, true);    // file name length
      v.setUint32(42, c.offset, true);         // local header offset
      chunks.push(cd, c.name);
      offset += 46 + c.name.length;
    }

    const eocd = new Uint8Array(22);
    const ev = new DataView(eocd.buffer);
    ev.setUint32(0, 0x06054b50, true);         // end of central dir signature
    ev.setUint16(8, central.length, true);     // entries on this disk
    ev.setUint16(10, central.length, true);    // total entries
    ev.setUint32(12, offset - cdStart, true);  // central dir size
    ev.setUint32(16, cdStart, true);           // central dir offset
    chunks.push(eocd);

    const total = chunks.reduce((s, c) => s + c.length, 0);
    const out = new Uint8Array(total);
    let p = 0;
    for (const c of chunks) { out.set(c, p); p += c.length; }
    return out;
  }

  async function exportSpriteSheet() {
    if (!state.loaded || !state.imgs.length) return;
    pausePlay();
    const pad = 8;
    const W = state.maxW, H = state.maxH;
    const totalW = pad * (state.imgs.length + 1) + W * state.imgs.length;
    const totalH = pad * 2 + H;
    const c = document.createElement("canvas");
    c.width = totalW;
    c.height = totalH;
    const g = c.getContext("2d");
    g.fillStyle = "#000";
    g.fillRect(0, 0, totalW, totalH);
    state.imgs.forEach((img, i) => {
      const dx = pad + i * (W + pad);
      const dy = pad + (H - img.naturalHeight) / 2;
      g.drawImage(img, dx, dy);
    });
    const blob = await new Promise((r) => c.toBlob(r, "image/png"));
    downloadBlob(blob, `${state.cur.id}-${state.action}-sprite.png`);
  }

  // ---------- GIF 导出（中值切分量化 + omggif 编码） ----------
  function medianCutQuantize(colors, maxColors) {
    // colors: [{r,g,b,count}]，返回调色板 [0xRRGGBB,...]（最多 maxColors 个）
    let boxes = [colors];
    while (boxes.length < maxColors) {
      let bi = -1, ch = 0, bestRange = -1;
      for (let i = 0; i < boxes.length; i++) {
        const box = boxes[i];
        if (box.length < 2) continue;
        let minR = 255, maxR = 0, minG = 255, maxG = 0, minB = 255, maxB = 0;
        for (const c of box) {
          if (c.r < minR) minR = c.r; if (c.r > maxR) maxR = c.r;
          if (c.g < minG) minG = c.g; if (c.g > maxG) maxG = c.g;
          if (c.b < minB) minB = c.b; if (c.b > maxB) maxB = c.b;
        }
        const rangeR = maxR - minR, rangeG = maxG - minG, rangeB = maxB - minB;
        const r = Math.max(rangeR, rangeG, rangeB);
        if (r > bestRange) {
          bestRange = r;
          bi = i;
          ch = (rangeR >= rangeG && rangeR >= rangeB) ? 0 : (rangeG >= rangeB ? 1 : 2);
        }
      }
      if (bi < 0) break;
      const box = boxes[bi];
      const key = ch === 0 ? (c) => c.r : ch === 1 ? (c) => c.g : (c) => c.b;
      box.sort((a, b) => key(a) - key(b));
      const total = box.reduce((s, c) => s + c.count, 0);
      let acc = 0, split = 1;
      for (let i = 0; i < box.length - 1; i++) {
        acc += box[i].count;
        if (acc * 2 >= total) { split = i + 1; break; }
      }
      const left = box.slice(0, split), right = box.slice(split);
      boxes.splice(bi, 1, left, right);
    }
    return boxes.map((box) => {
      let tr = 0, tg = 0, tb = 0, n = 0;
      for (const c of box) { tr += c.r * c.count; tg += c.g * c.count; tb += c.b * c.count; n += c.count; }
      n = n || 1;
      return ((tr / n) | 0) << 16 | ((tg / n) | 0) << 8 | ((tb / n) | 0);
    });
  }

  function buildPaletteLUT(palette) {
    // 5-5-5 查找表：返回 index（1..palette.length），0 保留给透明
    const lut = new Uint8Array(32768);
    for (let i = 0; i < 32768; i++) {
      const r8 = (i >> 10 & 31) << 3, g8 = (i >> 5 & 31) << 3, b8 = (i & 31) << 3;
      let best = 1, bestD = Infinity;
      for (let j = 0; j < palette.length; j++) {
        const pr = palette[j] >> 16 & 255, pg = palette[j] >> 8 & 255, pb = palette[j] & 255;
        const dr = pr - r8, dg = pg - g8, db = pb - b8;
        const d = dr * dr + dg * dg + db * db;
        if (d < bestD) { bestD = d; best = j + 1; }
      }
      lut[i] = best;
    }
    return lut;
  }

  function rgbaToIndexed(data, W, H, lut) {
    const idx = new Uint8Array(W * H);
    for (let p = 0, i = 0; i < data.length; i += 4, p++) {
      if (data[i + 3] < 128) {
        idx[p] = 0;
      } else {
        const r5 = data[i] >> 3, g5 = data[i + 1] >> 3, b5 = data[i + 2] >> 3;
        idx[p] = lut[(r5 << 10) | (g5 << 5) | b5];
      }
    }
    return idx;
  }

  async function exportGif() {
    if (!state.loaded || !state.imgs.length) return;
    pausePlay();
    const W = state.maxW, H = state.maxH;
    const delay = Math.max(2, Math.round(100 / state.fps)); // 1/100 秒

    // 1. 渲染所有帧到 RGBA（统一画布，居中）
    const c = document.createElement("canvas");
    c.width = W; c.height = H;
    const g = c.getContext("2d", { willReadFrequently: true });
    const frames = state.imgs.map((img) => {
      g.clearRect(0, 0, W, H);
      g.drawImage(img, (W - img.naturalWidth) / 2, (H - img.naturalHeight) / 2);
      return g.getImageData(0, 0, W, H).data;
    });

    // 2. 4-4-4 直方图（只统计不透明像素）
    const hCount = new Uint32Array(4096);
    const hR = new Float64Array(4096), hG = new Float64Array(4096), hB = new Float64Array(4096);
    frames.forEach((d) => {
      for (let i = 0; i < d.length; i += 4) {
        if (d[i + 3] < 128) continue;
        const key = (d[i] >> 4 << 8) | (d[i + 1] >> 4 << 4) | (d[i + 2] >> 4);
        hCount[key]++;
        hR[key] += d[i]; hG[key] += d[i + 1]; hB[key] += d[i + 2];
      }
    });
    const colors = [];
    for (let key = 0; key < 4096; key++) {
      if (hCount[key]) {
        colors.push({
          r: hR[key] / hCount[key] | 0,
          g: hG[key] / hCount[key] | 0,
          b: hB[key] / hCount[key] | 0,
          count: hCount[key],
        });
      }
    }
    if (!colors.length) { alert("没有可导出的不透明像素"); return; }

    // 3. 中值切分 → 调色板（≤255 色，0 号保留给透明）
    let pal = medianCutQuantize(colors, 255);
    if (pal.length > 255) pal = pal.slice(0, 255);
    let total = pal.length + 1;
    let pow = 1; while (pow < total) pow <<= 1;
    if (pow > 256) pow = 256;
    while (pal.length < pow - 1) pal.push(pal[pal.length - 1] || 0);
    const paletteList = [0x000000].concat(pal); // 0 = 透明

    const lut = buildPaletteLUT(pal);

    // 4. omggif 编码
    let buf = new Uint8Array(1 << 20);
    const gopts = { palette: paletteList };
    if (state.loop) gopts.loop = 0; // 0 = 无限循环
    const gif = new GifWriter(buf, W, H, gopts);
    const growIfNeeded = (need) => {
      const pos = gif.getOutputBufferPosition();
      if (pos + need >= buf.length) {
        const nb = new Uint8Array(Math.max(buf.length * 2, pos + need + 1));
        nb.set(buf.subarray(0, pos));
        gif.setOutputBuffer(nb);
        buf = nb;
      }
    };
    frames.forEach((d) => {
      const idx = rgbaToIndexed(d, W, H, lut);
      growIfNeeded(idx.length + 65536);
      gif.addFrame(0, 0, W, H, idx, { delay, transparent: 0, disposal: 2 });
    });
    growIfNeeded(32);
    gif.end();
    const pos = gif.getOutputBufferPosition();
    const blob = new Blob([buf.subarray(0, pos)], { type: "image/gif" });
    downloadBlob(blob, `${state.cur.id}-${state.action}.gif`);
  }

  btnExportGif.addEventListener("click", exportGif);
  btnExportSprite.addEventListener("click", exportSpriteSheet);

  // ================= 重心点（Pivot）=================
  function getPivotStorageKey() {
    // 全局重心点：不区分角色/动作，始终保持一致
    return "pivot:global";
  }

  function getEffectivePivot() {
    // 返回有效重心点坐标（maxW×maxH 空间），未设置时回退到画布中心
    return {
      x: state.pivotX >= 0 ? state.pivotX : state.maxW / 2,
      y: state.pivotY >= 0 ? state.pivotY : state.maxH / 2,
    };
  }

  function savePivot() {
    const key = getPivotStorageKey();
    try {
      localStorage.setItem(key, JSON.stringify({ x: state.pivotX, y: state.pivotY }));
    } catch (_) { /* localStorage 不可用 */ }
  }

  function loadPivot() {
    const key = getPivotStorageKey();
    try {
      const raw = localStorage.getItem(key);
      if (raw) {
        const v = JSON.parse(raw);
        if (typeof v.x === "number" && typeof v.y === "number" && v.x >= 0 && v.y >= 0) {
          state.pivotX = v.x;
          state.pivotY = v.y;
          return;
        }
      }
    } catch (_) { /* ignore */ }
    state.pivotX = -1;
    state.pivotY = -1;
  }

  function togglePivotMode() {
    state.pivotMode = !state.pivotMode;
    updatePivotUI();
    if (state.pivotMode) {
      pausePlay();
      canvas.style.cursor = "crosshair";
    } else {
      canvas.style.cursor = "";
    }
    draw();
  }

  function updatePivotUI() {
    const active = state.pivotMode;
    btnPivot.classList.toggle("active", active);

    // 显示/隐藏坐标输入框
    if (!state.loaded) {
      pivotCoords.style.display = "none";
      return;
    }
    const p = getEffectivePivot();
    const hasCustom = state.pivotX >= 0 || state.pivotY >= 0;
    if (active || hasCustom) {
      pivotCoords.style.display = "";
      pivotInputX.max = state.maxW;
      pivotInputY.max = state.maxH;
      pivotInputX.value = Math.round(p.x);
      pivotInputY.value = Math.round(p.y);
      pivotInputX.disabled = !active;
      pivotInputY.disabled = !active;
    } else {
      pivotCoords.style.display = "none";
    }
  }

  // 画布点击：设置重心点
  canvas.addEventListener("click", (e) => {
    if (!state.pivotMode || !state.loaded) return;
    const rect = canvas.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    const scale = computeScale();
    // canvas CSS 尺寸 = maxW*scale × maxH*scale，逻辑坐标 = CSS像素 / scale
    const lx = sx / scale;
    const ly = sy / scale;
    // 限制在画布内
    state.pivotX = Math.max(0, Math.min(state.maxW, Math.round(lx)));
    state.pivotY = Math.max(0, Math.min(state.maxH, Math.round(ly)));
    savePivot();
    updatePivotUI();
    draw();
  });

  // 手动输入重心点坐标
  function applyPivotFromInputs() {
    if (!state.loaded) return;
    let changed = false;
    const vx = parseInt(pivotInputX.value, 10);
    if (!isNaN(vx)) {
      const clamped = Math.max(0, Math.min(state.maxW, vx));
      if (state.pivotX !== clamped) { state.pivotX = clamped; changed = true; }
    }
    const vy = parseInt(pivotInputY.value, 10);
    if (!isNaN(vy)) {
      const clamped = Math.max(0, Math.min(state.maxH, vy));
      if (state.pivotY !== clamped) { state.pivotY = clamped; changed = true; }
    }
    if (changed) {
      savePivot();
      draw();
    }
    // 规整显示值
    pivotInputX.value = state.pivotX >= 0 ? state.pivotX : "";
    pivotInputY.value = state.pivotY >= 0 ? state.pivotY : "";
  }
  pivotInputX.addEventListener("input", applyPivotFromInputs);
  pivotInputY.addEventListener("input", applyPivotFromInputs);
  // 失焦时规整
  pivotInputX.addEventListener("change", applyPivotFromInputs);
  pivotInputY.addEventListener("change", applyPivotFromInputs);

  // 像素级微调按钮
  pivotCoords.addEventListener("click", (e) => {
    const btn = e.target.closest(".pivot-step");
    if (!btn || !state.loaded || !state.pivotMode) return;
    const axis = btn.dataset.axis;
    const dir = parseInt(btn.dataset.dir, 10);
    if (axis === "x") {
      state.pivotX = Math.max(0, Math.min(state.maxW, (state.pivotX >= 0 ? state.pivotX : Math.round(state.maxW / 2)) + dir));
    } else {
      state.pivotY = Math.max(0, Math.min(state.maxH, (state.pivotY >= 0 ? state.pivotY : Math.round(state.maxH / 2)) + dir));
    }
    savePivot();
    updatePivotUI();
    draw();
  });

  // 键盘快捷键：P 键切换重心点模式

  // ================= 导出图集（Atlas）=================
  // 查找图片中非透明内容的边界
  function findContentBounds(img, padding) {
    const c = document.createElement("canvas");
    c.width = img.naturalWidth;
    c.height = img.naturalHeight;
    const g = c.getContext("2d");
    g.drawImage(img, 0, 0);
    const d = g.getImageData(0, 0, c.width, c.height).data;
    const w = c.width, h = c.height;

    let minX = w, minY = h, maxX = -1, maxY = -1;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const a = d[(y * w + x) * 4 + 3];
        if (a >= 16) { // 忽略几乎透明的像素
          if (x < minX) minX = x;
          if (y < minY) minY = y;
          if (x > maxX) maxX = x;
          if (y > maxY) maxY = y;
        }
      }
    }

    if (minX > maxX) {
      // 全透明图片，返回 1×1 占位
      return { x: 0, y: 0, w: 1, h: 1 };
    }

    const pad = padding || 2;
    return {
      x: Math.max(0, minX - pad),
      y: Math.max(0, minY - pad),
      w: Math.min(w, maxX + pad + 1) - Math.max(0, minX - pad),
      h: Math.min(h, maxY + pad + 1) - Math.max(0, minY - pad),
    };
  }

  // 图集打包：把多帧放进 maxSize×maxSize 的方块内（默认 2048×2048）
  // 采用多候选宽度 + 行内平铺，取能装下且面积最小的方案
  // 最终尺寸向上取整为 4 的倍数（便于渲染与压缩对齐）
  // 帧打包：贪心 shelf 多页打包（2026-08-09 支持 2048 放不下的情况自动拆分多张图集，每页 ≤ maxSize）
  // 返回 { pages: [{ positions: {帧索引: {x,y}}, totalW, totalH }] }；单帧超过 maxSize（画布过大）返回 null
  function packFrames(rects, maxSize) {
    maxSize = maxSize || 2048;
    const pad = 2;   // 帧间距
    const align = 4; // 对齐粒度
    const roundUp = (v) => Math.ceil(v / align) * align;

    // 单帧超过 maxSize（画布过大）无法打包
    if (rects.some((r) => r.w > maxSize || r.h > maxSize)) return null;

    // 按高度降序排列，高的先放，减少垂直浪费
    const order = rects.map((r, i) => ({ w: r.w, h: r.h, i }))
      .sort((a, b) => b.h - a.h || b.w - a.w);

    // 贪心逐帧放入当前页（宽度=maxSize）；放不下换行；换行垂直空间不足 → 收尾当前页、开新页
    const pages = [];
    let curPos = {}, curX = 0, curY = 0, curRowH = 0, maxRowW = 0;
    const closePage = () => {
      if (curX > maxRowW) maxRowW = curX;
      pages.push({
        positions: curPos,
        totalW: roundUp(Math.max(0, maxRowW - pad)),
        totalH: roundUp(curY + curRowH),
      });
      curPos = {}; curX = 0; curY = 0; curRowH = 0; maxRowW = 0;
    };
    for (const f of order) {
      if (curX > 0 && curX + f.w + pad > maxSize) {
        const nextY = curY + curRowH + pad;
        if (nextY + f.h > maxSize) {
          closePage();  // 换行垂直不够：收尾当前页，该帧开新页
        } else {
          if (curX > maxRowW) maxRowW = curX;
          curX = 0; curY = nextY; curRowH = 0;
        }
      }
      curPos[f.i] = { x: curX, y: curY };
      curX += f.w + pad;
      if (f.h > curRowH) curRowH = f.h;
    }
    if (Object.keys(curPos).length) closePage();
    return { pages };
  }

  // 批量加载某动作的所有帧图片
  async function loadImagesForPaths(paths) {
    return Promise.all(paths.map((p) => loadImage(p)));
  }

  async function exportAtlas() {
    if (!state.cur || !state.cur.actions) return;
    pausePlay();

    const pad = 2;
    const pivot = getEffectivePivot();

    // 1. 收集该角色所有动作的帧（按动作分组加载图片）
    const actionNames = Object.keys(state.cur.actions);
    if (!actionNames.length) { alert("该角色没有可导出的动作"); return; }

    const workList = []; // { action, name, img }
    let gMaxW = 1, gMaxH = 1;
    for (const action of actionNames) {
      const paths = state.cur.actions[action];
      // 当前动作已加载则复用 state.imgs，否则现加载
      let imgs;
      if (state.action === action && state.loaded && state.imgs.length === paths.length) {
        imgs = state.imgs;
      } else {
        imgs = await loadImagesForPaths(paths);
      }
      imgs.forEach((img, i) => {
        const n = img.naturalWidth || 1;
        const h = img.naturalHeight || 1;
        if (n > gMaxW) gMaxW = n;
        if (h > gMaxH) gMaxH = h;
        workList.push({ action, name: `${state.cur.id}-${action}_${i}`, img });
      });
    }

    // 2. 计算每帧裁剪信息 + 重心偏移
    const frameInfos = workList.map((w) => {
      const bounds = findContentBounds(w.img, pad);
      return {
        action: w.action,
        name: w.name,
        img: w.img,
        bounds,
        pivotOffsetX: pivot.x - bounds.x,
        pivotOffsetY: pivot.y - bounds.y,
      };
    });

    // 3. 打包（自动分页，每页 ≤ 2048×2048；2026-08-09 帧数过多时自动拆成多张图集）
    const rects = frameInfos.map((f) => f.bounds);
    const packed = packFrames(rects, 2048);
    if (!packed) {
      alert(`⚠️ 存在单帧超过 2048×2048（画布过大），无法导出。请缩小画布或减小帧图尺寸。`);
      return;
    }
    const pages = packed.pages;
    if (pages.length > 1) {
      console.log(`[图集] ${state.cur.id} 帧数较多，自动拆分为 ${pages.length} 张图集（各 ≤2048×2048）。`);
    }

    // 4. 绘制每页图集
    const pageCanvases = pages.map((pg) => {
      const cv = document.createElement("canvas");
      cv.width = pg.totalW; cv.height = pg.totalH;
      return cv;
    });
    pages.forEach((pg, pi) => {
      const ag = pageCanvases[pi].getContext("2d");
      frameInfos.forEach((f, i) => {
        const pos = pg.positions[i];
        if (!pos) return;  // 该帧不在本页
        ag.drawImage(
          f.img,
          f.bounds.x, f.bounds.y, f.bounds.w, f.bounds.h,
          pos.x, pos.y, f.bounds.w, f.bounds.h,
        );
      });
    });

    const actionsMeta = {};
    frameInfos.forEach((f, i) => {
      const pi = pages.findIndex((pg) => i in pg.positions);
      const pos = pages[pi].positions[i];
      if (!actionsMeta[f.action]) {
        actionsMeta[f.action] = { count: 0, frames: [] };
      }
      actionsMeta[f.action].count++;
      actionsMeta[f.action].frames.push({
        name: f.name,
        page: pi,  // [多页图集]（2026-08-09）：所属页码，游戏端按此选择对应 PNG
        frame: { x: pos.x, y: pos.y, w: f.bounds.w, h: f.bounds.h },
        pivot: {
          x: Math.round(f.pivotOffsetX * 100) / 100,
          y: Math.round(f.pivotOffsetY * 100) / 100,
        },
        sourceSize: { w: f.img.naturalWidth, h: f.img.naturalHeight },
        sourceBounds: { x: f.bounds.x, y: f.bounds.y, w: f.bounds.w, h: f.bounds.h },
      });
    });

    // 5. 打包每页 PNG + JSON 为单个 ZIP 下载（避免浏览器拦截连续下载）
    // [帧触发器] 写入动作级触发器数据
    for (const [actName, actMeta] of Object.entries(actionsMeta)) {
      const trigSet = state._triggersByAction[actName];
      if (trigSet && trigSet.size > 0) {
        actMeta.triggers = [...trigSet].sort((a, b) => a - b).reduce((o, i) => { o[i] = "hit"; return o; }, {});
      }
    }
    const meta = {
      character: state.cur.id,
      pivot: { x: pivot.x, y: pivot.y },
      canvasSize: { w: gMaxW, h: gMaxH },
      atlasSize: { w: pages[0].totalW, h: pages[0].totalH },  // 兼容旧字段：主页尺寸
      pages: pages.map((pg) => ({ w: pg.totalW, h: pg.totalH })),  // [多页图集]（2026-08-09）：每页尺寸
      frameCount: frameInfos.length,
      actions: actionsMeta,
    };
    const pngBufs = [];
    for (const cv of pageCanvases) {
      const blob = await new Promise((r) => cv.toBlob(r, "image/png"));
      pngBufs.push(new Uint8Array(await blob.arrayBuffer()));
    }
    const jsonStr = JSON.stringify(meta, null, 2);
    const jsonBuf = new TextEncoder().encode(jsonStr);

    const zip = makeZip([
      ...pages.map((pg, pi) => ({
        name: pages.length > 1 ? `${state.cur.id}-atlas_${pi}.png` : `${state.cur.id}-atlas.png`,
        data: pngBufs[pi],
      })),
      { name: `${state.cur.id}-atlas.json`, data: jsonBuf },
    ]);
    const zipBlob = new Blob([zip], { type: "application/zip" });
    downloadBlob(zipBlob, `${state.cur.id}-atlas.zip`);
  }

  btnPivot.addEventListener("click", togglePivotMode);
  btnExportAtlas.addEventListener("click", exportAtlas);

  // ---------- 启动 ----------
  loadManifest();
})();
