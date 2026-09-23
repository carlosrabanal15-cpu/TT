/* =========================================================
   TUTORS — Capa de datos (seed + persistencia localStorage)
   ========================================================= */
(function () {
  const KEY = "tutors_db_v4";

  // Cuenta Yape administradora (todo el dinero entra aquí primero)
  const YAPE_ADMIN = { name: "TUTORS Admin", phone: "987 654 321" };

  const CURSOS = [
    "Matemática", "Física", "Química", "Biología", "Comunicación",
    "Inglés", "Historia", "Programación", "Economía", "Arte",
  ];

  // Días de la semana (fuente única para disponibilidad estructurada)
  const DAYS = [
    { key: "monday",    label: "Lunes" },
    { key: "tuesday",   label: "Martes" },
    { key: "wednesday", label: "Miércoles" },
    { key: "thursday",  label: "Jueves" },
    { key: "friday",    label: "Viernes" },
    { key: "saturday",  label: "Sábado" },
    { key: "sunday",    label: "Domingo" },
  ];

  // Código aleatorio de 8 dígitos para verificar el pago Yape.
  function genCode() {
    return String(Math.floor(10000000 + Math.random() * 90000000));
  }

  // ---------- Tabla de precios (controlada por el ADMIN) ----------
  function seedPricing() {
    return {
      minReviewsForRating: 5,
      tiers: [
        { key: "nuevo", label: "Nuevo / sin reseñas", minRating: 0,   finalPrice: 18, tutorPayout: 14 },
        { key: "t40",   label: "4.0 – 4.4 ★",         minRating: 4.0, finalPrice: 22, tutorPayout: 17 },
        { key: "t45",   label: "4.5 – 4.7 ★",         minRating: 4.5, finalPrice: 26, tutorPayout: 20 },
        { key: "t48",   label: "4.8 – 5.0 ★",         minRating: 4.8, finalPrice: 32, tutorPayout: 25 },
      ],
    };
  }

  // Atajo para construir un día de disponibilidad activo con sus bloques.
  const day = (dayOfWeek, slots) => ({ dayOfWeek, isActive: true, slots });
  const slot = (startTime, endTime, modality) => ({ startTime, endTime, modality });

  // ---------- Datos semilla ----------
  function seed() {
    const pricing = seedPricing();

    const users = [
      // status de cuenta: active | pending_approval | rejected | suspended | inactive
      { id: "u-admin", name: "Dirección TUTORS", email: "admin@colegio.edu", password: "admin", role: "admin", grade: null, status: "active" },
      { id: "u-ana",   name: "Ana Torres",   email: "ana@colegio.edu",   password: "123", role: "alumno", grade: 7, status: "active" },
      { id: "u-luis",  name: "Luis Fernández", email: "luis@colegio.edu", password: "123", role: "alumno", grade: 4, status: "active" },
      { id: "u-mateo",  name: "Mateo Ríos",    email: "mateo@colegio.edu",  password: "123", role: "tutor", grade: 11, status: "active" },
      { id: "u-sofia",  name: "Sofía Quispe",  email: "sofia@colegio.edu",  password: "123", role: "tutor", grade: 11, status: "active" },
      { id: "u-diego",  name: "Diego Salas",   email: "diego@colegio.edu",  password: "123", role: "tutor", grade: 11, status: "active" },
      { id: "u-valeria",name: "Valeria Núñez", email: "valeria@colegio.edu",password: "123", role: "tutor", grade: 10, status: "active" },
      // Postulante pendiente de aprobación (para demo del panel admin)
      { id: "u-camila", name: "Camila Rojas", email: "camila@colegio.edu", password: "123", role: "tutor", grade: 11, status: "pending_approval" },
    ];

    const tutors = [
      {
        id: "t-mateo", userId: "u-mateo", name: "Mateo Ríos", avatar: "M", grade: 11, approvalStatus: "approved", isPublic: true, appliedAt: "2026-05-01", rejectionReason: "",
        courses: ["Matemática", "Física"], gradesCanTeach: [6,7,8,9,10],
        rating: 4.9, reviews: 32,
        personality: "Paciente y muy estructurado. Le encanta explicar con ejemplos del día a día.",
        methodology: "Resuelve dudas con problemas guiados paso a paso y deja mini-retos al final de cada sesión.",
        university: "Pre-PUCP — Ingeniería Industrial",
        notes: [
          { year: "9.º", course: "Matemática", note: 19 }, { year: "9.º", course: "Física", note: 18 },
          { year: "10.º", course: "Matemática", note: 20 }, { year: "10.º", course: "Física", note: 19 },
        ],
        availability: [
          day("monday",    [slot("16:00","18:00","ambas")]),
          day("wednesday", [slot("16:00","18:00","ambas")]),
          day("saturday",  [slot("09:00","12:00","presencial")]),
        ],
        blockedDates: [{ date: "2026-07-25", reason: "Examen" }],
        reviewsList: [
          { studentName: "Ana T.", stars: 5, comment: "Explica súper claro, me subió la nota.", date: "2026-06-10" },
        ],
      },
      {
        id: "t-sofia", userId: "u-sofia", name: "Sofía Quispe", avatar: "S", grade: 11, approvalStatus: "approved", isPublic: true, appliedAt: "2026-05-01", rejectionReason: "",
        courses: ["Comunicación", "Inglés", "Historia"], gradesCanTeach: [1,2,3,4,5,6,7,8],
        rating: 4.8, reviews: 27,
        personality: "Creativa y motivadora, ideal para alumnos pequeños que se distraen.",
        methodology: "Usa juegos, lecturas cortas y conversación. Refuerza con tareas divertidas.",
        university: "Pre-UPC — Comunicación",
        notes: [
          { year: "9.º", course: "Comunicación", note: 20 }, { year: "9.º", course: "Inglés", note: 19 },
          { year: "10.º", course: "Comunicación", note: 20 }, { year: "10.º", course: "Historia", note: 18 },
        ],
        availability: [
          day("tuesday",  [slot("17:00","19:00","online")]),
          day("thursday", [slot("17:00","19:00","online")]),
        ],
        blockedDates: [],
        reviewsList: [],
      },
      {
        id: "t-diego", userId: "u-diego", name: "Diego Salas", avatar: "D", grade: 11, approvalStatus: "approved", isPublic: true, appliedAt: "2026-05-01", rejectionReason: "",
        courses: ["Programación", "Matemática"], gradesCanTeach: [8,9,10],
        rating: 5.0, reviews: 15,
        personality: "Curioso y técnico. Convierte temas difíciles en proyectos concretos.",
        methodology: "Aprendizaje por proyectos: cada tema se aplica en un pequeño programa o reto real.",
        university: "Admitido en UTEC — Ciencia de la Computación",
        notes: [
          { year: "9.º", course: "Matemática", note: 19 }, { year: "9.º", course: "Programación", note: 20 },
          { year: "10.º", course: "Matemática", note: 20 }, { year: "10.º", course: "Programación", note: 20 },
        ],
        availability: [
          day("friday",   [slot("16:00","18:00","ambas")]),
          day("saturday", [slot("15:00","18:00","online")]),
        ],
        blockedDates: [],
        reviewsList: [],
      },
      {
        id: "t-valeria", userId: "u-valeria", name: "Valeria Núñez", avatar: "V", grade: 10, approvalStatus: "approved", isPublic: true, appliedAt: "2026-05-01", rejectionReason: "",
        courses: ["Química", "Biología"], gradesCanTeach: [7,8,9],
        rating: 4.6, reviews: 11,
        personality: "Cercana y empática. Buena para alumnos que se frustran con ciencias.",
        methodology: "Explica con esquemas y mapas mentales; muchos ejemplos visuales.",
        university: "Aún en colegio (10.º) — interés en Medicina",
        notes: [
          { year: "9.º", course: "Química", note: 18 }, { year: "9.º", course: "Biología", note: 19 },
        ],
        availability: [
          day("monday",    [slot("15:00","17:00","presencial")]),
          day("wednesday", [slot("15:00","17:00","presencial")]),
        ],
        blockedDates: [],
        reviewsList: [],
      },
      {
        // POSTULANTE PENDIENTE — no debe aparecer en el home hasta que el admin apruebe
        id: "t-camila", userId: "u-camila", name: "Camila Rojas", avatar: "C", grade: 11,
        approvalStatus: "pending", isPublic: false, appliedAt: "2026-07-22", rejectionReason: "",
        section: "A", whatsapp: "989 112 233",
        courses: ["Matemática", "Economía"], gradesCanTeach: [7,8,9,10],
        rating: 0, reviews: 0,
        personality: "Ordenada y muy responsable; me gusta enseñar con ejemplos reales.",
        methodology: "Explico la teoría corta y practico con ejercicios tipo examen.",
        university: "Interés en Economía — PUCP",
        notes: [
          { year: "9.º", course: "Matemática", note: 19 }, { year: "10.º", course: "Economía", note: 20 },
        ],
        availability: [
          day("tuesday",  [slot("16:00","18:00","online")]),
          day("thursday", [slot("16:00","18:00","ambas")]),
        ],
        blockedDates: [],
        reviewsList: [],
      },
    ];

    // Precio de cada reserva = snapshot del motor al crearla.
    const q = (tid) => window.Pricing.snapshot(tutors.find(t => t.id === tid), pricing);
    const bookings = [
      mkBooking({ id:"b-1", studentId:"u-ana", tutorId:"t-mateo", course:"Matemática", date:"2026-07-20", time:"16:00", duration:60, modality:"online", ...q("t-mateo"), verificationCode:genCode(), paymentStatus:"approved", payoutStatus:"pendiente", status:"confirmed" }),
      mkBooking({ id:"b-2", studentId:"u-luis", tutorId:"t-sofia", course:"Inglés", date:"2026-07-21", time:"17:00", duration:60, modality:"online", ...q("t-sofia"), verificationCode:genCode(), paymentStatus:"approved", payoutStatus:"pagado", status:"completed" }),
      mkBooking({ id:"b-3", studentId:"u-ana", tutorId:"t-diego", course:"Programación", date:"2026-07-24", time:"16:00", duration:60, modality:"presencial", ...q("t-diego"), verificationCode:"48291370", proof:"yape_captura_ana.jpg", paymentStatus:"manual_review", payoutStatus:"pendiente", status:"pending_manual_confirmation" }),
    ];

    return { users, tutors, bookings, pricing, auditLog: [], session: null, meta: { YAPE_ADMIN, CURSOS, DAYS } };
  }

  // Normaliza una reserva con valores por defecto consistentes.
  function mkBooking(b) {
    const price = b.price;
    const tutorEarning = b.tutorEarning != null ? b.tutorEarning : price;
    const commission = b.commission != null ? b.commission : +(price - tutorEarning).toFixed(2);
    return {
      ...b,
      price, tutorEarning, commission,
      commissionRate: price ? +(commission / price).toFixed(4) : 0,
      duration: b.duration || 60,
      verificationCode: b.verificationCode || genCode(),
      proof: b.proof || null,
      adminNote: b.adminNote || "",
      reviewed: b.reviewed || false,
      createdAt: b.createdAt || new Date().toISOString(),
    };
  }

  // ---------- Persistencia ----------
  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) return JSON.parse(raw);
    } catch (e) {}
    const fresh = seed();
    save(fresh);
    return fresh;
  }
  function save(db) { localStorage.setItem(KEY, JSON.stringify(db)); }
  function reset() { localStorage.removeItem(KEY); }

  window.DB = { load, save, reset, mkBooking, genCode, YAPE_ADMIN, CURSOS, DAYS };
})();
