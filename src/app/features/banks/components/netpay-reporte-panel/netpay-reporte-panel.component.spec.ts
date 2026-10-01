import { TestBed } from '@angular/core/testing';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { of, throwError } from 'rxjs';
import {
  LucideDynamicIcon,
  provideLucideIcons,
  LucideRefreshCw,
  LucideFileSpreadsheet,
  LucideLandmark,
  LucideUndo2,
  LucideEyeOff,
  LucideEye,
} from '@lucide/angular';

import { NetpayReportePanelComponent } from './netpay-reporte-panel.component';
import { BankService } from '../../../../core/services/bank.service';
import { AuthService } from '../../../../core/services/auth.service';
import { ConfirmModalComponent } from '../../../../shared/components/confirm-modal/confirm-modal.component';
import {
  NetpayReporte, NetpayReporteUploadResultado, NetpayReporteListaResultado, NetpayReporteCargaItem,
} from '../../../../core/models/netpay-reporte.model';

function fakeCargaItem(overrides: Partial<NetpayReporteCargaItem> = {}): NetpayReporteCargaItem {
  return {
    claveRastreo: 'CLAVE-1',
    fechaMovimiento: '2026-09-25T00:00:00.000Z',
    montoDepositoTotal: 1000,
    sucursales: ['Ferrocarril'],
    terminalIDs: ['T1'],
    estatusCarga: 'creado',
    ...overrides,
  };
}

function fakeReporte(overrides: Partial<NetpayReporte> = {}): NetpayReporte {
  return {
    _id: 'rep-1',
    claveRastreo: 'CLAVE-1',
    cuentaDeposito: '012610001090310145',
    fechaMovimiento: '2026-09-25T00:00:00.000Z',
    periodoDesde: '2026-09-25T00:00:00.000Z',
    periodoHasta: '2026-09-25T00:00:00.000Z',
    montoDepositoTotal: 1000,
    resumenVentas: { montoTransaccionado: 1050, comisiones: 40, iva: 6.4, montoDepositado: 1000 },
    folios: [{
      _id: 'folio-1', referencia: 'F1', terminalID: 'T1', storeId: 'S1', sucursal: 'Ferrocarril',
      nombreEmpresa: 'CAR', fechaTrx: '2026-09-24T00:00:00.000Z', horaTrx: '18:16',
      montoTrx: 822.87, comisionBasePct: 0.0075, comisionBaseMonto: 6.17, ivaComision: 0.99,
      comisionMasIva: 7.16, montoDeposito: 815.71, banco: 'SANTANDER', tipoTarjeta: 'Débito',
      codigoAutorizacion: '062788', orderId: '260924181626-2840746396783601', marca: null,
      duplicadoDeReporteId: null, koreCache: null,
    }],
    estatus: 'discrepancia',
    motivoDiscrepancia: 'sin_candidato',
    vinculo: null,
    movementIdConfirmado: null, movimientoVinculado: null, confirmadoPor: null, confirmadoEn: null,
    descartadoPor: null, descartadoEn: null, descartadoMotivo: null,
    resueltoManualPor: null, resueltoManualEn: null, justificacion: null,
    revertido: null, estatusLegacy: null,
    eliminado: false, eliminadoPor: null, eliminadoEn: null, eliminadoMotivo: null,
    cargadoPor: { userId: 'u1', nombre: 'Ana' }, cargadoEn: '2026-09-25T10:00:00.000Z',
    nombreArchivoOriginal: 'F0-Netpay.xlsx',
    ...overrides,
  };
}

