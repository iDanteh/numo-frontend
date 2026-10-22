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
  };
}

@Injectable({ providedIn: 'root' })
export class ReportesPorFacturarService {
  private readonly path = '/reportes-por-facturar';

  constructor(private api: ApiService) {}

  listar(rfc: string | null): Observable<{ data: ReportePorFacturarRow[] }> {
    return this.api.get<{ data: ReportePorFacturarRow[] }>(this.path, rfc ? { rfc } : {});
  }

  generar(params: { rfc: string; centroCostoId: number | null; fechaInicio: string; fechaFin: string }): Observable<ReportePorFacturarDetalle> {
    return this.api.post<ReportePorFacturarDetalle>(this.path, params);
  }

  obtener(id: number): Observable<ReportePorFacturarDetalle> {
    return this.api.get<ReportePorFacturarDetalle>(`${this.path}/${id}`);
  }

  descargarExcel(id: number): Observable<Blob> {
    return this.api.downloadBlob(`${this.path}/${id}/excel`);
  }
}
