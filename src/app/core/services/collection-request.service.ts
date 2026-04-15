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

export interface CollectionRequest {
  _id:           string;
  clienteNombre: string | null;
  clienteRFC:    string | null;
  monto:         number | null;
  concepto:      string | null;
  status:        'pendiente' | 'por_confirmar' | 'confirmado' | 'rechazado';
  comprobante: {
    montoExtraido:         number | null;
    fechaExtraida:         string | null;
    claveRastreo:          string | null;
    bancoOrigen:           string | null;
    bancoDestino:          string | null;
    titularOrigen:         string | null;
    titularDestino:        string | null;
    confianzaExtraccion:   number;   // siempre presente (default 0)
  };
  bankMovementId: any | null;
  createdAt:     string;
  creadoPor:     any;
}

// ── Service ───────────────────────────────────────────────────────────────────

@Injectable({ providedIn: 'root' })
export class CollectionRequestService {

  constructor(private api: ApiService) {}

  /** Analiza una imagen de comprobante sin almacenarla */
  analyzeReceipt(file: File): Observable<AnalyzeResponse> {
    return this.api.uploadFiles<AnalyzeResponse>(
      '/collection-requests/analyze',
      [file],
      'comprobante',
    );
  }

  /** Lista solicitudes con filtros opcionales */
  list(params: { page?: number; limit?: number; status?: string } = {})
    : Observable<{ data: CollectionRequest[]; pagination: any }> {
    return this.api.get<any>('/collection-requests', params as any);
  }

  /** Crea una solicitud (datos extraídos + movimiento seleccionado) */
  create(body: {
    clienteNombre?:  string;
    clienteRFC?:     string;
    monto?:          number;
    concepto?:       string;
    bankMovementId?: string;
    cfdiIds?:        string[];
    comprobante?:    Partial<ExtractedReceiptData>;
    notas?:          string;
  }): Observable<CollectionRequest> {
    return this.api.post<CollectionRequest>('/collection-requests', body);
  }

  /** Confirma la solicitud vinculándola a un movimiento bancario */
  confirmar(id: string, bankMovementId: string, notas?: string): Observable<CollectionRequest> {
    return this.api.patch<CollectionRequest>(`/collection-requests/${id}/confirmar`, {
      bankMovementId,
      notas,
    });
  }

  /** Rechaza la solicitud */
  rechazar(id: string, notas?: string): Observable<CollectionRequest> {
    return this.api.patch<CollectionRequest>(`/collection-requests/${id}/rechazar`, { notas });
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
