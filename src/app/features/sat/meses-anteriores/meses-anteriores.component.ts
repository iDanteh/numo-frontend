import { Component, OnDestroy, OnInit } from '@angular/core';
import { interval, of, Subscription } from 'rxjs';
import { catchError, switchMap } from 'rxjs/operators';
import { ScheduleService } from '../../../core/services/schedule.service';
import { ToastService } from '../../../core/services/toast.service';

type JobKey = 'erp' | 'verif' | 'comp';
type JobState = 'idle' | 'en_proceso' | 'completado' | 'error';

const MESES = [
  'Enero','Febrero','Marzo','Abril','Mayo','Junio',
  'Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre',
];

// Si el lock nunca aparece pero han pasado más de este tiempo desde el request,
// asumimos que el job terminó muy rápido antes del primer poll.
const FAST_JOB_FALLBACK_MS = 10_000;

@Component({
  standalone: false,
  selector: 'app-meses-anteriores',
  templateUrl: './meses-anteriores.component.html',
})
export class MesesAnterioresComponent implements OnInit, OnDestroy {

  // ── Selector de periodo ────────────────────────────────────────────────────
  ejercicio: number;
  periodo: number;
  ejerciciosDisponibles: number[] = [];
  meses = MESES;

  // ── Estado de cada paso (ejecución inmediata) ─────────────────────────────
  estados: Record<JobKey, JobState> = { erp: 'idle', verif: 'idle', comp: 'idle' };
  mensajes: Record<JobKey, string>  = { erp: '', verif: '', comp: '' };

  // ── Tracking de locks para detectar finalización ──────────────────────────
  private lockSeenActive: Record<JobKey, boolean>      = { erp: false, verif: false, comp: false };
  private jobRequestedAt: Partial<Record<JobKey, number>> = {};

  // ── Programación ──────────────────────────────────────────────────────────
  horaProgramada  = '22:00';
  programando     = false;
  programados:    any[] = [];
  advertenciaHora = '';

  // ── Polling de locks ──────────────────────────────────────────────────────
  private pollSub?: Subscription;
  private activeLocks = new Set<string>();

  constructor(
    private schedule: ScheduleService,
    private toast: ToastService,
  ) {
    const hoy     = new Date();
    const anioHoy = hoy.getFullYear();
    const mesHoy  = hoy.getMonth() + 1;

    if (mesHoy === 1) { this.ejercicio = anioHoy - 1; this.periodo = 12; }
    else              { this.ejercicio = anioHoy;      this.periodo = mesHoy - 1; }

    for (let y = anioHoy; y >= anioHoy - 5; y--) this.ejerciciosDisponibles.push(y);
  }

  ngOnInit(): void {
    this._startPolling();
    this._cargarProgramados();
  }

  ngOnDestroy(): void {
    this.pollSub?.unsubscribe();
  }

  get periodos(): number[] { return [1,2,3,4,5,6,7,8,9,10,11,12]; }

  get labelPeriodo(): string { return `${MESES[this.periodo - 1]} ${this.ejercicio}`; }

  // ── Polling locks ─────────────────────────────────────────────────────────
  private _startPolling(): void {
    this.pollSub = interval(5000).pipe(
      switchMap(() => this.schedule.getLocks().pipe(
        catchError(() => of({ activos: [] as string[] })),
      )),
    ).subscribe({
      next: ({ activos }) => {
        this._checkLockReleased('erp',   `erp-${this.ejercicio}-${this.periodo}`,   activos);
        this._checkLockReleased('verif', `verif-${this.ejercicio}-${this.periodo}`, activos);
        this._checkLockReleased('comp',  `comp-${this.ejercicio}-${this.periodo}`,  activos);
        this.activeLocks = new Set(activos);
      },
    });
  }

  private _checkLockReleased(job: JobKey, key: string, activos: string[]): void {
    if (this.estados[job] !== 'en_proceso') return;

    if (activos.includes(key)) {
      // El lock está activo: lo marcamos como visto
      this.lockSeenActive[job] = true;
    } else if (this.lockSeenActive[job]) {
      // Estuvo activo y ya no: job terminó
      this.estados[job]        = 'completado';
      this.mensajes[job]       = 'Completado';
      this.lockSeenActive[job] = false;
    } else if (this.jobRequestedAt[job] && Date.now() - this.jobRequestedAt[job]! > FAST_JOB_FALLBACK_MS) {
      // El lock nunca apareció pero ya pasaron 10s: job muy rápido, asumir completado
      this.estados[job]  = 'completado';
      this.mensajes[job] = 'Completado';
    }
  }

