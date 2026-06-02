import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiService } from './api.service';
import { Poliza } from './poliza.service';

export interface CfdiMappingRule {
  id?:                  number;
  nombre:               string;
  // Filtros de matching
  tipoComprobante?:     'I' | 'E' | 'P' | null;
  rfcEmisor?:           string | null;
  rfcReceptor?:         string | null;
  metodoPago?:          'PPD' | 'PUE' | null;
  formaPago?:           string | null;
  claveProdServ?:       string | null;
  tipoRelacion?:        string | null;
  relacionadoTipo?:     'I' | 'E' | 'P' | null;
  tasaIva?:             '0' | '16' | 'mixto' | null;
  tieneDescuento?:      boolean | null;
  conceptoContiene?:    string | null;
  // Cuentas principales
  cuentaCargo:          string;
  cuentaAbono:          string;
  // Cuentas IVA
  cuentaIva?:           string | null;
  cuentaIvaPPD?:        string | null;
  cuentaIvaRetenido?:   string | null;
  cuentaIsrRetenido?:   string | null;
  cuentaIvaAnticipo?:   string | null;
  // Cuentas adicionales
  cuentaAbono2?:        string | null;
  cuentaCargo2?:        string | null;
  cuentaDeltaAnticipo?: string | null;
  cuentaDescuento?:     string | null;
  cuentaDescuento0?:    string | null;
  // Flags especiales
  ivaHaber?:            boolean | null;
  esAplicacionSaldo?:   boolean | null;
  // Otros
  centroCosto?:         string | null;
  prioridad:            number;
  isActive:             boolean;
}

export interface BalanzaCuenta {
  codigo:        string;
  nombre:        string;
  tipo:          string;
  debe:          number;
  haber:         number;
  saldoInicial:  number;
  saldo:         number;
  movCount:      number;
  nivel?:        number;
  esAgrupadora?: boolean;  // true = cuenta padre; excluir de sumas iguales
}

export interface BalanzaPreliminar {
  cuentas:  BalanzaCuenta[];
  totales:  { debe: number; haber: number; saldoInicial: number };
  meta:     { totalCfdis: number; sinRegla: number; periodo: number; ejercicio: number; tipos: string[] };
}

export interface BalanceGrupo {
  cuentas: BalanzaCuenta[];
  total:   number;
}

export interface BalanceGeneral {
  activo:      BalanceGrupo;
  pasivo:      BalanceGrupo;
  capital:     BalanceGrupo;
  resultados: {
    ingresos: BalanceGrupo;
    gastos:   BalanceGrupo;
    utilidad: number;
  };
  totales: { activo: number; pasivoCapital: number; cuadra: boolean };
  meta:    { totalCfdis: number; sinRegla: number; periodo: number; ejercicio: number; tipos: string[] };
}

export interface GenerarYGuardarResult {
  polizaId:     number;
  totalCfdis:   number;
  sinRegla:     number;
  advertencias: string[];
}

export interface MigrarPpdDescuentoResult {
  actualizadas: string[];
  insertadas:   string[];
  yaExistian:   string[];
}

export interface PolizaPropuesta extends Poliza {
  _meta: {
    totalCfdis:   number;
    sinRegla:     number;
    advertencias: string[];
  };
}

@Injectable({ providedIn: 'root' })
export class CfdiMappingService {
  constructor(private api: ApiService) {}

  listRules(): Observable<CfdiMappingRule[]> {
    return this.api.get<CfdiMappingRule[]>('/cfdi-mapping/rules');
  }

  createRule(data: CfdiMappingRule): Observable<CfdiMappingRule> {
    return this.api.post<CfdiMappingRule>('/cfdi-mapping/rules', data);
  }

  updateRule(id: number, data: Partial<CfdiMappingRule>): Observable<CfdiMappingRule> {
    return this.api.patch<CfdiMappingRule>(`/cfdi-mapping/rules/${id}`, data);
  }

  deleteRule(id: number): Observable<void> {
    return this.api.delete<void>(`/cfdi-mapping/rules/${id}`);
  }

  generarPropuesta(params: { rfc: string; ejercicio: number; periodo: number; tipoPropuesta?: string; tipoCfdi: 'I' | 'E' | 'P' }): Observable<PolizaPropuesta> {
    return this.api.post<PolizaPropuesta>('/cfdi-mapping/generar-propuesta', params);
  }

  generarYGuardar(params: { rfc: string; ejercicio: number; periodo: number; tipoPropuesta?: string; tipoCfdi: 'I' | 'E' | 'P' }): Observable<GenerarYGuardarResult> {
    return this.api.post<GenerarYGuardarResult>('/cfdi-mapping/generar-y-guardar', params);
  }

  balanceGeneral(params: { rfc: string; ejercicio: number; periodo: number }): Observable<BalanceGeneral> {
    const q = new URLSearchParams({
      rfc:       params.rfc,
      ejercicio: String(params.ejercicio),
      periodo:   String(params.periodo),
    });
    return this.api.get<BalanceGeneral>(`/cfdi-mapping/balance-general?${q}`);
  }

  migrarPpdDescuento(): Observable<MigrarPpdDescuentoResult> {
    return this.api.post<MigrarPpdDescuentoResult>('/cfdi-mapping/rules/migrar-ppd-descuento', {});
  }

  balanzaPreliminar(params: { rfc: string; ejercicio: number; periodo: number; tipoCfdi?: string }): Observable<BalanzaPreliminar> {
    const q = new URLSearchParams({
      rfc:       params.rfc,
      ejercicio: String(params.ejercicio),
      periodo:   String(params.periodo),
      ...(params.tipoCfdi ? { tipoCfdi: params.tipoCfdi } : {}),
    });
    return this.api.get<BalanzaPreliminar>(`/cfdi-mapping/balanza-preliminar?${q}`);
  }
}
