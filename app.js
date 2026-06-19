// 1. 상태 및 상수 관리
let studentId = localStorage.getItem('studentId') || null;
let studentName = localStorage.getItem('studentName') || null;
let clientId = localStorage.getItem('clientId') || null;
let qrCodeObj = null;
let liveClockInterval = null;
let countdownInterval = null;
let sseSource = null;
let lastAnnouncements = [];

// 기기 고유 ID 생성 (중복 로그인 방지용)
if (!clientId) {
  clientId = 'client-' + Math.random().toString(36).substr(2, 9) + '-' + Date.now();
  localStorage.setItem('clientId', clientId);
}

// 2. DOM 요소 레퍼런스
const el = {
  watermarkBg: document.getElementById('watermarkBg'),
  emergencyBanner: document.getElementById('emergencyBanner'),
  bannerText: document.getElementById('bannerText'),
  btnLogout: document.getElementById('btnLogout'),
  
  // Login
  loginCard: document.getElementById('loginCard'),
  studentIdInput: document.getElementById('studentId'),
  studentNameInput: document.getElementById('studentName'),
  btnLogin: document.getElementById('btnLogin'),
  loginError: document.getElementById('loginError'),
  
  // Ticket
  ticketCard: document.getElementById('ticketCard'),
  ticketPlaceholder: document.getElementById('ticketPlaceholder'),
  btnIssueTicket: document.getElementById('btnIssueTicket'),
  issueError: document.getElementById('issueError'),
  ticketIssued: document.getElementById('ticketIssued'),
  ticketNumDisplay: document.getElementById('ticketNumDisplay'),
  qrcode: document.getElementById('qrcode'),
  entryTimeDisplay: document.getElementById('entryTimeDisplay'),
  studentBadge: document.getElementById('studentBadge'),
  liveClock: document.getElementById('liveClock'),
  countdownSec: document.getElementById('countdownSec'),
  
  // Dashboard
  zoneCongestion: document.getElementById('zoneCongestion'),
  passageCongestion: document.getElementById('passageCongestion'),
  artistName: document.getElementById('artistName'),
  
  // Modal
  announcementModal: document.getElementById('announcementModal'),
  btnModalClose: document.getElementById('btnModalClose'),
  timelineContainer: document.getElementById('timelineContainer'),
  
  // Toast
  toast: document.getElementById('toast')
};

// 3. 페이지 초기 설정 및 이벤트 리스너 등록
window.addEventListener('DOMContentLoaded', () => {
  initApp();
  
  // 버튼 바인딩
  el.btnLogin.addEventListener('click', handleLogin);
  el.btnIssueTicket.addEventListener('click', handleIssueTicket);
  el.btnLogout.addEventListener('click', handleLogout);
  
  // 모달 제어
  el.emergencyBanner.addEventListener('click', openAnnouncementModal);
  el.btnModalClose.addEventListener('click', closeAnnouncementModal);
  el.announcementModal.addEventListener('click', (e) => {
    if (e.target === el.announcementModal) closeAnnouncementModal();
  });
});

// 앱 시작 시 호출
function initApp() {
  // 실시간 배경 워터마크 동적 텍스트 빌드
  updateWatermarkBackground();
  
  // SSE 실시간 스트림 연결
  connectSSE();

  if (studentId) {
    // 자동 로그인 시도 (서버 상태 확인)
    checkTicketStatus();
    showLoggedInUI();
  } else {
    showLoggedOutUI();
  }
}

// 4. UI 상태 변경 함수
function showLoggedInUI() {
  el.loginCard.style.display = 'none';
  el.ticketCard.style.display = 'flex';
  el.btnLogout.style.display = 'block';
  el.studentBadge.textContent = `학번: ${studentId}` + (studentName ? ` (${studentName})` : '');
  updateWatermarkBackground();
  
  // 실시간 밀리초 시계 시작
  startLiveClock();
}

function showLoggedOutUI() {
  el.loginCard.style.display = 'block';
  el.ticketCard.style.display = 'none';
  el.ticketIssued.style.display = 'none';
  el.ticketPlaceholder.style.display = 'flex';
  el.btnLogout.style.display = 'none';
  
  stopLiveClock();
  stopCountdown();
  updateWatermarkBackground();
}

