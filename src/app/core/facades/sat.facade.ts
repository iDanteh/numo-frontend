import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { SatService } from '../services/sat.service';
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

/**
 * Facade para operaciones relacionadas con el SAT:
 * credenciales, descarga manual e historial.
 */
@Injectable({ providedIn: 'root' })
export class SatFacade {
  constructor(private satService: SatService) {}

  registrarCredenciales(
    rfc: string,
    cer: File,
    key: File,
    password: string,
  ): Observable<RegistrarCredencialesResponse> {
    return this.satService.registrarCredenciales(rfc, cer, key, password);
  }

  estadoCredenciales(rfc: string): Observable<SatCredencialesEstado> {
    return this.satService.estadoCredenciales(rfc);
  }

  iniciarDescargaManual(params: DescargaManualParams): Observable<DescargaManualResponse> {
    return this.satService.iniciarDescargaManual(params);
  }

  statusDescarga(jobId: string): Observable<DescargaStatus> {
    return this.satService.statusDescarga(jobId);
  }

  getLimites(rfc: string): Observable<SatLimitesEstado> {
    return this.satService.getLimites(rfc);
  }

  ultimoErp(): Observable<UltimoErpResponse> {
    return this.satService.ultimoErp();
  }

  historialSAT(rfc?: string): Observable<HistorialSatResponse> {
    return this.satService.historialSAT(rfc);
  }

  listPeriodosFiscales(): Observable<{ data: PeriodoFiscalSimple[] }> {
    return this.satService.listPeriodosFiscales();
  }

  verificarEstadoSAT(uuid: string, rfcEmisor: string, rfcReceptor: string, total: number, sello: string, version: string): Observable<{ uuid: string; satStatus: string; message?: string }> {
    return this.satService.verificarEstadoSAT(uuid, rfcEmisor, rfcReceptor, total, sello, version);
  }

  verificarBatch(uuids: string[]): Observable<{ message: string; total: number; found: number; notFound: number }> {
    return this.satService.verificarBatch(uuids);
  }

  exportarXml(rfc: string, ejercicio: number, periodo: number): Observable<Blob> {
    return this.satService.exportarXml(rfc, ejercicio, periodo);
  }
}
