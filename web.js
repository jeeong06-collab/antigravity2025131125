// =====================================================
// 석탑대동제 GitHub Pages 정적 버전 (서버 없음)
// localStorage 기반으로 동작
// =====================================================

// 1. 상태 관리
let studentId = localStorage.getItem('web_studentId') || null;
let studentName = localStorage.getItem('web_studentName') || null;
let qrCodeObj = null;
let liveClockInterval = null;
let countdownInterval = null;

// 2. DOM 요소
const el = {
  watermarkBg: document.getElementById('watermarkBg'),
  emergencyBanner: document.getElementById('emergencyBanner'),
  bannerText: document.getElementById('bannerText'),
  btnLogout: document.getElementById('btnLogout'),

  loginCard: document.getElementById('loginCard'),
  studentIdInput: document.getElementById('studentId'),
  studentNameInput: document.getElementById('studentName'),
  btnLogin: document.getElementById('btnLogin'),
  loginError: document.getElementById('loginError'),

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

  announcementModal: document.getElementById('announcementModal'),
  btnModalClose: document.getElementById('btnModalClose'),

  toast: document.getElementById('toast')
};

// 3. 초기화
window.addEventListener('DOMContentLoaded', () => {
  updateWatermarkBackground();

  el.btnLogin.addEventListener('click', handleLogin);
  el.btnIssueTicket.addEventListener('click', handleIssueTicket);
  el.btnLogout.addEventListener('click', handleLogout);
  el.btnModalClose.addEventListener('click', () => el.announcementModal.classList.remove('active'));
  el.announcementModal.addEventListener('click', (e) => {
    if (e.target === el.announcementModal) el.announcementModal.classList.remove('active');
  });

  // 엔터키 로그인
  el.studentIdInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') el.studentNameInput.focus(); });
  el.studentNameInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') handleLogin(); });

  if (studentId) {
    showLoggedInUI();
    // 저장된 티켓 복원
    const savedTicket = localStorage.getItem('web_ticket_' + studentId);
    if (savedTicket) {
      displayTicket(JSON.parse(savedTicket));
    }
  } else {
    showLoggedOutUI();
  }
});

// 4. UI 상태 전환
function showLoggedInUI() {
  el.loginCard.style.display = 'none';
  el.ticketCard.style.display = 'flex';
  el.btnLogout.style.display = 'block';
  el.studentBadge.textContent = `학번: ${studentId}` + (studentName ? ` (${studentName})` : '');
  updateWatermarkBackground();
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

// 5. 로그인 (클라이언트 사이드 검증)
function handleLogin() {
  const inputId = el.studentIdInput.value.trim();
  const inputName = el.studentNameInput.value.trim();
  el.loginError.textContent = '';

  if (!inputId) {
    el.loginError.textContent = '학번을 입력해주세요.';
    return;
  }
  if (!/^\d{10}$/.test(inputId)) {
    el.loginError.textContent = '학번은 10자리 숫자 형식이어야 합니다. (예: 2025131125)';
    return;
  }
  if (!inputName || inputName.length < 2) {
    el.loginError.textContent = '이름은 최소 2자 이상 입력해주세요.';
    return;
  }

  studentId = inputId;
  studentName = inputName;
  localStorage.setItem('web_studentId', studentId);
  localStorage.setItem('web_studentName', studentName);

  showToast('재학생 인증에 성공하였습니다.');
  showLoggedInUI();

  // 저장된 티켓 복원
  const savedTicket = localStorage.getItem('web_ticket_' + studentId);
  if (savedTicket) {
    displayTicket(JSON.parse(savedTicket));
  } else {
    el.ticketIssued.style.display = 'none';
    el.ticketPlaceholder.style.display = 'flex';
  }
}

// 6. 번호표 발급 (localStorage 기반)
function handleIssueTicket() {
  el.issueError.textContent = '';

  // 이미 발급된 티켓 확인
  const existing = localStorage.getItem('web_ticket_' + studentId);
  if (existing) {
    displayTicket(JSON.parse(existing));
    showToast('이미 발급된 대기표가 있습니다.');
    return;
  }

  // 순번 생성: 전역 카운터를 localStorage에서 관리
  let counter = parseInt(localStorage.getItem('web_global_counter') || '0', 10) + 1;
  localStorage.setItem('web_global_counter', String(counter));

  const token = generateToken(studentId, studentName, Date.now());
  const expiry = Date.now() / 1000 + 30;

  const ticket = {
    ticket_number: counter,
    name: studentName,
    token: token,
    expiry: expiry
  };

  localStorage.setItem('web_ticket_' + studentId, JSON.stringify(ticket));
  showToast('대기 번호표가 정상 발급되었습니다.');
  displayTicket(ticket);
}

// 7. 토큰 생성 (클라이언트 사이드)
function generateToken(id, name, timestamp) {
  const base = `KU-${id}-${name}-${Math.floor(timestamp / 30000)}`;
  // 간단한 해시 (djb2 방식)
  let hash = 5381;
  for (let i = 0; i < base.length; i++) {
    hash = ((hash << 5) + hash) + base.charCodeAt(i);
    hash = hash & hash; // 32비트 정수 유지
  }
  const hexHash = (hash >>> 0).toString(16).toUpperCase().padStart(8, '0');
  return `KU-${id}-${hexHash}`;
}

// 8. 입장 예정 시간 계산 (30분당 50명)
function calculateEntryTime(ticketNumber) {
  const group = Math.floor((ticketNumber - 1) / 50);
  const totalMinutes = group * 30;
  const targetHour = 18 + Math.floor(totalMinutes / 60);
  const targetMin = totalMinutes % 60;
  const displayHour = targetHour > 12 ? targetHour - 12 : targetHour;
  const ampm = targetHour >= 12 ? '오후' : '오전';
  const displayMin = String(targetMin).padStart(2, '0');
  return `${ampm} ${String(displayHour).padStart(2, '0')}:${displayMin}`;
}

// 9. 티켓 표시
function displayTicket(ticket) {
  el.ticketPlaceholder.style.display = 'none';
  el.ticketIssued.style.display = 'flex';

  const numStr = String(ticket.ticket_number).padStart(3, '0');
  el.ticketNumDisplay.textContent = numStr;

  const entryTimeStr = calculateEntryTime(ticket.ticket_number);
  el.entryTimeDisplay.textContent = entryTimeStr;

  studentName = ticket.name || studentName;
  localStorage.setItem('web_studentName', studentName);
  el.studentBadge.textContent = `학번: ${studentId} (${studentName})`;

  // QR 코드 렌더링 (30초마다 토큰 갱신)
  renderQRCode(generateToken(studentId, studentName, Date.now()));
  startCountdown(Date.now() / 1000 + 30, ticket);
}

// 10. QR 코드 렌더링
function renderQRCode(tokenText) {
  const container = el.qrcode;
  if (!container) return;
  container.innerHTML = '';
  try {
    qrCodeObj = new QRCode(container, {
      text: tokenText,
      width: 140,
      height: 140,
      colorDark: '#A50034',
      colorLight: '#ffffff',
      correctLevel: QRCode.CorrectLevel.H
    });
  } catch (e) {
    console.error('QR 생성 실패:', e);
  }
}

// 11. 실시간 시계
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
  }, 33);
}

