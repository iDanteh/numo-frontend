import { Component, OnInit, OnDestroy } from '@angular/core';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { SatFacade } from '../../../core/facades';
import { HistorialSatEntry } from '../../../core/models/sat.model';

const MESES_LABELS = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];

@Component({
  standalone: false,
  selector: 'app-historial-sat',
  templateUrl: './historial-sat.component.html',
})
export class HistorialSatComponent implements OnInit, OnDestroy {
  private destroy$ = new Subject<void>();

  rfcFiltro = '';
  historial: HistorialSatEntry[] = [];
  loading = false;
  error = '';

  // ── Paginación ────────────────────────────────────────────────────────────
  paginaActual = 1;
  readonly porPagina = 10;

  get totalPaginas(): number {
    return Math.ceil(this.historial.length / this.porPagina);
  }

  get historialPaginado(): HistorialSatEntry[] {
    const inicio = (this.paginaActual - 1) * this.porPagina;
    return this.historial.slice(inicio, inicio + this.porPagina);
  }

  get paginas(): number[] {
    return Array.from({ length: this.totalPaginas }, (_, i) => i + 1);
  }

  irPagina(p: number): void {
    if (p < 1 || p > this.totalPaginas) return;
    this.paginaActual = p;
  }

  // ── Exportar XML ──────────────────────────────────────────────────────────
  exportRfc = '';
  exportEjercicio: number | null = null;
  exportPeriodo: number | null = null;
  exportando = false;
  exportError = '';
  readonly exportAnios: number[] = (() => {
    const current = new Date().getFullYear();
    const years: number[] = [];
    for (let y = current; y >= 2020; y--) years.push(y);
    return years;
  })();
  readonly exportMeses = MESES_LABELS.map((label, i) => ({ value: i + 1, label }));
  errorSeleccionado: string | null = null;

  // ── Recuperar de Kore ERP (botón manual en filas con estado 'error') ───────
  recuperandoErpId: string | null = null;
  recuperarErpMensaje: string | null = null;

  constructor(private satFacade: SatFacade) {}

  ngOnInit(): void {
    this.cargar();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  cargar(): void {
    this.loading = true;
    this.error = '';
    const rfc = this.rfcFiltro.trim().toUpperCase() || undefined;
    this.satFacade.historialSAT(rfc).pipe(takeUntil(this.destroy$)).subscribe({
      next: (res) => {
        this.historial = res.historial;
        this.loading = false;
      },
      error: (err) => {
        this.error = err?.error?.error ?? 'Error al cargar el historial';
        this.loading = false;
      },
    });
  }

  duracion(entry: HistorialSatEntry): string {
    if (!entry.fin) return '—';
    const ms = new Date(entry.fin).getTime() - new Date(entry.inicio).getTime();
    const s = Math.floor(ms / 1000);
    if (s < 60) return `${s}s`;
    return `${Math.floor(s / 60)}m ${s % 60}s`;
  }

  mesLabel(n?: number): string {
    if (!n) return '';
    const meses = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
    return meses[n - 1] ?? '';
  }

  verError(entry: HistorialSatEntry): void {
    if (entry.estado === 'error' && entry.error) {
      this.errorSeleccionado = entry.error;
    }
  }

  cerrarError(): void {
    this.errorSeleccionado = null;
  }

  // 2026-09-22, pedido explícito del usuario: cuando una descarga SAT quedó en
  // 'error', ofrece traer las facturas de ese mes directo de Kore ERP como
  // respaldo (misma función que ya corre sola a la 1am, ver
  // ejecutarDescargaERP en satSyncJob.js — esto solo la dispara bajo demanda).
  puedeRecuperarErp(entry: HistorialSatEntry): boolean {
    return entry.estado === 'error' && entry.tipo !== 'erp_automatica' && !!entry.ejercicio && !!entry.periodo;
  }

  recuperarErp(entry: HistorialSatEntry, event: Event): void {
    event.stopPropagation(); // no abrir el modal de "ver error" de la fila
    if (!entry.ejercicio || !entry.periodo || this.recuperandoErpId) return;

    this.recuperandoErpId = entry._id;
    this.recuperarErpMensaje = null;
    this.satFacade.recuperarErp(entry.ejercicio, entry.periodo).pipe(takeUntil(this.destroy$)).subscribe({
      next: () => {
        this.recuperarErpMensaje = `Recuperación de ${this.mesLabel(entry.periodo)} ${entry.ejercicio} iniciada — revisa el historial en unos minutos.`;
        this.recuperandoErpId = null;
      },
      error: (err) => {
        this.recuperarErpMensaje = err?.error?.error ?? 'No se pudo iniciar la recuperación desde Kore ERP.';
        this.recuperandoErpId = null;
      },
    });
  }

  exportarXml(): void {
    const rfc = this.exportRfc.trim().toUpperCase();
    if (!rfc || !this.exportEjercicio || !this.exportPeriodo) {
      this.exportError = 'RFC, año y mes son requeridos';
      return;
    }
    this.exportando = true;
    this.exportError = '';
    this.satFacade.exportarXml(rfc, this.exportEjercicio, this.exportPeriodo)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (blob) => {
          const meses = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
          const mes = meses[(this.exportPeriodo ?? 1) - 1];
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = `CFDIs_SAT_${rfc}_${mes}${this.exportEjercicio}.zip`;
          a.click();
          URL.revokeObjectURL(url);
          this.exportando = false;
        },
        error: (err) => {
          this.exportError = err?.error?.error ?? 'Error al exportar XMLs';
          this.exportando = false;
        },
      });
  }
}
