import {
  Component,
  ElementRef,
  HostListener,
  Injector,
  Input,
  QueryList,
  ViewChild,
  ViewChildren,
  runInInjectionContext,
} from '@angular/core';
import { Router } from '@angular/router';
import { AuthService } from '../../../core/services/auth.service';
import { TransitionOverlayService } from '../transition-overlay/transition-overlay.service';
import { SPACES, Space } from '../../config/spaces.config';

/**
 * Dropdown "Espacios de NUMO" — reemplaza el click directo que antes vivía
 * en SidebarComponent.switchToLealtad() / LealtadShellComponent.switchToNumo().
 * Vive en SharedModule (igual que TransitionOverlayComponent) porque lo usan
 * AMBOS shells: SidebarComponent (Numo) con currentSpaceId="numo" y
 * LealtadShellComponent (Lealtad) con currentSpaceId="lealtad".
 *
 * El filtro por permiso vive ACÁ (no en cada shell) a propósito: así ambos
 * shells comparten exactamente la misma lógica de visibilidad en vez de
 * duplicarla (mismo criterio que ADMINISTRACION_NAV compartido).
 */
@Component({
  standalone: false,
  selector: 'app-space-switcher',
  templateUrl: './space-switcher.component.html',
  styleUrls: ['./space-switcher.component.css'],
})
export class SpaceSwitcherComponent {
  /** 'numo' | 'lealtad' — espacio donde vive este switcher. Marca/deshabilita
   *  esa entrada en el menú: no debe poder "cambiarse" a sí mismo. */
  @Input() currentSpaceId = '';

  /** Solo relevante en el shell de Numo (rail colapsable) — Lealtad no tiene
   *  modo colapsado, así que queda en false por default. */
  @Input() collapsed = false;

  @ViewChild('trigger', { static: true }) private readonly triggerRef!: ElementRef<HTMLButtonElement>;
  @ViewChildren('itemBtn') private readonly itemButtons!: QueryList<ElementRef<HTMLButtonElement>>;

  open = false;
  activeIndex = -1;
  panelTop = 0;
  panelLeft = 0;
  panelWidth = 0;

  constructor(
    public readonly auth: AuthService,
    private readonly router: Router,
    private readonly overlay: TransitionOverlayService,
    private readonly elementRef: ElementRef<HTMLElement>,
    private readonly injector: Injector,
  ) {}

  /** Espacios visibles para el usuario actual. Filtrado acá (no precalculado
   *  por cada shell) para no duplicar la lógica entre Numo y Lealtad. */
  get visibleSpaces(): Space[] {
    return SPACES.filter(s => !s.permission || this.auth.hasPermission(s.permission));
  }

  /** Espacio donde vive este switcher — fuente única para el trigger grande
   *  (logo/subtítulo), reemplaza el `ngSwitch` hardcodeado que antes repetía
   *  esta misma lógica acá y en el HTML (bug real: la rama 'lealtad' se
   *  había quedado con un ícono/texto genéricos en vez de los de Space). */
  get currentSpace(): Space | undefined {
    return SPACES.find(s => s.id === this.currentSpaceId);
  }

  isCurrent(space: Space): boolean {
    return space.id === this.currentSpaceId;
  }

  /** Fondo resaltado de la fila ACTUAL en el panel (accent del espacio al
   *  20% de opacidad) — vacío para las demás filas, así el CSS de hover
   *  normal sigue controlando su fondo. */
  rowBackground(space: Space): string {
    return this.isCurrent(space) ? this.hexToRgba(space.accent, 0.2) : '';
  }

  /** Color del ícono de check de la fila actual — blanco por default si el
   *  espacio no define uno propio. */
  checkColor(space: Space): string {
    return space.checkColor ?? '#fff';
  }

  private hexToRgba(hex: string, alpha: number): string {
    const normalized = hex.replace('#', '');
    const r = parseInt(normalized.substring(0, 2), 16);
    const g = parseInt(normalized.substring(2, 4), 16);
    const b = parseInt(normalized.substring(4, 6), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }

  toggle(): void {
    if (this.open) {
      this.close();
      return;
    }
    const rect = this.triggerRef.nativeElement.getBoundingClientRect();
    // position:fixed a propósito — mismo motivo que .sb__flyout/.nb__panel
    // (ver sus comentarios en sidebar.component.css/notification-bell.component.css):
    // .sb tiene overflow:hidden, así que position:absolute recortaría el panel.
    this.panelTop = rect.bottom + 4;
    this.panelLeft = rect.left;
    this.panelWidth = rect.width;
    this.open = true;
    this.activeIndex = -1;
  }

  close(): void {
    this.open = false;
    this.activeIndex = -1;
  }

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent): void {
    if (!this.open) return;
    const target = event.target as Node | null;
    if (target && !this.elementRef.nativeElement.contains(target)) {
      this.close();
    }
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    if (this.open) this.close();
  }

  onMenuKeydown(event: KeyboardEvent): void {
    const items = this.visibleSpaces;
    if (!items.length) return;

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      this.activeIndex = (this.activeIndex + 1) % items.length;
      this.focusActive();
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      this.activeIndex = (this.activeIndex - 1 + items.length) % items.length;
      this.focusActive();
    } else if (event.key === 'Enter') {
      const space = items[this.activeIndex];
      if (space) {
        event.preventDefault();
        this.select(space);
      }
    }
  }

  async select(space: Space): Promise<void> {
    if (this.isCurrent(space)) return;
    this.close();
    await this.overlay.play(space.transitionVariant);
    this.router.navigateByUrl(this.resolveRoute(space));
  }

  private resolveRoute(space: Space): string {
    return typeof space.route === 'string'
      ? space.route
      : runInInjectionContext(this.injector, space.route);
  }

  private focusActive(): void {
    this.itemButtons?.toArray()[this.activeIndex]?.nativeElement.focus();
  }
}
