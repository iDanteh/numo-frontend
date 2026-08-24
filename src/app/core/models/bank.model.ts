export type BankStatus = 'no_identificado' | 'identificado' | 'otros' | 'reclasificado';

// ── Refacturaciones CYC ───────────────────────────────────────────────────────
export type RazonNoMatchCyc =
  | 'folio_no_encontrado'
  | 'sin_movimiento_bancario'
  | 'requiere_revision'
  | 'ya_identificado';

export interface CandidatoCyc {
  movId:    string;
  concepto: string | null;
  deposito: number | null;
  banco:    string | null;
  status:   string | null;
}

export interface NoMatcheadoCyc {
  fila:      number;
  concepto:  string | null;
  importe:   number;
  banco:     string | null;
  folios:    string[];
  razon:     RazonNoMatchCyc;
  detalle:   string;
  candidato: CandidatoCyc | null;
}

export interface AdvertenciaCyc {
  fila:            number;
  foliosFaltantes: string[];
}

export interface RefacturacionesCycResult {
  total:    number;
  auto:     number;
  review:   number;
  escritos: number;
  errors: {
    folioNoEncontrado: number;
    sinMovBancario:    number;
    yaIdentificado:    number;
  };
  detalleNoMatcheados: NoMatcheadoCyc[];
  advertencias:        AdvertenciaCyc[];
}

// ── Mostrador CYC ─────────────────────────────────────────────────────────────
export type RazonNoMatchMostrador =
  | 'folio_no_encontrado'
  | 'sin_movimiento_bancario'
  | 'ya_identificado';

// ── Pagos CYC — misma estructura que Mostrador pero sin campo `cliente` ────────
export type RazonNoMatchPagos = RazonNoMatchMostrador;

export interface CandidatoMostrador {
  movId:    string;
  movFolio: string | null;
  concepto: string | null;
  deposito: number | null;
  banco:    string | null;
  status:   string | null;
}

export interface NoMatcheadoMostrador {
  fila:        number;
  fecha:       string | null;
  descripcion: string | null;
  importe:     number;
  banco:       string | null;
  cliente:     string | null;
  folios:      string[];
  razon:       RazonNoMatchMostrador;
  detalle:     string;
  candidato:   CandidatoMostrador | null;
}

export interface RelacionadoMostrador {
  fila:              number;
  fecha:             string | null;
  descripcion:       string | null;
  importe:           number;
  banco:             string | null;
  cliente:           string | null;
  folios:            string[];
  foliosEncontrados: string[];
  foliosFaltantes:   string[];
  movId:             string;
  movFolio:          string | null;
  cxcCount:          number;
}

export interface IgnoradoMostrador {
  fila:        number;
  fecha:       string | null;
  descripcion: string | null;
  importe:     number | null;
  banco:       string | null;
  cliente:     string | null;
}

export interface AdvertenciaMostrador {
  fila:            number;
  foliosFaltantes: string[];
}

export interface MostradorCycResult {
  total:        number;
  relacionados: number;
  escritos:     number;
  ignorados:    number;
  errors: {
    folioNoEncontrado:    number;
    sinMovimientoBancario: number;
    yaIdentificado:       number;
  };
  detalleRelacionados:  RelacionadoMostrador[];
  detalleNoMatcheados:  NoMatcheadoMostrador[];
  detalleIgnorados:     IgnoradoMostrador[];
  advertencias:         AdvertenciaMostrador[];
}

// ── Pagos CYC ──────────────────────────────────────────────────────────────────
// Mismo shape que Mostrador CYC. La única diferencia de formato es que PAGOS CYC
// no tiene columna CLIENTE en el Excel, por lo que esos campos nunca se populan.
export interface RelacionadoPagos {
  fila:              number;
  fecha:             string | null;
  descripcion:       string | null;
  importe:           number;
  banco:             string | null;
  folios:            string[];
  foliosEncontrados: string[];
  foliosFaltantes:   string[];
  movId:             string;
  movFolio:          string | null;
  cxcCount:          number;
}

