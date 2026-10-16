import { TestBed, ComponentFixture } from '@angular/core/testing';
import { NO_ERRORS_SCHEMA } from '@angular/core';
import { RouterModule } from '@angular/router';
import { LealtadShellComponent } from './lealtad-shell.component';
import { AuthService } from '../../../core/services/auth.service';
import { ADMINISTRACION_NAV } from '../../../shared/config/administracion-nav.config';
import { SIDEBAR_COLLAPSED_KEY } from '../../../shared/utils/sidebar-collapse';

// 2026-10-15 — bug real: `new LealtadShellComponent(...)` (abajo) nunca pasa
// por el compilador de templates de Angular, así que un error de sintaxis
// en el .html (NG5002: arrow function inline en un *ngIf) pasó los 475
// tests de Karma y solo lo atrapó `ng build --configuration=production`.
// Este bloque SÍ renderiza el template real vía TestBed — mismo tipo de
// gap que ya costó una regresión real en este proyecto (ver
// app.component.spec.ts / shim de authenticate sin is()/método).
describe('LealtadShellComponent — template real (TestBed, detecta NG5002/bindings rotos)', () => {
  let fixture: ComponentFixture<LealtadShellComponent>;

  beforeEach(async () => {
    const authStub = { hasPermission: () => true, getLandingPage: () => '/banks' };
    await TestBed.configureTestingModule({
      imports: [RouterModule.forRoot([])],
      declarations: [LealtadShellComponent],
      providers: [{ provide: AuthService, useValue: authStub }],
      schemas: [NO_ERRORS_SCHEMA], // lucideIcon/routerLink/app-space-switcher no son relevantes acá
    }).compileComponents();

    fixture = TestBed.createComponent(LealtadShellComponent);
  });

  it('compiles and renders the Administración section without throwing (NG5002 regression guard)', () => {
    expect(() => fixture.detectChanges()).not.toThrow();
    const text = fixture.nativeElement.textContent as string;
    expect(text).toContain('Administración');
    expect(text).toContain('Tarjetas');
  });
});

// Componente instanciado directo (sin TestBed) — mismo criterio que
// CollectionRequestComponent: la lógica bajo prueba acá (gating por permiso)
// es pura, no toca DOM/ciclo de vida de Angular. La navegación entre espacios
// (antes switchToNumo() acá) ahora vive en SpaceSwitcherComponent
// (shared/components/space-switcher/), que este shell solo monta con
// currentSpaceId="lealtad" — ver sus propios specs.
describe('LealtadShellComponent', () => {
  let auth: jasmine.SpyObj<AuthService>;
  let comp: LealtadShellComponent;

  beforeEach(() => {
    auth = jasmine.createSpyObj<AuthService>('AuthService', ['hasPermission', 'getLandingPage']);
    comp = new LealtadShellComponent(auth);
  });

  it('exposes the exact shared ADMINISTRACION_NAV config (spec: identical entries across both shells)', () => {
    expect(comp.administracion).toBe(ADMINISTRACION_NAV);
  });

  it('canSee(): true when no permissions are required', () => {
    expect(comp.canSee(undefined)).toBe(true);
    expect(comp.canSee([])).toBe(true);
  });

  it('canSee(): true when the user has at least one of the required permissions', () => {
    auth.hasPermission.and.callFake((p: string) => p === 'loyalty:config');
    expect(comp.canSee(['loyalty:read', 'loyalty:config'])).toBe(true);
  });

  it('canSee(): false when the user has none of the required permissions — gates "Configuración" from loyalty:config', () => {
    auth.hasPermission.and.returnValue(false);
    expect(comp.canSee(['loyalty:config'])).toBe(false);
  });

  // 2026-10-15 — bug real encontrado por el build de producción (NG5002):
  // Angular templates no admiten arrow functions inline (`.some(i => ...)`)
  // dentro de un *ngIf — el método de componente de abajo existe justo por
  // eso, no por preferencia de estilo.
  it('anyAdministracionVisible(): false when the user has none of the Administración permissions', () => {
    auth.hasPermission.and.returnValue(false);
    expect(comp.anyAdministracionVisible()).toBe(false);
  });

  it('anyAdministracionVisible(): true when the user has at least one Administración permission', () => {
    auth.hasPermission.and.callFake((p: string) => p === 'entities:read');
    expect(comp.anyAdministracionVisible()).toBe(true);
  });

  // 2026-10-16 — fix bug real: Administración linkeaba directo a las rutas
  // absolutas (/users, etc.), lo que sacaba al usuario del shell de Lealtad
  // (ver comentario de administracionLink() en el componente).
  it('administracionLink(): prefixes the shared ADMINISTRACION_NAV absolute route with /lealtad', () => {
    expect(comp.administracionLink({ label: 'Usuarios y Roles', icon: 'users', route: '/users' }))
      .toBe('/lealtad/users');
    expect(comp.administracionLink({ label: 'Configuraciones Globales', icon: 'settings', route: '/config' }))
      .toBe('/lealtad/config');
  });

  // sistema-lealtad: el usuario pidió que colapsar el rail en un espacio deje
  // el otro colapsado también — esto solo funciona si AMBOS shells leen y
  // escriben exactamente la MISMA key de localStorage (ver
  // shared/utils/sidebar-collapse.ts, también usado por SidebarComponent/Numo).
  describe('collapse state — shared localStorage key with SidebarComponent (Numo)', () => {
    afterEach(() => localStorage.removeItem(SIDEBAR_COLLAPSED_KEY));

    it('reads its initial collapsed state from SIDEBAR_COLLAPSED_KEY', () => {
      localStorage.setItem(SIDEBAR_COLLAPSED_KEY, 'true');
      const fresh = new LealtadShellComponent(auth);
      expect(fresh.collapsed).toBe(true);
    });

    it('toggle() flips collapsed and persists it under SIDEBAR_COLLAPSED_KEY', () => {
      localStorage.removeItem(SIDEBAR_COLLAPSED_KEY);
      expect(comp.collapsed).toBe(false);

      comp.toggle();

      expect(comp.collapsed).toBe(true);
      expect(localStorage.getItem(SIDEBAR_COLLAPSED_KEY)).toBe('true');
    });
  });
});
