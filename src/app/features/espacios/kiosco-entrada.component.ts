import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { filter, take } from 'rxjs/operators';
import { AuthService } from '../../core/services/auth.service';
import { EspaciosService } from '../../core/services/espacios.service';

/** Ruta de esta página (la usa el panel del kiosco como NUMO_URL_ENTRADA: …/#/espacios/kiosco). */
export const RUTA_ENTRADA_KIOSCO = '/espacios/kiosco';

/**
 * Entrada al panel del Kiosco de facturación cuando alguien abre el panel directo (no desde el
 * menú "Espacios de NUMO"): el kiosco lo manda aquí. Sin sesión → Auth0, que regresa a esta misma
 * página; sin kiosco:admin → /unauthorized; con todo → pide el pase y se va al panel.
 *
 * Sin AuthGuard a propósito: el guard manda a /login sin recordar a dónde iba, y después de iniciar
 * sesión la persona quedaba en el inicio de NUMO en vez de regresar al kiosco.
 */
@Component({
  standalone: true,
  selector: 'app-kiosco-entrada',
  imports: [CommonModule],
  template: `
    <main class="ke">
      <p *ngIf="!error" class="ke__texto" role="status">Abriendo el Kiosco de facturación…</p>
      <ng-container *ngIf="error">
        <p class="ke__texto" role="alert">{{ error }}</p>
        <button type="button" class="ke__btn" (click)="abrir()">Intentar de nuevo</button>
      </ng-container>
    </main>
  `,
  styles: [`
    .ke { min-height: 100vh; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 16px; padding: 16px; font-family: inherit; }
    .ke__texto { margin: 0; font-size: 16px; color: #334155; text-align: center; }
    .ke__btn { border: 0; border-radius: 8px; padding: 10px 18px; background: #4f46e5; color: #fff; font-weight: 600; cursor: pointer; }
  `],
})
export class KioscoEntradaComponent implements OnInit {
  error: string | null = null;

  constructor(
    private readonly auth: AuthService,
    private readonly espacios: EspaciosService,
    private readonly router: Router,
  ) {}

  async ngOnInit(): Promise<void> {
    await firstValueFrom(this.auth.isLoading$.pipe(filter(cargando => !cargando), take(1)));
    if (!(await firstValueFrom(this.auth.isAuthenticated$.pipe(take(1)))) || this.auth.isSessionExpired()) {
      this.auth.login(RUTA_ENTRADA_KIOSCO);
      return;
    }
    await firstValueFrom(this.auth.roleLoaded$.pipe(filter(cargado => cargado), take(1)));
    if (!this.auth.hasPermission('kiosco:admin')) {
      this.router.navigate(['/unauthorized']);
      return;
    }
    await this.abrir();
  }

  async abrir(): Promise<void> {
    this.error = null;
    try {
      this.espacios.irA(await this.espacios.pase('/espacios/kiosco/pase'));
    } catch {
      this.error = 'No se pudo abrir el Kiosco de facturación.';
    }
  }
}
