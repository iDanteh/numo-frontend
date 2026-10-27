/**
 * Sistema de Lealtad (phone-as-card) — interfaces que reflejan los nombres de
 * campo REALES del backend (ver design.md "Data Model" y
 * `numo-backend/src/shared/models/postgres/{LoyaltyCard,LoyaltyPointsLedger,
 * LoyaltyTierHistory,LoyaltyAdjustmentReason}.js`). El teléfono de 10 dígitos
 * ES la identidad de la tarjeta — no existe `numeroTarjeta` (D1).
 */

export type LoyaltyNivel = 'Bronce' | 'Plata' | 'Oro';

export type LoyaltyMovimientoTipo = 'ACUMULACION' | 'CANJE' | 'AJUSTE' | 'MIGRACION';

export interface LoyaltyCard {
  id: number;
  telefono: string;
  nombre: string;
  nivel: LoyaltyNivel;
  saldoPuntos: number;
  activa: boolean;
  createdById?: string | null;
  createdByNombre?: string | null;
  updatedById?: string | null;
  updatedByNombre?: string | null;
  createdAt?: string;
  updatedAt?: string;
  // Datos adicionales opcionales (2026-10-23) — ver LoyaltyCardDatosAdicionales. Apellidos es
  // visible siempre (GET /cards normal); el resto solo viene en la respuesta de
  // `GET /cards/:id/editar` (loyalty:tarjetas:editar) — en el resto de lecturas quedan undefined
  // porque el backend los excluye por defaultScope (PII, ver LoyaltyCard.js).
  apellidos?: string | null;
}

/** Campos de "Datos adicionales" — alta/edición manual, también poblados por el import de
 *  clientes.csv. Ninguno es obligatorio ni se usa para lógica de negocio (nivel/puntos/identidad
 *  siguen siendo teléfono+categoría). */
export interface LoyaltyCardDatosAdicionales {
  apellidos?: string | null;
  apodo?: string | null;
  sexo?: string | null;
  fechaNacimiento?: string | null;
  especialidades?: string | null;
  sucursal?: string | null;
  calle?: string | null;
  numExterior?: string | null;
  numInterior?: string | null;
  colonia?: string | null;
  municipio?: string | null;
  estado?: string | null;
  cp?: string | null;
  comentarios?: string | null;
}

export interface LoyaltyMovimiento {
  id: number;
  cardId: number;
  tipo: LoyaltyMovimientoTipo;
  puntos: number;
  saldoResultante: number;
  montoVenta: number | null;
  // Monto EXACTO que se multiplicó por porcentajeAplicado para dar puntos (2026-10-27) — casi
  // siempre igual a montoVenta, salvo el webhook con formas de pago mixtas (monto prorrateado).
  // Filas previas a este campo lo traen null — la UI usa montoVenta como fallback.
  montoBaseCalculo?: number | null;
  // Total de la venta en Kore (CON impuesto, 2026-10-21) — solo auditoría,
  // nunca se muestra en la UI. El cálculo de puntos usa montoVenta (subtotal).
  montoVentaTotal?: number | null;
  porcentajeAplicado: number | null;
  nivelAplicado: LoyaltyNivel | null;
  promocionNombre?: string | null;
  promocionPorcentaje?: number | null;
  centroCostoId: number | null;
  reasonId: number | null;
  justificacion: string | null;
  origen: string;
  referenciaExterna: string | null;
  usuarioId: string | null;
  usuarioNombre: string | null;
  createdAt: string;
}

export interface LoyaltyTierHistoryEntry {
  id: number;
  cardId: number;
  nivelAnterior: LoyaltyNivel;
  nivelNuevo: LoyaltyNivel;
  motivo: string | null;
  usuarioId: string | null;
  usuarioNombre: string | null;
  at: string;
}

export interface LoyaltyAdjustmentReason {
  id: number;
  clave: string;
  nombre: string;
  activo: boolean;
  /** Rediseño 2026-10-23 (reemplaza signoPermitido/porcentaje): null/undefined = motivo manual
   *  (quien aplica el ajuste escribe los puntos a mano, cualquier signo). Con valor (puede ser
   *  negativo, ej. "Bono"=100, "Comisión por mora"=-200): el AJUSTE aplica EXACTAMENTE ese
   *  número de puntos, sin pedir nada más. */
  puntosFijos?: number | null;
}

