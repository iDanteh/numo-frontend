import { TestBed } from '@angular/core/testing';
import { NO_ERRORS_SCHEMA } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Observable, of, throwError } from 'rxjs';

import { BankCobranzaPanelComponent } from './bank-cobranza-panel.component';
import { BankService } from '../../../../core/services/bank.service';
import { BankIndicadoresIdentificacion } from '../../../../core/models/bank.model';
import { AuthService } from '../../../../core/services/auth.service';
import { UserService, AppUserRecord } from '../../../../core/services/user.service';
import { ToastService } from '../../../../core/services/toast.service';

// bank-cobranza-panel.component.spec.ts — primer spec de este componente nuevo
// (2026-09-17). Cobertura: (1) el filtro por integrante solo se calcula con
// banks:config, (2) cobranzaDisponibles = intersección rol='cobranza' Y actividad real
// (a diferencia del filtro de Solicitudes de Cobro, que terminó sacando el requisito de
// rol — acá el propósito es explícitamente "ver al equipo de cobranza", así que el rol SÍ
// es parte del criterio, decisión v1 documentada en el .ts), (3) el default userIds
// mandado al backend es TODO el equipo de cobranza (nunca "sin filtro" para quien tiene el
// permiso), (4) la corrección automática cuando el forkJoin resuelve DESPUÉS del primer
// load(), (5) agregar/quitar del filtro recarga con el nuevo alcance.
const DATA_BASE: BankIndicadoresIdentificacion = {
  promedioHoras: 10,
  medianaHoras: 8,
  totalIdentificadosConDato: 5,
  backlog: { menos24h: 0, de1a3d: 0, de3a7d: 0, mas7d: 0 },
  porUsuario: [
    { userId: 'sub-cobranza-1', nombre: 'Beto Cobranza', promedioHoras: 9, count: 3 },
    { userId: 'sub-cobranza-2', nombre: 'Carla Cobranza', promedioHoras: 12, count: 2 },
  ],
};

const DATA_VACIA: BankIndicadoresIdentificacion = {
  promedioHoras: null,
  medianaHoras: null,
  totalIdentificadosConDato: 0,
  backlog: { menos24h: 0, de1a3d: 0, de3a7d: 0, mas7d: 0 },
  porUsuario: [],
};

// id (PK entero de Postgres) deliberadamente distinto de auth0Sub, mismo criterio que el
// fixture del panel hermano.
const USERS_FIXTURE: AppUserRecord[] = [
  { id: 1, auth0Sub: 'sub-cobranza-1', nombre: 'Beto Cobranza', email: 'beto@x.com', role: 'cobranza', isActive: true, lastLogin: null, createdAt: '2026-01-01' },
  { id: 2, auth0Sub: 'sub-cobranza-2', nombre: 'Carla Cobranza', email: 'carla@x.com', role: 'cobranza', isActive: true, lastLogin: null, createdAt: '2026-01-01' },
  // Rol correcto pero sin actividad real — debe quedar excluido.
  { id: 3, auth0Sub: 'sub-cobranza-sin-actividad', nombre: 'Dani Sin Actividad', email: 'dani@x.com', role: 'cobranza', isActive: true, lastLogin: null, createdAt: '2026-01-01' },
  // Actividad real pero rol distinto (ej. contabilidad) — a diferencia del panel de
  // Solicitudes de Cobro, ACÁ se excluye (v1: rol Y actividad, no solo actividad).
  { id: 4, auth0Sub: 'sub-contabilidad-activo', nombre: 'Ema Contable', email: 'ema@x.com', role: 'contabilidad', isActive: true, lastLogin: null, createdAt: '2026-01-01' },
];

const IDS_CON_ACTIVIDAD = { userIds: ['sub-cobranza-1', 'sub-cobranza-2', 'sub-contabilidad-activo'] };

