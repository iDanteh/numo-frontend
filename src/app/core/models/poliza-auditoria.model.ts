// Monitor de pólizas (solo admin) — ver numo-backend/src/banks/domains/polizas/poliza-audit.service.js

export type AccionPoliza =
  | 'creada' | 'editada' | 'contabilizada' | 'cancelada' | 'revertida'
  | 'exportada' | 'exportada_xml_sat' | 'folio_contpaq' | 'cuenta_reemplazada';

export interface FiltrosAuditoria {
  desde?: string;   // YYYY-MM-DD (hora de México)
  hasta?: string;
  usuario?: string;
  accion?: string;
  tipo?: string;    // I/E/D/T/B/G o COB (Cobranza)
  q?: string;
  page?: number;
  limit?: number;
}

export interface ResumenUsuario {
  usuario: string;
  rol: string | null;
  total: number;
  ultimaActividad: string | null;
  acciones: Partial<Record<AccionPoliza, number>>;
}

export interface ActividadDia {
  dia: string;
  accion: AccionPoliza;
  total: number;
}

export interface RegistroAuditoria {
  id: number;
  polizaId: number | null;
  accion: AccionPoliza;
  usuarioNombre: string | null;
  usuarioRol: string | null;
  rfc: string | null;
  polizaTipo: string | null;
  polizaNumero: number | null;
  polizaFecha: string | null;
  polizaConcepto: string | null;
  ejercicio: number | null;
  periodo: number | null;
  estadoAnterior: string | null;
  estadoNuevo: string | null;
  motivo: string | null;
  detalle: Record<string, unknown> | null;
  origen: 'app' | 'historico';
  fecha: string;
}

export interface PaginaBitacora {
  total: number;
  page: number;
  limit: number;
  rows: RegistroAuditoria[];
}

export interface CancelacionAuditoria {
  id: number;
  polizaId: number | null;
  usuarioNombre: string | null;
  usuarioRol: string | null;
  rfc: string | null;
  polizaTipo: string | null;
  polizaNumero: number | null;
  polizaFecha: string | null;
  polizaConcepto: string | null;
  estadoAnterior: string | null;
  motivo: string | null;
  origen: 'app' | 'historico';
  fecha: string;
  creadoPor: string | null;
  creadaEn: string | null;
  regeneradaId: number | null;
  regeneradaNumero: number | null;
  regeneradaEstado: string | null;
  regeneradaPor: string | null;
  regeneradaEn: string | null;
}
