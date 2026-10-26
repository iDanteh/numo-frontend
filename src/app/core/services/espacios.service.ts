import { Injectable } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { ApiService } from './api.service';

/**
 * "Espacios de NUMO" que viven en otra aplicación (ver spaces.config.ts, campo `pase`).
 * El backend revisa el permiso del espacio y responde la url de destino con un pase
 * de un solo uso (60 s) en el fragmento (#), que no viaja a ningún servidor.
 */
@Injectable({ providedIn: 'root' })
export class EspaciosService {
  constructor(private readonly api: ApiService) {}

  async pase(endpoint: string): Promise<string> {
    const { url } = await firstValueFrom(this.api.post<{ url: string }>(endpoint, {}));
    // Solo https: una url rara del backend no debe poder llevar a javascript: ni a http.
    if (!/^https:\/\//.test(url)) throw new Error('url de destino inválida');
    return url;
  }

  /** Mismo tab: el pase vence en 60 s y no debe quedarse en otra pestaña abierta. */
  irA(url: string): void {
    window.location.assign(url);
  }
}