export interface LoyaltySucursal {
  id: number;
  clave: string;
  sucursal: string;
  participaLealtad: boolean;
  permiteCanjeLealtad: boolean;
  /** Serie de facturación real de esa sucursal en Kore (2026-10-19, pedido explícito del
   *  usuario) — se muestra como "Sucursal (Serie)", ej. "CEDIS (A0)". Sin uso todavía en
   *  ninguna regla de Lealtad, pero valioso de cara a una regla futura. */
  serieFacturacion: string | null;
}

export interface LoyaltyPorcentajes {
  Bronce: number | null;
  Plata: number | null;
  Oro: number | null;
}

export type LoyaltyCardSortColumn = 'telefono' | 'nombre' | 'nivel' | 'saldo' | 'activa';
export type LoyaltySortDir = 'ASC' | 'DESC';

export interface LoyaltyCardListFilter {
  search?: string;
  nivel?: LoyaltyNivel | '';
  activa?: boolean | '';
  page?: number;
  limit?: number;
  sort?: LoyaltyCardSortColumn;
  sortDir?: LoyaltySortDir;
}

// Bug real 2026-10-19: estos dos tipos describían un contrato {data,pagination} que el backend
// NUNCA implementó — loyalty-card.service.js#listar/listarMovimientos siempre devolvió
// {total,page,limit,pages,cards|movimientos} (mismo criterio que el resto de listados paginados
// de este backend). El mismatch nunca tronaba (TypeScript no valida shapes en runtime) — solo
// dejaba `cards`/`movimientos` en `undefined` en silencio, así que la lista de Tarjetas y el tab
// de movimientos del detalle se veían vacíos sin ningún error. Corregido para reflejar la
// respuesta real.
export interface LoyaltyCardListResult {
  cards: LoyaltyCard[];
  total: number;
  page: number;
  limit: number;
  pages: number;
}

export interface LoyaltyMovimientoListResult {
  movimientos: LoyaltyMovimiento[];
  total: number;
  page: number;
  limit: number;
  pages: number;
}

export interface LoyaltyCrearTarjetaPayload extends LoyaltyCardDatosAdicionales {
  telefono: string;
  nombre: string;
  nivel?: LoyaltyNivel;
}

export interface LoyaltyCrearTarjetaResult {
  card: LoyaltyCard;
  nip: string;
}

export interface LoyaltyEditarTarjetaPayload extends LoyaltyCardDatosAdicionales {
  nombre?: string;
  telefono?: string;
  activa?: boolean;
}

export interface LoyaltyCambiarNipResult {
  nip: string;
}

export interface LoyaltyAcumulacionPayload {
  // Serie-Folio real de la venta en Kore (ej. "A0-260605320") — reemplaza el
  // select manual de sucursal Y el monto de venta manual (2026-10-21): el
  // backend resuelve la serie ("A0") contra CentroCosto.serieFacturacion,
  // consulta la CxC real en Kore y calcula los puntos sobre su subtotal (el
  // cajero ya no captura ningún importe con libertad total). El folio
  // completo se guarda como referenciaExterna (llave de idempotencia: el
  // mismo folio no puede generar puntos dos veces).
  serieFolio: string;
}

export interface LoyaltyCanjePayload {
  puntos: number;
  // Serie-Folio de la venta en Kore (ej. "A0-260605320", 2026-10-27) — reemplaza la serie suelta:
  // el backend consulta la venta real en Kore y topa los puntos a canjear a su total, mismo
  // blindaje que ya tiene la acumulación.
  serieFolio: string;
}

export interface LoyaltyAjustePayload {
  // Opcional — solo se manda cuando el motivo elegido NO tiene `puntosFijos` configurado (modo
  // manual). Si el motivo tiene `puntosFijos`, el backend lo aplica directo e ignora este campo.
  puntos?: number;
  reasonId: number;
  justificacion: string;
}

export interface LoyaltyMovimientoResult {
  movimiento: LoyaltyMovimiento;
  // Fila separada del bono de promoción (2026-10-27, pedido explícito del usuario) — solo viene en
  // registrarAcumulacion cuando hay una promoción vigente; null/undefined en canjes, ajustes, y
  // acumulaciones sin promoción (comportamiento idéntico a hoy).
  movimientoPromocion?: LoyaltyMovimiento | null;
  saldoPuntos: number;
}

