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
      'listarReasons', 'exportarTarjetas', 'exportarMovimientos', 'listarNivelesKore',
    ]);
    loyalty.listarReasons.and.returnValue(of([reason()]));
    // Catálogo real de niveles de Kore (2026-11-17) — reemplaza el array fijo Bronce/Plata/Oro/Azul
    // de los chips de "Nivel", ver lealtad-reportes-panel.component.ts#_nivelesLoaded.
    loyalty.listarNivelesKore.and.returnValue(of([]));
    // Subject que nunca emite (en vez de of(...)): exportarExcel() arma y manda los filtros de
    // forma 100% síncrona (lo único que verifican estos tests) — si la llamada al servicio
    // emitiera acá, el callback .next() de éxito del componente dispararía el import() dinámico
    // REAL de exceljs (mismo patrón que _generarExcel en clientes-pendientes.component.ts), que
    // generaría y descargaría un .xlsx real durante la corrida de Karma. Sin necesidad para cubrir
    // lo pedido (armado de filtros + manejo de error), se evita por completo ese efecto secundario.
    loyalty.exportarTarjetas.and.returnValue(new Subject());
    loyalty.exportarMovimientos.and.returnValue(new Subject());
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

  // Bug real 2026-11-17: los chips de "Nivel" (Movimientos y Tarjetas) usaban un array fijo
  // Bronce/Plata/Oro/Azul, desincronizado del catálogo real que gestiona Kore (sin Esmeralda ni
  // cualquier nivel nuevo). Mismo criterio lazy que los reasons de arriba.
  describe('ngOnChanges() — carga del catálogo de niveles Kore (lazy, una sola vez)', () => {
    const abrir = { visible: { currentValue: true, previousValue: false, firstChange: true, isFirstChange: () => true } } as any;

    it('al abrir el panel carga el catálogo real de niveles', () => {
      loyalty.listarNivelesKore.and.returnValue(of([
        { id: 1, koreId: '1', nombre: 'Esmeralda', porcentaje: 3, esInicial: false, activo: true },
      ] as any));
      comp.visible = true;
      comp.ngOnChanges(abrir);

      expect(loyalty.listarNivelesKore).toHaveBeenCalledWith(true);
      expect(comp.nivelesCatalogo.map((n) => n.nombre)).toEqual(['Esmeralda']);
    });

    it('al reabrir el panel no vuelve a pedir el catálogo', () => {
      comp.visible = true;
      comp.ngOnChanges(abrir);
      comp.ngOnChanges(abrir);
      expect(loyalty.listarNivelesKore).toHaveBeenCalledTimes(1);
    });

    it('si falla, no revienta y los chips quedan sin opciones', () => {
      loyalty.listarNivelesKore.and.returnValue(throwError(() => new Error('boom')));
      comp.visible = true;
      expect(() => comp.ngOnChanges(abrir)).not.toThrow();
      expect(comp.nivelesCatalogo).toEqual([]);
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
      comp.movTelefono = '  5551234567  ';
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
        telefono: '5551234567',
        puntosMin: 10,
        puntosMax: 500,
      });
    });

    it('con los 4 tipos seleccionados (default), no manda `tipo` (sin filtro)', () => {
      comp.exportarExcel();
      expect(loyalty.exportarMovimientos).toHaveBeenCalledWith(jasmine.objectContaining({ tipo: undefined }));
    });

    // Filtro "Teléfono/tarjeta" (2026-11-20) — distinto de "Usuario" (operador/staff), no lo
    // reemplaza: ambos conviven y se mandan juntos al backend.
    it('movTelefono: se recorta y se manda como `telefono` (distinto de usuarioNombre)', () => {
      comp.movUsuarioNombre = 'Staff Uno';
      comp.movTelefono = '  5559876543  ';
      comp.exportarExcel();
      expect(loyalty.exportarMovimientos).toHaveBeenCalledWith(jasmine.objectContaining({
        usuarioNombre: 'Staff Uno',
        telefono: '5559876543',
      }));
    });

    it('movTelefono vacío: no manda `telefono` (sin filtro)', () => {
      comp.exportarExcel();
      expect(loyalty.exportarMovimientos).toHaveBeenCalledWith(jasmine.objectContaining({ telefono: undefined }));
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

  // "Movimientos por centro" (2026-11-20) — mismo criterio que "Transacciones por tarjeta": sin
  // endpoint propio, agregación 100% del lado del cliente sobre GET /loyalty/ledger/export.
  describe('"Movimientos por centro" — reusa exportarMovimientos() (sin endpoint nuevo)', () => {
    beforeEach(() => comp.selectReportTipo('por-centro'));

    it('usa los mismos filtros que "Movimientos"', () => {
      comp.movOrigen = 'kore';
      comp.exportarExcel();
      expect(loyalty.exportarMovimientos).toHaveBeenCalledWith(jasmine.objectContaining({ origen: 'kore' }));
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

  // Bug real detectado en reliability review (2026-11-20): _generarExcelPorCentro() (hoja "Detalle
  // de movimientos") agrupaba/coloreaba por `centroCosto.nombre` mientras _agruparPorCentro() (hoja
  // agregada) agrupa por `centroCosto.serieFacturacion` — ni `nombre` ni `serieFacturacion` son
  // únicos en el modelo CentroCosto, así que dos centros con el MISMO nombre pero distinta serie (o
  // una serie null) podían terminar en buckets distintos entre las dos hojas de un mismo reporte.
  // Fix inicial: ambos usaban _claveCentro() como única fuente de la llave de agrupación/color.
  //
  // Decisión de producto posterior (2026-11-20, confirmada): la hoja agregada (_agruparPorCentro)
  // sigue usando _claveCentro() sin cambios. La hoja de detalle, en cambio, usa ahora
  // _claveColorDetalle(), que con `serieFacturacion` ausente cae a `nombre` en vez de colapsar
  // directo a 'Sin centro' — así dos centros reales distintos que ambos carecen de
  // `serieFacturacion` reciben colores distintos fila por fila (la distinción visual importa más
  // ahí que bucketear igual que la hoja agregada).
  describe('_claveCentro() / _agruparPorCentro() — llave de agrupación de la hoja agregada', () => {
    it('_claveCentro() usa serieFacturacion (no nombre) como llave, con fallback a "Sin centro"', () => {
      const conSerieA = { centroCosto: { nombre: 'Sucursal Centro', serieFacturacion: 'A0' } } as any;
      const conSerieB = { centroCosto: { nombre: 'Sucursal Centro', serieFacturacion: 'B0' } } as any;
      const sinSerie = { centroCosto: { nombre: 'Sucursal Centro', serieFacturacion: null } } as any;
      const sinCentro = { centroCosto: null } as any;

      expect((comp as any)._claveCentro(conSerieA)).toBe('A0');
      expect((comp as any)._claveCentro(conSerieB)).toBe('B0');
      expect((comp as any)._claveCentro(sinSerie)).toBe('Sin centro');
      expect((comp as any)._claveCentro(sinCentro)).toBe('Sin centro');
    });

    it('_agruparPorCentro(): dos centros con el MISMO nombre pero distinta serieFacturacion quedan en buckets separados', () => {
      const rows = [
        { tipo: 'ACUMULACION', puntos: 10, card: { telefono: '111' }, centroCosto: { nombre: 'Sucursal Centro', serieFacturacion: 'A0' } },
        { tipo: 'ACUMULACION', puntos: 20, card: { telefono: '222' }, centroCosto: { nombre: 'Sucursal Centro', serieFacturacion: 'B0' } },
      ] as any;

      const agregado = (comp as any)._agruparPorCentro(rows);

      expect(agregado.length).toBe(2);
      expect(agregado.map((f: any) => f.centro).sort()).toEqual(['A0', 'B0']);
    });
  });

  describe('_claveColorDetalle() — llave de agrupación/color de la hoja "Detalle de movimientos"', () => {
    it('usa serieFacturacion cuando está presente, igual que _claveCentro()', () => {
      const conSerieA = { centroCosto: { nombre: 'Sucursal Centro', serieFacturacion: 'A0' } } as any;
      const conSerieB = { centroCosto: { nombre: 'Sucursal Centro', serieFacturacion: 'B0' } } as any;

      expect((comp as any)._claveColorDetalle(conSerieA)).toBe('A0');
      expect((comp as any)._claveColorDetalle(conSerieB)).toBe('B0');
    });

    it('sin serieFacturacion, cae a nombre (no a "Sin centro" directo) — a diferencia de _claveCentro()', () => {
      const sinSerie = { centroCosto: { nombre: 'Sucursal Centro', serieFacturacion: null } } as any;

      expect((comp as any)._claveColorDetalle(sinSerie)).toBe('Sucursal Centro');
      expect((comp as any)._claveCentro(sinSerie)).toBe('Sin centro');
    });

    it('sin serieFacturacion ni nombre, cae a "Sin centro"', () => {
      const sinNada = { centroCosto: { nombre: null, serieFacturacion: null } } as any;
      const sinCentro = { centroCosto: null } as any;

      expect((comp as any)._claveColorDetalle(sinNada)).toBe('Sin centro');
      expect((comp as any)._claveColorDetalle(sinCentro)).toBe('Sin centro');
    });

    it('dos movimientos con serieFacturacion null pero distinto nombre obtienen llaves distintas en el detalle', () => {
      const centroUno = { centroCosto: { nombre: 'Centro Uno', serieFacturacion: null } } as any;
      const centroDos = { centroCosto: { nombre: 'Centro Dos', serieFacturacion: null } } as any;

      const claveUno = (comp as any)._claveColorDetalle(centroUno);
      const claveDos = (comp as any)._claveColorDetalle(centroDos);

      expect(claveUno).not.toBe(claveDos);
      expect(claveUno).toBe('Centro Uno');
      expect(claveDos).toBe('Centro Dos');
    });

    it('dos movimientos con el MISMO serieFacturacion comparten llave sin importar el nombre', () => {
      const conNombreA = { centroCosto: { nombre: 'Sucursal A', serieFacturacion: 'A0' } } as any;
      const conNombreB = { centroCosto: { nombre: 'Sucursal B', serieFacturacion: 'A0' } } as any;

      expect((comp as any)._claveColorDetalle(conNombreA)).toBe((comp as any)._claveColorDetalle(conNombreB));
    });
  });

  // Orden de filas en los reportes de movimientos (2026-11-23, pedido explícito del usuario): el
  // backend regresa GET /loyalty/ledger/export en DESC por fecha; los Excel descargados deben
  // mostrar el movimiento más ANTIGUO primero. Se prueba el helper puro directamente (sin invocar
  // exceljs), mismo criterio que _claveCentro()/_claveColorDetalle() arriba.
  describe('_ordenarAscPorFecha() — orden ascendente para los Excel descargados', () => {
    it('reordena ascendente por createdAt (más antiguo primero, más reciente al final)', () => {
      const rows = [
        { createdAt: '2026-03-01T10:00:00.000Z' },
        { createdAt: '2026-01-01T10:00:00.000Z' },
        { createdAt: '2026-02-01T10:00:00.000Z' },
      ] as any;

      const resultado = (comp as any)._ordenarAscPorFecha(rows);

      expect(resultado.map((r: any) => r.createdAt)).toEqual([
        '2026-01-01T10:00:00.000Z', '2026-02-01T10:00:00.000Z', '2026-03-01T10:00:00.000Z',
      ]);
    });

    it('no muta el array original', () => {
      const rows = [{ createdAt: '2026-03-01T10:00:00.000Z' }, { createdAt: '2026-01-01T10:00:00.000Z' }] as any;
      const original = [...rows];

      (comp as any)._ordenarAscPorFecha(rows);

      expect(rows).toEqual(original);
    });
  });

  // "Transacciones por tarjeta" agrega una fila por tarjeta (no por movimiento) — no tiene un
  // campo de fecha propio, así que el orden "más antiguo primero" se ancla al movimiento más
  // antiguo de cada tarjeta, sin tocar saldoActual (que sigue dependiendo del orden DESC original).
  describe('_agruparPorTarjeta() — orden de salida ascendente por el movimiento más antiguo de cada tarjeta', () => {
    it('ordena las tarjetas por su movimiento más antiguo (rows llega DESC, como el backend real)', () => {
      // DESC por fecha: tarjeta 111 tiene su único movimiento en marzo; tarjeta 222 tiene dos,
      // el más antiguo en enero.
      const rows = [
        { tipo: 'ACUMULACION', puntos: 10, saldoResultante: 100, createdAt: '2026-03-01T10:00:00.000Z', card: { telefono: '111', nombre: 'Uno' } },
        { tipo: 'ACUMULACION', puntos: 5, saldoResultante: 50, createdAt: '2026-02-01T10:00:00.000Z', card: { telefono: '222', nombre: 'Dos' } },
        { tipo: 'ACUMULACION', puntos: 5, saldoResultante: 45, createdAt: '2026-01-01T10:00:00.000Z', card: { telefono: '222', nombre: 'Dos' } },
      ] as any;

      const resultado = (comp as any)._agruparPorTarjeta(rows);

      // 222 (más antiguo: enero) antes que 111 (más antiguo: marzo).
      expect(resultado.map((f: any) => f.telefono)).toEqual(['222', '111']);
    });

    it('saldoActual sigue tomando el primer movimiento visto (orden DESC original), sin verse afectado por el reorden de salida', () => {
      const rows = [
        { tipo: 'ACUMULACION', puntos: 5, saldoResultante: 999, createdAt: '2026-03-01T10:00:00.000Z', card: { telefono: '111', nombre: 'Uno' } },
        { tipo: 'ACUMULACION', puntos: 5, saldoResultante: 1, createdAt: '2026-01-01T10:00:00.000Z', card: { telefono: '111', nombre: 'Uno' } },
      ] as any;

      const [fila] = (comp as any)._agruparPorTarjeta(rows);

      expect(fila.saldoActual).toBe(999);
    });
  });

  // Serie-Folio + tipo de movimiento en el detalle de "Movimientos por centro" (2026-11-23,
  // pedido explícito del usuario) — backend confirmado (loyalty-ledger.service.js): la Serie-Folio
  // limpia es "serie-folio" y el sufijo ":CANJE"/":PROMOCION" desambigua movimientos que comparten
  // folio de venta bajo un índice único en BD.
  describe('_serieFolioYTipo() — separa Serie-Folio limpio del sufijo, combinado con el tipo de movimiento', () => {
    it('con sufijo ":PROMOCION": Serie-Folio limpio + "Acumulación (PROMOCION)"', () => {
      const m = { tipo: 'ACUMULACION', referenciaExterna: 'A0-12345:PROMOCION' } as any;
      expect((comp as any)._serieFolioYTipo(m)).toEqual({
        serieFolio: 'A0-12345', tipoMovimiento: 'Acumulación (PROMOCION)',
      });
    });

    it('con sufijo ":CANJE": Serie-Folio limpio + "Canje (CANJE)"', () => {
      const m = { tipo: 'CANJE', referenciaExterna: 'A0-12345:CANJE' } as any;
      expect((comp as any)._serieFolioYTipo(m)).toEqual({
        serieFolio: 'A0-12345', tipoMovimiento: 'Canje (CANJE)',
      });
    });

    it('sin sufijo: Serie-Folio tal cual + solo el tipo, SIN paréntesis vacíos', () => {
      const m = { tipo: 'AJUSTE', referenciaExterna: 'A0-12345' } as any;
      expect((comp as any)._serieFolioYTipo(m)).toEqual({
        serieFolio: 'A0-12345', tipoMovimiento: 'Ajuste',
      });
    });

    it('sin referenciaExterna (null/undefined): Serie-Folio vacío, solo el tipo', () => {
      expect((comp as any)._serieFolioYTipo({ tipo: 'MIGRACION', referenciaExterna: null } as any)).toEqual({
        serieFolio: '', tipoMovimiento: 'Migración',
      });
      expect((comp as any)._serieFolioYTipo({ tipo: 'MIGRACION' } as any)).toEqual({
        serieFolio: '', tipoMovimiento: 'Migración',
      });
    });
  });

  describe('digestText / digestIsCustom — reportes nuevos', () => {
    it('"Puntos que se vencieron": texto fijo, nunca "custom" (sin filtros propios)', () => {
      comp.selectReportTipo('puntos-vencidos');
      expect(comp.digestText).toContain('Congelamiento por inactividad');
      expect(comp.digestIsCustom).toBe(false);
    });

    it('"Saldos totales"/"Clientes con saldo 0": reflejan los filtros de Tarjetas', () => {
      comp.selectReportTipo('saldos-totales');
      expect(comp.digestText).toContain('todos los niveles');
      comp.selectTarNivel('Oro');
      expect(comp.digestIsCustom).toBe(true);
    });
  });
});
