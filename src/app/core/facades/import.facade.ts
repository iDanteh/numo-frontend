import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { ImportService } from '../services/import.service';
import {
  UploadResult,
  DriveFoldersResponse,
  DriveImportParams,
  ErpApiImportParams,
  ImportSource,
} from '../models/import.model';

/**
 * Facade para operaciones de importación de CFDIs:
 * carga de archivos XML/ZIP, importación desde Excel y desde Google Drive.
 */
@Injectable({ providedIn: 'root' })
export class ImportFacade {
  constructor(private importService: ImportService) {}

  uploadFiles(files: File[], source: ImportSource, ejercicio?: number, periodo?: number): Observable<UploadResult> {
    return this.importService.uploadFiles(files, source, ejercicio, periodo);
  }

  importFromExcel(file: File, source: ImportSource, ejercicio?: number, periodo?: number): Observable<UploadResult> {
    return this.importService.importFromExcel(file, source, ejercicio, periodo);
  }

  importFromErpApi(params: ErpApiImportParams): Observable<UploadResult> {
    return this.importService.importFromErpApi(params);
  }

  runBatchComparison(): Observable<unknown> {
    return this.importService.runBatchComparison();
  }

  listDriveFolders(): Observable<DriveFoldersResponse> {
    return this.importService.listDriveFolders();
  }

  importFromDrive(params: DriveImportParams): Observable<UploadResult> {
    return this.importService.importFromDrive(params);
  }
}
