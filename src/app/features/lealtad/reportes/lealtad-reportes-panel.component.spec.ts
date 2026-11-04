import { of, throwError, Subject } from 'rxjs';
import { LealtadReportesPanelComponent } from './lealtad-reportes-panel.component';
import { LoyaltyService, LoyaltyAdjustmentReason } from '../../../core/services/loyalty.service';

function reason(overrides: Partial<LoyaltyAdjustmentReason> = {}): LoyaltyAdjustmentReason {
  return { id: 1, clave: 'bono', nombre: 'Bono', activo: true, puntosFijos: 100, categoria: 'bonificacion', ...overrides };
}

describe('LealtadReportesPanelComponent', () => {
  let loyalty: jasmine.SpyObj<LoyaltyService>;
  let comp: LealtadReportesPanelComponent;

  beforeEach(() => {
    loyalty = jasmine.createSpyObj<LoyaltyService>('LoyaltyService', [
      'listarReasons', 'exportarTarjetas', 'exportarMovimientos', 'obtenerTarjetasPorVencer',
    ]);
    loyalty.listarReasons.and.returnValue(of([reason()]));
    // Subject que nunca emite (en vez de of(...)): exportarExcel() arma y manda los filtros de
    // forma 100% síncrona (lo único que verifican estos tests) — si la llamada al servicio
    // emitiera acá, el callback .next() de éxito del componente dispararía el import() dinámico
    // REAL de exceljs (mismo patrón que _generarExcel en clientes-pendientes.component.ts), que
    // generaría y descargaría un .xlsx real durante la corrida de Karma. Sin necesidad para cubrir
    // lo pedido (armado de filtros + manejo de error), se evita por completo ese efecto secundario.
    loyalty.exportarTarjetas.and.returnValue(new Subject());
    loyalty.exportarMovimientos.and.returnValue(new Subject());
    loyalty.obtenerTarjetasPorVencer.and.returnValue(new Subject());
    comp = new LealtadReportesPanelComponent(loyalty);
  });

  afterEach(() => {
    comp.ngOnDestroy();
  });

  describe('Tipo de reporte', () => {
    it('default: movimientos', () => {
      expect(comp.reportTipo).toBe('movimientos');
    });

    it('selectReportTipo(): cambia el tipo activo', () => {
      comp.selectReportTipo('tarjetas');
      expect(comp.reportTipo).toBe('tarjetas');
      comp.selectReportTipo('movimientos');
      expect(comp.reportTipo).toBe('movimientos');
    });
  });

  describe('ngOnChanges() — carga de motivos (lazy, una sola vez)', () => {
    // Mismo criterio que report-panel.component.ts#ngOnChanges: el guard real es
    // `changes['visible'] && this.visible` — Angular ya deja seteado el @Input ANTES de llamar
    // ngOnChanges(), así que estos tests setean `comp.visible` a mano para reproducir ese orden.
    const abrir = { visible: { currentValue: true, previousValue: false, firstChange: true, isFirstChange: () => true } } as any;

    it('al abrir el panel (visible: true) carga los reasons', () => {
      comp.visible = true;
      comp.ngOnChanges(abrir);
      expect(loyalty.listarReasons).toHaveBeenCalledTimes(1);
      expect(comp.reasons).toEqual([reason()]);
    });

    it('al reabrir el panel no vuelve a pedir los reasons', () => {
      comp.visible = true;
      comp.ngOnChanges(abrir);
      comp.ngOnChanges(abrir);
      expect(loyalty.listarReasons).toHaveBeenCalledTimes(1);
    });

    it('si listarReasons falla, no revienta y deja reasons vacío', () => {
      loyalty.listarReasons.and.returnValue(throwError(() => new Error('boom')));
      comp.visible = true;
      expect(() => comp.ngOnChanges(abrir)).not.toThrow();
      expect(comp.reasons).toEqual([]);
    });
  });

  describe('Chips — Movimientos', () => {
    it('toggleMovTipo(): quita/agrega un tipo del multi-select (default: los 4 seleccionados)', () => {
      expect(comp.movTipos).toEqual(['ACUMULACION', 'CANJE', 'AJUSTE', 'MIGRACION']);
      comp.toggleMovTipo('CANJE');
      expect(comp.movTipos).toEqual(['ACUMULACION', 'AJUSTE', 'MIGRACION']);
      comp.toggleMovTipo('CANJE');
      expect(comp.movTipos).toContain('CANJE');
    });

    it('showMotivo: true solo cuando AJUSTE está entre los tipos seleccionados', () => {
      expect(comp.showMotivo).toBe(true); // default: los 4 tipos
      comp.toggleMovTipo('AJUSTE');
      expect(comp.showMotivo).toBe(false);
      comp.toggleMovTipo('AJUSTE');
      expect(comp.showMotivo).toBe(true);
    });

    it('toggleMovTipo(): al quitar AJUSTE, limpia el motivo ya elegido', () => {
      comp.movReasonId = 1;
      comp.toggleMovTipo('AJUSTE'); // ya no queda AJUSTE seleccionado
      expect(comp.movReasonId).toBeNull();
    });

    it('selectMovNivel()/selectMovOrigen(): exclusivos (un solo valor activo)', () => {
      comp.selectMovNivel('Plata');
      expect(comp.movNivelAplicado).toBe('Plata');
      comp.selectMovNivel('');
      expect(comp.movNivelAplicado).toBe('');

      comp.selectMovOrigen('kore');
      expect(comp.movOrigen).toBe('kore');
    });

    it('onMovPuntosMinChange()/onMovPuntosMaxChange(): parsean a número o null', () => {
      comp.onMovPuntosMinChange({ target: { value: '10' } } as any);
      expect(comp.movPuntosMin).toBe(10);
      comp.onMovPuntosMinChange({ target: { value: '' } } as any);
      expect(comp.movPuntosMin).toBeNull();
    });
  });

  describe('Chips — Tarjetas', () => {
    it('selectTarNivel()/selectTarActiva()/selectTarOrigen()/selectTarRevisionPendiente(): tri-estado exclusivo', () => {
      comp.selectTarNivel('Oro');
      expect(comp.tarNivel).toBe('Oro');

      comp.selectTarActiva('true');
      expect(comp.tarActiva).toBe('true');
      comp.selectTarActiva('');
      expect(comp.tarActiva).toBe('');

      comp.selectTarOrigen('kore');
      expect(comp.tarOrigen).toBe('kore');

      comp.selectTarRevisionPendiente('true');
      expect(comp.tarRevisionPendiente).toBe('true');
    });
  });

  describe('digestText / digestIsCustom', () => {
    it('movimientos: refleja los filtros activos', () => {
      expect(comp.digestText).toContain('cualquier fecha');
      expect(comp.digestText).toContain('todos los tipos');
      expect(comp.digestIsCustom).toBe(false);

      comp.selectMovNivel('Oro');
      expect(comp.digestText).toContain('nivel Oro');
      expect(comp.digestIsCustom).toBe(true);
    });

    it('tarjetas: refleja los filtros activos', () => {
      comp.selectReportTipo('tarjetas');
      expect(comp.digestText).toContain('todos los niveles');
      expect(comp.digestIsCustom).toBe(false);

      comp.selectTarActiva('true');
      expect(comp.digestText).toContain('solo activas');
      expect(comp.digestIsCustom).toBe(true);
    });
  });

  describe('exportarExcel() — Movimientos', () => {
    it('arma los filtros reales y llama a exportarMovimientos()', () => {
      comp.movFechaInicio = '2026-01-01';
      comp.movFechaFin = '2026-01-31';
      comp.toggleMovTipo('CANJE'); // deja ACUMULACION, AJUSTE, MIGRACION
      comp.selectMovNivel('Plata');
      comp.selectMovOrigen('kore');
      comp.movReasonId = 1;
      comp.movUsuarioNombre = '  Staff Uno  ';
      comp.movPuntosMin = 10;
      comp.movPuntosMax = 500;

      comp.exportarExcel();

      expect(loyalty.exportarMovimientos).toHaveBeenCalledWith({
        fechaInicio: '2026-01-01',
        fechaFin: '2026-01-31',
        tipo: 'ACUMULACION,AJUSTE,MIGRACION',
        nivelAplicado: 'Plata',
        origen: 'kore',
        reasonId: 1,
        usuarioNombre: 'Staff Uno',
        puntosMin: 10,
        puntosMax: 500,
      });
    });

    it('con los 4 tipos seleccionados (default), no manda `tipo` (sin filtro)', () => {
      comp.exportarExcel();
      expect(loyalty.exportarMovimientos).toHaveBeenCalledWith(jasmine.objectContaining({ tipo: undefined }));
    });

    it('no llama al servicio si no hay ningún tipo seleccionado', () => {
      comp.movTipos = [];
      comp.exportarExcel();
      expect(loyalty.exportarMovimientos).not.toHaveBeenCalled();
    });

    it('en error: limpia el loading y muestra un mensaje', () => {
      loyalty.exportarMovimientos.and.returnValue(throwError(() => ({ error: { error: 'Server error' } })));
      comp.exportarExcel();
      expect(comp.exportando).toBe(false);
      expect(comp.errorExportar).toBe('Server error');
    });

    it('no dispara una segunda exportación mientras la primera sigue en curso', () => {
      comp.exportando = true;
      comp.exportarExcel();
      expect(loyalty.exportarMovimientos).not.toHaveBeenCalled();
    });
  });

  describe('exportarExcel() — Tarjetas', () => {
    beforeEach(() => {
      comp.selectReportTipo('tarjetas');
    });

    it('arma los filtros reales y llama a exportarTarjetas()', () => {
      comp.selectTarNivel('Bronce');
      comp.selectTarActiva('false');
      comp.selectTarOrigen('numo');
      comp.tarFechaAltaInicio = '2026-01-01';
      comp.tarFechaAltaFin = '2026-01-31';
      comp.selectTarRevisionPendiente('true');

      comp.exportarExcel();

      expect(loyalty.exportarTarjetas).toHaveBeenCalledWith({
        nivel: 'Bronce',
        activa: false,
        origen: 'numo',
        fechaAltaInicio: '2026-01-01',
        fechaAltaFin: '2026-01-31',
        revisionPendiente: true,
      });
    });

    it('con los filtros en default, manda undefined (sin filtro) en todos los campos', () => {
      comp.exportarExcel();
      expect(loyalty.exportarTarjetas).toHaveBeenCalledWith({
        nivel: undefined, activa: undefined, origen: undefined,
        fechaAltaInicio: undefined, fechaAltaFin: undefined, revisionPendiente: undefined,
      });
    });

    it('en error: limpia el loading y muestra un mensaje', () => {
      loyalty.exportarTarjetas.and.returnValue(throwError(() => ({ error: { error: 'Server error' } })));
      comp.exportarExcel();
      expect(comp.exportando).toBe(false);
      expect(comp.errorExportar).toBe('Server error');
    });
  });

  // ── Reportes nuevos (2026-11-03) ──────────────────────────────────────────

  describe('"Transacciones por tarjeta" — reusa exportarMovimientos() (sin endpoint nuevo)', () => {
    beforeEach(() => comp.selectReportTipo('transacciones-tarjeta'));

    it('usa los mismos filtros que "Movimientos"', () => {
      comp.movNivelAplicado = 'Oro';
      comp.exportarExcel();
      expect(loyalty.exportarMovimientos).toHaveBeenCalledWith(jasmine.objectContaining({ nivelAplicado: 'Oro' }));
    });

    it('no llama al servicio si no hay ningún tipo de movimiento seleccionado', () => {
      comp.movTipos = [];
      comp.exportarExcel();
      expect(loyalty.exportarMovimientos).not.toHaveBeenCalled();
    });
  });

  describe('"Saldos totales"/"Clientes con saldo 0" — reusan exportarTarjetas() (sin endpoint nuevo)', () => {
    it('"Saldos totales" usa los mismos filtros que "Tarjetas"', () => {
      comp.selectReportTipo('saldos-totales');
      comp.selectTarNivel('Plata');
      comp.exportarExcel();
      expect(loyalty.exportarTarjetas).toHaveBeenCalledWith(jasmine.objectContaining({ nivel: 'Plata' }));
    });

    it('"Clientes con saldo 0" usa los mismos filtros que "Tarjetas"', () => {
      comp.selectReportTipo('saldo-cero');
      comp.selectTarOrigen('kore');
      comp.exportarExcel();
      expect(loyalty.exportarTarjetas).toHaveBeenCalledWith(jasmine.objectContaining({ origen: 'kore' }));
    });
  });

  describe('"Puntos que se vencieron" — resuelve el motivo de congelamiento dinámicamente', () => {
    beforeEach(() => comp.selectReportTipo('puntos-vencidos'));

    it('motivo encontrado: llama a exportarMovimientos con su reasonId', () => {
      loyalty.listarReasons.and.returnValue(of([
        reason({ id: 7, clave: 'congelamiento_inactividad', categoria: 'ajuste' }),
      ]));
      comp.exportarExcel();
      expect(loyalty.listarReasons).toHaveBeenCalledWith({ categoria: 'ajuste' });
      expect(loyalty.exportarMovimientos).toHaveBeenCalledWith({ reasonId: 7 });
    });

    it('motivo NO encontrado (seed no corrido): no llama a exportarMovimientos, muestra error', () => {
      loyalty.listarReasons.and.returnValue(of([reason({ clave: 'bono', categoria: 'bonificacion' })]));
      comp.exportarExcel();
      expect(loyalty.exportarMovimientos).not.toHaveBeenCalled();
      expect(comp.exportando).toBe(false);
      expect(comp.errorExportar).toContain('congelamiento');
    });

    it('error al resolver el motivo: limpia el loading y muestra un mensaje', () => {
      loyalty.listarReasons.and.returnValue(throwError(() => new Error('boom')));
      comp.exportarExcel();
      expect(comp.exportando).toBe(false);
      expect(comp.errorExportar).toBeTruthy();
    });
  });

  describe('"Puntos por vencer" — único reporte nuevo con endpoint propio', () => {
    beforeEach(() => comp.selectReportTipo('puntos-por-vencer'));

    it('llama a obtenerTarjetasPorVencer() con el default de 30 días', () => {
      comp.exportarExcel();
      expect(loyalty.obtenerTarjetasPorVencer).toHaveBeenCalledWith(30);
    });

    it('onPorVencerDiasChange(): actualiza porVencerDias; valores inválidos vuelven a 30', () => {
      comp.onPorVencerDiasChange({ target: { value: '15' } } as any);
      expect(comp.porVencerDias).toBe(15);
      comp.onPorVencerDiasChange({ target: { value: '0' } } as any);
      expect(comp.porVencerDias).toBe(30);
      comp.onPorVencerDiasChange({ target: { value: 'abc' } } as any);
      expect(comp.porVencerDias).toBe(30);
    });

    it('usa el porVencerDias configurado', () => {
      comp.porVencerDias = 15;
      comp.exportarExcel();
      expect(loyalty.obtenerTarjetasPorVencer).toHaveBeenCalledWith(15);
    });

    it('en error: limpia el loading y muestra un mensaje', () => {
      loyalty.obtenerTarjetasPorVencer.and.returnValue(throwError(() => ({ error: { error: 'Server error' } })));
      comp.exportarExcel();
      expect(comp.exportando).toBe(false);
      expect(comp.errorExportar).toBe('Server error');
    });
  });

  describe('digestText / digestIsCustom — reportes nuevos', () => {
    it('"Puntos que se vencieron": texto fijo, nunca "custom" (sin filtros propios)', () => {
      comp.selectReportTipo('puntos-vencidos');
      expect(comp.digestText).toContain('Congelamiento por inactividad');
      expect(comp.digestIsCustom).toBe(false);
    });

    it('"Puntos por vencer": refleja la ventana de días configurada', () => {
      comp.selectReportTipo('puntos-por-vencer');
      expect(comp.digestText).toContain('30');
      expect(comp.digestIsCustom).toBe(false);
      comp.porVencerDias = 10;
      expect(comp.digestText).toContain('10');
      expect(comp.digestIsCustom).toBe(true);
    });

    it('"Saldos totales"/"Clientes con saldo 0": reflejan los filtros de Tarjetas', () => {
      comp.selectReportTipo('saldos-totales');
      expect(comp.digestText).toContain('todos los niveles');
      comp.selectTarNivel('Oro');
      expect(comp.digestIsCustom).toBe(true);
    });
  });
});
