/* ==================================================================
   WEB THI ONLINE v2.0 — BẢO MẬT NÂNG CẤP
   FIX: nộp bài không còn bị cảnh báo gian lận (bỏ alert/confirm,
   dùng modal tự tạo + cờ tắt tạm bộ giám sát khi nộp bài)
   ================================================================== */

// ---------- CÂU HỎI ----------
const QUESTION_BANK = [
    { q: "CPU là viết tắt của gì?", options: ["Central Processing Unit", "Computer Personal Unit", "Central Program Utility", "Control Processing Union"], answer: 0 },
    { q: "1 Byte bằng bao nhiêu Bit?", options: ["4", "8", "16", "32"], answer: 1 },
    { q: "HTML dùng để làm gì?", options: ["Lập trình hệ thống", "Trả về cơ sở dữ liệu", "Xây dựng cấu trúc trang web", "Vẽ đồ họa 3D"], answer: 2 },
    { q: "Phần mềm nào là trình duyệt web?", options: ["Windows", "Excel", "Photoshop", "Chrome"], answer: 3 },
    { q: "RAM là bộ nhớ gì?", options: ["Bộ nhớ trong chỉ đọc", "Bộ nhớ trong truy cập ngẫu nhiên", "Bộ nhớ ngoài", "Bộ nhớ vĩnh viễn"], answer: 1 },
    { q: "CSS dùng để làm gì?", options: ["Trình bày giao diện", "Xử lý dữ liệu", "Lưu trữ file", "Kết nối mạng"], answer: 0 },
    { q: "Phím tắt nào dùng để copy?", options: ["Ctrl + V", "Ctrl + X", "Ctrl + C", "Ctrl + Z"], answer: 2 },
    { q: "Hệ điều hành nào là mã nguồn mở?", options: ["Windows", "macOS", "iOS", "Linux"], answer: 3 },
];

const EXAM_TIME = 10 * 60;
const MAX_VIOLATIONS = 3;
const MIN_ANSWER_TIME = 2000;   // ms — trả lời nhanh hơn => bất thường
const IDLE_LIMIT = 90000;       // ms — không hoạt động 90s => log

// ---------- TRẠNG THÁI ----------
let state = {
    name: "", token: "",
    current: 0,
    questions: [],               // đề đã trộn
    answers: [],
    timeLeft: EXAM_TIME,
    timerId: null,
    violations: 0,
    violationLog: [],
    started: false,
    submitted: false,
    // ⭐ CỜ FIX LỖI NỘP BÀI: tắt tạm bộ giám sát
    submitting: false,
    // Bảo mật v2
    questionShownAt: 0,          // thời gian hiển thị câu hiện tại
    lastActivity: Date.now(),
    idleTimerId: null,
    heartbeatId: null,
};

const $ = (id) => document.getElementById(id);

/* =====================================================
   TIỆN ÍCH
   ===================================================== */
// Trộn mảng (Fisher-Yates)
function shuffle(arr) {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
}

// Hash đơn giản (demo) — thực tế dùng SHA-256 qua crypto.subtle
function simpleHash(str) {
    let h = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) {
        h ^= str.charCodeAt(i);
        h = Math.imul(h, 0x01000193);
    }
    return (h >>> 0).toString(16);
}

function logSecurity(msg) {
    const time = new Date().toLocaleTimeString();
    console.warn(`[SECURITY][${time}] ${msg}`);
    state.violationLog.push(`[${time}] ${msg}`);
}

/* =====================================================
   CHỐNG MỞ 2 TAB — SESSION TOKEN
   ===================================================== */
function acquireSession() {
    const existing = localStorage.getItem("examSession");
    if (existing) {
        const s = JSON.parse(existing);
        if (Date.now() - s.ts < EXAM_TIME * 1000 && !confirmBypass) {
            return false; // đã có phiên thi đang chạy
        }
    }
    const token = crypto.randomUUID();
    localStorage.setItem("examSession", JSON.stringify({ token, ts: Date.now() }));
    state.token = token;
    return true;
}
let confirmBypass = false;

