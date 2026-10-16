import { Component } from '@angular/core';
import { AuthService } from '../../../core/services/auth.service';
import { ADMINISTRACION_NAV, NavItem } from '../../../shared/config/administracion-nav.config';
import { readSidebarCollapsed, writeSidebarCollapsed } from '../../../shared/utils/sidebar-collapse';

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

  // 'Configuración' (loyalty:config) ya NO es una ruta propia de Lealtad —
  // 2026-10-16: se centralizó dentro de "Configuraciones Globales" (ver
  // config-admin.component.ts), accesible como /lealtad/config sin salir
  // de este shell gracias a las rutas espejo de administracionLink().
  readonly navItems: NavItem[] = [
    { label: 'Tarjetas', icon: 'credit-card', route: '/lealtad/tarjetas' },
  ];

  // Mismo origen que SidebarComponent (shared/utils/sidebar-collapse.ts) —
  // el usuario pidió que colapsar el rail en un espacio deje el otro
  // colapsado también: ambos shells leen/escriben la MISMA key.
  collapsed = readSidebarCollapsed();

  constructor(
    public auth: AuthService,
  ) {}

  toggle(): void {
    this.collapsed = !this.collapsed;
    writeSidebarCollapsed(this.collapsed);
  }

  /** Returns true if the user has at least one of the required permissions.
   *  No permissions specified → always visible. Same contract as
   *  SidebarComponent.canSee() (Numo shell). */
  canSee(permissions?: string[]): boolean {
    if (!permissions?.length) return true;
    return permissions.some(p => this.auth.hasPermission(p));
  }

  /** 2026-10-16 — fix bug real: ADMINISTRACION_NAV trae rutas ABSOLUTAS
   *  (/users, /entities, /config, /system-monitor) porque las comparte con
   *  SidebarComponent (shell global de Numo), que debe seguir linkeando tal
   *  cual (NO se toca administracion-nav.config.ts ni sidebar.component.*).
   *  Pero LealtadShellComponent es el padre de las rutas hijas de Lealtad y
   *  AppComponent decide qué shell mostrar puramente por el path — así que
   *  navegar a la ruta absoluta desde acá saca al usuario de /lealtad/** y
   *  lo "rebota" al shell global. Prefijando con '/lealtad' SOLO en este
   *  shell, el link cae en las rutas espejo agregadas en
   *  lealtad-routing.module.ts (mismos módulos/guard/permisos) y el usuario
   *  nunca sale del espacio Lealtad. */
  administracionLink(item: NavItem): string {
    return '/lealtad' + item.route;
  }

  /** Oculta la sección completa "Administración" si ningún ítem es visible
   *  (mismo criterio que SidebarComponent.sectionVisible() en el shell de
   *  Numo). Angular templates no admiten arrow functions inline (NG5002),
   *  así que esta comprobación vive en el componente, no en el `*ngIf`. */
  anyAdministracionVisible(): boolean {
    return this.administracion.items.some(i => this.canSee(i.permissions));
  }
}
