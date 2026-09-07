import { TestBed } from '@angular/core/testing';
import { NO_ERRORS_SCHEMA } from '@angular/core';
import { CommonModule } from '@angular/common';
import { of, throwError } from 'rxjs';

import { BankIndicadoresPanelComponent } from './bank-indicadores-panel.component';
import {
  CollectionRequestService,
  CollectionRequestIndicadores,
  CollectionRequestDistribucion,
} from '../../../../core/services/collection-request.service';
import { AuthService } from '../../../../core/services/auth.service';
import { UserService, AppUserRecord } from '../../../../core/services/user.service';
import { ToastService } from '../../../../core/services/toast.service';

// bank-indicadores-panel.component.spec.ts — primer spec de este componente (no existía
// ninguno). Cobertura mínima de la feature nueva (2026-09-07, filtro admin-only de
// contador(es), pedido explícito del usuario, hallazgo 2 de la revisión de confiabilidad
// independiente): agregarContadorFiltro()/quitarContadorFiltro() disparan AMBOS pipelines
// (loadTrigger$/distribucionTrigger$), contadoresDisponibles filtra SOLO por actividad real
// (haber identificado al menos una solicitud alguna vez — el rol actual del usuario no
// importa, ver fix real #2 más abajo), y el <select> del filtro usa auth0Sub (no el id
// entero de Postgres) como value. No se cubre el resto del comportamiento previo del
// componente (ya existía sin spec) — mismo criterio acotado que pide el hallazgo.
//
// NO_ERRORS_SCHEMA (decisión, sin patrón exacto que copiar): el .html de este componente usa
// <app-date-range-picker> (SharedModule) y el pipe `number` — ningún spec hermano de
// features/banks/components/ necesitaba renderizar ESTA sección del template (ver
// bank-dashboard-carousel.component.spec.ts: su fixture de indicadoresDistribucion siempre
// trae distribucionTotal:[] a propósito, así que esa parte del template ni se renderiza
// ahí). Acá SÍ hace falta renderizarla para poder leer el <option value> real del filtro de
// contador, así que se usa NO_ERRORS_SCHEMA para no tener que declarar/importar
// SharedModule completo solo por un componente hijo ajeno a esta feature.
const CR_DATA_BASE: CollectionRequestIndicadores = {
  totalSolicitudesResueltas: 5,
  sinMovimientoVinculado: 0,
  total:         { promedioHoras: 10, medianaHoras: 8, count: 5 },
  fase1Banco:    { promedioHoras: 2,  medianaHoras: 2,  count: 5 },
  fase2Contador: { promedioHoras: 8,  medianaHoras: 6,  count: 5 },
  distribucionTotal: [],
};

const DIST_DATA_BASE: CollectionRequestDistribucion = {
  desde: '2026-09-07',
  hasta: '2026-09-07',
  total: 3,
  distribucionTotal: [{ desdeMin: 0, hastaMin: 30, count: 3, porcentaje: 100 }],
};

// id (PK entero de Postgres) deliberadamente distinto de auth0Sub, para poder distinguir
// en las aserciones cuál de los dos terminó en el DOM/en contadoresSeleccionados.
//
// 2026-09-07 (fix real, bug 1 reportado por el admin: el <select> ofrecía usuarios que
// nunca resolvieron nada): se agrega 'sub-sin-actividad' — mismo rol que sub-contable/
// sub-cobranza (contabilidad), pero AUSENTE del fixture de contadoresConSolicitudes() de
// abajo (CONTADORES_CON_SOLICITUDES_FIXTURE) — debe quedar excluido de
// contadoresDisponibles pese a tener el rol correcto (el criterio de actividad se
// mantiene: rol correcto no alcanza).
//
// 'sub-tienda' tiene rol 'tienda' (no contabilidad/cobranza) pero SÍ está presente en
// CONTADORES_CON_SOLICITUDES_FIXTURE.userIds — simula al usuario real (fix #2,
// 2026-09-07) que resolvió solicitudes en el pasado y luego cambió de rol (ej. promovido
// a admin). Con el fix, debe quedar INCLUIDO en contadoresDisponibles pese a NO tener uno
// de los roles "de contador" — el rol actual ya no es parte del criterio.
const USERS_FIXTURE: AppUserRecord[] = [
  { id: 1, auth0Sub: 'sub-contable', nombre: 'Ana Contadora', email: 'ana@x.com', role: 'contabilidad', isActive: true, lastLogin: null, createdAt: '2026-01-01' },
  { id: 2, auth0Sub: 'sub-cobranza', nombre: 'Beto Cobranza', email: 'beto@x.com', role: 'cobranza',     isActive: true, lastLogin: null, createdAt: '2026-01-01' },
  { id: 3, auth0Sub: 'sub-tienda',   nombre: 'Tienda X',      email: 'x@x.com',   role: 'tienda',       isActive: true, lastLogin: null, createdAt: '2026-01-01' },
  { id: 4, auth0Sub: 'sub-sin-actividad', nombre: 'Carla Sin Actividad', email: 'carla@x.com', role: 'contabilidad', isActive: true, lastLogin: null, createdAt: '2026-01-01' },
];

