import { Component } from '@angular/core';
import { Router } from '@angular/router';
import { AuthService } from '../../../core/services/auth.service';
import { TransitionOverlayService } from '../../../shared/components/transition-overlay/transition-overlay.service';
import { ADMINISTRACION_NAV, NavItem } from '../../../shared/config/administracion-nav.config';

/**
 * Shell propio de Lealtad (amber) — su propio sidebar + <router-outlet>
 * anidado para tarjetas/configuración. Vive detrás de /lealtad (guardado
 * por loyalty:read en app-routing.module.ts); /lealtad/consulta (pública)
 * NUNCA pasa por acá.
 */
@Component({
  standalone: false,
  selector: 'app-lealtad-shell',
  templateUrl: './lealtad-shell.component.html',
  styleUrls: ['./lealtad-shell.component.css'],
})
export class LealtadShellComponent {
  // Mismo origen que SidebarComponent (Numo) — spec "Shared Administración
  // Section": ambos shells deben listar exactamente los mismos ítems.
  readonly administracion = ADMINISTRACION_NAV;

  readonly navItems: NavItem[] = [
    { label: 'Tarjetas',       icon: 'credit-card', route: '/lealtad/tarjetas' },
    { label: 'Configuración',  icon: 'settings',     route: '/lealtad/configuracion', permissions: ['loyalty:config'] },
  ];

  constructor(
    public auth: AuthService,
    private readonly router: Router,
    private readonly overlay: TransitionOverlayService,
  ) {}

  /** Returns true if the user has at least one of the required permissions.
   *  No permissions specified → always visible. Same contract as
   *  SidebarComponent.canSee() (Numo shell). */
  canSee(permissions?: string[]): boolean {
    if (!permissions?.length) return true;
    return permissions.some(p => this.auth.hasPermission(p));
  }

  /** Oculta la sección completa "Administración" si ningún ítem es visible
   *  (mismo criterio que SidebarComponent.sectionVisible() en el shell de
   *  Numo). Angular templates no admiten arrow functions inline (NG5002),
   *  así que esta comprobación vive en el componente, no en el `*ngIf`. */
  anyAdministracionVisible(): boolean {
    return this.administracion.items.some(i => this.canSee(i.permissions));
  }

  /** Space-switcher: logo click → plays the Lealtad→Numo SVG transition,
   *  THEN navigates back to the user's Numo landing page (spec
   *  "Space-Switcher Navigation" — "Switching from Lealtad back to Numo"). */
  async switchToNumo(): Promise<void> {
    await this.overlay.play('to-numo');
    this.router.navigateByUrl(this.auth.getLandingPage());
  }
}
