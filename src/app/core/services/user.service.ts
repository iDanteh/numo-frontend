import { Injectable }   from '@angular/core';
import { HttpClient }   from '@angular/common/http';
import { Observable }   from 'rxjs';
import { environment }  from '../../../environments/environment';

export interface AppUserRecord {
  _id:       string;
  auth0Sub:  string;
  nombre:    string;
  email:     string;
  role:      'admin' | 'contador' | 'viewer';
  isActive:  boolean;
  lastLogin: string | null;
  createdAt: string;
}

@Injectable({ providedIn: 'root' })
export class UserService {
  private api = `${environment.apiUrl}/users`;

  constructor(private http: HttpClient) {}

  listUsers(): Observable<AppUserRecord[]> {
    return this.http.get<AppUserRecord[]>(this.api);
  }

  updateRole(id: string, role: string): Observable<AppUserRecord> {
    return this.http.patch<AppUserRecord>(`${this.api}/${id}/role`, { role });
  }

  toggleActive(id: string): Observable<AppUserRecord> {
    return this.http.patch<AppUserRecord>(`${this.api}/${id}/toggle`, {});
  }
}
