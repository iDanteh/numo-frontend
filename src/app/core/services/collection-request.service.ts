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
  cxcs:               CxCSolicitud[];
  formasPago:         FormaPagoSolicitud[];
  monto:              number;
  modo:               'single' | 'multi'; // 'single' = Modo 1 (1 CxC), 'multi' = Modo 2 (N CxC)
  descripcion:        string | null;
  conceptoId:         string | null;
  comprobante: {
    tieneComprobante: boolean;
    mimetype:         string | null;
    originalName:     string | null;
  };
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
  // true si el sistema identificó y aplicó el cobro solo (OCR ≥95% + monto
  // exacto), sin que un humano diera clic en "Autorizar e identificar".
  autoIdentificado:   boolean;
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

  /** Corre OCR + matching sobre el comprobante YA guardado en la solicitud */
  analyzeComprobante(id: string): Observable<AnalyzeResponse> {
    return this.api.get<AnalyzeResponse>(`/collection-requests/${id}/analyze-comprobante`);
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

  /** Binario del comprobante (imagen/PDF) — requiere blob, no JSON */
  getComprobanteBlob(id: string): Observable<Blob> {
    return this.api.downloadBlob(`/collection-requests/${id}/comprobante`);
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
    page?:        number;
    limit?:       number;
  } = {}): Observable<{ data: any[]; pagination: any }> {
    return this.api.get<any>('/banks/movements', params as any);
  }
}
