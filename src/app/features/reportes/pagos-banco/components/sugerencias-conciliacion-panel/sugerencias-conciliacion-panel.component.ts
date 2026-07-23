import { Component, OnDestroy, OnInit, Output, EventEmitter } from '@angular/core';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import {
  ReportService, SugerenciasConciliacionResult, SugerenciaConciliacion, SugerenciaCandidato,
  EstadoSugerencia, ErpLinkParaAceptar,
} from '../../../../../core/services/report.service';

// Motor fallback (ver conciliacion-sugerencias.service.js en el backend): cubre depósitos
// bancarios 'no_identificado' cuya CxC ya salió de erp_cuentas_pendientes (ya saldada en
// el ERP), caso en el que el motor real de match (matchAutorizacionesDesdeErp, que solo
// cruza contra ese feed) no tiene con qué cruzar. Solo lectura del lado del backend --
// "Aceptar" aquí llama al endpoint YA EXISTENTE de vinculación manual de bancos
// (PUT /banks/movements/:id/erp-ids vía ReportService.aceptarSugerencia), sin duplicar
// ni modificar esa lógica de escritura.
@Component({
  standalone: false,
  selector: 'app-sugerencias-conciliacion-panel',
  templateUrl: './sugerencias-conciliacion-panel.component.html',
  styleUrls: ['./sugerencias-conciliacion-panel.component.css'],
})
export class SugerenciasConciliacionPanelComponent implements OnInit, OnDestroy {
  @Output() closed = new EventEmitter<void>();

  loading = false;
  error: string | null = null;
  result: SugerenciasConciliacionResult | null = null;

  fechaInicio: string;
  fechaFin: string;

  filtroEstado: EstadoSugerencia | null = null;

  aceptandoIds = new Set<string>();
  aceptadosIds = new Set<string>();
  erroresPorMov: Record<string, string> = {};

  private destroy$ = new Subject<void>();

  constructor(private reportService: ReportService) {
    const hoy = new Date();
    const primerDiaMes = new Date(hoy.getFullYear(), hoy.getMonth(), 1);
    this.fechaInicio = this.toDateInput(primerDiaMes);
    this.fechaFin    = this.toDateInput(hoy);
  }

  ngOnInit(): void { this.load(); }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  private toDateInput(d: Date): string {
    return d.toISOString().slice(0, 10);
  }

  load(): void {
    if (!this.fechaInicio || !this.fechaFin) return;
    this.loading = true;
    this.error   = null;
    this.result  = null;
    this.aceptandoIds  = new Set();
    this.aceptadosIds  = new Set();
    this.erroresPorMov = {};
    this.filtroEstado  = null;

    this.reportService.getSugerenciasConciliacion(this.fechaInicio, this.fechaFin)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next:  (res) => { this.result = res; this.loading = false; },
        error: (err) => {
          this.error   = err?.error?.error || 'Error al generar sugerencias';
          this.loading = false;
        },
      });
  }

  // ── Filtros / visualización ─────────────────────────────────────────────────

  get sugerenciasVisibles(): SugerenciaConciliacion[] {
    if (!this.result) return [];
    const todas = this.result.sugerencias.filter(s => !this.aceptadosIds.has(s.movimiento._id));
    if (!this.filtroEstado) return todas;
    return todas.filter(s => s.estado === this.filtroEstado);
  }

  contarEstado(estado: EstadoSugerencia): number {
    if (!this.result) return 0;
    return this.result.sugerencias.filter(s => s.estado === estado && !this.aceptadosIds.has(s.movimiento._id)).length;
  }

  setFiltro(estado: EstadoSugerencia | null): void {
    this.filtroEstado = estado;
  }

  etiquetaEstado(estado: EstadoSugerencia): string {
    switch (estado) {
      case 'CONFIRMADO_FIRMA_CFDI':   return 'Confirmado (firma + CFDI)';
      case 'MATCH_UNICO_MONTO_FECHA': return 'Match único (monto+fecha)';
      case 'SOLO_FIRMA':              return 'Solo firma bancaria';
      case 'AMBIGUO':                 return 'Ambiguo';
    }
  }

  // ── Aceptar sugerencia ───────────────────────────────────────────────────────

  private erpLinksDeCandidato(c: SugerenciaCandidato): ErpLinkParaAceptar[] {
    if (c.tipo === 'factura') {
      return [{
        erpId:            c.idDocumento!,
        saldoActual:      0,
        saldoPagado:      c.impPagado ?? null,
        saldoPagadoTotal: c.impPagado ?? null,
        folioFiscal:      c.idDocumento!,
        total:            c.impPagado ?? 0,
        serie:            c.serieFactura ?? null,
        folioExterno:     c.folioFactura ?? null,
        tipoPago:         null,
      }];
    }
    // pago_completo: un erpLink por cada factura del pago, con su impPagado individual.
    return (c.facturasDetalle ?? []).map(d => ({
      erpId:            d.idDocumento,
      saldoActual:      0,
      saldoPagado:      d.impPagado ?? null,
      saldoPagadoTotal: d.impPagado ?? null,
      folioFiscal:      d.idDocumento,
      total:            d.impPagado ?? 0,
      serie:            d.serie ?? null,
      folioExterno:     d.folio ?? null,
      tipoPago:         null,
    }));
  }

  aceptar(sugerencia: SugerenciaConciliacion, candidato: SugerenciaCandidato): void {
    const movId = sugerencia.movimiento._id;
    if (this.aceptandoIds.has(movId)) return;

    const erpLinks = this.erpLinksDeCandidato(candidato);
    if (!erpLinks.length) return;

    this.aceptandoIds = new Set([...this.aceptandoIds, movId]);
    const errores = { ...this.erroresPorMov };
    delete errores[movId];
    this.erroresPorMov = errores;

    this.reportService.aceptarSugerencia(movId, erpLinks)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: () => {
          this.aceptandoIds = new Set([...this.aceptandoIds].filter(id => id !== movId));
          this.aceptadosIds = new Set([...this.aceptadosIds, movId]);
        },
        error: (err) => {
          this.aceptandoIds = new Set([...this.aceptandoIds].filter(id => id !== movId));
          this.erroresPorMov = { ...this.erroresPorMov, [movId]: err?.error?.error || 'Error al vincular' };
        },
      });
  }
}
