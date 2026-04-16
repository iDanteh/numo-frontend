import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiService } from './api.service';

export type BankStatus = 'no_identificado' | 'identificado' | 'otros';

export interface ErpLink {
  erpId:       string;
  saldoActual: number;
  total:       number;
  folioFiscal: string | null;
}

export interface BankMovement {
  _id:                string;
  banco:              'Banamex' | 'BBVA' | 'Santander' | 'Azteca';
  fecha:              string;
  concepto:           string;
  deposito:           number | null;
  retiro:             number | null;
  saldo:              number | null;
  numeroAutorizacion: string | null;
  referenciaNumerica: string | null;
  status:             BankStatus;
  categoria:          string | null;
  folio:              string | null;
  uuidXML:            string | null;
  erpIds:             string[];
  erpLinks:           ErpLink[];
  saldoErp:           number | null;
  identificadoPor:    { userId: string | null; nombre: string | null; fechaId: string | null } | null;
  createdAt:          string;
}

export interface BankCard {
  banco:           string;
  movimientos:     number;
  totalDepositos:  number;
  totalRetiros:    number;
  saldoFinal:      number | null;
  saldoPendiente:    number;
  saldoIdentificado: number;
  saldoOtros:        number;
  ultimaFecha:     string | null;
  ultimaImport:    string | null;
  cuentaContable:  string | null;
  numeroCuenta:    string | null;
  porStatus: {
    no_identificado: number;
    identificado:    number;
    otros:           number;
  };
}

export interface BankConfig {
  banco:          string;
  cuentaContable: string | null;
  numeroCuenta:   string | null;
}

export interface BankSummaryItem {
  _id:            string;
  totalDepositos: number;
  totalRetiros:   number;
  movimientos:    number;
  saldoFinal:     number | null;
}

export interface BankFilter {
  page?:        number;
  limit?:       number;
  banco?:       string;
  fechaInicio?: string;
  fechaFin?:    string;
  tipo?:        string;
  search?:      string;
  concepto?:        string;
  identificadoPor?: string;
  sortBy?:          string;
  sortDir?:     string;
  status?:      string;
  categorias?:  string;   // comma-separated; __null__ = sin categoría
  movId?:       string;   // saltar a movimiento específico (OCR)
}

export interface ErpCxC {
  id:               string;
  serie:            string;
  folio:            string;
  tipoPago:         string | null;
  subtotal:         number;
  impuesto:         number;
  total:            number;
  saldoActual:      number;
  fechaVencimiento: string | null;
  folioFiscal?:     string | null;
}

export interface AuxClienteSummary {
  _id:            string;   // auxNombre
  movimientos:    number;
  totalDepositos: number;
  totalRetiros:   number;
  bancos:         string[];
  ultimaFecha:    string | null;
}

export interface AuxApplyResult {
  limpiados:    number;
  actualizados: number;
  noEncontrados: number;
  total:        number;
}

export type RuleCampo    = 'concepto' | 'deposito' | 'retiro' | 'referenciaNumerica' | 'numeroAutorizacion';
export type RuleOperador = 'contiene' | 'no_contiene' | 'igual' | 'empieza_con' | 'termina_con' | 'mayor_que' | 'menor_que' | 'mayor_igual' | 'menor_igual';

export interface BankRuleCondicion {
  campo:    RuleCampo;
  operador: RuleOperador;
  valor:    string;
}

export interface BankRule {
  _id:         string;
  banco:       string;
  nombre:      string;
  condiciones: BankRuleCondicion[];
  logica:      'Y' | 'O';
  orden:       number;
  createdAt:   string;
}

export interface UploadResult {
  message:      string;
  importados:   number;
  duplicados:   number;
  categorizados?: number;
  sinReglas?:   boolean;
  resumen:      Record<string, number>;
  erroresHojas: { hoja: string; error: string }[];
}

@Injectable({ providedIn: 'root' })
export class BankService {
  constructor(private api: ApiService) {}

  cards(): Observable<BankCard[]> {
    return this.api.get('/banks/cards');
  }

  upload(file: File, banco?: string): Observable<UploadResult> {
    const extra = banco ? { banco } : undefined;
    return this.api.uploadFiles<UploadResult>('/banks/upload', [file], 'excelFile', extra);
  }

  list(filters: BankFilter): Observable<{ data: BankMovement[]; pagination: any }> {
    return this.api.get('/banks/movements', filters as Record<string, unknown>);
  }

