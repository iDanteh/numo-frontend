import { Component, OnDestroy, OnInit } from '@angular/core';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { CentrosCostoService, CentroCosto } from '../../../core/services/centros-costo.service';
import { EntidadActivaService } from '../../../core/services/entidad-activa.service';
import { ToastService } from '../../../core/services/toast.service';
import {
  ReportesPorFacturarService, ReportePorFacturarRow, ReportePorFacturarDetalle, FacturaMostrador, DepositoMostrador,
} from '../../../core/services/reportes-por-facturar.service';

/** Renglón de las tablas que juntan depósitos de varias facturas (columna FACTURA). */
interface FilaConFactura extends DepositoMostrador { factura: string }

/**
 * Reporte "Por facturar" (2026-10-22): lo mismo que la pestaña MOSTRADOR de la
 * póliza de Ingreso, por día o rango y sucursal, con historial de quién lo creó.
 */
@Component({
  standalone: false,
  selector: 'app-por-facturar',
  templateUrl: './por-facturar.component.html',
})
export class PorFacturarComponent implements OnInit, OnDestroy {
  centros: CentroCosto[] = [];
  centroCostoId: number | null = null;
  modo: 'dia' | 'rango' = 'dia';
  fechaInicio = this.hoy();
  fechaFin    = this.hoy();

  rows: ReportePorFacturarRow[] = [];
  loading    = false;
  generando  = false;
  abriendoId: number | null = null;
  descargandoId: number | null = null;

  detalle: ReportePorFacturarDetalle | null = null;
  filasGlobal:    FilaConFactura[] = [];
  filasPpd:       FilaConFactura[] = [];
  filasPendiente: DepositoMostrador[] = [];

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
      this.detalle = null;
      this.load();
    });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  private get rfc(): string | null {
    return this.entidadActiva.snapshot?.rfc ?? null;
  }

  private hoy(): string {
    return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Mexico_City' });
  }

  load(): void {
    this.loading = true;
    this.svc.listar(this.rfc).subscribe({
      next: res => { this.rows = res.data; this.loading = false; },
      error: () => { this.loading = false; },
    });
  }

  generar(): void {
    const rfc = this.rfc;
    if (!rfc) { this.toast.warning('Selecciona una empresa'); return; }
    const fechaFin = this.modo === 'dia' ? this.fechaInicio : this.fechaFin;
    if (!this.fechaInicio || !fechaFin) { this.toast.warning('Indica la fecha'); return; }
    if (fechaFin < this.fechaInicio) { this.toast.warning('La fecha final no puede ser anterior a la inicial'); return; }

    this.generando = true;
    this.svc.generar({ rfc, centroCostoId: this.centroCostoId, fechaInicio: this.fechaInicio, fechaFin }).subscribe({
      next: r => {
        this.generando = false;
        this.mostrar(r);
        this.load();
        this.toast.success('Reporte generado');
      },
      error: err => {
        this.generando = false;
        this.toast.error(err?.error?.message || err?.error?.error || 'No se pudo generar el reporte');
      },
    });
  }

  ver(row: ReportePorFacturarRow): void {
    this.abriendoId = row.id;
    this.svc.obtener(row.id).subscribe({
      next: r => { this.abriendoId = null; this.mostrar(r); },
      error: () => { this.abriendoId = null; this.toast.error('No se pudo abrir el reporte'); },
    });
  }

  cerrarDetalle(): void {
    this.detalle = null;
  }

  descargar(row: { id: number; sucursal: string | null; fechaInicio: string; fechaFin: string }): void {
    this.descargandoId = row.id;
    this.svc.descargarExcel(row.id).subscribe({
      next: blob => {
        const url  = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href  = url;
        link.download = `Por_facturar_${(row.sucursal || 'Todas').replace(/[^\w-]+/g, '_')}_${this.periodo(row).replace(/ al /, '_')}.xlsx`;
        link.click();
        URL.revokeObjectURL(url);
        this.descargandoId = null;
      },
      error: () => { this.descargandoId = null; this.toast.error('No se pudo descargar el Excel'); },
    });
  }

  periodo(row: { fechaInicio: string; fechaFin: string }): string {
    return row.fechaInicio === row.fechaFin ? row.fechaInicio : `${row.fechaInicio} al ${row.fechaFin}`;
  }

  folio(f: FacturaMostrador): string {
    return `${f.serie ?? ''}-${f.folio ?? ''}`;
  }

  suma(filas: { importe?: number; aplicado?: number }[], campo: 'importe' | 'aplicado'): number {
    return Math.round(filas.reduce((s, d) => s + (Number(d[campo]) || 0), 0) * 100) / 100;
  }

  totalFacturas(fs: FacturaMostrador[]): number {
    return Math.round(fs.reduce((s, f) => s + (Number(f.totalFactura) || 0), 0) * 100) / 100;
  }

  private mostrar(r: ReportePorFacturarDetalle): void {
    this.detalle = r;
    const juntar = (fs: FacturaMostrador[]) => fs.flatMap(f => f.depositos.map(d => ({ ...d, factura: this.folio(f) })));
    this.filasGlobal    = juntar(r.tablas.facturasGlobales);
    this.filasPpd       = juntar(r.tablas.ppdFacturadoCliente);
    this.filasPendiente = r.tablas.depositosPendientes;
  }
}
