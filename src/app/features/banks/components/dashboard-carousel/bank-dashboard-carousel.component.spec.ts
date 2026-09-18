import { TestBed } from '@angular/core/testing';
import { CommonModule } from '@angular/common';
import { of } from 'rxjs';

import { BankDashboardCarouselComponent } from './bank-dashboard-carousel.component';
import { BankIndicadoresPanelComponent } from '../indicadores-panel/bank-indicadores-panel.component';
import { BankCobranzaPanelComponent } from '../cobranza-panel/bank-cobranza-panel.component';
import { DateRangePopoverComponent } from '../../../../shared/components/date-range-popover/date-range-popover.component';
import { CollectionRequestService, CollectionRequestIndicadores } from '../../../../core/services/collection-request.service';
import { BankService } from '../../../../core/services/bank.service';
import { BankIndicadoresIdentificacion } from '../../../../core/models/bank.model';
import { AuthService } from '../../../../core/services/auth.service';
import { UserService } from '../../../../core/services/user.service';
import { ToastService } from '../../../../core/services/toast.service';

// 2026-08-20 (2da corrección): BankIndicadoresPanelComponent ya no llama a
// BankService#indicadores() (el indicador general/backlog/"por usuario" se eliminó del
// panel) — ahora llama a CollectionRequestService#indicadores(), ver
// bank-indicadores-panel.component.ts. Este spec se actualiza para mockear esa
// dependencia real en vez de la anterior.
//
// 2026-09-03: `porUsuario` se eliminó de CollectionRequestIndicadores (la tabla "Por
// contador" desapareció del panel) — se saca del fixture. BankIndicadoresPanelComponent
// ahora también inyecta AuthService (para el scoping admin/no-admin y el renglón de
// contexto de la distribución) — se mockea acá con el mismo patrón que
// banks.component.spec.ts (authSpy con hasRole/currentUser).
//
// 2026-09-07: BankIndicadoresPanelComponent ahora también inyecta UserService (filtro
// admin por contador, GET /api/users) — se mockea con listUsers() -> of([]) para que el
// TestBed no intente resolver el HttpClient real del UserService de verdad (no está
// provisto acá). authSpy.hasRole() de este spec devuelve `true` sin importar el rol
// pedido, así que ngOnInit SÍ entra a la rama admin y llama a listUsers() — con [] como
// respuesta, contadoresDisponibles queda vacío y el bloque *ngIf del filtro no se
// renderiza, sin afectar ninguna aserción existente de este archivo.
//
// 2026-09-07 (mismo día, fix real del bug 1): ngOnInit ahora también llama a
// CollectionRequestService#contadoresConSolicitudes() en paralelo (forkJoin) con
// listUsers() — se mockea con of({ userIds: [] }) por el mismo motivo que listUsers()
// arriba: sin esto, el forkJoin real intentaría llamar un método inexistente en el spy.
const INDICADORES_VACIO: CollectionRequestIndicadores = {
  totalSolicitudesResueltas: 0,
  sinMovimientoVinculado: 0,
  total:         { promedioHoras: null, medianaHoras: null, count: 0 },
  fase1Banco:    { promedioHoras: null, medianaHoras: null, count: 0 },
  fase2Contador: { promedioHoras: null, medianaHoras: null, count: 0 },
  distribucionTotal: [],
};

const COBRANZA_INDICADORES_VACIO: BankIndicadoresIdentificacion = {
  promedioHoras: null,
  medianaHoras: null,
  totalIdentificadosConDato: 0,
  backlog: { menos24h: 0, de1a3d: 0, de3a7d: 0, mas7d: 0 },
  porUsuario: [],
};

const STORAGE_KEY = BankDashboardCarouselComponent.STORAGE_KEY;

