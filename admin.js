// 1. 상태 관리
let adminPassword = sessionStorage.getItem('adminPassword') || null;
let currentStatus = {
  zone_congestion: '여유',
  passage_congestion: '보통',
  current_artist: '',
  emergency_announcement: ''
};
let sseSource = null;

// 2. DOM 요소 레퍼런스
const el = {
  adminAuthCard: document.getElementById('adminAuthCard'),
  adminControls: document.getElementById('adminControls'),
  adminPassword: document.getElementById('adminPassword'),
  btnAuth: document.getElementById('btnAuth'),
  authError: document.getElementById('authError'),
  
  // Controls
  zoneCongestionGroup: document.getElementById('zoneCongestionGroup'),
  passageCongestionGroup: document.getElementById('passageCongestionGroup'),
  artistInput: document.getElementById('artistInput'),
  btnSaveArtist: document.getElementById('btnSaveArtist'),
  announcementInput: document.getElementById('announcementInput'),
  btnSendAnnouncement: document.getElementById('btnSendAnnouncement'),
  btnAdminLogout: document.getElementById('btnAdminLogout'),
  
  // Ticket List
  ticketListTableBody: document.getElementById('ticketListTableBody'),

  // Toast
  toast: document.getElementById('toast')
};

// 3. 앱 초기화
window.addEventListener('DOMContentLoaded', () => {
  if (adminPassword) {
    showControls();
    connectAdminSSE();
  } else {
    showAuth();
  }

  // 이벤트 바인딩
  el.btnAuth.addEventListener('click', handleAuth);
  el.btnAdminLogout.addEventListener('click', handleLogout);
  el.btnSaveArtist.addEventListener('click', handleSaveArtist);
  el.btnSendAnnouncement.addEventListener('click', handleSendAnnouncement);

  // 혼잡도 버튼 그룹 이벤트 위임
  setupCongestionButtons('zoneCongestionGroup', 'zone_congestion');
  setupCongestionButtons('passageCongestionGroup', 'passage_congestion');
});

// UI 상태 스위칭
function showAuth() {
  el.adminAuthCard.style.display = 'block';
  el.adminControls.style.display = 'none';
}

function showControls() {
  el.adminAuthCard.style.display = 'none';
  el.adminControls.style.display = 'flex';
  // 명단 즉시 로드
  fetchTicketList();
}

// 스태프 인증 로그인
function handleAuth() {
  const pw = el.adminPassword.value.trim();
  el.authError.textContent = '';

  if (pw === 'korea1905') {
    adminPassword = pw;
    sessionStorage.setItem('adminPassword', pw);
    showToast('스태프 인증 성공');
    showControls();
    connectAdminSSE();
  } else {
    el.authError.textContent = '비밀번호가 올바르지 않습니다. (준비위 전용)';
  }
}

// 4. API 전송 래퍼
async function sendUpdate(payload) {
  if (!adminPassword) {
    showToast('스태프 세션이 만료되었습니다. 다시 로그인해 주세요.');
    handleLogout();
    return false;
  }

  const reqBody = {
    adminPassword: adminPassword,
    ...payload
  };

  try {
    const res = await fetch('/api/admin/update', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(reqBody)
    });

    const data = await res.json();
    if (res.ok) {
      showToast(data.message || '상태가 업데이트되었습니다.');
      return true;
    } else {
      showToast(data.error || '업데이트에 실패했습니다.');
      if (res.status === 403) {
        handleLogout();
      }
      return false;
    }
  } catch (err) {
    showToast('서버 통신 오류가 발생했습니다.');
    console.error(err);
    return false;
  }
}

// 5. 혼잡도 버튼 제어 로직
function setupCongestionButtons(groupId, stateKey) {
  const container = document.getElementById(groupId);
  const buttons = container.querySelectorAll('.btn-status-select');

  buttons.forEach(btn => {
    btn.addEventListener('click', async () => {
      const val = btn.getAttribute('data-val');
      const payload = {};
      payload[stateKey] = val;

      const success = await sendUpdate(payload);
      if (success) {
        // UI 즉각 반영 (SSE 수신 전 피드백용)
        setActiveButton(groupId, val);
      }
    });
  });
}

// 특정 버튼 활성화 처리
function setActiveButton(groupId, val) {
  const container = document.getElementById(groupId);
  const buttons = container.querySelectorAll('.btn-status-select');
  buttons.forEach(btn => {
    if (btn.getAttribute('data-val') === val) {
      btn.classList.add('active');
    } else {
      btn.classList.remove('active');
    }
  });
}

