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
  KoreCuentaPPD, ErpSyncJobResult, ErpSyncJobSummary, CfdiBusquedaResult,
  ErpReversion, FormasPagoCxcResult,
  BankIndicadoresIdentificacion,
  ResultadoTraspasosInternos,
} from '../models/bank.model';

@Injectable({ providedIn: 'root' })
export class BankService {
  constructor(private api: ApiService, private http: HttpClient) {}

  private koreHeaders(): HttpHeaders {
    const token = localStorage.getItem('numo_kore_token') ?? '';
    return new HttpHeaders({ 'X-Kore-Token': token });
  }

  cards(year?: number | null, month?: number | null): Observable<BankCard[]> {
    const params: Record<string, unknown> = {};
    if (year  != null) params['year']  = year;
    if (month != null) params['month'] = month;
    return this.api.get('/banks/cards', params);
  }

  statusStats(year?: number | null, month?: number | null, banco?: string | null): Observable<BankStatusStats> {
    const params: Record<string, unknown> = {};
    if (year  != null) params['year']  = year;
    if (month != null) params['month'] = month;
    if (banco)         params['banco'] = banco;
    return this.api.get('/banks/stats', params);
  }

  // 2026-07-31: separado de statusStats() — el dashboard solo necesitaba la lista de años y
  // pagaba la agregación completa de /stats para descartar todo lo demás. Acepta banco para que
  // el combo no ofrezca años sin datos para el banco filtrado.
  years(banco?: string | null): Observable<{ years: number[] }> {
    const params: Record<string, unknown> = {};
    if (banco) params['banco'] = banco;
    return this.api.get('/banks/years', params);
  }

