import { Component, OnInit } from '@angular/core';
import { Router }            from '@angular/router';
import { filter, switchMap, take } from 'rxjs/operators';
import { AuthService }       from '../../core/services/auth.service';

/**
 * LandingComponent — destino de la ruta raíz ('') y del wildcard ('**').
 *
 * A propósito NO es un guard: un canActivate en estas dos rutas (evaluadas de
 * forma síncrona durante el arranque del propio Router) que dependa de
 * AuthService (que a su vez inyecta Router) produce NG0200 — "Circular
 * dependency in DI detected for _Router" — porque el Router termina
 * pidiéndose a sí mismo mientras aún se está construyendo. LoginComponent ya
 * resuelve exactamente el mismo tipo de redirección (misma lógica de abajo)
 * sin ese problema, porque la instanciación de un componente ocurre en el
 * ciclo normal de render, no durante el bootstrap del Router — por eso este
 * archivo replica ese patrón en vez de usar un guard.
 */
@Component({
  standalone:  false,
  selector:    'app-landing',
  template:    `
    <div class="landing-loader">
      <div class="landing-spinner"></div>
    </div>
    <style>
      .landing-loader {
        position: fixed; inset: 0;
        display: flex; align-items: center; justify-content: center;
        background: #0f172a;
      }
      .landing-spinner {
        width: 36px; height: 36px;
        border: 3px solid rgba(99,102,241,.2);
        border-top-color: #6366f1;
        border-radius: 50%;
        animation: landing-spin .75s linear infinite;
      }
      @keyframes landing-spin { to { transform: rotate(360deg); } }
    </style>
  `,
})
export class LandingComponent implements OnInit {

  constructor(
    private auth:   AuthService,
    private router: Router,
  ) {}

  ngOnInit(): void {
    this.auth.isLoading$.pipe(
      filter(loading => !loading),
      take(1),
      switchMap(() => this.auth.isAuthenticated$),
      take(1),
    ).subscribe(isAuth => {
      if (!isAuth || this.auth.isSessionExpired()) {
        this.router.navigate(['/login']);
        return;
      }
      this.auth.roleLoaded$.pipe(
        filter(loaded => loaded),
        take(1),
      ).subscribe(() => {
        this.router.navigate([this.auth.getLandingPage()]);
      });
    });
  }
}
