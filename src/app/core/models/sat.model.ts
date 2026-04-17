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
  _id: string;
  rfc: string;
  tipo: 'automatica' | 'manual';
  tipoComprobante: string;
  fechaInicio: string;
  fechaFin: string;
  ejercicio?: number;
  periodo?: number;
  estado: 'en_proceso' | 'completado' | 'error';
  error?: string;
  totalSAT: number;
  totalERP: number;
  coinciden: number;
  soloSAT: number;
  soloERP: number;
  diferencias: number;
  paquetes: number;
  inicio: string;
  fin?: string;
}

export interface HistorialSatResponse {
  rfc: string | null;
  historial: HistorialSatEntry[];
}
