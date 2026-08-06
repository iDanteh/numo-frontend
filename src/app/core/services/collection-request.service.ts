import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiService } from './api.service';

// ── Interfaces ────────────────────────────────────────────────────────────────

export interface ExtractedReceiptData {
  monto:                 number | null;
  fecha:                 string | null;
  hora:                  string | null;
  claveRastreo:          string | null;
  referencia:            string | null;
  numeroAutorizacion:    string | null;
  clabe:                 string | null;
  bancoOrigen:           string | null;
  bancoDestino:          string | null;
  cuentaOrigenUltimos4:  string | null;
  cuentaDestinoUltimos4: string | null;
  titularOrigen:         string | null;
  titularDestino:        string | null;
  concepto:              string | null;
  confianza:             number;
  _ocrText?:             string;
}

export interface MovementCandidate {
  movement: {
    _id:                string;
    banco:              string;
    fecha:              string;
    concepto:           string;
    deposito:           number | null;
    retiro:             number | null;
    numeroAutorizacion: string | null;
    referenciaNumerica: string | null;
  };
  score:   number;
  reasons: string[];
  nivel:   'alto' | 'medio' | 'bajo';
}

export interface AnalyzeResponse {
  extracted:       ExtractedReceiptData;
  candidates:      MovementCandidate[];
  totalCandidatos: number;
}

// Un resultado de OCR por comprobante — nunca se combinan candidatos entre
// archivos, cada comprobante puede corresponder a un depósito bancario distinto.
export interface AnalyzeComprobanteResult extends AnalyzeResponse {
  comprobanteIndex: number;
  /** Si este comprobante en particular no se pudo leer (PDF corrupto/con contraseña,
   *  etc.) — los demás comprobantes de la misma solicitud igual se procesan normal. */
  error?: string;
}

export interface ComprobanteMeta {
  mimetype:     string | null;
  originalName: string | null;
}

// ── Solicitudes de Cobro ERP-Kore (backend reescrito 2026-07-06/07) ────────────
// Ver numo-backend/src/banks/domains/collection-requests/CollectionRequest.model.js

export interface CxCSolicitud {
  erpId:                string;
  serie:                string | null;
  folioExterno:         string | null;
  folioFiscal:          string | null;
  total:                number | null;
  tipoPago:             string | null;
  nombrePersona:        string | null;
  nombreTipoMovimiento: string | null;
  montoAsignado:        number | null; // solo presente en Modo 2 (varias CxC)
}

export interface FormaPagoSolicitud {
  // `_id` real del subdocumento Mongoose — es la clave de asignación multi-banco
  // (`formaPagoDocId`, ver identificar()/IdentificarPayload abajo): `formaPagoId`
  // NO es único dentro de formasPago[] (dos entradas "transferencia" son legales
  // en Modo 1), así que no sirve para desambiguar a qué forma se asignó qué banco.
  _id:                  string;
  formaPagoId:          string;
  formaPagoDescripcion: string;
  importe:              number;
  referencia:           string | null; // siempre null hasta que Numo aplique el cobro
  bancoKoreId:          string | null;
  bancoDescripcion:     string | null;
  // Movimiento bancario asignado a ESTA forma de pago (multi-bank-movement,
  // 2026-08-06). null hasta que se identifique (o en documentos históricos sin
  // backfill — ver movimientosDe() en el backend). Mismo shape resumido que el
  // campo raíz `bankMovementId` de abajo.
  bankMovementId: {
    _id: string; banco: string; fecha: string; concepto: string;
    deposito: number | null; retiro: number | null;
  } | string | null;
}

// Advertencia de reconciliación de montos — SIEMPRE informativa, nunca bloquea
// identificar() (ver collection-request-asignaciones.js#calcularReconciliacion en
// el backend). `mensaje` solo viene distinto de null cuando los movimientos
// asignados suman MENOS que lo solicitado (abono parcial) — un excedente nunca
// genera advertencia.
export interface ReconciliacionCobro {
  montoSolicitado: number;
  montoDepositado: number;
  diferencia:      number;
  cubreParcial:    boolean;
  mensaje:         string | null;
}

