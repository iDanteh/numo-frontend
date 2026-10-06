import { TestBed } from '@angular/core/testing';
import { NO_ERRORS_SCHEMA } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Subject, of, throwError } from 'rxjs';

import { BankCortePanelComponent } from './bank-corte-panel.component';
import { BankService } from '../../../../core/services/bank.service';
import { BankCorteConciliacion, BankCortePeriodoRol } from '../../../../core/models/bank.model';
import { ToastService } from '../../../../core/services/toast.service';
import { SocketService, ConfigUpdatedEvent } from '../../../../core/services/socket.service';

// bank-corte-panel.component.spec.ts — reescrito 2026-10-05: el periodo/puedeAlternar por rol
// ya NO lo decide AuthService.hasRole() en el componente, lo resuelve el backend (GET
// /banks/cortes/periodo-rol, configurable desde Configuraciones Globales — ver
// bank-indicadores.service.js#getPeriodoCortePorRol). Cobertura: (1) load() pide primero
// periodoCorteRol() y usa lo que devuelve para pedir corteConciliacion(), (2) ese fetch de rol
// ocurre UNA SOLA VEZ (loads/cambios de periodo posteriores no lo repiten), (3) cambiarPeriodo()
// es no-op si puedeAlternar=false o el periodo ya es el activo, (4) manejo de error de ambos
// fetches, (5) `config:updated` del propio periodo-rol invalida el fetch perezoso y recarga;
// de otra sección/clave no hace nada.
const CORTE_FIXTURE: BankCorteConciliacion = {
  periodo: 'semanal',
  inicio:  '2026-10-05T06:00:00.000Z',
  rezagados: { no_identificado: 2, reclasificado: 1, total: 3 },
  nuevos:    { no_identificado: 5, reclasificado: 0, identificado: 10, otros: 0, pendientes: 5, total: 15 },
  identificadosEnPeriodo: { deRezagados: 1, deNuevos: 10, total: 11 },
};

