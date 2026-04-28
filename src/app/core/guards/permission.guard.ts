import { Injectable } from '@angular/core';
import { CanActivate, ActivatedRouteSnapshot, Router } from '@angular/router';
import { Observable } from 'rxjs';
import { filter, map, switchMap, take } from 'rxjs/operators';
import { AuthService } from '../services/auth.service';

/**
 * PermissionGuard — protege rutas por permiso en lugar de por nombre de rol.
 *
 * Uso en routing:
 *   {
 *     path: 'users',
 *     canActivate: [AuthGuard, PermissionGuard],
 *     data: { permissions: ['users:manage'] },
 *     ...
 *   }
 *
 * Ventaja vs RoleGuard: al agregar un nuevo rol con el permiso 'users:manage',
 * automáticamente obtiene acceso sin tocar el archivo de rutas.
 */
@Injectable({ providedIn: 'root' })
export class PermissionGuard implements CanActivate {

  constructor(private auth: AuthService, private router: Router) {}

  canActivate(route: ActivatedRouteSnapshot): Observable<boolean> {
    const required: string[] = route.data['permissions'] ?? [];

    return this.auth.isLoading$.pipe(
      filter(loading => !loading),
      take(1),
      switchMap(() => this.auth.roleLoaded$),
      filter(loaded => loaded),
      take(1),
      map(() => {
        if (!this.auth.isAuthenticated) {
          this.router.navigate(['/login']);
          return false;
        }
        if (required.length === 0 || required.some(p => this.auth.hasPermission(p))) {
          return true;
        }
        this.router.navigate(['/unauthorized']);
        return false;
      }),
    );
  }
}
