import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiService } from './api.service';
import { Comparison, ComparisonSession, Discrepancy, PaginatedResponse, DashboardKPIs, DiscrepanciaMontosResponse, CfdiStatusMismatchResponse, PagosRelacionadosStats } from '../models/cfdi.model';

@Injectable({ providedIn: 'root' })
export class ComparisonService {
  constructor(private api: ApiService) {}

  listComparisons(filters: Record<string, unknown> = {}): Observable<PaginatedResponse<Comparison>> {
    return this.api.get<PaginatedResponse<Comparison>>('/comparisons', filters);
  }

  getComparison(id: string): Observable<Comparison> {
    return this.api.get<Comparison>(`/comparisons/${id}`);
  }

  getStats(): Observable<{ total: number; byStatus: any[] }> {
    return this.api.get('/comparisons/stats');
  }

  runBatch(filters: Record<string, unknown> = {}, ejercicio?: number, periodo?: number, tipo?: string): Observable<any> {
    const body: Record<string, unknown> = { filters };
    if (ejercicio) body['ejercicio'] = ejercicio;
    if (periodo)   body['periodo']   = periodo;
    if (tipo)      body['filters']   = { ...filters, tipoDeComprobante: tipo };
    return this.api.post('/comparisons/batch', body);
  }

  getPeriodos(): Observable<{ periodos: { ejercicio: number; periodo: number }[]; ejercicios: number[] }> {
    return this.api.get('/comparisons/periodos');
  }

  getEjerciciosResumen(): Observable<{ data: any[] }> {
    return this.api.get('/comparisons/ejercicios/resumen');
  }

  listPeriodosFiscales(): Observable<{ data: any[] }> {
    return this.api.get('/periodos-fiscales');
  }

  createPeriodoFiscal(ejercicio: number, periodo: number | null, label?: string): Observable<any> {
    return this.api.post('/periodos-fiscales', { ejercicio, periodo, label });
  }

  deletePeriodoFiscal(id: number): Observable<any> {
    return this.api.delete(`/periodos-fiscales/${id}`);
  }

  runBatchByUUIDs(uuids: string[]): Observable<any> {
    return this.api.post('/comparisons/batch', { uuids });
  }

  listSessions(params: Record<string, unknown> = {}): Observable<PaginatedResponse<ComparisonSession>> {
    return this.api.get<PaginatedResponse<ComparisonSession>>('/comparisons/sessions', params);
  }

  getSession(id: string, params: Record<string, unknown> = {}): Observable<{ session: ComparisonSession; comparisons: PaginatedResponse<Comparison> }> {
    return this.api.get(`/comparisons/sessions/${id}`, params);
  }

  resolve(id: string, resolutionNotes?: string): Observable<Comparison> {
    return this.api.patch<Comparison>(`/comparisons/${id}/resolve`, { resolutionNotes });
  }

  listDiscrepancies(filters: Record<string, unknown> = {}): Observable<PaginatedResponse<Discrepancy>> {
    return this.api.get<PaginatedResponse<Discrepancy>>('/discrepancies', filters);
  }

  getDiscrepancySummary(): Observable<any> {
    return this.api.get('/discrepancies/summary');
  }

  updateDiscrepancyStatus(id: string, status: string, resolutionType?: string, note?: string): Observable<Discrepancy> {
    return this.api.patch<Discrepancy>(`/discrepancies/${id}/status`, { status, resolutionType, note });
  }

  getDashboard(filters: Record<string, unknown> = {}): Observable<{ kpis: DashboardKPIs; topDiscrepancyTypes: any[]; recentDiscrepancies: Discrepancy[] }> {
    return this.api.get('/reports/dashboard', filters);
  }

  exportExcel(filters: Record<string, unknown> = {}): Observable<Blob> {
    return this.api.downloadBlob('/reports/export/excel', filters);
  }

  getSatVigenteErpInactivo(filters: Record<string, unknown> = {}): Observable<CfdiStatusMismatchResponse> {
    return this.api.get<CfdiStatusMismatchResponse>('/reports/sat-vigente-erp-inactivo', filters);
  }

  getDiscrepanciasMontos(filters: Record<string, unknown> = {}, campos?: string, limit = 500): Observable<DiscrepanciaMontosResponse> {
    const params = { ...filters, limit, ...(campos ? { campos } : {}) };
    return this.api.get<DiscrepanciaMontosResponse>('/reports/discrepancias-montos', params);
  }

  getDiscrepanciasCriticas(filters: Record<string, unknown> = {}, limit = 500): Observable<DiscrepanciaMontosResponse & { porStatus: Record<string, number> }> {
    return this.api.get('/reports/discrepancias-criticas', { ...filters, limit });
  }

  getNotInErp(filters: Record<string, unknown> = {}, limit = 500): Observable<{ items: any[]; total: number }> {
    return this.api.get('/reports/not-in-erp', { ...filters, limit });
  }

  getPagosRelacionados(filters: Record<string, unknown> = {}): Observable<PagosRelacionadosStats> {
    return this.api.get<PagosRelacionadosStats>('/reports/pagos-relacionados', filters);
  }
}
