# 석탑대동제 고대생 존 대기 및 혼잡도 관리 시스템

고려대학교 석탑대동제(축제) 고대생 존 입장 대기표 발급 및 실시간 혼잡도 안내 웹 시스템입니다.

## 📁 폴더 구조

```
├── public/           ← 행사 당일 로컬 서버 버전
│   ├── index.html    사용자 대기표 페이지
│   ├── app.js        사용자 로직
│   ├── admin.html    관리자 통제 패널
│   ├── admin.js      관리자 로직
│   ├── style.css     공통 스타일
│   ├── logo.png      로고
│   └── qrcode.min.js QR 생성 라이브러리
│
├── docs/             ← GitHub Pages 정적 데모 버전
│   ├── index.html    리다이렉트
│   ├── web.html      정적 대기표 발급 페이지
│   ├── web.js        localStorage 기반 로직
│   ├── style.css
│   ├── logo.png
│   └── qrcode.min.js
│
└── server.py         ← Python 백엔드 서버 (행사 당일 실행)
```

## 🌐 GitHub Pages 데모

`docs/` 폴더가 GitHub Pages로 배포됩니다.  
→ `https://[username].github.io/[repo-name]/`

## 🖥️ 로컬 서버 실행 (행사 당일)

Python 3.x 필요

```bash
python server.py
```

- 사용자 페이지: http://localhost:3000
- 관리자 패널: http://localhost:3000/admin  
- 관리자 비밀번호: `korea1905`

## 제작
2025131125 불어불문학과 김정원