  // ── Ejecución inmediata ───────────────────────────────────────────────────
  ejecutarERP(): void {
    this.estados.erp      = 'en_proceso';
    this.mensajes.erp     = '';
    this.lockSeenActive.erp = false;
    this.jobRequestedAt.erp = Date.now();
    this.schedule.runErp(this.ejercicio, this.periodo).subscribe({
      next:  () => this.toast.success(`Descarga ERP ${this.labelPeriodo} iniciada`),
      error: (err: any) => {
        this.estados.erp  = 'error';
        this.mensajes.erp = err?.error?.error ?? 'Error al iniciar la descarga ERP';
        this.toast.error(this.mensajes.erp);
      },
    });
  }

  ejecutarVerificacion(): void {
    this.estados.verif      = 'en_proceso';
    this.mensajes.verif     = '';
    this.lockSeenActive.verif = false;
    this.jobRequestedAt.verif = Date.now();
    this.schedule.runVerificacion(this.ejercicio, this.periodo).subscribe({
      next:  () => this.toast.success(`Verificación SAT ${this.labelPeriodo} iniciada`),
      error: (err: any) => {
        this.estados.verif  = 'error';
        this.mensajes.verif = err?.error?.error ?? 'Error al iniciar la verificación';
        this.toast.error(this.mensajes.verif);
      },
    });
  }

  ejecutarComparacion(): void {
    this.estados.comp      = 'en_proceso';
    this.mensajes.comp     = '';
    this.lockSeenActive.comp = false;
    this.jobRequestedAt.comp = Date.now();
    this.schedule.runComparacion(this.ejercicio, this.periodo).subscribe({
      next:  () => this.toast.success(`Comparación ${this.labelPeriodo} iniciada`),
      error: (err: any) => {
        this.estados.comp  = 'error';
        this.mensajes.comp = err?.error?.error ?? 'Error al iniciar la comparación';
        this.toast.error(this.mensajes.comp);
      },
    });
  }

  resetEstados(): void {
    this.estados        = { erp: 'idle', verif: 'idle', comp: 'idle' };
    this.mensajes       = { erp: '', verif: '', comp: '' };
    this.lockSeenActive = { erp: false, verif: false, comp: false };
    this.jobRequestedAt = {};
  }

  // ── Programación por hora ─────────────────────────────────────────────────
  private _cargarProgramados(): void {
    this.schedule.getProgramados().subscribe({
      next: ({ programados }) => {
        this.programados = programados;
        this.onHoraChange();
      },
    });
  }

  programar(): void {
    this.programando = true;
    this.schedule.programarMes(this.ejercicio, this.periodo, this.horaProgramada).subscribe({
      next: (prog: any) => {
        this.programados = [...this.programados, prog];
        this.onHoraChange();
        this.toast.success(`Programado para las ${this.horaProgramada} — ${this.labelPeriodo}`);
        this.programando = false;
      },
      error: (err: any) => {
        this.toast.error(err?.error?.error ?? 'Error al programar');
        this.programando = false;
      },
    });
  }

  cancelar(id: string): void {
    this.schedule.cancelarProgramado(id).subscribe({
      next: () => {
        this.programados = this.programados.filter(p => p.id !== id);
        this.toast.success('Programación cancelada');
      },
      error: (err: any) => this.toast.error(err?.error?.error ?? 'Error al cancelar'),
    });
  }

  get pendientes(): any[] {
    return this.programados.filter(p => p.estado === 'pendiente');
  }

  onHoraChange(): void {
    this.advertenciaHora = '';
    if (!this.horaProgramada || this.pendientes.length === 0) return;

    const [hh, mm] = this.horaProgramada.split(':').map(Number);
    const nuevaMin = hh * 60 + mm;

    for (const p of this.pendientes) {
      const [ph, pm] = (p.hora as string).split(':').map(Number);
      const existMin = ph * 60 + pm;
      const diff     = Math.abs(nuevaMin - existMin);
      // Considerar también el caso de cruce de medianoche (ej. 23:00 vs 01:00 = 2h)
      const diffReal = Math.min(diff, 1440 - diff);
      if (diffReal < 180) {
        const mes = MESES[p.periodo - 1];
        this.advertenciaHora =
          `Advertencia: esta hora queda a ${diffReal} min de ${mes} ${p.ejercicio} (${p.hora}). ` +
          `Se recomiendan al menos 3 horas de separacion.`;
        return;
      }
    }
  }

  formatFecha(iso: string): string {
    if (!iso) return '';
    return new Date(iso).toLocaleString('es-MX', { dateStyle: 'short', timeStyle: 'short' });
  }

  badgeClass(estado: string): string {
    if (estado === 'pendiente')  return 'badge-warning';
    if (estado === 'en_proceso') return 'badge-info';
    if (estado === 'completado') return 'badge-success';
    if (estado === 'error')      return 'badge-danger';
    return '';
  }
}