describe('BankCobranzaPanelComponent (TestBed, Chrome real vía Karma)', () => {
  let bankServiceSpy: jasmine.SpyObj<BankService>;
  let userServiceSpy: jasmine.SpyObj<UserService>;
  let toastServiceSpy: jasmine.SpyObj<ToastService>;
  let authSpy: { hasPermission: jasmine.Spy; currentUser: { name: string; role: string } };
  let component: BankCobranzaPanelComponent;
  let fixture: import('@angular/core/testing').ComponentFixture<BankCobranzaPanelComponent>;

  function configurar(hasPermission: boolean): void {
    bankServiceSpy = jasmine.createSpyObj<BankService>('BankService', ['indicadores', 'usuariosConIdentificaciones', 'reporteIndicadores']);
    bankServiceSpy.indicadores.and.returnValue(of(DATA_BASE));
    bankServiceSpy.usuariosConIdentificaciones.and.returnValue(of(IDS_CON_ACTIVIDAD));
    bankServiceSpy.reporteIndicadores.and.returnValue(of(new Blob(['fake'], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })));

    userServiceSpy = jasmine.createSpyObj<UserService>('UserService', ['listUsers']);
    userServiceSpy.listUsers.and.returnValue(of(USERS_FIXTURE));

    toastServiceSpy = jasmine.createSpyObj<ToastService>('ToastService', ['success', 'error']);

    authSpy = {
      hasPermission: jasmine.createSpy('hasPermission').and.returnValue(hasPermission),
      currentUser: { name: 'Beto Cobranza', role: 'cobranza' },
    };
  }

  async function crear(): Promise<void> {
    await TestBed.configureTestingModule({
      imports: [CommonModule],
      declarations: [BankCobranzaPanelComponent],
      providers: [
        { provide: BankService, useValue: bankServiceSpy },
        { provide: AuthService, useValue: authSpy },
        { provide: UserService, useValue: userServiceSpy },
        { provide: ToastService, useValue: toastServiceSpy },
      ],
      schemas: [NO_ERRORS_SCHEMA],
    }).compileComponents();

    fixture = TestBed.createComponent(BankCobranzaPanelComponent);
    component = fixture.componentInstance;
  }

  it('sin banks:config: NO llama a listUsers()/usuariosConIdentificaciones(), cobranzaDisponibles queda vacío', async () => {
    configurar(false);
    await crear();
    fixture.detectChanges();

    expect(userServiceSpy.listUsers).not.toHaveBeenCalled();
    expect(bankServiceSpy.usuariosConIdentificaciones).not.toHaveBeenCalled();
    expect(component.cobranzaDisponibles).toEqual([]);
  });

  it('con banks:config: cobranzaDisponibles = intersección rol="cobranza" Y actividad real (excluye rol correcto sin actividad y actividad con otro rol)', async () => {
    configurar(true);
    await crear();
    fixture.detectChanges();

    const subs = component.cobranzaDisponibles.map(u => u.auth0Sub);
    expect(subs).toEqual(['sub-cobranza-1', 'sub-cobranza-2']);
    expect(subs).not.toContain('sub-cobranza-sin-actividad');
    expect(subs).not.toContain('sub-contabilidad-activo');
  });

  it('load() inicial (antes de que resuelva el forkJoin) manda sin userIds, y se AUTOCORRIGE a todo el equipo de cobranza en cuanto resuelve', async () => {
    configurar(true);
    // usuariosConIdentificaciones() nunca resuelve durante este test hasta que se lo
    // dispare a mano, para simular la condición de carrera real: load() (disparado por el
    // carousel) llega antes que el forkJoin.
    let resolverForkJoin: (() => void) | null = null;
    bankServiceSpy.usuariosConIdentificaciones.and.returnValue(
      new Observable<typeof IDS_CON_ACTIVIDAD>((subscriber) => {
        resolverForkJoin = () => { subscriber.next(IDS_CON_ACTIVIDAD); subscriber.complete(); };
      }),
    );
    await crear();
    fixture.detectChanges(); // ngOnInit: arranca el forkJoin (sin resolver todavía)

    component.load(null, null, 2026, 9);
    expect(bankServiceSpy.indicadores.calls.mostRecent().args[4]).toBeUndefined();

    bankServiceSpy.indicadores.calls.reset();
    resolverForkJoin!(); // ahora sí resuelve el forkJoin

    expect(bankServiceSpy.indicadores).toHaveBeenCalledTimes(1);
    expect(bankServiceSpy.indicadores.calls.mostRecent().args[4]).toEqual(['sub-cobranza-1', 'sub-cobranza-2']);
  });

  it('agregarCobranzaFiltro(id) acota a ESE integrante y recarga con el request más reciente', async () => {
    configurar(true);
    await crear();
    fixture.detectChanges();
    component.load('BBVA', null, 2026, 9);
    bankServiceSpy.indicadores.calls.reset();

    component.agregarCobranzaFiltro('sub-cobranza-1');

    expect(component.cobranzaSeleccionados).toEqual(['sub-cobranza-1']);
    expect(bankServiceSpy.indicadores).toHaveBeenCalledTimes(1);
    const args = bankServiceSpy.indicadores.calls.mostRecent().args;
    expect(args[0]).toBe('BBVA'); // banco del último request se preserva
    expect(args[4]).toEqual(['sub-cobranza-1']);
  });

  it('quitarCobranzaFiltro deja cobranzaSeleccionados vacío -> vuelve al default (todo el equipo de cobranza, no "sin filtro")', async () => {
    configurar(true);
    await crear();
    fixture.detectChanges();
    component.agregarCobranzaFiltro('sub-cobranza-1');
    bankServiceSpy.indicadores.calls.reset();

    component.quitarCobranzaFiltro('sub-cobranza-1');

    expect(component.cobranzaSeleccionados).toEqual([]);
    expect(bankServiceSpy.indicadores.calls.mostRecent().args[4]).toEqual(['sub-cobranza-1', 'sub-cobranza-2']);
  });

  it('aviso de scope: si cobranzaDisponibles queda vacío (nadie con rol cobranza identificó nada), se muestra el aviso de "todo el equipo"', async () => {
    configurar(true);
    bankServiceSpy.usuariosConIdentificaciones.and.returnValue(of({ userIds: [] }));
    await crear();
    fixture.detectChanges();
    fixture.detectChanges();

    const aviso = fixture.nativeElement.querySelector('.cob-scope-note');
    expect(aviso).not.toBeNull();
    expect(aviso.textContent).toContain('todo el equipo');
  });

  it('sin banks:config: no se muestra el aviso de scope ni la tabla "Por usuario", pero sí el contexto propio', async () => {
    configurar(false);
    await crear();
    fixture.detectChanges();
    component.load(null, null, 2026, 9); // simula el fetch perezoso disparado por el carousel padre
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.cob-scope-note')).toBeNull();
    expect(fixture.nativeElement.querySelector('.cob-usuario-toggle')).toBeNull();
    const contexto = fixture.nativeElement.querySelector('.cob-self-context');
    expect(contexto).not.toBeNull();
    expect(contexto.textContent).toContain('Beto Cobranza');
  });

  it('error de indicadores(): marca error, no rompe el forkJoin del filtro', async () => {
    configurar(true);
    bankServiceSpy.indicadores.and.returnValue(throwError(() => new Error('network error')));
    await crear();
    fixture.detectChanges();
    component.load(null, null, 2026, 9);

    expect(component.error).toBeTrue();
    expect(component.loading).toBeFalse();
  });

  it('subtítulo: sin year (default "hoy", 2026-09-18) dice "Identificados hoy"; con year, el genérico', async () => {
    configurar(false);
    await crear();
    fixture.detectChanges(); // ngOnInit: suscribe loadTrigger$
    component.load();        // sin year (default) — simula el fetch perezoso disparado por el carousel padre
    fixture.detectChanges();

    let sub = fixture.nativeElement.querySelector('.cob-dashboard-sub');
    expect(sub.textContent).toContain('Identificados hoy');

    component.year = 2026;
    fixture.detectChanges();

    sub = fixture.nativeElement.querySelector('.cob-dashboard-sub');
    expect(sub.textContent).not.toContain('Identificados hoy');
    expect(sub.textContent).toContain('Desde que el depósito es visible en Numo');
  });

  it('renderiza la tabla "Por usuario" con nombre/promedio/count cuando se expande', async () => {
    configurar(true);
    await crear();
    fixture.detectChanges();
    component.load(null, null, 2026, 9);
    fixture.detectChanges();

    // Colapsada por default — la expandimos para poder leer las filas.
    component.toggleUsuarioTabla();
    fixture.detectChanges();

    const filas: HTMLElement[] = Array.from(fixture.nativeElement.querySelectorAll('.cob-usuario-row'));
    expect(filas.length).toBe(2);
    expect(filas[0].textContent).toContain('Beto Cobranza');
  });

  // 2026-09-18 (rango de días + descarga, pedido explícito del usuario).
  it('onRangoFechasChange: recarga con fechaInicio/fechaFin, ignorando year/month del carousel', async () => {
    configurar(false);
    await crear();
    fixture.detectChanges();
    component.load(null, null, 2026, 9); // year/month del carousel

    component.onRangoFechasChange({ fechaInicio: '2026-09-10', fechaFin: '2026-09-12' });

    const args = bankServiceSpy.indicadores.calls.mostRecent().args;
    expect(args[2]).toBeNull();               // year ignorado (rango explícito gana)
    expect(args[3]).toBeNull();                // month ignorado
    expect(args[5]).toBe('2026-09-10');
    expect(args[6]).toBe('2026-09-12');
  });

  it('onRangoFechasChange con rango vacío (limpiar): vuelve a mandar year/month del último request', async () => {
    configurar(false);
    await crear();
    fixture.detectChanges();
    component.load(null, null, 2026, 9);
    component.onRangoFechasChange({ fechaInicio: '2026-09-10', fechaFin: '2026-09-12' });

    component.onRangoFechasChange({ fechaInicio: '', fechaFin: '' });

    const args = bankServiceSpy.indicadores.calls.mostRecent().args;
    expect(args[2]).toBe(2026);
    expect(args[3]).toBe(9);
    expect(args[5]).toBeUndefined();
    expect(args[6]).toBeUndefined();
  });

  it('descargarReporte(): llama a reporteIndicadores con los mismos filtros activos (banco/scope/rango)', async () => {
    configurar(true);
    await crear();
    fixture.detectChanges();
    component.load('BBVA', null, 2026, 9);
    component.onRangoFechasChange({ fechaInicio: '2026-09-10', fechaFin: '2026-09-12' });

    component.descargarReporte();

    expect(bankServiceSpy.reporteIndicadores).toHaveBeenCalledTimes(1);
    const args = bankServiceSpy.reporteIndicadores.calls.mostRecent().args;
    expect(args[0]).toBe('BBVA');
    expect(args[2]).toBeNull();  // year ignorado, rango explícito activo
    expect(args[4]).toBe('2026-09-10');
    expect(args[5]).toBe('2026-09-12');
  });

  it('descargarReporte(): error del service muestra toast y no rompe el componente', async () => {
    configurar(false);
    bankServiceSpy.reporteIndicadores.and.returnValue(throwError(() => new Error('network error')));
    await crear();
    fixture.detectChanges();
    component.load(null, null, 2026, 9);

    component.descargarReporte();

    expect(toastServiceSpy.error).toHaveBeenCalled();
    expect(component.descargandoReporte).toBeFalse();
  });
});