/* =====================================================
   1. BẮT ĐẦU THI
   ===================================================== */
 $("btn-start").addEventListener("click", async () => {
    const name = $("student-name").value.trim();
    if (!name) { $("student-name").focus(); return; }

    if (!acquireSession()) {
        showModal("Cảnh báo phiên", "Phát hiện phiên thi khác đang chạy trên máy này. Hãy đóng tab cũ và tải lại trang.", [
            { text: "Tải lại trang", onclick: () => location.reload() }
        ]);
        return;
    }

    try {
        await document.documentElement.requestFullscreen();
    } catch (e) {
        console.error("[SECURITY] Không vào được fullscreen:", e);
        showModal("Lỗi", "Không thể bật toàn màn hình. Không thể bắt đầu bài thi!", [
            { text: "Đóng", onclick: closeModal }
        ]);
        return;
    }

    // ⭐ TRỌN ĐỀ + TRỘN ĐÁP ÁN ngẫu nhiên
    state.name = name;
    state.questions = shuffle(QUESTION_BANK).map(q => {
        const mapped = q.options.map((text, i) => ({ text, correct: i === q.answer }));
        const shuffled = shuffle(mapped);
        return { q: q.q, options: shuffled.map(o => o.text), answer: shuffled.findIndex(o => o.correct) };
    });
    state.answers = new Array(state.questions.length).fill(-1);
    state.started = true;
    state.questionShownAt = Date.now();

    $("display-name").textContent = "Thí sinh: " + name;
    $("watermark").setAttribute("data-mark", `${name} • ${new Date().toLocaleString()}`);
    $("login-screen").classList.add("hidden");
    $("exam-screen").classList.remove("hidden");

    buildQuestionNav();
    renderQuestion();
    startTimer();
    startActivityMonitor();
    startHeartbeat();

    logSecurity(`BẮT ĐẦU THI | Token: ${state.token} | Fullscreen: ON`);
});

/* =====================================================
   2. TIMER
   ===================================================== */
function startTimer() {
    state.timerId = setInterval(() => {
        state.timeLeft--;
        const m = Math.floor(state.timeLeft / 60), s = state.timeLeft % 60;
        $("timer").textContent = `⏱ ${String(m).padStart(2,"0")}:${String(s).padStart(2,"0")}`;
        if (state.timeLeft <= 30) $("timer").classList.add("warning");
        if (state.timeLeft <= 0) {
            logSecurity("Hết giờ — tự động nộp bài");
            submitExam(true);
        }
    }, 1000);
}

/* =====================================================
   3. HIỂN THỊ CÂU HỎI + THEO DÕI THỜI GIAN TRẢ LỜI
   ===================================================== */
function buildQuestionNav() {
    const nav = $("question-nav");
    nav.innerHTML = "";
    state.questions.forEach((_, i) => {
        const btn = document.createElement("button");
        btn.className = "q-nav-btn";
        btn.textContent = i + 1;
        btn.onclick = () => { state.current = i; renderQuestion(); };
        nav.appendChild(btn);
    });
}

function renderQuestion() {
    const q = state.questions[state.current];
    $("question-text").textContent = `Câu ${state.current + 1}: ${q.q}`;
    const optsDiv = $("options");
    optsDiv.innerHTML = "";
    q.options.forEach((opt, i) => {
        const div = document.createElement("div");
        div.className = "option" + (state.answers[state.current] === i ? " selected" : "");
        div.textContent = String.fromCharCode(65 + i) + ". " + opt;
        div.onclick = () => {
            // ⭐ Phát hiện trả lời quá nhanh (bất thường)
            const elapsed = Date.now() - state.questionShownAt;
            if (elapsed < MIN_ANSWER_TIME) {
                logSecurity(`BẤT THƯỜNG: Trả lời câu ${state.current + 1} chỉ sau ${elapsed}ms`);
            }
            state.answers[state.current] = i;
            renderQuestion();
        };
        optsDiv.appendChild(div);
    });

    document.querySelectorAll(".q-nav-btn").forEach((btn, i) => {
        btn.classList.toggle("current", i === state.current);
        btn.classList.toggle("answered", state.answers[i] !== -1);
    });

    state.questionShownAt = Date.now();
}

 $("btn-prev").onclick = () => { if (state.current > 0) { state.current--; renderQuestion(); } };
 $("btn-next").onclick = () => { if (state.current < state.questions.length - 1) { state.current++; renderQuestion(); } };

