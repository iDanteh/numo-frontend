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
        }
        return authenticated;
      }),
    );
  }
}
