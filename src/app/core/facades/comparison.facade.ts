import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { ComparisonService } from '../services/comparison.service';
import {
  Comparison,
  ComparisonSession,
  Discrepancy,
  DashboardKPIs,
  PaginatedResponse,
  DiscrepanciaMontosResponse,
  CfdiStatusMismatchResponse,
  PagosRelacionadosStats,
} from '../models/cfdi.model';

/**
 * Facade para comparaciones, discrepancias, periodos fiscales,
 * sesiones, dashboard y reportes.
 * Consolida ComparisonService en un único punto de acceso para los componentes.
 */
@Injectable({ providedIn: 'root' })
export class ComparisonFacade {
  constructor(private comparisonService: ComparisonService) {}

  // ── Dashboard ──────────────────────────────────────────────────────────────

  getDashboard(ejercicio?: number, periodo?: number, tipoDeComprobante?: string, rfcEmisor?: string): Observable<{ kpis: DashboardKPIs; topDiscrepancyTypes: any[]; recentDiscrepancies: Discrepancy[] }> {
    const filters: Record<string, unknown> = {};
    if (ejercicio)         filters['ejercicio']         = ejercicio;
    if (periodo)           filters['periodo']           = periodo;
    if (tipoDeComprobante) filters['tipoDeComprobante'] = tipoDeComprobante;
    if (rfcEmisor)         filters['rfcEmisor']         = rfcEmisor;
    return this.comparisonService.getDashboard(filters);
  }

  // ── Comparaciones ──────────────────────────────────────────────────────────

  listComparisons(filters: Record<string, unknown> = {}): Observable<PaginatedResponse<Comparison>> {
    return this.comparisonService.listComparisons(filters);
  }

  runBatch(filters: Record<string, unknown> = {}, ejercicio?: number, periodo?: number, tipo?: string): Observable<any> {
    return this.comparisonService.runBatch(filters, ejercicio, periodo, tipo);
  }

  getSessionStatus(sessionId: string): Observable<{ session: ComparisonSession }> {
    return this.comparisonService.getSession(sessionId);
  }

  runBatchByUUIDs(uuids: string[]): Observable<any> {
    return this.comparisonService.runBatchByUUIDs(uuids);
  }

  resolve(id: string, resolutionNotes?: string): Observable<Comparison> {
    return this.comparisonService.resolve(id, resolutionNotes);
  }

  // ── Sesiones ───────────────────────────────────────────────────────────────

  listSessions(params: Record<string, unknown> = {}): Observable<PaginatedResponse<ComparisonSession>> {
    return this.comparisonService.listSessions(params);
  }

  getSession(id: string, params: Record<string, unknown> = {}): Observable<{ session: ComparisonSession; comparisons: PaginatedResponse<Comparison> }> {
    return this.comparisonService.getSession(id, params);
  }

  // ── Discrepancias ──────────────────────────────────────────────────────────

  listDiscrepancies(filters: Record<string, unknown> = {}): Observable<PaginatedResponse<Discrepancy>> {
    return this.comparisonService.listDiscrepancies(filters);
  }

  getDiscrepancySummary(): Observable<any> {
    return this.comparisonService.getDiscrepancySummary();
  }

  updateDiscrepancyStatus(id: string, status: string, resolutionType?: string, note?: string): Observable<Discrepancy> {
    return this.comparisonService.updateDiscrepancyStatus(id, status, resolutionType, note);
  }

  // ── Periodos fiscales ──────────────────────────────────────────────────────

  getPeriodos(): Observable<{ ejercicios: number[]; periodos: unknown[] }> {
    return this.comparisonService.getPeriodos();
  }

  listPeriodosFiscales(): Observable<{ data: any[] }> {
    return this.comparisonService.listPeriodosFiscales();
  }

  createPeriodoFiscal(ejercicio: number, periodo: number | null, label?: string): Observable<any> {
    return this.comparisonService.createPeriodoFiscal(ejercicio, periodo, label);
  }

  deletePeriodoFiscal(id: number): Observable<any> {
    return this.comparisonService.deletePeriodoFiscal(id);
  }

  // ── Reportes ───────────────────────────────────────────────────────────────

  exportExcel(filters: Record<string, unknown> = {}): Observable<Blob> {
    return this.comparisonService.exportExcel(filters);
  }

  getDiscrepanciasMontos(ejercicio?: number, periodo?: number, tipoDeComprobante?: string, campos?: string, rfcEmisor?: string): Observable<DiscrepanciaMontosResponse> {
    const filters: Record<string, unknown> = {};
    if (ejercicio)         filters['ejercicio']         = ejercicio;
    if (periodo)           filters['periodo']           = periodo;
    if (tipoDeComprobante) filters['tipoDeComprobante'] = tipoDeComprobante;
    if (rfcEmisor)         filters['rfcEmisor']         = rfcEmisor;
    return this.comparisonService.getDiscrepanciasMontos(filters, campos);
  }

  getSatVigenteErpInactivo(ejercicio?: number, periodo?: number, tipoDeComprobante?: string, rfcEmisor?: string): Observable<CfdiStatusMismatchResponse> {
    const filters: Record<string, unknown> = {};
    if (ejercicio)         filters['ejercicio']         = ejercicio;
    if (periodo)           filters['periodo']           = periodo;
    if (tipoDeComprobante) filters['tipoDeComprobante'] = tipoDeComprobante;
    if (rfcEmisor)         filters['rfcEmisor']         = rfcEmisor;
    return this.comparisonService.getSatVigenteErpInactivo(filters);
  }

  getDiscrepanciasCriticas(ejercicio?: number, periodo?: number, tipoDeComprobante?: string, rfcEmisor?: string): Observable<any> {
    const filters: Record<string, unknown> = {};
    if (ejercicio)         filters['ejercicio']         = ejercicio;
    if (periodo)           filters['periodo']           = periodo;
    if (tipoDeComprobante) filters['tipoDeComprobante'] = tipoDeComprobante;
    if (rfcEmisor)         filters['rfcEmisor']         = rfcEmisor;
    return this.comparisonService.getDiscrepanciasCriticas(filters);
  }

  getNotInErp(ejercicio?: number, periodo?: number, tipoDeComprobante?: string, rfcEmisor?: string): Observable<{ items: any[]; total: number }> {
    const filters: Record<string, unknown> = {};
    if (ejercicio)         filters['ejercicio']         = ejercicio;
    if (periodo)           filters['periodo']           = periodo;
    if (tipoDeComprobante) filters['tipoDeComprobante'] = tipoDeComprobante;
    if (rfcEmisor)         filters['rfcEmisor']         = rfcEmisor;
    return this.comparisonService.getNotInErp(filters);
  }

  getPagosRelacionados(ejercicio?: number, periodo?: number, rfcEmisor?: string): Observable<PagosRelacionadosStats> {
    const filters: Record<string, unknown> = {};
    if (ejercicio) filters['ejercicio'] = ejercicio;
    if (periodo)   filters['periodo']   = periodo;
    if (rfcEmisor) filters['rfcEmisor'] = rfcEmisor;
    return this.comparisonService.getPagosRelacionados(filters);
  }

  getConciliacionExcel(ejercicio?: number, periodo?: number, rfcEmisor?: string): Observable<Blob> {
    const filters: Record<string, unknown> = {};
    if (ejercicio) filters['ejercicio'] = ejercicio;
    if (periodo)   filters['periodo']   = periodo;
    if (rfcEmisor) filters['rfcEmisor'] = rfcEmisor;
    return this.comparisonService.getConciliacionExcel(filters);
  }
}
