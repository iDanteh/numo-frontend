import { TestBed, ComponentFixture } from '@angular/core/testing';
import { NO_ERRORS_SCHEMA } from '@angular/core';
import { RouterModule } from '@angular/router';
import { LealtadShellComponent } from './lealtad-shell.component';
import { AuthService } from '../../../core/services/auth.service';
import { TransitionOverlayService } from '../../../shared/components/transition-overlay/transition-overlay.service';
import { ADMINISTRACION_NAV } from '../../../shared/config/administracion-nav.config';

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
      schemas: [NO_ERRORS_SCHEMA], // lucideIcon/routerLink no son relevantes acá
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
// CollectionRequestComponent: la lógica bajo prueba acá (gating por permiso,
// orden overlay→navegación) es pura, no toca DOM/ciclo de vida de Angular.
describe('LealtadShellComponent', () => {
  let auth: jasmine.SpyObj<AuthService>;
  let router: jasmine.SpyObj<any>;
  let overlay: jasmine.SpyObj<TransitionOverlayService>;
  let comp: LealtadShellComponent;

  beforeEach(() => {
    auth = jasmine.createSpyObj<AuthService>('AuthService', ['hasPermission', 'getLandingPage']);
    router = jasmine.createSpyObj('Router', ['navigateByUrl']);
    overlay = jasmine.createSpyObj<TransitionOverlayService>('TransitionOverlayService', ['play']);
    overlay.play.and.returnValue(Promise.resolve());
    comp = new LealtadShellComponent(auth, router, overlay);
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

  it('switchToNumo(): plays the "to-numo" transition BEFORE navigating to the user landing page', async () => {
    auth.getLandingPage.and.returnValue('/banks');
    const callOrder: string[] = [];
    overlay.play.and.callFake((v: any) => { callOrder.push(`play:${v}`); return Promise.resolve(); });
    router.navigateByUrl.and.callFake((url: string) => { callOrder.push(`nav:${url}`); return Promise.resolve(true); });

    await comp.switchToNumo();

    expect(overlay.play).toHaveBeenCalledWith('to-numo');
    expect(router.navigateByUrl).toHaveBeenCalledWith('/banks');
    expect(callOrder).toEqual(['play:to-numo', 'nav:/banks']);
  });
});
