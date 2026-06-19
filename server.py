import http.server
import socketserver
import json
import os
import time
import threading
import queue
import urllib.parse

PORT = 3000
PUBLIC_DIR = os.path.join(os.getcwd(), 'public')

# 전역 상태 및 동기화 락
state_lock = threading.Lock()
ticket_counter = 0

# 학번 -> { "ticket_number": int, "name": str, "token": str, "expiry": float }
issued_tickets = {}

# 학번 -> { "clientId": str, "name": str }
logged_in_users = {}

# 대시보드 상태 데이터
system_status = {
    "zone_congestion": "여유",      # 여유, 보통, 혼잡, 진입제한
    "passage_congestion": "보통",   # 여유, 보통, 혼잡, 진입제한
    "current_artist": "고려대학교 응원단",
    "emergency_announcement": "민주광장 고대생 존 대기 줄 발급이 시작되었습니다. 안전 요원의 통제에 잘 따라주시기 바랍니다.",
    "announcements": [
        {"time": "14:30", "text": "민주광장 고대생 존 대기 줄 발급이 시작되었습니다. 안전 요원의 통제에 잘 따라주시기 바랍니다."}
    ]
}

# SSE 클라이언트 목록 및 락
sse_clients = []
sse_lock = threading.Lock()

class SSEClient:
    def __init__(self):
        self.queue = queue.Queue()
        self.active = True

    def send_message(self, message):
        if self.active:
            self.queue.put(message)

    def get_message(self, timeout=None):
        try:
            return self.queue.get(timeout=timeout)
        except queue.Empty:
            return None

def broadcast_status():
    with sse_lock:
        payload = json.dumps(system_status)
        message = f"data: {payload}\n\n"
        for client in sse_clients:
            client.send_message(message)

# SSE 업데이트 알림용 트리거 (티켓 리스트 실시간 동기화용)
def broadcast_ticket_update():
    with sse_lock:
        message = "event: ticket_update\ndata: update\n\n"
        for client in sse_clients:
            client.send_message(message)

def generate_dynamic_token(student_id):
    """30초 유효한 고유 토큰 생성"""
    timestamp = time.time()
    expiry = timestamp + 30.0
    token_str = f"KU-{student_id}-{int(timestamp)}-{os.urandom(4).hex().upper()}"
    return token_str, expiry

