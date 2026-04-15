import { Component, OnDestroy } from '@angular/core';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { SatFacade } from '../../../core/facades';
import { HistorialSatEntry } from '../../../core/models/sat.model';

@Component({
  standalone: false,
  selector: 'app-historial-sat',
  templateUrl: './historial-sat.component.html',
})
export class HistorialSatComponent implements OnDestroy {
  private destroy$ = new Subject<void>();

  rfc = '';
  historial: HistorialSatEntry[] = [];
  loading = false;
  error = '';
  rfcConsultado = '';

  readonly estadoLabel: Record<string, string> = {
    ok:              'Sin diferencias',
    con_diferencias: 'Con diferencias',
    error:           'Error',
  };

  readonly estadoClass: Record<string, string> = {
    ok:              'badge-success',
    con_diferencias: 'badge-warning',
    error:           'badge-danger',
  };

  constructor(private satFacade: SatFacade) {}

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  consultar(): void {
    const rfc = this.rfc.trim().toUpperCase();
    if (!rfc) return;

    this.loading = true;
    this.error = '';
    this.historial = [];
    this.rfcConsultado = rfc;

    this.satFacade.historialSAT(rfc).pipe(takeUntil(this.destroy$)).subscribe({
      next: (res) => {
        this.historial = res.historial;
        this.loading = false;
      },
      error: (err) => {
        this.error = err?.error?.error ?? 'Error al consultar historial';
        this.loading = false;
      },
    });
  }

  tasaCoincidencia(entry: HistorialSatEntry): string {
    if (!entry.total) return '—';
    return ((entry.coinciden / entry.total) * 100).toFixed(1) + '%';
  }
}
