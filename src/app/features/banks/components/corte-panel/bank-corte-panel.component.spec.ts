import { TestBed } from '@angular/core/testing';
import { NO_ERRORS_SCHEMA } from '@angular/core';
import { CommonModule } from '@angular/common';
import { of, throwError } from 'rxjs';

import { BankCortePanelComponent } from './bank-corte-panel.component';
import { BankService } from '../../../../core/services/bank.service';
import {
  BankLedgerDiario, BankLedgerMensual, BankAntiguedadDepositos,
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

describe('BankCortePanelComponent (TestBed, Chrome real vía Karma)', () => {
  let bankServiceSpy: jasmine.SpyObj<BankService>;
  let component: BankCortePanelComponent;
  let fixture: import('@angular/core/testing').ComponentFixture<BankCortePanelComponent>;

  function configurar(): void {
    bankServiceSpy = jasmine.createSpyObj<BankService>(
      'BankService',
      ['ledgerMensual', 'ledgerDiario', 'antiguedadDepositos'],
    );
    bankServiceSpy.ledgerMensual.and.returnValue(of(LEDGER_MENSUAL_FIXTURE));
    bankServiceSpy.ledgerDiario.and.returnValue(of(LEDGER_DIARIO_FIXTURE));
    bankServiceSpy.antiguedadDepositos.and.returnValue(of(ANTIGUEDAD_FIXTURE));
  }

  async function crear(): Promise<void> {
    await TestBed.configureTestingModule({
      imports: [CommonModule],
      declarations: [BankCortePanelComponent],
      providers: [{ provide: BankService, useValue: bankServiceSpy }],
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

  describe('antigüedad', () => {
    it('load(): pide antiguedadDepositos() con el banco', async () => {
      configurar();
      await crear();
      fixture.detectChanges();

      component.load('BBVA');

      expect(bankServiceSpy.antiguedadDepositos).toHaveBeenCalledWith('BBVA');
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

      expect(bankServiceSpy.antiguedadDepositos).toHaveBeenCalledWith('BANAMEX');
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
  });
});