// Payload de identificar() (PATCH .../identificar) — el atajo escalar
// `{bankMovementId}` es el camino feliz sin cambios (1 solo depósito, se aplica a
// TODAS las formasPago); `{asignaciones}` es la expansión opt-in para 2+
// depósitos, uno por forma de pago (clave = `formaPagoDocId`, el `_id` de arriba).
export type IdentificarPayload =
  | { bankMovementId: string }
  | { asignaciones: { formaPagoDocId: string; bankMovementId: string }[] };

export interface CollectionRequest {
  _id:                string;
  solicitudIdErp:     string;
  cxcs:               CxCSolicitud[];
  formasPago:         FormaPagoSolicitud[];
  monto:              number;
  modo:               'single' | 'multi'; // 'single' = Modo 1 (1 CxC), 'multi' = Modo 2 (N CxC)
  descripcion:        string | null;
  conceptoId:         string | null;
  // Legacy (Mongo, un solo archivo) — tieneComprobante ya viene UNIFICADO desde
  // el backend (true si hay algo en `comprobante` O en `comprobantes[]`).
  comprobante: {
    tieneComprobante: boolean;
    mimetype:         string | null;
    originalName:     string | null;
  };
  // Nuevos (Drive, uno o varios) — vacío en solicitudes viejas de un solo archivo.
  comprobantes: ComprobanteMeta[];
  solicitanteUserId:  string;
  solicitanteNombre:  string | null;
  bankMovementId: {
    _id: string; banco: string; fecha: string; concepto: string;
    deposito: number | null; retiro: number | null;
  } | string | null;
  // Presente solo tras identificar()/en el evento socket `collection-request:updated`
  // cuando la solicitud quedó ligada a 2+ movimientos distintos (multi-bank-movement,
  // 2026-08-06) — mismo shape que emite el backend en `_eventoActualizacion()`.
  // Ausente en solicitudes de un solo movimiento o en objetos cargados antes de este
  // cambio: opcional a propósito, nunca se debe asumir presente.
  bankMovements?: {
    _id: string; banco: string; fecha: string; concepto: string;
    deposito: number | null; retiro: number | null;
  }[];
  status:             'pendiente' | 'identificada' | 'rechazada' | 'cancelada';
  motivoRechazo:      string | null;
  resueltoPorUserId:  string | null;
  resueltoPorNombre:  string | null;
  resueltoAt:         string | null;
  // Cancelación (Kore avisa que canceló la CxC de su lado, ej. CAC, mientras la
  // solicitud seguía pendiente — ver collection-request.service.js#cancelarPorErp).
  canceladoPorUserId: string | null;
  canceladoPorNombre: string | null;
  canceladoAt:        string | null;
  createdAt:          string;
}

// Parámetros de list()/listMine() — search + rango de fecha (sobre createdAt)
// se agregan 2026-07-29 junto con la paginación real por status (antes el
// frontend pedía hasta 200 sin filtrar y filtraba la pestaña en memoria).
export interface CollectionRequestListParams {
  page?:        number;
  limit?:       number;
  status?:      string;
  search?:      string;
  fechaInicio?: string;
  fechaFin?:    string;
}

export interface CollectionRequestPagination {
  total: number;
  page:  number;
  limit: number;
  pages: number;
}

// Conteos globales (no acotados a la página/pestaña actual) — ver
// collection-request.service.js#_stats en el backend.
export interface CollectionRequestStats {
  counts: { pendiente: number; identificada: number; rechazada: number; cancelada: number };
  identificadasHoy:    number;
  rechazadasHoy:       number;
  montoPendienteTotal: number;
}

// ── Service ───────────────────────────────────────────────────────────────────

@Injectable({ providedIn: 'root' })
export class CollectionRequestService {

  constructor(private api: ApiService) {}

  /** Analiza una imagen de comprobante sin almacenarla (usado por OcrModalComponent) */
  analyzeReceipt(file: File): Observable<AnalyzeResponse> {
    return this.api.uploadFiles<AnalyzeResponse>(
      '/collection-requests/analyze',
      [file],
      'comprobante',
    );
  }

  /** Corre OCR + matching sobre CADA comprobante YA guardado en la solicitud — un resultado por archivo */
  analyzeComprobante(id: string): Observable<AnalyzeComprobanteResult[]> {
    return this.api.get<AnalyzeComprobanteResult[]>(`/collection-requests/${id}/analyze-comprobante`);
  }

