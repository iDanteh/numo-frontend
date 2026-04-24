import { Component, OnInit } from '@angular/core';
import { ScheduleService, ScheduleConfig } from '../../../core/services/schedule.service';
import { ToastService } from '../../../core/services/toast.service';

@Component({
  standalone: false,
  selector: 'app-programacion',
  templateUrl: './programacion.component.html',
})
export class ProgramacionComponent implements OnInit {
  satDescarga     = '01:00';
  erpDescarga     = '03:00';
  erpVerificacion = '02:00';
  comparacion     = '04:00';
  cargando        = false;
  guardando       = false;

  constructor(
    private scheduleService: ScheduleService,
    private toast: ToastService,
  ) {}

  ngOnInit(): void {
    this.cargando = true;
    this.scheduleService.getSchedule().subscribe({
      next: (cfg: ScheduleConfig) => {
        this.satDescarga     = cfg.satDescarga;
        this.erpDescarga     = cfg.erpDescarga;
        this.erpVerificacion = cfg.erpVerificacion;
        this.comparacion     = cfg.comparacion;
        this.cargando        = false;
      },
      error: () => {
        this.toast.error('No se pudo cargar la programación');
        this.cargando = false;
      },
    });
  }

  guardar(): void {
    this.guardando = true;
    this.scheduleService.updateSchedule({
      satDescarga:     this.satDescarga,
      erpDescarga:     this.erpDescarga,
      erpVerificacion: this.erpVerificacion,
      comparacion:     this.comparacion,
    }).subscribe({
      next: () => {
        this.toast.success('Horarios guardados y jobs reprogramados');
        this.guardando = false;
      },
      error: (err: any) => {
        this.toast.error(err?.error?.error ?? 'Error al guardar horarios');
        this.guardando = false;
      },
    });
  }

  formatHora(hhmm: string): string {
    if (!hhmm) return '';
    const [hh, mm] = hhmm.split(':').map(Number);
    const periodo  = hh < 12 ? 'AM' : 'PM';
    const hora12   = hh % 12 || 12;
    return `${hora12}:${String(mm).padStart(2, '0')} ${periodo}`;
  }
}
