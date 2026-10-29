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
  /** Solo en "CON PENDIENTES DE PAGO": lo que todavía deben las remisiones. */
  saldo?:       number;
  /** PENDIENTE GENERAR FACTURA / CON PENDIENTES DE PAGO del reporte: última
   *  identificación/vinculación (los de fecha anterior identificados en el rango también salen). */
  identificadoEl?: string | null;
  /** Reporte "Por facturar" (2026-10-28): cobro de sus remisiones por forma de pago (null = sin datos de Kore). */
  formasPago?: FormasPago | null;
  /** Folio de la factura (global / a nombre del cliente) en las secciones. */
  factura?: string;
}

/** 2026-10-29: depósito en efectivo con columna propia; abonos en efectivo de notas sin facturar o con saldo → abonos. */
export type FormaPago = 'efectivo' | 'depositoEfectivo' | 'transferencia' | 'tarjeta' | 'cheque' | 'abonos' | 'otras';
export const FORMAS_PAGO: FormaPago[] = ['efectivo', 'depositoEfectivo', 'transferencia', 'tarjeta', 'cheque', 'abonos', 'otras'];
export type FormasPago = Record<FormaPago, number> & { mixto: boolean };

export type SeccionPorFacturar = 'global' | 'pendiente' | 'ppd' | 'pendientesPago' | 'efectivo';

export interface TotalesPorFacturar {
  importe: number; aplicado: number; saldo: number; formas: Record<FormaPago, number>;
}

/** Una tabla de una sección (en "EN FACTURA GLOBAL", una por factura). */
export interface BloquePorFacturar {
  titulo:        string;
  factura?:      string;
  fechaFactura?: string | null;
  totalFactura?: number | null;
  grupos:        { cliente: string; depositos: DepositoMostrador[]; totales: TotalesPorFacturar }[];
  totales:       TotalesPorFacturar;
}

export interface AlmacenSeccion {
  serie:    string;
  sucursal: string | null;
  bloques:  BloquePorFacturar[];
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
  pendientesPago?:     { depositos: number; importe: number };
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
  /** Último "Actualizar" (recálculo del mismo reporte). */
  actualizadoPor?: { nombre: string; email: string } | null;
  actualizadoEn?:  string | null;
}

export interface ReportePorFacturarDetalle extends ReportePorFacturarRow {
  /** Las 5 pestañas (2026-10-28): por almacén, agrupadas por cliente. */
  secciones: {
    global:         AlmacenSeccion[];
    pendiente:      AlmacenSeccion[];
    ppd:            AlmacenSeccion[];
    pendientesPago: AlmacenSeccion[];
    efectivo:       DepositoEfectivoSinAsociar[];
  };
  tablas: {
    facturasGlobales:    FacturaMostrador[];
    ppdFacturadoCliente: FacturaMostrador[];
    depositosPendientes: DepositoMostrador[];
    pendientesPago:      DepositoMostrador[];
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

  /** Vuelve a calcular el mismo reporte (misma sucursal y fechas) con la información actual. */
  actualizar(id: number): Observable<ReportePorFacturarDetalle> {
    return this.api.post<ReportePorFacturarDetalle>(`${this.path}/${id}/actualizar`, {});
  }

  /** Borrado lógico: deja de verse; el backend guarda quién lo eliminó. */
  eliminar(id: number): Observable<{ ok: boolean; id: number }> {
    return this.api.delete<{ ok: boolean; id: number }>(`${this.path}/${id}`);
  }

  /** Excel de una pestaña (`seccion`) o de todas. */
  descargarExcel(id: number, seccion?: SeccionPorFacturar): Observable<Blob> {
    return this.api.downloadBlob(`${this.path}/${id}/excel`, seccion ? { seccion } : undefined);
  }
}
