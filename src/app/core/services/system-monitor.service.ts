import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiService } from './api.service';
import { HistorialPunto, SystemMonitorSnapshot } from '../models/system-monitor.model';

@Injectable({ providedIn: 'root' })
export class SystemMonitorService {
  constructor(private api: ApiService) {}

  snapshot(): Observable<SystemMonitorSnapshot> {
    return this.api.get<SystemMonitorSnapshot>('/system-monitor/snapshot');
  }

  // fechaInicio/fechaFin: mismos nombres que emite <app-date-range-popover>
  // (rangeChange) — vacío/undefined = últimas 24h (default del backend).
  historial(fechaInicio?: string, fechaFin?: string): Observable<HistorialPunto[]> {
    return this.api.get<HistorialPunto[]>('/system-monitor/historial', { fechaInicio, fechaFin });
  }
}