// 5. 비즈니스 로직 - 인증 로그인
async function handleLogin() {
  const inputId = el.studentIdInput.value.trim();
  const inputName = el.studentNameInput.value.trim();
  el.loginError.textContent = '';

  if (!inputId) {
    el.loginError.textContent = '학번을 입력해주세요.';
    return;
  }
  if (!inputName) {
    el.loginError.textContent = '이름을 입력해주세요.';
    return;
  }

  try {
    const res = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        studentId: inputId,
        name: inputName,
        clientId: clientId
      })
    });

    const data = await res.json();
    if (!res.ok) {
      el.loginError.textContent = data.error || '로그인에 실패했습니다.';
      return;
    }

    // 로그인 성공 처리
    studentId = inputId;
    studentName = inputName;
    localStorage.setItem('studentId', studentId);
    localStorage.setItem('studentName', studentName);
    
    showToast('재학생 인증에 성공하였습니다.');
    showLoggedInUI();

    if (data.hasTicket && data.ticket) {
      displayTicket(data.ticket);
    } else {
      el.ticketIssued.style.display = 'none';
      el.ticketPlaceholder.style.display = 'flex';
    }
  } catch (err) {
    el.loginError.textContent = '서버 통신 오류가 발생했습니다.';
    console.error(err);
  }
}

// 비즈니스 로직 - 번호표 발급
async function handleIssueTicket() {
  el.issueError.textContent = '';
  try {
    const res = await fetch('/api/issue', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        studentId: studentId,
        name: studentName,
        clientId: clientId
      })
    });

    const data = await res.json();
    if (!res.ok) {
      if (data.error === 'SESSION_EXPIRED' || res.status === 403) {
        handleLogout();
        showToast('세션이 만료되어 로그아웃되었습니다.');
      } else {
        el.issueError.textContent = data.error || '발급 중 오류가 발생했습니다.';
      }
      return;
    }

    showToast('대기 번호표가 정상 발급되었습니다.');
    displayTicket(data.ticket);
  } catch (err) {
    el.issueError.textContent = '서버 통신 오류가 발생했습니다.';
    console.error(err);
  }
}

// 입장 예정 시간 계산기 (30분당 50명씩)
function calculateEntryTime(ticketNumber) {
  const group = Math.floor((ticketNumber - 1) / 50);
  const baseHour = 18; // 18:00 (오후 6시 시작)
  const totalMinutes = group * 30;
  
  const targetHour = baseHour + Math.floor(totalMinutes / 60);
  const targetMin = totalMinutes % 60;
  
  const displayHour = targetHour > 12 ? targetHour - 12 : targetHour;
  const ampm = targetHour >= 12 ? '오후' : '오전';
  const displayMin = String(targetMin).padStart(2, '0');
  
  return `${ampm} ${String(displayHour).padStart(2, '0')}:${displayMin}`;
}

// 티켓 표시 및 QR코드 생성
function displayTicket(ticket) {
  el.ticketPlaceholder.style.display = 'none';
  el.ticketIssued.style.display = 'flex';
  
  const numStr = String(ticket.ticket_number).padStart(3, '0');
  el.ticketNumDisplay.textContent = numStr;

  // 입장 예정 시간 계산 및 바인딩
  const entryTimeStr = calculateEntryTime(ticket.ticket_number);
  el.entryTimeDisplay.textContent = entryTimeStr;

  // 학번 정보 카드 업데이트
  studentName = ticket.name || studentName;
  localStorage.setItem('studentName', studentName);
  el.studentBadge.textContent = `학번: ${studentId} (${studentName})`;

  setTimeout(() => {
    renderQRCode(ticket.token);
  }, 50);
  
  startCountdown(ticket.expiry || (Date.now() / 1000 + 30));
}

