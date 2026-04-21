import { Injectable, OnDestroy, Inject, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser }                          from '@angular/common';
import { HttpClient }                                 from '@angular/common/http';
import { AuthService as Auth0Service, User }          from '@auth0/auth0-angular';
import { BehaviorSubject, Observable }                from 'rxjs';
import { environment }                                from '../../../environments/environment';
import { SocketService }                              from './socket.service';

const NOMBRE_CLAIM          = 'https://cfdi-comparator/nombre';
const INACTIVITY_TIMEOUT_MS = 60 * 60 * 1000;   // 1 hora
const LAST_ACTIVE_KEY       = 'numo_last_active';
const AUTH_IN_PROGRESS_KEY  = 'numo_auth_in_progress';

export interface AppUser {
  id:          string;
  name:        string;
  email:       string;
  role:        string;
  permissions: string[];   // ['*'] = acceso total; [] = sin permisos cargados
  picture:     string | null;
}

const GUEST: AppUser = { id: '', name: '', email: '', role: 'tienda', permissions: [], picture: null };

/**
 * AuthService — wrapper sobre @auth0/auth0-angular.
 *
 * Tras autenticarse, consulta GET /api/users/me para obtener el rol real
 * almacenado en la base de datos. Expone roleLoaded$ para que los guards
 * esperen a tener el rol antes de decidir el acceso.
 *
 * Además gestiona el timeout de inactividad: si el usuario no ha tenido
 * actividad en la última hora (p. ej. cerró la ventana), se limpia la
 * sesión local y se le redirige al login.
 */
@Injectable({ providedIn: 'root' })
export class AuthService implements OnDestroy {

  private _isAuth    = false;
  private _isLoading = true;
  private _user: AppUser = GUEST;

  private _roleLoaded     = new BehaviorSubject<boolean>(false);
  private _activityTimer: ReturnType<typeof setInterval> | null = null;

  readonly isAuthenticated$: Observable<boolean>;
  readonly isLoading$:       Observable<boolean>;
  readonly roleLoaded$:      Observable<boolean> = this._roleLoaded.asObservable();

  constructor(
    private auth0:  Auth0Service,
    private http:   HttpClient,
    private socket: SocketService,
    @Inject(PLATFORM_ID) private platformId: object,
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
        // Si la sesión expiró por inactividad Y el usuario no acaba de
        // hacer login activo, cerrar la sesión local sin redirigir a Auth0.
        if (this.isSessionExpired() && !this.isAuthInProgress()) {
          this.auth0.logout({ openUrl: false });
          return;
        }
        // Login activo recién completado: establecer timestamp de inmediato
        // para que el guard no evalúe la sesión como expirada antes de que
        // loadDbRole() (async) tenga oportunidad de hacerlo.
        if (this.isAuthInProgress()) {
          this.refreshLastActive();
        }
        this.loadDbRole();
      } else {
        this._user = GUEST;
        this._roleLoaded.next(false);
        this.stopActivityTimer();
      }
    });
  }

  ngOnDestroy(): void {
    this.stopActivityTimer();
  }

  // ── Gestión de sesión por inactividad ─────────────────────────────────────

  /** Devuelve true si han pasado más de INACTIVITY_TIMEOUT_MS sin actividad. */
  isSessionExpired(): boolean {
    if (!isPlatformBrowser(this.platformId)) return false;
    const stored = localStorage.getItem(LAST_ACTIVE_KEY);
    if (!stored) return true;
    return Date.now() - Number(stored) > INACTIVITY_TIMEOUT_MS;
  }

  /** Actualiza el timestamp de última actividad. */
  refreshLastActive(): void {
    if (isPlatformBrowser(this.platformId)) {
      localStorage.setItem(LAST_ACTIVE_KEY, Date.now().toString());
    }
  }

  private isAuthInProgress(): boolean {
    if (!isPlatformBrowser(this.platformId)) return false;
    return sessionStorage.getItem(AUTH_IN_PROGRESS_KEY) === '1';
  }

  /** Refresca el timestamp cada 5 min mientras la sesión esté activa. */
  private startActivityTimer(): void {
    this.stopActivityTimer();
    this._activityTimer = setInterval(() => {
      if (this._isAuth) this.refreshLastActive();
    }, 5 * 60 * 1000);

    // Al cerrar la ventana, actualizar el timestamp una última vez
    if (isPlatformBrowser(this.platformId)) {
      window.addEventListener('beforeunload', this.onBeforeUnload);
    }
  }

  private stopActivityTimer(): void {
    if (this._activityTimer !== null) {
      clearInterval(this._activityTimer);
      this._activityTimer = null;
    }
    if (isPlatformBrowser(this.platformId)) {
      window.removeEventListener('beforeunload', this.onBeforeUnload);
    }
  }

  private readonly onBeforeUnload = (): void => {
    this.refreshLastActive();
  };

  // ── Lógica interna ────────────────────────────────────────────────────────

  private mapUser(u: User): AppUser {
    return {
      id:          u.sub ?? '',
      name:        (u[NOMBRE_CLAIM] as string) || u.nickname || '',
      email:       u.email ?? '',
      role:        'tienda',   // rol provisional; se sobreescribe con loadDbRole()
      permissions: [],
      picture:     u.picture ?? null,
    };
  }

  private loadDbRole(): void {
    // El login activo ya se completó; limpiar el flag de progreso
    if (isPlatformBrowser(this.platformId)) {
      sessionStorage.removeItem(AUTH_IN_PROGRESS_KEY);
    }

    this.http.get<{ role: string; nombre: string; permissions: string[] }>(`${environment.apiUrl}/users/me`).subscribe({
      next: (data) => {
        this._user = {
          ...this._user,
          role:        data.role,
          name:        data.nombre || this._user.name,
          permissions: data.permissions ?? [],
        };
        this.refreshLastActive();
        this.startActivityTimer();
        this._roleLoaded.next(true);
        this.initSocket();
      },
      error: () => {
        // Si falla la carga del rol, no bloquear la app — queda como tienda
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
      // Recargar permisos del nuevo rol
      this.http.get<{ role: string; nombre: string; permissions: string[] }>(`${environment.apiUrl}/users/me`).subscribe({
        next: (data) => { this._user = { ...this._user, permissions: data.permissions ?? [] }; },
      });
    });
  }

  // ── API pública ───────────────────────────────────────────────────────────

  get isLoading():       boolean  { return this._isLoading; }
  get isAuthenticated(): boolean  { return this._isAuth; }
  get currentUser():     AppUser  { return this._user; }

  login(): void {
    if (isPlatformBrowser(this.platformId)) {
      sessionStorage.setItem(AUTH_IN_PROGRESS_KEY, '1');
    }
    this.auth0.loginWithRedirect();
  }

  logout(): void {
    if (isPlatformBrowser(this.platformId)) {
      localStorage.removeItem(LAST_ACTIVE_KEY);
      sessionStorage.removeItem(AUTH_IN_PROGRESS_KEY);
    }
    this.stopActivityTimer();
    this.auth0.logout({ logoutParams: { returnTo: window.location.origin } });
  }

  hasRole(...roles: string[]): boolean {
    return roles.includes(this._user.role);
  }

  /** Devuelve true si el rol del usuario tiene el permiso indicado. */
  hasPermission(permission: string): boolean {
    const perms = this._user.permissions ?? [];
    return perms.includes('*') || perms.includes(permission);
  }

  getAccessToken(): Observable<string> {
    return this.auth0.getAccessTokenSilently();
  }
}
