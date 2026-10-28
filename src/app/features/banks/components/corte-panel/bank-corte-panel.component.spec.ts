import { TestBed } from '@angular/core/testing';
import { NO_ERRORS_SCHEMA } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Subject, of, throwError } from 'rxjs';

import { BankCortePanelComponent } from './bank-corte-panel.component';
import { BankService } from '../../../../core/services/bank.service';
import { BankCorteConciliacion, BankCortePeriodoRol, BankCorteAntiguedad } from '../../../../core/models/bank.model';
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

// Antigüedad del backlog (2026-10-28, reemplaza por completo el chart de Tendencia): 5 buckets
// fijos (Hoy/1-30/30-60/60-90/90+ — bucket 'Hoy' agregado el mismo día, separado del viejo
// '0-30' que ahora es '1-30'), 3 segmentos (iniciales/nuevos/identificados) con conteo + importe
// cada uno. "iniciales" siempre 0 en 'Hoy' y "nuevos" siempre 0 fuera de 'Hoy' — por
// construcción (ver bank-indicadores.service.js#getCorteAntiguedadBacklog).
const ANTIGUEDAD_FIXTURE: BankCorteAntiguedad = {
  buckets: [
    { bucket: 'Hoy', iniciales: 0, inicialesImporte: 0, nuevos: 2, nuevosImporte: 20000, identificados: 1, identificadosImporte: 10000 },
    { bucket: '1-30', iniciales: 3, inicialesImporte: 30000, nuevos: 0, nuevosImporte: 0, identificados: 4, identificadosImporte: 40000 },
    { bucket: '30-60', iniciales: 4, inicialesImporte: 40000, nuevos: 0, nuevosImporte: 0, identificados: 1, identificadosImporte: 10000 },
    { bucket: '60-90', iniciales: 1, inicialesImporte: 10000, nuevos: 0, nuevosImporte: 0, identificados: 0, identificadosImporte: 0 },
    { bucket: '90+', iniciales: 2, inicialesImporte: 20000, nuevos: 0, nuevosImporte: 0, identificados: 3, identificadosImporte: 30000 },
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
      'BankService', ['corteConciliacion', 'reporteCorte', 'periodoCorteRol', 'antiguedadCorte'],
    );
    bankServiceSpy.corteConciliacion.and.returnValue(of(CORTE_FIXTURE));
    bankServiceSpy.reporteCorte.and.returnValue(of(new Blob(['fake'], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })));
    bankServiceSpy.periodoCorteRol.and.returnValue(of(periodoRol));
    bankServiceSpy.antiguedadCorte.and.returnValue(of(ANTIGUEDAD_FIXTURE));
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

  // Antigüedad del backlog (2026-10-28, reemplaza por completo el chart de Tendencia) —
  // independiente de corteConciliacion()/periodo/corte histórico: un fallo acá NO debe tirar
  // abajo el resto del panel (ver cargarAntiguedad()).
  describe('antigüedad del backlog', () => {
    it('load(): pide antiguedadCorte() solo con el banco (sin periodo) y arma el chart con los 5 buckets', async () => {
      configurar({ periodo: 'semanal', puedeAlternar: true });
      await crear();
      fixture.detectChanges();

      component.load('BBVA');

      expect(bankServiceSpy.antiguedadCorte).toHaveBeenCalledWith('BBVA');
      expect(component.antiguedad).toEqual(ANTIGUEDAD_FIXTURE);
      // 3 segmentos fijos: iniciales/nuevos/identificados, todos datasets de barra. Orden de
      // más reciente a más vieja: Hoy, 1-30, 30-60, 60-90, 90+.
      expect(component.antiguedadChartData.labels).toEqual(['Hoy', '1-30 días', '30-60 días', '60-90 días', '90+ días']);
      expect(component.antiguedadChartData.datasets.length).toBe(3);
      expect(component.antiguedadChartData.datasets.every((d: any) => d.type === 'bar')).toBe(true);
      expect(component.antiguedadChartData.datasets[0].data).toEqual([0, 3, 4, 1, 2]);   // iniciales por bucket
      expect(component.antiguedadChartData.datasets[1].data).toEqual([2, 0, 0, 0, 0]);   // nuevos por bucket
      expect(component.antiguedadChartData.datasets[2].data).toEqual([1, 4, 1, 0, 3]);   // identificados por bucket
      expect(component.antiguedadLoading).toBe(false);
    });

    it('load() primera vez SIEMPRE pide antiguedadCorte(), aunque banco sea null/undefined', async () => {
      configurar({ periodo: 'semanal', puedeAlternar: true });
      await crear();
      fixture.detectChanges();

      component.load(null);

      expect(bankServiceSpy.antiguedadCorte).toHaveBeenCalledWith(null);
    });

    it('load() con el MISMO banco ya cargado: no vuelve a pedir antiguedadCorte()', async () => {
      configurar({ periodo: 'semanal', puedeAlternar: true });
      await crear();
      fixture.detectChanges();
      component.load('BBVA');
      bankServiceSpy.antiguedadCorte.calls.reset();

      component.load('BBVA');

      expect(bankServiceSpy.antiguedadCorte).not.toHaveBeenCalled();
    });

    it('load() con un banco DISTINTO: vuelve a pedir antiguedadCorte() con el nuevo banco', async () => {
      configurar({ periodo: 'semanal', puedeAlternar: true });
      await crear();
      fixture.detectChanges();
      component.load('BBVA');
      bankServiceSpy.antiguedadCorte.calls.reset();

      component.load('BANAMEX');

      expect(bankServiceSpy.antiguedadCorte).toHaveBeenCalledWith('BANAMEX');
    });

    // Importe por barra — cada dataset de barra lleva su importe correspondiente en un array
    // paralelo `importes`, leído por el callback del tooltip (ver buildAntiguedadChartOptions()).
    it('datasets de barra llevan el array `importes` correspondiente', async () => {
      configurar({ periodo: 'semanal', puedeAlternar: true });
      await crear();
      fixture.detectChanges();

      component.load('BBVA');

      const [iniciales, nuevos, identificados] = component.antiguedadChartData.datasets;
      expect(iniciales.importes).toEqual([0, 30000, 40000, 10000, 20000]);
      expect(nuevos.importes).toEqual([20000, 0, 0, 0, 0]);
      expect(identificados.importes).toEqual([10000, 40000, 10000, 0, 30000]);
    });

    it('tooltip del chart: agrega el importe formateado en MXN al label cuando el dataset lo tiene', async () => {
      configurar({ periodo: 'semanal', puedeAlternar: true });
      await crear();
      fixture.detectChanges();
      component.load('BBVA');

      const label = (component.antiguedadChartOptions as any).plugins.tooltip.callbacks.label({
        dataset: { label: 'No identificados iniciales', importes: [30000, 40000] },
        dataIndex: 0,
        formattedValue: '3',
      });

      expect(label).toContain('No identificados iniciales: 3');
      expect(label).toContain('$30,000.00');
    });

    it('tooltip del chart: sin array `importes` en el dataset, deja el label tal cual', async () => {
      configurar({ periodo: 'semanal', puedeAlternar: true });
      await crear();
      fixture.detectChanges();
      component.load('BBVA');

      const label = (component.antiguedadChartOptions as any).plugins.tooltip.callbacks.label({
        dataset: { label: 'Nuevos no identificados', importes: undefined },
        dataIndex: 0,
        formattedValue: '2',
      });

      expect(label).toBe('Nuevos no identificados: 2');
    });

    // Barras apiladas con etiquetas — mismo mecanismo ya construido para el chart anterior de
    // Tendencia: stacked, datalabels por segmento + total arriba del ÚLTIMO dataset del stack.
    describe('barras apiladas con etiquetas', () => {
      it('scales.x/y llevan stacked:true', async () => {
        configurar({ periodo: 'semanal', puedeAlternar: true });
        await crear();
        fixture.detectChanges();
        component.load('BBVA');

        const scales = (component.antiguedadChartOptions as any).scales;
        expect(scales.x.stacked).toBe(true);
        expect(scales.y.stacked).toBe(true);
      });

      it('datasets de barra llevan datalabels con color/formatter de segmento', async () => {
        configurar({ periodo: 'semanal', puedeAlternar: true });
        await crear();
        fixture.detectChanges();
        component.load('BBVA');

        const [iniciales, , identificados] = component.antiguedadChartData.datasets;
        // No es el último dataset: solo lleva el label de su propio segmento (objeto), no la
        // forma array (segmento + total).
        expect(Array.isArray(iniciales.datalabels)).toBe(false);
        expect(iniciales.datalabels.color).toBe('#fff');
        expect(iniciales.datalabels.formatter(3)).toBe('3');
        expect(iniciales.datalabels.formatter(0)).toBeNull();

        // Es el ÚLTIMO dataset del stack ("identificados"): forma array, 1er elemento = su
        // propio segmento, 2do = el total.
        expect(Array.isArray(identificados.datalabels)).toBe(true);
        expect(identificados.datalabels.length).toBe(2);
        expect(identificados.datalabels[0].formatter(5)).toBe('5');
      });

      it('el label de TOTAL del último dataset suma los 3 segmentos de ese bucket', async () => {
        configurar({ periodo: 'semanal', puedeAlternar: true });
        await crear();
        fixture.detectChanges();
        component.load('BBVA');

        const datasets = component.antiguedadChartData.datasets;
        const totalLabel = datasets[datasets.length - 1].datalabels[1];
        const ctxFalso = { chart: { data: { datasets } }, dataIndex: 0 };

        // Bucket 'Hoy': iniciales=0 + nuevos=2 + identificados=1 = 3.
        expect(totalLabel.formatter(undefined, ctxFalso)).toBe('3');
      });

      it('el label de TOTAL devuelve null si el total del bucket es 0', async () => {
        configurar({ periodo: 'semanal', puedeAlternar: true });
        await crear();
        fixture.detectChanges();
        component.load('BBVA');

        const datasets = [
          { data: [0, 0] },
          { data: [0, 0] },
        ];
        const totalLabel = component.antiguedadChartData.datasets[2].datalabels[1];
        const ctxFalso = { chart: { data: { datasets } }, dataIndex: 0 };

        expect(totalLabel.formatter(undefined, ctxFalso)).toBeNull();
      });
    });

    it('bucket faltante en la respuesta del backend: se completa con ceros (no rompe el orden fijo)', async () => {
      configurar({ periodo: 'semanal', puedeAlternar: true });
      bankServiceSpy.antiguedadCorte.and.returnValue(of({
        buckets: [
          { bucket: '1-30', iniciales: 3, inicialesImporte: 30000, nuevos: 0, nuevosImporte: 0, identificados: 5, identificadosImporte: 50000 },
        ],
      }));
      await crear();
      fixture.detectChanges();

      component.load('BBVA');

      // 'Hoy' (faltante) en 0, '1-30' con el dato real, el resto en 0.
      expect(component.antiguedadChartData.datasets[0].data).toEqual([0, 3, 0, 0, 0]);
    });

    it('error en antiguedadCorte(): marca antiguedadError=true pero NO rompe el resto del panel', async () => {
      configurar({ periodo: 'semanal', puedeAlternar: true });
      bankServiceSpy.antiguedadCorte.and.returnValue(throwError(() => new Error('falló')));
      await crear();
      fixture.detectChanges();

      component.load('BBVA');

      expect(component.antiguedadError).toBe(true);
      expect(component.antiguedadLoading).toBe(false);
      expect(component.error).toBe(false);
      expect(component.data).toEqual(CORTE_FIXTURE);
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
