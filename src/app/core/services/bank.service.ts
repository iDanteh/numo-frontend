import { Injectable } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Observable } from 'rxjs';
import { ApiService } from './api.service';

export * from '../models/bank.model';
import {
  BankCard, BankStatusStats, UploadResult, BankFilter, BankMovement, BankStatus,
  IdentificadoPorEntry, ErpLink, BankConfig, BankIdentificador, ErpFormaPago,
  SesionCajaResult, CobroBanco, CobroConcepto, AplicarCobroPayload, AplicarCobroResult,
  AplicarCobroPayloadMulti, ErpSaldoFavor, UpdateMovementDto, BankRule,
  RefacturacionesCycResult, MostradorCycResult, PagosCycResult, ErpCxC, DuplicatesResult,
  KoreCuentaPPD, SaldoSyncJobResult, SaldoSyncJobSummary,
} from '../models/bank.model';

@Injectable({ providedIn: 'root' })
export class BankService {
  constructor(private api: ApiService, private http: HttpClient) {}

  private koreHeaders(): HttpHeaders {
    const token = localStorage.getItem('numo_kore_token') ?? '';
    return new HttpHeaders({ 'X-Kore-Token': token });
  }

  cards(): Observable<BankCard[]> {
    return this.api.get('/banks/cards');
  }

  statusStats(year?: number | null, month?: number | null): Observable<BankStatusStats> {
    const params: Record<string, unknown> = {};
    if (year  != null) params['year']  = year;
    if (month != null) params['month'] = month;
    return this.api.get('/banks/stats', params);
  }

  upload(file: File, banco?: string): Observable<UploadResult> {
    const extra = banco ? { banco } : undefined;
    return this.api.uploadFiles<UploadResult>('/banks/upload', [file], 'excelFile', extra);
  }

  downloadTemplate(): Observable<Blob> {
    return this.api.downloadBlob('/banks/template');
  }

  list(filters: BankFilter): Observable<{ data: BankMovement[]; pagination: any }> {
    return this.api.get('/banks/movements', filters as Record<string, unknown>);
  }

  updateStatus(id: string, status: BankStatus): Observable<{ _id: string; status: BankStatus; identificadoPor: IdentificadoPorEntry[] }> {
    return this.api.patch(`/banks/movements/${id}/status`, { status });
  }

  removeErpId(id: string, erpId: string): Observable<{ _id: string; erpIds: string[]; erpLinks: ErpLink[]; saldoErp: number | null; uuidXML: string | null; status: BankStatus; identificadoPor: IdentificadoPorEntry[] }> {
    return this.api.patch(`/banks/movements/${id}/erp-ids`, { action: 'remove', erpId });
  }

  setErpIds(id: string, erpLinks: ErpLink[]): Observable<{ _id: string; erpIds: string[]; erpLinks: ErpLink[]; saldoErp: number | null; uuidXML: string | null; status: BankStatus; identificadoPor: IdentificadoPorEntry[] }> {
    return this.api.put(`/banks/movements/${id}/erp-ids`, { erpLinks });
  }

  getBankConfig(banco: string): Observable<BankConfig> {
    return this.api.get(`/banks/config/${banco}`);
  }

  saveBankConfig(banco: string, data: Partial<Pick<BankConfig, 'cuentaContable' | 'numeroCuenta'>>): Observable<BankConfig> {
    return this.api.patch(`/banks/config/${banco}`, data);
  }

  setSaldoInicial(banco: string, monto: number): Observable<{ banco: string; saldoInicial: number; saldoInicialFechaCorte: string }> {
    return this.api.post(`/banks/config/${banco}/saldo-inicial`, { monto });
  }

  listCategories(banco?: string): Observable<(string | null)[]> {
    return this.api.get('/banks/categories', banco ? { banco } : {});
  }

  listIdentificadores(banco?: string): Observable<BankIdentificador[]> {
    return this.api.get('/banks/identificadores', banco ? { banco } : {});
  }

  getFormasPago(): Observable<ErpFormaPago[]> {
    return this.http.get<ErpFormaPago[]>(`${this.api.base}/erp/formas-pago`, { headers: this.koreHeaders() });
  }

  verificarSesionCaja(): Observable<SesionCajaResult> {
    return this.api.get<SesionCajaResult>('/erp/cobros/sesion-caja');
  }

  getCobroBancos(): Observable<CobroBanco[]> {
    return this.http.get<CobroBanco[]>(`${this.api.base}/erp/cobros/bancos`, { headers: this.koreHeaders() });
  }

  getCobroConceptos(): Observable<CobroConcepto[]> {
    return this.http.get<CobroConcepto[]>(`${this.api.base}/erp/cobros/conceptos`, { headers: this.koreHeaders() });
  }

  aplicarCobroOperacion(sesionId: string, payload: AplicarCobroPayload): Observable<AplicarCobroResult> {
    return this.http.post<AplicarCobroResult>(
      `${this.api.base}/erp/cobros/operacion/${sesionId}`,
      payload,
      { headers: this.koreHeaders() },
    );
  }