export interface NoMatcheadoPagos {
  fila:        number;
  fecha:       string | null;
  descripcion: string | null;
  importe:     number;
  banco:       string | null;
  folios:      string[];
  razon:       RazonNoMatchPagos;
  detalle:     string;
  candidato:   CandidatoMostrador | null;
}

export interface IgnoradoPagos {
  fila:        number;
  fecha:       string | null;
  descripcion: string | null;
  importe:     number | null;
  banco:       string | null;
}

export interface PagosCycResult {
  total:        number;
  relacionados: number;
  escritos:     number;
  ignorados:    number;
  errors: {
    folioNoEncontrado:     number;
    sinMovimientoBancario: number;
    yaIdentificado:        number;
  };
  detalleRelacionados:  RelacionadoPagos[];
  detalleNoMatcheados:  NoMatcheadoPagos[];
  detalleIgnorados:     IgnoradoPagos[];
  advertencias:         AdvertenciaMostrador[];
}

// ── Formas de Pago CxC ─────────────────────────────────────────────────────────
// Excel "Pagos Asociados" (21 columnas): cada fila es un pago CFDI aplicado a una factura
// que aún no tiene movimiento bancario identificado. El backend resuelve factura → pedido
// (documentosRelacionados[0]) → CxC en Kore → forma(s) de pago real(es) de los abonos, y
// clasifica cada fila como bancaria / no bancaria / sin resolver. Las claves son literalmente
// los headers del Excel (mismas 21 columnas), para poder mostrarlas/exportarlas tal cual.
export interface FilaPagoAsociado {
  'UUID CFDI Pago':    string | null;
  'Estado SAT':        string | null;
  'Fecha Pago':        string | null;
  'UUID Factura':      string | null;
  'Serie':             string | null;
  'Folio':             string | null;
  'Parcialidad':       string | number | null;
  'Depósito':          number | null;
  'Saldo Anterior':    number | null;
  'Imp. Pagado':       number | null;
  'Saldo Insoluto':    number | null;
  'Diferencia':        number | null;
  'Tipo NC':           string | null;
  'Monto NC':          number | null;
  'Tiene Pago':        string | null;
  'Banco':             string | null;
  'Fecha Movimiento':  string | null;
  'ID NUMO':           string | null;
  'Núm. Autorización': string | null;
  'Saldo Banco':       number | null;
  'Identificado por':  string | null;
}

export interface DetalleFormaPagoCxc extends FilaPagoAsociado {
  fila:        number;
  pedidoSerie: string;
  pedidoFolio: string;
  formasPago:  string[];
}

export type RazonSinResolverFormaPagoCxc = 'sin_factura' | 'sin_pedido' | 'sin_cxc_en_kore';

export interface SinResolverFormaPagoCxc extends FilaPagoAsociado {
  fila:    number;
  razon:   RazonSinResolverFormaPagoCxc;
  detalle: string;
}

export interface FormasPagoCxcResult {
  total:       number;
  bancarias:   number;
  noBancarias: number;
  errors: {
    sinFactura:   number;
    sinPedido:    number;
    sinCxcEnKore: number;
  };
  detalleBancarias:   DetalleFormaPagoCxc[];
  detalleNoBancarias: DetalleFormaPagoCxc[];
  detalleSinResolver: SinResolverFormaPagoCxc[];
}

// Una entrada por cada forma de pago usada en un cobro — bitácora de auditoría, se
// ACUMULA a través de múltiples cobros parciales (PPD) sobre la misma CxC, nunca se
// sobreescribe. `saldoPagado`/`saldoPagadoTotal` siguen siendo los acumulados rápidos;
// esto es el detalle que los respalda (de dónde salió cada peso).
export interface DesgloseFormaPago {
  formaPagoId:          string | null;
  formaPagoDescripcion: string | null;
  monto:                number;
  fecha:                string;
}