describe('BankDashboardCarouselComponent — carousel de 3 slides (TestBed, Chrome real vía Karma)', () => {
  let crServiceSpy: jasmine.SpyObj<CollectionRequestService>;
  let bankServiceSpy: jasmine.SpyObj<BankService>;
  let component: BankDashboardCarouselComponent;
  let fixture: import('@angular/core/testing').ComponentFixture<BankDashboardCarouselComponent>;
  // 2026-09-18: hoisted (antes vivía como `const` dentro de beforeEach) para que los tests
  // de visibilidad por rol (cobranza vs. cualquier otro) puedan pisar hasRole() antes de
  // crear el fixture. `.callFake` en vez de `.returnValue(true)` fijo — ahora que
  // BankDashboardCarouselComponent llama `auth.hasRole('cobranza')` para el gate de la
  // pestaña "Solicitudes de Cobro", un `true` incondicional rompería TODOS los tests
  // existentes de ese slide (el botón/slide dejarían de existir en el DOM). Por default
  // (rol 'admin', igual que currentUser.role de abajo) sigue devolviendo true para
  // hasRole('admin') — mismo comportamiento que ya esperaban los tests existentes de
  // BankIndicadoresPanelComponent (su propio filtro admin) — y false para
  // hasRole('cobranza'), que es lo correcto para un rol 'admin' real.
  let authSpy: { hasRole: jasmine.Spy; hasPermission: jasmine.Spy; currentUser: { name: string; role: string } };

  beforeEach(async () => {
    localStorage.removeItem(STORAGE_KEY);

    crServiceSpy = jasmine.createSpyObj<CollectionRequestService>('CollectionRequestService', ['indicadores', 'indicadoresDistribucion', 'contadoresConSolicitudes']);
    crServiceSpy.indicadores.and.returnValue(of(INDICADORES_VACIO));
    crServiceSpy.indicadoresDistribucion.and.returnValue(of({ desde: '', hasta: '', total: 0, distribucionTotal: [] }));
    crServiceSpy.contadoresConSolicitudes.and.returnValue(of({ userIds: [] }));

    // BankService — dependencia real del slide 3 (BankCobranzaPanelComponent, 2026-09-17).
    // `hasPermission('banks:config')` de authSpy abajo devuelve true (mismo criterio que
    // hasRole), así que su ngOnInit SÍ entra a la rama de filtro y llama a
    // usuariosConIdentificaciones() + listUsers() — con [] alcanza para no romper el forkJoin.
    // `reporteIndicadores` (2026-09-18, rango de días + descarga) se mockea también aunque
    // este spec no lo ejercite — BankCobranzaPanelComponent lo inyecta vía BankService real.
    bankServiceSpy = jasmine.createSpyObj<BankService>('BankService', ['indicadores', 'usuariosConIdentificaciones', 'reporteIndicadores']);
    bankServiceSpy.indicadores.and.returnValue(of(COBRANZA_INDICADORES_VACIO));
    bankServiceSpy.usuariosConIdentificaciones.and.returnValue(of({ userIds: [] }));

    authSpy = {
      hasRole:       jasmine.createSpy('hasRole').and.callFake((...roles: string[]) => roles.includes('admin')),
      hasPermission: jasmine.createSpy('hasPermission').and.returnValue(true),
      currentUser: { name: 'Ana Torres', role: 'admin' },
    };

    const userServiceSpy = jasmine.createSpyObj<UserService>('UserService', ['listUsers']);
    userServiceSpy.listUsers.and.returnValue(of([]));

    const toastServiceSpy = jasmine.createSpyObj<ToastService>('ToastService', ['success', 'error']);

    await TestBed.configureTestingModule({
      imports: [CommonModule],
      declarations: [
        BankDashboardCarouselComponent, BankIndicadoresPanelComponent, BankCobranzaPanelComponent,
        DateRangePopoverComponent,
      ],
      providers: [
        { provide: CollectionRequestService, useValue: crServiceSpy },
        { provide: BankService, useValue: bankServiceSpy },
        { provide: AuthService, useValue: authSpy },
        { provide: UserService, useValue: userServiceSpy },
        { provide: ToastService, useValue: toastServiceSpy },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(BankDashboardCarouselComponent);
    component = fixture.componentInstance;

    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  });

  afterEach(() => {
    localStorage.removeItem(STORAGE_KEY);
  });

  it("arranca en el slide 'kpi' por default (sin nada en localStorage)", () => {
    expect(component.activeSlide).toBe('kpi');
    expect(crServiceSpy.indicadores).not.toHaveBeenCalled();
  });

  it("cambiar a 'indicadores' dispara CollectionRequestService.indicadores() una sola vez (fetch perezoso)", () => {
    expect(crServiceSpy.indicadores).not.toHaveBeenCalled();

    component.selectSlide('indicadores');
    fixture.detectChanges();

    expect(component.activeSlide).toBe('indicadores');
    expect(crServiceSpy.indicadores).toHaveBeenCalledTimes(1);
  });

  it('cambiar de slide y volver NO vuelve a llamar al servicio si los filtros no cambiaron (cacheado)', () => {
    component.selectSlide('indicadores');
    fixture.detectChanges();
    expect(crServiceSpy.indicadores).toHaveBeenCalledTimes(1);

    component.selectSlide('kpi');
    fixture.detectChanges();
    component.selectSlide('indicadores');
    fixture.detectChanges();

    expect(crServiceSpy.indicadores).toHaveBeenCalledTimes(1);
  });

  it('cambiar year mientras el slide 2 está activo SÍ dispara una nueva llamada, con el year nuevo', () => {
    component.selectSlide('indicadores');
    fixture.detectChanges();
    expect(crServiceSpy.indicadores).toHaveBeenCalledTimes(1);

    fixture.componentRef.setInput('year', 2027);
    fixture.detectChanges();

    expect(crServiceSpy.indicadores).toHaveBeenCalledTimes(2);
    expect(crServiceSpy.indicadores.calls.mostRecent().args[0]).toBe(2027);
  });

  it('cambiar un filtro mientras el slide 2 está INACTIVO no recarga hasta reactivarlo (stale)', () => {
    component.selectSlide('indicadores');
    fixture.detectChanges();
    expect(crServiceSpy.indicadores).toHaveBeenCalledTimes(1);

    component.selectSlide('kpi');
    fixture.detectChanges();

    fixture.componentRef.setInput('month', 6);
    fixture.detectChanges();
    // Todavía en 'kpi': el cambio se marca "stale", no dispara un fetch inmediato.
    expect(crServiceSpy.indicadores).toHaveBeenCalledTimes(1);

    component.selectSlide('indicadores');
    fixture.detectChanges();
    // Al reactivar el slide 2 con filtros obsoletos, se recarga.
    expect(crServiceSpy.indicadores).toHaveBeenCalledTimes(2);
  });

  it('la preferencia de slide se persiste en localStorage y se respeta al recrear el componente', () => {
    component.selectSlide('indicadores');
    fixture.detectChanges();

    expect(localStorage.getItem(STORAGE_KEY)).toBe('indicadores');

    const fixture2 = TestBed.createComponent(BankDashboardCarouselComponent);
    fixture2.detectChanges();

    expect(fixture2.componentInstance.activeSlide).toBe('indicadores');
  });

  // 2026-09-18 (pedido explícito del usuario): rol cobranza ve solo Estatus + Cobranza,
  // nunca "Solicitudes de Cobro". Decisión de UX/producto, no de seguridad — cobranza ya
  // tiene collections:read/write completos en rbac.js (ver JSDoc de clase).
  describe('visibilidad por rol de la pestaña "Solicitudes de Cobro"', () => {
    it('rol distinto de cobranza (admin, default de este spec): las 3 pestañas y slides están en el DOM', () => {
      const botones: HTMLElement[] = Array.from(fixture.nativeElement.querySelectorAll('.dc-tab'));
      expect(botones.map(b => b.textContent?.trim())).toEqual(['Estatus', 'Solicitudes de Cobro', 'Cobranza']);
      expect(fixture.nativeElement.querySelector('app-bank-indicadores-panel')).not.toBeNull();
    });

    it('rol cobranza: el botón y el slide de "Solicitudes de Cobro" NO están en el DOM; Estatus y Cobranza sí', () => {
      authSpy.hasRole.and.callFake((...roles: string[]) => roles.includes('cobranza'));
      authSpy.currentUser.role = 'cobranza';
      fixture = TestBed.createComponent(BankDashboardCarouselComponent);
      fixture.detectChanges();

      const botones: HTMLElement[] = Array.from(fixture.nativeElement.querySelectorAll('.dc-tab'));
      expect(botones.map(b => b.textContent?.trim())).toEqual(['Estatus', 'Cobranza']);
      expect(fixture.nativeElement.querySelector('app-bank-indicadores-panel')).toBeNull();
    });

    it('localStorage con "indicadores" guardado + rol cobranza: activeSlide inicial cae a "kpi", no queda roto', () => {
      localStorage.setItem(STORAGE_KEY, 'indicadores');
      authSpy.hasRole.and.callFake((...roles: string[]) => roles.includes('cobranza'));
      authSpy.currentUser.role = 'cobranza';

      const fixture2 = TestBed.createComponent(BankDashboardCarouselComponent);
      fixture2.detectChanges();

      expect(fixture2.componentInstance.activeSlide).toBe('kpi');
    });

    it('selectSlide("indicadores") con rol cobranza no cambia activeSlide ni dispara la carga', () => {
      authSpy.hasRole.and.callFake((...roles: string[]) => roles.includes('cobranza'));
      authSpy.currentUser.role = 'cobranza';
      fixture = TestBed.createComponent(BankDashboardCarouselComponent);
      component = fixture.componentInstance;
      fixture.detectChanges();

      component.selectSlide('indicadores');
      fixture.detectChanges();

      expect(component.activeSlide).toBe('kpi');
      expect(crServiceSpy.indicadores).not.toHaveBeenCalled();
    });
  });
});
