import { TestBed } from '@angular/core/testing';
import { NO_ERRORS_SCHEMA } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Subject, of, throwError } from 'rxjs';

import { BankCortePanelComponent } from './bank-corte-panel.component';
import { BankService } from '../../../../core/services/bank.service';
import {
  BankCorteConciliacion, BankCortePeriodoRol, BankLedgerDiario, BankLedgerMensual,
  BankLedgerPorHora, BankUltimosMovimientos,
} from '../../../../core/models/bank.model';
import { ToastService } from '../../../../core/services/toast.service';
import { SocketService, ConfigUpdatedEvent } from '../../../../core/services/socket.service';

// bank-corte-panel.component.spec.ts — reescrito 2026-10-05: el periodo por rol ya NO lo decide
// AuthService.hasRole() en el componente, lo resuelve el backend (GET /banks/cortes/periodo-rol,
// configurable desde Configuraciones Globales — ver
// bank-indicadores.service.js#getPeriodoCortePorRol). Cobertura: (1) load() pide primero
// periodoCorteRol() y usa lo que devuelve para pedir corteConciliacion(), (2) ese fetch de rol
// ocurre UNA SOLA VEZ (loads posteriores no lo repiten), (3) manejo de error de ambos fetches,
// (4) `config:updated` del propio periodo-rol invalida el fetch perezoso y recarga; de otra
// sección/clave no hace nada. 2026-10-28: se eliminó el selector de periodo/corte histórico de
// la UI (cambiarPeriodo()/seleccionarFechaHistorica()/volverATiempoReal() ya no existen, pedido
// explícito del usuario) — el panel siempre corre sobre el periodo EN CURSO resuelto por rol.
const CORTE_FIXTURE: BankCorteConciliacion = {
  periodo: 'semanal',
  inicio:  '2026-10-05T06:00:00.000Z',
  rezagados: {
    no_identificado: 2, reclasificado: 1, total: 3,
    importeTotal: { no_identificado: 20000, reclasificado: 10000, total: 30000 },
  },
  cxcRetrasadas: { count: 0, detalle: [] },
  nuevos: {
    no_identificado: 5, reclasificado: 0, identificado: 10, otros: 0, pendientes: 5, total: 15,
    importeTotal: { no_identificado: 50000, reclasificado: 0, identificado: 100000, otros: 0, total: 150000 },
  },
  identificadosEnPeriodo: {
    deRezagados: 1, deNuevos: 10, total: 11,
    importeTotal: { deRezagados: 10000, deNuevos: 100000, total: 110000 },
  },
};

// Ledger MENSUAL (2026-10-30, tercera vuelta — reemplaza por completo el chart de "antigüedad
// por rango de días" que el usuario descartó tras ver un mockup de referencia). 4 meses: Jul/Ago
// a la baja (total 25→18→15), Oct (actual) rompe la racha y sube a 25 — ejercita el banner de
// alerta con racha rota Y los 5 KPI con calificaciones mixtas (mejor/peor/igual) a la vez.
const LEDGER_MENSUAL_FIXTURE: BankLedgerMensual = {
  meses: [
    {
      mes: '2026-07', fechaInicio: '2026-07-01T06:00:00.000Z', fechaFin: '2026-07-31T05:59:59.999Z',
      iniciales: { count: 40, saldo: 400000 }, nuevos: { count: 30, saldo: 300000 },
      identificados: { count: 45, saldo: 450000 },
      identificadosDeIniciales: { count: 20, saldo: 200000 }, identificadosDeNuevos: { count: 25, saldo: 250000 },
      total: { count: 25, saldo: 250000 },
    },
    {
      mes: '2026-08', fechaInicio: '2026-08-01T06:00:00.000Z', fechaFin: '2026-08-31T05:59:59.999Z',
      iniciales: { count: 25, saldo: 250000 }, nuevos: { count: 28, saldo: 280000 },
      identificados: { count: 35, saldo: 350000 },
      identificadosDeIniciales: { count: 15, saldo: 150000 }, identificadosDeNuevos: { count: 20, saldo: 200000 },
      total: { count: 18, saldo: 180000 },
    },
    {
      mes: '2026-09', fechaInicio: '2026-09-01T06:00:00.000Z', fechaFin: '2026-09-30T05:59:59.999Z',
      iniciales: { count: 18, saldo: 180000 }, nuevos: { count: 22, saldo: 220000 },
      identificados: { count: 25, saldo: 250000 },
      identificadosDeIniciales: { count: 10, saldo: 100000 }, identificadosDeNuevos: { count: 15, saldo: 150000 },
      total: { count: 15, saldo: 150000 },
    },
    {
      mes: '2026-10', fechaInicio: '2026-10-01T06:00:00.000Z', fechaFin: '2026-10-30T12:00:00.000Z',
      iniciales: { count: 15, saldo: 150000 }, nuevos: { count: 25, saldo: 250000 },
      identificados: { count: 15, saldo: 150000 },
      identificadosDeIniciales: { count: 5, saldo: 50000 }, identificadosDeNuevos: { count: 10, saldo: 100000 },
      total: { count: 25, saldo: 250000 },
    },
  ],
};

