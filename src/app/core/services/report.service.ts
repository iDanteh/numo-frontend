import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiService } from './api.service';

export interface PagosBancoFiltros {
  uuid?:        string;
  serie?:       string;
  folio?:       string;
  banco?:       string;
  fechaInicio?: string;
  fechaFin?:    string;
  ejercicio?:   number;
  periodo?:     number;
  estado?:      'todos' | 'con_pago' | 'sin_pago';
  page?:        number;
  limit?:       number;
}

export interface PagoBancoRow {
  cfdiUuid:         string;
  satStatus:        string;
  source:           string;
  fechaPago:        string;
  montoPago:        number;
  facturaUuid:      string;
  serie:            string;
  folio:            string;
  numParcialidad:   number;
  impPagado:        number;
  impSaldoInsoluto: number;
  tienePago:    boolean;
  banco:        string | null;
  movFecha:     string | null;
  movFolio:     string | null;
  deposito:     number | null;
  movConcepto:  string | null;
  numOperacion: string | null;
  diferencia:   number;
}

export interface PagosBancoResumen {
  conPago: { cantidad: number; monto: number };
  sinPago: { cantidad: number; monto: number };
}

export interface PagosBancoResponse {
  data:    PagoBancoRow[];
  total:   number;
  page:    number;
  limit:   number;
  pages:   number;
  resumen: PagosBancoResumen;
}

export interface PagosBancoDetalle {
  factura: {
    uuid: string;
    satStatus: string;
    serie: string;
    folio: string;
    total: number;
    fecha: string;
  } | null;
  movimientos: {
    banco: string;
    fecha: string;
    deposito: number;
    retiro: number;
    folio: string;
    concepto: string;
    status: string;
    numeroAutorizacion: string | null;
    referenciaNumerica: string | null;
  }[];
}

@Injectable({ providedIn: 'root' })
export class ReportService {
  constructor(private api: ApiService) {}

  getPagosBanco(filtros: PagosBancoFiltros = {}): Observable<PagosBancoResponse> {
    return this.api.get<PagosBancoResponse>('/reports/pagos-banco', filtros as Record<string, unknown>);
  }

  getDetalle(facturaUuid: string): Observable<PagosBancoDetalle> {
    return this.api.get<PagosBancoDetalle>('/reports/pagos-banco/detalle', { facturaUuid } as Record<string, unknown>);
  }

  exportPagosBanco(filtros: Omit<PagosBancoFiltros, 'page' | 'limit'> = {}): Observable<Blob> {
    return this.api.downloadBlob('/reports/pagos-banco/export', filtros as Record<string, unknown>);
  }

  getBancosDistintos(): Observable<string[]> {
    return this.api.get<string[]>('/reports/pagos-banco/bancos');
  }
}
