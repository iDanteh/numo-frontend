import { Component, OnDestroy, OnInit } from '@angular/core';
import { Subject, Subscription, timer } from 'rxjs';
import { switchMap, takeUntil } from 'rxjs/operators';
import { CentrosCostoService, CentroCosto } from '../../../core/services/centros-costo.service';
import { EntidadActivaService } from '../../../core/services/entidad-activa.service';
import { ToastService } from '../../../core/services/toast.service';
import {
  ReportesPorFacturarService, EstadisticaPorFacturar, DepositoEstadistica,
} from '../../../core/services/reportes-por-facturar.service';

/** Cada cuánto se pregunta el avance del cálculo (corre en segundo plano). */
const INTERVALO_MS = 3000;

/**
 * "Estadística por facturar" (2026-10-29, pedido del usuario): de los depósitos
 * por facturar que entraron en el periodo, cuántos había, cuántos ya se
 * facturaron y cuántos faltan. Se recalcula al momento (no se guarda).
 */
@Component({
  standalone: false,
  selector: 'app-estadistica-por-facturar',
  templateUrl: './estadistica-por-facturar.component.html',
})
export class EstadisticaPorFacturarComponent implements OnInit, OnDestroy {
  centros: CentroCosto[] = [];
  centroCostoId: number | null = null;
  fechaInicio = this.primeroDeMes();
  fechaFin    = this.hoy();

  calculando = false;
  avance: string | null = null;
  trabajoId: string | null = null;
  resultado: EstadisticaPorFacturar | null = null;
  descargando = false;

  lista: 'faltan' | 'facturados' = 'faltan';
  /** Filtro de almacén en las listas (null = todos). */
  serieSel: string | null = null;

  private sondeo?: Subscription;
  private readonly destroy$ = new Subject<void>();

  constructor(
    private svc: ReportesPorFacturarService,
    private centrosSvc: CentrosCostoService,
    private entidadActiva: EntidadActivaService,
    private toast: ToastService,
  ) {}

  ngOnInit(): void {
    this.centrosSvc.list().subscribe({
      next: cs => { this.centros = cs.filter(c => c.isActive && c.serieFacturacion).sort((a, b) => a.sucursal.localeCompare(b.sucursal)); },
    });
    this.entidadActiva.entidadActiva$.pipe(takeUntil(this.destroy$)).subscribe(() => {
      this.detener();
      this.resultado = null;
    });
  }

  ngOnDestroy(): void {
    this.detener();
    this.destroy$.next();
    this.destroy$.complete();
  }

  private hoy(): string {
    return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Mexico_City' });
  }

  private primeroDeMes(): string {
    return `${this.hoy().slice(0, 8)}01`;
  }

  calcular(): void {
    const rfc = this.entidadActiva.snapshot?.rfc ?? null;
    if (!rfc) { this.toast.warning('Selecciona una empresa'); return; }
    if (!this.fechaInicio || !this.fechaFin) { this.toast.warning('Indica las fechas'); return; }
    if (this.fechaFin < this.fechaInicio) { this.toast.warning('La fecha final no puede ser anterior a la inicial'); return; }

    this.detener();
    this.calculando = true;
    this.avance = 'Iniciando…';
    this.svc.iniciarEstadistica({ rfc, centroCostoId: this.centroCostoId, fechaInicio: this.fechaInicio, fechaFin: this.fechaFin }).subscribe({
      next: t => { this.trabajoId = t.id; this.sondear(t.id); },
      error: err => {
        this.calculando = false;
        this.toast.error(err?.error?.message || err?.error?.error || 'No se pudo iniciar el cálculo');
      },
    });
  }

  private sondear(id: string): void {
    this.sondeo = timer(INTERVALO_MS, INTERVALO_MS).pipe(switchMap(() => this.svc.estadistica(id))).subscribe({
      next: t => {
        if (t.estado === 'calculando') { this.avance = t.avance; return; }
        this.detener();
        if (t.estado === 'listo' && t.resultado) {
          this.resultado = t.resultado;
          this.serieSel = null;
          this.lista = 'faltan';
        } else {
          this.toast.error(t.error || 'No se pudo calcular la estadística');
        }
      },
      // 404 = el servidor se reinició y el cálculo se perdió.
      error: () => { this.detener(); this.toast.error('Se perdió el cálculo (¿se reinició el servidor?). Vuelve a calcular.'); },
    });
  }

  private detener(): void {
    this.sondeo?.unsubscribe();
    this.sondeo = undefined;
    this.calculando = false;
    this.avance = null;
  }

  get depositosLista(): DepositoEstadistica[] {
    const estado = this.lista === 'faltan' ? 'falta' : 'facturado';
    return (this.resultado?.depositos ?? []).filter(d => d.estado === estado && (!this.serieSel || d.serie === this.serieSel));
  }

  get importeLista(): number {
    return this.depositosLista.reduce((s, d) => s + d.importe, 0);
  }

  /** Mayor número de pendientes en el día a día (escala de la barrita). */
  get maxPendientes(): number {
    return Math.max(1, ...(this.resultado?.diaADia ?? []).map(d => d.pendientes.depositos));
  }

  tipo(d: DepositoEstadistica): string {
    return d.tipoFactura === 'global' ? 'Global' : d.tipoFactura === 'mixto' ? 'Mixto' : 'Cliente';
  }

  descargar(): void {
    if (!this.trabajoId || !this.resultado) return;
    const r = this.resultado;
    this.descargando = true;
    this.svc.descargarExcelEstadistica(this.trabajoId).subscribe({
      next: blob => {
        const url  = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href  = url;
        link.download = `Estadistica_por_facturar_${(r.sucursal || 'Todas').replace(/[^\w-]+/g, '_')}_${r.fechaInicio}_${r.fechaFin}.xlsx`;
        link.click();
        URL.revokeObjectURL(url);
        this.descargando = false;
      },
      error: () => { this.descargando = false; this.toast.error('No se pudo descargar el Excel (si se reinició el servidor, vuelve a calcular)'); },
    });
  }
}