// Ledger DIARIO (2026-10-30, pedido explícito del usuario: "nuevos" = depósitos del día) — 3
// días, el último (29-oct) marcado como "hoy" en los tests que lo necesitan (ver mock de Date
// abajo). `identificadosDeIniciales`/`identificadosDeNuevos` (tercera vuelta, 2026-10-30): la
// vista semanal {cierre,resueltos,pendientes} fue retirada del frontend por completo — el
// usuario rechazó esa tabla densa y el chart de una sola línea, y eligió el dashboard diario
// (KPIs + chart combo) que consume esta fixture. Cada día: identificados.count/saldo = suma
// exacta de los 2 split, nunca un número suelto sin reconciliar.
const LEDGER_DIARIO_FIXTURE: BankLedgerDiario = {
  dias: [
    {
      fecha: '2026-10-27T06:00:00.000Z',
      iniciales: { count: 15, saldo: 120000 }, nuevos: { count: 3, saldo: 15000 },
      identificados: { count: 2, saldo: 8000 },
      identificadosDeIniciales: { count: 1, saldo: 3000 }, identificadosDeNuevos: { count: 1, saldo: 5000 },
      total: { count: 16, saldo: 127000 },
    },
    {
      fecha: '2026-10-28T06:00:00.000Z',
      iniciales: { count: 16, saldo: 127000 }, nuevos: { count: 5, saldo: 22000 },
      identificados: { count: 3, saldo: 11000 },
      identificadosDeIniciales: { count: 2, saldo: 7000 }, identificadosDeNuevos: { count: 1, saldo: 4000 },
      total: { count: 18, saldo: 138000 },
    },
    {
      fecha: '2026-10-29T06:00:00.000Z',
      iniciales: { count: 18, saldo: 138000 }, nuevos: { count: 10, saldo: 50000 },
      identificados: { count: 8, saldo: 40000 },
      identificadosDeIniciales: { count: 5, saldo: 25000 }, identificadosDeNuevos: { count: 3, saldo: 15000 },
      total: { count: 20, saldo: 148000 },
    },
  ],
};