// 6. 실시간 티켓 상태 및 토큰 갱신 체크
async function checkTicketStatus() {
  if (!studentId) return;

  try {
    const res = await fetch('/api/ticket-status', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        studentId: studentId,
        clientId: clientId
      })
    });

    const data = await res.json();
    if (!res.ok) {
      if (res.status === 403 || data.error === 'SESSION_EXPIRED') {
        handleLogout();
        showToast('다른 기기에서 로그인하여 세션이 만료되었습니다.');
      }
      return;
    }

    if (data.hasTicket) {
      el.ticketPlaceholder.style.display = 'none';
      el.ticketIssued.style.display = 'flex';
      
      const numStr = String(data.ticket_number).padStart(3, '0');
      el.ticketNumDisplay.textContent = numStr;
      
      // 입장 예정 시간
      const entryTimeStr = calculateEntryTime(data.ticket_number);
      el.entryTimeDisplay.textContent = entryTimeStr;
      
      // 이름 복원 및 표시
      studentName = data.name || studentName;
      localStorage.setItem('studentName', studentName);
      el.studentBadge.textContent = `학번: ${studentId} (${studentName})`;

      setTimeout(() => {
        renderQRCode(data.token);
      }, 50);
      
      startCountdown(Date.now() / 1000 + data.remaining);
    } else {
      el.ticketIssued.style.display = 'none';
      el.ticketPlaceholder.style.display = 'flex';
    }
  } catch (err) {
    console.error('Failed to sync ticket status:', err);
  }
}

// 명시적 토큰 리프레시 요청
async function refreshTicketToken() {
  if (!studentId) return;
  try {
    const res = await fetch('/api/refresh-token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        studentId: studentId,
        clientId: clientId
      })
    });
    const data = await res.json();
    if (res.ok) {
      setTimeout(() => {
        renderQRCode(data.token);
      }, 50);
      startCountdown(Date.now() / 1000 + data.remaining);
    } else if (res.status === 403) {
      handleLogout();
      showToast('세션이 만료되어 로그아웃되었습니다.');
    }
  } catch (err) {
    console.error('Error refreshing token:', err);
  }
}

// 7. QR코드 렌더링 라이브러리 래핑
function renderQRCode(text) {
  const container = document.getElementById('qrcode');
  if (!container) return;
  
  // 이미 생성된 QR Container가 있으면 지움
  container.innerHTML = '';
  
  try {
    // QRCode.js 생성자로 캔버스 생성
    qrCodeObj = new QRCode(container, {
      text: text,
      width: 140,
      height: 140,
      colorDark : "#A50034", // 고려대 크림슨 컬러 코드로 QR 인쇄
      colorLight : "#ffffff",
      correctLevel : QRCode.CorrectLevel.H
    });
  } catch (e) {
    console.error('QR Code generation failed:', e);
  }
}

// 8. 실시간 시계 & 카운트다운 타이머 (밀리초 단위)
function startLiveClock() {
  stopLiveClock();
  liveClockInterval = setInterval(() => {
    const now = new Date();
    const Y = now.getFullYear();
    const M = String(now.getMonth() + 1).padStart(2, '0');
    const D = String(now.getDate()).padStart(2, '0');
    const h = String(now.getHours()).padStart(2, '0');
    const m = String(now.getMinutes()).padStart(2, '0');
    const s = String(now.getSeconds()).padStart(2, '0');
    const ms = String(now.getMilliseconds()).padStart(3, '0');
    
    el.liveClock.textContent = `${Y}-${M}-${D} ${h}:${m}:${s}.${ms}`;
  }, 33); // 30fps 수준으로 밀리초 갱신
}

function stopLiveClock() {
  if (liveClockInterval) {
    clearInterval(liveClockInterval);
    liveClockInterval = null;
  }
}

function startCountdown(expiryTimestamp) {
  stopCountdown();
  
  function updateTimer() {
    const now = Date.now() / 1000;
    const diff = Math.max(0, expiryTimestamp - now);
    
    el.countdownSec.textContent = Math.ceil(diff);
    
    if (diff <= 0) {
      stopCountdown();
      // 만료 시 자동으로 서버에 새로운 토큰 갱신 요청
      refreshTicketToken();
    }
  }

  updateTimer();
  countdownInterval = setInterval(updateTimer, 500);
}

function stopCountdown() {
  if (countdownInterval) {
    clearInterval(countdownInterval);
    countdownInterval = null;
  }
}

// 9. SSE 실시간 스트림 연동
function connectSSE() {
  if (sseSource) {
    sseSource.close();
  }

  sseSource = new EventSource('/api/stream');

  sseSource.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      updateDashboard(data);
    } catch (e) {
      console.error('Failed to parse SSE data:', e);
    }
  };

  sseSource.onerror = (err) => {
    console.error('SSE connection lost. Reconnecting in 3s...', err);
    sseSource.close();
    setTimeout(connectSSE, 3000);
  };
}