// 6. 무대 정보 수정
async function handleSaveArtist() {
  const val = el.artistInput.value.trim();
  if (!val) {
    showToast('아티스트/팀명을 입력해 주세요.');
    return;
  }
  await sendUpdate({ current_artist: val });
}

// 7. 긴급 공지 송신
async function handleSendAnnouncement() {
  const val = el.announcementInput.value.trim();
  if (!val) {
    showToast('긴급 공지 내용을 입력해 주세요.');
    return;
  }
  const success = await sendUpdate({ emergency_announcement: val });
  if (success) {
    el.announcementInput.value = ''; // 전송 성공 시 폼 초기화
  }
}

// 8. SSE 연결을 통해 실시간으로 현재 셋팅값을 동기화
function connectAdminSSE() {
  if (sseSource) {
    sseSource.close();
  }

  sseSource = new EventSource('/api/stream');

  sseSource.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      currentStatus = data;
      syncUIWithServerState();
    } catch (e) {
      console.error('Failed to parse SSE data:', e);
    }
  };

  // 티켓 발급 이벤트 수신 시 명단 실시간 갱신
  sseSource.addEventListener('ticket_update', () => {
    fetchTicketList();
  });

  sseSource.onerror = (err) => {
    console.error('SSE connection lost. Reconnecting...', err);
    sseSource.close();
    setTimeout(connectAdminSSE, 3000);
  };
}

// 9-1. 대기표 명단 서버에서 불러오기
async function fetchTicketList() {
  if (!adminPassword) return;
  try {
    const res = await fetch('/api/admin/tickets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ adminPassword: adminPassword })
    });
    const data = await res.json();
    if (res.ok) {
      renderTicketList(data.tickets || []);
    }
  } catch (err) {
    console.error('명단 로딩 실패:', err);
  }
}

// 9-2. 명단 테이블 렌더링
function renderTicketList(tickets) {
  const tbody = el.ticketListTableBody;
  if (!tbody) return;

  if (tickets.length === 0) {
    tbody.innerHTML = `<tr><td colspan="4" style="padding: 20px; text-align: center; color: var(--text-muted);">발급된 대기표가 없습니다.</td></tr>`;
    return;
  }

  tbody.innerHTML = tickets.map(t => {
    const group = Math.floor((t.ticket_number - 1) / 50);
    const totalMin = group * 30;
    const h = 18 + Math.floor(totalMin / 60);
    const m = String(totalMin % 60).padStart(2, '0');
    const ampm = h >= 12 ? '오후' : '오전';
    const displayH = h > 12 ? h - 12 : h;
    const entryTime = `${ampm} ${String(displayH).padStart(2,'0')}:${m}`;

    return `<tr style="border-bottom: 1px solid rgba(255,255,255,0.06); transition: background 0.2s;" 
              onmouseover="this.style.background='rgba(165,0,52,0.08)'" 
              onmouseout="this.style.background='transparent'">
      <td style="padding: 10px 14px; font-weight: 700; color: var(--crimson-main); font-size: 1rem;">${String(t.ticket_number).padStart(3,'0')}</td>
      <td style="padding: 10px 14px; font-family: monospace; letter-spacing: 1px;">${t.studentId}</td>
      <td style="padding: 10px 14px; font-weight: 500;">${t.name}</td>
      <td style="padding: 10px 14px; font-size: 0.8rem; color: var(--text-muted);">${entryTime}</td>
    </tr>`;
  }).join('');
}

// 서버 상태와 관리자 UI 싱크 맞추기
function syncUIWithServerState() {
  // 혼잡도 버튼 매핑
  setActiveButton('zoneCongestionGroup', currentStatus.zone_congestion);
  setActiveButton('passageCongestionGroup', currentStatus.passage_congestion);
  
  // 아티스트 필드 (사용자가 수동 포커싱 해둔 경우 제외하고 자동 동기화)
  if (document.activeElement !== el.artistInput) {
    el.artistInput.value = currentStatus.current_artist || '';
  }
}

// 9. 로그아웃
function handleLogout() {
  adminPassword = null;
  sessionStorage.removeItem('adminPassword');
  if (sseSource) {
    sseSource.close();
    sseSource = null;
  }
  showAuth();
  showToast('로그아웃되었습니다.');
}

// 10. 토스트 알림
function showToast(message) {
  el.toast.textContent = message;
  el.toast.classList.add('show');
  
  setTimeout(() => {
    el.toast.classList.remove('show');
  }, 2500);
}