// ── PR7: Config UI (tier %, reasons CRUD, sucursal flags) ───────────────────

export interface LoyaltyGuardarPorcentajesPayload {
  Bronce?: number;
  Plata?: number;
  Oro?: number;
}

export interface LoyaltyCrearReasonPayload {
  clave: string;
  nombre: string;
  /** Vacío/null = motivo manual. Con valor (puede ser negativo): aplica ese valor exacto. */
  puntosFijos?: number | null;
}

export interface LoyaltyEditarReasonPayload {
  nombre?: string;
  activo?: boolean;
  /** `null` quita el valor fijo y vuelve el motivo manual (PATCH únicamente). */
  puntosFijos?: number | null;
}

// ── Catálogo de Promociones (ej. "Buen Fin") — % de bono que se suma
// automáticamente al % del nivel al registrar una ACUMULACION dentro del
// periodo vigente (fechaInicio/fechaFin, 'YYYY-MM-DD'). Esto ya pasa solo en
// el backend — el frontend solo necesita el CRUD de administración acá.
export interface LoyaltyPromotion {
  id: number;
  nombre: string;
  fechaInicio: string;
  fechaFin: string;
  porcentajeBono: number;
  activa: boolean;
}

export interface LoyaltyCrearPromocionPayload {
  nombre: string;
  fechaInicio: string;
  fechaFin: string;
  porcentajeBono: number;
}

export interface LoyaltyEditarPromocionPayload {
  nombre?: string;
  fechaInicio?: string;
  fechaFin?: string;
  porcentajeBono?: number;
  activa?: boolean;
}

export interface LoyaltyActualizarSucursalPayload {
  participaLealtad?: boolean;
  permiteCanjeLealtad?: boolean;
}