// auth0Subs con actividad real (CollectionRequest.resueltoPorUserId) — 'sub-sin-actividad'
// deliberadamente ausente (ver comentario de USERS_FIXTURE); 'sub-tienda' deliberadamente
// presente pese a su rol actual no ser contabilidad/cobranza (fix #2).
const CONTADORES_CON_SOLICITUDES_FIXTURE = { userIds: ['sub-contable', 'sub-cobranza', 'sub-tienda'] };

describe('BankIndicadoresPanelComponent — filtro admin de contador(es) (2026-09-07, TestBed, Chrome real vía Karma)', () => {
  let crServiceSpy:   jasmine.SpyObj<CollectionRequestService>;
  let userServiceSpy: jasmine.SpyObj<UserService>;
  let component: BankIndicadoresPanelComponent;
  let fixture: import('@angular/core/testing').ComponentFixture<BankIndicadoresPanelComponent>;

  beforeEach(async () => {
    crServiceSpy = jasmine.createSpyObj<CollectionRequestService>('CollectionRequestService', [
      'indicadores', 'indicadoresDistribucion', 'report', 'contadoresConSolicitudes',
    ]);
    crServiceSpy.indicadores.and.returnValue(of(CR_DATA_BASE));
    crServiceSpy.indicadoresDistribucion.and.returnValue(of(DIST_DATA_BASE));
    crServiceSpy.contadoresConSolicitudes.and.returnValue(of(CONTADORES_CON_SOLICITUDES_FIXTURE));

    // hasRole('admin') siempre true: mismo patrón que bank-dashboard-carousel.component.spec.ts.
    const authServiceSpy = {
      hasRole:     jasmine.createSpy('hasRole').and.returnValue(true),
      currentUser: { id: '1', name: 'Admin Test', email: 'admin@x.com', role: 'admin', permissions: [], picture: null },
    };

    userServiceSpy = jasmine.createSpyObj<UserService>('UserService', ['listUsers']);
    userServiceSpy.listUsers.and.returnValue(of(USERS_FIXTURE));

    const toastServiceSpy = jasmine.createSpyObj<ToastService>('ToastService', ['success', 'error']);

    await TestBed.configureTestingModule({
      imports: [CommonModule],
      declarations: [BankIndicadoresPanelComponent],
      providers: [
        { provide: CollectionRequestService, useValue: crServiceSpy },
        { provide: AuthService, useValue: authServiceSpy },
        { provide: UserService, useValue: userServiceSpy },
        { provide: ToastService, useValue: toastServiceSpy },
      ],
      schemas: [NO_ERRORS_SCHEMA],
    }).compileComponents();

    fixture = TestBed.createComponent(BankIndicadoresPanelComponent);
    component = fixture.componentInstance;
  });

  it('contadoresDisponibles se puebla SOLO por actividad real, sin importar el rol actual (incluye "tienda" con actividad)', () => {
    fixture.detectChanges(); // ngOnInit: admin -> listUsers() + contadoresConSolicitudes()

    // 'sub-tienda' tiene rol 'tienda' (no contabilidad/cobranza) pero SÍ tiene actividad
    // real (fix #2, 2026-09-07) — debe quedar INCLUIDO igual que sub-contable/sub-cobranza,
    // porque el rol actual ya no es parte del criterio.
    expect(component.contadoresDisponibles.map(u => u.auth0Sub)).toEqual(['sub-contable', 'sub-cobranza', 'sub-tienda']);
  });

  it('fix real 2026-09-07 (bug 1): un usuario con rol correcto pero AUSENTE de contadoresConSolicitudes() queda EXCLUIDO de contadoresDisponibles', () => {
    fixture.detectChanges(); // ngOnInit: forkJoin(listUsers(), contadoresConSolicitudes())

    // 'sub-sin-actividad' tiene role: 'contabilidad' (rol "de contador") pero no aparece
    // en CONTADORES_CON_SOLICITUDES_FIXTURE.userIds — nunca resolvió una solicitud real,
    // no debe ofrecerse en el <select>. El criterio de actividad se mantiene: tener el rol
    // correcto no alcanza sin actividad.
    expect(component.contadoresDisponibles.map(u => u.auth0Sub)).not.toContain('sub-sin-actividad');
    expect(component.contadoresDisponibles.length).toBe(3);
  });

  it('fix real 2026-09-07 (bug 2, sacar requisito de rol): un usuario CON actividad real pero cuyo rol actual NO es contabilidad/cobranza (ej. promovido a admin) queda INCLUIDO en contadoresDisponibles', () => {
    fixture.detectChanges(); // ngOnInit: forkJoin(listUsers(), contadoresConSolicitudes())

    // 'sub-tienda' simula al usuario real detectado en datos reales: identificó
    // solicitudes en el pasado (está en contadoresConSolicitudes()) pero su rol actual ya
    // no es contabilidad/cobranza. Antes del fix quedaba excluido solo por el rol —ahora
    // debe estar incluido.
    expect(component.contadoresDisponibles.map(u => u.auth0Sub)).toContain('sub-tienda');
  });

  it('agregarContadorFiltro(id) agrega el id a contadoresSeleccionados y dispara AMBOS triggers con el nuevo alcance', () => {
    fixture.detectChanges(); // ngOnInit: suscribe loadTrigger$/distribucionTrigger$
    crServiceSpy.indicadores.calls.reset();
    crServiceSpy.indicadoresDistribucion.calls.reset();

    component.agregarContadorFiltro('sub-contable');

    expect(component.contadoresSeleccionados).toEqual(['sub-contable']);
    expect(crServiceSpy.indicadores).toHaveBeenCalledTimes(1);
    expect(crServiceSpy.indicadores.calls.mostRecent().args[2]).toEqual(['sub-contable']);
    expect(crServiceSpy.indicadoresDistribucion).toHaveBeenCalledTimes(1);
    expect(crServiceSpy.indicadoresDistribucion.calls.mostRecent().args[2]).toEqual(['sub-contable']);
  });

  it('agregarContadorFiltro ignora un id repetido o vacío (no duplica, no dispara los triggers de nuevo)', () => {
    fixture.detectChanges();
    component.agregarContadorFiltro('sub-contable');
    crServiceSpy.indicadores.calls.reset();
    crServiceSpy.indicadoresDistribucion.calls.reset();

    component.agregarContadorFiltro('sub-contable');
    component.agregarContadorFiltro('');

    expect(component.contadoresSeleccionados).toEqual(['sub-contable']);
    expect(crServiceSpy.indicadores).not.toHaveBeenCalled();
    expect(crServiceSpy.indicadoresDistribucion).not.toHaveBeenCalled();
  });

  it('quitarContadorFiltro(id) lo remueve de contadoresSeleccionados y también dispara ambos triggers', () => {
    fixture.detectChanges();
    component.agregarContadorFiltro('sub-contable');
    component.agregarContadorFiltro('sub-cobranza');
    crServiceSpy.indicadores.calls.reset();
    crServiceSpy.indicadoresDistribucion.calls.reset();

    component.quitarContadorFiltro('sub-contable');

    expect(component.contadoresSeleccionados).toEqual(['sub-cobranza']);
    expect(crServiceSpy.indicadores).toHaveBeenCalledTimes(1);
    expect(crServiceSpy.indicadores.calls.mostRecent().args[2]).toEqual(['sub-cobranza']);
    expect(crServiceSpy.indicadoresDistribucion).toHaveBeenCalledTimes(1);
    expect(crServiceSpy.indicadoresDistribucion.calls.mostRecent().args[2]).toEqual(['sub-cobranza']);
  });

  it('quitarContadorFiltro deja contadoresSeleccionados vacío (sin filtro) cuando se quita el único elegido -> userIdsFiltro() manda undefined', () => {
    fixture.detectChanges();
    component.agregarContadorFiltro('sub-contable');
    crServiceSpy.indicadores.calls.reset();
    crServiceSpy.indicadoresDistribucion.calls.reset();

    component.quitarContadorFiltro('sub-contable');

    expect(component.contadoresSeleccionados).toEqual([]);
    expect(crServiceSpy.indicadores.calls.mostRecent().args[2]).toBeUndefined();
    expect(crServiceSpy.indicadoresDistribucion.calls.mostRecent().args[2]).toBeUndefined();
  });

  it('el <select> del filtro de contador usa auth0Sub como value (NO el id entero de Postgres)', () => {
    fixture.detectChanges(); // ngOnInit: puebla contadoresDisponibles
    // crData/distribucionData con datos reales: hace falta para que el bloque del filtro
    // (anidado dentro de *ngIf="crData && crData.total.count > 0" y
    // *ngIf="distribucionData && distribucionData.distribucionTotal.length > 0") se renderice.
    component.crData         = CR_DATA_BASE;
    component.distribucionData = DIST_DATA_BASE;
    fixture.detectChanges();

    const options: HTMLOptionElement[] = Array.from(
      fixture.nativeElement.querySelectorAll('.indp-contador-select option'),
    );
    const valores = options.map(o => o.value).filter(v => v !== ''); // descarta el placeholder ("Filtrar por contador…")

    expect(valores).toEqual(['sub-contable', 'sub-cobranza', 'sub-tienda']);
    // Los id enteros de Postgres del fixture (1, 2, 3) nunca deben aparecer como value.
    expect(valores).not.toContain('1');
    expect(valores).not.toContain('2');
    expect(valores).not.toContain('3');
  });

  it('el chip de un contador ya elegido también usa auth0Sub (se remueve de las opciones a elegir, sin duplicarse)', () => {
    fixture.detectChanges();
    component.crData           = CR_DATA_BASE;
    component.distribucionData = DIST_DATA_BASE;
    component.agregarContadorFiltro('sub-contable');
    fixture.detectChanges();

    const chips: HTMLElement[] = Array.from(fixture.nativeElement.querySelectorAll('.indp-chip'));
    expect(chips.length).toBe(1);
    expect(chips[0].textContent).toContain('Ana Contadora');

    // Ya elegido -> no debe seguir ofreciéndose en el <select> (contadoresParaSeleccionar).
    const options: HTMLOptionElement[] = Array.from(
      fixture.nativeElement.querySelectorAll('.indp-contador-select option'),
    );
    const valores = options.map(o => o.value).filter(v => v !== '');
    expect(valores).toEqual(['sub-cobranza', 'sub-tienda']);
  });

  it('fix real 2026-09-07 (bugs 2 y 3): el filtro admin (select + chips) sigue en el DOM cuando el contador elegido tiene 0 solicitudes (distribucionData con distribucionTotal:[], NO null/error)', () => {
    fixture.detectChanges(); // ngOnInit: puebla contadoresDisponibles
    component.agregarContadorFiltro('sub-contable');

    // Antes del fix, el bloque .indp-contador-filtro vivía anidado dentro de
    // *ngIf="crData.total.count > 0" y *ngIf="distribucionData.distribucionTotal.length > 0"
    // — con 0 resultados (no error, no null) AMBOS se volvían falsos y el filtro entero
    // desaparecía del DOM, sin dejar forma de quitar el contador salvo recargar la
    // página. Se simula exactamente ese escenario real: el contador elegido no tiene
    // ninguna solicitud identificada.
    component.crData = {
      totalSolicitudesResueltas: 0,
      sinMovimientoVinculado: 0,
      total:         { promedioHoras: null, medianaHoras: null, count: 0 },
      fase1Banco:    { promedioHoras: null, medianaHoras: null, count: 0 },
      fase2Contador: { promedioHoras: null, medianaHoras: null, count: 0 },
      distribucionTotal: [],
    };
    component.distribucionData = { desde: '2026-09-07', hasta: '2026-09-07', total: 0, distribucionTotal: [] };
    fixture.detectChanges();

    const filtro = fixture.nativeElement.querySelector('.indp-contador-filtro');
    expect(filtro).not.toBeNull();

    const chip = fixture.nativeElement.querySelector('.indp-chip');
    expect(chip).not.toBeNull();
    expect(chip.textContent).toContain('Ana Contadora');

    // El botón "×" para quitar el filtro sigue presente y funcional — sin él, la única
    // forma de deseleccionar antes del fix era recargar la página.
    const removeBtn: HTMLButtonElement = fixture.nativeElement.querySelector('.indp-chip-remove');
    expect(removeBtn).not.toBeNull();
  });

  it('fix WARNING 2026-09-07 (revisión de confiabilidad): si el forkJoin(listUsers(), contadoresConSolicitudes()) falla, contadoresDisponibles queda en [] y el resto del panel no se ve afectado (loadTrigger$/distribucionTrigger$ son suscripciones independientes)', () => {
    // userServiceSpy.listUsers() es el mock más simple de hacer fallar acá: es un spy con
    // un único método, dedicado solo a este forkJoin — a diferencia de crServiceSpy
    // (comparte indicadores()/indicadoresDistribucion(), que si se rompen ahí sí afectarían
    // crData/distribucionData, sería un test distinto).
    userServiceSpy.listUsers.and.returnValue(throwError(() => new Error('network error')));

    fixture.detectChanges(); // ngOnInit: forkJoin falla -> error: () => {} (falla en silencio)
    component.load(null, null, 2026, 9); // dispara loadTrigger$/distribucionTrigger$, ajenos al forkJoin

    expect(component.contadoresDisponibles).toEqual([]);
    expect(component.crData).toEqual(CR_DATA_BASE);
    expect(component.distribucionData).toEqual(DIST_DATA_BASE);
  });
});