  /** Bandeja completa — requiere collections:read (cobranza/contabilidad/admin/tienda) */
  list(params: CollectionRequestListParams = {})
    : Observable<{ data: CollectionRequest[]; pagination: CollectionRequestPagination }> {
    return this.api.get<any>('/collection-requests', params as any);
  }

  /** Solo las solicitudes creadas por el usuario autenticado (rol tienda) */
  listMine(params: CollectionRequestListParams = {})
    : Observable<{ data: CollectionRequest[]; pagination: CollectionRequestPagination }> {
    return this.api.get<any>('/collection-requests/mias', params as any);
  }

  /** Conteos (por status + "hoy" + monto pendiente) para las tarjetas de stats y los
   *  badges de las pestañas — independiente de list(), que ahora solo trae la página
   *  del status activo (ver collection-request.component.ts#reload). */
  stats(): Observable<CollectionRequestStats> {
    return this.api.get<CollectionRequestStats>('/collection-requests/stats');
  }

  /** Mismo propósito que stats(), acotado a las solicitudes del usuario autenticado. */
  statsMine(): Observable<CollectionRequestStats> {
    return this.api.get<CollectionRequestStats>('/collection-requests/mias/stats');
  }

  /** Reporte Excel de TODAS las solicitudes resueltas (Autorizadas/Rechazadas) —
   *  requiere collections:write. Solo admite search/fechaInicio/fechaFin: status
   *  y paginación no aplican a un reporte (ver buildReport en el backend, que
   *  fija el status a resueltas sin importar qué se mande aquí). */
  report(params: Pick<CollectionRequestListParams, 'search' | 'fechaInicio' | 'fechaFin'> = {}): Observable<Blob> {
    return this.api.downloadBlob('/collection-requests/report', params as Record<string, unknown>);
  }

  /** Mismo reporte, acotado a las solicitudes resueltas del usuario autenticado
   *  (rol tienda, collections:read). */
  reportMine(params: Pick<CollectionRequestListParams, 'search' | 'fechaInicio' | 'fechaFin'> = {}): Observable<Blob> {
    return this.api.downloadBlob('/collection-requests/mias/report', params as Record<string, unknown>);
  }

  getById(id: string): Observable<CollectionRequest> {
    return this.api.get<CollectionRequest>(`/collection-requests/${id}`);
  }

  /** Binario del comprobante en esa posición (imagen/PDF) — requiere blob, no JSON */
  getComprobanteBlob(id: string, index: number = 0): Observable<Blob> {
    return this.api.downloadBlob(`/collection-requests/${id}/comprobantes/${index}`);
  }

  /** Vincula la solicitud a uno o varios movimientos bancarios ya identificados
   *  manualmente — payload = atajo escalar `{bankMovementId}` (camino feliz, 1 solo
   *  depósito) o `{asignaciones}` (2+ depósitos, uno por forma de pago). La respuesta
   *  incluye `reconciliacion`, una advertencia SIEMPRE informativa (nunca bloqueante)
   *  cuando lo depositado cubre menos de lo solicitado. */
  identificar(id: string, payload: IdentificarPayload): Observable<CollectionRequest & { reconciliacion: ReconciliacionCobro }> {
    return this.api.patch<CollectionRequest & { reconciliacion: ReconciliacionCobro }>(
      `/collection-requests/${id}/identificar`, payload,
    );
  }

  /** Rechaza la solicitud */
  rechazar(id: string, motivo: string): Observable<CollectionRequest> {
    return this.api.patch<CollectionRequest>(`/collection-requests/${id}/rechazar`, { motivo });
  }

  /** Lista movimientos bancarios para búsqueda manual */
  listBankMovements(params: {
    banco?:            string;
    search?:           string;
    tipo?:             'deposito' | 'retiro' | '';
    fechaInicio?:      string;
    fechaFin?:         string;
    status?:           string;
    page?:             number;
    limit?:            number;
    // 'amplia' — mismo criterio de tolerancia que el matching OCR (max($0.50, monto*0.5%)),
    // en vez del esquema por-decimales-tipeados por default de este endpoint compartido.
    montoTolerancia?:  'amplia';
  } = {}): Observable<{ data: any[]; pagination: any }> {
    return this.api.get<any>('/banks/movements', params as any);
  }
}