class CustomHTTPRequestHandler(http.server.BaseHTTPRequestHandler):
    
    def log_message(self, format, *args):
        pass

    def do_GET(self):
        parsed_url = urllib.parse.urlparse(self.path)
        path = parsed_url.path

        if path == '/api/stream':
            self.handle_sse()
            return

        if path == '/' or path == '':
            file_path = os.path.join(PUBLIC_DIR, 'index.html')
        elif path == '/admin':
            file_path = os.path.join(PUBLIC_DIR, 'admin.html')
        else:
            rel_path = path.lstrip('/')
            file_path = os.path.abspath(os.path.join(PUBLIC_DIR, rel_path))
            if not file_path.startswith(os.path.abspath(PUBLIC_DIR)):
                self.send_error(403, "Access Denied")
                return

        if os.path.exists(file_path) and os.path.isfile(file_path):
            self.serve_file(file_path)
        else:
            self.send_error(404, "File Not Found")

    def do_POST(self):
        parsed_url = urllib.parse.urlparse(self.path)
        path = parsed_url.path

        content_length = int(self.headers.get('Content-Length', 0))
        post_data = self.rfile.read(content_length) if content_length > 0 else b''
        
        try:
            req_data = json.loads(post_data.decode('utf-8')) if post_data else {}
        except json.JSONDecodeError:
            self.send_json({"error": "Invalid JSON"}, 400)
            return

        if path == '/api/login':
            self.handle_login(req_data)
        elif path == '/api/issue':
            self.handle_issue_ticket(req_data)
        elif path == '/api/ticket-status':
            self.handle_ticket_status(req_data)
        elif path == '/api/refresh-token':
            self.handle_refresh_token(req_data)
        elif path == '/api/admin/update':
            self.handle_admin_update(req_data)
        elif path == '/api/admin/tickets':
            self.handle_get_tickets(req_data)
        else:
            self.send_json({"error": "API Endpoint Not Found"}, 404)

    def serve_file(self, file_path):
        _, ext = os.path.splitext(file_path)
        content_type = 'text/plain; charset=utf-8'
        if ext == '.html':
            content_type = 'text/html; charset=utf-8'
        elif ext == '.css':
            content_type = 'text/css; charset=utf-8'
        elif ext == '.js':
            content_type = 'application/javascript; charset=utf-8'
        elif ext == '.json':
            content_type = 'application/json; charset=utf-8'
        elif ext in ['.png', '.jpg', '.jpeg', '.gif']:
            content_type = f'image/{ext[1:]}'

        try:
            with open(file_path, 'rb') as f:
                content = f.read()
            self.send_response(200)
            self.send_header('Content-Type', content_type)
            self.send_header('Content-Length', len(content))
            self.send_header('Cache-Control', 'no-store, no-cache, must-revalidate')
            self.end_headers()
            self.wfile.write(content)
        except Exception as e:
            self.send_error(500, f"Server Error: {str(e)}")

    def send_json(self, data, status_code=200):
        response_bytes = json.dumps(data).encode('utf-8')
        self.send_response(status_code)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', len(response_bytes))
        self.send_header('Cache-Control', 'no-store, no-cache, must-revalidate')
        self.end_headers()
        self.wfile.write(response_bytes)

    def handle_login(self, data):
        student_id = data.get('studentId', '').strip()
        name = data.get('name', '').strip()
        client_id = data.get('clientId', '').strip()

        if not student_id:
            self.send_json({"error": "학번을 입력해주세요."}, 400)
            return
        if not name:
            self.send_json({"error": "이름을 입력해주세요."}, 400)
            return
        # clientId가 없으면 서버에서 자동 생성
        if not client_id:
            import uuid
            client_id = 'server-gen-' + str(uuid.uuid4())[:8]

        # 학번 유효성 검사 (10자리 숫자)
        if not (student_id.isdigit() and len(student_id) == 10):
            self.send_json({"error": "학번은 10자리 숫자 형식이어야 합니다. (예: 2025131125)"}, 400)
            return

        # 이름 유효성 검사 (공백 제외 한글/영문 2자 이상)
        if len(name) < 2:
            self.send_json({"error": "이름은 최소 2자리 이상이어야 합니다."}, 400)
            return

        with state_lock:
            # 중복 로그인 처리
            if student_id in logged_in_users:
                existing_user = logged_in_users[student_id]
                if existing_user["clientId"] != client_id:
                    # 세션 가로채기 방식
                    logged_in_users[student_id] = {"clientId": client_id, "name": name}
                    print(f"[Login] Student {student_id} ({name}) session hijacked by new client {client_id}")
            else:
                logged_in_users[student_id] = {"clientId": client_id, "name": name}

            # 이미 티켓이 발급되었는지 확인
            has_ticket = student_id in issued_tickets
            ticket_info = issued_tickets[student_id] if has_ticket else None

        self.send_json({
            "message": "로그인 성공",
            "studentId": student_id,
            "name": name,
            "hasTicket": has_ticket,
            "ticket": ticket_info
        }, 200)

    def handle_issue_ticket(self, data):
        student_id = data.get('studentId', '').strip()
        client_id = data.get('clientId', '').strip()
        name = data.get('name', '').strip()

        if not student_id or not client_id or not name:
            self.send_json({"error": "로그인이 필요합니다."}, 401)
            return

        with state_lock:
            # 세션 확인
            user_session = logged_in_users.get(student_id)
            if not user_session or user_session["clientId"] != client_id:
                self.send_json({"error": "세션이 만료되었거나 다른 기기에서 로그인되었습니다."}, 403)
                return

            global ticket_counter
            # 이미 티켓을 발급 받았는지 재확인
            if student_id in issued_tickets:
                self.send_json({
                    "message": "이미 발급된 대기표가 있습니다.",
                    "ticket": issued_tickets[student_id]
                }, 200)
                return

            # 새 번호표 부여
            ticket_counter += 1
            token, expiry = generate_dynamic_token(student_id)
            
            ticket_data = {
                "ticket_number": ticket_counter,
                "name": name,
                "token": token,
                "expiry": expiry
            }
            issued_tickets[student_id] = ticket_data

        print(f"[Ticket] Issued ticket #{ticket_counter} to student {student_id} ({name})")
        # 관리자 리스트업 갱신을 위해 SSE로 알림 전송
        broadcast_ticket_update()

        self.send_json({
            "message": "대기표 발급 완료",
            "ticket": ticket_data
        }, 200)

    def handle_ticket_status(self, data):
        student_id = data.get('studentId', '').strip()
        client_id = data.get('clientId', '').strip()

        if not student_id or not client_id:
            self.send_json({"error": "로그인이 필요합니다."}, 401)
            return

        with state_lock:
            # 세션 확인
            user_session = logged_in_users.get(student_id)
            if not user_session or user_session["clientId"] != client_id:
                self.send_json({"error": "SESSION_EXPIRED"}, 403)
                return

            ticket_info = issued_tickets.get(student_id)

        if not ticket_info:
            self.send_json({"hasTicket": False}, 200)
            return

        # 토큰 유효성 검사 및 자동 갱신
        now = time.time()
        with state_lock:
            if now >= ticket_info["expiry"]:
                new_token, new_expiry = generate_dynamic_token(student_id)
                ticket_info["token"] = new_token
                ticket_info["expiry"] = new_expiry
                issued_tickets[student_id] = ticket_info

        remaining = max(0, int(ticket_info["expiry"] - now))

        self.send_json({
            "hasTicket": True,
            "ticket_number": ticket_info["ticket_number"],
            "name": ticket_info["name"],
            "token": ticket_info["token"],
            "remaining": remaining
        }, 200)

    def handle_refresh_token(self, data):
        student_id = data.get('studentId', '').strip()
        client_id = data.get('clientId', '').strip()

        if not student_id or not client_id:
            self.send_json({"error": "로그인이 필요합니다."}, 401)
            return

        with state_lock:
            user_session = logged_in_users.get(student_id)
            if not user_session or user_session["clientId"] != client_id:
                self.send_json({"error": "세션이 만료되었습니다."}, 403)
                return

            ticket_info = issued_tickets.get(student_id)
            if not ticket_info:
                self.send_json({"error": "발급된 대기표가 없습니다."}, 404)
                return

            new_token, new_expiry = generate_dynamic_token(student_id)
            ticket_info["token"] = new_token
            ticket_info["expiry"] = new_expiry
            issued_tickets[student_id] = ticket_info

        self.send_json({
            "message": "인증 토큰이 갱신되었습니다.",
            "token": new_token,
            "remaining": 30
        }, 200)

    def handle_admin_update(self, data):
        # 관리자 비밀번호 검증 (실제 구현 시 보안 요소를 고려하되, 데모이므로 간단히 "korea1905" 등으로 체크)
        admin_pw = data.get('adminPassword', '').strip()
        if admin_pw != "korea1905":
            self.send_json({"error": "관리자 비밀번호가 일치하지 않습니다."}, 403)
            return

        zone_con = data.get('zone_congestion')
        pass_con = data.get('passage_congestion')
        artist = data.get('current_artist')
        new_ann = data.get('emergency_announcement')

        with state_lock:
            if zone_con:
                system_status["zone_congestion"] = zone_con
            if pass_con:
                system_status["passage_congestion"] = pass_con
            if artist:
                system_status["current_artist"] = artist
            if new_ann:
                system_status["emergency_announcement"] = new_ann
                # 누적 긴급 공지 타임라인에 추가
                timestamp_str = time.strftime("%H:%M", time.localtime())
                system_status["announcements"].insert(0, {
                    "time": timestamp_str,
                    "text": new_ann
                })
                # 누적은 최대 20개까지만 유지
                if len(system_status["announcements"]) > 20:
                    system_status["announcements"].pop()

        # SSE 클라이언트들에게 즉각 브로드캐스트
        broadcast_status()
        print(f"[Admin] System status updated: Congestion({zone_con}/{pass_con}), Artist({artist})")
        self.send_json({"message": "시스템 상태가 업데이트되었습니다."}, 200)

    def handle_get_tickets(self, data):
        admin_pw = data.get('adminPassword', '').strip()
        if admin_pw != "korea1905":
            self.send_json({"error": "관리자 비밀번호가 일치하지 않습니다."}, 403)
            return

        with state_lock:
            ticket_list = []
            for student_id, info in issued_tickets.items():
                ticket_list.append({
                    "ticket_number": info["ticket_number"],
                    "studentId": student_id,
                    "name": info["name"]
                })
            ticket_list.sort(key=lambda x: x["ticket_number"])

        self.send_json({"tickets": ticket_list}, 200)

    def handle_sse(self):
        # SSE 응답 헤더 작성
        self.send_response(200)
        self.send_header('Content-Type', 'text/event-stream')
        self.send_header('Cache-Control', 'no-cache')
        self.send_header('Connection', 'keep-alive')
        self.send_header('Access-Control-Allow-Origin', '*')
        self.end_headers()

        # SSE 클라이언트 생성 및 등록
        client = SSEClient()
        with sse_lock:
            sse_clients.append(client)
        print(f"[SSE] New client connected. Total clients: {len(sse_clients)}")

        # 첫 접속 시 현재의 상태를 전송
        with state_lock:
            initial_payload = json.dumps(system_status)
        self.wfile.write(f"data: {initial_payload}\n\n".encode('utf-8'))
        self.wfile.flush()

        try:
            while client.active:
                # 큐에서 데이터를 대기 (10초 타임아웃을 두어 연결 유지용 ping 전송)
                msg = client.get_message(timeout=10.0)
                if msg:
                    self.wfile.write(msg.encode('utf-8'))
                    self.wfile.flush()
                else:
                    # 10초간 업데이트가 없으면 ping 발송하여 연결 유지
                    self.wfile.write(": ping\n\n".encode('utf-8'))
                    self.wfile.flush()
        except (ConnectionResetError, ConnectionAbortedError, BrokenPipeError):
            pass
        finally:
            client.active = False
            with sse_lock:
                if client in sse_clients:
                    sse_clients.remove(client)
            print(f"[SSE] Client disconnected. Total clients: {len(sse_clients)}")

class ThreadingHTTPServer(socketserver.ThreadingMixIn, http.server.HTTPServer):
    # 포트 재사용 허용 (서버 재시작 시 Address already in use 에러 방지)
    allow_reuse_address = True

if __name__ == '__main__':
    # public 폴더 생성 확인
    if not os.path.exists(PUBLIC_DIR):
        os.makedirs(PUBLIC_DIR)
        print(f"[Server] Created directory: {PUBLIC_DIR}")

    server = ThreadingHTTPServer(('0.0.0.0', PORT), CustomHTTPRequestHandler)
    print(f"===========================================================")
    print(f" 석탑대동제 고대생 존 대기/혼잡도 시스템 서버 가동 중...")
    print(f" - 사용자 페이지: http://localhost:{PORT}")
    print(f" - 관리자 페이지: http://localhost:{PORT}/admin")
    print(f"===========================================================")
    
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n[Server] Shutting down...")
        server.server_close()
