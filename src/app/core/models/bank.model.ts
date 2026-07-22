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
  porStatus: {
    no_identificado: number;
    identificado:    number;
    otros:           number;
    reclasificado:   number;
  };
  porCategoria: { categoria: string; count: number; monto: number }[];
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
}

export interface ErpSyncJobSummary {
  jobId:     string;
  status:    'running' | 'paused' | 'done' | 'stopped' | 'error';
  result:    ErpSyncJobResult | null;
  error:     string | null;
  hasReport: boolean;
}