export interface ErpLink {
  erpId:             string;
  saldoActual:       number;
  saldoPagado?:      number | null;
  saldoPagadoTotal?: number | null;
  total:             number;
  folioFiscal:       string | null;
  serie?:            string | null;
  folioExterno?:     string | null;
  tieneRetencion?:   boolean;
  tipoPago?:         string | null;
  desglosePorFormaPago?: DesgloseFormaPago[];
  // Marca de procedencia: 'cfdi_liquidado' cuando la CxC se resolvió vía el buscador de
  // CFDI sin verificación en vivo contra Kore (ver ErpCxC.origen y erp.routes.js). Nunca
  // es cobrable desde "Aplicar Cobro" — ver erp-modal.component.ts, getter cobroIds.
  origen?:           string | null;
}

export interface BankMovement {
  _id:                string;
  banco:              'Banamex' | 'BBVA' | 'Santander' | 'Azteca';
  fecha:              string;
  concepto:           string;
  deposito:           number | null;
  retiro:             number | null;
  saldo:              number | null;
  saldoCalculado:     number | null;
  numeroAutorizacion: string | null;
  referenciaNumerica: string | null;
  status:             BankStatus;
  categoria:          string | null;
  folio:              string | null;
  uuidXML:            string | null;
  erpIds:             string[];
  erpLinks:           ErpLink[];
  saldoErp:           number | null;
  identificadoPor:    IdentificadoPorEntry[];
  ficha:              string | null;
  fichaBy:            string | null;
  fichaNombre:        string | null;
  fichaAt:            string | null;
  createdAt:          string;
}

// Resultado de GET /banks/cfdis/buscar — colección `cfdis` (dominio visor), solo source='ERP'.
export interface CfdiBusquedaResult {
  uuid:  string;
  serie: string | null;
  folio: string | null;
  fecha: string;
  total: number;
}

export interface BankPorStatus {
  no_identificado: number;
  identificado:    number;
  otros:           number;
  reclasificado:   number;
}

// Desglose de una categoría dentro de un banco — 2026-07-31: además de count/monto (chip de
// categoría), ahora también trae el mismo desglose por estatus/saldo que el banco completo, para
// que el dashboard pueda mostrar montos reales cuando se filtra por categoría (ver cardStats()
// en banks.component.ts) en vez de seguir sumando el banco entero.
export interface BankPorCategoria {
  categoria: string;
  count:     number;
  monto:     number;
  porStatus:          BankPorStatus;
  saldoPendiente:     number;
  saldoIdentificado:  number;
  saldoOtrosSolo:     number;
  saldoReclasificado: number;
}

export interface BankCard {
  banco:           string;
  movimientos:     number;
  movimientoNoIdentificado: number;
  totalDepositos:  number;
  totalRetiros:    number;
  saldoFinal:      number | null;
  saldoPendiente:    number;
  saldoActualizado:  number | null;
  saldoIdentificado: number;
  saldoOtros:        number;
  saldoOtrosSolo:     number;
  saldoReclasificado: number;
  ultimaFecha:     string | null;
  ultimaImport:    string | null;
  cuentaContable:  string | null;
  numeroCuenta:    string | null;
  saldoInicial:           number | null;
  saldoInicialFechaCorte: string | null;
  lastImportBy:  string | null;
  lastImportAt:  string | null;
  porStatus:    BankPorStatus;
  porCategoria: BankPorCategoria[];
}

export interface BankStatusStats {
  no_identificado:     number;
  identificado:        number;
  otros:               number;
  reclasificado:       number;
  dep_no_identificado: number;
  dep_identificado:    number;
  dep_otros:           number;
  dep_reclasificado:   number;
  years:               number[];
}

export interface BankBacklogAging {
  menos24h: number;
  de1a3d:   number;
  de3a7d:   number;
  mas7d:    number;
}

