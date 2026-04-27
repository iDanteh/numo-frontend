import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable, tap } from 'rxjs';
import { ApiService } from './api.service';

export interface ScheduleConfig {
  satDescarga:     string;   // HH:MM — descarga masiva SAT
  erpDescarga:     string;   // HH:MM — descarga automática ERP
  erpVerificacion: string;   // HH:MM — verificación estado SAT en CFDIs ERP
  comparacion:     string;   // HH:MM — comparación automática ERP vs SAT
}

const DEFAULTS: ScheduleConfig = {
  satDescarga: '01:00', erpDescarga: '03:00', erpVerificacion: '02:00', comparacion: '04:00',
};

@Injectable({ providedIn: 'root' })
export class ScheduleService {
  private _config$ = new BehaviorSubject<ScheduleConfig>(DEFAULTS);

  /** Observable reactivo — todos los suscriptores reciben actualizaciones en tiempo real */
  readonly config$ = this._config$.asObservable();

  constructor(private api: ApiService) {}

  getSchedule(): Observable<ScheduleConfig> {
    return this.api.get<ScheduleConfig>('/schedule').pipe(
      tap(cfg => this._config$.next({ ...DEFAULTS, ...cfg })),
    );
  }

  updateSchedule(config: Partial<ScheduleConfig>): Observable<ScheduleConfig & { mensaje: string }> {
    return this.api.put<ScheduleConfig & { mensaje: string }>('/schedule', config).pipe(
      tap(res => this._config$.next({ ...DEFAULTS, ...res })),
    );
  }
}
