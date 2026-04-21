import { Component, OnInit, OnDestroy } from '@angular/core';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { SatFacade } from '../../../core/facades';
import { HistorialSatEntry } from '../../../core/models/sat.model';

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
}