export interface BankIndicadoresIdentificacion {
  // Ambos en HORAS HÁBILES (8:00-20:00, lunes a sábado — domingo no cuenta), decisión
  // explícita del usuario (2026-08-17) — ver horasHabilesEntre() en
  // bank-indicadores.service.js. La mediana acompaña al promedio porque el tiempo de
  // identificación tiene cola larga: un puñado de casos muy lentos puede inflar el
  // promedio sin representar el caso típico del equipo.
  promedioHoras: number | null;
  medianaHoras: number | null;
  totalIdentificadosConDato: number;
  // Backlog de pendientes (no_identificado + reclasificado) por antigüedad, medido SOLO desde
  // la fecha de corte del dashboard (INDICADORES_DESDE en bank-indicadores.service.js,
  // 2026-08-17) — decisión explícita del usuario de no arrastrar historial viejo al promedio.
  backlog: BankBacklogAging;
  porUsuario: {
    userId: string | null;
    nombre: string | null;
    promedioHoras: number;
    count: number;
  }[];
}

export interface BankConfig {
  banco:          string;
  cuentaContable: string | null;
  numeroCuenta:   string | null;
}

export interface BankFilter {
  page?:        number;
  limit?:       number;
  banco?:       string;
  fechaInicio?: string;
  fechaFin?:    string;
  fechaAplicacionInicio?: string;
  fechaAplicacionFin?:    string;
  tipo?:        string;
  search?:      string;
  concepto?:        string;
  identificadoPor?: string;
  sortBy?:          string;
  sortDir?:     string;
  status?:      string;
  categorias?:  string;   // comma-separated; __null__ = sin categoría
  movId?:       string;   // saltar a movimiento específico (OCR)
  // ── Filtros de exportación adicionales ──────────────────────────────────
  importeMin?:  number;
  importeMax?:  number;
  folioFiscal?: 'con' | 'sin';
  ficha?:       'con' | 'sin';
  columnas?:    string;             // comma-separated column keys para el Excel
}

export interface BankIdentificador {
  userId: string;
  nombre: string;
}

export type IdentificadoPorEntry = {
  userId:  string | null;
  nombre:  string | null;
  fechaId: string | null;
  erpId:   string | null;
};

export interface ErpFormaPago {
  id:             string;
  nombre:         string;
  claveSAT:       string;
  esBancarizada:  boolean;
  reqNombreBanco: boolean;
}

export interface ErpCxC {
  id:                   string;
  serie:                string | null;
  folio:                string | null;
  serieExterna:         string | null;
  folioExterno:         string | null;
  tipoPago:             string | null;
  subtotal:             number;
  impuesto:             number;
  total:                number;
  saldoActual:          number;
  fechaVencimiento:     string | null;
  folioFiscal?:         string | null;
  nombrePersona?:       string | null;
  nombreTipoMovimiento?: string | null;
  personaId?:           string | null;
  esAnticipo?:          boolean;
  origen?:              string | null;
}

// Reversión de una CxC aplicada por Kore vía webhook server-to-server (ver
// erp-reversion.routes.js) cuando cancela/revierte una CxC que ya teníamos vinculada a un
// depósito bancario. Bandeja de auditoría (bitácora, solo lectura) — GET gateado por el
// permiso banks:erp:reversiones.
export interface ErpMovimientoAfectadoReversion {
  movementId: string;
  // 2026-08-20: una reversión ya no siempre desvincula el erpId por completo — si la CxC
  // tenía otros abonos vigentes, el link se AJUSTA en vez de desaparecer (ver
  // erp-reversion.service.js). 'desvinculado' llena erpLinkRemovido/identificadoPorRemovido
  // (comportamiento original); 'ajustado' llena erpLinkAjustado. Ausente en documentos
  // viejos (de antes de este campo) — se trata como 'desvinculado'.
  // 2026-08-21: 'sin_tocar' — el cálculo de aporte no reconcilió entre los movimientos de
  // esta CxC (ver ErpReversion.atribucionConfiable) y a propósito no se tocó nada; ninguno
  // de los campos de abajo aplica, el link sigue exactamente como estaba.
  tipo?: 'desvinculado' | 'ajustado' | 'sin_tocar';
  // Snapshot de lo que había en el movimiento antes de que Kore lo desvinculara — queda
  // guardado como rastro de auditoría. Solo aplica si tipo==='desvinculado'.
  erpLinkRemovido:         ErpLink | null;
  identificadoPorRemovido: IdentificadoPorEntry | null;
  // Snapshot antes/después del erpLink cuando tipo==='ajustado' — el link sigue existiendo,
  // solo cambiaron sus números tras reconsultar a Kore en vivo. Forma libre (Mixed en el
  // backend, es el .toObject() completo del subdocumento erpLink) — se muestra tal cual en
  // la vista de detalle, sin tipar cada campo.
  erpLinkAjustado?: { antes: Record<string, any>; despues: Record<string, any> } | null;
}