function stopLiveClock() {
  if (liveClockInterval) { clearInterval(liveClockInterval); liveClockInterval = null; }
}

// 12. 카운트다운 + 토큰 자동 갱신
function startCountdown(expiryTimestamp, ticket) {
  stopCountdown();

  function updateTimer() {
    const now = Date.now() / 1000;
    const diff = Math.max(0, expiryTimestamp - now);
    el.countdownSec.textContent = Math.ceil(diff);

    if (diff <= 0) {
      stopCountdown();
      // 토큰 갱신
      const newToken = generateToken(studentId, studentName, Date.now());
      const newExpiry = Date.now() / 1000 + 30;
      renderQRCode(newToken);
      startCountdown(newExpiry, ticket);
    }
  }

  updateTimer();
  countdownInterval = setInterval(updateTimer, 500);
}

function stopCountdown() {
  if (countdownInterval) { clearInterval(countdownInterval); countdownInterval = null; }
}

// 13. 로그아웃
function handleLogout() {
  studentId = null;
  studentName = null;
  localStorage.removeItem('web_studentId');
  localStorage.removeItem('web_studentName');
  showLoggedOutUI();
  showToast('로그아웃되었습니다.');
}

// 14. 캡처 방지 워터마크
function updateWatermarkBackground() {
  el.watermarkBg.innerHTML = '';
  const displayId = studentId || 'KOREA UNIV';
  const dateStr = new Date().toISOString().slice(0, 10);
  const watermarkText = `IP-VERIFIED | STUDENTID: ${displayId} | ${dateStr} | CAPTURE_PROHIBITED | KOREA UNIV FESTIVAL`;

  for (let i = 0; i < 15; i++) {
    const line = document.createElement('div');
    line.className = 'watermark-line';
    line.innerHTML = `<span>${watermarkText}</span><span>${watermarkText}</span><span>${watermarkText}</span>`;
    line.style.animation = i % 2 === 0
      ? 'watermark-scroll 40s linear infinite reverse'
      : 'watermark-scroll 30s linear infinite';
    el.watermarkBg.appendChild(line);
  }
}

// 15. 토스트
function showToast(message) {
  el.toast.textContent = message;
  el.toast.classList.add('show');
  setTimeout(() => el.toast.classList.remove('show'), 2500);
}