  aplicarCobroOperacionMultiple(sesionId: string, payload: AplicarCobroPayloadMulti): Observable<AplicarCobroResult> {
    return this.http.post<AplicarCobroResult>(
      `${this.api.base}/erp/cobros/operacion-multiple/${sesionId}`,
      payload,
      { headers: this.koreHeaders() },
    );
  }

  getSaldosAFavor(personaId: string, tipo: 'saldo_favor' | 'compensacion' | 'anticipo'): Observable<ErpSaldoFavor[]> {
    return this.http.get<ErpSaldoFavor[]>(
      `${this.api.base}/erp/cobros/saldos-favor/${encodeURIComponent(personaId)}`,
      { headers: this.koreHeaders(), params: { tipo } },
    );
  }

  buscarSaldosPorFolio(serie: string, folio: string, esAnticipo: boolean): Observable<ErpSaldoFavor[]> {
    return this.http.get<ErpSaldoFavor[]>(
      `${this.api.base}/erp/cobros/saldos-favor/buscar`,
      { headers: this.koreHeaders(), params: { serie, folio, esAnticipo: String(esAnticipo) } },
    );
  }

  getCuentasPPD(ids: string[]): Observable<KoreCuentaPPD[]> {
    return this.http.get<KoreCuentaPPD[]>(
      `${this.api.base}/erp/cobros/cuentas`,
      { headers: this.koreHeaders(), params: { ids: ids.join(',') } },
    );
  }

  listRules(banco: string): Observable<BankRule[]> {
    return this.api.get('/banks/rules', { banco });
  }

  createRule(banco: string, data: Omit<BankRule, '_id' | 'banco' | 'createdAt'>): Observable<BankRule> {
    return this.api.post('/banks/rules', { banco, ...data });
  }

  updateRule(id: string, data: Omit<BankRule, '_id' | 'banco' | 'createdAt'>): Observable<BankRule & { movSincronizados?: number }> {
    return this.api.put(`/banks/rules/${id}`, data);
  }

  deleteRule(id: string): Observable<{ deleted: boolean; movRevertidos?: number }> {
    return this.api.delete(`/banks/rules/${id}`);
  }

  reorderRules(ids: string[]): Observable<{ ok: boolean }> {
    return this.api.put('/banks/rules/reorder', { ids: ids.map(Number) });
  }

  applyRules(banco: string, soloSinCategoria = false): Observable<{ actualizados: number; sinCambio: number }> {
    return this.api.post('/banks/rules/apply', { banco, soloSinCategoria });
  }

  matchAutorizaciones(file: File): Observable<{
    total: number; matcheados: number; identificados: number;
    yaIdentificados: number; sinMatch: number;
    noMatcheados:   { autorizacion: string; importe: number; banco: string | null }[];
    matcheadosList: { autorizacion: string; importe: number | null; banco: string | null; estado: string }[];
  }> {
    return this.api.uploadFiles('/banks/autorizaciones/match', [file], 'excelFile');
  }

  uploadRefacturacionesCyc(file: File): Observable<RefacturacionesCycResult> {
    return this.api.uploadFiles<RefacturacionesCycResult>(
      '/erp/refacturaciones-cyc/upload', [file], 'excelFile',
    );
  }

  uploadMostradorCyc(file: File): Observable<MostradorCycResult> {
    return this.api.uploadFiles<MostradorCycResult>(
      '/erp/mostrador-cyc/upload', [file], 'excelFile',
    );
  }

  exportMostradorCyc(resultado: MostradorCycResult): Observable<Blob> {
    return this.api.downloadBlobPost('/erp/mostrador-cyc/export', resultado);
  }

  uploadPagosCyc(file: File): Observable<PagosCycResult> {
    return this.api.uploadFiles<PagosCycResult>(
      '/erp/pagos-cyc/upload', [file], 'excelFile',
    );
  }

  exportPagosCyc(resultado: PagosCycResult): Observable<Blob> {
    return this.api.downloadBlobPost('/erp/pagos-cyc/export', resultado);
  }

  listErpCuentas(
    fechaDesde: string,
    fechaHasta: string,
    soloXPendientes = true,
    page = 1,
    serieExterna = '',
    folioExterno = '',
    nombrePersona = '',
  ): Observable<{ data: ErpCxC[]; pagination: { page: number; totalPaginas: number; total: number } }> {
    const params: Record<string, unknown> = { fechaDesde, fechaHasta, page };
    if (soloXPendientes)       params['estadoCobro']    = 'pendiente';
    if (serieExterna.trim())   params['serieExterna']   = serieExterna.trim();
    if (folioExterno.trim())   params['folioExterno']   = folioExterno.trim();
    if (nombrePersona.trim())  params['nombrePersona']  = nombrePersona.trim();
    return this.api.get('/erp/cuentas-pendientes', params);
  }