  indicadores(
    banco?: string | null,
    categoria?: string | null,
    year?: number | null,
    month?: number | null,
  ): Observable<BankIndicadoresIdentificacion> {
    const params: Record<string, unknown> = {};
    if (banco)         params['banco']     = banco;
    if (categoria)     params['categoria'] = categoria;
    if (year  != null) params['year']      = year;
    if (month != null) params['month']     = month;
    return this.api.get('/banks/indicadores', params);
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

  uploadFormasPagoCxc(file: File): Observable<FormasPagoCxcResult> {
    return this.api.uploadFiles<FormasPagoCxcResult>(
      '/erp/formas-pago-cxc/upload', [file], 'excelFile',
    );
  }

  exportFormasPagoCxc(resultado: FormasPagoCxcResult): Observable<Blob> {
    return this.api.downloadBlobPost('/erp/formas-pago-cxc/export', resultado);
  }

  listErpCuentas(
    fechaDesde: string,
    fechaHasta: string,
    soloXPendientes = true,
    page = 1,
    serieExterna = '',
    folioExterno = '',
    nombrePersona = '',
    soloAnticipos = false,
  ): Observable<{ data: ErpCxC[]; pagination: { page: number; totalPaginas: number; total: number } }> {
    const params: Record<string, unknown> = { fechaDesde, fechaHasta, page };
    if (soloXPendientes)       params['estadoCobro']    = 'pendiente';
    if (serieExterna.trim())   params['serieExterna']   = serieExterna.trim();
    if (folioExterno.trim())   params['folioExterno']   = folioExterno.trim();
    if (nombrePersona.trim())  params['nombrePersona']  = nombrePersona.trim();
    if (soloAnticipos)         params['origen']         = 'anticipo';
    return this.api.get('/erp/cuentas-pendientes', params);
  }

  // Resuelve UNA CxC puntual contra Kore por serie+folio exactos — segunda parte del
  // buscador de CFDI del modal ERP (2026-08-07): el CFDI trae el total de la factura,
  // nunca el saldo pendiente en vivo, así que antes de "vincular" hay que traer el dato
  // fresco de Kore (mismo criterio que refrescarErpLink, sin necesitar un erpId ya
  // vinculado). 404 si Kore no la tiene disponible (ya cobrada por completo, etc.).
  resolverCuentaPorSerieFolio(serie: string, folio: string): Observable<ErpCxC> {
    return this.api.get<ErpCxC>('/erp/cuenta-por-serie-folio', { serie, folio });
  }

  // Refresca UNA sola CxC contra Kore bajo demanda — fix 2026-07-28 (folio 036789):
  // erpLinks[].saldoActual quedaba congelado desde la vinculación y nunca se enteraba de
  // que Kore reabrió el saldo después, haciendo que "Aplicar cobro" excluyera la CxC por
  // completo (se veía en blanco). Se llama justo antes de abrir "Vincular CxC del
  // ERP"/"Aplicar cobro" para cada CxC ya vinculada, sin esperar al cron ni al botón masivo.
  refrescarErpLink(movementId: string, erpId: string): Observable<{ ok: boolean; erpId: string; link: ErpLink }> {
    return this.api.post(`/erp/erp-links/${erpId}/refrescar`, { movementId });
  }

  // ── Reversiones CxC (Kore) ────────────────────────────────────────────────
  // Bandeja de auditoría de reversiones que Kore aplicó vía webhook sobre CxC ya
  // vinculadas (ver erp-reversion.routes.js) — permiso propio banks:erp:reversiones
  // (2026-08-10), independiente de banks:erp:unlink.
  listarReversiones(
    page = 1,
    opts?: { estado?: string; q?: string },
  ): Observable<{ data: ErpReversion[]; pagination: { page: number; totalPaginas: number; total: number } }> {
    const params: Record<string, unknown> = { page };
    if (opts?.estado) params['estado'] = opts.estado;
    if (opts?.q)      params['q']      = opts.q;
    return this.api.get('/erp/cxc-reversiones', params);
  }

  exportMovements(filters: BankFilter): Observable<Blob> {
    return this.api.downloadBlob('/banks/movements/export', filters as Record<string, unknown>);
  }

  matchAutorizacionesErp(banco?: string): Observable<{ jobId: string }> {
    return this.api.post('/banks/autorizaciones/match-erp', banco ? { banco } : {});
  }

  // ── Sync ERP-Kore — job único de conciliación (reemplaza Sync Saldo ERP + Sync
  // Histórico Kore, fusionados el 2026-07-09). Sin rango de fechas por defecto: procesa
  // todo lo aún no finalizado; el admin puede escribir un rango para acotar una corrida.
  syncErpKore(fechaDesde?: string, fechaHasta?: string): Observable<{ jobId: string }> {
    const body: Record<string, string> = {};
    if (fechaDesde) body['fechaDesde'] = fechaDesde;
    if (fechaHasta) body['fechaHasta'] = fechaHasta;
    return this.api.post('/erp/sync-erp-kore', body);
  }

  // Backfill unificado (antes dos scripts CLI separados) — refresca movimientosKore y
  // recalcula saldoErpAportado con el criterio de "todas las formas de pago" en links ya
  // finalizados. Mismo guard/control que syncErpKore, mutuamente excluyentes.
  // dryRun: corre todo el cálculo y genera el reporte, pero no escribe nada en Mongo
  // (ni siquiera el checkpoint) — recomendado para la primera corrida en producción.
  recomputeSaldoErp(fechaDesde?: string, fechaHasta?: string, dryRun = false): Observable<{ jobId: string }> {
    const body: Record<string, string | boolean> = {};
    if (fechaDesde) body['fechaDesde'] = fechaDesde;
    if (fechaHasta) body['fechaHasta'] = fechaHasta;
    if (dryRun)     body['dryRun']     = true;
    return this.api.post('/erp/sync-erp-kore/recompute', body);
  }

  pauseSyncErpKore():  Observable<{ ok: boolean }> { return this.api.post('/erp/sync-erp-kore/pause',  {}); }
  resumeSyncErpKore(): Observable<{ ok: boolean }> { return this.api.post('/erp/sync-erp-kore/resume', {}); }
  stopSyncErpKore():   Observable<{ ok: boolean }> { return this.api.post('/erp/sync-erp-kore/stop',   {}); }

  downloadSyncErpKoreReport(jobId: string): Observable<Blob> {
    return this.api.downloadBlob(`/erp/sync-erp-kore/${jobId}/report`);
  }

  getSyncErpKoreJob(jobId: string): Observable<{
    status: 'running' | 'paused' | 'done' | 'stopped' | 'error';
    kind?: 'sync' | 'recompute';
    result?: ErpSyncJobResult;
    error?: string;
  }> {
    return this.api.get(`/erp/sync-erp-kore/${jobId}/status`);
  }

  getSyncErpKoreJobs(): Observable<ErpSyncJobSummary[]> {
    return this.api.get('/erp/sync-erp-kore/jobs');
  }

  revertSyncErpKore(jobId: string): Observable<{
    ok: boolean; matched: number; revertidos: number; omitidosPorCorridaMasReciente: number;
  }> {
    return this.api.post(`/erp/sync-erp-kore/${jobId}/revert`, {});
  }

  // Rescate manual (modo masivo) de folioFiscal atrapado por retención — ver
  // _FILTRO_LINK_ATRAPADO en erp.routes.js. Acción síncrona puntual (no es un job en
  // background): responde de inmediato con el conteo de movimientos afectados/modificados.
  resetRecomputeErpKore(fechaDesde?: string, fechaHasta?: string): Observable<{
    ok: boolean; modo: string; movimientosAfectados: number; movimientosModificados: number;
    fechaDesde: string | null; fechaHasta: string | null;
  }> {
    const body: Record<string, string> = {};
    if (fechaDesde) body['fechaDesde'] = fechaDesde;
    if (fechaHasta) body['fechaHasta'] = fechaHasta;
    return this.api.post('/erp/sync-erp-kore/reset-recompute', body);
  }

  // Mismo endpoint que arriba, modo PUNTUAL (mismo body {folio, erpId?} que ya usa el
  // backend por API directa) — libera el checkpoint de UN solo movimiento ya diagnosticado
  // a mano (ej. atrapado con una versión vieja del matching, no necesariamente folioFiscal),
  // para que la siguiente corrida de "Recalcular saldo ERP" lo vuelva a evaluar con el
  // código actual. No llama a Kore.
  resetRecomputePuntual(folio: string, erpId?: string): Observable<{
    ok: boolean; modo: string; folio: string; reiniciados: number;
  }> {
    const body: Record<string, string> = { folio };
    if (erpId) body['erpId'] = erpId;
    return this.api.post('/erp/sync-erp-kore/reset-recompute', body);
  }

  getMatchErpJob(jobId: string): Observable<{ status: string; result?: unknown; error?: string }> {
    return this.api.get(`/banks/autorizaciones/match-erp/job/${jobId}`);
  }

  // Barrido que desvincula CxC cerradas por Cancelación/Devolución (serieOrigen
  // CAC/DEV) con saldoErpAportado:0 — ver _esLinkPuroCancelacionODevolucion en
  // erp.routes.js. dryRun:true (default recomendado) solo devuelve el detalle
  // de lo que calificaría, sin modificar nada; dryRun:false ejecuta de verdad.
  desvincularCancelacionesErpKore(dryRun: boolean): Observable<{
    ok: boolean; dryRun: boolean; encontrados: number; desvinculados: number;
    detalle: {
      movimientoId: string; folio: string; banco: string;
      deposito: number | null; retiro: number | null;
      erpId: string; folioExterno: string | null; origenes: string[];
    }[];
  }> {
    return this.api.post('/erp/sync-erp-kore/desvincular-cancelaciones', { dryRun });
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

  // ── Traspasos internos entre cuentas propias (BBVA) ──────────────────────────
  // Motor que encuentra pares "traspaso interno" entre cuentas propias del usuario: depósito
  // en BBVA con categoriaBbva ↔ retiro real en el banco contraparte (determinado por
  // movimiento, no fijo — ver traspasos-internos.service.js). dryRun:true (default
  // recomendado) solo clasifica, sin escribir en Mongo.
  matchTraspasosInternos(categoriaBbva: string, dryRun: boolean): Observable<ResultadoTraspasosInternos> {
    return this.api.post('/banks/admin/traspasos-internos', { categoriaBbva, dryRun });
  }

  revertirTraspasosInternos(runId: string): Observable<{ revertidos: number; message: string }> {
    return this.api.post('/banks/admin/traspasos-internos/revertir', { runId });
  }

  descargarReporteTraspasosInternos(categoriaBbva: string): Observable<Blob> {
    return this.api.downloadBlob('/banks/admin/traspasos-internos/reporte', { categoriaBbva });
  }

  // ZIP con una póliza en formato de importación CONTPAQ (filas P/M1) por cada día del
  // rango que tenga al menos un par relacionado — no crea nada en Postgres/Poliza, solo
  // el/los Excel(es) importable(s) (ver generarPolizasContpaqTraspasosPorRango en
  // traspasos-internos.service.js). Ya no recibe categoriaBbva — el backend siempre busca
  // sobre la categoría de traspaso entre cuentas propias.
  descargarPolizaContpaqTraspasos(fechaInicio: string, fechaFin: string): Observable<Blob> {
    return this.api.downloadBlob('/banks/admin/traspasos-internos/poliza-contpaq', { fechaInicio, fechaFin });
  }

  deleteMovements(ids: string[]): Observable<{ deleted: number }> {
    return this.api.deleteWithBody<{ deleted: number }>('/banks/movements', { ids });
  }

  reclasifyMovements(ids: string[]): Observable<{ reclasified: number }> {
    return this.api.patch<{ reclasified: number }>('/banks/movements/reclasify', { ids });
  }

  bulkUpdateCategoria(ids: string[], categoria: string | null): Observable<{ actualizados: number }> {
    return this.api.patch<{ actualizados: number }>('/banks/movements/categoria/bulk', { ids, categoria });
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

  // Búsqueda de CFDIs (colección cfdis, solo source='ERP') por serie/folio — sección de
  // ficha del modal ERP, permiso banks:cfdi:read.
  buscarCfdis(serie: string, folio: string): Observable<CfdiBusquedaResult[]> {
    return this.api.get<CfdiBusquedaResult[]>('/banks/cfdis/buscar', { serie, folio });
  }

  deleteFicha(id: string): Observable<{ _id: string; status: BankStatus; ficha: null; fichaBy: null; fichaNombre: null; fichaAt: null }> {
    return this.api.delete(`/banks/movements/${id}/ficha`);
  }

  findDuplicates(): Observable<DuplicatesResult> {
    return this.api.get('/banks/duplicates');
  }

}