export interface ErpReversion {
  _id:                 string;
  erpId:               string;
  motivo:              string | null;
  fechaKore:           string | null;
  serieExterna:        string | null;
  folioExterno:        string | null;
  referencia:          string | null;
  serieFolioMismatch:  boolean;
  // 2026-08-21 (caso real: Kore avisó una reversión de $100 que JAMÁS aplicó de su lado —
  // el movimiento quedó intacto, sin ninguna entrada REV en su historial ni tiempo después).
  // true solo cuando SÍ se confirmó la reversión puntual contra Kore en vivo (match de fecha
  // exacta); false cuando se agotaron los reintentos sin lograrlo — no hay forma de saber
  // desde acá si "todavía no la aplicó" o si "falló y nunca la va a aplicar". Ausente en
  // documentos de antes de este campo (el backend aplica default:true para esos).
  confirmadaEnKore?:   boolean;
  // 2026-08-21 (caso real, folioExterno 260800164, CxC pagada por 2 movimientos bancarios
  // distintos): false cuando la suma de aportes calculados para TODOS los movimientos de
  // esta CxC no reconcilió contra lo que Kore dice pagado — bug de atribución ambigua entre
  // movimientos (las reversas de Kore no traen Aut/Numo propio). En ese caso NINGÚN link se
  // tocó (todos quedan tipo:'sin_tocar'), a propósito, para no desvincular algo que puede
  // seguir vigente de verdad. Ausente en documentos de antes de este campo (default true).
  atribucionConfiable?: boolean;
  // Payload crudo tal cual lo mandó Kore — mismo dato que ya queda en el log del servidor
  // ([erp-reversion] payload recibido de Kore →), persistido para no depender de logs.
  payloadOriginal?:    Record<string, any> | null;
  movimientosAfectados: ErpMovimientoAfectadoReversion[];
  estado:              'aplicada' | 'revertida';
  revertidoPor:        string | null;
  revertidoEn:         string | null;
  createdAt:           string;
}

export interface SesionCajaResult {
  sesionId:  string;
  koreToken: string;
}

export interface CobroBanco {
  id:          string;
  nombre:      string;
  claveBanco:  string;
  descripcion: string;
}

export interface CobroConcepto {
  id:          string;
  nombre:      string;
  abreviatura: string;
}

export interface DetalleFormaPago {
  FormaPagoID:      string;
  FormaPagoNombre:  string;
  Monto:            number;
  Recibido:         number;
  Comision:         number;
  transactionID:    string;
  BancoID?:         string;
  BancoDescripcion?: string;
  DatosAdicionales?: { Nombre: string; Valor: string }[];
}

export interface AplicarCobroPayload {
  anotacion:                string;
  anticipoTimbrar:          boolean;
  anticipos:                Record<string, number>;
  cantAnticipoAutomatico:   number;
  codigo:                   string;
  cuenta:                   string;
  datoFiscalID:             number;
  detalle: {
    DetalleFormaPago:  DetalleFormaPago[];
    Total:             number;
    autorizo:          string;
    concepto:          string;
    encargado:         string;
    fecha_afectacion:  string;
    fecha_aplicacion:  string;
    fecha_real_pago:   string;
  };
  formaPagoAnticipoAutoID:  string;
  notificarReversion:       boolean;
  saldosAFavorAUsar:        Record<string, number>;
  sesionId:                 string;
  usoCFDI:                  string;
}