// ── Catálogos Kore configurables (2026-10-26) — "Conceptos" (tipos de venta) y "Formas de
// pago" que Kore expone (GET /loyalty/config/conceptos-kore, /formas-pago-kore). `acumulaPuntos`
// (y `esPuntos` para formas de pago) es una decisión 100% de Numo, manual — los campos `kore*Hint`
// son solo una copia informativa de lo que Kore reporta (AcumulaPuntosTuberos/EsPuntos), nunca
// autoritativa (el entorno de Kore puede desincronizarse de producción, ya visto en la práctica).
export interface LoyaltyKoreConcepto {
  id: number;
  koreId: string;
  nombre: string;
  abreviatura: string;
  tipo: string;
  acumulaPuntos: boolean;
  activo: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export interface LoyaltyKoreFormaPago {
  id: number;
  koreId: string;
  nombre: string;
  acumulaPuntos: boolean;
  esPuntos: boolean;
  koreAcumulaPuntosHint: boolean | null;
  koreEsPuntosHint: boolean | null;
  activo: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export interface LoyaltySyncKoreResult {
  nuevos: number;
  actualizados: number;
  desactivados: number;
}

// ── PR7: Public lookup (POST /api/loyalty/public/consulta, D8: never recent
// activity in the response — spec loyalty-public-lookup "Minimal Response
// Payload", confirmed with the user 2026-10-15) ─────────────────────────────

export interface LoyaltyConsultaPublicaResult {
  nombre: string;
  nivel: LoyaltyNivel;
  saldoPuntos: number;
}

// ── Código de verificación para la consulta pública (POST
// /api/loyalty/public/recuperacion/solicitar + /consulta/confirmar, mismo
// router público/anónimo que /consulta). El flujo "recuperar NIP" que
// originalmente consumía este paso 1 se eliminó 2026-10-26 — ver
// LoyaltyConsultaPublicaResult para la respuesta del paso 2. ─────────────────

export interface LoyaltySolicitarCodigoResult {
  mensaje: string;
  /** SIMULACIÓN TEMPORAL — solo presente fuera de producción, mientras no haya
   *  un proveedor de mensajería real conectado (ver loyalty-recovery.service.js). */
  codigoDev?: string;
}

// ── Migración de clientes legados ("Club Tuberos") — POST
// /api/loyalty/import/concentrado (loyalty:importar, admin-only). SOLO lectura:
// cruza clientes.csv x puntos.pdf y devuelve un reporte de revisión, sin tocar
// la base de datos. Aplicar la migración queda fuera de alcance (ver
// numo-backend/src/loyalty/domains/import/loyalty-import.service.js).
export interface LoyaltyImportResumen {
  totalClientes: number;
  totalConSaldo: number;
  totalSinSaldo: number;
  totalHuerfanosEnPuntos: number;
  totalDuplicadosEnClientes: number;
  totalPosiblesPrueba: number;
  totalNivelPorDefault: number;
  totalSinContacto: number;
}

export interface LoyaltyImportFila {
  tarjetaNormalizada: string;
  tarjetaRawClientes: string | null;
  tarjetaRawPuntos: string | null;
  nombre: string;
  celular: string;
  telefono: string;
  /** Informativo — para contactar clientes que queden pendientes (sin teléfono). */
  correo: string;
  /** Celular si existe, si no Telefono — el dato que se usaría como identidad de tarjeta. */
  contacto: string;
  saldo: number;
  categoriaOriginal: string | null;
  /** Bronce/Plata/Oro si Categoria matchea, Bronce por default si no (ver info 'nivel_asignado_por_default'). */
  nivelSugerido: LoyaltyNivel;
  advertencias: string[];
  info: string[];
}

export interface LoyaltyImportConcentrado {
  resumen: LoyaltyImportResumen;
  filas: LoyaltyImportFila[];
}

// ── Aplicar la migración (POST /api/loyalty/import/aplicar) ─────────────────
// Decisión de negocio 2026-10-19: clientes sin ningún teléfono ya no se
// descartan — quedan en loyalty_pending_enrollments (ver clientes-pendientes/).

export type LoyaltyImportCategoria =
  | 'ok'
  | 'pendiente_sin_telefono'
  | 'ya_migrada'
  | 'duplicado_bloqueante'
  | 'invalido_bloqueante'
  | 'conflicto_bloqueante'
  // Caso real 2026-10-19: dos Tarjetas legadas DISTINTAS comparten el MISMO teléfono — no lo
  // detecta 'duplicado_bloqueante' (agrupa por Tarjeta, no por teléfono). Sin esto, ambas
  // filas clasificaban 'ok' y la segunda reventaba el UNIQUE constraint recién al aplicar.
  | 'telefono_duplicado_bloqueante';

export interface LoyaltyImportFilaClasificada extends LoyaltyImportFila {
  categoria: LoyaltyImportCategoria;
  telefonoNormalizado: string | null;
}

export interface LoyaltyImportClasificacionResumen {
  ok: number;
  pendienteSinTelefono: number;
  yaMigrada: number;
  duplicadoBloqueante: number;
  invalidoBloqueante: number;
  conflictoBloqueante: number;
  telefonoDuplicadoBloqueante: number;
}

export interface LoyaltyImportClasificacion {
  resumen: LoyaltyImportResumen;
  filas: LoyaltyImportFilaClasificada[];
  clasificacionResumen: LoyaltyImportClasificacionResumen;
}

export interface LoyaltyImportAplicarResult {
  clasificacionResumen: LoyaltyImportClasificacionResumen;
  creadas: Array<{ telefono: string; nip: string; mensaje: string }>;
  pendientesCreadas: number;
  omitidasYaMigradas: number;
  /** De las `omitidasYaMigradas`, cuántas tuvieron al menos un campo (tarjetaLegada o
   *  enriquecimiento) realmente completado en este re-import (2026-10-23, hallazgo de
   *  resiliencia: antes era un UPDATE ciego sin forma de saber si había tocado algo). */
  yaMigradaBackfillAplicado: number;
  /** Decisión de negocio 2026-10-19: las filas bloqueantes (duplicado/invalido/conflicto) ya NO
   *  abortan la corrida — simplemente quedan excluidas (ni se escriben ni cuentan como creadas).
   *  El admin las corrige en el Excel exportado (descargarBloqueantes()) y las re-sube vía
   *  POST /loyalty/import/correcciones (ver clasificarCorrecciones()/aplicarCorrecciones()). */
  excluidasBloqueantes: number;
  /** Decisión de negocio 2026-10-19: una fila que falla al escribir (ej. carrera de teléfono
   *  duplicado no detectada antes) NUNCA detiene el job — se registra acá y se sigue con las
   *  demás. Vacío en el camino feliz. */
  erroresFilas: Array<{ telefono: string | null; nombre: string; error: string }>;
}

// ── Correcciones (re-subida del Excel de filas bloqueantes ya corregidas a mano,
// POST /api/loyalty/import/correcciones) — flujo independiente del par clientes.csv/puntos.pdf.
// Sin `resumen` de tipo concentrado (ese concepto es específico del cruce de dos archivos
// fuente) — solo la clasificación de las filas del Excel de correcciones.
export interface LoyaltyImportCorreccionClasificacion {
  filas: LoyaltyImportFilaClasificada[];
  clasificacionResumen: LoyaltyImportClasificacionResumen;
}

/** POST /loyalty/import/aplicar?confirmar=true (2026-10-19) responde esto de inmediato —
 *  mismo criterio que NetpayUploadJobIniciado: migrar ~9,633 filas (cada una hashea un NIP
 *  con bcrypt) tarda ~22min y ya no cabe en una sola request/transacción, se parte en lotes
 *  de 200 filas (cada lote su propia transacción). El resultado final
 *  (LoyaltyImportAplicarResult) llega por socket — ver lealtadApplyDone$ en socket.service.ts. */
export interface LoyaltyImportAplicarJobIniciado {
  jobId: string;
  total: number;
  totalLotes: number;
}

// ── Registros pendientes de teléfono (GET /api/loyalty/import/pendientes,
// POST /api/loyalty/import/pendientes/:id/completar) ─────────────────────────

export interface LoyaltyPendingEnrollment {
  id: number;
  nombre: string;
  correo: string | null;
  tarjetaLegada: string | null;
  saldoLegado: number;
  nivelSugerido: LoyaltyNivel;
  // 'rechazado' (2026-10-19): el admin decidió que este cliente legado ya no se va a migrar.
  estado: 'pendiente' | 'completado' | 'rechazado';
  // 'sin_telefono': no traía Celular ni Telefono. 'telefono_duplicado' (2026-10-23): el teléfono
  // que trae choca con el de otra(s) fila(s) del mismo clientes.csv — ver grupoId.
  motivo: 'sin_telefono' | 'telefono_duplicado';
  // Solo para motivo='telefono_duplicado': el teléfono normalizado que comparten 2+ filas — agrupa
  // los registros en conflicto (ver LoyaltyPendingEnrollmentGrupo). null para 'sin_telefono'.
  grupoId: string | null;
  // Solo para motivo='telefono_duplicado': el teléfono que traía esta fila en el CSV (prellenado
  // como sugerencia al completar, pero en conflicto con otra fila del mismo grupoId).
  telefonoCandidato: string | null;
  cardIdResultante?: number | null;
  resueltoPorNombre?: string | null;
  resueltoAt?: string | null;
  createdAt?: string;
}

/** Un grupo de 1+ `LoyaltyPendingEnrollment` que comparten `grupoId` (mismo teléfono en
 *  conflicto) — las filas de motivo 'sin_telefono' (grupoId null) siempre vienen en su propio
 *  grupo de 1. Ver listarPendientes() en loyalty-import-apply.service.js. */
export interface LoyaltyPendingEnrollmentGrupo {
  grupoId: string | null;
  saldoMax: number;
  items: LoyaltyPendingEnrollment[];
}

export interface LoyaltyPendingEnrollmentListResult {
  total: number;
  totalRegistros: number;
  page: number;
  limit: number;
  pages: number;
  grupos: LoyaltyPendingEnrollmentGrupo[];
}

export interface LoyaltyCompletarPendienteResult {
  card: LoyaltyCard;
  nip: string;
}

// ── Match de clientes contra Kore (POST /api/loyalty/import/kore-match, loyalty:importar,
// 2026-10-22) — cruza LoyaltyCard.tarjetaLegada contra el monedero del catálogo de clientes de
// Kore para obtener su id interno (koreClienteId/koreMonedero). Idempotente: se puede re-correr
// cuantas veces haga falta (ej. tras cargar más clientes en Kore). Ver
// numo-backend/src/loyalty/domains/kore-match/loyalty-kore-match.service.js#correrMatchKore.

/** Tarjeta de Lealtad con tarjetaLegada que no matcheó ningún monedero de Kore. */
export interface LoyaltyKoreMatchSinMatchEnKore {
  cardId: number;
  telefono: string;
  nombre: string;
  tarjetaLegada: string;
}

/** Cliente de Kore con monedero que no matcheó ninguna tarjetaLegada de Lealtad. */
export interface LoyaltyKoreMatchSinMatchEnLealtad {
  koreClienteId: number;
  nombre: string;
  razonSocial: string;
  monedero: string;
}

/** Dos clientes de Kore DISTINTOS comparten el mismo monedero normalizado (dato externo sucio) —
 *  el primero en el orden de obtenerClientesConMonedero() gana, este queda sin aplicar. */
export interface LoyaltyKoreMatchMonederoDuplicado {
  koreClienteId: number;
  nombre: string;
  razonSocial: string;
  monedero: string;
}

/** Tarjeta que matcheó pero falló al escribir koreClienteId/koreMonedero (ej. error transitorio
 *  de DB) — nunca detiene el resto de la corrida. */
export interface LoyaltyKoreMatchErrorActualizacion {
  cardId: number;
  telefono: string | null;
  error: string;
}

/** Detalle de UNA tarjeta matcheada — monedero legado (tarjetaLegada) + monedero Kore, usado
 *  para generar el Excel automático al terminar el job (ver importar-clientes.component.ts). A
 *  diferencia de las otras listas de LoyaltyKoreMatchResult, esta NUNCA viene truncada. */
export interface LoyaltyKoreMatchDetalle {
  telefono: string;
  nombre: string;
  tarjetaLegada: string;
  koreClienteId: string;
  koreMonedero: string;
}

/** Resultado final de correrMatchKore() — las 4 listas de error vienen truncadas a 100 items, los
 *  contadores *Count siempre son el total real (ver MAX_EJEMPLOS_SIN_MATCH en el backend).
 *  `matcheadosDetalle` y `sinMatchEnKoreDetalle` son la excepción: siempre vienen completos (ambos
 *  alimentan las 2 pestañas del Excel automático, ver importar-clientes.component.ts). */
export interface LoyaltyKoreMatchResult {
  totalKore: number;
  totalCardsConTarjetaLegada: number;
  matcheados: number;
  matcheadosDetalle: LoyaltyKoreMatchDetalle[];
  sinMatchEnKoreCount: number;
  sinMatchEnKore: LoyaltyKoreMatchSinMatchEnKore[];
  /** Mismo contenido que `sinMatchEnKore` pero SIN truncar — pestaña "Sin match en Kore" del Excel. */
  sinMatchEnKoreDetalle: LoyaltyKoreMatchSinMatchEnKore[];
  sinMatchEnLealtadCount: number;
  sinMatchEnLealtad: LoyaltyKoreMatchSinMatchEnLealtad[];
  monederosDuplicadosEnKoreCount: number;
  monederosDuplicadosEnKore: LoyaltyKoreMatchMonederoDuplicado[];
  erroresActualizacionCount: number;
  erroresActualizacion: LoyaltyKoreMatchErrorActualizacion[];
}

/** POST /loyalty/import/kore-match responde 202 con esto de inmediato — a diferencia de
 *  aplicarImportacion() no trae total/totalLotes (el backend no particiona esta corrida en
 *  lotes/transacciones, ver docstring de loyalty-kore-match.service.js). El progreso/resultado
 *  final llegan por socket (lealtadKoreMatchProgress$/Done$/Error$ en socket.service.ts). */
export interface LoyaltyKoreMatchJobIniciado {
  jobId: string;
}

/** GET /loyalty/import/kore-match-job/:jobId — fallback de recuperación (2026-10-23, hallazgo de
 *  resiliencia: antes el backend ya lo exponía pero el frontend nunca lo consumía). Se usa para
 *  reintentar la descarga del Excel sin tener que re-correr el match completo contra Kore, incluso
 *  tras un reload de página (ver reintentarDescargaExcelKoreMatch() en el componente). */
export interface LoyaltyKoreMatchJobEstado {
  status: 'running' | 'done' | 'error';
  procesados: number;
  total: number;
  resultado?: LoyaltyKoreMatchResult;
  error?: string;
}
