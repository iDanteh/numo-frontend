import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiService } from './api.service';

export interface ScheduleConfig {
  satDescarga:     string;   // HH:MM — descarga masiva SAT
  erpDescarga:     string;   // HH:MM — descarga automática ERP
  erpVerificacion: string;   // HH:MM — verificación estado SAT en CFDIs ERP
  comparacion:     string;   // HH:MM — comparación automática ERP vs SAT
}

@Injectable({ providedIn: 'root' })
export class ScheduleService {
  constructor(private api: ApiService) {}

  getSchedule(): Observable<ScheduleConfig> {
    return this.api.get<ScheduleConfig>('/schedule');
  }

  updateSchedule(config: Partial<ScheduleConfig>): Observable<ScheduleConfig & { mensaje: string }> {
    return this.api.put<ScheduleConfig & { mensaje: string }>('/schedule', config);
  }
}
