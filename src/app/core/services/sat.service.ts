import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';
import { ApiService } from './api.service';
import {
  SatCredencialesEstado,
  RegistrarCredencialesResponse,
  DescargaManualParams,
  DescargaManualResponse,
  DescargaStatus,
  SatLimitesEstado,
  HistorialSatResponse,
  PeriodoFiscalSimple,
  UltimoErpResponse,
} from '../models/sat.model';

@Injectable({ providedIn: 'root' })
export class SatService {
  private readonly base = environment.apiUrl;

  constructor(private http: HttpClient, private api: ApiService) {}

  /**
   * Sube .cer y .key como multipart con campos separados.
   * Usa HttpClient directamente porque ApiService.uploadFiles
   * no soporta múltiples campos con nombres distintos.
   * El AuthInterceptor inyecta el token automáticamente.
   */
  registrarCredenciales(
    rfc: string,
    cer: File,
    key: File,
    password: string
  ): Observable<RegistrarCredencialesResponse> {
    const fd = new FormData();
    fd.append('rfc', rfc);
    fd.append('password', password);
    fd.append('cer', cer);
    fd.append('key', key);
    return this.http.post<RegistrarCredencialesResponse>(`${this.base}/sat/credenciales`, fd);
  }

  estadoCredenciales(rfc: string): Observable<SatCredencialesEstado> {
    return this.api.get<SatCredencialesEstado>(`/sat/credenciales/estado/${encodeURIComponent(rfc)}`);
  }

  iniciarDescargaManual(params: DescargaManualParams): Observable<DescargaManualResponse> {
    return this.api.post<DescargaManualResponse>('/sat/descarga-manual', params);
  }

  statusDescarga(jobId: string): Observable<DescargaStatus> {
    return this.api.get<DescargaStatus>(`/sat/descarga-manual/status/${encodeURIComponent(jobId)}`);
  }

  getLimites(rfc: string): Observable<SatLimitesEstado> {
    return this.api.get<SatLimitesEstado>(`/sat/limites/${encodeURIComponent(rfc)}`);
  }

  ultimoErp(): Observable<UltimoErpResponse> {
    return this.api.get<UltimoErpResponse>('/sat/ultimo-erp');
  }

  historialSAT(rfc?: string): Observable<HistorialSatResponse> {
    const path = rfc ? `/sat/historial/${encodeURIComponent(rfc)}` : '/sat/historial';
    return this.api.get<HistorialSatResponse>(path);
  }

  listPeriodosFiscales(): Observable<{ data: PeriodoFiscalSimple[] }> {
    return this.api.get<{ data: PeriodoFiscalSimple[] }>('/periodos-fiscales');
  }

  verificarEstadoSAT(uuid: string, rfcEmisor: string, rfcReceptor: string, total: number, sello: string, version: string): Observable<{ uuid: string; satStatus: string; message?: string }> {
    return this.api.post<{ uuid: string; satStatus: string; message?: string }>('/sat/verify', { uuid, rfcEmisor, rfcReceptor, total, sello, version });
  }

  verificarBatch(uuids: string[]): Observable<{ message: string; total: number; found: number; notFound: number }> {
    return this.api.post<{ message: string; total: number; found: number; notFound: number }>('/sat/verify-batch', { uuids });
  }

  exportarXml(rfc: string, ejercicio: number, periodo: number): Observable<Blob> {
    return this.http.get(
      `${this.base}/sat/export-xml?rfc=${encodeURIComponent(rfc)}&ejercicio=${ejercicio}&periodo=${periodo}`,
      { responseType: 'blob' }
    );
  }
}
