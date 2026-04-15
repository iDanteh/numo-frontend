export type ImportSource = 'ERP' | 'SAT' | 'MANUAL';

export interface UploadResultItem {
  uuid: string;
  filename?: string;
  nuevo: boolean;
  satStatus: string | null;
  lastComparisonStatus: string | null;
}

export interface UploadResult {
  message: string;
  procesados: number;
  nuevos: number;
  actualizados: number;
  omitidos?: number;
  errores: Array<{ filename: string; error: string }>;
  duplicados: Array<{ uuid: string; filename: string }>;
  success: UploadResultItem[];
}

export interface DriveFolderItem {
  id: string;
  name: string;
}

export interface DriveFoldersResponse {
  folders: DriveFolderItem[];
}

export interface DriveImportParams {
  folderId: string;
  source: 'ERP' | 'SAT' | 'MANUAL';
  ejercicio: number;
  periodo: number;
}

/** Parámetros para importar CFDIs desde el endpoint REST del ERP */
export interface ErpApiImportParams {
  erpUrl: string;
  ejercicio: number;
  periodo: number;
  /** Headers adicionales que requiera el ERP (ej. Authorization) */
  erpHeaders?: Record<string, string>;
}

/** Constante: clave localStorage para guardar la URL del ERP (legacy) */
export const ERP_API_URL_KEY = 'cfdi_erp_api_url';

export type ErpStatusFiltro = 'Timbrado' | 'Cancelado' | 'Habilitado' | 'Deshabilitado' | 'Cancelacion Pendiente';
export type ErpTipoFiltro = 'I' | 'E' | 'P' | 'N';

/** Parámetros para cargar CFDIs desde el ERP integrado (POST /api/erp/cargar) */
export interface ErpCargaParams {
  ejercicio: number;
  periodo: number;
  /** Si viene vacío o undefined, se importan todos los estatus */
  estatusFiltro?: ErpStatusFiltro[];
  /** Si viene vacío o undefined, se importan todos los tipos */
  tipoFiltro?: ErpTipoFiltro[];
}

/** Resumen de la carga desde ERP */
export interface ErpCargaResult {
  totalRecibidos: number;
  nuevosInsertados: number;
  duplicados: number;
  errores: number;
  detalleErrores: Array<{ uuid: string | null; error: string }>;
  message: string;
}
