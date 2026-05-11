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
  tipoSolicitud?: 'CFDI' | 'Metadata';
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
  paso?: number;
  fin?: string;
  error?: string;
  resultado?: {
    totalSAT: number;
    totalERP: number;
    coinciden: number;
    soloEnSAT: number;
    soloEnERP: number;
    conDiferencia: number;
    paquetes: number;
    totalReportadoSAT: number;
    incompleta: boolean;
  };
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
  tipo: 'automatica' | 'manual' | 'erp_automatica';
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
  totalReportadoSAT?: number;
  incompleta?: boolean;
  inicio: string;
  fin?: string;
}

export interface ErpDescargaEstado {
  _id: string;
  tipo: 'erp_automatica';
  estado: 'en_proceso' | 'completado' | 'error';
  ejercicio: number;
  periodo: number;
  inicio: string;
  fin?: string;
  totalSAT?: number;
  error?: string;
}

export interface UltimoErpResponse {
  log: ErpDescargaEstado | null;
}

export interface HistorialSatResponse {
  rfc: string | null;
  historial: HistorialSatEntry[];
}
