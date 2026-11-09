import { TestBed } from '@angular/core/testing';
import { NO_ERRORS_SCHEMA } from '@angular/core';
import { CommonModule } from '@angular/common';
import { of, throwError } from 'rxjs';

import { BankCortePanelComponent } from './bank-corte-panel.component';
import { BankService } from '../../../../core/services/bank.service';
import { ToastService } from '../../../../core/services/toast.service';
import {
  BankLedgerDiario, BankLedgerMensual, BankAntiguedadDepositos, BankAntiguedadPorAnio, CorteDescarga,
} from '../../../../core/models/bank.model';

// bank-corte-panel.component.spec.ts — reescrito 2026-11-06: el componente quedó basado
// ÍNTEGRAMENTE en el mockup de referencia del usuario (3 vistas: Mensual/Diario/Antigüedad) —
// se eliminó TODO lo que no está en el mockup (corte semanal/mensual por rol, hero de 3
// estadísticas, CxC retrasadas, banners/KPI con delta, feed de últimos movimientos, toggle
// Hoy/Ayer con ledger por hora), no solo se ocultó. Esta suite cubre solo lo que sigue vivo.
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

// Antigüedad del backlog "completamente vacío" (2026-11-06) — 4 buckets fijos, uno con count 0
// (ejercita que el chart/KPI no rompan con un rango vacío).
const ANTIGUEDAD_FIXTURE: BankAntiguedadDepositos = {
  rangos: [
    { rango: '1 a 30 días', count: 5, saldo: 50000 },
    { rango: '31 a 60 días', count: 3, saldo: 30000 },
    { rango: '61 a 90 días', count: 0, saldo: 0 },
    { rango: 'Más de 90 días', count: 2, saldo: 90000 },
  ],
  total: { count: 10, saldo: 170000 },
};

// Historial de descargas (2026-11-06, pedido explícito del usuario: un solo botón de exportar
// para TODO Cortes, con un solo historial compartido) — 2 entradas: la más reciente con delta
// "bajó" (bueno), la más vieja sin delta (primera descarga de ese banco, nada contra qué
// comparar) — ejercita ambos casos del template sin romper.
const DESCARGAS_FIXTURE: CorteDescarga[] = [
  {
    _id: 'd2', fecha: '2026-11-06T18:00:00.000Z', banco: null,
    usuario: { userId: 'u1', nombre: 'cristiangarcia' },
    depositosNoIdentificados: { count: 80, saldo: 800000 },
    delta: { countPct: -20, saldoPct: -20, direccion: 'bajo' },
    driveFileId: 'drive-id-2',
  },
  {
    _id: 'd1', fecha: '2026-11-05T18:00:00.000Z', banco: null,
    usuario: { userId: 'u2', nombre: 'luisfelipe' },
    depositosNoIdentificados: { count: 100, saldo: 1000000 },
    delta: null,
    // Subida a Drive fallida en su momento (2026-11-06, segunda ronda) — sin archivo disponible.
    driveFileId: null,
  },
];

// Antigüedad por año (2026-11-06, CUARTA ronda — agrupado por mes de ORIGEN, corte siempre HOY) —
// 3 meses: uno con backlog real, uno con un rango en 0 (ejercita que la suma de antiguedadKpis()
// no rompa con ceros), y uno totalmente resuelto (total.count === 0, para la bandera verde).
const ANTIGUEDAD_POR_ANIO_FIXTURE: BankAntiguedadPorAnio = {
  meses: [
    {
      periodo: '2026-08', corte: '2026-10-07T06:00:00.000Z',
      rangos: [
        { rango: '1 a 30 días', count: 0, saldo: 0 },
        { rango: '31 a 60 días', count: 0, saldo: 0 },
        { rango: '61 a 90 días', count: 0, saldo: 0 },
        { rango: 'Más de 90 días', count: 0, saldo: 0 },
      ],
      total: { count: 0, saldo: 0 },
    },
    {
      periodo: '2026-09', corte: '2026-10-07T06:00:00.000Z',
      rangos: [
        { rango: '1 a 30 días', count: 2, saldo: 20000 },
        { rango: '31 a 60 días', count: 1, saldo: 10000 },
        { rango: '61 a 90 días', count: 0, saldo: 0 },
        { rango: 'Más de 90 días', count: 0, saldo: 0 },
      ],
      total: { count: 3, saldo: 30000 },
    },
    {
      periodo: '2026-10', corte: '2026-10-07T06:00:00.000Z',
      rangos: [
        { rango: '1 a 30 días', count: 1, saldo: 5000 },
        { rango: '31 a 60 días', count: 1, saldo: 10000 },
        { rango: '61 a 90 días', count: 0, saldo: 0 },
        { rango: 'Más de 90 días', count: 2, saldo: 90000 },
      ],
      total: { count: 4, saldo: 105000 },
    },
  ],
};

