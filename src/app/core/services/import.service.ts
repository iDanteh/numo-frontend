import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiService } from './api.service';
import {
  UploadResult, DriveFoldersResponse, DriveImportParams, ErpApiImportParams,
} from '../models/import.model';

@Injectable({ providedIn: 'root' })
export class ImportService {
  constructor(private api: ApiService) {}

  uploadFiles(files: File[], source: string, ejercicio?: number, periodo?: number): Observable<UploadResult> {
    const extra: Record<string, string> = { source };
    if (ejercicio) extra['ejercicio'] = String(ejercicio);
    if (periodo)   extra['periodo']   = String(periodo);
    return this.api.uploadFiles<UploadResult>('/cfdis/upload', files, 'xmlFiles', extra);
  }

  listDriveFolders(): Observable<DriveFoldersResponse> {
    return this.api.get<DriveFoldersResponse>('/drive/folders');
  }

  importFromDrive(params: DriveImportParams): Observable<UploadResult> {
    return this.api.post<UploadResult>('/drive/import', params);
  }

  importFromExcel(file: File, source: string, ejercicio?: number, periodo?: number): Observable<UploadResult> {
    const extra: Record<string, string> = { source };
    if (ejercicio) extra['ejercicio'] = String(ejercicio);
    if (periodo)   extra['periodo']   = String(periodo);
    return this.api.uploadFiles<UploadResult>('/cfdis/import-excel', [file], 'excelFile', extra);
  }

  importFromErpApi(params: ErpApiImportParams): Observable<UploadResult> {
    return this.api.post<UploadResult>('/cfdis/import-erp-api', params);
  }

  runBatchComparison(): Observable<unknown> {
    return this.api.post('/comparisons/batch', {});
  }
}
