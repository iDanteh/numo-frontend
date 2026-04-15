export interface SatCredencialesEstado {
  rfc: string;
  tieneCredenciales: boolean;
  ttlSegundos: number | null;
  expiraEn: string | null;
}

export interface RegistrarCredencialesResponse {
  message: string;
  rfc: string;
  ttlSegundos: number;
  expiraEn: string;
  aviso: string;
}

export interface PeriodoFiscalSimple {
  _id: string;
  ejercicio: number;
  periodo: number | null;
  label?: string;
}

export interface DescargaManualParams {
  rfc: string;
  fechaInicio: string;
  fechaFin: string;
  tipoComprobante?: 'Emitidos' | 'Recibidos' | 'Ingresos' | 'Egresos' | 'Traslados' | 'Nomina' | 'Pagos';
  ejercicio: number;
  periodo: number;
}

export interface DescargaManualResponse {
  message: string;
  jobId: string;
  rfc: string;
}

export interface DescargaStatus {
  jobId: string;
  rfc: string;
  estado: 'en_proceso' | 'completado' | 'error';
  inicio: string;
  fechaInicio: string;
  fechaFin: string;
  tipoComprobante: string;
  paso?: number;   // progreso real reportado por el backend (0-5)
  fin?: string;
  error?: string;
}

export interface SatLimitesEstado {
  rfc: string;
  solicitudesHoy: number;
  activas: number;
  limiteDiario: number;
  limiteActivas: number;
  disponiblesHoy: number;
}

export interface HistorialSatEntry {
  fecha: string;
  total: number;
  coinciden: number;
  diferencias: number;
  errores: number;
  soloSAT: number;
  soloERP: number;
  estado: 'ok' | 'con_diferencias' | 'error';
}

export interface HistorialSatResponse {
  rfc: string;
  historial: HistorialSatEntry[];
}