describe('BankCortePanelComponent (TestBed, Chrome real vía Karma)', () => {
  let bankServiceSpy: jasmine.SpyObj<BankService>;
  let toastServiceSpy: jasmine.SpyObj<ToastService>;
  let component: BankCortePanelComponent;
  let fixture: import('@angular/core/testing').ComponentFixture<BankCortePanelComponent>;

  function configurar(): void {
    bankServiceSpy = jasmine.createSpyObj<BankService>(
      'BankService',
      [
        'ledgerMensual', 'ledgerDiario', 'antiguedadDepositos', 'antiguedadDepositosPorAnio',
        'descargarCortes', 'descargasCorte', 'descargarReporteCorteHistorico',
      ],
    );
    bankServiceSpy.ledgerMensual.and.returnValue(of(LEDGER_MENSUAL_FIXTURE));
    bankServiceSpy.ledgerDiario.and.returnValue(of(LEDGER_DIARIO_FIXTURE));
    bankServiceSpy.antiguedadDepositos.and.returnValue(of(ANTIGUEDAD_FIXTURE));
    bankServiceSpy.antiguedadDepositosPorAnio.and.returnValue(of(ANTIGUEDAD_POR_ANIO_FIXTURE));
    bankServiceSpy.descargasCorte.and.returnValue(of(DESCARGAS_FIXTURE));
    bankServiceSpy.descargarCortes.and.returnValue(of(new Blob(['fake'], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })));
    bankServiceSpy.descargarReporteCorteHistorico.and.returnValue(of(new Blob(['fake-historico'], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })));

    toastServiceSpy = jasmine.createSpyObj<ToastService>('ToastService', ['success', 'error']);
  }

  async function crear(): Promise<void> {
    await TestBed.configureTestingModule({
      imports: [CommonModule],
      declarations: [BankCortePanelComponent],
      providers: [
        { provide: BankService, useValue: bankServiceSpy },
        { provide: ToastService, useValue: toastServiceSpy },
      ],
      schemas: [NO_ERRORS_SCHEMA],
    }).compileComponents();

    fixture = TestBed.createComponent(BankCortePanelComponent);
    component = fixture.componentInstance;
  }

  // Toggle Mensual/Diario/Antigüedad — controla cuál de las 3 vistas se muestra.
  describe('toggle de vistas', () => {
    it('default: mensual', async () => {
      configurar();
      await crear();

      expect(component.vistaActiva).toBe('mensual');
    });

    it('cambiarVista(): cambia vistaActiva', async () => {
      configurar();
      await crear();

      component.cambiarVista('diario');
      expect(component.vistaActiva).toBe('diario');

      component.cambiarVista('antiguedad');
      expect(component.vistaActiva).toBe('antiguedad');
    });
  });

  describe('corte mensual', () => {
    it('load(): pide ledgerMensual() con banco + mesOrigen vacío + ancla fija "desde" mayo 2026', async () => {
      configurar();
      await crear();
      fixture.detectChanges();

      component.load('BBVA');

      expect(bankServiceSpy.ledgerMensual).toHaveBeenCalledWith('BBVA', null, '2026-05', null);
      expect(component.ledgerMensual).toEqual(LEDGER_MENSUAL_FIXTURE);
      expect(component.ledgerMensualLoading).toBe(false);
    });

    it('load() con el MISMO banco ya cargado: no vuelve a pedir ledgerMensual()', async () => {
      configurar();
      await crear();
      fixture.detectChanges();
      component.load('BBVA');
      bankServiceSpy.ledgerMensual.calls.reset();

      component.load('BBVA');

      expect(bankServiceSpy.ledgerMensual).not.toHaveBeenCalled();
    });

    it('load() con un banco DISTINTO: vuelve a pedir ledgerMensual() con el nuevo banco', async () => {
      configurar();
      await crear();
      fixture.detectChanges();
      component.load('BBVA');
      bankServiceSpy.ledgerMensual.calls.reset();

      component.load('BANAMEX');

      expect(bankServiceSpy.ledgerMensual).toHaveBeenCalledWith('BANAMEX', null, '2026-05', null);
    });

    it('onMesOrigenLedgerMensual(): recarga con el mes de origen elegido, sin perder la ancla de agosto', async () => {
      configurar();
      await crear();
      fixture.detectChanges();
      component.load('BBVA');
      bankServiceSpy.ledgerMensual.calls.reset();

      component.onMesOrigenLedgerMensual('2026-09');

      expect(component.ledgerMensualMesOrigen).toBe('2026-09');
      expect(bankServiceSpy.ledgerMensual).toHaveBeenCalledWith('BBVA', '2026-09', '2026-05', null);
    });

    it('error en ledgerMensual(): marca ledgerMensualError=true pero NO rompe el resto del panel', async () => {
      configurar();
      bankServiceSpy.ledgerMensual.and.returnValue(throwError(() => new Error('falló')));
      await crear();
      fixture.detectChanges();

      component.load('BBVA');

      expect(component.ledgerMensualError).toBe(true);
      expect(component.ledgerMensualLoading).toBe(false);
    });

    // 2 charts (2026-11-06, mockup de referencia): "Montos por mes"/"Número de depósitos por
    // mes", apilados identificados (abajo) + saldo final (arriba), con el total ("al cierre")
    // impreso arriba vía datalabels por dataset.
    describe('2 charts (montos/depósitos por mes)', () => {
      it('montosPorMesChartData: 2 series apiladas (identificados/saldo final) en MONTO', async () => {
        configurar();
        await crear();
        fixture.detectChanges();
        component.load('BBVA');

        expect(component.montosPorMesChartData.labels.length).toBe(4);
        const [identificados, saldoFinal] = component.montosPorMesChartData.datasets;
        expect(identificados.label).toBe('Identificados en el periodo');
        expect(identificados.data).toEqual([450000, 350000, 250000, 150000]);
        expect(saldoFinal.label).toBe('Saldo final (no identificado)');
        expect(saldoFinal.data).toEqual([250000, 180000, 150000, 250000]);
      });

      it('movsPorMesChartData: mismas 2 series pero en NÚMERO de depósitos', async () => {
        configurar();
        await crear();
        fixture.detectChanges();
        component.load('BBVA');

        const [identificados, saldoFinal] = component.movsPorMesChartData.datasets;
        expect(identificados.data).toEqual([45, 35, 25, 15]);
        expect(saldoFinal.data).toEqual([25, 18, 15, 25]);
      });

      it('datalabel del dataset "saldo final": formatter devuelve el total ("al cierre" = iniciales+nuevos) de cada mes', async () => {
        configurar();
        await crear();
        fixture.detectChanges();
        component.load('BBVA');

        const [, saldoFinalMontos] = component.montosPorMesChartData.datasets;
        // Mes índice 3 (2026-10): iniciales 150000 + nuevos 250000 = 400000 al cierre.
        expect(saldoFinalMontos.datalabels.formatter(0, { dataIndex: 3 })).toBe(component.formatImporteCompacto(400000));

        const [, saldoFinalMovs] = component.movsPorMesChartData.datasets;
        expect(saldoFinalMovs.datalabels.formatter(0, { dataIndex: 3 })).toBe(15 + 25); // 15 iniciales + 25 nuevos
      });
    });

    describe('onClickMesChart() / tabla "Resultados por mes" / mesResultado', () => {
      it('mesResultado: por default, el mes en curso (último del arreglo)', async () => {
        configurar();
        await crear();
        fixture.detectChanges();
        component.load('BBVA');

        expect(component.mesResultado?.mes).toBe('2026-10');
      });

      it('mesResultado: null antes de cargar (sin romper el *ngIf del template)', async () => {
        configurar();
        await crear();

        expect(component.mesResultado).toBeNull();
      });

      it('onClickMesChart(): selecciona el mes del índice clickeado', async () => {
        configurar();
        await crear();
        fixture.detectChanges();
        component.load('BBVA');

        component.onClickMesChart({ active: [{ index: 1 }] });

        expect(component.mesResultadoSeleccionado).toBe('2026-08');
        expect(component.mesResultado?.mes).toBe('2026-08');
      });

      it('onClickMesChart() sin barra activa (active vacío): no cambia la selección', async () => {
        configurar();
        await crear();
        fixture.detectChanges();
        component.load('BBVA');

        component.onClickMesChart({ active: [] });

        expect(component.mesResultadoSeleccionado).toBeNull();
      });

      it('seleccionarMes(): misma selección que clickear una fila de la tabla', async () => {
        configurar();
        await crear();
        fixture.detectChanges();
        component.load('BBVA');

        component.seleccionarMes('2026-07');

        expect(component.mesResultado?.mes).toBe('2026-07');
        // "al cierre" de 2026-07 = iniciales 400000 + nuevos 300000.
        expect(component.alCierre(component.mesResultado!)).toEqual({ count: 70, saldo: 700000 });
      });

      it('tabla "Resultados por mes": 1 fila por mes, en el mismo orden que ledgerMensual.meses', async () => {
        configurar();
        await crear();
        fixture.detectChanges();
        component.load('BBVA');
        fixture.detectChanges();

        const filas = fixture.nativeElement.querySelectorAll('.corte-tabla-seleccionable tbody tr');
        expect(filas.length).toBe(4);
        // 11 columnas: Mes + 5 de monto + 5 de depósitos.
        expect(filas[0].querySelectorAll('td').length).toBe(11);
      });

      it('click en una fila de la tabla selecciona ese mes (mismo efecto que clickear el chart)', async () => {
        configurar();
        await crear();
        fixture.detectChanges();
        component.load('BBVA');
        fixture.detectChanges();

        const filas: NodeListOf<HTMLElement> = fixture.nativeElement.querySelectorAll('.corte-tabla-seleccionable tbody tr');
        filas[0].click(); // primer mes del arreglo: 2026-07

        expect(component.mesResultadoSeleccionado).toBe('2026-07');
      });
    });
  });

  describe('diario', () => {
    it('load(): pide ledgerDiario() (15 días, sin filtros)', async () => {
      configurar();
      await crear();
      fixture.detectChanges();

      component.load('BBVA');

      expect(bankServiceSpy.ledgerDiario).toHaveBeenCalledWith('BBVA', null, null, null, 15);
      expect(component.ledgerDiario).toEqual(LEDGER_DIARIO_FIXTURE);
    });

    it('load() con el MISMO banco ya cargado: no vuelve a pedir ledgerDiario()', async () => {
      configurar();
      await crear();
      fixture.detectChanges();
      component.load('BBVA');
      bankServiceSpy.ledgerDiario.calls.reset();

      component.load('BBVA');

      expect(bankServiceSpy.ledgerDiario).not.toHaveBeenCalled();
    });

    it('error en ledgerDiario(): marca ledgerDiarioError=true pero NO rompe el resto del panel', async () => {
      configurar();
      bankServiceSpy.ledgerDiario.and.returnValue(throwError(() => new Error('falló')));
      await crear();
      fixture.detectChanges();

      component.load('BBVA');

      expect(component.ledgerDiarioError).toBe(true);
      expect(component.ledgerDiarioLoading).toBe(false);
    });

    // Encabezado único "Saldo por identificar al..." (2026-11-06, mockup de referencia) —
    // SIEMPRE el último día de `ledgerDiario.dias` ("hoy" en vivo).
    describe('hoyLedger (encabezado único)', () => {
      it('es el último día del arreglo', async () => {
        configurar();
        await crear();
        fixture.detectChanges();
        component.load('BBVA');

        expect(component.hoyLedger).toEqual(LEDGER_DIARIO_FIXTURE.dias[2]);
      });

      it('null antes de cargar', async () => {
        configurar();
        await crear();

        expect(component.hoyLedger).toBeNull();
      });
    });

    describe('2 charts (montos/depósitos por día)', () => {
      it('montosPorDiaChartData: 2 series apiladas (identificados/saldo final) en MONTO', async () => {
        configurar();
        await crear();
        fixture.detectChanges();
        component.load('BBVA');

        expect(component.montosPorDiaChartData.labels.length).toBe(3);
        const [identificados, saldoFinal] = component.montosPorDiaChartData.datasets;
        expect(identificados.data).toEqual([8000, 11000, 40000]);
        expect(saldoFinal.data).toEqual([127000, 138000, 148000]);
      });

      it('movsPorDiaChartData: mismas 2 series pero en NÚMERO de depósitos', async () => {
        configurar();
        await crear();
        fixture.detectChanges();
        component.load('BBVA');

        const [identificados, saldoFinal] = component.movsPorDiaChartData.datasets;
        expect(identificados.data).toEqual([2, 3, 8]);
        expect(saldoFinal.data).toEqual([16, 18, 20]);
      });
    });

    describe('onClickDiaChart() / tabla "Resultados por día" / diaResultado', () => {
      it('diaResultado: por default, el último día del arreglo (hoy)', async () => {
        configurar();
        await crear();
        fixture.detectChanges();
        component.load('BBVA');

        expect(component.diaResultado?.fecha).toBe('2026-10-29T06:00:00.000Z');
      });

      it('onClickDiaChart(): selecciona el día del índice clickeado', async () => {
        configurar();
        await crear();
        fixture.detectChanges();
        component.load('BBVA');

        component.onClickDiaChart({ active: [{ index: 0 }] });

        expect(component.diaResultadoSeleccionado).toBe('2026-10-27T06:00:00.000Z');
        expect(component.diaResultado?.fecha).toBe('2026-10-27T06:00:00.000Z');
      });

      it('seleccionarDia(): misma selección que clickear una fila de la tabla', async () => {
        configurar();
        await crear();
        fixture.detectChanges();
        component.load('BBVA');

        component.seleccionarDia('2026-10-28T06:00:00.000Z');

        expect(component.diaResultado?.fecha).toBe('2026-10-28T06:00:00.000Z');
        // "al cierre" del 28: iniciales 127000 + nuevos 22000.
        expect(component.alCierre(component.diaResultado!)).toEqual({ count: 21, saldo: 149000 });
      });

      it('tabla "Resultados por día": 1 fila por día, click en una fila selecciona ese día', async () => {
        configurar();
        await crear();
        fixture.detectChanges();
        component.load('BBVA');
        component.cambiarVista('diario'); // la tabla de "Resultados por día" solo se renderiza con este tab activo
        fixture.detectChanges();

        const filas: NodeListOf<HTMLElement> = fixture.nativeElement.querySelectorAll('.corte-tabla-seleccionable tbody tr');
        expect(filas.length).toBe(3);
        expect(filas[0].querySelectorAll('td').length).toBe(11);

        filas[1].click(); // segundo día del arreglo: 2026-10-28

        expect(component.diaResultadoSeleccionado).toBe('2026-10-28T06:00:00.000Z');
      });
    });
  });

  describe('antigüedad — modo Día (default)', () => {
    it('load(): pide antiguedadDepositos() con el banco (sin fecha explícita = hoy)', async () => {
      configurar();
      await crear();
      fixture.detectChanges();

      component.load('BBVA');

      expect(bankServiceSpy.antiguedadDepositos).toHaveBeenCalledWith('BBVA', null);
      expect(component.antiguedad).toEqual(ANTIGUEDAD_FIXTURE);
      expect(component.antiguedadLoading).toBe(false);
    });

    it('load() con el MISMO banco ya cargado: no vuelve a pedir antiguedadDepositos()', async () => {
      configurar();
      await crear();
      fixture.detectChanges();
      component.load('BBVA');
      bankServiceSpy.antiguedadDepositos.calls.reset();

      component.load('BBVA');

      expect(bankServiceSpy.antiguedadDepositos).not.toHaveBeenCalled();
    });

    it('load() con un banco DISTINTO: vuelve a pedir antiguedadDepositos() con el nuevo banco', async () => {
      configurar();
      await crear();
      fixture.detectChanges();
      component.load('BBVA');
      bankServiceSpy.antiguedadDepositos.calls.reset();

      component.load('BANAMEX');

      expect(bankServiceSpy.antiguedadDepositos).toHaveBeenCalledWith('BANAMEX', null);
    });

    it('error en antiguedadDepositos(): marca antiguedadError=true pero NO rompe el resto del panel', async () => {
      configurar();
      bankServiceSpy.antiguedadDepositos.and.returnValue(throwError(() => new Error('falló')));
      await crear();
      fixture.detectChanges();

      component.load('BBVA');

      expect(component.antiguedadError).toBe(true);
      expect(component.antiguedadLoading).toBe(false);
    });

    it('chart: una barra por rango, en el mismo orden que devuelve el backend', async () => {
      configurar();
      await crear();
      fixture.detectChanges();

      component.load('BBVA');

      expect(component.antiguedadChartData.labels).toEqual(['1 a 30 días', '31 a 60 días', '61 a 90 días', 'Más de 90 días']);
      expect(component.antiguedadChartData.datasets[0].data).toEqual([5, 3, 0, 2]);
      expect(component.antiguedadChartData.datasets[0].importes).toEqual([50000, 30000, 0, 90000]);
    });

    it('antiguedadKpis: en modo "dia" es exactamente `antiguedad` (sin sumar nada)', async () => {
      configurar();
      await crear();
      fixture.detectChanges();
      component.load('BBVA');

      expect(component.antiguedadKpis).toEqual(ANTIGUEDAD_FIXTURE);
    });

    // Corte por Día/Año (2026-11-06, segunda ronda) — el usuario revisó de nuevo el mockup de
    // referencia y pidió poder elegir un corte histórico, no solo "hoy".
    it('onCambioAntiguedadFecha(): vuelve a pedir antiguedadDepositos() con la fecha elegida', async () => {
      configurar();
      await crear();
      fixture.detectChanges();
      component.load('BBVA');
      bankServiceSpy.antiguedadDepositos.calls.reset();

      component.onCambioAntiguedadFecha('2026-09-10');

      expect(bankServiceSpy.antiguedadDepositos).toHaveBeenCalledWith('BBVA', '2026-09-10');
      expect(component.antiguedadFecha).toBe('2026-09-10');
    });
  });

  describe('antigüedad — modo Año (2026-11-06, segunda ronda)', () => {
    it('cambiarAntiguedadCortePor("anio"): carga antiguedadDepositosPorAnio() recién al activarlo (lazy)', async () => {
      configurar();
      await crear();
      fixture.detectChanges();
      component.load('BBVA'); // modo día, default — no debe pedir el modo año todavía
      expect(bankServiceSpy.antiguedadDepositosPorAnio).not.toHaveBeenCalled();

      component.cambiarAntiguedadCortePor('anio');

      expect(bankServiceSpy.antiguedadDepositosPorAnio).toHaveBeenCalledWith('BBVA', String(new Date().getFullYear()));
      expect(component.antiguedadPorAnio).toEqual(ANTIGUEDAD_POR_ANIO_FIXTURE);
    });

    it('cambiarAntiguedadCortePor("anio") una segunda vez: no vuelve a pedir (ya cargado)', async () => {
      configurar();
      await crear();
      fixture.detectChanges();
      component.load('BBVA');
      component.cambiarAntiguedadCortePor('anio');
      bankServiceSpy.antiguedadDepositosPorAnio.calls.reset();

      component.cambiarAntiguedadCortePor('dia');
      component.cambiarAntiguedadCortePor('anio');

      expect(bankServiceSpy.antiguedadDepositosPorAnio).not.toHaveBeenCalled();
    });

    it('onCambioAntiguedadAnio(): vuelve a pedir con el año elegido y limpia el mes seleccionado', async () => {
      configurar();
      await crear();
      fixture.detectChanges();
      component.load('BBVA');
      component.cambiarAntiguedadCortePor('anio');
      component.seleccionarAntiguedadAnioMes('2026-09');

      component.onCambioAntiguedadAnio('2025');

      expect(bankServiceSpy.antiguedadDepositosPorAnio).toHaveBeenCalledWith('BBVA', '2025');
      expect(component.antiguedadAnioMesSeleccionado).toBeNull();
    });

    it('error en antiguedadDepositosPorAnio(): marca antiguedadAnioError=true', async () => {
      configurar();
      bankServiceSpy.antiguedadDepositosPorAnio.and.returnValue(throwError(() => new Error('falló')));
      await crear();
      fixture.detectChanges();
      component.load('BBVA');

      component.cambiarAntiguedadCortePor('anio');

      expect(component.antiguedadAnioError).toBe(true);
      expect(component.antiguedadAnioLoading).toBe(false);
    });

    it('chart: 4 rangos de antigüedad por mes + dataset-bandera "Mes resuelto" al final, agrupado por mes de ORIGEN', async () => {
      configurar();
      await crear();
      fixture.detectChanges();
      component.load('BBVA');

      component.cambiarAntiguedadCortePor('anio');

      expect(component.antiguedadAnioChartData.labels.length).toBe(3); // ago/sep/oct
      expect(component.antiguedadAnioChartData.datasets.length).toBe(5); // 4 rangos + bandera
      expect(component.antiguedadAnioChartData.datasets[0].data).toEqual([0, 2, 1]); // "1 a 30 días" ago/sep/oct
      expect(component.antiguedadAnioChartData.datasets[3].data).toEqual([0, 0, 2]); // "Más de 90 días"
      const bandera = component.antiguedadAnioChartData.datasets[4];
      expect(bandera.label).toBe('Mes resuelto');
      expect(bandera.backgroundColor).toBe('#1a9c5b'); // mismo verde que .corte-delta--bajo
      expect(bandera.stack).toBe('x'); // mismo stack que los rangos
      // Agosto (total.count===0) tiene una altura fija >0 de bandera; septiembre/octubre (con
      // backlog real) quedan en 0 — la bandera nunca convive con backlog real del mismo mes.
      expect(bandera.data[0]).toBeGreaterThan(0);
      expect(bandera.data[1]).toBe(0);
      expect(bandera.data[2]).toBe(0);
    });

    it('chart: un mes sin ningún pendiente hoy (total.count===0) recibe la bandera "Mes resuelto"; uno con backlog real no', async () => {
      configurar();
      bankServiceSpy.antiguedadDepositosPorAnio.and.returnValue(of({
        meses: [
          {
            periodo: '2026-09', corte: '2026-10-07T06:00:00.000Z',
            rangos: [
              { rango: '1 a 30 días', count: 0, saldo: 0 },
              { rango: '31 a 60 días', count: 0, saldo: 0 },
              { rango: '61 a 90 días', count: 0, saldo: 0 },
              { rango: 'Más de 90 días', count: 0, saldo: 0 },
            ],
            total: { count: 0, saldo: 0 },
          },
          {
            periodo: '2026-10', corte: '2026-10-07T06:00:00.000Z',
            rangos: [
              { rango: '1 a 30 días', count: 5, saldo: 50000 },
              { rango: '31 a 60 días', count: 0, saldo: 0 },
              { rango: '61 a 90 días', count: 0, saldo: 0 },
              { rango: 'Más de 90 días', count: 0, saldo: 0 },
            ],
            total: { count: 5, saldo: 50000 },
          },
        ],
      }));
      await crear();
      fixture.detectChanges();
      component.load('BBVA');

      component.cambiarAntiguedadCortePor('anio');

      const bandera = component.antiguedadAnioChartData.datasets[4];
      expect(bandera.data[0]).toBeGreaterThan(0); // septiembre: resuelto
      expect(bandera.data[1]).toBe(0); // octubre: tiene backlog real, no es "resuelto"
    });

    it('antiguedadKpis: en modo "anio" SUMA los 4 rangos de todos los meses ya cargados', async () => {
      configurar();
      await crear();
      fixture.detectChanges();
      component.load('BBVA');
      component.cambiarAntiguedadCortePor('anio');

      const kpis = component.antiguedadKpis!;

      expect(kpis.rangos[0]).toEqual({ rango: '1 a 30 días', count: 3, saldo: 25000 }); // 2+1, 20000+5000
      expect(kpis.rangos[3]).toEqual({ rango: 'Más de 90 días', count: 2, saldo: 90000 }); // 0+2, 0+90000
      expect(kpis.total).toEqual({ count: 7, saldo: 135000 }); // suma de los 4 rangos: 3+2+0+2, 25000+20000+0+90000
    });

    it('seleccionarAntiguedadAnioMes()/antiguedadAnioResultado: sin selección, usa el mes más reciente', async () => {
      configurar();
      await crear();
      fixture.detectChanges();
      component.load('BBVA');
      component.cambiarAntiguedadCortePor('anio');

      expect(component.antiguedadAnioResultado?.periodo).toBe('2026-10');

      component.seleccionarAntiguedadAnioMes('2026-09');

      expect(component.antiguedadAnioResultado?.periodo).toBe('2026-09');
    });

    it('onClickAntiguedadAnioChart(): selecciona el mes por el índice del punto clickeado', async () => {
      configurar();
      await crear();
      fixture.detectChanges();
      component.load('BBVA');
      component.cambiarAntiguedadCortePor('anio');

      component.onClickAntiguedadAnioChart({ active: [{ index: 0 } as any] });

      expect(component.antiguedadAnioMesSeleccionado).toBe('2026-08');
    });
  });

  // Exportar (2026-11-06, pedido explícito del usuario: un solo botón para TODO Cortes).
  describe('exportar', () => {
    it('descargarCortes(): llama a bankService.descargarCortes() con el banco activo', async () => {
      configurar();
      await crear();
      fixture.detectChanges();
      component.load('BBVA');

      component.descargarCortes();

      expect(bankServiceSpy.descargarCortes).toHaveBeenCalledWith('BBVA');
      expect(component.descargando).toBe(false); // ya resuelto síncrono (of(...))
    });

    it('descargarCortes(): al terminar con éxito, refresca el historial de descargas (aunque el modal esté cerrado)', async () => {
      configurar();
      await crear();
      fixture.detectChanges();
      component.load('BBVA');

      component.descargarCortes();

      expect(bankServiceSpy.descargasCorte).toHaveBeenCalledWith('BBVA');
    });

    it('descargarCortes(): error del service muestra toast y no deja descargando=true colgado', async () => {
      configurar();
      bankServiceSpy.descargarCortes.and.returnValue(throwError(() => new Error('network error')));
      await crear();
      fixture.detectChanges();
      component.load('BBVA');

      component.descargarCortes();

      expect(toastServiceSpy.error).toHaveBeenCalled();
      expect(component.descargando).toBe(false);
    });

    it('botón "Exportar": click llama a descargarCortes()', async () => {
      configurar();
      await crear();
      fixture.detectChanges();
      component.load('BBVA');
      fixture.detectChanges();
      spyOn(component, 'descargarCortes');

      // 2 botones comparten `.corte-descargar-btn` ("Ver historial" y "Exportar") — "Exportar" es
      // el único SIN la variante outline.
      const boton: HTMLButtonElement = fixture.nativeElement.querySelector('.corte-descargar-btn:not(.corte-descargar-btn--outline)');
      boton.click();

      expect(component.descargarCortes).toHaveBeenCalled();
    });
  });

  // Historial de descargas (2026-11-06; CORREGIDO en una segunda ronda el mismo día: pasó a vivir
  // en un modal lazy — antes se renderizaba inline y empujaba el toggle/gráficas de abajo).
  describe('historial de descargas (modal)', () => {
    it('load() NO pide descargasCorte() — el historial ya no se carga automáticamente', async () => {
      configurar();
      await crear();
      fixture.detectChanges();

      component.load('BBVA');

      expect(bankServiceSpy.descargasCorte).not.toHaveBeenCalled();
      expect(component.descargasModalAbierto).toBe(false);
    });

    it('abrirHistorialDescargas(): abre el modal y pide descargasCorte() (lazy, primera vez)', async () => {
      configurar();
      await crear();
      fixture.detectChanges();
      component.load('BBVA');

      component.abrirHistorialDescargas();

      expect(component.descargasModalAbierto).toBe(true);
      expect(bankServiceSpy.descargasCorte).toHaveBeenCalledWith('BBVA');
      expect(component.descargasCorte).toEqual(DESCARGAS_FIXTURE);
      expect(component.descargasCorteLoading).toBe(false);
    });

    it('abrirHistorialDescargas() una segunda vez: no vuelve a pedir (ya cargado)', async () => {
      configurar();
      await crear();
      fixture.detectChanges();
      component.load('BBVA');
      component.abrirHistorialDescargas();
      bankServiceSpy.descargasCorte.calls.reset();

      component.cerrarHistorialDescargas();
      component.abrirHistorialDescargas();

      expect(bankServiceSpy.descargasCorte).not.toHaveBeenCalled();
    });

    it('cerrarHistorialDescargas(): cierra el modal', async () => {
      configurar();
      await crear();
      fixture.detectChanges();
      component.load('BBVA');
      component.abrirHistorialDescargas();

      component.cerrarHistorialDescargas();

      expect(component.descargasModalAbierto).toBe(false);
    });

    it('load() con un banco DISTINTO mientras el modal está ABIERTO: refresca el historial', async () => {
      configurar();
      await crear();
      fixture.detectChanges();
      component.load('BBVA');
      component.abrirHistorialDescargas();
      bankServiceSpy.descargasCorte.calls.reset();

      component.load('BANAMEX');

      expect(bankServiceSpy.descargasCorte).toHaveBeenCalledWith('BANAMEX');
    });

    it('load() con un banco DISTINTO mientras el modal está CERRADO: no pide nada, pero el próximo open sí refresca', async () => {
      configurar();
      await crear();
      fixture.detectChanges();
      component.load('BBVA');
      component.abrirHistorialDescargas();
      component.cerrarHistorialDescargas();
      bankServiceSpy.descargasCorte.calls.reset();

      component.load('BANAMEX');
      expect(bankServiceSpy.descargasCorte).not.toHaveBeenCalled();

      component.abrirHistorialDescargas();
      expect(bankServiceSpy.descargasCorte).toHaveBeenCalledWith('BANAMEX');
    });

    it('error en descargasCorte(): marca descargasCorteError=true pero NO rompe el resto del panel', async () => {
      configurar();
      bankServiceSpy.descargasCorte.and.returnValue(throwError(() => new Error('falló')));
      await crear();
      fixture.detectChanges();
      component.load('BBVA');

      component.abrirHistorialDescargas();

      expect(component.descargasCorteError).toBe(true);
      expect(component.descargasCorteLoading).toBe(false);
    });

    it('botón "Ver historial": click llama a abrirHistorialDescargas() y renderiza el modal', async () => {
      configurar();
      await crear();
      fixture.detectChanges();
      component.load('BBVA');
      fixture.detectChanges();

      const boton: HTMLButtonElement = fixture.nativeElement.querySelector('.corte-descargar-btn--outline');
      boton.click();
      fixture.detectChanges();

      expect(component.descargasModalAbierto).toBe(true);
      expect(fixture.nativeElement.querySelector('app-modal')).not.toBeNull();
    });

    it('tabla de historial: 1 fila por descarga, con flecha/porcentaje si hay delta y "—" en la primera descarga (delta null)', async () => {
      configurar();
      await crear();
      fixture.detectChanges();
      component.load('BBVA');
      component.abrirHistorialDescargas();
      fixture.detectChanges();

      // Acotado a `app-modal` — la tabla "Resultados por mes" del tab Mensual (activo por
      // default) comparte la misma clase base `.corte-retrasadas-tabla`.
      const filas: NodeListOf<HTMLElement> = fixture.nativeElement.querySelectorAll('app-modal table.corte-retrasadas-tabla tbody tr');
      expect(filas.length).toBe(2);

      // Fila 0 (d2): direccion 'bajo' -> flecha verde + porcentaje.
      const delta0 = filas[0].querySelector('.corte-delta');
      expect(delta0).withContext('debe renderizar el indicador de delta cuando no es null').not.toBeNull();
      expect(delta0!.classList.contains('corte-delta--bajo')).toBe(true);
      expect(delta0!.textContent).toContain('▼');
      expect(delta0!.textContent).toContain('20.0%');

      // Fila 1 (d1): delta null -> sin indicador, solo "—".
      const delta1 = filas[1].querySelector('.corte-delta');
      expect(delta1).toBeNull();
      expect(filas[1].textContent).toContain('—');
    });

    it('direccion "subio": flecha roja hacia arriba', async () => {
      configurar();
      bankServiceSpy.descargasCorte.and.returnValue(of([
        { ...DESCARGAS_FIXTURE[0], delta: { countPct: 15, saldoPct: 15, direccion: 'subio' as const } },
      ]));
      await crear();
      fixture.detectChanges();
      component.load('BBVA');
      component.abrirHistorialDescargas();
      fixture.detectChanges();

      const delta = fixture.nativeElement.querySelector('.corte-delta');
      expect(delta.classList.contains('corte-delta--subio')).toBe(true);
      expect(delta.textContent).toContain('▲');
      expect(delta.textContent).toContain('+15.0%');
    });

    it('sin descargas todavía: no rompe, muestra el aviso de "todavía no hay ninguna"', async () => {
      configurar();
      bankServiceSpy.descargasCorte.and.returnValue(of([]));
      await crear();
      fixture.detectChanges();
      component.load('BBVA');
      component.abrirHistorialDescargas();
      fixture.detectChanges();

      expect(component.descargasCorte).toEqual([]);
      expect(fixture.nativeElement.querySelector('app-modal table.corte-retrasadas-tabla')).toBeNull();
      expect(fixture.nativeElement.textContent).toContain('Todavía no hay ninguna descarga registrada');
    });

    // Descargar el archivo real de una fila (2026-11-06, segunda ronda: antes el historial solo
    // mostraba el delta de backlog, no permitía recuperar el Excel de un punto pasado).
    it('descargarHistorico(): con driveFileId, llama al service y dispara la descarga', async () => {
      configurar();
      await crear();
      fixture.detectChanges();
      component.load('BBVA');
      component.abrirHistorialDescargas();

      component.descargarHistorico(DESCARGAS_FIXTURE[0]); // d2, driveFileId: 'drive-id-2'

      expect(bankServiceSpy.descargarReporteCorteHistorico).toHaveBeenCalledWith('d2');
      expect(component.descargandoHistoricoId).toBeNull(); // ya resuelto síncrono (of(...))
    });

    it('descargarHistorico(): sin driveFileId, NO llama al service (fila sin archivo disponible)', async () => {
      configurar();
      await crear();
      fixture.detectChanges();
      component.load('BBVA');
      component.abrirHistorialDescargas();

      component.descargarHistorico(DESCARGAS_FIXTURE[1]); // d1, driveFileId: null

      expect(bankServiceSpy.descargarReporteCorteHistorico).not.toHaveBeenCalled();
    });

    it('descargarHistorico(): error del service muestra toast y libera descargandoHistoricoId', async () => {
      configurar();
      bankServiceSpy.descargarReporteCorteHistorico.and.returnValue(throwError(() => new Error('falló')));
      await crear();
      fixture.detectChanges();
      component.load('BBVA');
      component.abrirHistorialDescargas();

      component.descargarHistorico(DESCARGAS_FIXTURE[0]);

      expect(toastServiceSpy.error).toHaveBeenCalled();
      expect(component.descargandoHistoricoId).toBeNull();
    });

    it('botón "Descargar" por fila: deshabilitado cuando driveFileId es null', async () => {
      configurar();
      await crear();
      fixture.detectChanges();
      component.load('BBVA');
      component.abrirHistorialDescargas();
      fixture.detectChanges();

      const filas: NodeListOf<HTMLElement> = fixture.nativeElement.querySelectorAll('app-modal table.corte-retrasadas-tabla tbody tr');
      const botonFila0 = filas[0].querySelector('button.corte-descargar-btn--outline') as HTMLButtonElement; // d2, con archivo
      const botonFila1 = filas[1].querySelector('button.corte-descargar-btn--outline') as HTMLButtonElement; // d1, sin archivo

      expect(botonFila0.disabled).toBe(false);
      expect(botonFila1.disabled).toBe(true);
    });
  });
});
