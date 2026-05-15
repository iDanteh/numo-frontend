import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiService } from './api.service';

export interface CfdiMappingRule {
  id: number;
  nombre: string;
  tipoComprobante: 'I' | 'E' | 'P' | null;
  rfcEmisor: string | null;
  metodoPago: string | null;
  formaPago: string | null;
  cuentaCargo: string;
  cuentaAbono: string;
  cuentaIva: string | null;
  cuentaIvaPPD: string | null;
  cuentaIvaRetenido: string | null;
  cuentaIsrRetenido: string | null;
  centroCosto: string | null;
  prioridad: number;
  isActive: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export interface BalanzaCuenta {
  codigo: string;
  nombre: string;
  tipo: string;
  debe: number;
  haber: number;
  saldoInicial: number;
  saldo: number;
  movCount: number;
}

export interface BalanzaPreliminar {
  cuentas: BalanzaCuenta[];
  totales: { debe: number; haber: number; saldoInicial: number; saldoFinal: number };
  meta: { totalCfdis: number; sinRegla: number; periodo: number; ejercicio: number; tipos: string[] };
}

export interface BalanceGrupo {
  cuentas: BalanzaCuenta[];
  total: number;
}

export interface BalanceGeneral {
  activo:  BalanceGrupo;
  pasivo:  BalanceGrupo;
  capital: BalanceGrupo;
  resultados: {
    ingresos: BalanceGrupo;
    gastos:   BalanceGrupo;
    utilidad: number;
  };
  totales: { activo: number; pasivoCapital: number; cuadra: boolean };
  meta: { totalCfdis: number; sinRegla: number; periodo: number; ejercicio: number };
}

export interface PropuestaResult {
  tipoCfdi: string;
  totalCfdis: number;
  sinRegla: number;
  advertencias: string[];
  movimientos: any[];
}

export interface GenerarGuardarResult {
  polizaId: number;
  totalCfdis: number;
  sinRegla: number;
  advertencias: string[];
}

@Injectable({ providedIn: 'root' })
export class CfdiMappingService {
  constructor(private api: ApiService) {}

  listRules(): Observable<CfdiMappingRule[]> {
    return this.api.get<CfdiMappingRule[]>('/cfdi-mapping/rules');
  }

  createRule(data: Partial<CfdiMappingRule>): Observable<CfdiMappingRule> {
    return this.api.post<CfdiMappingRule>('/cfdi-mapping/rules', data);
  }

  updateRule(id: number, data: Partial<CfdiMappingRule>): Observable<CfdiMappingRule> {
    return this.api.patch<CfdiMappingRule>(`/cfdi-mapping/rules/${id}`, data);
  }

  deleteRule(id: number): Observable<void> {
    return this.api.delete<void>(`/cfdi-mapping/rules/${id}`);
  }

  generarYGuardar(params: {
    rfc: string; ejercicio: number; periodo: number;
    tipoCfdi: string; tipoPropuesta?: string;
  }): Observable<GenerarGuardarResult> {
    return this.api.post<GenerarGuardarResult>('/cfdi-mapping/generar-y-guardar', params);
  }

  balanzaPreliminar(params: {
    rfc: string; ejercicio: number; periodo: number; tipoCfdi?: string;
  }): Observable<BalanzaPreliminar> {
    return this.api.get<BalanzaPreliminar>('/cfdi-mapping/balanza-preliminar', params as Record<string, unknown>);
  }

  balanceGeneral(params: {
    rfc: string; ejercicio: number; periodo: number;
  }): Observable<BalanceGeneral> {
    return this.api.get<BalanceGeneral>('/cfdi-mapping/balance-general', params as Record<string, unknown>);
  }
}