/* =====================================================
   4. ⭐ FIX LỖI NỘP BÀI — DÙNG MODAL, KHÔNG DÙNG confirm()
   ===================================================== */
 $("btn-submit").onclick = () => {
    if (state.submitting || state.submitted) return;

    const unanswered = state.answers.filter(a => a === -1).length;
    const msg = unanswered > 0
        ? `Còn <b>${unanswered}</b> câu chưa trả lời. Bạn chắc chắn muốn nộp bài?`
        : "Bạn chắc chắn muốn nộp bài?";

    // Bật cờ: tạm dừng giám sát trong lúc xác nhận
    state.submitting = true;
    showModal("📄 Xác nhận nộp bài", msg, [
        { text: "Tiếp tục làm bài", onclick: () => { state.submitting = false; closeModal(); } },
        { text: "Nộp bài", danger: true, onclick: () => { closeModal(); doSubmitExam(); } },
    ]);
};

function showModal(title, htmlMsg, buttons) {
    $("confirm-msg").innerHTML = htmlMsg;
    const box = document.querySelector(".modal-buttons");
    box.innerHTML = "";
    buttons.forEach(b => {
        const btn = document.createElement("button");
        btn.textContent = b.text;
        btn.className = b.danger ? "btn-danger" : "btn-secondary";
        btn.onclick = b.onclick;
        box.appendChild(btn);
    });
    $("confirm-modal").classList.remove("hidden");
}
function closeModal() { $("confirm-modal").classList.add("hidden"); }

/* Nộp bài thực sự — GIỮ FULLSCREEN đến khi xử lý xong */
function doSubmitExam() {
    state.submitting = true;   // chặn mọi vi phạm phát sinh
    submitExam(false);
}

function submitExam(auto) {
    if (state.submitted) return;
    state.submitted = true;
    state.submitting = true;   // ⭐ tắt toàn bộ giám sát
    clearInterval(state.timerId);
    clearInterval(state.heartbeatId);
    clearTimeout(state.idleTimerId);

    // Chống sửa đáp án: kiểm tra hash đã lưu lúc bắt đầu
    verifyAnswerIntegrity();

    let correct = 0;
    state.answers.forEach((a, i) => { if (a === state.questions[i].answer) correct++; });
    const score = ((correct / state.questions.length) * 10).toFixed(1);

    // Gửi log về "server" (mô phỏng) TRƯỚC khi thoát fullscreen
    sendLogsToServer(score);

    // ⭐ Thoát fullscreen SAU CÙNG
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    localStorage.removeItem("examSession");

    $("exam-screen").classList.add("hidden");
    $("result-screen").classList.remove("hidden");
    $("result-title").textContent = auto ? "⏰ HẾT GIỜ THI!" : "✅ ĐÃ NỘP BÀI";
    $("result-score").textContent = `${score}/10`;
    $("result-detail").textContent =
        `Họ tên: ${state.name} — Đúng ${correct}/${state.questions.length} câu — Vi phạm: ${state.violations}/${MAX_VIOLATIONS}`;
    $("violation-log").innerHTML =
        "<b>📜 Nhật ký vi phạm:</b><br>" +
        (state.violationLog.length ? state.violationLog.map(l => "• " + l).join("<br>") : "Không có vi phạm nào 🎉");

    console.table(state.violationLog);
    logSecurity(`NỘP BÀI | Điểm: ${score} | Vi phạm: ${state.violations}`);
}

