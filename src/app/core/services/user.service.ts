import { Injectable }   from '@angular/core';
import { HttpClient }   from '@angular/common/http';
import { Observable }   from 'rxjs';
import { environment }  from '../../../environments/environment';

/**
 * Registro de usuario tal como lo devuelve el backend (PostgreSQL via Sequelize).
 * `id` es el PK entero de la tabla `users`.
 */
export interface AppUserRecord {
  id:        number;
  auth0Sub:  string;
  nombre:    string;
  email:     string;
  role:      string;          // flexible: valor definido en src/shared/config/rbac.js
  isActive:  boolean;
  lastLogin: string | null;
  createdAt: string;
}

/** Rol con permisos retornado por GET /api/users/roles */
export interface RoleOption {
  value:       string;
  label:       string;
  permissions: string[];   // ['*'] = acceso total (admin)
  isSystem?:   boolean;
}

/** Permiso del catálogo retornado por GET /api/users/permissions */
export interface PermissionOption {
  key:    string;
  label:  string;
  module: string;
}

@Injectable({ providedIn: 'root' })
export class UserService {
  private api = `${environment.apiUrl}/users`;

  constructor(private http: HttpClient) {}

  listUsers(): Observable<AppUserRecord[]> {
    return this.http.get<AppUserRecord[]>(this.api);
  }

  // ── Roles ──────────────────────────────────────────────────────────────────

  getRoles(): Observable<RoleOption[]> {
    return this.http.get<RoleOption[]>(`${this.api}/roles`);
  }

  createRoleDef(data: { value: string; label: string; permissions: string[] }): Observable<RoleOption> {
    return this.http.post<RoleOption>(`${this.api}/roles`, data);
  }

  patchRoleDef(value: string, data: { label?: string; permissions?: string[] }): Observable<RoleOption> {
    return this.http.patch<RoleOption>(`${this.api}/roles/${value}`, data);
  }

  deleteRoleDef(value: string): Observable<{ message: string }> {
    return this.http.delete<{ message: string }>(`${this.api}/roles/${value}`);
  }

  // ── Permisos ────────────────────────────────────────────────────────────────

  getPermissions(): Observable<PermissionOption[]> {
    return this.http.get<PermissionOption[]>(`${this.api}/permissions`);
  }

  createPermDef(data: PermissionOption): Observable<PermissionOption> {
    return this.http.post<PermissionOption>(`${this.api}/permissions`, data);
  }

  deletePermDef(key: string): Observable<{ message: string }> {
    return this.http.delete<{ message: string }>(`${this.api}/permissions/${key}`);
  }

  // ── Usuarios ────────────────────────────────────────────────────────────────

  /** Actualiza el rol asignado a un usuario. */
  updateRole(id: number, role: string): Observable<AppUserRecord> {
    return this.http.patch<AppUserRecord>(`${this.api}/${id}/role`, { role });
  }

  toggleActive(id: number): Observable<AppUserRecord> {
    return this.http.patch<AppUserRecord>(`${this.api}/${id}/toggle`, {});
  }
}