// Ledger POR HORA (2026-10-30, cuarta vuelta — dashboard "Día actual") — 6 horas, apertura en
// 50, SUBE hasta las 10:00 (58) y a partir de ahí BAJA hasta 48 — ejercita el banner con un
// quiebre de tendencia real (no monótono de punta a punta), que es el caso no-trivial a probar.
const LEDGER_POR_HORA_FIXTURE: BankLedgerPorHora = {
  horas: [
    { hora: '08:00', fechaInicio: '2026-10-30T14:00:00.000Z', fechaFin: '2026-10-30T14:59:59.999Z', iniciales: { count: 45, saldo: 450000 }, nuevos: { count: 6, saldo: 60000 }, identificados: { count: 1, saldo: 10000 }, identificadosDeIniciales: { count: 0, saldo: 0 }, identificadosDeNuevos: { count: 1, saldo: 10000 }, total: { count: 50, saldo: 500000 } },
    { hora: '09:00', fechaInicio: '2026-10-30T15:00:00.000Z', fechaFin: '2026-10-30T15:59:59.999Z', iniciales: { count: 44, saldo: 440000 }, nuevos: { count: 5, saldo: 50000 }, identificados: { count: 1, saldo: 10000 }, identificadosDeIniciales: { count: 1, saldo: 10000 }, identificadosDeNuevos: { count: 0, saldo: 0 }, total: { count: 55, saldo: 550000 } },
    { hora: '10:00', fechaInicio: '2026-10-30T16:00:00.000Z', fechaFin: '2026-10-30T16:59:59.999Z', iniciales: { count: 43, saldo: 430000 }, nuevos: { count: 4, saldo: 40000 }, identificados: { count: 1, saldo: 10000 }, identificadosDeIniciales: { count: 1, saldo: 10000 }, identificadosDeNuevos: { count: 0, saldo: 0 }, total: { count: 58, saldo: 580000 } },
    { hora: '11:00', fechaInicio: '2026-10-30T17:00:00.000Z', fechaFin: '2026-10-30T17:59:59.999Z', iniciales: { count: 42, saldo: 420000 }, nuevos: { count: 3, saldo: 30000 }, identificados: { count: 7, saldo: 70000 }, identificadosDeIniciales: { count: 5, saldo: 50000 }, identificadosDeNuevos: { count: 2, saldo: 20000 }, total: { count: 54, saldo: 540000 } },
    { hora: '12:00', fechaInicio: '2026-10-30T18:00:00.000Z', fechaFin: '2026-10-30T18:59:59.999Z', iniciales: { count: 41, saldo: 410000 }, nuevos: { count: 2, saldo: 20000 }, identificados: { count: 5, saldo: 50000 }, identificadosDeIniciales: { count: 4, saldo: 40000 }, identificadosDeNuevos: { count: 1, saldo: 10000 }, total: { count: 50, saldo: 500000 } },
    { hora: '13:00', fechaInicio: '2026-10-30T19:00:00.000Z', fechaFin: '2026-10-30T19:30:00.000Z', iniciales: { count: 40, saldo: 400000 }, nuevos: { count: 1, saldo: 10000 }, identificados: { count: 3, saldo: 30000 }, identificadosDeIniciales: { count: 2, saldo: 20000 }, identificadosDeNuevos: { count: 1, saldo: 10000 }, total: { count: 48, saldo: 480000 } },
  ],
};

// Mismo backlog pero SIN quiebre — baja parejo de punta a punta (la racha arranca desde la
// apertura misma, `inicioRachaIdx` termina en 0) — ejercita la rama "sin cláusula de quiebre"
// del banner (solo describe el delta total del día).
const LEDGER_POR_HORA_SIN_QUIEBRE_FIXTURE: BankLedgerPorHora = {
  horas: LEDGER_POR_HORA_FIXTURE.horas.map((h, i) => ({
    ...h, total: { count: 50 - i * 2, saldo: (50 - i * 2) * 10000 },
  })),
};

const ULTIMOS_MOVIMIENTOS_FIXTURE: BankUltimosMovimientos = {
  movimientos: [
    { fechaEvento: '2026-10-30T22:32:00.000Z', tipo: 'nuevo', mesOrigen: '2026-10', monto: 12450, estatus: 'identificado', banco: 'BBVA', folio: '000123' },
    { fechaEvento: '2026-10-30T22:28:00.000Z', tipo: 'inicial', mesOrigen: '2026-09', monto: 3800, estatus: 'identificado', banco: 'Banamex', folio: '000098' },
    { fechaEvento: '2026-10-30T22:10:00.000Z', tipo: 'nuevo', mesOrigen: '2026-10', monto: 1150, estatus: 'no_identificado', banco: 'Santander', folio: '000145' },
  ],
};

