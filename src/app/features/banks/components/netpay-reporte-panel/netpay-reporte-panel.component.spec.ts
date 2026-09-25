import { TestBed } from '@angular/core/testing';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { of, throwError } from 'rxjs';

import { NetpayReportePanelComponent } from './netpay-reporte-panel.component';
import { BankService } from '../../../../core/services/bank.service';
import { AuthService } from '../../../../core/services/auth.service';
import { ConfirmModalComponent } from '../../../../shared/components/confirm-modal/confirm-modal.component';
import {
  NetpayReporte, NetpayReporteUploadResultado, NetpayReporteListaResultado,
} from '../../../../core/models/netpay-reporte.model';

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
      codigoAutorizacion: '062788', orderId: '260924181626-2840746396783601', koreCache: null,
    }],
    estatus: 'pendiente',
    movementIdConfirmado: null, confirmadoPor: null, confirmadoEn: null,
    descartadoPor: null, descartadoEn: null, descartadoMotivo: null,
    cargadoPor: { userId: 'u1', nombre: 'Ana' }, cargadoEn: '2026-09-25T10:00:00.000Z',
    nombreArchivoOriginal: 'F0-Netpay.xlsx',
    ...overrides,
  };
}

describe('NetpayReportePanelComponent — carga manual del reporte (Implementación 1, TestBed, Chrome real vía Karma)', () => {
  let bankServiceSpy: jasmine.SpyObj<BankService>;
  let authServiceSpy: jasmine.SpyObj<AuthService>;
  let component: NetpayReportePanelComponent;
  let fixture: import('@angular/core/testing').ComponentFixture<NetpayReportePanelComponent>;

  beforeEach(async () => {
    bankServiceSpy = jasmine.createSpyObj<BankService>('BankService', [
      'uploadNetpayReporte', 'listarNetpayReportes', 'obtenerNetpayReporteDetalle', 'buscarCandidatosNetpayReporte',
      'confirmarNetpayReporte', 'descartarNetpayReporte', 'consultarFolioNetpayKore', 'exportarNetpayReporte',
      'removeErpId',
    ]);
    authServiceSpy = jasmine.createSpyObj<AuthService>('AuthService', ['hasPermission']);
    authServiceSpy.hasPermission.and.returnValue(true);
    bankServiceSpy.listarNetpayReportes.and.returnValue(of({ reportes: [] } as NetpayReporteListaResultado));

    await TestBed.configureTestingModule({
      imports: [CommonModule, FormsModule],
      declarations: [NetpayReportePanelComponent, ConfirmModalComponent],
      providers: [
        { provide: BankService, useValue: bankServiceSpy },
        { provide: AuthService, useValue: authServiceSpy },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(NetpayReportePanelComponent);
    component = fixture.componentInstance;
  });

  it('al hacerse visible: carga la lista de reportes (sin filtro)', () => {
    component.visible = true;
    component.ngOnChanges({ visible: {} as any });

    expect(bankServiceSpy.listarNetpayReportes).toHaveBeenCalledWith(undefined);
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
    component.cambiarFiltro('confirmado');
    expect(bankServiceSpy.listarNetpayReportes).toHaveBeenCalledWith('confirmado');
    expect(component.filtroEstatus).toBe('confirmado');
  });

  describe('subir()', () => {
    it('no hace nada sin archivo seleccionado', () => {
      component.selectedFile = null;
      component.subir();
      expect(bankServiceSpy.uploadNetpayReporte).not.toHaveBeenCalled();
    });

    it('éxito: guarda el resultado, refresca la lista y abre el detalle del reporte recién cargado', () => {
      const reporte = fakeReporte();
      const resultado: NetpayReporteUploadResultado = { reporte, candidatos: [{ _id: 'mov-1', banco: 'BBVA', fecha: '2026-09-25', concepto: null, deposito: 1000, numeroAutorizacion: null }] };
      bankServiceSpy.uploadNetpayReporte.and.returnValue(of(resultado));
      bankServiceSpy.obtenerNetpayReporteDetalle.and.returnValue(of({ reporte }));

      const file = new File(['dummy'], 'reporte.xlsx');
      component.selectedFile = file;
      component.subir();

      expect(bankServiceSpy.uploadNetpayReporte).toHaveBeenCalledWith(file);
      expect(component.uploading).toBe(false);
      expect(component.selectedFile).toBeNull();
      expect(component.uploadResultado).toEqual(resultado);
      expect(component.view).toBe('detalle');
      expect(component.reporteActivo).toEqual(reporte);
      expect(bankServiceSpy.listarNetpayReportes).toHaveBeenCalled();
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

  // Fix 1 (2026-09-25, pedido explícito del usuario): la carga ya no espera un click aparte
  // en "Cargar reporte" (botón quitado del template) — onFileSelected()/onDrop() (que llaman
  // _setFile() internamente) disparan subir() automáticamente al asignar un archivo.
  describe('onFileSelected() / onDrop() — auto-upload (Fix 1)', () => {
    it('onFileSelected(): al elegir un archivo por el input, dispara subir() automáticamente', () => {
      const reporte = fakeReporte();
      const resultado: NetpayReporteUploadResultado = { reporte, candidatos: [] };
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
      const resultado: NetpayReporteUploadResultado = { reporte, candidatos: [] };
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

  describe('abrirDetalle() / candidatos', () => {
    it('abre OTRO reporte distinto al recién cargado (pendiente): limpia uploadResultado y busca candidatos EN VIVO', () => {
      const reporteSubido = fakeReporte({ _id: 'rep-recien-subido' });
      component.uploadResultado = { reporte: reporteSubido, candidatos: [{ _id: 'mov-1', banco: 'BBVA', fecha: '2026-09-25', concepto: null, deposito: 1000, numeroAutorizacion: null }] };

      const otroReporte = fakeReporte({ _id: 'rep-otro' });
      bankServiceSpy.obtenerNetpayReporteDetalle.and.returnValue(of({ reporte: otroReporte }));
      const candidatosRecalculados = [{ _id: 'mov-2', banco: 'BBVA', fecha: '2026-09-25', concepto: null, deposito: 1000, numeroAutorizacion: null }];
      bankServiceSpy.buscarCandidatosNetpayReporte.and.returnValue(of({ candidatos: candidatosRecalculados }));

      component.abrirDetalle(otroReporte);

      expect(component.uploadResultado).toBeNull();
      expect(bankServiceSpy.buscarCandidatosNetpayReporte).toHaveBeenCalledWith('rep-otro');
      expect(component.candidatosActivo).toEqual(candidatosRecalculados);
    });

    it('abre el MISMO reporte recién cargado: conserva los candidatos en memoria, sin pegarle al backend', () => {
      const candidatos = [{ _id: 'mov-1', banco: 'BBVA', fecha: '2026-09-25', concepto: null, deposito: 1000, numeroAutorizacion: null }];
      const reporte = fakeReporte();
      component.uploadResultado = { reporte, candidatos };
      bankServiceSpy.obtenerNetpayReporteDetalle.and.returnValue(of({ reporte }));

      component.abrirDetalle(reporte);

      expect(component.uploadResultado).not.toBeNull();
      expect(component.candidatosActivo).toEqual(candidatos);
      expect(bankServiceSpy.buscarCandidatosNetpayReporte).not.toHaveBeenCalled();
    });

    it('reporte NO pendiente (confirmado/descartado) sin candidatos en memoria: no busca candidatos', () => {
      const reporte = fakeReporte({ estatus: 'confirmado' });
      bankServiceSpy.obtenerNetpayReporteDetalle.and.returnValue(of({ reporte }));

      component.abrirDetalle(reporte);

      expect(bankServiceSpy.buscarCandidatosNetpayReporte).not.toHaveBeenCalled();
      expect(component.candidatosActivo).toEqual([]);
    });

    it('error al buscar candidatos: muestra el mensaje y permite reintentar', () => {
      const reporte = fakeReporte();
      bankServiceSpy.obtenerNetpayReporteDetalle.and.returnValue(of({ reporte }));
      bankServiceSpy.buscarCandidatosNetpayReporte.and.returnValue(throwError(() => ({ error: { error: 'Error al consultar Mongo' } })));

      component.abrirDetalle(reporte);

      expect(component.candidatosError).toBe('Error al consultar Mongo');
      expect(component.candidatosLoading).toBe(false);

      bankServiceSpy.buscarCandidatosNetpayReporte.and.returnValue(of({ candidatos: [] }));
      component.reintentarCandidatos();

      expect(bankServiceSpy.buscarCandidatosNetpayReporte).toHaveBeenCalledTimes(2);
      expect(component.candidatosError).toBeNull();
    });
  });

  describe('confirmación', () => {
    beforeEach(() => {
      bankServiceSpy.obtenerNetpayReporteDetalle.and.returnValue(of({ reporte: fakeReporte() }));
      bankServiceSpy.buscarCandidatosNetpayReporte.and.returnValue(of({ candidatos: [] }));
      component.abrirDetalle(fakeReporte());
    });

    it('confirmarCandidato(): llama al service con el id del reporte y del movimiento', () => {
      const confirmado = fakeReporte({ estatus: 'confirmado' });
      bankServiceSpy.confirmarNetpayReporte.and.returnValue(of({ reporte: confirmado, movimiento: { _id: 'mov-1' } }));

      component.confirmarCandidato('mov-1');

      expect(bankServiceSpy.confirmarNetpayReporte).toHaveBeenCalledWith('rep-1', 'mov-1');
      expect(component.reporteActivo).toEqual(confirmado);
      expect(component.confirmando).toBe(false);
    });

    it('confirmarSeleccionActiva(): usa el candidato de la posición elegida entre los recalculados en vivo', () => {
      component.candidatosActivo = [
        { _id: 'mov-1', banco: 'BBVA', fecha: '2026-09-25', concepto: null, deposito: 1000, numeroAutorizacion: null },
        { _id: 'mov-2', banco: 'BBVA', fecha: '2026-09-25', concepto: null, deposito: 1000, numeroAutorizacion: null },
      ];
      const confirmado = fakeReporte({ estatus: 'confirmado' });
      bankServiceSpy.confirmarNetpayReporte.and.returnValue(of({ reporte: confirmado, movimiento: {} }));

      component.seleccionar(1);
      component.confirmarSeleccionActiva();

      expect(bankServiceSpy.confirmarNetpayReporte).toHaveBeenCalledWith('rep-1', 'mov-2');
    });

    it('error de negocio (ej. monto no coincide): muestra el mensaje', () => {
      bankServiceSpy.confirmarNetpayReporte.and.returnValue(throwError(() => ({ error: { error: 'El monto del movimiento no coincide con el depósito del reporte' } })));

      component.confirmarCandidato('mov-1');

      expect(component.confirmError).toBe('El monto del movimiento no coincide con el depósito del reporte');
      expect(component.confirmando).toBe(false);
    });

    it('confirmarSeleccionActiva(): sin selección, no hace nada', () => {
      component.seleccionCandidato = null;
      component.confirmarSeleccionActiva();
      expect(bankServiceSpy.confirmarNetpayReporte).not.toHaveBeenCalled();
    });
  });

  describe('descartar()', () => {
    beforeEach(() => {
      bankServiceSpy.obtenerNetpayReporteDetalle.and.returnValue(of({ reporte: fakeReporte() }));
      bankServiceSpy.buscarCandidatosNetpayReporte.and.returnValue(of({ candidatos: [] }));
      component.abrirDetalle(fakeReporte());
    });

    it('éxito: actualiza el reporteActivo y cierra el prompt de motivo', () => {
      const descartado = fakeReporte({ estatus: 'descartado', descartadoMotivo: 'ya identificado a mano' });
      bankServiceSpy.descartarNetpayReporte.and.returnValue(of({ reporte: descartado }));

      component.motivoDescarte = 'ya identificado a mano';
      component.pideMotivoDescarte = true;
      component.descartar();

      expect(bankServiceSpy.descartarNetpayReporte).toHaveBeenCalledWith('rep-1', 'ya identificado a mano');
      expect(component.reporteActivo).toEqual(descartado);
      expect(component.pideMotivoDescarte).toBe(false);
    });

    it('error: muestra el mensaje, no cierra el prompt', () => {
      bankServiceSpy.descartarNetpayReporte.and.returnValue(throwError(() => ({ error: { error: 'Este reporte ya no está pendiente' } })));

      component.pideMotivoDescarte = true;
      component.descartar();

      expect(component.descartarError).toBe('Este reporte ya no está pendiente');
      expect(component.pideMotivoDescarte).toBe(true);
    });
  });

  describe('consultarKore()', () => {
    beforeEach(() => {
      bankServiceSpy.obtenerNetpayReporteDetalle.and.returnValue(of({ reporte: fakeReporte() }));
      bankServiceSpy.buscarCandidatosNetpayReporte.and.returnValue(of({ candidatos: [] }));
      component.abrirDetalle(fakeReporte());
    });

    it('éxito: cachea la cuenta tal cual (sin remapear) en el folio y lo expande', () => {
      const cuenta = { SerieExterna: 'H0', FolioExterno: '260100639', Total: 488.73 };
      bankServiceSpy.consultarFolioNetpayKore.and.returnValue(of({ cuenta, consultadoEn: '2026-09-25T12:00:00.000Z' }));

      const folio = component.reporteActivo!.folios[0];
      component.consultarKore(folio);

      expect(bankServiceSpy.consultarFolioNetpayKore).toHaveBeenCalledWith('rep-1', 'F1');
      expect(folio.koreCache).toEqual({ consultadoEn: '2026-09-25T12:00:00.000Z', cuenta });
      // Clave de identidad de UI = _id (subdocumento de Mongo), NUNCA `referencia` — ver
      // el bug de abajo para el motivo.
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

    // 2026-09-25 — Bug real reportado por el usuario contra datos de producción: un
    // depósito real trajo TODOS sus folios con `referencia: null` (Netpay no siempre la
    // incluye). Usar `referencia` como clave de `consultandoFolio`/`folioExpandido` hacía
    // que 2+ folios sin referencia "colisionaran" (null === null) — el botón nacía
    // deshabilitado mostrando "Consultando…" para siempre, sin haber disparado ninguna
    // petición, y encima no se podía ni expandir el detalle (toggleFolio también
    // early-returneaba con `!referencia`).
    it('folio sin referencia: no colisiona con otro folio sin referencia, se puede expandir, y "Consultar Kore" queda deshabilitado con motivo', () => {
      const sinRef1 = { ...component.reporteActivo!.folios[0], _id: 'folio-sin-ref-1', referencia: null };
      const sinRef2 = { ...component.reporteActivo!.folios[0], _id: 'folio-sin-ref-2', referencia: null };
      component.reporteActivo!.folios = [sinRef1, sinRef2];

      // Ninguno debería aparecer "en curso" solo por tener referencia null.
      expect(component.consultandoFolio).toBeNull();
      expect(component.folioKey(sinRef1)).toBe('folio-sin-ref-1');
      expect(component.folioKey(sinRef2)).toBe('folio-sin-ref-2');
      expect(component.folioKey(sinRef1)).not.toBe(component.folioKey(sinRef2));

      // Expandir uno no afecta al otro (antes, con clave=referencia=null, expandir
      // cualquiera de los dos los "abría" a ambos a la vez).
      component.toggleFolio(sinRef1);
      expect(component.folioExpandido).toBe('folio-sin-ref-1');
      expect(component.folioExpandido).not.toBe(component.folioKey(sinRef2));

      // consultarKore() no dispara nada (no hay con qué buscar en Kore) y no deja
      // `consultandoFolio` pegado en un estado falso.
      component.consultarKore(sinRef1);
      expect(bankServiceSpy.consultarFolioNetpayKore).not.toHaveBeenCalled();
      expect(component.consultandoFolio).toBeNull();
    });
  });

  describe('exportar()', () => {
    beforeEach(() => {
      bankServiceSpy.obtenerNetpayReporteDetalle.and.returnValue(of({ reporte: fakeReporte() }));
      bankServiceSpy.buscarCandidatosNetpayReporte.and.returnValue(of({ candidatos: [] }));
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
      // Blob#text() resuelve de forma async (real, no fake timers) — esperar un macrotask
      // es suficiente para que su microtask ya se haya resuelto.
      setTimeout(() => {
        expect(component.exportError).toBe('Reporte no encontrado');
        done();
      }, 50);
    });
  });

  // Fix 2b (2026-09-25): revertir un reporte 'confirmado' — NO hay lógica nueva de backend,
  // reusa bankService.removeErpId (mismo mecanismo que desvincular cualquier erpId sintético)
  // con el erpId sintético NETPAYRPT-<claveRastreo>, y refresca detalle + candidatos tras el
  // éxito (mismo camino que reabrir un reporte 'pendiente').
  describe('revertir()', () => {
    beforeEach(() => {
      const confirmado = fakeReporte({ estatus: 'confirmado', movementIdConfirmado: 'mov-1' });
      bankServiceSpy.obtenerNetpayReporteDetalle.and.returnValue(of({ reporte: confirmado }));
      bankServiceSpy.buscarCandidatosNetpayReporte.and.returnValue(of({ candidatos: [] }));
      component.abrirDetalle(confirmado);
    });

    it('éxito: llama a removeErpId con el erpId sintético NETPAYRPT-<claveRastreo>, refresca detalle y candidatos', () => {
      bankServiceSpy.removeErpId.and.returnValue(of({
        _id: 'mov-1', erpIds: [], erpLinks: [], historialVinculacion: [], saldoErp: null, uuidXML: null,
        status: 'no_identificado', identificadoPor: [],
      }));
      const pendiente = fakeReporte({ estatus: 'pendiente', movementIdConfirmado: null });
      bankServiceSpy.obtenerNetpayReporteDetalle.and.returnValue(of({ reporte: pendiente }));
      bankServiceSpy.buscarCandidatosNetpayReporte.and.returnValue(of({ candidatos: [] }));

      component.pideConfirmarRevertir = true;
      component.revertir();

      expect(bankServiceSpy.removeErpId).toHaveBeenCalledWith('mov-1', 'NETPAYRPT-CLAVE-1');
      expect(component.revirtiendo).toBe(false);
      expect(component.pideConfirmarRevertir).toBe(false);
      expect(component.reporteActivo).toEqual(pendiente);
      expect(bankServiceSpy.buscarCandidatosNetpayReporte).toHaveBeenCalledWith('rep-1');
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

    it('reporteActivo no confirmado: no hace nada', () => {
      component.reporteActivo = fakeReporte({ estatus: 'pendiente', movementIdConfirmado: null });
      component.revertir();
      expect(bankServiceSpy.removeErpId).not.toHaveBeenCalled();
    });
  });
});
