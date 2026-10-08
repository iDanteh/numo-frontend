import { TestBed, fakeAsync, tick } from '@angular/core/testing';
import { of, Subject } from 'rxjs';

import { NetpayRecordatorioComponent, _hoyMX, _esDiaHabilMX } from './netpay-recordatorio.component';
import { BankService } from '../../../../core/services/bank.service';
import { AuthService } from '../../../../core/services/auth.service';
import { SocketService, NetpayReporteCargadoEvent } from '../../../../core/services/socket.service';
import { NetpayUltimaCargaResultado } from '../../../../core/models/netpay-reporte.model';

// Fechas de referencia verificadas (node -e con Intl, no a ojo): 2026-10-08 jueves (hábil),
// 2026-10-10 sábado (NO hábil).
const JUEVES_HABIL = new Date('2026-10-08T15:00:00Z');
const SABADO       = new Date('2026-10-10T15:00:00Z');

describe('_hoyMX / _esDiaHabilMX (funciones puras, fecha de referencia fija)', () => {
  it('_esDiaHabilMX: lunes a viernes -> true', () => {
    expect(_esDiaHabilMX(JUEVES_HABIL)).toBe(true);
  });

  it('_esDiaHabilMX: sábado/domingo -> false', () => {
    expect(_esDiaHabilMX(SABADO)).toBe(false);
  });

  it('_hoyMX: formatea a YYYY-MM-DD en hora de México', () => {
    expect(_hoyMX(JUEVES_HABIL)).toBe('2026-10-08');
  });
});

