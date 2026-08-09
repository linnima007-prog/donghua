# -*- coding: utf-8 -*-
"""序列帧动画编辑器 - 本地服务器

功能：
  - /api/manifest  返回所有角色的动作序列帧清单 (JSON)
  - /api/upload    接收客户端上传的新动作帧 (POST, JSON)
  - 托管整个项目目录（角色图片、编辑器静态文件）

启动：
  python server.py
  然后浏览器打开 http://localhost:8765/
"""
import base64
import binascii
import json
import os
import re
import sys
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse

# 本项目根目录
if getattr(sys, "frozen", False):
    # 打包成 exe 运行时：数据根目录 = exe 所在目录（exe 与角色文件夹放在一起）
    ROOT = os.path.dirname(os.path.abspath(sys.executable))
else:
    # 脚本运行时：server.py 位于 sequence-editor/ 内，根目录为其父目录
    SERVER_DIR = os.path.dirname(os.path.abspath(__file__))
    ROOT = os.path.dirname(SERVER_DIR)

PORT = 8765

# 常用动作的展示顺序（其余动作按字母序排在后面）
ACTION_ORDER = ["Walk", "walk", "Run", "run", "Harm", "Hit", "Death", "Shoot", "Attack", "Skill", "Cast", "Idle"]

FRAME_RE = re.compile(r"^.+?-(.+?)_(\d+)\.png$", re.IGNORECASE)

# 用于上传接口的名字白名单：字母/数字/下划线/中文，避免路径穿越与非法字符
SAFE_NAME_RE = re.compile(r"^[A-Za-z0-9_\u4e00-\u9fff]+$")

MAX_FRAMES = 200
MAX_BODY = 300 * 1024 * 1024  # 请求体上限 300MB


def sanitize_name(name, maxlen=40):
    """清洗角色名/动作名，非法返回 None。"""
    if not isinstance(name, str):
        return None
    name = name.strip()
    if not name or len(name) > maxlen:
        return None
    if not SAFE_NAME_RE.match(name):
        return None
    return name


def handle_upload(self):
    """接收客户端上传的新动作帧（JSON: {character, action, frames:[dataURL...]}）。"""
    try:
        length = int(self.headers.get("Content-Length", 0))
        if length <= 0 or length > MAX_BODY:
            self.send_error(413, "请求体过大")
            return
        body = self.rfile.read(length)
        data = json.loads(body.decode("utf-8"))
    except Exception as e:
        self.send_error(400, "无法解析请求: " + str(e))
        return

    char_id = sanitize_name(data.get("character", ""))
    action = sanitize_name(data.get("action", ""))
    frames = data.get("frames")
    if not char_id:
        self.send_error(400, "角色名不合法")
        return
    if not action:
        self.send_error(400, "动作名不合法")
        return
    if not isinstance(frames, list) or not frames:
        self.send_error(400, "没有收到帧图片")
        return
    if len(frames) > MAX_FRAMES:
        self.send_error(400, f"帧数过多（最多 {MAX_FRAMES} 帧）")
        return

    # 校验角色文件夹存在
    char_dir = os.path.join(ROOT, char_id)
    if not os.path.isdir(char_dir):
        self.send_error(404, "角色不存在: " + char_id)
        return
    png_dir = os.path.join(char_dir, "PNG")
    os.makedirs(png_dir, exist_ok=True)

    # 计算起始帧号：取该动作已存在帧的最大号 + 1
    prefix = char_id + "-" + action + "_"
    existing = []
    try:
        for f in os.listdir(png_dir):
            if f.startswith(prefix) and f.endswith(".png"):
                num = f[len(prefix):-4]
                if num.isdigit():
                    existing.append(int(num))
    except OSError:
        pass
    start = max(existing, default=-1) + 1

    written = []
    for i, frame in enumerate(frames):
        try:
            if isinstance(frame, str) and frame.startswith("data:"):
                b64 = frame.split(",", 1)[1]
            else:
                b64 = frame
            raw = base64.b64decode(b64)
        except (binascii.Error, ValueError, TypeError):
            self.send_error(400, f"第 {i + 1} 张图片解码失败")
            return
        if not raw:
            continue
        if not raw.startswith(b"\x89PNG"):
            self.send_error(400, f"第 {i + 1} 张图片不是 PNG 格式")
            return
        filename = f"{prefix}{start + i}.png"
        with open(os.path.join(png_dir, filename), "wb") as fh:
            fh.write(raw)
        written.append(f"/{char_id}/PNG/{filename}")

    if not written:
        self.send_error(400, "未写入任何帧")
        return

    resp = json.dumps(
        {"ok": True, "character": char_id, "action": action, "frames": written},
        ensure_ascii=False,
    ).encode("utf-8")
    self.send_response(200)
    self.send_header("Content-Type", "application/json; charset=utf-8")
    self.send_header("Content-Length", str(len(resp)))
    self.end_headers()
    self.wfile.write(resp)