/* ⭐ Chống sửa đáp án qua localStorage: hash & so sánh */
let storedAnswerHash = "";
function storeAnswerIntegrity() {
    storedAnswerHash = simpleHash(JSON.stringify(state.answers) + state.token);
}
function verifyAnswerIntegrity() {
    const current = simpleHash(JSON.stringify(state.answers) + state.token);
    if (storedAnswerHash && current !== storedAnswerHash) {
        logSecurity("NGHIÊM TRỌNG: Phát hiện đáp án bị sửa trái phép từ bên ngoài!");
    }
}

/* =====================================================
   5. VI PHẠM & CẢNH BÁO ĐỎ
   ===================================================== */
function registerViolation(reason) {
    // ⭐ FIX CHÍNH: bỏ qua khi đang nộp bài / chưa bắt đầu / đã nộp
    if (!state.started || state.submitted || state.submitting) return;

    state.violations++;
    logSecurity(`VI PHẠM #${state.violations}: ${reason}`);

    $("warning-banner").classList.remove("hidden");
    $("violation-count").textContent = state.violations;
    $("violation-count-2").textContent = state.violations;
    $("status-badge").textContent = "🔴 Bị theo dõi vi phạm";
    $("status-badge").className = "badge badge-danger";
    document.body.style.boxShadow = "inset 0 0 0 8px #d32f2f";

    if (state.violations >= MAX_VIOLATIONS) {
        logSecurity("Vượt 3 lần vi phạm — TỰ ĐỘNG NỘP BÀI!");
        submitExam(true);
    }
}

 $("btn-refocus").addEventListener("click", () => {
    document.documentElement.requestFullscreen()
        .then(clearWarning)
        .catch(e => console.error("[SECURITY] Không thể quay lại fullscreen:", e));
});

function clearWarning() {
    $("warning-banner").classList.add("hidden");
    document.body.style.boxShadow = "none";
    $("status-badge").textContent = "🟢 An toàn";
    $("status-badge").className = "badge badge-safe";
    logSecurity("Đã quay lại chế độ fullscreen an toàn");
}

/* =====================================================
   6. GIÁM SÁT FULLSCREEN
   ===================================================== */
document.addEventListener("fullscreenchange", () => {
    if (!state.started || state.submitted || state.submitting) return;
    if (!document.fullscreenElement) {
        registerViolation("Thoát chế độ TOÀN MÀN HÌNH");
    } else {
        clearWarning();
    }
});

/* =====================================================
   7. CÁC CƠ CHẾ CHỐNG GIAN LẬN
   ===================================================== */

/* 7a. Chuyển tab / mất focus */
document.addEventListener("visibilitychange", () => {
    if (document.hidden && active()) registerViolation("Chuyển tab / ẩn trang");
});
window.addEventListener("blur", () => {
    // Bỏ qua blur do modal nội bộ của trang gây ra
    if (active() && !isInternalModal()) registerViolation("Cửa sổ thi mất focus (blur)");
});
function active() { return state.started && !state.submitted && !state.submitting; }
function isInternalModal() { return !$("confirm-modal").classList.contains("hidden"); }

/* 7b. Chặn copy / cut / paste / chọn văn bản / kéo thả */
["copy", "cut", "paste"].forEach(evt => {
    document.addEventListener(evt, (e) => {
        if (active()) { e.preventDefault(); registerViolation(`Thao tác ${evt.toUpperCase()} bị chặn`); }
    });
});
document.addEventListener("contextmenu", (e) => {
    if (active()) { e.preventDefault(); registerViolation("Mở menu chuột phải"); }
});
document.addEventListener("dragstart", (e) => e.preventDefault());
document.addEventListener("selectstart", (e) => { if (active()) e.preventDefault(); });