describe('NetpayRecordatorioComponent (TestBed, Chrome real vía Karma)', () => {
  let bankServiceSpy: jasmine.SpyObj<BankService>;
  let authSpy: jasmine.SpyObj<AuthService>;
  let netpayReporteCargado$: Subject<NetpayReporteCargadoEvent>;
  let component: NetpayRecordatorioComponent;

  function crear(): void {
    const fixture = TestBed.createComponent(NetpayRecordatorioComponent);
    component = fixture.componentInstance;
    spyOn(component, '_ahora').and.returnValue(JUEVES_HABIL);
  }

  beforeEach(async () => {
    bankServiceSpy = jasmine.createSpyObj<BankService>('BankService', ['obtenerUltimaCargaNetpay']);
    authSpy = jasmine.createSpyObj<AuthService>('AuthService', ['hasRole']);
    netpayReporteCargado$ = new Subject<NetpayReporteCargadoEvent>();

    await TestBed.configureTestingModule({
      declarations: [NetpayRecordatorioComponent],
      providers: [
        { provide: BankService, useValue: bankServiceSpy },
        { provide: AuthService, useValue: authSpy },
        { provide: SocketService, useValue: { netpayReporteCargado$ } },
      ],
    }).compileComponents();
  });

  it('usuario SIN rol contabilidad: nunca consulta el backend, queda oculto', () => {
    authSpy.hasRole.and.returnValue(false);
    crear();

    component.ngOnInit();

    expect(bankServiceSpy.obtenerUltimaCargaNetpay).not.toHaveBeenCalled();
    expect(component.estado).toBe('oculto');
  });

  it('contabilidad pero NO es día hábil (fin de semana): nunca consulta el backend, queda oculto', () => {
    authSpy.hasRole.and.returnValue(true);
    crear();
    (component._ahora as jasmine.Spy).and.returnValue(SABADO);

    component.ngOnInit();

    expect(bankServiceSpy.obtenerUltimaCargaNetpay).not.toHaveBeenCalled();
    expect(component.estado).toBe('oculto');
  });

  it('contabilidad + día hábil + sin ninguna carga todavía: estado pendiente', () => {
    authSpy.hasRole.and.returnValue(true);
    bankServiceSpy.obtenerUltimaCargaNetpay.and.returnValue(of({ ultimaCarga: null } as NetpayUltimaCargaResultado));
    crear();

    component.ngOnInit();

    expect(component.estado).toBe('pendiente');
  });

  it('contabilidad + día hábil + ya se cargó HOY: estado confirmado con el nombre de quien cargó', () => {
    authSpy.hasRole.and.returnValue(true);
    bankServiceSpy.obtenerUltimaCargaNetpay.and.returnValue(of({
      ultimaCarga: { cargadoEn: '2026-10-08T15:04:52.999Z', cargadoPor: { userId: 'u1', nombre: 'jesuscruz' }, nombreArchivoOriginal: 'x.xlsx' },
    } as NetpayUltimaCargaResultado));
    crear();

    component.ngOnInit();

    expect(component.estado).toBe('confirmado');
    expect(component.nombrePersona).toBe('jesuscruz');
  });

  it('la última carga es de OTRO día (ayer, no hoy): sigue pendiente', () => {
    authSpy.hasRole.and.returnValue(true);
    bankServiceSpy.obtenerUltimaCargaNetpay.and.returnValue(of({
      ultimaCarga: { cargadoEn: '2026-10-07T15:04:52.999Z', cargadoPor: { userId: 'u1', nombre: 'jesuscruz' }, nombreArchivoOriginal: 'x.xlsx' },
    } as NetpayUltimaCargaResultado));
    crear();

    component.ngOnInit();

    expect(component.estado).toBe('pendiente');
  });

  it('evento de socket EN VIVO mientras estaba pendiente: pasa a confirmado con el nombre del evento', () => {
    authSpy.hasRole.and.returnValue(true);
    bankServiceSpy.obtenerUltimaCargaNetpay.and.returnValue(of({ ultimaCarga: null } as NetpayUltimaCargaResultado));
    crear();
    component.ngOnInit();
    expect(component.estado).toBe('pendiente');

    netpayReporteCargado$.next({
      cargadoPor: { userId: 'u2', nombre: 'Ana' }, cargadoEn: '2026-10-08T16:00:00.000Z', nombreArchivoOriginal: 'y.xlsx',
    });

    expect(component.estado).toBe('confirmado');
    expect(component.nombrePersona).toBe('Ana');
  });

  it('confirmado se auto-oculta solo tras un rato, sin intervención del usuario', fakeAsync(() => {
    authSpy.hasRole.and.returnValue(true);
    bankServiceSpy.obtenerUltimaCargaNetpay.and.returnValue(of({
      ultimaCarga: { cargadoEn: '2026-10-08T15:04:52.999Z', cargadoPor: { userId: 'u1', nombre: 'Ana' }, nombreArchivoOriginal: 'x.xlsx' },
    } as NetpayUltimaCargaResultado));
    crear();
    component.ngOnInit();
    expect(component.estado).toBe('confirmado');

    tick(10000);
    tick(300); // fade-out de cerrar()
    expect(component.estado).toBe('oculto');
  }));

  it('irANetpay(): emite el output y cierra', () => {
    authSpy.hasRole.and.returnValue(true);
    bankServiceSpy.obtenerUltimaCargaNetpay.and.returnValue(of({ ultimaCarga: null } as NetpayUltimaCargaResultado));
    crear();
    component.ngOnInit();
    const emitido = spyOn(component.abrirNetpay, 'emit');

    component.irANetpay();

    expect(emitido).toHaveBeenCalled();
    expect(component.saliendo).toBe(true);
  });

  it('cerrar() es idempotente — llamarlo dos veces no rompe nada', fakeAsync(() => {
    authSpy.hasRole.and.returnValue(true);
    bankServiceSpy.obtenerUltimaCargaNetpay.and.returnValue(of({ ultimaCarga: null } as NetpayUltimaCargaResultado));
    crear();
    component.ngOnInit();

    component.cerrar();
    component.cerrar();
    tick(300);

    expect(component.estado).toBe('oculto');
  }));
});
