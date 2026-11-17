import { Component, OnInit } from '@angular/core';
import { Router }            from '@angular/router';
import { filter, switchMap, take } from 'rxjs/operators';
import { AuthService }       from '../../core/services/auth.service';
import { TransitionOverlayService } from '../../shared/components/transition-overlay/transition-overlay.service';

@Component({
  standalone:   false,
  selector:     'app-login',
  templateUrl: './login.component.html',
})
export class LoginComponent implements OnInit {
  loading = false;
  readonly currentYear = new Date().getFullYear();

  constructor(
    private auth:    AuthService,
    private router:  Router,
    private overlay: TransitionOverlayService,
  ) {}

  ngOnInit(): void {
    // Solo redirigir si hay sesión activa Y no ha expirado por inactividad.
    // Espera a que el rol esté cargado antes de navegar, para que la ruta
    // destino sea la correcta según los permisos reales del usuario.
    this.auth.isLoading$.pipe(
      filter(loading => !loading),
      take(1),
      switchMap(() => this.auth.isAuthenticated$),
      take(1),
    ).subscribe(isAuth => {
      if (isAuth && !this.auth.isSessionExpired()) {
        this.auth.roleLoaded$.pipe(
          filter(loaded => loaded),
          take(1),
        ).subscribe(async () => {
          const landing = this.auth.getLandingPage();
          // Mismo telón que el space-switcher (2026-11-17, pedido explícito del usuario) — ver
          // landing.component.ts, mismo criterio exacto para el otro punto de entrada real.
          if (landing === '/lealtad') await this.overlay.play('to-lealtad');
          this.router.navigate([landing]);
        });
      }
    });
  }

  login(): void {
    this.loading = true;
    this.auth.login(); // Redirige a Auth0 Universal Login (no retorna)
  }
}
