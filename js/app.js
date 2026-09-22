/* =========================================================
   TUTORS — Aplicación (router + vistas + lógica)
   Roles: alumno · tutor · admin
   ========================================================= */
const App = (function () {
  let db = DB.load();

  // ---------- Helpers ----------
  const $ = (sel) => document.querySelector(sel);
  const el = (id) => document.getElementById(id);
  const money = (n) => "S/ " + Number(n).toFixed(2);
  const esc = (s) => String(s).replace(/[&<>"]/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;" }[c]));
  const persist = () => DB.save(db);
  const me = () => db.users.find(u => u.id === db.session) || null;

  function go(path) { location.hash = "#" + path; }
  function toast(msg) {
    const t = el("toast"); t.textContent = msg; t.classList.add("show");
    clearTimeout(t._t); t._t = setTimeout(() => t.classList.remove("show"), 2600);
  }

  function stars(r) { return "★".repeat(Math.round(r)) + "☆".repeat(5 - Math.round(r)); }
  function fmtR(r) { return Number(r || 0).toFixed(1); }
  function tutorById(id) { return db.tutors.find(t => t.id === id); }
  function userById(id) { return db.users.find(u => u.id === id); }
  function bookingsForStudent(sid) { return db.bookings.filter(b => b.studentId === sid); }
  function bookingsForTutor(tid) { return db.bookings.filter(b => b.tutorId === tid); }
  // Precio: SIEMPRE desde el motor central. Ninguna vista calcula precios por su cuenta.
  function quote(t) { return Pricing.quote(t, db.pricing); }
  const GRADES = [1,2,3,4,5,6,7,8,9,10,11];
  const DAYS = DB.DAYS;

  // ==== Cuenta y visibilidad de tutores (LÓGICA CENTRAL DE SEGURIDAD) ====
  // El status de cuenta vive en el usuario; la aprobación/publicación en el perfil.
  function accountStatus(t) { const u = userById(t.userId); return u ? (u.status || "active") : "inactive"; }
  // Un tutor es público SOLO si cumple los 4 requisitos. Ninguna vista decide esto por su cuenta.
  function isTutorPublic(t) {
    const u = userById(t.userId);
    return !!(u && u.role === "tutor" && u.status === "active" && t.approvalStatus === "approved" && t.isPublic === true);
  }
  // Guard: solo el admin puede ejecutar acciones de aprobación/gestión.
  function requireAdmin() { const u = me(); if (!u || u.role !== "admin") { toast("Acción no autorizada"); return false; } return true; }
  // Historial de auditoría de decisiones del admin.
  function logAction(action, tutor, reason) {
    const admin = me();
    db.auditLog = db.auditLog || [];
    db.auditLog.push({
      when: new Date().toISOString(),
      adminId: admin ? admin.id : "-", adminName: admin ? admin.name : "-",
      action, tutorId: tutor.id, tutorName: tutor.name, reason: reason || "",
    });
  }

  // ---- Estados (etiqueta + color) ----
  const STATUS = {
    // reserva
    draft: ["borrador","pend"], awaiting_payment: ["esperando pago","pend"],
    pending_manual_confirmation: ["en revisión","pend"], confirmed: ["confirmada","ok"],
    completed: ["completada","ok"], cancelled: ["cancelada","no"],
    expired: ["expirada","no"], refunded: ["reembolsada","pend"],
    // pago
    not_started: ["sin iniciar","pend"], manual_review: ["en revisión","pend"],
    approved: ["aprobado","ok"], rejected: ["rechazado","no"], failed: ["fallido","no"],
    // payout
    pendiente: ["pendiente","pend"], pagado: ["pagado","ok"],
    // aprobación de tutor
    pending: ["pendiente de aprobación","pend"], pending_approval: ["pendiente de aprobación","pend"],
    suspended: ["suspendido","no"], inactive: ["desactivado","no"],
  };
  function badge(status) {
    const [label, cls] = STATUS[status] || [String(status).replace(/_/g," "), "pend"];
    return `<span class="badge ${cls}">${label}</span>`;
  }
  // Reservas que "ocupan" tiempo (no canceladas/rechazadas/expiradas).
  const ACTIVE_BOOKING_STATES = ["awaiting_payment","pending_manual_confirmation","confirmed","completed"];

  // ---- Helpers de tiempo ----
  function toMin(hhmm) { const [h,m] = hhmm.split(":").map(Number); return h*60+m; }
  function toHHMM(min) { return String(Math.floor(min/60)).padStart(2,"0")+":"+String(min%60).padStart(2,"0"); }
  function fmtAmPm(hhmm) {
    let [h,m] = hhmm.split(":").map(Number);
    const ap = h < 12 ? "a.m." : "p.m.";
    let h12 = h % 12; if (h12 === 0) h12 = 12;
    return h12 + ":" + String(m).padStart(2,"0") + " " + ap;
  }
  const MODALITY_LABEL = { online: "Online", presencial: "Presencial", ambas: "Online y presencial" };
  const DAY_LABEL = Object.fromEntries(DAYS.map(d => [d.key, d.label]));

  // ---- Helpers de disponibilidad (fuente única para form y validación) ----
  function dayKeyOf(dateStr) {
    const d = new Date(dateStr + "T00:00:00");
    return ["sunday","monday","tuesday","wednesday","thursday","friday","saturday"][d.getDay()];
  }
  function dayAvailability(tutor, dayKey) {
    return (tutor.availability || []).find(a => a.dayOfWeek === dayKey && a.isActive) || null;
  }
  function isDateBlocked(tutor, dateStr) {
    return (tutor.blockedDates || []).some(b => b.date === dateStr);
  }
  function slotAllowsModality(slotMod, chosen) { return slotMod === "ambas" || slotMod === chosen; }

  // Modalidades que el tutor ofrece en general (para tarjetas/filtros/perfil).
  function tutorModalities(t) {
    const set = new Set();
    (t.availability || []).forEach(d => { if (d.isActive) d.slots.forEach(s => {
      if (s.modality === "ambas") { set.add("online"); set.add("presencial"); } else set.add(s.modality);
    });});
    return ["online","presencial"].filter(m => set.has(m));
  }
  // Modalidades disponibles en una fecha concreta.
  function dayModalities(tutor, dateStr) {
    const d = dayAvailability(tutor, dayKeyOf(dateStr));
    if (!d || isDateBlocked(tutor, dateStr)) return [];
    const set = new Set();
    d.slots.forEach(s => { if (s.modality === "ambas") { set.add("online"); set.add("presencial"); } else set.add(s.modality); });
    return ["online","presencial"].filter(m => set.has(m));
  }
  // Intervalos ocupados por otras reservas del tutor ese día.
  function busyIntervals(tutorId, dateStr, exceptId) {
    return db.bookings
      .filter(b => b.tutorId === tutorId && b.date === dateStr && b.id !== exceptId && ACTIVE_BOOKING_STATES.includes(b.status))
      .map(b => ({ start: toMin(b.time), end: toMin(b.time) + (b.duration || 60) }));
  }
  // Horas de inicio válidas (grilla de 30 min) para fecha + duración + modalidad.
  function validStartTimes(tutor, dateStr, duration, modality, exceptId) {
    const d = dayAvailability(tutor, dayKeyOf(dateStr));
    if (!d || isDateBlocked(tutor, dateStr)) return [];
    const busy = busyIntervals(tutor.id, dateStr, exceptId);
    const STEP = 30, out = new Set();
    d.slots.forEach(s => {
      if (!slotAllowsModality(s.modality, modality)) return;
      const start = toMin(s.startTime), end = toMin(s.endTime);
      for (let t = start; t + duration <= end; t += STEP) {
        const clash = busy.some(b => t < b.end && (t + duration) > b.start);
        if (!clash) out.add(t);
      }
    });
    return [...out].sort((a,b)=>a-b).map(toHHMM);
  }
  // Validación completa antes de permitir pagar.
  function validateBooking(tutor, dateStr, time, duration, modality, exceptId) {
    if (!dateStr || !time || !duration || !modality) return false;
    if (isDateBlocked(tutor, dateStr)) return false;
    const d = dayAvailability(tutor, dayKeyOf(dateStr));
    if (!d) return false;
    const start = toMin(time), end = start + duration;
    const inSlot = d.slots.some(s => slotAllowsModality(s.modality, modality) && start >= toMin(s.startTime) && end <= toMin(s.endTime));
    if (!inSlot) return false;
    const clash = busyIntervals(tutor.id, dateStr, exceptId).some(b => start < b.end && end > b.start);
    return !clash;
  }
  // Líneas legibles de disponibilidad (vista previa / perfil).
  function availabilityLines(t) {
    return DAYS.filter(d => dayAvailability(t, d.key)).map(d => {
      const av = dayAvailability(t, d.key);
      const parts = av.slots.map(s => `${fmtAmPm(s.startTime)} – ${fmtAmPm(s.endTime)} · ${MODALITY_LABEL[s.modality]}`);
      return { day: d.label, parts };
    });
  }

  // ====================================================
  //  NAVBAR
  // ====================================================
  function renderNav() {
    const u = me();
    const nav = el("topnav");
    let links = `<a class="btn btn-ghost btn-sm" onclick="App.go('/')">Buscar tutores</a>`;
    if (!u) {
      links += `<button class="btn btn-sm" onclick="App.openLogin()">Iniciar sesión</button>
                <button class="btn btn-primary btn-sm" onclick="App.openRegister()">Crear cuenta</button>`;
    } else {
      if (u.role === "alumno")
        links += `<a class="btn btn-ghost btn-sm" onclick="App.go('/mis-reservas')">Mis reservas</a>`;
      if (u.role === "tutor")
        links += `<a class="btn btn-ghost btn-sm" onclick="App.go('/tutor')">Mi dashboard</a>`;
      if (u.role === "admin")
        links += `<a class="btn btn-ghost btn-sm" onclick="App.go('/admin')">Panel admin</a>`;
      links += `<span class="tag-role">${u.role}</span>
                <span class="muted" style="font-size:13px">${esc(u.name)}</span>
                <button class="btn btn-sm" onclick="App.logout()">Salir</button>`;
    }
    nav.innerHTML = links;
  }

  // ====================================================
  //  ROUTER
  // ====================================================
  function router() {
    const hash = location.hash.replace(/^#/, "") || "/";
    const [path, param] = hash.split("/").filter(Boolean).reduce((acc, seg, i) => {
      if (i === 0) acc[0] = "/" + seg; else acc[1] = seg; return acc;
    }, ["/", null]);

    renderNav();
    const view = el("view");
    window.scrollTo(0, 0);

    if (hash === "/" || hash === "") return renderHome(view);
    if (path === "/tutor" && param) return renderProfile(view, param);
    if (path === "/mis-reservas") return guard("alumno", () => renderStudent(view));
    if (path === "/tutor") return guard("tutor", () => renderTutorDash(view));
    if (path === "/admin") return guard("admin", () => renderAdmin(view));
    return renderHome(view);
  }

  function guard(role, fn) {
    const u = me();
    if (!u) { el("view").innerHTML = ""; openLogin(); return; }
    if (u.role !== role) {
      el("view").innerHTML = `<div class="empty">No tienes acceso a esta sección (rol requerido: ${role}).</div>`;
      return;
    }
    fn();
  }

  // ====================================================
  //  HOME — búsqueda + tarjetas de tutores
  // ====================================================
  const filterState = { curso: "", grado: "", rating: "", modalidad: "", disp: "" };

  function renderHome(view) {
    view.innerHTML = `
      <section class="hero">
        <h1>Encuentra tu tutor dentro del colegio</h1>
        <p>Alumnos mayores (sobre todo de 11.º) enseñan a los más pequeños. Filtra por curso, grado, rating, disponibilidad y modalidad. Reserva y paga fácil con Yape.</p>
        <div class="stats">
          <div><span class="n">${db.tutors.filter(isTutorPublic).length}</span><span class="l">tutores activos</span></div>
          <div><span class="n">${DB.CURSOS.length}</span><span class="l">cursos</span></div>
          <div><span class="n">1.º–11.º</span><span class="l">grados</span></div>
        </div>
      </section>

      <div class="filters">
        <div class="field"><label>Curso</label>
          <select id="f-curso">${optList(["Todos", ...DB.CURSOS], filterState.curso)}</select></div>
        <div class="field"><label>Grado del alumno</label>
          <select id="f-grado">${optList(["Todos", ...range(1,11).map(g=>g+"º")], filterState.grado)}</select></div>
        <div class="field"><label>Rating mínimo</label>
          <select id="f-rating">${optList(["Todos","4.0+","4.5+","4.8+"], filterState.rating)}</select></div>
        <div class="field"><label>Modalidad</label>
          <select id="f-modalidad">${optList(["Todas","online","presencial"], filterState.modalidad)}</select></div>
        <div class="field"><label>Disponibilidad</label>
          <select id="f-disp">${optList(["Cualquiera","Lun","Mar","Mié","Jue","Vie","Sáb"], filterState.disp)}</select></div>
      </div>

      <div class="cards" id="cards"></div>`;

    ["curso","grado","rating","modalidad","disp"].forEach(k => {
      el("f-" + k).addEventListener("change", e => {
        filterState[k] = e.target.value.startsWith("Tod") || e.target.value === "Cualquiera" ? "" : e.target.value;
        drawCards();
      });
    });
    drawCards();
  }

  function drawCards() {
    const list = db.tutors.filter(t => {
      if (!isTutorPublic(t)) return false; // solo tutores aprobados, activos y públicos
      if (filterState.curso && !t.courses.includes(filterState.curso)) return false;
      if (filterState.grado) { const g = parseInt(filterState.grado); if (!t.gradesCanTeach.includes(g)) return false; }
      if (filterState.rating) { const min = parseFloat(filterState.rating); if (t.rating < min) return false; }
      if (filterState.modalidad && !tutorModalities(t).includes(filterState.modalidad)) return false;
      if (filterState.disp) {
        const dayMap = { "Lun":"monday","Mar":"tuesday","Mié":"wednesday","Jue":"thursday","Vie":"friday","Sáb":"saturday","Dom":"sunday" };
        if (!dayAvailability(t, dayMap[filterState.disp])) return false;
      }
      return true;
    });
    const wrap = el("cards");
    if (!list.length) { wrap.innerHTML = `<div class="empty" style="grid-column:1/-1">No hay tutores con esos filtros 🙃</div>`; return; }
    wrap.innerHTML = list.map(tutorCard).join("");
  }

  function tutorCard(t) {
    return `
      <div class="tcard" onclick="App.go('/tutor/${t.id}')">
        <div class="tcard-top">
          <div class="avatar">${t.avatar}</div>
          <div style="flex:1">
            <div class="name">${esc(t.name)}</div>
            <div class="sub">${t.grade}.º grado · ${t.courses.join(", ")}</div>
            <div class="rating">${stars(t.rating)} ${fmtR(t.rating)} <span class="cnt">(${t.reviews})</span></div>
          </div>
        </div>
        <div class="chips">
          ${tutorModalities(t).map(m => `<span class="chip ${m}">${m}</span>`).join("")}
          <span class="chip muted">Enseña ${t.gradesCanTeach[0]}.º–${t.gradesCanTeach[t.gradesCanTeach.length-1]}.º</span>
        </div>
        <div class="tcard-foot">
          <div class="price">${money(quote(t).finalPrice)} <small>/ clase</small></div>
          <button class="btn btn-primary btn-sm" onclick="event.stopPropagation(); App.openBooking('${t.id}')">Reservar</button>
        </div>
      </div>`;
  }

  // ====================================================
  //  PERFIL DE TUTOR
  // ====================================================
  function renderProfile(view, tid) {
    const t = tutorById(tid);
    if (!t) { view.innerHTML = `<div class="empty">Tutor no encontrado.</div>`; return; }
    view.innerHTML = `
      <a class="btn btn-ghost btn-sm" onclick="App.go('/')">← Volver</a>
      <div class="profile-grid" style="margin-top:16px">
        <div>
          <div class="panel">
            <div class="tcard-top">
              <div class="avatar" style="width:72px;height:72px;font-size:30px">${t.avatar}</div>
              <div>
                <h1 style="margin:0 0 4px">${esc(t.name)}</h1>
                <div class="sub muted">${t.grade}.º grado · ${esc(t.university)}</div>
                <div class="rating">${stars(t.rating)} ${fmtR(t.rating)} <span class="cnt">(${t.reviews} reseñas)</span></div>
              </div>
            </div>
            <div class="chips" style="margin-top:14px">
              ${t.courses.map(c => `<span class="chip">${c}</span>`).join("")}
              ${tutorModalities(t).map(m => `<span class="chip ${m}">${m}</span>`).join("")}
            </div>
          </div>

          <div class="panel"><h3>🧠 Personalidad</h3><p class="muted">${esc(t.personality)}</p></div>
          <div class="panel"><h3>📚 Metodología</h3><p class="muted">${esc(t.methodology)}</p></div>

          <div class="panel">
            <h3>📈 Notas desde 9.º</h3>
            <table class="grades-table">
              <thead><tr><th>Año</th><th>Curso</th><th>Nota</th></tr></thead>
              <tbody>
                ${t.notes.map(n => `<tr><td>${n.year}</td><td>${n.course}</td>
                  <td class="gnote ${n.note>=19?"hi":"mid"}">${n.note}/20</td></tr>`).join("")}
              </tbody>
            </table>
          </div>

          <div class="panel">
            <h3>⭐ Reseñas de alumnos</h3>
            ${(t.reviewsList && t.reviewsList.length)
              ? t.reviewsList.slice().reverse().map(r => `
                <div class="kv" style="flex-direction:column;align-items:flex-start;gap:4px">
                  <div style="display:flex;justify-content:space-between;width:100%">
                    <b>${esc(r.studentName || "Alumno")}</b>
                    <span class="rating">${stars(r.stars)} <span class="cnt">${r.date || ""}</span></span>
                  </div>
                  ${r.comment ? `<span class="muted">"${esc(r.comment)}"</span>` : ""}
                </div>`).join("")
              : `<p class="muted">Aún no hay reseñas.</p>`}
          </div>
        </div>

        <div>
          <div class="panel">
            <h3>Reservar clase</h3>
            <div class="price" style="font-size:24px;margin:6px 0 2px">${money(quote(t).finalPrice)} <small>/ clase</small></div>
            <p class="muted" style="font-size:13px">Precio final definido por el sistema. Pago seguro vía Yape.</p>
            ${isTutorPublic(t)
              ? `<button class="btn btn-primary btn-block" onclick="App.openBooking('${t.id}')">Reservar ahora</button>`
              : `<div class="alert" style="margin:0">Este tutor no está disponible por ahora.</div>`}
          </div>
          <div class="panel">
            <h3>🗓️ Disponibilidad</h3>
            ${(() => { const lines = availabilityLines(t); return lines.length
              ? lines.map(l => `<div class="kv" style="flex-direction:column;align-items:flex-start;gap:2px">
                  <b>${l.day}</b>${l.parts.map(p => `<span class="muted" style="font-size:13px">${p}</span>`).join("")}
                </div>`).join("")
              : `<p class="muted">Sin horarios configurados.</p>`; })()}
            ${(t.blockedDates && t.blockedDates.length)
              ? `<div class="divider"></div><div class="muted" style="font-size:13px">Fechas no disponibles: ${t.blockedDates.map(b => b.date).join(", ")}</div>` : ""}
          </div>
          <div class="panel">
            <h3>🎓 Puede enseñar a</h3>
            <div class="chips">${t.gradesCanTeach.map(g => `<span class="chip">${g}.º grado</span>`).join("")}</div>
          </div>
        </div>
      </div>`;
  }

  // ====================================================
  //  BOOKING (reserva con validación de disponibilidad + pago Yape)
  // ====================================================
  let bkTutorId = null; // tutor de la reserva en curso

  function todayStr() { return new Date().toISOString().slice(0,10); }
  function nextAvailableDate(t) {
    const start = new Date();
    for (let i = 0; i < 30; i++) {
      const d = new Date(start); d.setDate(start.getDate() + i);
      const ds = d.toISOString().slice(0,10);
      if (dayAvailability(t, dayKeyOf(ds)) && !isDateBlocked(t, ds)) return ds;
    }
    return null;
  }

  function openBooking(tid) {
    const u = me();
    if (!u) { toast("Inicia sesión como alumno para reservar"); openLogin(); return; }
    if (u.role !== "alumno") { toast("Solo los alumnos pueden reservar"); return; }
    const t = tutorById(tid);
    if (!isTutorPublic(t)) { toast("Este tutor no está disponible"); return; }
    bkTutorId = tid;
    const finalPrice = quote(t).finalPrice;
    const firstDate = nextAvailableDate(t) || todayStr();
    modal(`
      <h3>Reservar con ${esc(t.name)}</h3>
      <div class="sub">${money(finalPrice)} / clase · ${t.courses.join(", ")}</div>
      <div class="field"><label>Curso</label>
        <select id="bk-course">${t.courses.map(c=>`<option>${c}</option>`).join("")}</select></div>
      <div class="form-2">
        <div class="field"><label>Fecha</label>
          <input type="date" id="bk-date" min="${todayStr()}" value="${firstDate}" onchange="App.bkDateChange()"></div>
        <div class="field"><label>Duración</label>
          <select id="bk-dur" onchange="App.bkRefresh()">
            <option value="30">30 min</option><option value="60" selected>60 min</option><option value="90">90 min</option>
          </select></div>
      </div>
      <div class="form-2">
        <div class="field"><label>Modalidad</label><select id="bk-mod" onchange="App.bkRefresh()"></select></div>
        <div class="field"><label>Hora disponible</label><select id="bk-time"></select></div>
      </div>
      <div id="bk-msg"></div>
      <div class="alert">Total a pagar: <b>${money(finalPrice)}</b> — se cobra vía Yape.</div>
      <button class="btn btn-primary btn-block" id="bk-continue" onclick="App.confirmBooking()">Continuar al pago →</button>
    `);
    bkDateChange();
  }

  // Al cambiar la fecha: recalcular modalidades disponibles de ese día.
  function bkDateChange() {
    const t = tutorById(bkTutorId);
    const mods = dayModalities(t, el("bk-date").value);
    el("bk-mod").innerHTML = mods.map(m => `<option value="${m}">${MODALITY_LABEL[m]}</option>`).join("");
    bkRefresh();
  }

  // Recalcular horas válidas según fecha + duración + modalidad.
  function bkRefresh() {
    const t = tutorById(bkTutorId);
    const date = el("bk-date").value;
    const dur = parseInt(el("bk-dur").value);
    const mod = el("bk-mod").value;
    const timeSel = el("bk-time"), msg = el("bk-msg"), btn = el("bk-continue");
    const noAvail = () => {
      timeSel.innerHTML = ""; timeSel.disabled = true; btn.disabled = true;
      msg.innerHTML = `<div class="alert alert-error">Este tutor no está disponible en ese horario. Elige otra fecha u hora.</div>`;
    };
    if (!mod || !dayAvailability(t, dayKeyOf(date)) || isDateBlocked(t, date)) return noAvail();
    const times = validStartTimes(t, date, dur, mod);
    if (!times.length) return noAvail();
    timeSel.disabled = false; btn.disabled = false; msg.innerHTML = "";
    timeSel.innerHTML = times.map(h => `<option value="${h}">${fmtAmPm(h)}</option>`).join("");
  }

  function confirmBooking() {
    const t = tutorById(bkTutorId);
    const date = el("bk-date").value, time = el("bk-time").value;
    const duration = parseInt(el("bk-dur").value), modality = el("bk-mod").value;
    const course = el("bk-course").value;
    // Validación REAL antes de permitir pagar.
    if (!validateBooking(t, date, time, duration, modality)) {
      toast("Este tutor no está disponible en ese horario. Elige otra fecha u hora."); return;
    }
    // Crear reserva en awaiting_payment con snapshot de precio y código de verificación.
    const snap = Pricing.snapshot(t, db.pricing);
    const b = DB.mkBooking({
      id: "b-" + Date.now(), studentId: me().id, tutorId: t.id, course,
      date, time, duration, modality,
      price: snap.price, tutorEarning: snap.tutorEarning, commission: snap.commission,
      verificationCode: DB.genCode(),
      paymentStatus: "not_started", payoutStatus: "pendiente", status: "awaiting_payment",
    });
    db.bookings.push(b); persist();
    openYapePayment(b.id);
  }

  // Pantalla de pago Yape con código de verificación de 8 dígitos.
  function openYapePayment(bookingId) {
    const b = db.bookings.find(x => x.id === bookingId);
    const t = tutorById(b.tutorId);
    modal(`
      <h3>Pagar con Yape</h3>
      <div class="sub">${b.course} con ${esc(t.name)} · ${b.date} · ${fmtAmPm(b.time)} · ${b.duration} min · ${MODALITY_LABEL[b.modality]}</div>
      <div class="yape-box">
        <div>Yapea a la cuenta de TUTORS</div>
        <div class="qr">QR Yape</div>
        <div class="phone">${DB.YAPE_ADMIN.phone}</div>
        <div style="font-size:13px;margin-top:6px">Titular: ${DB.YAPE_ADMIN.name}</div>
      </div>
      <div class="pay-rows">
        <div class="pay-row"><span class="muted">Monto exacto</span>
          <b id="pay-amount">${money(b.price)}</b>
          <button class="btn btn-sm" onclick="App.copyText('${b.price.toFixed(2)}','Monto copiado')">Copiar monto</button></div>
        <div class="pay-row"><span class="muted">Código (8 dígitos)</span>
          <b class="pay-code" id="pay-code">${b.verificationCode}</b>
          <button class="btn btn-sm" onclick="App.copyText('${b.verificationCode}','Código copiado')">Copiar código</button></div>
      </div>
      <div class="alert">Yapea el <b>monto exacto</b> y coloca este <b>código de 8 dígitos</b> en el mensaje del pago para que podamos validar tu reserva.</div>
      <div class="field"><label>Sube la captura de tu Yape (opcional)</label>
        <input type="file" id="pay-proof" accept="image/*"></div>
      <button class="btn btn-yape btn-block" onclick="App.markPaid('${b.id}')">Ya pagué ✓</button>
      <p class="muted" style="font-size:12.5px;margin-top:10px">Tu reserva quedará <b>en revisión</b>. Un administrador validará el pago en Yape antes de confirmarla — no se confirma automáticamente.</p>
    `);
  }

  function copyText(txt, okMsg) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(txt).then(() => toast(okMsg || "Copiado")).catch(() => toast("Copia manual: " + txt));
    } else { toast("Copia manual: " + txt); }
  }

  // "Ya pagué": NO confirma. Pasa a revisión manual del admin.
  function markPaid(bookingId) {
    const b = db.bookings.find(x => x.id === bookingId);
    if (!b) return;
    const f = el("pay-proof");
    if (f && f.files && f.files[0]) b.proof = f.files[0].name;
    b.status = "pending_manual_confirmation";
    b.paymentStatus = "manual_review";
    persist(); closeModal();
    toast("Pago enviado. Tu reserva quedó en revisión.");
    go("/mis-reservas");
  }

  // ====================================================
  //  VISTA ALUMNO — Mis reservas y pagos
  // ====================================================
  function renderStudent(view) {
    const u = me();
    const list = bookingsForStudent(u.id);
    const totalPagado = list.filter(b=>b.paymentStatus==="approved").reduce((s,b)=>s+b.price,0);
    const enRevision = list.filter(b=>b.status==="pending_manual_confirmation").length;
    view.innerHTML = `
      <div class="page-head"><h1>Hola, ${esc(u.name)} 👋</h1><p>Tus reservas y pagos (alumno de ${u.grade}.º grado)</p></div>
      <div class="stat-cards">
        <div class="stat primary"><div class="l">Reservas</div><div class="n">${list.length}</div></div>
        <div class="stat accent"><div class="l">Total pagado</div><div class="n">${money(totalPagado)}</div></div>
        <div class="stat warn"><div class="l">En revisión</div><div class="n">${enRevision}</div></div>
      </div>
      <div class="table-wrap">
        <table class="table">
          <thead><tr><th>Tutor</th><th>Curso</th><th>Fecha / hora</th><th>Modalidad</th><th>Precio</th><th>Pago</th><th>Estado</th><th>Acción</th></tr></thead>
          <tbody>
            ${list.length ? list.map(b => {
              const t = tutorById(b.tutorId);
              let action;
              if (b.reviewed) action = `<span class="badge ok">calificado</span>`;
              else if (b.status === "completed") action = `<button class="btn btn-sm btn-primary" onclick="App.openRate('${b.id}')">Calificar ★</button>`;
              else if (b.status === "awaiting_payment") action = `<button class="btn btn-sm btn-yape" onclick="App.openYapePayment('${b.id}')">Pagar</button>`;
              else if (b.status === "pending_manual_confirmation") action = `<span class="muted">en revisión</span>`;
              else action = `<span class="muted">—</span>`;
              return `<tr>
                <td>${esc(t?t.name:"-")}</td><td>${b.course}</td>
                <td>${b.date}<br><span class="muted">${fmtAmPm(b.time)} · ${b.duration}min</span></td>
                <td><span class="chip ${b.modality}">${b.modality}</span></td>
                <td><b>${money(b.price)}</b></td>
                <td>${badge(b.paymentStatus)}</td>
                <td>${badge(b.status)}</td>
                <td>${action}</td>
              </tr>`;
            }).join("") : `<tr><td colspan="8" class="empty">Aún no tienes reservas. <a onclick="App.go('/')" style="color:var(--primary-2);cursor:pointer">Busca un tutor →</a></td></tr>`}
          </tbody>
        </table>
      </div>
      <p class="muted" style="font-size:13px;margin-top:14px">* Solo ves el precio final que pagas. Ninguna reserva se confirma sin que el admin apruebe el pago en Yape.</p>`;
  }

  // ====================================================
  //  DASHBOARD TUTOR
  // ====================================================
  // Pantalla de estado cuando el tutor aún no está aprobado / activo.
  function renderTutorGate(view, t, u) {
    let icon, title, msg, cls;
    if (t.approvalStatus === "pending") {
      icon = "🕒"; cls = "pend";
      title = "Tu cuenta de tutor está pendiente de aprobación";
      msg = "Te avisaremos cuando el administrador active tu perfil. Mientras tanto no apareces en la página principal ni puedes recibir reservas.";
    } else if (t.approvalStatus === "rejected") {
      icon = "❌"; cls = "no";
      title = "Tu postulación como tutor fue rechazada";
      msg = t.rejectionReason ? ("Motivo: " + t.rejectionReason) : "El administrador no aprobó tu solicitud en este momento.";
    } else { // suspendido / inactivo
      icon = "⏸️"; cls = "no";
      title = "Tu perfil de tutor está " + (u.status === "suspended" ? "suspendido" : "desactivado");
      msg = "No apareces en la página principal ni puedes recibir nuevas reservas. Tu historial se conserva. Contacta al administrador para más información.";
    }
    view.innerHTML = `
      <div class="page-head"><h1>Hola, ${esc(t.name)} 👋</h1><p>Estado de tu cuenta de tutor</p></div>
      <div class="panel gate-card">
        <div class="gate-icon">${icon}</div>
        <h2 style="margin:0 0 8px">${title}</h2>
        <p class="muted" style="max-width:520px;margin:0 auto 16px">${esc(msg)}</p>
        <div class="row" style="justify-content:center">
          <span class="badge ${cls}">Solicitud: ${STATUS[t.approvalStatus]?STATUS[t.approvalStatus][0]:t.approvalStatus}</span>
          <span class="tag-role">Postulación: ${t.appliedAt || "-"}</span>
        </div>
      </div>
      <div class="panel">
        <h3>Resumen de tu postulación</h3>
        <div class="kv"><span class="k">Cursos</span><span class="chips">${t.courses.map(c=>`<span class="chip">${c}</span>`).join("")}</span></div>
        <div class="kv"><span class="k">Grados</span><span class="chips">${t.gradesCanTeach.map(g=>`<span class="chip">${g}.º</span>`).join("")}</span></div>
        <div class="kv"><span class="k">Universidad / carrera</span><span>${esc(t.university||"-")}</span></div>
      </div>`;
  }

  function renderTutorDash(view) {
    const u = me();
    const t = db.tutors.find(x => x.userId === u.id);
    if (!t) { view.innerHTML = `<div class="empty">Tu perfil de tutor no está configurado.</div>`; return; }
    // El tutor solo accede al dashboard completo si está aprobado y activo.
    if (t.approvalStatus !== "approved" || u.status !== "active") return renderTutorGate(view, t, u);
    const list = bookingsForTutor(t.id);
    // El tutor solo ve cuánto recibirá (tutorEarning), nunca la comisión ni el precio final.
    const totalRecibido = list.filter(b=>b.payoutStatus==="pagado").reduce((s,b)=>s+b.tutorEarning,0);
    const porCobrar = list.filter(b=>b.payoutStatus!=="pagado").reduce((s,b)=>s+b.tutorEarning,0);
    const q = quote(t); // solo usamos q.tutorPayout para el tutor

    view.innerHTML = `
      <div class="page-head"><h1>Dashboard de ${esc(t.name)}</h1><p>Tus clases, horarios y pagos</p></div>
      <div class="stat-cards">
        <div class="stat primary"><div class="l">Clases</div><div class="n">${list.length}</div></div>
        <div class="stat accent"><div class="l">Ya recibido</div><div class="n">${money(totalRecibido)}</div></div>
        <div class="stat warn"><div class="l">Pendiente de cobro</div><div class="n">${money(porCobrar)}</div></div>
        <div class="stat"><div class="l">Rating</div><div class="n">${fmtR(t.rating)} ★ <span class="muted" style="font-size:13px;font-weight:600">(${t.reviews})</span></div></div>
      </div>

      <div class="panel" style="display:flex;justify-content:space-between;align-items:center;gap:16px;flex-wrap:wrap">
        <div>
          <h3 style="margin:0 0 4px">💰 Recibirás por cada nueva clase</h3>
          <div class="price" style="font-size:26px;color:var(--accent)">${money(q.tutorPayout)}</div>
          <p class="muted" style="font-size:13px;margin:4px 0 0">Monto definido automáticamente por el sistema según tu rating y reseñas. No puedes editarlo.</p>
        </div>
        <div class="tag-role">Tramo: ${esc(q.tierLabel)}</div>
      </div>

      <div class="section">
        <h2>Mis clases</h2>
        <div class="table-wrap">
          <table class="table">
            <thead><tr><th>Alumno</th><th>Curso</th><th>Fecha / hora</th><th>Modalidad</th><th>Recibiré</th><th>Pago al tutor</th><th>Estado</th></tr></thead>
            <tbody>
              ${list.length ? list.map(b => {
                const al = userById(b.studentId);
                return `<tr>
                  <td>${esc(al?al.name:"-")}</td><td>${b.course}</td>
                  <td>${b.date}<br><span class="muted">${fmtAmPm(b.time)} · ${b.duration}min</span></td>
                  <td><span class="chip ${b.modality}">${b.modality}</span></td>
                  <td><b style="color:var(--accent)">${money(b.tutorEarning)}</b></td>
                  <td>${badge(b.payoutStatus)}</td>
                  <td>${badge(b.status)}</td>
                </tr>`;
              }).join("") : `<tr><td colspan="7" class="empty">Aún no tienes clases reservadas.</td></tr>`}
            </tbody>
          </table>
        </div>
        <p class="muted" style="font-size:13px;margin-top:12px">* Solo ves lo que recibirás por cada clase. El admin gestiona el cobro al alumno y te paga vía Yape cuando el pago está "pagado".</p>
      </div>

      <div class="section">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
          <h2 style="margin:0">Mi información</h2>
          <button class="btn btn-primary btn-sm" onclick="App.openEditTutor()">✎ Editar información</button>
        </div>
        <div class="panel">
          <div class="kv"><span class="k">Modalidad</span><span class="chips">${tutorModalities(t).map(m=>`<span class="chip ${m}">${m}</span>`).join("") || '<span class="muted">—</span>'}</span></div>
          <div class="kv"><span class="k">Cursos que enseño</span><span class="chips">${t.courses.map(c=>`<span class="chip">${c}</span>`).join("")}</span></div>
          <div class="kv"><span class="k">Grados que enseño</span><span class="chips">${t.gradesCanTeach.map(g=>`<span class="chip">${g}.º</span>`).join("")}</span></div>
          <div class="kv" style="flex-direction:column;align-items:flex-start;gap:6px">
            <span class="k">Mi disponibilidad semanal</span>
            <div style="width:100%">${(() => { const lines = availabilityLines(t); return lines.length
              ? lines.map(l => `<div style="padding:4px 0"><b>${l.day}:</b> ${l.parts.join(" · ")}</div>`).join("")
              : `<span class="muted">Sin horarios configurados.</span>`; })()}</div>
          </div>
          ${(t.blockedDates && t.blockedDates.length) ? `<div class="kv"><span class="k">Fechas no disponibles</span><span class="chips">${t.blockedDates.map(b=>`<span class="chip">${b.date}${b.reason?` · ${esc(b.reason)}`:""}</span>`).join("")}</span></div>` : ""}
        </div>
      </div>`;
  }

  // ============================================================
  //  EDITOR ESTRUCTURADO DE INFO DEL TUTOR (página completa)
  //  Disponibilidad con switches + bloques (time pickers). NUNCA el precio.
  // ============================================================
  let editDraft = null;

  function timeOptions(sel) {
    let out = "";
    for (let m = 6*60; m <= 22*60; m += 30) {
      const h = toHHMM(m);
      out += `<option value="${h}" ${h===sel?"selected":""}>${fmtAmPm(h)}</option>`;
    }
    return out;
  }
  // Asegura los 7 días presentes (activos/inactivos) para el editor.
  function normalizeAvailability(av) {
    return DAYS.map(d => {
      const found = (av || []).find(a => a.dayOfWeek === d.key);
      return found
        ? { dayOfWeek: d.key, isActive: !!found.isActive, slots: (found.slots || []).map(s => ({ ...s })) }
        : { dayOfWeek: d.key, isActive: false, slots: [] };
    });
  }

  function openEditTutor() {
    const u = me();
    const t = db.tutors.find(x => x.userId === u.id);
    if (!t) return;
    editDraft = {
      university: t.university || "", personality: t.personality || "", methodology: t.methodology || "",
      courses: [...t.courses], grades: [...t.gradesCanTeach],
      availability: normalizeAvailability(t.availability),
      blockedDates: (t.blockedDates || []).map(b => ({ ...b })),
    };
    renderEditTutor();
  }

  function renderEditTutor() {
    const d = editDraft;
    el("view").innerHTML = `
      <a class="btn btn-ghost btn-sm" onclick="App.backToDash()">← Volver al dashboard</a>
      <div class="page-head" style="margin-top:12px"><h1>Editar mi información</h1><p>Configura tu disponibilidad y qué enseñas. El precio lo define el sistema — tú no lo editas.</p></div>
      <div class="form-grid">
        <div>
          <div class="panel">
            <h3>👤 Información personal</h3>
            <div class="field"><label>Universidad / carrera</label><input id="ed-university" value="${esc(d.university)}"></div>
            <div class="field"><label>Personalidad</label><textarea id="ed-personality" rows="3">${esc(d.personality)}</textarea></div>
            <div class="field" style="margin:0"><label>Metodología</label><textarea id="ed-methodology" rows="3">${esc(d.methodology)}</textarea></div>
          </div>
          <div class="panel">
            <h3>📚 Cursos que enseño</h3>
            <div class="check-grid">${DB.CURSOS.map(c => `<label class="check"><input type="checkbox" class="ed-course" value="${c}" ${d.courses.includes(c)?"checked":""}> ${c}</label>`).join("")}</div>
          </div>
          <div class="panel">
            <h3>🎓 Grados que puedo enseñar</h3>
            <div class="check-grid grades">${GRADES.map(g => `<label class="check"><input type="checkbox" class="ed-grade" value="${g}" ${d.grades.includes(g)?"checked":""}> ${g}.º</label>`).join("")}</div>
          </div>
        </div>
        <div>
          <div class="panel">
            <h3>🗓️ Mi disponibilidad semanal</h3>
            <p class="muted" style="font-size:13px;margin:-2px 0 10px">Activa los días y agrega bloques con hora de inicio, fin y modalidad.</p>
            <div id="av-days"></div>
          </div>
          <div class="panel">
            <h3>🚫 Fechas no disponibles</h3>
            <p class="muted" style="font-size:13px;margin:-2px 0 10px">Bloquea días puntuales (exámenes, viajes) aunque normalmente trabajes.</p>
            <div id="bd-list"></div>
            <div class="form-2" style="margin-top:10px">
              <div class="field" style="margin:0"><label>Fecha</label><input type="date" id="bd-date" min="${todayStr()}"></div>
              <div class="field" style="margin:0"><label>Motivo (opcional)</label><input id="bd-reason" placeholder="Examen, viaje…"></div>
            </div>
            <button class="btn btn-sm" style="margin-top:10px" onclick="App.addBlockedDate()">+ Agregar fecha bloqueada</button>
          </div>
        </div>
      </div>
      <div class="row" style="margin-top:20px;justify-content:flex-end">
        <button class="btn" onclick="App.backToDash()">Cancelar</button>
        <button class="btn btn-primary" onclick="App.saveEditTutor()">Guardar cambios</button>
      </div>`;
    drawAvDays();
    drawBlockedDates();
    window.scrollTo(0, 0);
  }

  function drawAvDays() {
    const box = el("av-days"); if (!box) return;
    box.innerHTML = editDraft.availability.map((d, di) => `
      <div class="av-day ${d.isActive ? "on" : ""}">
        <div class="av-day-head">
          <label class="switch"><input type="checkbox" ${d.isActive?"checked":""} onchange="App.toggleDay(${di})"><span class="slider"></span></label>
          <b>${DAY_LABEL[d.dayOfWeek]}</b>
        </div>
        ${d.isActive ? `<div class="av-slots">
          ${d.slots.length ? d.slots.map((s, si) => `
            <div class="av-slot">
              <select onchange="App.changeSlot(${di},${si},'startTime',this.value)">${timeOptions(s.startTime)}</select>
              <span class="muted">a</span>
              <select onchange="App.changeSlot(${di},${si},'endTime',this.value)">${timeOptions(s.endTime)}</select>
              <select onchange="App.changeSlot(${di},${si},'modality',this.value)">
                <option value="online" ${s.modality==="online"?"selected":""}>Online</option>
                <option value="presencial" ${s.modality==="presencial"?"selected":""}>Presencial</option>
                <option value="ambas" ${s.modality==="ambas"?"selected":""}>Ambas</option>
              </select>
              <button class="btn btn-sm btn-icon" onclick="App.removeSlot(${di},${si})" title="Quitar bloque">✕</button>
            </div>`).join("") : `<div class="muted" style="font-size:13px">Sin bloques todavía.</div>`}
          <button class="btn btn-sm" onclick="App.addSlot(${di})">+ Agregar otro horario</button>
        </div>` : ""}
      </div>`).join("");
  }
  function toggleDay(di) {
    const d = editDraft.availability[di];
    d.isActive = !d.isActive;
    if (d.isActive && !d.slots.length) d.slots.push({ startTime: "16:00", endTime: "18:00", modality: "online" });
    drawAvDays();
  }
  function addSlot(di) { editDraft.availability[di].slots.push({ startTime: "16:00", endTime: "18:00", modality: "online" }); drawAvDays(); }
  function removeSlot(di, si) { editDraft.availability[di].slots.splice(si, 1); drawAvDays(); }
  function changeSlot(di, si, field, val) { editDraft.availability[di].slots[si][field] = val; }

  function drawBlockedDates() {
    const box = el("bd-list"); if (!box) return;
    box.innerHTML = editDraft.blockedDates.length
      ? editDraft.blockedDates.map((b, i) => `<div class="kv"><span>${b.date}${b.reason?` · <span class="muted">${esc(b.reason)}</span>`:""}</span><button class="btn btn-sm btn-icon" onclick="App.removeBlockedDate(${i})">✕</button></div>`).join("")
      : `<p class="muted" style="font-size:13px">Ninguna fecha bloqueada.</p>`;
  }
  function addBlockedDate() {
    const date = el("bd-date").value, reason = el("bd-reason").value.trim();
    if (!date) { toast("Elige una fecha"); return; }
    if (editDraft.blockedDates.some(b => b.date === date)) { toast("Esa fecha ya está bloqueada"); return; }
    editDraft.blockedDates.push({ date, reason }); el("bd-date").value = ""; el("bd-reason").value = ""; drawBlockedDates();
  }
  function removeBlockedDate(i) { editDraft.blockedDates.splice(i, 1); drawBlockedDates(); }

  function backToDash() { editDraft = null; renderTutorDash(el("view")); window.scrollTo(0, 0); }

  function saveEditTutor() {
    const u = me();
    const t = db.tutors.find(x => x.userId === u.id);
    const courses = [...document.querySelectorAll(".ed-course:checked")].map(x => x.value);
    const grades = [...document.querySelectorAll(".ed-grade:checked")].map(x => parseInt(x.value)).sort((a,b)=>a-b);
    if (!courses.length) { toast("Elige al menos un curso"); return; }
    if (!grades.length) { toast("Elige al menos un grado"); return; }
    // Validación de disponibilidad estructurada
    for (const d of editDraft.availability) {
      if (!d.isActive) continue;
      if (!d.slots.length) { toast(`${DAY_LABEL[d.dayOfWeek]}: agrega un bloque o desactiva el día`); return; }
      const slots = [...d.slots].sort((a,b) => toMin(a.startTime) - toMin(b.startTime));
      for (let i = 0; i < slots.length; i++) {
        const s = slots[i];
        if (!s.modality) { toast(`${DAY_LABEL[d.dayOfWeek]}: falta la modalidad`); return; }
        if (toMin(s.startTime) >= toMin(s.endTime)) { toast(`${DAY_LABEL[d.dayOfWeek]}: el inicio debe ser antes del fin`); return; }
        if (toMin(s.endTime) - toMin(s.startTime) < 30) { toast(`${DAY_LABEL[d.dayOfWeek]}: cada bloque debe durar al menos 30 min`); return; }
        if (i > 0 && toMin(s.startTime) < toMin(slots[i-1].endTime)) { toast(`${DAY_LABEL[d.dayOfWeek]}: hay bloques solapados`); return; }
      }
      d.slots = slots;
    }
    const availability = editDraft.availability
      .filter(d => d.isActive && d.slots.length)
      .map(d => ({ dayOfWeek: d.dayOfWeek, isActive: true, slots: d.slots }));
    t.courses = courses; t.gradesCanTeach = grades;
    t.university = el("ed-university").value.trim();
    t.personality = el("ed-personality").value.trim();
    t.methodology = el("ed-methodology").value.trim();
    t.availability = availability;
    t.blockedDates = editDraft.blockedDates;
    persist(); editDraft = null; toast("Información actualizada ✓"); renderTutorDash(el("view")); window.scrollTo(0, 0);
  }

  // ---- Calificación del alumno a una clase completada ----
  function openRate(bookingId) {
    const b = db.bookings.find(x => x.id === bookingId);
    // Regla: solo el dueño de la reserva, completada y sin calificar.
    if (!b || b.studentId !== db.session || b.status !== "completed" || b.reviewed) {
      toast("No puedes calificar esta clase"); return;
    }
    const t = tutorById(b.tutorId);
    modal(`
      <h3>Calificar a ${esc(t.name)}</h3>
      <div class="sub">Clase de ${b.course} · ${b.date}</div>
      <div class="field"><label>Tu calificación</label>
        <div id="rate-stars" style="font-size:34px;letter-spacing:6px;cursor:pointer;color:var(--warn)"></div></div>
      <div class="field"><label>Comentario (opcional)</label>
        <textarea id="rate-comment" rows="3" placeholder="¿Cómo te fue en la clase?" style="width:100%;background:var(--card-2);color:var(--text);border:1.5px solid var(--border);border-radius:10px;padding:10px;font-family:inherit;font-size:14px"></textarea></div>
      <button class="btn btn-primary btn-block" onclick="App.submitRate('${b.id}')">Enviar calificación</button>
    `);
    App._rateValue = 5;
    drawRateStars();
    el("rate-stars").addEventListener("click", (e) => {
      const box = el("rate-stars"); const rect = box.getBoundingClientRect();
      const rel = (e.clientX - rect.left) / rect.width;
      App._rateValue = Math.max(1, Math.min(5, Math.ceil(rel * 5)));
      drawRateStars();
    });
  }
  function drawRateStars() {
    const v = App._rateValue || 5;
    el("rate-stars").innerHTML = ("★".repeat(v) + "☆".repeat(5 - v));
  }
  function submitRate(bookingId) {
    const b = db.bookings.find(x => x.id === bookingId);
    if (!b || b.studentId !== db.session || b.status !== "completed" || b.reviewed) { toast("Acción no válida"); return; }
    const t = tutorById(b.tutorId);
    const stars = App._rateValue || 5;
    const comment = (el("rate-comment").value || "").trim();
    const student = userById(b.studentId);
    // Recalcular rating promedio del tutor (media ponderada con las reseñas previas).
    const newCount = (t.reviews || 0) + 1;
    const newRating = ((t.rating || 0) * (t.reviews || 0) + stars) / newCount;
    t.rating = +newRating.toFixed(2);
    t.reviews = newCount;
    t.reviewsList = t.reviewsList || [];
    t.reviewsList.push({
      studentName: student ? student.name.split(" ")[0] + " " + (student.name.split(" ")[1]?.[0] || "") + "." : "Alumno",
      stars, comment, date: new Date().toISOString().slice(0, 10),
    });
    b.reviewed = true;
    persist(); closeModal(); toast("¡Gracias por calificar! ⭐"); renderStudent(el("view"));
  }

  // ====================================================
  //  PANEL ADMIN — control total + comisiones + payouts
  // ====================================================
  let adminTab = "resumen";
  function renderAdmin(view) {
    const all = db.bookings;
    const ingresos = all.filter(b=>b.paymentStatus==="approved").reduce((s,b)=>s+b.price,0);
    const comisiones = all.filter(b=>b.paymentStatus==="approved").reduce((s,b)=>s+b.commission,0);
    const aPagarTutores = all.filter(b=>b.paymentStatus==="approved" && b.payoutStatus!=="pagado").reduce((s,b)=>s+b.tutorEarning,0);
    const enRevision = all.filter(b=>b.paymentStatus==="manual_review");

    const efRate = ingresos ? Math.round((comisiones / ingresos) * 100) : 0;
    const solicitudes = db.tutors.filter(t => t.approvalStatus === "pending");
    const tabLabels = { resumen:"Resumen", solicitudes:"Solicitudes", pagos:"Pagos", reservas:"Reservas", payouts:"Payouts", tutores:"Tutores", precios:"Precios", usuarios:"Usuarios" };
    const tabs = ["resumen","solicitudes","pagos","reservas","payouts","tutores","precios","usuarios"];
    view.innerHTML = `
      <div class="page-head"><h1>Panel de administración</h1><p>Control total: solicitudes, tutores, reservas, pagos y comisiones</p></div>
      <div class="tabs">${tabs.map(t=>`<a class="tab ${adminTab===t?"active":""}" onclick="App.setAdminTab('${t}')">${tabLabels[t]}${t==="solicitudes"&&solicitudes.length?` <span class="tab-count">${solicitudes.length}</span>`:""}</a>`).join("")}</div>
      <div id="admin-body"></div>`;

    const body = el("admin-body");
    if (adminTab === "resumen") {
      body.innerHTML = `
        <div class="stat-cards">
          <div class="stat accent"><div class="l">Ingresos (aprobados)</div><div class="n">${money(ingresos)}</div></div>
          <div class="stat primary"><div class="l">Comisión plataforma (~${efRate}%)</div><div class="n">${money(comisiones)}</div></div>
          <div class="stat warn"><div class="l">Por pagar a tutores</div><div class="n">${money(aPagarTutores)}</div></div>
          <div class="stat"><div class="l">Pagos por revisar</div><div class="n">${enRevision.length}</div></div>
        </div>
        ${solicitudes.length ? `<div class="alert">📋 Tienes <b>${solicitudes.length}</b> solicitud(es) de tutor por revisar. <a onclick="App.setAdminTab('solicitudes')" style="color:var(--primary-2);cursor:pointer;font-weight:700">Revisar solicitudes →</a></div>` : ""}
        ${enRevision.length ? `<div class="alert">🔔 Tienes <b>${enRevision.length}</b> pago(s) esperando verificación. <a onclick="App.setAdminTab('pagos')" style="color:var(--primary-2);cursor:pointer;font-weight:700">Revisar ahora →</a></div>` : ""}
        <div class="alert">💡 Flujo de dinero: el alumno yapea a la cuenta admin (${DB.YAPE_ADMIN.phone}) con un código de 8 dígitos. El admin verifica el pago con ese código y aprueba manualmente; recién ahí la reserva queda confirmada. Luego el admin transfiere a cada tutor su parte y la comisión interna queda para la plataforma.</div>`;
    }

    if (adminTab === "solicitudes") {
      const pend = db.tutors.filter(t => t.approvalStatus === "pending");
      body.innerHTML = `
        <div class="alert">Revisa cada postulación antes de publicar al tutor. Al aprobar, el tutor aparece en la página principal y puede recibir reservas. Nadie se activa como tutor sin tu aprobación.</div>
        ${pend.length ? pend.map(t => {
          const u = userById(t.userId);
          return `<div class="panel review-card">
            <div class="review-head">
              <div style="display:flex;gap:14px;align-items:center">
                <div class="avatar">${t.avatar}</div>
                <div>
                  <b style="font-size:16px">${esc(t.name)}</b>
                  <div class="muted" style="font-size:13px">${t.grade}.º${t.section?` "${esc(t.section)}"`:""} · ${esc(u?u.email:"-")}</div>
                </div>
              </div>
              <span class="badge pend">pendiente</span>
            </div>
            <div class="review-grid">
              <div><span class="k">WhatsApp</span><b>${esc(t.whatsapp||"—")}</b></div>
              <div><span class="k">Universidad / carrera</span><b>${esc(t.university||"—")}</b></div>
              <div><span class="k">Cursos</span><span class="chips">${t.courses.map(c=>`<span class="chip">${c}</span>`).join("")}</span></div>
              <div><span class="k">Grados</span><span class="chips">${t.gradesCanTeach.map(g=>`<span class="chip">${g}.º</span>`).join("")}</span></div>
              <div><span class="k">Fecha de postulación</span><b>${t.appliedAt||"-"}</b></div>
              <div><span class="k">Notas desde 9.º</span><b>${t.notes&&t.notes.length? t.notes.map(n=>`${n.course} ${n.note}`).join(", ") : "—"}</b></div>
            </div>
            <div class="field" style="margin:14px 0 10px"><label>Motivo (si vas a rechazar)</label>
              <input id="rej-${t.id}" placeholder="Ej: falta información / no cumple requisitos"></div>
            <div class="row">
              <button class="btn btn-accent" onclick="App.approveTutor('${t.id}')">✓ Aprobar tutor</button>
              <button class="btn" onclick="App.rejectTutor('${t.id}')">✕ Rechazar tutor</button>
              <button class="btn btn-ghost" onclick="App.viewTutorDetail('${t.id}')">Ver detalle</button>
            </div>
          </div>`;
        }).join("") : `<div class="empty">No hay solicitudes pendientes 🎉</div>`}`;
    }

    if (adminTab === "pagos") {
      const queue = all.filter(b => b.paymentStatus === "manual_review");
      body.innerHTML = `
        <div class="alert">Verifica cada pago en Yape usando el <b>código de 8 dígitos</b>, el <b>monto exacto</b> y la <b>captura</b>. Ninguna reserva se confirma sin tu aprobación manual.</div>
        ${queue.length ? queue.map(b => {
          const al = userById(b.studentId), t = tutorById(b.tutorId);
          return `<div class="panel review-card">
            <div class="review-head">
              <div>
                <b>${esc(al?al.name:"-")}</b> <span class="muted">→</span> <b>${esc(t?t.name:"-")}</b>
                <div class="muted" style="font-size:13px">Reserva ${b.id} · ${b.course}</div>
              </div>
              <div class="pay-code-lg">${b.verificationCode}</div>
            </div>
            <div class="review-grid">
              <div><span class="k">Fecha / hora</span><b>${b.date} · ${fmtAmPm(b.time)}</b></div>
              <div><span class="k">Duración</span><b>${b.duration} min</b></div>
              <div><span class="k">Modalidad</span><span class="chip ${b.modality}">${b.modality}</span></div>
              <div><span class="k">Monto exacto</span><b>${money(b.price)}</b></div>
              <div><span class="k">Tutor recibe</span><b style="color:var(--accent)">${money(b.tutorEarning)}</b></div>
              <div><span class="k">Comisión interna</span><b style="color:var(--primary-2)">${money(b.commission)}</b></div>
              <div><span class="k">Estado del pago</span>${badge(b.paymentStatus)}</div>
              <div><span class="k">Comprobante</span>${b.proof ? `<a class="chip" title="${esc(b.proof)}">📎 ${esc(b.proof)}</a>` : `<span class="muted">sin captura</span>`}</div>
            </div>
            <div class="field" style="margin:14px 0 10px"><label>Nota interna (opcional)</label>
              <input id="note-${b.id}" placeholder="Ej: pago verificado en Yape a las 4:12pm"></div>
            <div class="row">
              <button class="btn btn-accent" onclick="App.approvePayment('${b.id}')">✓ Confirmar pago</button>
              <button class="btn" onclick="App.rejectPayment('${b.id}')">✕ Rechazar pago</button>
            </div>
          </div>`;
        }).join("") : `<div class="empty">No hay pagos pendientes de verificación 🎉</div>`}`;
    }

    if (adminTab === "reservas") {
      body.innerHTML = `
        <div class="table-wrap"><table class="table">
          <thead><tr><th>ID</th><th>Alumno</th><th>Tutor</th><th>Curso</th><th>Fecha / hora</th><th>Código</th><th>Precio</th><th>Comisión</th><th>Tutor recibe</th><th>Pago</th><th>Estado</th></tr></thead>
          <tbody>${all.map(b=>{
            const al=userById(b.studentId), t=tutorById(b.tutorId);
            return `<tr>
              <td class="muted">${b.id}</td>
              <td>${esc(al?al.name:"-")}</td><td>${esc(t?t.name:"-")}</td><td>${b.course}</td>
              <td>${b.date}<br><span class="muted">${fmtAmPm(b.time)} · ${b.duration}min</span></td>
              <td class="pay-code">${b.verificationCode}</td>
              <td><b>${money(b.price)}</b></td>
              <td style="color:var(--primary-2)">${money(b.commission)}</td>
              <td style="color:var(--accent)">${money(b.tutorEarning)}</td>
              <td>${badge(b.paymentStatus)}</td>
              <td>${badge(b.status)}</td>
            </tr>`;
          }).join("")}</tbody>
        </table></div>
        <p class="muted" style="font-size:13px;margin-top:12px">* Solo el admin ve el desglose completo: precio final, comisión interna y monto del tutor. Para aprobar pagos usa la pestaña <b>Pagos</b>.</p>`;
    }

    if (adminTab === "payouts") {
      const pend = all.filter(b=>b.paymentStatus==="approved" && b.payoutStatus!=="pagado");
      body.innerHTML = `
        <div class="alert">Pagos pendientes a tutores (vía Yape). Marca como pagado cuando transfieras.</div>
        <div class="table-wrap"><table class="table">
          <thead><tr><th>Tutor</th><th>Clase</th><th>Fecha</th><th>Monto a transferir</th><th>Acción</th></tr></thead>
          <tbody>${pend.length ? pend.map(b=>{
            const t=tutorById(b.tutorId);
            return `<tr>
              <td>${esc(t?t.name:"-")}</td><td>${b.course}</td><td>${b.date}</td>
              <td><b style="color:var(--accent)">${money(b.tutorEarning)}</b></td>
              <td><button class="btn btn-sm btn-yape" onclick="App.payTutor('${b.id}')">Pagar al tutor</button></td>
            </tr>`;
          }).join("") : `<tr><td colspan="5" class="empty">No hay payouts pendientes 🎉</td></tr>`}</tbody>
        </table></div>`;
    }

    if (adminTab === "usuarios") {
      body.innerHTML = `
        <div class="table-wrap"><table class="table">
          <thead><tr><th>Nombre</th><th>Email</th><th>Rol</th><th>Grado</th><th>Estado de cuenta</th></tr></thead>
          <tbody>${db.users.map(u=>`<tr><td>${esc(u.name)}</td><td>${esc(u.email)}</td>
            <td><span class="tag-role">${u.role}</span></td><td>${u.grade?u.grade+".º":"-"}</td>
            <td>${badge(u.status||"active")}</td></tr>`).join("")}</tbody>
        </table></div>`;
    }

    if (adminTab === "tutores") {
      const stBadge = { active: "ok", suspended: "pend", inactive: "no" };
      const stLabel = { active: "activo", suspended: "suspendido", inactive: "desactivado" };
      const activos = db.tutors.filter(t => t.approvalStatus === "approved");
      const log = (db.auditLog || []).slice().reverse().slice(0, 8);
      body.innerHTML = `
        <div class="alert">Suspender/desactivar/ocultar usa <b>soft delete</b>: el tutor deja de aparecer en la página principal y no recibe nuevas reservas, pero se conserva todo su historial.</div>
        <div class="table-wrap"><table class="table">
          <thead><tr><th>Tutor</th><th>Cursos</th><th>Rating</th><th>Precio cliente</th><th>Cuenta</th><th>Público</th><th>Acciones</th></tr></thead>
          <tbody>${activos.length ? activos.map(t=>{
            const q = quote(t), st = accountStatus(t);
            const actions = [];
            if (st !== "active") actions.push(`<button class="btn btn-sm btn-accent" onclick="App.setAccountStatus('${t.id}','active')">Reactivar</button>`);
            if (st === "active") {
              actions.push(`<button class="btn btn-sm" onclick="App.toggleTutorPublic('${t.id}')">${t.isPublic?"Ocultar":"Mostrar"}</button>`);
              actions.push(`<button class="btn btn-sm" onclick="App.setAccountStatus('${t.id}','suspended')">Suspender</button>`);
              actions.push(`<button class="btn btn-sm" onclick="App.setAccountStatus('${t.id}','inactive')">Desactivar</button>`);
            }
            return `<tr>
              <td>${esc(t.name)}</td><td>${t.courses.join(", ")}</td>
              <td>${fmtR(t.rating)} ★ <span class="muted">(${t.reviews})</span></td>
              <td><b>${money(q.finalPrice)}</b></td>
              <td><span class="badge ${stBadge[st]||"pend"}">${stLabel[st]||st}</span></td>
              <td>${isTutorPublic(t)?`<span class="badge ok">visible</span>`:`<span class="badge no">oculto</span>`}</td>
              <td><div class="row" style="gap:6px">${actions.join("")}</div></td>
            </tr>`;
          }).join("") : `<tr><td colspan="7" class="empty">Aún no hay tutores aprobados.</td></tr>`}</tbody>
        </table></div>
        <div class="section">
          <h2>Historial de acciones (auditoría)</h2>
          <div class="table-wrap"><table class="table">
            <thead><tr><th>Fecha</th><th>Admin</th><th>Acción</th><th>Tutor</th><th>Motivo</th></tr></thead>
            <tbody>${log.length ? log.map(l=>`<tr>
              <td class="muted">${new Date(l.when).toLocaleString("es-PE",{dateStyle:"short",timeStyle:"short"})}</td>
              <td>${esc(l.adminName)}</td><td><b>${esc(l.action)}</b></td><td>${esc(l.tutorName)}</td><td class="muted">${esc(l.reason||"—")}</td>
            </tr>`).join("") : `<tr><td colspan="5" class="empty">Sin acciones registradas todavía.</td></tr>`}</tbody>
          </table></div>
        </div>`;
    }

    if (adminTab === "precios") {
      const p = db.pricing;
      body.innerHTML = `
        <div class="alert">Tabla de precios del sistema. El precio de cada tutor se calcula desde aquí según su rating y reseñas. La <b>comisión interna</b> se deriva sola (precio cliente − pago al tutor). Los tutores no pueden ver ni editar esto.</div>
        <div class="table-wrap"><table class="table">
          <thead><tr><th>Tramo (rango de rating)</th><th>Precio cliente (S/)</th><th>Pago al tutor (S/)</th><th>Comisión interna</th></tr></thead>
          <tbody>${p.tiers.map((tier,i)=>`
            <tr>
              <td><b>${esc(tier.label)}</b><div class="muted" style="font-size:12px">rating ≥ ${tier.minRating}</div></td>
              <td><input class="pr-final" data-i="${i}" type="number" min="0" step="1" value="${tier.finalPrice}" style="width:90px"></td>
              <td><input class="pr-payout" data-i="${i}" type="number" min="0" step="1" value="${tier.tutorPayout}" style="width:90px"></td>
              <td class="pr-comm" data-i="${i}" style="color:var(--primary-2);font-weight:700">${money(tier.finalPrice - tier.tutorPayout)}</td>
            </tr>`).join("")}</tbody>
        </table></div>
        <div class="row" style="margin-top:16px;align-items:center">
          <div class="field" style="margin:0">
            <label>Reseñas mínimas para acceder a tramos superiores</label>
            <input id="pr-minrev" type="number" min="0" step="1" value="${p.minReviewsForRating}" style="width:120px">
          </div>
          <button class="btn btn-primary" style="align-self:flex-end" onclick="App.savePricing()">Guardar tabla de precios</button>
        </div>`;
      // Comisión en vivo mientras el admin edita
      body.querySelectorAll(".pr-final, .pr-payout").forEach(inp => {
        inp.addEventListener("input", () => {
          const i = inp.dataset.i;
          const f = parseFloat(body.querySelector(`.pr-final[data-i="${i}"]`).value) || 0;
          const pay = parseFloat(body.querySelector(`.pr-payout[data-i="${i}"]`).value) || 0;
          body.querySelector(`.pr-comm[data-i="${i}"]`).textContent = money(f - pay);
        });
      });
    }
  }

  // ---- Acciones de aprobación / gestión (SOLO ADMIN) ----
  function approveTutor(id) {
    if (!requireAdmin()) return;
    const t = tutorById(id); if (!t || t.approvalStatus !== "pending") return;
    const u = userById(t.userId);
    t.approvalStatus = "approved"; t.isPublic = true; t.rejectionReason = "";
    if (u) u.status = "active";
    logAction("Aprobó tutor", t);
    persist(); toast(`${t.name} aprobado. Ya aparece en la página principal ✓`); renderAdmin(el("view"));
  }
  function rejectTutor(id) {
    if (!requireAdmin()) return;
    const t = tutorById(id); if (!t || t.approvalStatus !== "pending") return;
    const u = userById(t.userId);
    const reason = (el("rej-" + id) && el("rej-" + id).value.trim()) || "";
    t.approvalStatus = "rejected"; t.isPublic = false; t.rejectionReason = reason;
    if (u) u.status = "rejected";
    logAction("Rechazó tutor", t, reason);
    persist(); toast("Solicitud rechazada."); renderAdmin(el("view"));
  }
  // Cambia el estado de cuenta del tutor (activo/suspendido/inactivo) y ajusta visibilidad.
  function setAccountStatus(id, status) {
    if (!requireAdmin()) return;
    const t = tutorById(id); if (!t) return;
    const u = userById(t.userId); if (!u) return;
    u.status = status;
    if (status !== "active") t.isPublic = false;   // suspendido/inactivo → nunca público
    else t.isPublic = true;                         // reactivar → vuelve a ser visible
    logAction(status === "active" ? "Reactivó tutor" : status === "suspended" ? "Suspendió tutor" : "Desactivó tutor", t);
    persist();
    toast(status === "active" ? "Tutor reactivado" : status === "suspended" ? "Tutor suspendido" : "Tutor desactivado");
    renderAdmin(el("view"));
  }
  // Ocultar/mostrar de la página principal sin cambiar el estado de cuenta.
  function toggleTutorPublic(id) {
    if (!requireAdmin()) return;
    const t = tutorById(id); if (!t) return;
    t.isPublic = !t.isPublic;
    logAction(t.isPublic ? "Mostró tutor" : "Ocultó tutor", t);
    persist(); toast(t.isPublic ? "Tutor visible en la página" : "Tutor oculto de la página"); renderAdmin(el("view"));
  }
  function viewTutorDetail(id) {
    const t = tutorById(id); if (!t) return;
    const u = userById(t.userId);
    modal(`
      <h3>${esc(t.name)}</h3>
      <div class="sub">${t.grade}.º${t.section?` "${esc(t.section)}"`:""} · ${esc(u?u.email:"-")} · ${badge(t.approvalStatus)}</div>
      <div class="kv"><span class="k">WhatsApp</span><b>${esc(t.whatsapp||"—")}</b></div>
      <div class="kv"><span class="k">Universidad / carrera</span><b>${esc(t.university||"—")}</b></div>
      <div class="kv"><span class="k">Cursos</span><span class="chips">${t.courses.map(c=>`<span class="chip">${c}</span>`).join("")}</span></div>
      <div class="kv"><span class="k">Grados</span><span class="chips">${t.gradesCanTeach.map(g=>`<span class="chip">${g}.º</span>`).join("")}</span></div>
      <div class="kv" style="flex-direction:column;align-items:flex-start;gap:4px"><span class="k">Personalidad</span><span class="muted">${esc(t.personality||"—")}</span></div>
      <div class="kv" style="flex-direction:column;align-items:flex-start;gap:4px"><span class="k">Metodología</span><span class="muted">${esc(t.methodology||"—")}</span></div>
      <div class="kv" style="flex-direction:column;align-items:flex-start;gap:4px"><span class="k">Notas desde 9.º</span><span>${t.notes&&t.notes.length? t.notes.map(n=>`${n.year||""} ${n.course}: ${n.note}/20`).join(" · ") : "—"}</span></div>
      <div class="kv" style="flex-direction:column;align-items:flex-start;gap:4px"><span class="k">Disponibilidad</span><div>${availabilityLines(t).map(l=>`<div style="padding:2px 0"><b>${l.day}:</b> ${l.parts.join(" · ")}</div>`).join("")||"—"}</div></div>
    `);
  }
  function savePricing() {
    const finals = [...document.querySelectorAll(".pr-final")];
    finals.forEach(inp => {
      const i = +inp.dataset.i;
      const finalPrice = parseFloat(inp.value) || 0;
      const payout = parseFloat(document.querySelector(`.pr-payout[data-i="${i}"]`).value) || 0;
      db.pricing.tiers[i].finalPrice = finalPrice;
      db.pricing.tiers[i].tutorPayout = payout;
    });
    db.pricing.minReviewsForRating = parseInt(el("pr-minrev").value) || 0;
    persist(); toast("Tabla de precios actualizada ✓"); renderAdmin(el("view"));
  }
  function setAdminTab(t) { adminTab = t; renderAdmin(el("view")); }

  // Solo el admin confirma pagos. Aprobar → pago approved + reserva confirmed + payout pendiente.
  function approvePayment(id) {
    const b = db.bookings.find(x => x.id === id); if (!b) return;
    const note = el("note-" + id); if (note && note.value.trim()) b.adminNote = note.value.trim();
    b.paymentStatus = "approved";
    b.status = "confirmed";
    b.payoutStatus = b.payoutStatus || "pendiente";
    persist(); toast("Pago aprobado. Reserva confirmada ✓"); renderAdmin(el("view"));
  }
  // Rechazar → pago rejected + reserva vuelve a awaiting_payment (el alumno puede reintentar).
  function rejectPayment(id) {
    const b = db.bookings.find(x => x.id === id); if (!b) return;
    const note = el("note-" + id); b.adminNote = (note && note.value.trim()) || "Pago rechazado por el administrador";
    b.paymentStatus = "rejected";
    b.status = "awaiting_payment";
    persist(); toast("Pago rechazado. El alumno puede reintentar."); renderAdmin(el("view"));
  }
  function payTutor(id) { const b=db.bookings.find(x=>x.id===id); b.payoutStatus="pagado"; if(b.status==="confirmed")b.status="completed"; persist(); toast("Tutor pagado vía Yape ✓"); renderAdmin(el("view")); }

  // ====================================================
  //  AUTH (login / registro)
  // ====================================================
  function openLogin() {
    modal(`
      <h3>Iniciar sesión</h3>
      <div class="sub">Demo: usa una cuenta de prueba o crea la tuya</div>
      <div class="field"><label>Email</label><input id="lg-email" placeholder="ana@colegio.edu"></div>
      <div class="field"><label>Contraseña</label><input type="password" id="lg-pass" placeholder="123"></div>
      <button class="btn btn-primary btn-block" onclick="App.doLogin()">Entrar</button>
      <div class="divider"></div>
      <div class="muted" style="font-size:13px">Cuentas de prueba:</div>
      <div class="row" style="margin-top:8px">
        <button class="btn btn-sm" onclick="App.quickLogin('ana@colegio.edu')">👩‍🎓 Alumno</button>
        <button class="btn btn-sm" onclick="App.quickLogin('mateo@colegio.edu')">🧑‍🏫 Tutor</button>
        <button class="btn btn-sm" onclick="App.quickLogin('admin@colegio.edu')">🛠️ Admin</button>
      </div>
    `);
  }
  function quickLogin(email) { el("lg-email").value = email; el("lg-pass").value = email==="admin@colegio.edu"?"admin":"123"; doLogin(); }
  function doLogin() {
    const email = el("lg-email").value.trim().toLowerCase();
    const pass = el("lg-pass").value;
    const u = db.users.find(x => x.email.toLowerCase() === email && x.password === pass);
    if (!u) { toast("Credenciales incorrectas"); return; }
    db.session = u.id; persist(); closeModal(); renderNav();
    toast("¡Bienvenido, " + u.name + "!");
    if (u.role === "tutor") go("/tutor");
    else if (u.role === "admin") go("/admin");
    else go("/mis-reservas");
  }

  function openRegister() {
    // Nota de seguridad: el registro público SOLO ofrece alumno o tutor. Nunca admin.
    modal(`
      <h3>Crear cuenta</h3>
      <div class="sub">Regístrate como alumno o postula como tutor</div>
      <div class="field"><label>Nombre completo</label><input id="rg-name"></div>
      <div class="form-2">
        <div class="field"><label>Email</label><input id="rg-email"></div>
        <div class="field"><label>Contraseña</label><input type="password" id="rg-pass"></div>
      </div>
      <div class="form-2">
        <div class="field"><label>Soy...</label>
          <select id="rg-role" onchange="App.regRoleChange()">
            <option value="alumno">Alumno (busco tutor)</option>
            <option value="tutor">Tutor (quiero enseñar)</option>
          </select></div>
        <div class="field"><label>Grado</label>
          <select id="rg-grade">${range(1,11).map(g=>`<option value="${g}">${g}.º grado</option>`).join("")}</select></div>
      </div>
      <div id="rg-tutor-fields" style="display:none">
        <div class="alert">📋 Ser tutor requiere <b>aprobación del administrador</b>. Completa tus datos; tu perfil no será público hasta ser aprobado.</div>
        <div class="form-2">
          <div class="field"><label>Sección</label><input id="rg-section" placeholder="A"></div>
          <div class="field"><label>WhatsApp</label><input id="rg-whatsapp" placeholder="9xx xxx xxx"></div>
        </div>
        <div class="field"><label>Universidad / carrera de interés</label><input id="rg-university" placeholder="Ej: Ingeniería — PUCP"></div>
        <div class="field"><label>Cursos que quiero enseñar</label>
          <div class="check-grid">${DB.CURSOS.map(c=>`<label class="check"><input type="checkbox" class="rg-course" value="${c}"> ${c}</label>`).join("")}</div></div>
        <div class="field"><label>Grados a los que puedo enseñar</label>
          <div class="check-grid grades">${GRADES.map(g=>`<label class="check"><input type="checkbox" class="rg-grade-teach" value="${g}"> ${g}.º</label>`).join("")}</div></div>
        <div class="field"><label>Descripción personal</label><textarea id="rg-personality" rows="2" placeholder="¿Cómo enseñas? ¿Por qué serías buen tutor?"></textarea></div>
        <div class="field"><label>Metodología</label><textarea id="rg-methodology" rows="2" placeholder="Cómo llevas tus clases"></textarea></div>
      </div>
      <button class="btn btn-primary btn-block" id="rg-submit" onclick="App.doRegister()">Crear cuenta</button>
    `);
  }
  function regRoleChange() {
    const isTutor = el("rg-role").value === "tutor";
    el("rg-tutor-fields").style.display = isTutor ? "block" : "none";
    el("rg-submit").textContent = isTutor ? "Postular como tutor" : "Crear cuenta";
  }
  function doRegister() {
    const name = el("rg-name").value.trim();
    const email = el("rg-email").value.trim().toLowerCase();
    const pass = el("rg-pass").value;
    // Seguridad: el rol solo puede ser alumno o tutor; jamás admin desde el registro público.
    const role = el("rg-role").value === "tutor" ? "tutor" : "alumno";
    const grade = parseInt(el("rg-grade").value);
    if (!name || !email || !pass) { toast("Completa todos los campos"); return; }
    if (db.users.some(u => u.email.toLowerCase() === email)) { toast("Ese email ya existe"); return; }
    const id = "u-" + Date.now();

    if (role === "alumno") {
      db.users.push({ id, name, email, password: pass, role: "alumno", grade, status: "active" });
      db.session = id; persist(); closeModal(); renderNav();
      toast("¡Cuenta creada!"); go("/");
      return;
    }

    // POSTULACIÓN de tutor: queda PENDIENTE, nunca activa ni pública automáticamente.
    const courses = [...document.querySelectorAll(".rg-course:checked")].map(x => x.value);
    const grades = [...document.querySelectorAll(".rg-grade-teach:checked")].map(x => parseInt(x.value)).sort((a,b)=>a-b);
    if (!courses.length) { toast("Elige al menos un curso que quieras enseñar"); return; }
    if (!grades.length) { toast("Elige al menos un grado"); return; }
    db.users.push({ id, name, email, password: pass, role: "tutor", grade, status: "pending_approval" });
    db.tutors.push({
      id: "t-" + Date.now(), userId: id, name, avatar: name[0].toUpperCase(), grade,
      approvalStatus: "pending", isPublic: false, appliedAt: new Date().toISOString().slice(0,10), rejectionReason: "",
      section: el("rg-section").value.trim(), whatsapp: el("rg-whatsapp").value.trim(),
      courses, gradesCanTeach: grades,
      rating: 0, reviews: 0,
      personality: el("rg-personality").value.trim() || "—",
      methodology: el("rg-methodology").value.trim() || "—",
      university: el("rg-university").value.trim() || "—",
      notes: [],
      availability: [{ dayOfWeek: "monday", isActive: true, slots: [{ startTime: "16:00", endTime: "18:00", modality: "online" }] }],
      blockedDates: [], reviewsList: [],
    });
    db.session = id; persist(); closeModal(); renderNav();
    toast("Tu solicitud fue enviada. El administrador revisará tu información antes de activar tu perfil como tutor.");
    go("/tutor");
  }

  function logout() { db.session = null; persist(); renderNav(); go("/"); toast("Sesión cerrada"); }

  // ====================================================
  //  MODAL / UTILIDADES
  // ====================================================
  function modal(html) {
    el("modal-root").innerHTML = `
      <div class="modal-bg" onclick="if(event.target===this)App.closeModal()">
        <div class="modal">
          <button class="modal-close" onclick="App.closeModal()">×</button>
          ${html}
        </div>
      </div>`;
  }
  function closeModal() { el("modal-root").innerHTML = ""; }
  function optList(arr, sel) { return arr.map(o => `<option ${String(o)===String(sel)?"selected":""}>${o}</option>`).join(""); }
  function range(a, b) { return Array.from({length: b-a+1}, (_, i) => a+i); }

  // ====================================================
  //  INIT
  // ====================================================
  window.addEventListener("hashchange", router);
  window.addEventListener("DOMContentLoaded", router);

  return {
    go, openLogin, openRegister, regRoleChange, doLogin, quickLogin, doRegister, logout,
    openBooking, bkDateChange, bkRefresh, confirmBooking,
    openYapePayment, copyText, markPaid,
    setAdminTab, approvePayment, rejectPayment, payTutor, closeModal,
    approveTutor, rejectTutor, setAccountStatus, toggleTutorPublic, viewTutorDetail,
    openEditTutor, backToDash, saveEditTutor,
    toggleDay, addSlot, removeSlot, changeSlot, addBlockedDate, removeBlockedDate,
    openRate, submitRate,
    savePricing,
    _rateValue: 5,
  };
})();