/* 7c. Chặn phím tắt + chặn PrintScreen (mới) */
document.addEventListener("keydown", (e) => {
    if (!state.started || state.submitted) return;
    const k = e.key.toLowerCase();

    if ((e.ctrlKey && ["c","v","x","u","s","p"].includes(k)) || k === "f12") {
        e.preventDefault();
        registerViolation(`Phím tắt bị chặn: ${e.ctrlKey ? "Ctrl+" + k.toUpperCase() : "F12"}`);
    }
    if (k === "f11") e.preventDefault();

    // ⭐ MỚI: PrintScreen — che màn hình tức thì + ghi log
    if (k === "printscreen") {
        navigator.clipboard.writeText("⚠️ Nội dung bài thi được bảo mật!")
            .catch(() => {});
        registerViolation("Cố gắng CHỤP MÀN HÌNH (PrintScreen)");
    }
});

/* 7d. ⭐ MỚI: Chặn zoom trang (Ctrl + wheel / Ctrl + / Ctrl -) */
document.addEventListener("wheel", (e) => {
    if (e.ctrlKey && active()) {
        e.preventDefault();
        registerViolation("Cố gắng zoom trang (Ctrl + lăn chuột)");
    }
}, { passive: false });
document.addEventListener("keydown", (e) => {
    if (e.ctrlKey && ["+", "-", "=", "0"].includes(e.key) && active()) {
        e.preventDefault();
        registerViolation(`Cố gắng zoom trang (Ctrl + ${e.key})`);
    }
});

/* 7e. ⭐ MỚI: Phát hiện thu nhỏ / đổi kích thước cửa sổ (tách màn hình) */
window.addEventListener("resize", () => {
    if (!active()) return;
    const ratio = window.innerWidth / screen.width;
    if (ratio < 0.85) {
        registerViolation(`Cửa sổ bị thu nhỏ (${Math.round(ratio * 100)}% màn hình) — nghi vấn tách màn hình`);
    }
});

/* 7f. Phát hiện DevTools (kỹ thuật timing) */
setInterval(() => {
    if (!active()) return;
    const t0 = performance.now();
    debugger;
    if (performance.now() - t0 > 160) {
        registerViolation("Phát hiện DevTools đang mở");
    }
}, 3000);

/* 7g. ⭐ MỚI: Theo dõi hoạt động — phát hiện treo/mất người thi */
function startActivityMonitor() {
    const reset = () => { state.lastActivity = Date.now(); };
    ["mousemove", "keydown", "click", "touchstart"].forEach(e =>
        document.addEventListener(e, reset, { passive: true }));

    state.idleTimerId = setInterval(() => {
        if (!active()) return;
        if (Date.now() - state.lastActivity > IDLE_LIMIT) {
            logSecurity("Thí sinh không có hoạt động trên 90 giây");
            state.lastActivity = Date.now(); // tránh log lặp liên tục
        }
    }, 10000);
}

/* 7h. ⭐ MỚI: Heartbeat — gửi log vi phạm về "server" */
function startHeartbeat() {
    state.heartbeatId = setInterval(() => {
        if (!active() || state.violationLog.length === 0) return;
        sendLogsToServer(null);
    }, 15000);
}
function sendLogsToServer(score) {
    const payload = JSON.stringify({
        token: state.token,
        name: state.name,
        score,
        violations: state.violations,
        logs: state.violationLog.slice(-10),
        ua: navigator.userAgent,
        ts: Date.now(),
    });
    // Thực tế: navigator.sendBeacon("/api/exam/log", payload)
    console.info("[HEARTBEAT → SERVER]", payload);
}

/* 7i. ⭐ MỚI: Chặn unload & tự xóa phiên khi đóng */
window.addEventListener("beforeunload", (e) => {
    if (state.started && !state.submitted) {
        e.preventDefault();
        e.returnValue = "";
    }
});
window.addEventListener("unload", () => {
    if (!state.submitted) localStorage.removeItem("examSession");
});

/* 7j. ⭐ MỚI: Chống kéo thả ảnh/video khi thi */
window.addEventListener("load", () => {
    console.info("[SECURITY] Session key:", crypto.randomUUID());
    console.info("[SECURITY] Fingerprint:", navigator.userAgent);
});