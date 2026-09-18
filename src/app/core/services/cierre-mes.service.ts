import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiService } from './api.service';

export interface CierreMesHistoricoRow {
  id: number;
  periodoFiscalId: number | null;
  ejercicio: number;
  periodo: number | null;
  periodoLabel: string | null;
  rfcEmisor: string | null;
  filename: string;
  fileSize: number;
  cerradoPorId: number | null;
  cerradoPor?: { nombre: string; email: string } | null;
  createdAt: string;
}

@Injectable({ providedIn: 'root' })
export class CierreMesService {
  constructor(private api: ApiService) {}

  listCierres(): Observable<{ data: CierreMesHistoricoRow[] }> {
    return this.api.get<{ data: CierreMesHistoricoRow[] }>('/periodos-fiscales/cierres');
  }

  descargarCierre(id: number): Observable<Blob> {
    return this.api.downloadBlob(`/periodos-fiscales/cierres/${id}/descargar`);
  }
}