// 대시보드 UI 업데이트 (SSE 콜백)
function updateDashboard(data) {
  // 1. 혼잡도 상태 바인딩
  updateCongestionUI(el.zoneCongestion, data.zone_congestion);
  updateCongestionUI(el.passageCongestion, data.passage_congestion);

  // 2. 현재 아티스트 바인딩
  el.artistName.textContent = data.current_artist || '공연 없음';

  // 3. 긴급 공지 배너 바인딩
  if (data.emergency_announcement) {
    el.emergencyBanner.style.display = 'flex';
    el.bannerText.textContent = data.emergency_announcement;
  } else {
    el.emergencyBanner.style.display = 'none';
  }

  // 4. 누적 공지사항 히스토리 백업
  if (data.announcements) {
    lastAnnouncements = data.announcements;
    renderTimeline();
  }
}

// 혼잡도 등급별 CSS 갱신
function updateCongestionUI(element, status) {
  element.textContent = status;
  element.className = 'congestion-status'; // 기본화

  if (status === '여유') {
    element.classList.add('status-safe');
  } else if (status === '보통') {
    element.classList.add('status-normal');
  } else if (status === '혼잡') {
    element.classList.add('status-warning');
  } else if (status === '진입제한') {
    element.classList.add('status-danger');
  }
}

// 10. 공지사항 모달 타임라인 생성
function renderTimeline() {
  el.timelineContainer.innerHTML = '';
  if (lastAnnouncements.length === 0) {
    el.timelineContainer.innerHTML = '<div style="text-align:center; color:var(--text-muted); font-size:0.85rem; padding: 20px 0;">공지사항이 없습니다.</div>';
    return;
  }

  lastAnnouncements.forEach(item => {
    const itemEl = document.createElement('div');
    itemEl.className = 'timeline-item';
    itemEl.innerHTML = `
      <div class="timeline-dot"></div>
      <div class="timeline-time">${item.time}</div>
      <div class="timeline-text">${item.text}</div>
    `;
    el.timelineContainer.appendChild(itemEl);
  });
}

function openAnnouncementModal() {
  renderTimeline();
  el.announcementModal.classList.add('active');
}

function closeAnnouncementModal() {
  el.announcementModal.classList.remove('active');
}

// 11. 로그아웃
function handleLogout() {
  studentId = null;
  studentName = null;
  localStorage.removeItem('studentId');
  localStorage.removeItem('studentName');
  
  showLoggedOutUI();
  showToast('로그아웃되었습니다.');
}

// 12. 캡처 방지용 움직이는 동적 워터마크 배경 텍스트 생성
function updateWatermarkBackground() {
  el.watermarkBg.innerHTML = '';
  const displayId = studentId || "KOREA UNIV";
  const dateStr = new Date().toISOString().slice(0, 10);
  
  // 롤링 워터마크에 뿌려줄 텍스트 빌드
  const watermarkText = `IP-VERIFIED | STUDENTID: ${displayId} | ${dateStr} | CAPTURE_PROHIBITED | KOREA UNIV FESTIVAL`;
  
  // 배경에 12줄의 롤링 텍스트 라인 추가
  for (let i = 0; i < 15; i++) {
    const line = document.createElement('div');
    line.className = 'watermark-line';
    
    // 무한 롤링 흐름을 위해 같은 텍스트를 여러번 반복
    line.innerHTML = `
      <span>${watermarkText}</span>
      <span>${watermarkText}</span>
      <span>${watermarkText}</span>
    `;
    
    // 지그재그 방향 효과를 위해 홀수/짝수 줄별 이동 애니메이션 속도 조절 가능
    if (i % 2 === 0) {
      line.style.animation = 'watermark-scroll 40s linear infinite reverse';
    } else {
      line.style.animation = 'watermark-scroll 30s linear infinite';
    }
    
    el.watermarkBg.appendChild(line);
  }
}

// 13. 토스트 알림 함수
function showToast(message) {
  el.toast.textContent = message;
  el.toast.classList.add('show');
  
  setTimeout(() => {
    el.toast.classList.remove('show');
  }, 2500);
}
