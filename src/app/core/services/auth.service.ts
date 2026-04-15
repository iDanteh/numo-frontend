import { Injectable }                       from '@angular/core';
import { HttpClient }                        from '@angular/common/http';
import { AuthService as Auth0Service, User } from '@auth0/auth0-angular';
import { BehaviorSubject, Observable }       from 'rxjs';
import { environment }                       from '../../../environments/environment';
import { SocketService }                     from './socket.service';

const NOMBRE_CLAIM = 'https://cfdi-comparator/nombre';

export interface AppUser {
  id:      string;
  name:    string;
  email:   string;
  role:    string;
  picture: string | null;
}

const GUEST: AppUser = { id: '', name: '', email: '', role: 'viewer', picture: null };

/**
 * AuthService — wrapper sobre @auth0/auth0-angular.
 *
 * Tras autenticarse, consulta GET /api/users/me para obtener el rol real
 * almacenado en la base de datos. Expone roleLoaded$ para que los guards
 * esperen a tener el rol antes de decidir el acceso.
 */
@Injectable({ providedIn: 'root' })
export class AuthService {

  private _isAuth    = false;
  private _isLoading = true;
  private _user: AppUser = GUEST;

  private _roleLoaded = new BehaviorSubject<boolean>(false);

  readonly isAuthenticated$: Observable<boolean>;
  readonly isLoading$:       Observable<boolean>;
  readonly roleLoaded$:      Observable<boolean> = this._roleLoaded.asObservable();

  constructor(
    private auth0:  Auth0Service,
    private http:   HttpClient,
    private socket: SocketService,
  ) {
    this.isAuthenticated$ = this.auth0.isAuthenticated$;
    this.isLoading$       = this.auth0.isLoading$;

    this.auth0.isLoading$.subscribe(v => (this._isLoading = v));

    this.auth0.user$.subscribe(u => {
      this._user = u ? this.mapUser(u) : GUEST;
    });

    this.auth0.isAuthenticated$.subscribe(authenticated => {
      this._isAuth = authenticated;
      if (authenticated) {
        this.loadDbRole();
      } else {
        this._user = GUEST;
        this._roleLoaded.next(false);
      }
    });
  }

  private mapUser(u: User): AppUser {
    return {
      id:      u.sub ?? '',
      name:    (u[NOMBRE_CLAIM] as string) || u.nickname || '',
      email:   u.email ?? '',
      role:    'viewer',   // rol provisional; se sobreescribe con loadDbRole()
      picture: u.picture ?? null,
    };
  }

  private loadDbRole(): void {
    this.http.get<{ role: string; nombre: string }>(`${environment.apiUrl}/users/me`).subscribe({
      next: (data) => {
        this._user = {
          ...this._user,
          role:  data.role,
          name:  data.nombre || this._user.name,
        };
        this._roleLoaded.next(true);
        this.initSocket();
      },
      error: () => {
        // Si falla la carga del rol, no bloquear la app — queda como viewer
        this._roleLoaded.next(true);
      },
    });
  }

  private initSocket(): void {
    this.socket.connect();
    if (this._user.id) {
      this.socket.identify(this._user.id);
    }
    this.socket.roleUpdated$.subscribe(({ role }) => {
      this._user = { ...this._user, role };
    });
  }

  get isLoading():       boolean  { return this._isLoading; }
  get isAuthenticated(): boolean  { return this._isAuth; }
  get currentUser():     AppUser  { return this._user; }

  login(): void {
    this.auth0.loginWithRedirect();
  }

  logout(): void {
    this.auth0.logout({ logoutParams: { returnTo: window.location.origin } });
  }

  hasRole(...roles: string[]): boolean {
    return roles.includes(this._user.role);
  }

  getAccessToken(): Observable<string> {
    return this.auth0.getAccessTokenSilently();
  }
}