describe('BankCortePanelComponent (TestBed, Chrome real vía Karma)', () => {
  let bankServiceSpy: jasmine.SpyObj<BankService>;
  let toastServiceSpy: jasmine.SpyObj<ToastService>;
  let configUpdated$: Subject<ConfigUpdatedEvent>;
  let component: BankCortePanelComponent;
  let fixture: import('@angular/core/testing').ComponentFixture<BankCortePanelComponent>;

  function configurar(periodoRol: BankCortePeriodoRol): void {
    bankServiceSpy = jasmine.createSpyObj<BankService>(
      'BankService',
      [
        'corteConciliacion', 'reporteCorte', 'periodoCorteRol', 'ledgerMensual', 'ledgerDiario',
        'ledgerPorHora', 'ultimosMovimientos',
      ],
    );
    bankServiceSpy.corteConciliacion.and.returnValue(of(CORTE_FIXTURE));
    bankServiceSpy.reporteCorte.and.returnValue(of(new Blob(['fake'], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })));
    bankServiceSpy.periodoCorteRol.and.returnValue(of(periodoRol));
    bankServiceSpy.ledgerMensual.and.returnValue(of(LEDGER_MENSUAL_FIXTURE));
    bankServiceSpy.ledgerDiario.and.returnValue(of(LEDGER_DIARIO_FIXTURE));
    bankServiceSpy.ledgerPorHora.and.returnValue(of(LEDGER_POR_HORA_FIXTURE));
    bankServiceSpy.ultimosMovimientos.and.returnValue(of(ULTIMOS_MOVIMIENTOS_FIXTURE));
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

  it('otro rol (puedeAlternar=true): el fetch de periodo-rol no se repite en loads posteriores', async () => {
    configurar({ periodo: 'semanal', puedeAlternar: true });
    await crear();
    fixture.detectChanges();

    component.load('BBVA');

    bankServiceSpy.periodoCorteRol.calls.reset();
    component.load('BANAMEX');

    expect(bankServiceSpy.periodoCorteRol).not.toHaveBeenCalled();
    expect(bankServiceSpy.corteConciliacion).toHaveBeenCalledWith('semanal', 'BANAMEX', null, null);
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

  // Corte mensual (2026-10-30, tercera vuelta — reemplaza por completo el chart de "antigüedad
  // por rango de días" que el usuario descartó tras ver un mockup de referencia). Independiente
  // de corteConciliacion()/periodo/corte histórico: un fallo acá NO debe tirar abajo el resto
  // del panel (ver cargarLedgerMensual()).
  describe('corte mensual', () => {
    it('load(): pide ledgerMensual() con banco + mesOrigen/fechas vacías + cantidad default (7)', async () => {
      configurar({ periodo: 'semanal', puedeAlternar: true });
      await crear();
      fixture.detectChanges();

      component.load('BBVA');

      expect(bankServiceSpy.ledgerMensual).toHaveBeenCalledWith('BBVA', null, null, null, 7);
      expect(component.ledgerMensual).toEqual(LEDGER_MENSUAL_FIXTURE);
      expect(component.ledgerMensualLoading).toBe(false);
    });

    it('mesActual/mesAnterior: último y anteúltimo mes del arreglo', async () => {
      configurar({ periodo: 'semanal', puedeAlternar: true });
      await crear();
      fixture.detectChanges();
      component.load('BBVA');

      expect(component.mesActual?.mes).toBe('2026-10');
      expect(component.mesAnterior?.mes).toBe('2026-09');
    });

    it('mesActual/mesAnterior: null antes de cargar (sin romper el *ngIf del template)', async () => {
      configurar({ periodo: 'semanal', puedeAlternar: true });
      await crear();

      expect(component.mesActual).toBeNull();
      expect(component.mesAnterior).toBeNull();
    });

    it('load() con el MISMO banco ya cargado: no vuelve a pedir ledgerMensual()', async () => {
      configurar({ periodo: 'semanal', puedeAlternar: true });
      await crear();
      fixture.detectChanges();
      component.load('BBVA');
      bankServiceSpy.ledgerMensual.calls.reset();

      component.load('BBVA');

      expect(bankServiceSpy.ledgerMensual).not.toHaveBeenCalled();
    });

    it('load() con un banco DISTINTO: vuelve a pedir ledgerMensual() con el nuevo banco', async () => {
      configurar({ periodo: 'semanal', puedeAlternar: true });
      await crear();
      fixture.detectChanges();
      component.load('BBVA');
      bankServiceSpy.ledgerMensual.calls.reset();

      component.load('BANAMEX');

      expect(bankServiceSpy.ledgerMensual).toHaveBeenCalledWith('BANAMEX', null, null, null, 7);
    });

    it('onMesOrigenLedgerMensual(): recarga con el mes de origen elegido', async () => {
      configurar({ periodo: 'semanal', puedeAlternar: true });
      await crear();
      fixture.detectChanges();
      component.load('BBVA');
      bankServiceSpy.ledgerMensual.calls.reset();

      component.onMesOrigenLedgerMensual('2026-08');

      expect(component.ledgerMensualMesOrigen).toBe('2026-08');
      expect(bankServiceSpy.ledgerMensual).toHaveBeenCalledWith('BBVA', '2026-08', null, null, 7);
    });

    it('onCantidadMesesLedgerMensual(): recarga con la cantidad elegida', async () => {
      configurar({ periodo: 'semanal', puedeAlternar: true });
      await crear();
      fixture.detectChanges();
      component.load('BBVA');
      bankServiceSpy.ledgerMensual.calls.reset();

      component.onCantidadMesesLedgerMensual(12);

      expect(component.ledgerMensualCantidad).toBe(12);
      expect(bankServiceSpy.ledgerMensual).toHaveBeenCalledWith('BBVA', null, null, null, 12);
    });

    it('error en ledgerMensual(): marca ledgerMensualError=true pero NO rompe el resto del panel', async () => {
      configurar({ periodo: 'semanal', puedeAlternar: true });
      bankServiceSpy.ledgerMensual.and.returnValue(throwError(() => new Error('falló')));
      await crear();
      fixture.detectChanges();

      component.load('BBVA');

      expect(component.ledgerMensualError).toBe(true);
      expect(component.ledgerMensualLoading).toBe(false);
      expect(component.error).toBe(false);
      expect(component.data).toEqual(CORTE_FIXTURE);
    });

    describe('banner de alerta (bannerMensual)', () => {
      it('racha rota: pendientes suben después de 2 meses seguidos a la baja, menciona ambos %', async () => {
        configurar({ periodo: 'semanal', puedeAlternar: true });
        await crear();
        fixture.detectChanges();
        component.load('BBVA');

        const banner = component.bannerMensual;

        expect(banner?.tipo).toBe('warn');
        expect(banner?.texto).toContain('crecieron 10 depósitos');
        expect(banner?.texto).toContain('2 meses seguidos a la baja');
        expect(banner?.texto).toContain('cayó de 55.6% a 33.3%');
        expect(banner?.texto).toContain('bajó de 68.2% a 40.0%');
      });

      it('con menos de 2 meses cargados: null (no hay "anterior" con qué comparar)', async () => {
        configurar({ periodo: 'semanal', puedeAlternar: true });
        bankServiceSpy.ledgerMensual.and.returnValue(of({ meses: [LEDGER_MENSUAL_FIXTURE.meses[3]] }));
        await crear();
        fixture.detectChanges();
        component.load('BBVA');

        expect(component.bannerMensual).toBeNull();
      });
    });

    describe('5 KPI (kpisMensuales)', () => {
      it('calificaciones mejor/peor/igual según el mes anterior', async () => {
        configurar({ periodo: 'semanal', puedeAlternar: true });
        await crear();
        fixture.detectChanges();
        component.load('BBVA');

        const [kIniciales, kIdIniciales, kNuevos, kIdNuevos, kTotal] = component.kpisMensuales;

        expect(kIniciales.valor).toBe(15);
        expect(kIniciales.calificacion).toBe('mejor'); // 15 < 18 (anterior) — bajó, es mejor

        expect(kIdIniciales.valor).toBe(5);
        expect(kIdIniciales.calificacion).toBe('peor'); // 33.3% < 55.6% (anterior) — el % cayó

        expect(kNuevos.valor).toBe(25);
        expect(kNuevos.calificacion).toBe('igual'); // volumen de entrada, sin juicio de bueno/malo

        expect(kIdNuevos.valor).toBe(10);
        expect(kIdNuevos.calificacion).toBe('peor'); // 40.0% < 68.2% (anterior)

        expect(kTotal.valor).toBe(25);
        expect(kTotal.calificacion).toBe('peor'); // 25 > 15 (anterior) — subió, es peor
        expect(kTotal.detalle).toBe('10 iniciales + 15 nuevos'); // 15-5 iniciales + 25-10 nuevos
      });

      it('sin mes anterior (un solo mes cargado): todas las calificaciones son "igual"', async () => {
        configurar({ periodo: 'semanal', puedeAlternar: true });
        bankServiceSpy.ledgerMensual.and.returnValue(of({ meses: [LEDGER_MENSUAL_FIXTURE.meses[3]] }));
        await crear();
        fixture.detectChanges();
        component.load('BBVA');

        expect(component.kpisMensuales.every(k => k.calificacion === 'igual')).toBe(true);
      });

      it('vacío antes de cargar', async () => {
        configurar({ periodo: 'semanal', puedeAlternar: true });
        await crear();

        expect(component.kpisMensuales).toEqual([]);
      });
    });

    it('diasTranscurridosMes: día actual del mes / días totales de ese mes', async () => {
      configurar({ periodo: 'semanal', puedeAlternar: true });
      await crear();

      const hoy = new Date();
      const { actual, total } = component.diasTranscurridosMes;

      expect(actual).toBe(hoy.getDate());
      expect(total).toBe(new Date(hoy.getFullYear(), hoy.getMonth() + 1, 0).getDate());
    });

    describe('6 charts', () => {
      it('chart 1 (pendientes al cierre): 1 dataset, el mes actual (último) en naranja, los demás en azul', async () => {
        configurar({ periodo: 'semanal', puedeAlternar: true });
        await crear();
        fixture.detectChanges();
        component.load('BBVA');

        expect(component.mensualChart1Data.labels.length).toBe(4);
        const ds = component.mensualChart1Data.datasets[0];
        expect(ds.data).toEqual([25, 18, 15, 25]);
        expect(ds.backgroundColor).toEqual(['#2a78d6', '#2a78d6', '#2a78d6', '#d9730d']);
      });

      it('chart 4 (qué se identificó cada mes): 2 series apiladas, de iniciales y de nuevos', async () => {
        configurar({ periodo: 'semanal', puedeAlternar: true });
        await crear();
        fixture.detectChanges();
        component.load('BBVA');

        const [deIniciales, deNuevos] = component.mensualChart4Data.datasets;
        expect(deIniciales.label).toBe('Identificados — de iniciales');
        expect(deIniciales.data).toEqual([20, 15, 10, 5]);
        expect(deIniciales.stack).toBe('id');
        expect(deNuevos.label).toBe('Identificados — de nuevos');
        expect(deNuevos.data).toEqual([25, 20, 15, 10]);
        expect(deNuevos.stack).toBe('id');
      });
    });
  });

  // Toggle Mensual/Diario (2026-10-30, cuarta vuelta) — controla qué dashboard se muestra.
  describe('toggle Mensual/Diario', () => {
    it('default: mensual', async () => {
      configurar({ periodo: 'semanal', puedeAlternar: true });
      await crear();

      expect(component.vistaActiva).toBe('mensual');
    });

    it('cambiarVista(): cambia vistaActiva', async () => {
      configurar({ periodo: 'semanal', puedeAlternar: true });
      await crear();

      component.cambiarVista('diario');

      expect(component.vistaActiva).toBe('diario');
    });
  });

  // Dashboard "Día actual" (2026-10-30, cuarta vuelta — reemplaza por completo el dashboard de
  // ledger diario de la ronda anterior, ver comentario de `ledgerDiario` en el componente).
  // Independiente igual que "Corte mensual": un fallo acá no rompe el resto del panel.
  describe('día actual', () => {
    it('load(): pide ledgerDiario() (15 días, sin filtros), ledgerPorHora() (sin fecha = hoy) y ultimosMovimientos()', async () => {
      configurar({ periodo: 'semanal', puedeAlternar: true });
      await crear();
      fixture.detectChanges();

      component.load('BBVA');

      expect(bankServiceSpy.ledgerDiario).toHaveBeenCalledWith('BBVA', null, null, null, 15);
      expect(component.ledgerDiario).toEqual(LEDGER_DIARIO_FIXTURE);
      expect(bankServiceSpy.ledgerPorHora).toHaveBeenCalledWith('BBVA', null);
      expect(component.ledgerPorHora).toEqual(LEDGER_POR_HORA_FIXTURE);
      expect(bankServiceSpy.ultimosMovimientos).toHaveBeenCalledWith('BBVA', 10);
      expect(component.ultimosMovimientos).toEqual(ULTIMOS_MOVIMIENTOS_FIXTURE);
    });

    it('load() con el MISMO banco ya cargado: no vuelve a pedir ninguno de los 3', async () => {
      configurar({ periodo: 'semanal', puedeAlternar: true });
      await crear();
      fixture.detectChanges();
      component.load('BBVA');
      bankServiceSpy.ledgerDiario.calls.reset();
      bankServiceSpy.ledgerPorHora.calls.reset();
      bankServiceSpy.ultimosMovimientos.calls.reset();

      component.load('BBVA');

      expect(bankServiceSpy.ledgerDiario).not.toHaveBeenCalled();
      expect(bankServiceSpy.ledgerPorHora).not.toHaveBeenCalled();
      expect(bankServiceSpy.ultimosMovimientos).not.toHaveBeenCalled();
    });

    it('cambiarDiaSeleccionado("ayer"): recarga SOLO ledgerPorHora(), con la fecha de ayer (hora México, YYYY-MM-DD)', async () => {
      configurar({ periodo: 'semanal', puedeAlternar: true });
      await crear();
      fixture.detectChanges();
      component.load('BBVA');
      bankServiceSpy.ledgerPorHora.calls.reset();
      bankServiceSpy.ledgerDiario.calls.reset();

      component.cambiarDiaSeleccionado('ayer');

      expect(component.diaSeleccionado).toBe('ayer');
      expect(bankServiceSpy.ledgerDiario).not.toHaveBeenCalled(); // solo el ledger por hora se recarga
      const [banco, fecha] = bankServiceSpy.ledgerPorHora.calls.mostRecent().args;
      expect(banco).toBe('BBVA');
      expect(fecha).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(fecha).not.toBeNull();
    });

    it('error en ledgerPorHora(): marca ledgerPorHoraError=true pero NO rompe el resto del panel', async () => {
      configurar({ periodo: 'semanal', puedeAlternar: true });
      bankServiceSpy.ledgerPorHora.and.returnValue(throwError(() => new Error('falló')));
      await crear();
      fixture.detectChanges();

      component.load('BBVA');

      expect(component.ledgerPorHoraError).toBe(true);
      expect(component.ledgerPorHoraLoading).toBe(false);
      expect(component.error).toBe(false);
    });

    describe('diaActualLedger/diaAnteriorLedger', () => {
      it('"hoy": último y anteúltimo día del arreglo', async () => {
        configurar({ periodo: 'semanal', puedeAlternar: true });
        await crear();
        fixture.detectChanges();
        component.load('BBVA');

        expect(component.diaActualLedger).toEqual(LEDGER_DIARIO_FIXTURE.dias[2]);
        expect(component.diaAnteriorLedger).toEqual(LEDGER_DIARIO_FIXTURE.dias[1]);
      });

      it('"ayer": anteúltimo y antepenúltimo día del arreglo', async () => {
        configurar({ periodo: 'semanal', puedeAlternar: true });
        await crear();
        fixture.detectChanges();
        component.load('BBVA');

        component.cambiarDiaSeleccionado('ayer');

        expect(component.diaActualLedger).toEqual(LEDGER_DIARIO_FIXTURE.dias[1]);
        expect(component.diaAnteriorLedger).toEqual(LEDGER_DIARIO_FIXTURE.dias[0]);
      });

      it('null antes de cargar (sin romper el *ngIf del template)', async () => {
        configurar({ periodo: 'semanal', puedeAlternar: true });
        await crear();

        expect(component.diaActualLedger).toBeNull();
        expect(component.diaAnteriorLedger).toBeNull();
      });
    });

    describe('banner de alerta (bannerDiario)', () => {
      it('con quiebre real (sube hasta las 10:00, después baja): menciona la hora del quiebre', async () => {
        configurar({ periodo: 'semanal', puedeAlternar: true });
        await crear();
        fixture.detectChanges();
        component.load('BBVA');

        const banner = component.bannerDiario;

        expect(banner?.tipo).toBe('neutral'); // delta del día (48-50=-2) <= 0
        expect(banner?.texto).toContain('Desde las 10:00');
        expect(banner?.texto).toContain('(58 → 48)');
        expect(banner?.texto).toContain('ya identifica más de lo que entra');
        expect(banner?.texto).toContain('-2 contra la apertura');
      });

      it('sin quiebre (baja parejo de punta a punta): solo describe el delta del día, sin "Desde las..."', async () => {
        configurar({ periodo: 'semanal', puedeAlternar: true });
        bankServiceSpy.ledgerPorHora.and.returnValue(of(LEDGER_POR_HORA_SIN_QUIEBRE_FIXTURE));
        await crear();
        fixture.detectChanges();
        component.load('BBVA');

        const banner = component.bannerDiario;

        expect(banner?.texto).not.toContain('Desde las');
        expect(banner?.texto).toContain('bajan 10 depósitos');
        expect(banner?.texto).toContain('(50 → 40)');
      });

      it('con menos de 2 horas cargadas: null', async () => {
        configurar({ periodo: 'semanal', puedeAlternar: true });
        bankServiceSpy.ledgerPorHora.and.returnValue(of({ horas: [LEDGER_POR_HORA_FIXTURE.horas[0]] }));
        await crear();
        fixture.detectChanges();
        component.load('BBVA');

        expect(component.bannerDiario).toBeNull();
      });
    });

    describe('5 KPI (kpisDiarios)', () => {
      it('"Pendientes ahora" compara contra la apertura del día (primera hora), no contra el día anterior', async () => {
        configurar({ periodo: 'semanal', puedeAlternar: true });
        await crear();
        fixture.detectChanges();
        component.load('BBVA');

        const [kPendientes] = component.kpisDiarios;

        expect(kPendientes.valor).toBe(LEDGER_DIARIO_FIXTURE.dias[2].total.count);
        expect(kPendientes.detalle).toBe('apertura del día: 50');
      });

      it('"Nuevos cargados" sin calificación de bueno/malo (volumen de entrada)', async () => {
        configurar({ periodo: 'semanal', puedeAlternar: true });
        await crear();
        fixture.detectChanges();
        component.load('BBVA');

        const [, kNuevos] = component.kpisDiarios;

        expect(kNuevos.valor).toBe(LEDGER_DIARIO_FIXTURE.dias[2].nuevos.count);
        expect(kNuevos.calificacion).toBe('igual');
      });

      it('"Identificados": mejor si subió vs. el día anterior', async () => {
        configurar({ periodo: 'semanal', puedeAlternar: true });
        await crear();
        fixture.detectChanges();
        component.load('BBVA');

        const [, , kIdentificados] = component.kpisDiarios;

        expect(kIdentificados.valor).toBe(8); // día 29 (actual)
        expect(kIdentificados.calificacion).toBe('mejor'); // 8 > 3 (día 28, anterior)
      });

      it('vacío antes de cargar', async () => {
        configurar({ periodo: 'semanal', puedeAlternar: true });
        await crear();

        expect(component.kpisDiarios).toEqual([]);
      });
    });

    describe('Pendientes durante el día (chart)', () => {
      it('chart de pendientes por hora: 1 línea con el total de cada hora', async () => {
        configurar({ periodo: 'semanal', puedeAlternar: true });
        await crear();
        fixture.detectChanges();
        component.load('BBVA');

        const [total] = component.diarioChartPendientesHoraData.datasets;
        expect(total.type).toBe('line');
        expect(total.data).toEqual([50, 55, 58, 54, 50, 48]);
      });
    });

    describe('últimos movimientos (feed)', () => {
      it('formatTipoMovimiento: "Nuevo" para tipo=nuevo, "Inicial · <mes>" para tipo=inicial', async () => {
        configurar({ periodo: 'semanal', puedeAlternar: true });
        await crear();

        expect(component.formatTipoMovimiento(ULTIMOS_MOVIMIENTOS_FIXTURE.movimientos[0])).toBe('Nuevo');
        expect(component.formatTipoMovimiento(ULTIMOS_MOVIMIENTOS_FIXTURE.movimientos[1])).toContain('Inicial');
        expect(component.formatTipoMovimiento(ULTIMOS_MOVIMIENTOS_FIXTURE.movimientos[1])).not.toContain('.');
      });

      it('error en ultimosMovimientos(): marca ultimosMovimientosError=true pero NO rompe el resto del panel', async () => {
        configurar({ periodo: 'semanal', puedeAlternar: true });
        bankServiceSpy.ultimosMovimientos.and.returnValue(throwError(() => new Error('falló')));
        await crear();
        fixture.detectChanges();

        component.load('BBVA');

        expect(component.ultimosMovimientosError).toBe(true);
        expect(component.ultimosMovimientosLoading).toBe(false);
        expect(component.error).toBe(false);
      });
    });
  });

  describe('CxC retrasadas', () => {
    it('abrirCxcRetrasadasModal()/cerrarCxcRetrasadasModal(): modal cerrado por default, abre y cierra', async () => {
      configurar({ periodo: 'semanal', puedeAlternar: true });
      await crear();
      fixture.detectChanges();

      expect(component.cxcRetrasadasModalOpen).toBe(false);
      component.abrirCxcRetrasadasModal();
      expect(component.cxcRetrasadasModalOpen).toBe(true);
      component.cerrarCxcRetrasadasModal();
      expect(component.cxcRetrasadasModalOpen).toBe(false);
    });

    it('formatMesFolio(): "YYYY-MM" a texto legible', async () => {
      configurar({ periodo: 'semanal', puedeAlternar: true });
      await crear();

      expect(component.formatMesFolio('2026-09')).toContain('2026');
      expect(component.formatMesFolio('2026-09').toLowerCase()).toContain('septiembre');
    });
  });
});