  summary(fechaInicio?: string, fechaFin?: string): Observable<BankSummaryItem[]> {
    const params: Record<string, unknown> = {};
    if (fechaInicio) params['fechaInicio'] = fechaInicio;
    if (fechaFin)    params['fechaFin']    = fechaFin;
    return this.api.get('/banks/summary', params);
  }

  updateStatus(id: string, status: BankStatus): Observable<{ _id: string; status: BankStatus; identificadoPor: { userId: string | null; nombre: string | null; fechaId: string | null } | null }> {
    return this.api.patch(`/banks/movements/${id}/status`, { status });
  }

  removeErpId(id: string, erpId: string): Observable<{ _id: string; erpIds: string[]; erpLinks: ErpLink[]; saldoErp: number | null; uuidXML: string | null; status: BankStatus; identificadoPor: { userId: string | null; nombre: string | null; fechaId: string | null } | null }> {
    return this.api.patch(`/banks/movements/${id}/erp-ids`, { action: 'remove', erpId });
  }

  setErpIds(id: string, erpLinks: ErpLink[]): Observable<{ _id: string; erpIds: string[]; erpLinks: ErpLink[]; saldoErp: number | null; uuidXML: string | null; status: BankStatus; identificadoPor: { userId: string | null; nombre: string | null; fechaId: string | null } | null }> {
    return this.api.put(`/banks/movements/${id}/erp-ids`, { erpLinks });
  }

  getBankConfig(banco: string): Observable<BankConfig> {
    return this.api.get(`/banks/config/${banco}`);
  }

  saveBankConfig(banco: string, data: Partial<Pick<BankConfig, 'cuentaContable' | 'numeroCuenta'>>): Observable<BankConfig> {
    return this.api.patch(`/banks/config/${banco}`, data);
  }

  importAuxiliar(file: File): Observable<{ importados: number; actualizados: number; omitidos: number; errores: string[]; total: number }> {
    return this.api.uploadFiles('/banks/auxiliar/import', [file], 'excelFile');
  }

  aplicarAuxiliar(): Observable<AuxApplyResult> {
    return this.api.post('/banks/auxiliar/aplicar', {});
  }

  listAuxClientes(params?: Record<string, unknown>): Observable<AuxClienteSummary[]> {
    return this.api.get('/banks/auxiliar/clientes', params);
  }

  listAuxMovimientos(params?: Record<string, unknown>): Observable<{ data: BankMovement[]; pagination: any }> {
    return this.api.get('/banks/auxiliar/movimientos', params);
  }

  listCategories(banco: string): Observable<(string | null)[]> {
    return this.api.get('/banks/categories', { banco });
  }

  listRules(banco: string): Observable<BankRule[]> {
    return this.api.get('/banks/rules', { banco });
  }

  createRule(banco: string, data: Omit<BankRule, '_id' | 'banco' | 'createdAt'>): Observable<BankRule> {
    return this.api.post('/banks/rules', { banco, ...data });
  }

  updateRule(id: string, data: Omit<BankRule, '_id' | 'banco' | 'createdAt'>): Observable<BankRule> {
    return this.api.put(`/banks/rules/${id}`, data);
  }

  deleteRule(id: string): Observable<{ deleted: boolean }> {
    return this.api.delete(`/banks/rules/${id}`);
  }

  applyRules(banco: string, soloSinCategoria = false): Observable<{ actualizados: number; sinCambio: number }> {
    return this.api.post('/banks/rules/apply', { banco, soloSinCategoria });
  }

  matchAutorizaciones(file: File): Observable<{
    total: number; matcheados: number; identificados: number; sinMatch: number;
    noMatcheados: { autorizacion: string; importe: number; banco: string | null }[];
  }> {
    return this.api.uploadFiles('/banks/autorizaciones/match', [file], 'excelFile');
  }

  listErpCuentas(fechaDesde: string, fechaHasta: string, soloXPendientes = true): Observable<ErpCxC[]> {
    const params: Record<string, unknown> = { fechaDesde, fechaHasta };
    if (soloXPendientes) params['estadoCobro'] = 'pendiente';
    return this.api.get('/erp/cuentas-pendientes', params);
  }

  exportMovements(filters: BankFilter): Observable<Blob> {
    return this.api.downloadBlob('/banks/movements/export', filters as Record<string, unknown>);
  }

  matchErp(): Observable<{ matched: number; message: string }> {
    return this.api.post('/erp/match', {});
  }

  revertMatchErp(): Observable<{ reverted: number; message: string }> {
    return this.api.post('/erp/match/revert', {});
  }

}