describe('BankCortePanelComponent (TestBed, Chrome real vía Karma)', () => {
  let bankServiceSpy: jasmine.SpyObj<BankService>;
  let toastServiceSpy: jasmine.SpyObj<ToastService>;
  let configUpdated$: Subject<ConfigUpdatedEvent>;
  let component: BankCortePanelComponent;
  let fixture: import('@angular/core/testing').ComponentFixture<BankCortePanelComponent>;

  function configurar(periodoRol: BankCortePeriodoRol): void {
    bankServiceSpy = jasmine.createSpyObj<BankService>('BankService', ['corteConciliacion', 'reporteCorte', 'periodoCorteRol']);
    bankServiceSpy.corteConciliacion.and.returnValue(of(CORTE_FIXTURE));
    bankServiceSpy.reporteCorte.and.returnValue(of(new Blob(['fake'], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })));
    bankServiceSpy.periodoCorteRol.and.returnValue(of(periodoRol));
    toastServiceSpy = jasmine.createSpyObj<ToastService>('ToastService', ['success', 'error']);
    configUpdated$ = new Subject<ConfigUpdatedEvent>();
  }

  async function crear(): Promise<void> {
    await TestBed.configureTestingModule({
      imports: [CommonModule],
      declarations: [BankCortePanelComponent],
      providers: [
        { provide: BankService, useValue: bankServiceSpy },
        { provide: ToastService, useValue: toastServiceSpy },
        { provide: SocketService, useValue: { configUpdated$: configUpdated$.asObservable() } },
      ],
      schemas: [NO_ERRORS_SCHEMA],
    }).compileComponents();

    fixture = TestBed.createComponent(BankCortePanelComponent);
    component = fixture.componentInstance;
  }

  it('rol cobranza (periodo=semanal, puedeAlternar=false): load() resuelve el periodo del rol y pide el corte con él', async () => {
    configurar({ periodo: 'semanal', puedeAlternar: false });
    await crear();
    fixture.detectChanges();

    component.load('BBVA');

    expect(bankServiceSpy.periodoCorteRol).toHaveBeenCalledTimes(1);
    expect(component.periodoActivo).toBe('semanal');
    expect(component.puedeAlternarPeriodo).toBe(false);
    expect(bankServiceSpy.corteConciliacion).toHaveBeenCalledWith('semanal', 'BBVA', null, null);
    expect(component.data).toEqual(CORTE_FIXTURE);
  });

  it('rol contabilidad (periodo=mensual, puedeAlternar=false): usa mensual para pedir el corte', async () => {
    configurar({ periodo: 'mensual', puedeAlternar: false });
    await crear();
    fixture.detectChanges();

    component.load(null);

    expect(component.periodoActivo).toBe('mensual');
    expect(bankServiceSpy.corteConciliacion).toHaveBeenCalledWith('mensual', null, null, null);
  });

  it('otro rol (puedeAlternar=true): puede alternar, y el fetch de periodo-rol no se repite en loads posteriores', async () => {
    configurar({ periodo: 'semanal', puedeAlternar: true });
    await crear();
    fixture.detectChanges();

    component.load('BBVA');
    expect(component.puedeAlternarPeriodo).toBe(true);

    bankServiceSpy.periodoCorteRol.calls.reset();
    component.load('BANAMEX');

    expect(bankServiceSpy.periodoCorteRol).not.toHaveBeenCalled();
    expect(bankServiceSpy.corteConciliacion).toHaveBeenCalledWith('semanal', 'BANAMEX', null, null);
  });

  it('cambiarPeriodo(): con puedeAlternar=true cambia el periodo activo y recarga', async () => {
    configurar({ periodo: 'semanal', puedeAlternar: true });
    await crear();
    fixture.detectChanges();
    component.load(null);
    bankServiceSpy.corteConciliacion.calls.reset();

    component.cambiarPeriodo('mensual');

    expect(component.periodoActivo).toBe('mensual');
    expect(bankServiceSpy.corteConciliacion).toHaveBeenCalledWith('mensual', null, null, null);
  });

  it('cambiarPeriodo(): con puedeAlternar=false es no-op (rol fijo a su periodo)', async () => {
    configurar({ periodo: 'semanal', puedeAlternar: false });
    await crear();
    fixture.detectChanges();
    component.load(null);
    bankServiceSpy.corteConciliacion.calls.reset();

    component.cambiarPeriodo('mensual');

    expect(component.periodoActivo).toBe('semanal');
    expect(bankServiceSpy.corteConciliacion).not.toHaveBeenCalled();
  });

  it('cambiarPeriodo() al mismo periodo ya activo: no-op', async () => {
    configurar({ periodo: 'semanal', puedeAlternar: true });
    await crear();
    fixture.detectChanges();
    component.load(null);
    bankServiceSpy.corteConciliacion.calls.reset();

    component.cambiarPeriodo('semanal');

    expect(bankServiceSpy.corteConciliacion).not.toHaveBeenCalled();
  });

  it('error en periodoCorteRol(): marca error=true, no rompe, no pide el corte', async () => {
    configurar({ periodo: 'semanal', puedeAlternar: false });
    bankServiceSpy.periodoCorteRol.and.returnValue(throwError(() => new Error('falló')));
    await crear();
    fixture.detectChanges();

    component.load(null);

    expect(component.error).toBe(true);
    expect(component.loading).toBe(false);
    expect(bankServiceSpy.corteConciliacion).not.toHaveBeenCalled();
  });

  it('error en corteConciliacion(): marca error=true, no rompe', async () => {
    configurar({ periodo: 'semanal', puedeAlternar: false });
    bankServiceSpy.corteConciliacion.and.returnValue(throwError(() => new Error('falló')));
    await crear();
    fixture.detectChanges();

    component.load(null);

    expect(component.error).toBe(true);
    expect(component.loading).toBe(false);
  });

  it('descargarReporte(): pide al service el periodo activo y el banco, termina en descargandoReporte=false', async () => {
    configurar({ periodo: 'semanal', puedeAlternar: true });
    await crear();
    fixture.detectChanges();
    component.load('BBVA');

    component.descargarReporte();

    expect(bankServiceSpy.reporteCorte).toHaveBeenCalledWith('semanal', 'BBVA', null, null);
    expect(component.descargandoReporte).toBe(false);
    expect(toastServiceSpy.error).not.toHaveBeenCalled();
  });

  it('descargarReporte(): error del service avisa por toast y libera el flag', async () => {
    configurar({ periodo: 'semanal', puedeAlternar: true });
    bankServiceSpy.reporteCorte.and.returnValue(throwError(() => new Error('falló')));
    await crear();
    fixture.detectChanges();

    component.descargarReporte();

    expect(toastServiceSpy.error).toHaveBeenCalledWith('No se pudo generar el reporte.');
    expect(component.descargandoReporte).toBe(false);
  });

  it('config:updated de bancos.CORTE_PERIODO_COBRANZA: vuelve a resolver periodo-rol y recarga el corte', async () => {
    configurar({ periodo: 'semanal', puedeAlternar: false });
    await crear();
    fixture.detectChanges();
    component.load(null);
    bankServiceSpy.periodoCorteRol.calls.reset();
    bankServiceSpy.corteConciliacion.calls.reset();
    bankServiceSpy.periodoCorteRol.and.returnValue(of({ periodo: 'mensual', puedeAlternar: false }));

    configUpdated$.next({ sectionClave: 'bancos', clave: 'CORTE_PERIODO_COBRANZA' });

    expect(bankServiceSpy.periodoCorteRol).toHaveBeenCalledTimes(1);
    expect(component.periodoActivo).toBe('mensual');
    expect(bankServiceSpy.corteConciliacion).toHaveBeenCalledWith('mensual', null, null, null);
  });

  it('config:updated de una sección/clave no relacionada: no hace nada', async () => {
    configurar({ periodo: 'semanal', puedeAlternar: false });
    await crear();
    fixture.detectChanges();
    component.load(null);
    bankServiceSpy.periodoCorteRol.calls.reset();
    bankServiceSpy.corteConciliacion.calls.reset();

    configUpdated$.next({ sectionClave: 'kore', clave: 'AUTH_URL' });

    expect(bankServiceSpy.periodoCorteRol).not.toHaveBeenCalled();
    expect(bankServiceSpy.corteConciliacion).not.toHaveBeenCalled();
  });

  // Corte histórico personalizado (2026-10-06) — app-date-range-popover en modo singleDayOnly:
  // un solo click se "ajusta" al rango completo semanal/mensual correspondiente.
  describe('snapAPeriodo (privado)', () => {
    it('semanal: click un miércoles → lunes-domingo de esa semana', async () => {
      configurar({ periodo: 'semanal', puedeAlternar: true });
      await crear();
      fixture.detectChanges();
      component.periodoActivo = 'semanal';

      // 2026-10-07 es miércoles → semana lunes 2026-10-05 a domingo 2026-10-11.
      const result = (component as any).snapAPeriodo('2026-10-07');

      expect(result).toEqual({ fechaInicio: '2026-10-05', fechaFin: '2026-10-11' });
    });

    it('semanal: click un domingo → retrocede al lunes de la MISMA semana (no la siguiente)', async () => {
      configurar({ periodo: 'semanal', puedeAlternar: true });
      await crear();
      fixture.detectChanges();
      component.periodoActivo = 'semanal';

      // 2026-10-11 es domingo → misma semana que el caso anterior.
      const result = (component as any).snapAPeriodo('2026-10-11');

      expect(result).toEqual({ fechaInicio: '2026-10-05', fechaFin: '2026-10-11' });
    });

    it('mensual: click cualquier día → día 1 al último del mes', async () => {
      configurar({ periodo: 'mensual', puedeAlternar: true });
      await crear();
      fixture.detectChanges();
      component.periodoActivo = 'mensual';

      const result = (component as any).snapAPeriodo('2026-10-19');

      expect(result).toEqual({ fechaInicio: '2026-10-01', fechaFin: '2026-10-31' });
    });
  });

  it('seleccionarFechaHistorica(): ajusta al periodo y recarga con fechaInicio/fechaFin calculados', async () => {
    configurar({ periodo: 'semanal', puedeAlternar: true });
    await crear();
    fixture.detectChanges();
    component.load('BBVA');
    bankServiceSpy.corteConciliacion.calls.reset();

    component.seleccionarFechaHistorica('2026-10-07');

    expect(component.fechaInicioCustom).toBe('2026-10-05');
    expect(component.fechaFinCustom).toBe('2026-10-11');
    expect(bankServiceSpy.corteConciliacion).toHaveBeenCalledWith('semanal', 'BBVA', '2026-10-05', '2026-10-11');
  });

  it('volverATiempoReal(): limpia el rango custom y recarga en modo tiempo real', async () => {
    configurar({ periodo: 'semanal', puedeAlternar: true });
    await crear();
    fixture.detectChanges();
    component.load('BBVA');
    component.seleccionarFechaHistorica('2026-10-07');
    bankServiceSpy.corteConciliacion.calls.reset();

    component.volverATiempoReal();

    expect(component.fechaInicioCustom).toBeNull();
    expect(component.fechaFinCustom).toBeNull();
    expect(bankServiceSpy.corteConciliacion).toHaveBeenCalledWith('semanal', 'BBVA', null, null);
  });

  it('cambiarPeriodo(): limpia un rango histórico custom ya elegido antes de recargar', async () => {
    configurar({ periodo: 'semanal', puedeAlternar: true });
    await crear();
    fixture.detectChanges();
    component.load('BBVA');
    component.seleccionarFechaHistorica('2026-10-07');
    bankServiceSpy.corteConciliacion.calls.reset();

    component.cambiarPeriodo('mensual');

    expect(component.fechaInicioCustom).toBeNull();
    expect(component.fechaFinCustom).toBeNull();
    expect(bankServiceSpy.corteConciliacion).toHaveBeenCalledWith('mensual', 'BBVA', null, null);
  });
});