describe('NetpayReportePanelComponent — carga manual del reporte (netpay-matching-v2, TestBed, Chrome real vía Karma)', () => {
  let bankServiceSpy: jasmine.SpyObj<BankService>;
  let authServiceSpy: jasmine.SpyObj<AuthService>;
  let component: NetpayReportePanelComponent;
  let fixture: import('@angular/core/testing').ComponentFixture<NetpayReportePanelComponent>;

  beforeEach(async () => {
    bankServiceSpy = jasmine.createSpyObj<BankService>('BankService', [
      'uploadNetpayReporte', 'listarNetpayReportes', 'obtenerNetpayReporteDetalle', 'buscarCandidatosNetpayReporte',
      'reevaluarNetpayReporte', 'resolverNetpayReporte', 'rechazarNetpayReporte',
      'eliminarNetpayReporte', 'restaurarNetpayReporte',
      'consultarFolioNetpayKore', 'exportarNetpayReporte', 'removeErpId',
    ]);
    authServiceSpy = jasmine.createSpyObj<AuthService>('AuthService', ['hasPermission']);
    authServiceSpy.hasPermission.and.returnValue(true);
    bankServiceSpy.listarNetpayReportes.and.returnValue(of({ reportes: [] } as NetpayReporteListaResultado));

    await TestBed.configureTestingModule({
      imports: [CommonModule, FormsModule, LucideDynamicIcon],
      declarations: [NetpayReportePanelComponent, ConfirmModalComponent],
      providers: [
        { provide: BankService, useValue: bankServiceSpy },
        { provide: AuthService, useValue: authServiceSpy },
        provideLucideIcons(
          LucideRefreshCw,
          LucideFileSpreadsheet,
          LucideLandmark,
          LucideUndo2,
          LucideEyeOff,
          LucideEye,
        ),
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(NetpayReportePanelComponent);
    component = fixture.componentInstance;
  });

  it('al hacerse visible: carga la lista de reportes (sin filtro, sin eliminados)', () => {
    component.visible = true;
    component.ngOnChanges({ visible: {} as any });

    expect(bankServiceSpy.listarNetpayReportes).toHaveBeenCalledWith(undefined, undefined);
    expect(component.reportes).toEqual([]);
  });

  it('error al cargar la lista: muestra el mensaje del backend', () => {
    bankServiceSpy.listarNetpayReportes.and.returnValue(throwError(() => ({ error: { error: 'Error de Mongo' } })));

    component.visible = true;
    component.ngOnChanges({ visible: {} as any });

    expect(component.listaError).toBe('Error de Mongo');
    expect(component.loadingLista).toBe(false);
  });

  it('cambiarFiltro(): pasa el estatus elegido y recarga', () => {
    component.cambiarFiltro('resuelto_por_reporte');
    expect(bankServiceSpy.listarNetpayReportes).toHaveBeenCalledWith('resuelto_por_reporte', undefined);
    expect(component.filtroEstatus).toBe('resuelto_por_reporte');
  });

  // netpay-matching-v2: toggle "Mostrar ocultos" — expone reportes eliminado:true (soft-delete).
  describe('toggleMostrarOcultos()', () => {
    it('activa incluirEliminados y recarga', () => {
      component.toggleMostrarOcultos();
      expect(component.mostrarOcultos).toBe(true);
      expect(bankServiceSpy.listarNetpayReportes).toHaveBeenCalledWith(undefined, true);
    });

    it('desactiva incluirEliminados y recarga', () => {
      component.mostrarOcultos = true;
      component.toggleMostrarOcultos();
      expect(component.mostrarOcultos).toBe(false);
      expect(bankServiceSpy.listarNetpayReportes).toHaveBeenCalledWith(undefined, undefined);
    });
  });

  describe('subir()', () => {
    it('no hace nada sin archivo seleccionado', () => {
      component.selectedFile = null;
      component.subir();
      expect(bankServiceSpy.uploadNetpayReporte).not.toHaveBeenCalled();
    });

    it('éxito (N=1, legacy): guarda el resultado, refresca la lista y abre el detalle del reporte recién cargado sin pasar por resultados', () => {
      const reporte = fakeReporte();
      const resultado: NetpayReporteUploadResultado = {
        reporte, candidatos: [],
        reportes: [fakeCargaItem({ claveRastreo: reporte.claveRastreo, estatusCarga: 'creado', reporte })],
        resumen: { total: 1, creados: 1, yaCargados: 0, errores: 0 },
      };
      bankServiceSpy.uploadNetpayReporte.and.returnValue(of(resultado));
      bankServiceSpy.obtenerNetpayReporteDetalle.and.returnValue(of({ reporte }));

      const file = new File(['dummy'], 'reporte.xlsx');
      component.selectedFile = file;
      component.subir();

      expect(bankServiceSpy.uploadNetpayReporte).toHaveBeenCalledWith(file);
      expect(component.uploading).toBe(false);
      expect(component.selectedFile).toBeNull();
      expect(component.view).toBe('detalle');
      expect(component.reporteActivo).toEqual(reporte);
      expect(component.resultadosItems).toBeNull();
      expect(bankServiceSpy.listarNetpayReportes).toHaveBeenCalled();
    });

    it('éxito (N>1): NO abre el detalle automáticamente, muestra la vista de resultados con todos los depósitos', () => {
      const items: NetpayReporteCargaItem[] = [
        fakeCargaItem({ claveRastreo: 'CLAVE-1', estatusCarga: 'creado', reporte: fakeReporte({ claveRastreo: 'CLAVE-1' }) }),
        fakeCargaItem({ claveRastreo: 'CLAVE-2', estatusCarga: 'ya_cargado', reporteId: 'rep-2', reporte: undefined }),
        fakeCargaItem({ claveRastreo: 'CLAVE-3', estatusCarga: 'error', error: 'Sin folios', reporte: undefined }),
      ];
      const resultado: NetpayReporteUploadResultado = {
        reportes: items,
        resumen: { total: 3, creados: 1, yaCargados: 1, errores: 1 },
      };
      bankServiceSpy.uploadNetpayReporte.and.returnValue(of(resultado));

      component.selectedFile = new File(['dummy'], 'reporte-global.xlsx');
      component.subir();

      expect(component.view).toBe('resultados');
      expect(component.reporteActivo).toBeNull();
      expect(component.resultadosItems).toEqual(items);
      expect(component.resultadosResumen).toEqual(resultado.resumen);
      expect(bankServiceSpy.obtenerNetpayReporteDetalle).not.toHaveBeenCalled();
    });

    it('error (ej. claveRastreo duplicado, 409): muestra el mensaje, no cambia de vista', () => {
      bankServiceSpy.uploadNetpayReporte.and.returnValue(throwError(() => ({ error: { error: 'Ya existe un reporte cargado para este depósito' } })));

      component.selectedFile = new File(['dummy'], 'reporte.xlsx');
      component.subir();

      expect(component.uploadError).toBe('Ya existe un reporte cargado para este depósito');
      expect(component.uploading).toBe(false);
      expect(component.view).toBe('lista');
    });
  });

  describe('onFileSelected() / onDrop() — auto-upload', () => {
    it('onFileSelected(): al elegir un archivo por el input, dispara subir() automáticamente', () => {
      const reporte = fakeReporte();
      const resultado: NetpayReporteUploadResultado = {
        reporte, candidatos: [],
        reportes: [fakeCargaItem({ estatusCarga: 'creado', reporte })],
        resumen: { total: 1, creados: 1, yaCargados: 0, errores: 0 },
      };
      bankServiceSpy.uploadNetpayReporte.and.returnValue(of(resultado));
      bankServiceSpy.obtenerNetpayReporteDetalle.and.returnValue(of({ reporte }));

      const file = new File(['dummy'], 'reporte.xlsx');
      const input = document.createElement('input');
      Object.defineProperty(input, 'files', { value: [file] });
      component.onFileSelected({ target: input } as unknown as Event);

      expect(bankServiceSpy.uploadNetpayReporte).toHaveBeenCalledWith(file);
      expect(component.view).toBe('detalle');
    });

    it('onDrop(): al soltar un .xlsx válido, dispara subir() automáticamente', () => {
      const reporte = fakeReporte();
      const resultado: NetpayReporteUploadResultado = {
        reporte, candidatos: [],
        reportes: [fakeCargaItem({ estatusCarga: 'creado', reporte })],
        resumen: { total: 1, creados: 1, yaCargados: 0, errores: 0 },
      };
      bankServiceSpy.uploadNetpayReporte.and.returnValue(of(resultado));
      bankServiceSpy.obtenerNetpayReporteDetalle.and.returnValue(of({ reporte }));

      const file = new File(['dummy'], 'reporte.xlsx');
      const event = {
        preventDefault: () => {},
        dataTransfer: { files: [file] },
      } as unknown as DragEvent;
      component.onDrop(event);

      expect(bankServiceSpy.uploadNetpayReporte).toHaveBeenCalledWith(file);
    });

    it('sin archivo (input limpiado): no dispara subir()', () => {
      const input = document.createElement('input');
      Object.defineProperty(input, 'files', { value: [] });
      component.onFileSelected({ target: input } as unknown as Event);

      expect(bankServiceSpy.uploadNetpayReporte).not.toHaveBeenCalled();
    });
  });

  describe('abrirDetalle()', () => {
    it('carga el detalle vía obtenerNetpayReporteDetalle — ya NO busca candidatos por defecto (confirm-candidate UI removida)', () => {
      const reporte = fakeReporte();
      bankServiceSpy.obtenerNetpayReporteDetalle.and.returnValue(of({ reporte }));

      component.abrirDetalle(reporte);

      expect(component.view).toBe('detalle');
      expect(component.reporteActivo).toEqual(reporte);
      expect(bankServiceSpy.buscarCandidatosNetpayReporte).not.toHaveBeenCalled();
    });
  });

  // netpay-reporte-global: vista de resultados (N>1 depósitos en un solo archivo) y
  // drill-down por fila. abrirDetalleDesdeResultado() es el click-handler de cada fila.
  describe('Vista de resultados (carga N>1) y drill-down', () => {
    it('fila "creado": abre el detalle con el reporte YA incluido en el item (sin pedirlo al backend)', () => {
      const reporte = fakeReporte({ claveRastreo: 'CLAVE-1' });
      const item = fakeCargaItem({ claveRastreo: 'CLAVE-1', estatusCarga: 'creado', reporte });
      component.resultadosItems = [item];
      component.resultadosResumen = { total: 1, creados: 1, yaCargados: 0, errores: 0 };
      component.view = 'resultados';
      bankServiceSpy.obtenerNetpayReporteDetalle.and.returnValue(of({ reporte }));

      component.abrirDetalleDesdeResultado(item);

      expect(component.view).toBe('detalle');
      expect(component.reporteActivo).toEqual(reporte);
      // _refrescarDetalle igual se llama para traer el estado más fresco (mismo patrón que abrirDetalle()).
      expect(bankServiceSpy.obtenerNetpayReporteDetalle).toHaveBeenCalledWith('rep-1');
    });

    it('fila "ya_cargado": abre el detalle usando reporteId (no trae reporte propio en el item)', () => {
      const existente = fakeReporte({ _id: 'rep-existente', claveRastreo: 'CLAVE-2' });
      const item = fakeCargaItem({ claveRastreo: 'CLAVE-2', estatusCarga: 'ya_cargado', reporteId: 'rep-existente' });
      component.resultadosItems = [item];
      component.view = 'resultados';
      bankServiceSpy.obtenerNetpayReporteDetalle.and.returnValue(of({ reporte: existente }));

      component.abrirDetalleDesdeResultado(item);

      expect(bankServiceSpy.obtenerNetpayReporteDetalle).toHaveBeenCalledWith('rep-existente');
      expect(component.view).toBe('detalle');
      expect(component.reporteActivo).toEqual(existente);
    });

    it('fila "error": no hace nada (no hay reporte que abrir)', () => {
      const item = fakeCargaItem({ claveRastreo: 'CLAVE-3', estatusCarga: 'error', error: 'Sin folios' });
      component.resultadosItems = [item];
      component.view = 'resultados';

      component.abrirDetalleDesdeResultado(item);

      expect(component.view).toBe('resultados');
      expect(bankServiceSpy.obtenerNetpayReporteDetalle).not.toHaveBeenCalled();
    });

    it('"Volver" desde un detalle abierto por drill-down regresa a la vista de resultados (NO a la lista)', () => {
      const reporte = fakeReporte({ claveRastreo: 'CLAVE-1' });
      const item = fakeCargaItem({ claveRastreo: 'CLAVE-1', estatusCarga: 'creado', reporte });
      component.resultadosItems = [item];
      component.view = 'resultados';
      bankServiceSpy.obtenerNetpayReporteDetalle.and.returnValue(of({ reporte }));
      component.abrirDetalleDesdeResultado(item);
      bankServiceSpy.listarNetpayReportes.calls.reset();

      component.volverALista();

      expect(component.view).toBe('resultados');
      expect(component.resultadosItems).toEqual([item]);
      // No se recarga la lista persistida — la vista de resultados es efímera, propia de esta carga.
      expect(bankServiceSpy.listarNetpayReportes).not.toHaveBeenCalled();
    });

    it('"Volver" desde un detalle abierto normalmente (vista lista) sigue yendo a la lista, sin regresión', () => {
      const reporte = fakeReporte();
      bankServiceSpy.obtenerNetpayReporteDetalle.and.returnValue(of({ reporte }));
      component.abrirDetalle(reporte);

      component.volverALista();

      expect(component.view).toBe('lista');
      expect(bankServiceSpy.listarNetpayReportes).toHaveBeenCalled();
    });
  });

  // Botón "Reevaluar" — re-dispara evaluarReporte() del lado del backend para un
  // reporte ya persistido (ej. tras corregir manualmente algo fuera de este flujo).
  describe('reevaluar()', () => {
    it('éxito: actualiza reporteActivo con el resultado', () => {
      const reporte = fakeReporte();
      bankServiceSpy.obtenerNetpayReporteDetalle.and.returnValue(of({ reporte }));
      component.abrirDetalle(reporte);

      const reevaluado = fakeReporte({ estatus: 'resuelto_por_reporte' });
      bankServiceSpy.reevaluarNetpayReporte.and.returnValue(of({ reporte: reevaluado, candidatos: [] }));

      component.reevaluar();

      expect(bankServiceSpy.reevaluarNetpayReporte).toHaveBeenCalledWith('rep-1');
      expect(component.reporteActivo).toEqual(reevaluado);
      expect(component.reevaluando).toBe(false);
    });

    it('error: muestra el mensaje', () => {
      const reporte = fakeReporte();
      bankServiceSpy.obtenerNetpayReporteDetalle.and.returnValue(of({ reporte }));
      component.abrirDetalle(reporte);

      bankServiceSpy.reevaluarNetpayReporte.and.returnValue(throwError(() => ({ error: { error: 'Error al reevaluar' } })));

      component.reevaluar();

      expect(component.reevaluarError).toBe('Error al reevaluar');
      expect(component.reevaluando).toBe(false);
    });
  });

  // Diálogo Resolver — reemplaza confirmarCandidato/seleccionar (removidos). Requiere
  // justificación, opcionalmente vincula 1 movimiento (nunca 2 — cardinalidad real del
  // reporte, distinta del bucket). Candidatos en modo 'ventana' (todos los elegibles,
  // ordenados por |diferencia|).
  describe('Resolver (reporte en discrepancia)', () => {
    beforeEach(() => {
      const reporte = fakeReporte();
      bankServiceSpy.obtenerNetpayReporteDetalle.and.returnValue(of({ reporte }));
      component.abrirDetalle(reporte);
    });

    it('abrirResolver(): carga candidatos en modo ventana', () => {
      bankServiceSpy.buscarCandidatosNetpayReporte.and.returnValue(of({
        candidatos: [{ _id: 'mov-1', banco: 'BBVA', fecha: '2026-09-25', concepto: null, deposito: 950, numeroAutorizacion: null, diferencia: -50 }],
      }));

      component.abrirResolver();

      expect(bankServiceSpy.buscarCandidatosNetpayReporte).toHaveBeenCalledWith('rep-1', 'ventana');
      expect(component.resolviendo).toBe(true);
      expect(component.resolverCandidatos.length).toBe(1);
    });

    it('puedeResolver(): false sin justificación, true con justificación no vacía', () => {
      component.resolverJustificacion = '';
      expect(component.puedeResolver()).toBe(false);
      component.resolverJustificacion = 'Depósito confirmado a mano';
      expect(component.puedeResolver()).toBe(true);
    });

    it('toggleSeleccionCandidato(): a lo sumo 1 (cardinalidad de reporte) — elegir otro reemplaza al anterior', () => {
      component.toggleSeleccionCandidato('mov-1');
      expect(component.resolverSeleccion.has('mov-1')).toBe(true);

      component.toggleSeleccionCandidato('mov-2');
      expect(component.resolverSeleccion.has('mov-1')).toBe(false);
      expect(component.resolverSeleccion.has('mov-2')).toBe(true);
      expect(component.resolverSeleccion.size).toBe(1);
    });

    it('confirmarResolver(): éxito — llama resolverNetpayReporte, actualiza reporteActivo y cierra el diálogo', () => {
      component.resolviendo = true;
      component.resolverJustificacion = 'Depósito confirmado a mano';
      component.toggleSeleccionCandidato('mov-1');
      const resuelto = fakeReporte({ estatus: 'resuelto_manual', justificacion: 'Depósito confirmado a mano' });
      bankServiceSpy.resolverNetpayReporte.and.returnValue(of({ reporte: resuelto, movimientos: [] }));

      component.confirmarResolver();

      expect(bankServiceSpy.resolverNetpayReporte).toHaveBeenCalledWith('rep-1', {
        justificacion: 'Depósito confirmado a mano', movementIds: ['mov-1'],
      });
      expect(component.reporteActivo).toEqual(resuelto);
      expect(component.resolviendo).toBe(false);
      expect(component.resolverEnviando).toBe(false);
    });

    it('confirmarResolver(): sin justificación no llama al service', () => {
      component.resolviendo = true;
      component.resolverJustificacion = '';

      component.confirmarResolver();

      expect(bankServiceSpy.resolverNetpayReporte).not.toHaveBeenCalled();
    });

    it('confirmarResolver(): error de negocio muestra el mensaje y no cierra el diálogo', () => {
      component.resolviendo = true;
      component.resolverJustificacion = 'Depósito confirmado a mano';
      bankServiceSpy.resolverNetpayReporte.and.returnValue(
        throwError(() => ({ error: { error: 'Este reporte no está en discrepancia' } })),
      );

      component.confirmarResolver();

      expect(component.resolverError).toBe('Este reporte no está en discrepancia');
      expect(component.resolviendo).toBe(true);
    });
  });

  describe('Rechazar', () => {
    beforeEach(() => {
      const reporte = fakeReporte();
      bankServiceSpy.obtenerNetpayReporteDetalle.and.returnValue(of({ reporte }));
      component.abrirDetalle(reporte);
    });

    it('confirmarRechazar(): éxito — llama rechazarNetpayReporte y actualiza reporteActivo', () => {
      component.rechazando = true;
      component.rechazarMotivo = 'Ya identificado por otra vía';
      const rechazado = fakeReporte({ estatus: 'rechazado', descartadoMotivo: 'Ya identificado por otra vía' });
      bankServiceSpy.rechazarNetpayReporte.and.returnValue(of({ reporte: rechazado }));

      component.confirmarRechazar();

      expect(bankServiceSpy.rechazarNetpayReporte).toHaveBeenCalledWith('rep-1', 'Ya identificado por otra vía');
      expect(component.reporteActivo).toEqual(rechazado);
      expect(component.rechazando).toBe(false);
    });

    it('error: muestra el mensaje, no cierra el diálogo', () => {
      component.rechazando = true;
      bankServiceSpy.rechazarNetpayReporte.and.returnValue(throwError(() => ({ error: { error: 'Este reporte ya está en un estado terminal' } })));

      component.confirmarRechazar();

      expect(component.rechazarError).toBe('Este reporte ya está en un estado terminal');
      expect(component.rechazando).toBe(true);
    });
  });

  // Ocultar (soft-delete, 2 pasos) / Mostrar ocultos / Restaurar.
  describe('Ocultar / Restaurar (soft-delete)', () => {
    beforeEach(() => {
      const reporte = fakeReporte();
      bankServiceSpy.obtenerNetpayReporteDetalle.and.returnValue(of({ reporte }));
      component.abrirDetalle(reporte);
    });

    it('togglePedirOcultar(): abre/cierra el prompt de confirmación', () => {
      expect(component.pideOcultar).toBe(false);
      component.togglePedirOcultar();
      expect(component.pideOcultar).toBe(true);
      component.togglePedirOcultar();
      expect(component.pideOcultar).toBe(false);
    });

    it('confirmarOcultar(): éxito — llama eliminarNetpayReporte y actualiza reporteActivo (eliminado:true)', () => {
      component.pideOcultar = true;
      component.motivoOcultar = 'Cargado por error';
      const oculto = fakeReporte({ eliminado: true, eliminadoMotivo: 'Cargado por error' });
      bankServiceSpy.eliminarNetpayReporte.and.returnValue(of({ reporte: oculto }));

      component.confirmarOcultar();

      expect(bankServiceSpy.eliminarNetpayReporte).toHaveBeenCalledWith('rep-1', 'Cargado por error');
      expect(component.reporteActivo).toEqual(oculto);
      expect(component.pideOcultar).toBe(false);
    });

    it('confirmarOcultar(): error muestra el mensaje, no cierra el prompt', () => {
      component.pideOcultar = true;
      bankServiceSpy.eliminarNetpayReporte.and.returnValue(throwError(() => ({ error: { error: 'Error al ocultar' } })));

      component.confirmarOcultar();

      expect(component.ocultarError).toBe('Error al ocultar');
      expect(component.pideOcultar).toBe(true);
    });

    it('restaurar(): éxito — llama restaurarNetpayReporte y actualiza reporteActivo (eliminado:false)', () => {
      component.reporteActivo = fakeReporte({ eliminado: true });
      const restaurado = fakeReporte({ eliminado: false });
      bankServiceSpy.restaurarNetpayReporte.and.returnValue(of({ reporte: restaurado }));

      component.restaurar();

      expect(bankServiceSpy.restaurarNetpayReporte).toHaveBeenCalledWith('rep-1');
      expect(component.reporteActivo).toEqual(restaurado);
    });

    it('restaurar(): error muestra el mensaje', () => {
      component.reporteActivo = fakeReporte({ eliminado: true });
      bankServiceSpy.restaurarNetpayReporte.and.returnValue(throwError(() => ({ error: { error: 'Error al restaurar' } })));

      component.restaurar();

      expect(component.restaurarError).toBe('Error al restaurar');
    });
  });

  describe('consultarKore()', () => {
    beforeEach(() => {
      bankServiceSpy.obtenerNetpayReporteDetalle.and.returnValue(of({ reporte: fakeReporte() }));
      component.abrirDetalle(fakeReporte());
    });

    it('éxito: cachea la cuenta tal cual (sin remapear) en el folio y lo expande', () => {
      const cuenta = { SerieExterna: 'H0', FolioExterno: '260100639', Total: 488.73 };
      bankServiceSpy.consultarFolioNetpayKore.and.returnValue(of({ cuenta, consultadoEn: '2026-09-25T12:00:00.000Z' }));

      const folio = component.reporteActivo!.folios[0];
      component.consultarKore(folio);

      expect(bankServiceSpy.consultarFolioNetpayKore).toHaveBeenCalledWith('rep-1', 'F1');
      expect(folio.koreCache).toEqual({ consultadoEn: '2026-09-25T12:00:00.000Z', cuenta });
      expect(component.folioExpandido).toBe('folio-1');
      expect(component.consultandoFolio).toBeNull();
    });

    it('404 (sin match en Kore): guarda el error POR folio, no cachea nada', () => {
      bankServiceSpy.consultarFolioNetpayKore.and.returnValue(throwError(() => ({ error: { error: 'No se encontró la cuenta en Kore para el folio F1' } })));

      const folio = component.reporteActivo!.folios[0];
      component.consultarKore(folio);

      expect(component.folioKoreError['folio-1']).toBe('No se encontró la cuenta en Kore para el folio F1');
      expect(folio.koreCache).toBeNull();
    });

    it('folio sin referencia: no colisiona con otro folio sin referencia, se puede expandir', () => {
      const sinRef1 = { ...component.reporteActivo!.folios[0], _id: 'folio-sin-ref-1', referencia: null };
      const sinRef2 = { ...component.reporteActivo!.folios[0], _id: 'folio-sin-ref-2', referencia: null };
      component.reporteActivo!.folios = [sinRef1, sinRef2];

      expect(component.folioKey(sinRef1)).toBe('folio-sin-ref-1');
      expect(component.folioKey(sinRef2)).toBe('folio-sin-ref-2');

      component.toggleFolio(sinRef1);
      expect(component.folioExpandido).toBe('folio-sin-ref-1');

      component.consultarKore(sinRef1);
      expect(bankServiceSpy.consultarFolioNetpayKore).not.toHaveBeenCalled();
      expect(component.consultandoFolio).toBeNull();
    });
  });

  describe('exportar()', () => {
    beforeEach(() => {
      bankServiceSpy.obtenerNetpayReporteDetalle.and.returnValue(of({ reporte: fakeReporte() }));
      component.abrirDetalle(fakeReporte());
    });

    it('éxito: dispara la descarga del blob', () => {
      const blob = new Blob(['excel']);
      bankServiceSpy.exportarNetpayReporte.and.returnValue(of(blob));
      const createObjectURLSpy = spyOn(URL, 'createObjectURL').and.returnValue('blob:fake');
      spyOn(URL, 'revokeObjectURL');

      component.exportar();

      expect(bankServiceSpy.exportarNetpayReporte).toHaveBeenCalledWith('rep-1');
      expect(createObjectURLSpy).toHaveBeenCalledWith(blob);
      expect(component.exportando).toBe(false);
    });

    it('error entregado como Blob (mismo patrón que report-panel): lo lee como texto y muestra el mensaje real', (done) => {
      const errorBlob = new Blob([JSON.stringify({ error: 'Reporte no encontrado' })], { type: 'application/json' });
      bankServiceSpy.exportarNetpayReporte.and.returnValue(throwError(() => ({ error: errorBlob })));

      component.exportar();
      setTimeout(() => {
        expect(component.exportError).toBe('Reporte no encontrado');
        done();
      }, 50);
    });
  });

  // Revertir — adaptado a v2: el guard ya NO es `estatus === 'confirmado'` (ese valor no
  // existe más), sino la presencia de movementIdConfirmado (poblado en
  // resuelto_por_reporte/vinculo:'erp-link' o resuelto_manual con movimiento vinculado;
  // 'corroborado' nunca lo puebla — nada que revertir ahí).
  describe('revertir()', () => {
    beforeEach(() => {
      const confirmado = fakeReporte({ estatus: 'resuelto_por_reporte', vinculo: 'erp-link', movementIdConfirmado: 'mov-1' });
      bankServiceSpy.obtenerNetpayReporteDetalle.and.returnValue(of({ reporte: confirmado }));
      component.abrirDetalle(confirmado);
    });

    it('éxito: llama a removeErpId con el erpId sintético NETPAYRPT-<claveRastreo>, refresca detalle', () => {
      bankServiceSpy.removeErpId.and.returnValue(of({
        _id: 'mov-1', erpIds: [], erpLinks: [], historialVinculacion: [], saldoErp: null, uuidXML: null,
        status: 'no_identificado', identificadoPor: [],
      }));
      const revertido = fakeReporte({ estatus: 'discrepancia', motivoDiscrepancia: 'revertido', movementIdConfirmado: null });
      bankServiceSpy.obtenerNetpayReporteDetalle.and.returnValue(of({ reporte: revertido }));

      component.pideConfirmarRevertir = true;
      component.revertir();

      expect(bankServiceSpy.removeErpId).toHaveBeenCalledWith('mov-1', 'NETPAYRPT-CLAVE-1');
      expect(component.revirtiendo).toBe(false);
      expect(component.pideConfirmarRevertir).toBe(false);
      expect(component.reporteActivo).toEqual(revertido);
    });

    it('error: muestra el mensaje, no cierra el prompt', () => {
      bankServiceSpy.removeErpId.and.returnValue(throwError(() => ({ error: { error: 'No tienes permiso para desvincular' } })));

      component.pideConfirmarRevertir = true;
      component.revertir();

      expect(component.revertirError).toBe('No tienes permiso para desvincular');
      expect(component.revirtiendo).toBe(false);
    });

    it('sin reporteActivo: no hace nada', () => {
      component.reporteActivo = null;
      component.revertir();
      expect(bankServiceSpy.removeErpId).not.toHaveBeenCalled();
    });

    it('reporteActivo sin movementIdConfirmado (ej. discrepancia o corroborado): no hace nada', () => {
      component.reporteActivo = fakeReporte({ estatus: 'discrepancia', movementIdConfirmado: null });
      component.revertir();
      expect(bankServiceSpy.removeErpId).not.toHaveBeenCalled();
    });
  });

  // navegarAMovimiento() — feature "navegación al movimiento bancario" (2026-10-01): el
  // panel vive anidado dentro de netpay-panel -> banks.component (no es una ruta aparte),
  // así que sube el dato por @Output en vez de usar el router — banks.component.ts#openBank
  // reusa el deep-link ya existente (banco/movId).
  describe('navegarAMovimiento() / @Output verMovimiento', () => {
    it('reporte con movementIdConfirmado: emite {banco:"BBVA", movId} con el _id del movimiento', () => {
      const emitSpy = spyOn(component.verMovimiento, 'emit');
      const reporte = fakeReporte({ movementIdConfirmado: 'mov-42' });

      component.navegarAMovimiento(reporte);

      expect(emitSpy).toHaveBeenCalledWith({ banco: 'BBVA', movId: 'mov-42' });
    });

    it('reporte sin movementIdConfirmado: no emite nada', () => {
      const emitSpy = spyOn(component.verMovimiento, 'emit');
      const reporte = fakeReporte({ movementIdConfirmado: null });

      component.navegarAMovimiento(reporte);

      expect(emitSpy).not.toHaveBeenCalled();
    });

    it('reporte null/undefined: no hace nada, no lanza', () => {
      const emitSpy = spyOn(component.verMovimiento, 'emit');

      expect(() => component.navegarAMovimiento(null)).not.toThrow();
      expect(() => component.navegarAMovimiento(undefined)).not.toThrow();
      expect(emitSpy).not.toHaveBeenCalled();
    });
  });

  describe('Vista detalle — tarjeta de movimiento vinculado', () => {
    it('reporte.movimientoVinculado presente: muestra banco/fecha/monto y el botón "Ver movimiento bancario"', () => {
      const reporte = fakeReporte({
        movementIdConfirmado: 'mov-1',
        movimientoVinculado: { banco: 'BBVA', fecha: '2026-09-29T00:00:00.000Z', monto: 503646.17 },
      });
      bankServiceSpy.obtenerNetpayReporteDetalle.and.returnValue(of({ reporte }));
      component.abrirDetalle(reporte);
      fixture.detectChanges();

      const texto = fixture.nativeElement.textContent as string;
      expect(texto).toContain('BBVA');
      expect(texto).toContain('Ver movimiento bancario');
    });

    it('reporte.movimientoVinculado:null (sin vincular, o el movimiento ya no existe): no muestra la tarjeta ni el botón', () => {
      const reporte = fakeReporte({ movementIdConfirmado: null, movimientoVinculado: null });
      bankServiceSpy.obtenerNetpayReporteDetalle.and.returnValue(of({ reporte }));
      component.abrirDetalle(reporte);
      fixture.detectChanges();

      const texto = fixture.nativeElement.textContent as string;
      expect(texto).not.toContain('Ver movimiento bancario');
    });
  });
});