export interface AplicarCobroPayloadMulti {
  MotivoAutorizacion:     string;
  anotacion:              string;
  anticipos:              Record<string, number>;
  cantAnticipoAutomatico: number;
  cuentas:                { CuentaID: string; Monto: number }[];
  datoFiscalID:           number;
  detalle: {
    DetalleFormaPago:  DetalleFormaPago[];
    Total:             number;
    autorizo:          string;
    concepto:          string;
    encargado:         string;
    fecha_afectacion:  string;
    fecha_aplicacion:  string;
    fecha_real_pago:   string;
  };
  formaPagoAnticipoAutoID: string;
  idUsuarioAutoriza:      string;
  notificarReversion:     boolean;
  saldosAFavorAUsar:      Record<string, number>;
}

export interface AplicarCobroResult {
  Mensaje: string;
  Codigo:  number;
  Data?:   unknown;
}

export interface ErpSaldoFavor {
  id:                  string;
  descripcion:         string;
  monto:               number;
  fecha?:              string | null;
  tipo:                'anticipo' | 'saldo_favor';
  cuentaDescripcion?:  string | null; // saldo_favor: cuenta padre de la que proviene el movimiento
}

export interface UpdateMovementDto {
  concepto?:           string | null;
  fecha?:              string | null;
  deposito?:           number | null;
  retiro?:             number | null;
  saldo?:              number | null;
  numeroAutorizacion?: string | null;
  referenciaNumerica?: string | null;
  status?:             BankStatus | null;
}

export type RuleCampo    = 'concepto' | 'deposito' | 'retiro' | 'referenciaNumerica' | 'numeroAutorizacion';
export type RuleOperador = 'contiene' | 'no_contiene' | 'igual' | 'empieza_con' | 'termina_con' | 'mayor_que' | 'menor_que' | 'mayor_igual' | 'menor_igual';

export interface BankRuleCondicion {
  campo:    RuleCampo;
  operador: RuleOperador;
  valor:    string;
}

export type RuleAccion      = 'categorizar' | 'bloquear_identificacion' | 'cambiar_estado';
export type RuleEstadoDestino = 'no_identificado' | 'otros' | 'reclasificado';
export type RuleOcultarRol  = 'contabilidad' | 'cobranza';

export interface BankRule {
  _id:             string;
  banco:           string;
  nombre:          string;
  condiciones:     BankRuleCondicion[];
  logica:          'Y' | 'O';
  accion:          RuleAccion;
  mensajeBloqueo?: string;
  estadoDestino?:  RuleEstadoDestino;
  ocultarRoles?:   RuleOcultarRol[];   // campo extra de 'categorizar'; vacío = no oculta a nadie
  orden:           number;
  createdAt:       string;
}

export interface UploadResult {
  message:      string;
  importados:   number;
  duplicados:   number;
  categorizados?: number;
  sinReglas?:   boolean;
  resumen:      Record<string, number>;
  erroresHojas: { hoja: string; error: string }[];
}

// ── Duplicados potenciales ────────────────────────────────────────────────────
export type DuplicateCriterio =
  | 'importe_saldo_fecha'
  | 'importe_saldo_auth'
  | 'importe_fecha_auth'
  | 'auth_monto_sin_saldo';

export interface DuplicateMovimiento {
  _id:                string;
  banco:              string;
  fecha:              string;
  concepto:           string | null;
  deposito:           number | null;
  retiro:             number | null;
  saldo:              number | null;
  numeroAutorizacion: string | null;
  referenciaNumerica: string | null;
  status:             BankStatus;
  folio:              string | null;
  categoria:          string | null;
  uploadedBy:         string | null;
  createdAt:          string;
}

