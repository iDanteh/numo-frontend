import { Component, OnDestroy, OnInit } from '@angular/core';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { PolizaService, Poliza } from '../../core/services/poliza.service';
import { EntidadActivaService } from '../../core/services/entidad-activa.service';

/**
 * Fase 2 (2026-08-25): ya NO es un stub — genera/lista/cancela pólizas reales
 * tipo='T', mismo ciclo de vida (folio, estado) que Ingreso/Cobranza. Único
 * filtro visible: rango de fechas — rfc sale de EntidadActivaService (mismo
 * contexto activo global que ya usa el resto de la app), sin selector propio
 * en esta página (pedido explícito del usuario).
 */
@Component({
  standalone: false,
  selector: 'app-poliza-traspasos',
  templateUrl: './poliza-traspasos.component.html',
})
export class PolizaTraspasosComponent implements OnInit, OnDestroy {
  private destroy$ = new Subject<void>();

  fechaInicio = '';
  fechaFin    = '';

  generando   = false;
  loading     = false;
  cancelando  = new Set<number>();
  exportando  = new Set<number>();

  polizas: Poliza[] = [];
  error:   string | null = null;

  // ── Ver movimientos ─────────────────────────────────────────────────────────
  // Mismo dato que ya trae openEdit() en poliza-list.component.ts (GET /polizas/:id
  // ya incluye movimientos con cuenta.codigo/nombre resueltos) — pero un modal propio,
  // simple y de solo lectura, en vez de reusar el editor gigante de CFDIs (acoplado a
  // reglas/autocomplete de cuentas/filtros que acá no aplican).
  verModal = { show: false, loading: false, poliza: null as Poliza | null };

  constructor(
    private polizaSvc: PolizaService,
    private entidadActiva: EntidadActivaService,
  ) {}

  ngOnInit(): void {
    this.cargar();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  private get rfc(): string | null {
    return this.entidadActiva.snapshot?.rfc ?? null;
  }

  cargar(): void {
    const rfc = this.rfc;
    if (!rfc) return;
    this.loading = true;
    this.polizaSvc.list({ rfc, tipo: 'T', limit: 100 })
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (res) => { this.polizas = res.polizas; this.loading = false; },
        error: () => { this.loading = false; },
      });
  }

  generarPoliza(): void {
    const rfc = this.rfc;
    if (!rfc || !this.fechaInicio || !this.fechaFin || this.generando) return;
    this.generando = true;
    this.error = null;
    this.polizaSvc.generarTraspasos({ rfc, fechaInicio: this.fechaInicio, fechaFin: this.fechaFin })
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: () => {
          this.generando = false;
          this.fechaInicio = '';
          this.fechaFin    = '';
          this.cargar();
        },
        error: (err) => {
          this.generando = false;
          this.error = err?.error?.error || 'No se pudo generar la póliza.';
        },
      });
  }

  cancelar(poliza: Poliza): void {
    if (!poliza.id || this.cancelando.has(poliza.id)) return;
    const motivo = window.prompt('Motivo de cancelación (opcional):') ?? undefined;
    const ok = confirm(
      `¿Cancelar la póliza T${poliza.numero}? Los movimientos bancarios que relacionó vuelven a "no identificado".`,
    );
    if (!ok) return;

    this.cancelando.add(poliza.id);
    this.polizaSvc.cancelar(poliza.id, motivo)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: () => { this.cancelando.delete(poliza.id!); this.cargar(); },
        error: (err) => {
          this.cancelando.delete(poliza.id!);
          this.error = err?.error?.error || 'No se pudo cancelar la póliza.';
        },
      });
  }

  verMovimientos(poliza: Poliza): void {
    if (!poliza.id) return;
    this.verModal = { show: true, loading: true, poliza: null };
    this.polizaSvc.getById(poliza.id)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (full) => { this.verModal = { show: true, loading: false, poliza: full }; },
        error: () => { this.verModal = { show: false, loading: false, poliza: null }; },
      });
  }

  cerrarVer(): void {
    this.verModal = { show: false, loading: false, poliza: null };
  }

  exportar(poliza: Poliza): void {
    if (!poliza.id || this.exportando.has(poliza.id)) return;
    this.exportando.add(poliza.id);
    this.polizaSvc.exportarContpaqTraspasos(poliza.id)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (response) => {
          this.exportando.delete(poliza.id!);
          const blob = response.body!;
          const url  = URL.createObjectURL(blob);
          const a    = document.createElement('a');
          a.href = url;
          a.download = `Poliza_T${poliza.numero}_${poliza.fecha}_CONTPAQ.xlsx`;
          a.click();
          URL.revokeObjectURL(url);
        },
        error: (err) => {
          this.exportando.delete(poliza.id!);
          // Angular entrega el body de error también como Blob cuando responseType
          // es 'blob' — mismo fix ya aplicado en admin-ops-panel.component.ts.
          if (err?.error instanceof Blob) {
            err.error.text().then((text: string) => {
              let msg = 'No se pudo exportar la póliza.';
              try { msg = JSON.parse(text)?.error || msg; } catch { /* respuesta no era JSON */ }
              this.error = msg;
            });
            return;
          }
          this.error = err?.error?.error || 'No se pudo exportar la póliza.';
        },
      });
  }
}