  exportMovements(filters: BankFilter): Observable<Blob> {
    return this.api.downloadBlob('/banks/movements/export', filters as Record<string, unknown>);
  }

  matchAutorizacionesErp(banco?: string): Observable<{ jobId: string }> {
    return this.api.post('/banks/autorizaciones/match-erp', banco ? { banco } : {});
  }

  syncSaldoTransferencia(fechaDesde?: string, fechaHasta?: string): Observable<{ jobId: string }> {
    const body: Record<string, string> = {};
    if (fechaDesde) body['fechaDesde'] = fechaDesde;
    if (fechaHasta) body['fechaHasta'] = fechaHasta;
    return this.api.post('/erp/sync-saldo-transferencia', body);
  }

  getSaldoSyncDefaults(): Observable<{ fechaDesde: string; fechaHasta: string }> {
    return this.api.get('/erp/sync-saldo-transferencia/defaults');
  }

  pauseSyncSaldo():  Observable<{ ok: boolean }> { return this.api.post('/erp/sync-saldo-transferencia/pause',  {}); }
  resumeSyncSaldo(): Observable<{ ok: boolean }> { return this.api.post('/erp/sync-saldo-transferencia/resume', {}); }
  stopSyncSaldo():   Observable<{ ok: boolean }> { return this.api.post('/erp/sync-saldo-transferencia/stop',   {}); }

  downloadSaldoSyncReport(jobId: string): Observable<Blob> {
    return this.api.downloadBlob(`/erp/sync-saldo-transferencia/${jobId}/report`);
  }

  getSaldoSyncJob(jobId: string): Observable<{
    status: 'running' | 'paused' | 'done' | 'stopped' | 'error';
    result?: SaldoSyncJobResult;
    error?: string;
  }> {
    return this.api.get(`/erp/sync-saldo-transferencia/${jobId}/status`);
  }

  getSaldoSyncJobs(): Observable<SaldoSyncJobSummary[]> {
    return this.api.get('/erp/sync-saldo-transferencia/jobs');
  }

  revertSaldoSync(jobId: string): Observable<{
    ok: boolean; matched: number; revertidos: number; omitidosPorCorridaMasReciente: number;
  }> {
    return this.api.post(`/erp/sync-saldo-transferencia/${jobId}/revert`, {});
  }

  getMatchErpJob(jobId: string): Observable<{ status: string; result?: unknown; error?: string }> {
    return this.api.get(`/banks/autorizaciones/match-erp/job/${jobId}`);
  }

  revertMatchErp(): Observable<{ reverted: number; message: string }> {
    return this.api.post('/erp/match/revert', {});
  }

  identificarAnterioresAMayo(): Observable<{ marcados: number; message: string }> {
    return this.api.post('/banks/admin/identificar-anteriores', {});
  }

  revertirAnterioresAMayo(): Observable<{ revertidos: number; message: string }> {
    return this.api.post('/banks/admin/revertir-anteriores', {});
  }

  importarConciliacion(file: File): Observable<{
    runId:           string;
    total:           number;
    identificados:   number;
    fallidos:        number;
    fallidosDetalle: { fecha: string; banco: string; monto: number }[];
  }> {
    return this.api.uploadFiles('/banks/admin/importar-conciliacion', [file], 'excelFile');
  }

  revertirConciliacion(runId: string): Observable<{ revertidos: number; message: string }> {
    return this.api.post('/banks/admin/revertir-conciliacion', { runId });
  }

  deleteMovements(ids: string[]): Observable<{ deleted: number }> {
    return this.api.deleteWithBody<{ deleted: number }>('/banks/movements', { ids });
  }

  reclasifyMovements(ids: string[]): Observable<{ reclasified: number }> {
    return this.api.patch<{ reclasified: number }>('/banks/movements/reclasify', { ids });
  }

  updateMovement(id: string, data: UpdateMovementDto): Observable<UpdateMovementDto & { _id: string; banco: string }> {
    return this.api.patch(`/banks/movements/${id}`, data as Record<string, unknown>);
  }

  updateCategoria(id: string, categoria: string | null): Observable<{ _id: string; banco: string; categoria: string | null; status: BankStatus }> {
    return this.api.patch(`/banks/movements/${id}/categoria`, { categoria });
  }

  setFicha(id: string, ficha: string): Observable<{ _id: string; status: BankStatus; ficha: string; fichaBy: string | null; fichaNombre: string | null; fichaAt: string | null }> {
    return this.api.patch(`/banks/movements/${id}/ficha`, { ficha });
  }

  deleteFicha(id: string): Observable<{ _id: string; status: BankStatus; ficha: null; fichaBy: null; fichaNombre: null; fichaAt: null }> {
    return this.api.delete(`/banks/movements/${id}/ficha`);
  }

  findDuplicates(): Observable<DuplicatesResult> {
    return this.api.get('/banks/duplicates');
  }

}
