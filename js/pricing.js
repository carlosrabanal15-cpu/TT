/* =========================================================
   TUTORS — Motor de precios (FUENTE ÚNICA DE VERDAD)
   ---------------------------------------------------------
   Regla de negocio:
   - El precio NO lo define el tutor. Se calcula desde una tabla
     por rango de rating + cantidad de reseñas, controlada por el admin.
   - Este módulo es stateless: recibe la config (db.pricing) y el tutor,
     y devuelve el desglose. Ninguna vista debe calcular precios por su
     cuenta: todas piden aquí. Mapea 1:1 a un servicio/endpoint FastAPI.

   Desglose devuelto:
     finalPrice   -> lo que paga el cliente (visible para todos)
     tutorPayout  -> lo que recibe el tutor (visible para tutor y admin)
     commission   -> comisión interna = finalPrice - tutorPayout (SOLO admin)
   ========================================================= */
(function () {
  // Elige el tramo (tier) que aplica a un tutor.
  // Un tutor con menos de `minReviewsForRating` reseñas NO accede a tramos
  // altos: su rating aún no está "probado", así que cae al tramo base.
  function tierFor(tutor, cfg) {
    const tiers = [...cfg.tiers].sort((a, b) => a.minRating - b.minRating);
    const base = tiers[0];
    const reviews = tutor.reviews || 0;
    if (reviews < cfg.minReviewsForRating) return base;
    let chosen = base;
    for (const t of tiers) if ((tutor.rating || 0) >= t.minRating) chosen = t;
    return chosen;
  }

  // Cotización autoritativa para un tutor según la tabla vigente.
  function quote(tutor, cfg) {
    const tier = tierFor(tutor, cfg);
    const finalPrice = tier.finalPrice;
    const tutorPayout = tier.tutorPayout;
    const commission = +(finalPrice - tutorPayout).toFixed(2);
    return {
      tierKey: tier.key,
      tierLabel: tier.label,
      finalPrice,                                   // cliente
      tutorPayout,                                  // tutor
      commission,                                   // solo admin
      commissionRate: finalPrice ? +(commission / finalPrice).toFixed(4) : 0,
    };
  }

  // Snapshot inmutable para congelar el precio al momento de reservar.
  // Una vez creada la reserva, su precio no cambia aunque el tutor
  // suba/baje de rating o el admin edite la tabla.
  function snapshot(tutor, cfg) {
    const q = quote(tutor, cfg);
    return { price: q.finalPrice, tutorEarning: q.tutorPayout, commission: q.commission };
  }

  window.Pricing = { tierFor, quote, snapshot };
})();
