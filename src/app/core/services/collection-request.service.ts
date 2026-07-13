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
  formaPagoId:          string;
  formaPagoDescripcion: string;
  importe:              number;
  referencia:           string | null; // siempre null hasta que Numo aplique el cobro
  bancoKoreId:          string | null;
  bancoDescripcion:     string | null;
}

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
  status:             'pendiente' | 'identificada' | 'rechazada';
  motivoRechazo:      string | null;
  resueltoPorUserId:  string | null;
  resueltoPorNombre:  string | null;
  resueltoAt:         string | null;
  createdAt:          string;
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
  list(params: { page?: number; limit?: number; status?: string } = {})
    : Observable<{ data: CollectionRequest[]; pagination: any }> {
    return this.api.get<any>('/collection-requests', params as any);
  }

  /** Solo las solicitudes creadas por el usuario autenticado (rol tienda) */
  listMine(params: { page?: number; limit?: number; status?: string } = {})
    : Observable<{ data: CollectionRequest[]; pagination: any }> {
    return this.api.get<any>('/collection-requests/mias', params as any);
  }

  getById(id: string): Observable<CollectionRequest> {
    return this.api.get<CollectionRequest>(`/collection-requests/${id}`);
  }

  /** Binario del comprobante en esa posición (imagen/PDF) — requiere blob, no JSON */
  getComprobanteBlob(id: string, index: number = 0): Observable<Blob> {
    return this.api.downloadBlob(`/collection-requests/${id}/comprobantes/${index}`);
  }

  /** Vincula la solicitud a un movimiento bancario ya identificado manualmente */
  identificar(id: string, bankMovementId: string): Observable<CollectionRequest> {
    return this.api.patch<CollectionRequest>(`/collection-requests/${id}/identificar`, { bankMovementId });
  }

  /** Rechaza la solicitud */
  rechazar(id: string, motivo: string): Observable<CollectionRequest> {
    return this.api.patch<CollectionRequest>(`/collection-requests/${id}/rechazar`, { motivo });
  }

  /** Lista movimientos bancarios para búsqueda manual */
  listBankMovements(params: {
    banco?:       string;
    search?:      string;
    tipo?:        'deposito' | 'retiro' | '';
    fechaInicio?: string;
    fechaFin?:    string;
    status?:      string;
    page?:        number;
    limit?:       number;
  } = {}): Observable<{ data: any[]; pagination: any }> {
    return this.api.get<any>('/banks/movements', params as any);
  }
}
