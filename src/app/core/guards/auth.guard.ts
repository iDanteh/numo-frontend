import { Injectable }          from '@angular/core';
import { CanActivate, Router } from '@angular/router';
import { Observable }          from 'rxjs';
import { filter, switchMap, take, map } from 'rxjs/operators';
import { AuthService }         from '../services/auth.service';

@Injectable({ providedIn: 'root' })
export class AuthGuard implements CanActivate {

  constructor(private auth: AuthService, private router: Router) {}

  canActivate(): Observable<boolean> {
    // Espera a que Auth0 termine de verificar la sesión antes de decidir
    return this.auth.isLoading$.pipe(
      filter(loading => !loading),
      take(1),
      switchMap(() => this.auth.isAuthenticated$),
      take(1),
      map((authenticated: boolean) => {
        if (!authenticated) {
          this.router.navigate(['/login']);
          return false;
        }

        // Si la sesión expiró por inactividad, AuthService ya habrá llamado
        // logout({ openUrl: false }) y emitirá isAuthenticated = false en el
        // siguiente ciclo. Aquí capturamos el caso residual por si el guard
        // se ejecuta antes de que ese cambio llegue.
        if (this.auth.isSessionExpired()) {
          this.router.navigate(['/login']);
          return false;
        }

        return true;
      }),
    );
  }
}