def parse_frame_file(filename):
    """从 'abo-Walk_3.png' 解析出 (动作名, 帧序号)。失败返回 None。"""
    m = FRAME_RE.match(filename)
    if m:
        return m.group(1), int(m.group(2))
    return None


def scan_characters():
    """扫描所有角色文件夹，返回:
    [{ "id": 文件夹名, "actions": {"动作名": [相对路径...]} }, ...]
    """
    characters = []
    try:
        entries = sorted(os.listdir(ROOT))
    except OSError as e:
        print("[scan] 无法读取目录:", e)
        return characters

    for entry in entries:
        entry_path = os.path.join(ROOT, entry)
        if not os.path.isdir(entry_path) or entry.startswith("."):
            continue
        char = {"id": entry, "actions": {}}

        png_dir = os.path.join(entry_path, "PNG")
        if os.path.isdir(png_dir):
            try:
                files = sorted(os.listdir(png_dir))
            except OSError:
                files = []

            for f in files:
                if not f.lower().endswith(".png"):
                    continue
                parsed = parse_frame_file(f)
                if not parsed:
                    continue
                action, frame = parsed
                char["actions"].setdefault(action, []).append((frame, "/" + entry + "/PNG/" + f))

        # 按帧号排序，只保留路径
        for action in list(char["actions"]):
            frames = char["actions"][action]
            frames.sort(key=lambda x: x[0])
            char["actions"][action] = [p for _, p in frames]

        # 特殊：没有 PNG 目录、但文件夹内直接放同名图片（如 veronica.png/veronica.png）
        if not char["actions"]:
            candidates = [entry + ".png"]
            if entry.lower().endswith(".png"):
                candidates.insert(0, entry)
            for cand in candidates:
                inner_img = os.path.join(entry_path, cand)
                if os.path.isfile(inner_img):
                    rel = "/" + entry + "/" + cand
                    char["actions"]["单帧"] = [rel]
                    break

        if not char["actions"]:
            continue

        # 按常用动作顺序重排
        ordered = {}
        for a in ACTION_ORDER:
            if a in char["actions"]:
                ordered[a] = char["actions"].pop(a)
        for a in sorted(char["actions"]):
            ordered[a] = char["actions"][a]
        char["actions"] = ordered

        characters.append(char)
    return characters


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    def end_headers(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def do_GET(self):
        parsed = urlparse(self.path)
        if parsed.path == "/api/manifest":
            data = json.dumps(scan_characters(), ensure_ascii=False).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)
            return

        # 根路径重定向到编辑器（保证相对路径资源正确解析）
        if parsed.path in ("/", "/index.html", "/sequence-editor"):
            self.send_response(302)
            self.send_header("Location", "/sequence-editor/")
            self.end_headers()
            return
        super().do_GET()

    def do_POST(self):
        parsed = urlparse(self.path)
        if parsed.path == "/api/upload":
            handle_upload(self)
            return
        self.send_error(404)

    def log_message(self, fmt, *args):
        # 精简日志：图片请求不打印，避免刷屏
        if args and isinstance(args[0], str) and any(
            args[0].startswith(p) for p in ("/PNG", "/sequence-editor", "/api/")):
            return
        sys.stdout.write(f"[server] {self.address_string()} {fmt % args}\n")


if __name__ == "__main__":
    print("=" * 56)
    print("  序列帧动画编辑器")
    print(f"  项目根目录 : {ROOT}")
    print(f"  打开浏览器  : http://localhost:{PORT}/")
    print("  按 Ctrl+C 停止服务")
    print("=" * 56)
    try:
        ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
    except KeyboardInterrupt:
        print("\n服务已停止。")
