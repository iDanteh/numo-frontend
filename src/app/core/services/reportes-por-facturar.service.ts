import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiService } from './api.service';

/** Depósito de Bancos tal como sale en la pestaña MOSTRADOR de la póliza. */
export interface DepositoMostrador {
  fecha:        string | null;
  descripcion:  string;
  importe:      number;
  aplicado?:    number;
  banco:        string;
  remisiones:   string[];
  cliente:      string;
  idNumo:       string;
  estatus?:     string;
}

export interface FacturaMostrador {
  uuid:          string;
  serie:         string | null;
  folio:         string | null;
  fechaFactura:  string | null;
  esGlobal?:     boolean;
  totalFactura:  number;
  totalAplicado: number;
  depositos:     DepositoMostrador[];
}

export interface ResumenPorFacturar {
  facturasGlobales:    { facturas: number; depositos: number; importe: number };
  ppdFacturadoCliente: { facturas: number; depositos: number; importe: number };
  depositosPendientes: { depositos: number; importe: number };
  depositosEfectivo?:  { depositos: number; importe: number };
}

/** Depósito en efectivo sin asociar a ninguna venta en Bancos. */
export interface DepositoEfectivoSinAsociar {
  fecha:       string | null;
  descripcion: string;
  importe:     number;
  banco:       string;
  ficha:       string;
  idNumo:      string;
}

export interface ReportePorFacturarRow {
  id:            number;
  rfc:           string;
  centroCostoId: number | null;
  sucursal:      string | null;
  fechaInicio:   string;
  fechaFin:      string;
  resumen:       ResumenPorFacturar | null;
  advertencias:  string[] | null;
  creadoPor?:    { nombre: string; email: string } | null;
  createdAt:     string;
}

export interface ReportePorFacturarDetalle extends ReportePorFacturarRow {
  tablas: {
    facturasGlobales:    FacturaMostrador[];
    ppdFacturadoCliente: FacturaMostrador[];
    depositosPendientes: DepositoMostrador[];
    depositosEfectivo:   DepositoEfectivoSinAsociar[];
  };
}

@Injectable({ providedIn: 'root' })
export class ReportesPorFacturarService {
  private readonly path = '/reportes-por-facturar';

  constructor(private api: ApiService) {}

  /** Historial paginado, más recientes primero. */
  listar(rfc: string | null, page = 1, limit = 5): Observable<{ data: ReportePorFacturarRow[]; total: number; page: number; limit: number }> {
    return this.api.get<{ data: ReportePorFacturarRow[]; total: number; page: number; limit: number }>(this.path, { ...(rfc ? { rfc } : {}), page, limit });
  }

  generar(params: { rfc: string; centroCostoId: number | null; fechaInicio: string; fechaFin: string }): Observable<ReportePorFacturarDetalle> {
    return this.api.post<ReportePorFacturarDetalle>(this.path, params);
  }

  obtener(id: number): Observable<ReportePorFacturarDetalle> {
    return this.api.get<ReportePorFacturarDetalle>(`${this.path}/${id}`);
  }

  /** Borrado lógico: deja de verse; el backend guarda quién lo eliminó. */
  eliminar(id: number): Observable<{ ok: boolean; id: number }> {
    return this.api.delete<{ ok: boolean; id: number }>(`${this.path}/${id}`);
  }

  descargarExcel(id: number): Observable<Blob> {
    return this.api.downloadBlob(`${this.path}/${id}/excel`);
  }
}
