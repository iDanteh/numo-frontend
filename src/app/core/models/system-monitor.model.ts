export type EstadoSistema = 'normal' | 'degradado' | 'caido';

export interface SaludConexiones {
  mongo:    'conectado' | 'desconectado';
  postgres: 'conectado' | 'desconectado';
}

export interface MemoriaProceso {
  rssMb:       number;
  heapUsedMb:  number;
  heapTotalMb: number;
}

// Memoria del HOST completo (otros procesos, SO, caché de disco) — distinta de
// MemoriaProceso (esa es solo el proceso Node de Numo). Ver el mismo comentario
// en numo-backend/system-monitor.service.js#construirSnapshot.
export interface MemoriaHost {
  totalMb:  number;
  freeMb:   number;
  usadoPct: number;
}

// Carga promedio del sistema operativo (1/5/15 min, os.loadavg()) — en Windows
// siempre viene en 0 (no soportado por el SO), inofensivo.
export interface CpuHost {
  load1:  number;
  load5:  number;
  load15: number;
  cores:  number;
}

// ts en epoch ms — punto del gráfico "requests de la última hora" (1 por minuto).
export interface PuntoSerieTrafico {
  ts:      number;
  total:   number;
  errores: number;
}

export interface ErrorReciente {
  ts:     number;
  metodo: string;
  path:   string;
  status: number;
}

export interface SystemMonitorSnapshot {
  generadoEn:                string;
  estadoGeneral:              EstadoSistema;
  requestsPorMinuto:          number;
  requestsEnCurso:            number;
  tasaErrorPct:               number;
  tiempoRespuestaPromedioMs:  number | null;
  uptimeSegundos:             number;
  memoria:                    MemoriaProceso;
  memoriaHost:                MemoriaHost;
  cpu:                        CpuHost;
  eventLoopLagMs:             number;
  salud:                      SaludConexiones;
  serieUltimaHora:            PuntoSerieTrafico[];
  erroresRecientes:           ErrorReciente[];
}

// Un punto del histórico persistente (GET /system-monitor/historial) — resumen
// por tick de cron (cada 5 min), no el detalle completo de un snapshot en vivo.
export interface HistorialPunto {
  fecha:                      string;
  requestsPorMinuto:          number;
  requestsEnCurso:            number;
  erroresUltimoMinuto:        number;
  tasaErrorPct:               number;
  tiempoRespuestaPromedioMs:  number | null;
  estadoGeneral:              EstadoSistema;
  eventLoopLagMs:             number;
  uptimeSegundos:             number;
  memoria:                    MemoriaProceso;
  memoriaHost:                MemoriaHost;
  cpu:                        CpuHost;
}
