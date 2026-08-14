document.addEventListener("DOMContentLoaded", function() {
    // 예시 데이터 (실제 데이터 구조에 맞게 연동)
    const sampleData = [
        { id: "clinic_001", title: "수학(상) 고난도 클리닉 1회차" },
        { id: "clinic_002", title: "수학 I 삼각함수 심화 클리닉" }
    ];

    renderClinicList(sampleData);
});

function renderClinicList(list) {
    const container = document.getElementById("quiz-list");
    if (!container) return;

    container.innerHTML = "";

    list.forEach(item => {
        const card = document.createElement("div");
        card.className = "card";
        card.innerHTML = `
            <h3>${item.title}</h3>
            <p style="color: #666; font-size: 13px; margin: 8px 0 15px;">KEY ID: ${item.id}</p>
            <button class="btn btn-answer" data-keyid="${item.id}">해설 보기</button>
            <button class="btn btn-secondary btn-copy" data-keyid="${item.id}">해설 링크 복사</button>
        `;
        container.appendChild(card);
    });

    // 이벤트 리스너 등록
    document.querySelectorAll(".btn-answer").forEach(btn => {
        btn.addEventListener("click", function() {
            openAnswerPage(this.dataset.keyid);
        });
    });

    document.querySelectorAll(".btn-copy").forEach(btn => {
        btn.addEventListener("click", function() {
            copyAnswerLink(this.dataset.keyid);
        });
    });
}

// 안전한 clinicanswer.html URL 생성 함수
function getAnswerUrl(keyId) {
    const currentPath = window.location.pathname.substring(0, window.location.pathname.lastIndexOf('/') + 1);
    return window.location.origin + currentPath + 'clinicanswer.html?id=' + encodeURIComponent(keyId || '');
}

// 해설 페이지 새 창 열기
function openAnswerPage(keyId) {
    const targetUrl = getAnswerUrl(keyId);
    window.open(targetUrl, '_blank');
}

// 해설 링크 클립보드 복사
function copyAnswerLink(keyId) {
    const targetUrl = getAnswerUrl(keyId);
    navigator.clipboard.writeText(targetUrl).then(() => {
        alert("해설 링크가 클립보드에 복사되었습니다!\n\n" + targetUrl);
    }).catch(err => {
        alert("링크 복사에 실패했습니다. 주소를 직접 복사해 주세요.");
    });
}