export interface DuplicateMovementMeta {
  banco:     string;
  dia?:      string;        // ausente en importe_saldo_auth (cruza fechas)
  deposito?: number | null;
  retiro?:   number | null;
  saldo?:    number | null; // ausente en importe_fecha_auth y auth_monto_sin_saldo
  authKey?:  string;        // presente en importe_saldo_auth, importe_fecha_auth
}

export interface DuplicateMovementGroup {
  criterio:    DuplicateCriterio;
  meta:        DuplicateMovementMeta;
  count:       number;
  movimientos: DuplicateMovimiento[];
}

export interface DuplicatesResult {
  total:  number;
  grupos: DuplicateMovementGroup[];
}

// ── Pronto pago PPD ───────────────────────────────────────────────────────────
export interface KoreDescuento {
  idPolitica:     number;
  dias:           number;       // días restantes para conservar el descuento
  porcentaje:     number;
  monto:          number;       // monto de descuento aplicable
  iniciado:       boolean;
  diasTolerancia: number;
}

export interface KoreCuentaPPD {
  id:                   string;
  serie:                string | null;
  folio:                string | null;
  serieExterna?:        string | null;  // enriquecido en frontend desde ErpCxC
  folioExterno?:        string | null;  // enriquecido en frontend desde ErpCxC
  tipoPago:             string | null;
  total:                number;
  saldoActual:          number;
  saldoActualCalculado: number;  // importe con descuento aplicado
  descuentos:           KoreDescuento[];
}

// ── Sync ERP-Kore ────────────────────────────────────────────────────────────
// Job único de conciliación ERP-Kore (reemplaza los antiguos Sync Saldo ERP + Sync
// Histórico Kore, fusionados el 2026-07-09 para dejar de consultar Kore dos veces
// por la misma CxC).
export interface ErpSyncJobResult {
  procesados?:  number;  // solo presente si el job fue detenido a medias
  total:        number;
  actualizados: number;
  pendientes:   number;
  errores:      number;
  dryRun?:      boolean; // solo aplica al job 'recompute' — simulación, nada se escribió
}

export interface ErpSyncJobSummary {
  jobId:     string;
  kind:      'sync' | 'recompute';
  dryRun:    boolean;
  status:    'running' | 'paused' | 'done' | 'stopped' | 'error';
  result:    ErpSyncJobResult | null;
  error:     string | null;
  hasReport: boolean;
}

// ── Traspasos internos entre cuentas propias (BBVA) ──────────────────────────────
// Motor que encuentra pares de movimientos "traspaso interno" entre cuentas propias del
// usuario: depósito en BBVA con una categoría configurable ↔ retiro real en el banco
// contraparte, mismo día UTC + mismo monto, exactamente 1 candidato de cada lado. El banco
// contraparte NO es fijo — se determina por movimiento a partir del concepto del depósito
// BBVA (ver traspasos-internos.service.js#_extraerBancoContraparte); si no se puede
// determinar, el movimiento aparece en sinBancoDetectado.
export interface MovimientoCandidatoTraspaso {
  _id: string;
  banco: string;           // 'BBVA' | banco contraparte real (Banamex, Santander, Azteca, …)
  fecha: string;           // ISO date string tal como llega del backend
  deposito: number | null;
  retiro: number | null;
  folio: string | null;
  concepto: string | null;
  categoria: string | null;
  status: string;
}

export interface ParTraspasoRelacionado {
  bbva: MovimientoCandidatoTraspaso;
  contraparte: MovimientoCandidatoTraspaso;
}

export interface ResultadoTraspasosInternos {
  relacionados: ParTraspasoRelacionado[];
  ambiguos: MovimientoCandidatoTraspaso[];           // mezcla BBVA y contraparte, discriminar por .banco
  sinContraparteBbva: MovimientoCandidatoTraspaso[];
  sinContraparteOtros: MovimientoCandidatoTraspaso[];
  sinBancoDetectado: MovimientoCandidatoTraspaso[];  // BBVA cuyo concepto no permitió determinar el banco contraparte
  runId: string | null;   // null si dryRun:true, string si dryRun:false
}
