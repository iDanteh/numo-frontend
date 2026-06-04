import { Component, OnInit, OnDestroy } from '@angular/core';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { SatFacade } from '../../../core/facades';
import {
  CheckpointsSaludResponse,
  CheckpointIncompleto,
  CheckpointError,
  CheckpointEnProceso,
  CuotaDiaRfc,
} from '../../../core/models/sat.model';

@Component({
  standalone: false,
  selector: 'app-salud-sat',
  templateUrl: './salud-sat.component.html',
})
export class SaludSatComponent implements OnInit, OnDestroy {
  private destroy$ = new Subject<void>();

  rfcFiltro = '';
  loading = false;
  error = '';
  datos: CheckpointsSaludResponse | null = null;

  // Errores: lista de códigos expandidos
  codigosExpandidos = new Set<string>();

  // Modal de detalle de error
  errorDetalle: string | null = null;

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
    this.satFacade.getCheckpointsSalud(rfc, 45).pipe(takeUntil(this.destroy$)).subscribe({
      next: (res) => {
        this.datos = res;
        this.loading = false;
        // Expandir automáticamente si hay pocos errores
        Object.keys(res.erroresPorCodigo).forEach(k => this.codigosExpandidos.add(k));
      },
      error: (err) => {
        this.error = err?.error?.error ?? 'Error al cargar el estado de salud';
        this.loading = false;
      },
    });
  }

  get rfcs(): string[] {
    if (!this.datos) return [];
    return Object.keys(this.datos.cuotaDia);
  }

  getCuota(rfc: string): CuotaDiaRfc | null {
    return this.datos?.cuotaDia[rfc] ?? null;
  }

  cuotaPct(rfc: string): number {
    const c = this.getCuota(rfc);
    if (!c || c.limiteDiario === 0) return 0;
    return Math.round((c.solicitudesHoy / c.limiteDiario) * 100);
  }

  get codigosError(): string[] {
    if (!this.datos) return [];
    return Object.keys(this.datos.erroresPorCodigo).sort();
  }

  erroresDe(codigo: string): CheckpointError[] {
    return this.datos?.erroresPorCodigo[codigo] ?? [];
  }

  toggleCodigo(codigo: string): void {
    if (this.codigosExpandidos.has(codigo)) {
      this.codigosExpandidos.delete(codigo);
    } else {
      this.codigosExpandidos.add(codigo);
    }
  }

  estaExpandido(codigo: string): boolean {
    return this.codigosExpandidos.has(codigo);
  }

  verErrorDetalle(msg: string): void {
    this.errorDetalle = msg;
  }

  cerrarDetalle(): void {
    this.errorDetalle = null;
  }

  formatFecha(f: string): string {
    if (!f) return '—';
    return f.slice(0, 10);
  }

  minutosDesde(iso: string): string {
    const ms = Date.now() - new Date(iso).getTime();
    const min = Math.floor(ms / 60000);
    if (min < 60) return `hace ${min} min`;
    const h = Math.floor(min / 60);
    if (h < 24) return `hace ${h}h`;
    return `hace ${Math.floor(h / 24)}d`;
  }

  badgeColor(codigo: string): string {
    if (codigo.includes('5002')) return 'badge-danger';
    if (codigo.includes('304') || codigo.includes('305')) return 'badge-danger';
    if (codigo === 'SAT_RECHAZADA') return 'badge-warning';
    if (codigo === 'TIMEOUT') return 'badge-warning';
    if (codigo === 'RESET_MANUAL') return 'badge-secondary';
    return 'badge-info';
  }

  descripcionCodigo(codigo: string): string {
    const map: Record<string, string> = {
      'SAT [5002]':    'Límite de solicitudes de por vida agotado — no se puede reintentar',
      'SAT [5003]':    'Rango de fechas supera el máximo de CFDIs por solicitud',
      'SAT [5005]':    'Solicitud duplicada activa — ya existe una en proceso',
      'SAT [5006]':    'Error interno transitorio del SAT',
      'SAT [5008]':    'Límite de 2 descargas por paquete excedido',
      'SAT [5011]':    'Límite de descargas por folio por día',
      'SAT [304]':     'Certificado revocado o caducado — renovar e.firma',
      'SAT [305]':     'Certificado inválido — verificar archivo .cer',
      'SAT_RECHAZADA': 'SAT rechazó la solicitud — posible solicitud activa previa o límite diario',
      'TIMEOUT':       'El SAT no respondió en el tiempo esperado',
      'RESET_MANUAL':  'Reseteado manualmente por el administrador',
    };
    return map[codigo] ?? 'Error no clasificado';
  }
}
