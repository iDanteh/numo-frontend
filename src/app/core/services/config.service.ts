import { Injectable }  from '@angular/core';
import { HttpClient }  from '@angular/common/http';
import { Observable }  from 'rxjs';
import { environment } from '../../../environments/environment';
import { ConfigSection, GlobalConfig, ConfigAuditLog, GlobalConfigTipo } from '../models/config.model';

@Injectable({ providedIn: 'root' })
export class ConfigService {
  private api = `${environment.apiUrl}/config`;

  constructor(private http: HttpClient) {}

  listSections(): Observable<ConfigSection[]> {
    return this.http.get<ConfigSection[]>(`${this.api}/sections`);
  }

  createSection(data: { clave: string; nombre: string; descripcion?: string; modulosAfectados?: string[] }): Observable<ConfigSection> {
    return this.http.post<ConfigSection>(`${this.api}/sections`, data);
  }

  /** Edita nombre/descripción/módulos afectados de una sección — la clave no se puede cambiar. */
  updateSection(id: number, data: { nombre: string; descripcion?: string; modulosAfectados?: string[] }): Observable<ConfigSection> {
    return this.http.put<ConfigSection>(`${this.api}/sections/${id}`, data);
  }

  listConfigsBySection(sectionId: number): Observable<GlobalConfig[]> {
    return this.http.get<GlobalConfig[]>(`${this.api}/sections/${sectionId}/configs`);
  }

  /** Crea o actualiza un valor por su clave natural (sectionClave+clave) — un valor
   *  nuevo todavía no tiene id numérico, por eso no se direcciona por id acá. */
  setValue(sectionClave: string, clave: string, data: {
    valor: string; esSecreto?: boolean; tipo?: GlobalConfigTipo; descripcion?: string;
  }): Observable<{ id: number }> {
    return this.http.put<{ id: number }>(`${this.api}/sections/${sectionClave}/configs/${clave}`, data);
  }

  /** Descifra y devuelve el valor real de un secreto — cada llamada queda auditada. */
  revealSecret(configId: number): Observable<{ valor: string }> {
    return this.http.post<{ valor: string }>(`${this.api}/${configId}/reveal`, {});
  }

  listAuditLog(configId: number): Observable<ConfigAuditLog[]> {
    return this.http.get<ConfigAuditLog[]>(`${this.api}/${configId}/audit`);
  }
}
