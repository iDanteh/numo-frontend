import { SimpleChange } from '@angular/core';
import { DomSanitizer } from '@angular/platform-browser';
import { of, throwError } from 'rxjs';
import { ErpModalComponent } from './erp-modal.component';
import { BankService, BankMovement, ErpLink } from '../../../../core/services/bank.service';
import { AuthService } from '../../../../core/services/auth.service';

// Instanciación directa (sin TestBed) — estos tests cubren solo lógica pura de
// modoSoloFicha/fichaObligatoriaCompleta/closeErpModal (2026-09-14), no requieren
// renderizar el template. El componente no tiene efectos secundarios en el constructor.
describe('ErpModalComponent — modo solo ficha (Transferencias entre cajas)', () => {
  let component: ErpModalComponent;
  let bankServiceSpy: jasmine.SpyObj<BankService>;
  let authServiceSpy: jasmine.SpyObj<AuthService>;
  let sanitizerSpy: jasmine.SpyObj<DomSanitizer>;

  function buildMovement(overrides: Partial<BankMovement> = {}): BankMovement {
    return {
      _id: 'mov-1',
      banco: 'BBVA',
      fecha: '2026-09-01T00:00:00Z',
      concepto: 'Depósito en efectivo',
      deposito: 1000,
      retiro: null,
      saldo: null,
      saldoCalculado: null,
      numeroAutorizacion: null,
      referenciaNumerica: null,
      status: 'identificado',
      categoria: null,
      folio: null,
      uuidXML: null,
      erpIds: [],
      erpLinks: [],
      saldoErp: null,
      identificadoPor: [],
      ficha: null,
      fichaBy: null,
      fichaNombre: null,
      fichaAt: null,
      fichaDriveFileId: null,
      fichaDriveWebViewLink: null,
      fichaDriveMimeType: null,
      createdAt: '2026-09-01T00:00:00Z',
      ...overrides,
    } as BankMovement;
  }

  function erpLinkTransferenciaCaja(erpId = 'CAJA-1'): ErpLink {
    return {
      erpId, saldoActual: 0, total: 0, folioFiscal: null,
      origen: 'transferencia-caja',
    } as ErpLink;
  }

  beforeEach(() => {
    bankServiceSpy = jasmine.createSpyObj<BankService>('BankService', [
      'listErpCuentas', 'setErpIds', 'setFicha', 'deleteFicha',
      'adjuntarImagenFicha', 'quitarImagenFicha', 'getFichaImagenBlob', 'buscarCfdis',
      'obtenerNetpayReportePorMovimiento',
    ]);
    authServiceSpy = jasmine.createSpyObj<AuthService>('AuthService', ['hasPermission', 'hasRole']);
    authServiceSpy.hasPermission.and.returnValue(true);
    authServiceSpy.hasRole.and.returnValue(false);
    sanitizerSpy = jasmine.createSpyObj<DomSanitizer>('DomSanitizer', ['bypassSecurityTrustResourceUrl']);
    // Default: cualquier movimiento normal (fuera de modo solo ficha) que llame
    // initModal() dispara loadErpCuentas() de verdad — necesita un Observable real.
    bankServiceSpy.listErpCuentas.and.returnValue(of({ data: [], pagination: { page: 1, totalPaginas: 1, total: 0 } }));

    component = new ErpModalComponent(bankServiceSpy, authServiceSpy, sanitizerSpy);
  });

  describe('modoSoloFicha', () => {
    it('es false sin movimiento', () => {
      component.movement = null;
      expect(component.modoSoloFicha).toBeFalse();
    });

    it('es false con erpIds vinculados que NO son de transferencia entre cajas', () => {
      component.movement = buildMovement({
        erpIds: ['cxc-1'],
        erpLinks: [{ erpId: 'cxc-1', saldoActual: 100, total: 100, folioFiscal: 'F-1' } as ErpLink],
      });
      expect(component.modoSoloFicha).toBeFalse();
    });

    it('es true cuando algún erpLink viene de transferencia-caja', () => {
      component.movement = buildMovement({
        erpIds: ['CAJA-1'],
        erpLinks: [erpLinkTransferenciaCaja()],
      });
      expect(component.modoSoloFicha).toBeTrue();
    });
  });

  describe('fichaObligatoriaCompleta', () => {
    function movimientoTransferenciaCaja(overrides: Partial<BankMovement> = {}): BankMovement {
      return buildMovement({
        erpIds: ['CAJA-1'],
        erpLinks: [erpLinkTransferenciaCaja()],
        ...overrides,
      });
    }

    it('es true fuera del modo solo ficha, sin importar ficha/documento', () => {
      component.movement = buildMovement(); // sin erpLinks de transferencia-caja
      expect(component.modoSoloFicha).toBeFalse();
      expect(component.fichaObligatoriaCompleta).toBeTrue();
    });

    it('es false en modo solo ficha sin ficha ni documento', () => {
      component.movement = movimientoTransferenciaCaja();
      expect(component.fichaObligatoriaCompleta).toBeFalse();
    });

    it('es false en modo solo ficha con solo uno de los dos (ficha, sin documento)', () => {
      component.movement = movimientoTransferenciaCaja({ ficha: '12345' });
      expect(component.fichaObligatoriaCompleta).toBeFalse();
    });

    it('es false en modo solo ficha con solo uno de los dos (documento, sin ficha)', () => {
      component.movement = movimientoTransferenciaCaja({ fichaDriveWebViewLink: 'https://drive/x' });
      expect(component.fichaObligatoriaCompleta).toBeFalse();
    });

    it('es true en modo solo ficha con ambos completos', () => {
      component.movement = movimientoTransferenciaCaja({
        ficha: '12345',
        fichaDriveWebViewLink: 'https://drive/x',
      });
      expect(component.fichaObligatoriaCompleta).toBeTrue();
    });

    it('es true en modo solo ficha incompleto si el usuario no tiene permiso banks:ficha (no queda atrapado)', () => {
      authServiceSpy.hasPermission.and.callFake((p: string) => p !== 'banks:ficha');
      component.movement = movimientoTransferenciaCaja();
      expect(component.fichaObligatoriaCompleta).toBeTrue();
    });
  });

  describe('closeErpModal() — bloqueo en modo solo ficha', () => {
    let closedEmitted: boolean;

    beforeEach(() => {
      closedEmitted = false;
      component.closed.subscribe(() => { closedEmitted = true; });
    });

    it('NO cierra y setea fichaObligatoriaError si el modo solo ficha está incompleto', () => {
      component.movement = buildMovement({
        erpIds: ['CAJA-1'],
        erpLinks: [erpLinkTransferenciaCaja()],
      });
      component.initModal();

      component.closeErpModal();

      expect(closedEmitted).toBeFalse();
      expect(component.showErpCloseConfirm).toBeFalse();
      expect(component.fichaObligatoriaError).toBeTruthy();
    });

    it('cierra normalmente si el modo solo ficha está completo y no hay cambios sin guardar', () => {
      component.movement = buildMovement({
        erpIds: ['CAJA-1'],
        erpLinks: [erpLinkTransferenciaCaja()],
        ficha: '12345',
        fichaDriveWebViewLink: 'https://drive/x',
      });
      component.initModal();

      component.closeErpModal();

      expect(closedEmitted).toBeTrue();
    });

    it('fuera del modo solo ficha, el comportamiento normal de "cerrar sin guardar" no cambia', () => {
      component.movement = buildMovement(); // sin transferencia-caja
      component.initModal();
      component.fichaInput = '999'; // hasUnsavedFicha = true

      component.closeErpModal();

      expect(closedEmitted).toBeFalse();
      expect(component.showErpCloseConfirm).toBeTrue();
      expect(component.fichaObligatoriaError).toBeNull();
    });
  });

  describe('cancelarModoSoloFicha() (2026-09-14, pedido explícito del usuario tras probar el bloqueo)', () => {
    let closedEmitted: boolean;

    beforeEach(() => {
      closedEmitted = false;
      component.closed.subscribe(() => { closedEmitted = true; });
    });

    it('cierra el modal aunque el modo solo ficha esté incompleto (a diferencia de closeErpModal())', () => {
      component.movement = buildMovement({
        erpIds: ['CAJA-1'],
        erpLinks: [erpLinkTransferenciaCaja()],
      });
      component.initModal();

      component.cancelarModoSoloFicha();

      expect(closedEmitted).toBeTrue();
    });

    it('descarta un desvincular sin guardar (erpIds vuelve a erpIdsOriginal)', () => {
      component.movement = buildMovement({
        erpIds: ['CAJA-1'],
        erpLinks: [erpLinkTransferenciaCaja()],
      });
      component.initModal();
      component.unlinkCxC('CAJA-1', new Event('click'));
      expect(component.movement?.erpIds).not.toContain('CAJA-1');

      component.cancelarModoSoloFicha();

      expect(component.movement?.erpIds).toContain('CAJA-1');
      expect(closedEmitted).toBeTrue();
    });
  });

  describe('initModal() — no consulta el ERP en modo solo ficha', () => {
    it('no llama a listErpCuentas cuando el movimiento es de transferencia entre cajas', () => {
      component.movement = buildMovement({
        erpIds: ['CAJA-1'],
        erpLinks: [erpLinkTransferenciaCaja()],
      });
      component.initModal();
      expect(bankServiceSpy.listErpCuentas).not.toHaveBeenCalled();
    });

    it('NO llama a listErpCuentas para un movimiento normal al abrir el modal (2026-10-12: carga perezosa, ya no trae todo el mes sin buscar)', () => {
      component.movement = buildMovement();
      component.initModal();
      expect(bankServiceSpy.listErpCuentas).not.toHaveBeenCalled();
    });
  });

  // Bug real (2026-10-22): un socket 'bank:movement:updated' (ej. tras subir la ficha) le
  // llega de vuelta al MISMO tab que lo originó (emitToBanco no excluye al socket emisor) —
  // banks.component.ts reacciona reasignando erpModalMovement = {...prev, ...updated}, una
  // referencia NUEVA para el MISMO _id, que antes disparaba initModal() y vaciaba el estado
  // de vinculación de CxC en curso. ngOnChanges() ahora distingue "actualización en vivo del
  // mismo movimiento" (no reinicializa) de "modal abierto para otro movimiento" (sí).
  describe('ngOnChanges() — guard contra reseteo por eco de socket (mismo movimiento)', () => {
    it('NO reinicializa el modal cuando llega una actualización del MISMO movimiento (mismo _id, referencia nueva)', () => {
      const mov1 = buildMovement();
      component.movement = mov1;
      component.ngOnChanges({ movement: new SimpleChange(null, mov1, true) });
      bankServiceSpy.listErpCuentas.calls.reset();

      component.erpSearch = 'algo que el usuario ya tipeó';
      (component as any).erpCxcCache.set('cxc-1', { erpId: 'cxc-1' });

      const mov1Actualizado = { ...mov1, fichaDriveWebViewLink: 'https://drive/x' };
      component.movement = mov1Actualizado;
      component.ngOnChanges({ movement: new SimpleChange(mov1, mov1Actualizado, false) });

      expect(component.erpSearch).toBe('algo que el usuario ya tipeó');
      expect((component as any).erpCxcCache.has('cxc-1')).toBeTrue();
      expect(bankServiceSpy.listErpCuentas).not.toHaveBeenCalled();
    });

    it('SÍ reinicializa el modal cuando el movimiento asignado es OTRO (_id distinto)', () => {
      const mov1 = buildMovement({ _id: 'mov-1' });
      component.movement = mov1;
      component.ngOnChanges({ movement: new SimpleChange(null, mov1, true) });
      component.erpSearch = 'búsqueda del movimiento anterior';

      const mov2 = buildMovement({ _id: 'mov-2' });
      component.movement = mov2;
      component.ngOnChanges({ movement: new SimpleChange(mov1, mov2, false) });

      expect(component.erpSearch).toBe('');
    });

    it('reinicializa en el primer bind (firstChange) aunque previousValue sea undefined', () => {
      const mov1 = buildMovement();
      component.movement = mov1;

      component.ngOnChanges({ movement: new SimpleChange(undefined, mov1, true) });

      expect(component.erpHasSearched).toBeFalse();
      expect(bankServiceSpy.listErpCuentas).not.toHaveBeenCalled(); // carga perezosa (2026-10-12)
    });
  });

  describe('carga perezosa de la lista de CxC (2026-10-12)', () => {
    it('initModal() abre en estado "sin buscar todavía" (erpHasSearched false, lista vacía)', () => {
      component.movement = buildMovement();
      component.initModal();
      expect(component.erpHasSearched).toBeFalse();
      expect(component.erpCxcList).toEqual([]);
      expect(bankServiceSpy.listErpCuentas).not.toHaveBeenCalled();
    });

    it('loadErpCuentas() (buscar, Enter o el debounce de tipeo) sí dispara la consulta y marca erpHasSearched', () => {
      component.movement = buildMovement();
      component.initModal();

      component.loadErpCuentas(1);

      expect(bankServiceSpy.listErpCuentas).toHaveBeenCalled();
      expect(component.erpHasSearched).toBeTrue();
    });

    it('onToggleSoloAnticipos() sigue disparando la búsqueda de inmediato (comportamiento pedido explícitamente, no se toca)', () => {
      component.movement = buildMovement();
      component.initModal();
      bankServiceSpy.listErpCuentas.calls.reset();

      component.onToggleSoloAnticipos();

      expect(bankServiceSpy.listErpCuentas).toHaveBeenCalled();
      expect(component.erpHasSearched).toBeTrue();
    });

    it('las CxC ya vinculadas (erpLinks) siguen disponibles de inmediato al abrir, sin depender de la lista general', () => {
      component.movement = buildMovement({
        erpIds: ['cxc-1'],
        erpLinks: [{ erpId: 'cxc-1', saldoActual: 100, total: 100, folioFiscal: 'F-1', serie: 'A0', folioExterno: '001' } as ErpLink],
      });
      component.initModal();

      expect(bankServiceSpy.listErpCuentas).not.toHaveBeenCalled();
      expect(component.isCxCLinked('cxc-1')).toBeTrue();
      expect(component.erpLinkLabel('cxc-1')).toBe('A0-001');
    });
  });

  describe('desvinculandoTransferenciaCajaSinGuardar (2026-09-14, bug real)', () => {
    it('es false recién abierto el modal (nada desvinculado todavía)', () => {
      component.movement = buildMovement({
        erpIds: ['CAJA-1'],
        erpLinks: [erpLinkTransferenciaCaja()],
      });
      component.initModal();
      expect(component.desvinculandoTransferenciaCajaSinGuardar).toBeFalse();
    });

    it('es true tras quitar localmente el chip de transferencia caja (unlinkCxC), antes de Guardar', () => {
      component.movement = buildMovement({
        erpIds: ['CAJA-1'],
        erpLinks: [erpLinkTransferenciaCaja()],
      });
      component.initModal();

      component.unlinkCxC('CAJA-1', new Event('click'));

      expect(component.modoSoloFicha).toBeFalse();
      expect(component.desvinculandoTransferenciaCajaSinGuardar).toBeTrue();
    });

    it('deshacerDesvincularTransferenciaCaja() restaura el erpId y vuelve a modoSoloFicha', () => {
      component.movement = buildMovement({
        erpIds: ['CAJA-1'],
        erpLinks: [erpLinkTransferenciaCaja()],
      });
      component.initModal();
      component.unlinkCxC('CAJA-1', new Event('click'));

      component.deshacerDesvincularTransferenciaCaja();

      expect(component.movement?.erpIds).toContain('CAJA-1');
      expect(component.modoSoloFicha).toBeTrue();
      expect(component.desvinculandoTransferenciaCajaSinGuardar).toBeFalse();
    });

    it('es false para un movimiento normal (sin transferencia caja de por medio)', () => {
      component.movement = buildMovement({
        erpIds: ['cxc-1'],
        erpLinks: [{ erpId: 'cxc-1', saldoActual: 100, total: 100, folioFiscal: 'F-1' } as ErpLink],
      });
      component.initModal();

      component.unlinkCxC('cxc-1', new Event('click'));

      expect(component.desvinculandoTransferenciaCajaSinGuardar).toBeFalse();
    });
  });

  // onFichaImagenSelected (2026-10-22, bug real reportado por el usuario): drag&drop y
  // pegado (Ctrl+V) para la ficha fueron eliminados — un paste de un valor copiado de
  // Excel en el buscador de CxC terminaba subiendo el bitmap de la celda como ficha
  // (`@HostListener('window:paste')` global, sin chequear dónde ocurrió el paste).
  // Selección manual de archivo, vía <input type="file">, es ahora el único camino.
  describe('onFichaImagenSelected()', () => {
    function fakeFileInputEvent(file: File | null): Event {
      const input = { files: file ? [file] : [], value: 'C:\\fakepath\\comprobante.png' } as unknown as HTMLInputElement;
      return { target: input } as unknown as Event;
    }

    function fakeImageFile(): File {
      return new File(['contenido'], 'comprobante.png', { type: 'image/png' });
    }

    it('archivo elegido explícitamente, sin documento todavía, con permiso: lo sube', () => {
      component.movement = buildMovement({ fichaDriveWebViewLink: null });
      bankServiceSpy.adjuntarImagenFicha.and.returnValue(of({
        _id: 'mov-1', fichaDriveFileId: 'f-1', fichaDriveWebViewLink: 'https://drive/x', fichaDriveMimeType: 'image/png',
      }));
      const file  = fakeImageFile();
      const event = fakeFileInputEvent(file);

      component.onFichaImagenSelected(event);

      expect(bankServiceSpy.adjuntarImagenFicha).toHaveBeenCalledWith('mov-1', file);
    });

    it('sin archivo seleccionado: no sube nada', () => {
      component.movement = buildMovement({ fichaDriveWebViewLink: null });
      const event = fakeFileInputEvent(null);

      component.onFichaImagenSelected(event);

      expect(bankServiceSpy.adjuntarImagenFicha).not.toHaveBeenCalled();
    });

    it('limpia el value del input tras procesar la selección (permite re-elegir el mismo archivo)', () => {
      component.movement = buildMovement({ fichaDriveWebViewLink: null });
      bankServiceSpy.adjuntarImagenFicha.and.returnValue(of({
        _id: 'mov-1', fichaDriveFileId: 'f-1', fichaDriveWebViewLink: 'https://drive/x', fichaDriveMimeType: 'image/png',
      }));
      const event = fakeFileInputEvent(fakeImageFile());

      component.onFichaImagenSelected(event);

      expect((event.target as HTMLInputElement).value).toBe('');
    });
  });

  // 2026-09-24: _esAnticipoDeCxC() solo miraba erpCxcCache (la sesión actual del
  // modal) — un anticipo vinculado automáticamente por el backend (webhook de Kore
  // / reconciliación, sin que nadie abra el modal) no quedaba cacheado, así que al
  // reabrir el modal esa CxC no se reconocía como anticipo y podía colarse en
  // cobroIds como "cobrable". Fix: mismo fallback a movement.erpLinks que ya usa
  // _origenDeCxC().
  describe('cobroIds — anticipo vinculado sin abrir el modal (fallback a movement.erpLinks)', () => {
    function erpLinkAnticipo(erpId: string): ErpLink {
      return { erpId, saldoActual: 250, total: 250, folioFiscal: null, origen: 'anticipo' } as ErpLink;
    }

    it('erpCxcCache vacío (recién reabierto) + erpLinks con origen:anticipo -> se excluye de cobroIds aunque esté seleccionada para cobro', () => {
      component.movement = buildMovement({ erpIds: ['OPA-00370'], erpLinks: [erpLinkAnticipo('OPA-00370')] });
      component.erpIdsOriginal = ['OPA-00370']; // ya vinculada de una sesión anterior
      component.cobroSeleccionIds = new Set(['OPA-00370']); // el usuario la marcó para cobrar

      expect(component.cobroIds).not.toContain('OPA-00370');
    });

    it('sigue funcionando el camino de la sesión actual (erpCxcCache) cuando SÍ está cacheado', () => {
      component.movement = buildMovement({ erpIds: ['CXC-nueva'], erpLinks: [] });
      (component as any).erpCxcCache.set('CXC-nueva', { esAnticipo: true });

      expect(component.cobroIds).not.toContain('CXC-nueva');
    });

    it('una CxC normal (origen "manual", ni en cache ni anticipo en erpLinks) SÍ es cobrable', () => {
      component.movement = buildMovement({
        erpIds: ['CXC-normal'],
        erpLinks: [{ erpId: 'CXC-normal', saldoActual: 100, total: 100, folioFiscal: null, origen: 'manual' } as ErpLink],
      });
      component.erpIdsOriginal = ['CXC-normal'];
      component.cobroSeleccionIds = new Set(['CXC-normal']);

      expect(component.cobroIds).toContain('CXC-normal');
    });
  });

  // Bug real 2026-10-20: cobro de 18 CxC donde erpCxcCache se vació (initModal() volvió
  // a correr, ej. el padre re-pasó [movement]) entre seleccionarlas y dar "Aplicar Cobro".
  // Las 18 cayeron en el branch de respaldo de confirmErp() (ninguna en cache/lista/links
  // previos), que devolvía saldoPagado/saldoPagadoTotal correctos pero se olvidaba de
  // desglosePorFormaPago/serie/folioExterno/tipoPago/origen — quedaban en Mongo como
  // []/null aunque el cobro real sí se aplicó contra Kore.
  describe('confirmErp() — branch de respaldo (erpId ni en cache, ni en lista, ni en links previos)', () => {
    it('usa los overrides de cobroSaldosErp para desglosePorFormaPago/saldos/catálogo, no los deja vacíos', () => {
      component.movement = buildMovement({ erpIds: ['CXC-huerfana'], erpLinks: [] });
      bankServiceSpy.setErpIds.and.returnValue(of({
        erpIds: ['CXC-huerfana'], erpLinks: [], historialVinculacion: [],
        saldoErp: 0, uuidXML: null, status: 'identificado', identificadoPor: [],
      } as any));

      component.setCobroSaldosErp({
        saldosActual: { 'CXC-huerfana': 530.05 },
        saldosPagado: { 'CXC-huerfana': 10156.23 },
        saldosPagadoTotal: { 'CXC-huerfana': 10156.23 },
        desglosePorFormaPago: {
          'CXC-huerfana': [{ formaPagoId: '5fa572ddee58480001d04586', formaPagoDescripcion: 'TRANSFERENCIA', monto: 10156.23, fecha: '2026-10-19T22:23:43.293Z' }],
        },
        serie: { 'CXC-huerfana': 'A0' },
        folioExterno: { 'CXC-huerfana': '260904722' },
        tipoPago: { 'CXC-huerfana': 'PPD' },
        origen: { 'CXC-huerfana': 'venta' },
        folioFiscal: { 'CXC-huerfana': 'C4E9D64B-F169-4BBA-B0EF-1EFA42E1F3CF' },
        total: { 'CXC-huerfana': 360.78 },
      });

      component.confirmErp();

      const erpLinksEnviados = bankServiceSpy.setErpIds.calls.mostRecent().args[1] as ErpLink[];
      expect(erpLinksEnviados).toEqual([{
        erpId: 'CXC-huerfana', saldoActual: 530.05, saldoPagado: 10156.23, saldoPagadoTotal: 10156.23,
        folioFiscal: 'C4E9D64B-F169-4BBA-B0EF-1EFA42E1F3CF', total: 360.78,
        serie: 'A0', folioExterno: '260904722', tipoPago: 'PPD', origen: 'venta',
        desglosePorFormaPago: [{ formaPagoId: '5fa572ddee58480001d04586', formaPagoDescripcion: 'TRANSFERENCIA', monto: 10156.23, fecha: '2026-10-19T22:23:43.293Z' }],
      } as unknown as ErpLink]);
    });

    it('sin catálogo en el override (defensivo, no debería pasar en la práctica): cae a null/0, no revienta', () => {
      component.movement = buildMovement({ erpIds: ['CXC-huerfana'], erpLinks: [] });
      bankServiceSpy.setErpIds.and.returnValue(of({
        erpIds: ['CXC-huerfana'], erpLinks: [], historialVinculacion: [],
        saldoErp: 0, uuidXML: null, status: 'identificado', identificadoPor: [],
      } as any));

      component.setCobroSaldosErp({
        saldosActual: { 'CXC-huerfana': 530.05 },
        saldosPagado: { 'CXC-huerfana': 10156.23 },
        saldosPagadoTotal: { 'CXC-huerfana': 10156.23 },
        desglosePorFormaPago: {
          'CXC-huerfana': [{ formaPagoId: '5fa572ddee58480001d04586', formaPagoDescripcion: 'TRANSFERENCIA', monto: 10156.23, fecha: '2026-10-19T22:23:43.293Z' }],
        },
      });

      component.confirmErp();

      const erpLinksEnviados = bankServiceSpy.setErpIds.calls.mostRecent().args[1] as ErpLink[];
      expect(erpLinksEnviados).toEqual([{
        erpId: 'CXC-huerfana', saldoActual: 530.05, saldoPagado: 10156.23, saldoPagadoTotal: 10156.23,
        folioFiscal: null, total: 0, serie: null, folioExterno: null, tipoPago: null, origen: null,
        desglosePorFormaPago: [{ formaPagoId: '5fa572ddee58480001d04586', formaPagoDescripcion: 'TRANSFERENCIA', monto: 10156.23, fecha: '2026-10-19T22:23:43.293Z' }],
      } as unknown as ErpLink]);
    });

    it('sin cobroSaldosErp (no viene de un cobro): desglosePorFormaPago queda [] por falta de dato, no por el bug', () => {
      component.movement = buildMovement({ erpIds: ['CXC-huerfana'], erpLinks: [] });
      bankServiceSpy.setErpIds.and.returnValue(of({
        erpIds: ['CXC-huerfana'], erpLinks: [], historialVinculacion: [],
        saldoErp: 0, uuidXML: null, status: 'identificado', identificadoPor: [],
      } as any));

      component.confirmErp();

      const erpLinksEnviados = bankServiceSpy.setErpIds.calls.mostRecent().args[1] as ErpLink[];
      expect(erpLinksEnviados[0].desglosePorFormaPago).toEqual([]);
      expect(erpLinksEnviados[0].saldoActual).toBe(0);
    });
  });

  // Bug real 2026-10-20 (segundo bug, mismo folio): confirmado por el usuario — relacionó
  // las 18 CxC con "Guardar" una por una (reabriendo el modal ERP, sin pasar por cobro-panel)
  // porque guardar las 18 de un tirón no funcionaba. Cada "Guardar" encontraba la CxC en
  // cache/lista (folioFiscal/serie/total/tipoPago se rellenaban bien desde Kore en vivo) pero
  // sin cobroSaldosErp (no hay cobro, solo un alta/edición manual) pisaba a null/[] el
  // saldoPagado/saldoPagadoTotal/desglosePorFormaPago que esa CxC YA tenía de un cobro
  // confirmado antes — borraba en silencio el historial de pago.
  describe('confirmErp() — "Guardar" sin cobro no debe borrar saldoPagado/desglose ya confirmados (cached/inPage)', () => {
    function erpCxcKore(id: string): any {
      return {
        id, serie: 'A0', folio: '260906033', serieExterna: 'A0', folioExterno: '260904708',
        tipoPago: 'PPD', subtotal: 9212.31, impuesto: 1473.97, total: 10686.28,
        saldoActual: 530.05, fechaVencimiento: null, folioFiscal: '1C79231C-0198-48B0-9DC0-6C4C94B374FA',
        origen: 'venta',
      };
    }

    it('rama cached: sin override, conserva saldoPagado/saldoPagadoTotal/desglose del erpLink previo', () => {
      const linkPrevio: ErpLink = {
        erpId: 'CXC-1', saldoActual: 530.05, saldoPagado: 10156.23, saldoPagadoTotal: 10156.23,
        folioFiscal: null, total: 0, serie: null, folioExterno: null, tipoPago: null, origen: null,
        desglosePorFormaPago: [{ formaPagoId: 'fp1', formaPagoDescripcion: 'TRANSFERENCIA', monto: 10156.23, fecha: '2026-10-19T22:23:43.293Z' }],
      } as unknown as ErpLink;
      component.movement = buildMovement({ erpIds: ['CXC-1'], erpLinks: [linkPrevio] });
      (component as any).erpCxcCache.set('CXC-1', erpCxcKore('CXC-1'));
      bankServiceSpy.setErpIds.and.returnValue(of({
        erpIds: ['CXC-1'], erpLinks: [], historialVinculacion: [],
        saldoErp: 0, uuidXML: null, status: 'identificado', identificadoPor: [],
      } as any));

      component.confirmErp();

      const link = (bankServiceSpy.setErpIds.calls.mostRecent().args[1] as ErpLink[])[0] as any;
      expect(link.saldoPagado).toBe(10156.23);
      expect(link.saldoPagadoTotal).toBe(10156.23);
      expect(link.desglosePorFormaPago).toEqual(linkPrevio.desglosePorFormaPago as any);
      // el catálogo SÍ se refresca contra Kore en vivo
      expect(link.folioFiscal).toBe('1C79231C-0198-48B0-9DC0-6C4C94B374FA');
      expect(link.serie).toBe('A0');
    });

    it('rama inPage: mismo criterio que cached', () => {
      const linkPrevio: ErpLink = {
        erpId: 'CXC-2', saldoActual: 413.88, saldoPagado: 7930.42, saldoPagadoTotal: 7930.42,
        folioFiscal: null, total: 0, serie: null, folioExterno: null, tipoPago: null, origen: null,
        desglosePorFormaPago: [{ formaPagoId: 'fp1', formaPagoDescripcion: 'TRANSFERENCIA', monto: 7930.42, fecha: '2026-10-19T22:23:43.293Z' }],
      } as unknown as ErpLink;
      component.movement = buildMovement({ erpIds: ['CXC-2'], erpLinks: [linkPrevio] });
      component.erpCxcList = [erpCxcKore('CXC-2')];
      bankServiceSpy.setErpIds.and.returnValue(of({
        erpIds: ['CXC-2'], erpLinks: [], historialVinculacion: [],
        saldoErp: 0, uuidXML: null, status: 'identificado', identificadoPor: [],
      } as any));

      component.confirmErp();

      const link = (bankServiceSpy.setErpIds.calls.mostRecent().args[1] as ErpLink[])[0] as any;
      expect(link.saldoPagado).toBe(7930.42);
      expect(link.saldoPagadoTotal).toBe(7930.42);
      expect(link.desglosePorFormaPago).toEqual(linkPrevio.desglosePorFormaPago as any);
    });

    it('rama cached: un cobro real (con override) sigue pisando el valor previo, no lo conserva', () => {
      const linkPrevio: ErpLink = {
        erpId: 'CXC-1', saldoActual: 530.05, saldoPagado: 100, saldoPagadoTotal: 100,
        folioFiscal: null, total: 0, serie: null, folioExterno: null, tipoPago: null, origen: null,
        desglosePorFormaPago: [{ formaPagoId: 'fp-viejo', formaPagoDescripcion: 'EFECTIVO', monto: 100, fecha: '2026-01-01T00:00:00Z' }],
      } as unknown as ErpLink;
      component.movement = buildMovement({ erpIds: ['CXC-1'], erpLinks: [linkPrevio] });
      (component as any).erpCxcCache.set('CXC-1', erpCxcKore('CXC-1'));
      bankServiceSpy.setErpIds.and.returnValue(of({
        erpIds: ['CXC-1'], erpLinks: [], historialVinculacion: [],
        saldoErp: 0, uuidXML: null, status: 'identificado', identificadoPor: [],
      } as any));

      component.setCobroSaldosErp({
        saldosActual: { 'CXC-1': 420.05 },
        saldosPagado: { 'CXC-1': 10220 },
        saldosPagadoTotal: { 'CXC-1': 10220 },
        desglosePorFormaPago: {
          'CXC-1': [{ formaPagoId: 'fp-nuevo', formaPagoDescripcion: 'TRANSFERENCIA', monto: 10120, fecha: '2026-10-20T00:00:00Z' }],
        },
      });

      component.confirmErp();

      const link = (bankServiceSpy.setErpIds.calls.mostRecent().args[1] as ErpLink[])[0] as any;
      expect(link.saldoPagado).toBe(10220);
      expect(link.desglosePorFormaPago).toEqual([{ formaPagoId: 'fp-nuevo', formaPagoDescripcion: 'TRANSFERENCIA', monto: 10120, fecha: '2026-10-20T00:00:00Z' }]);
    });

    it('rama cached: CxC nueva (sin erpLink previo) sigue sin inventar saldoPagado — queda null/[]', () => {
      component.movement = buildMovement({ erpIds: ['CXC-nueva'], erpLinks: [] });
      (component as any).erpCxcCache.set('CXC-nueva', erpCxcKore('CXC-nueva'));
      bankServiceSpy.setErpIds.and.returnValue(of({
        erpIds: ['CXC-nueva'], erpLinks: [], historialVinculacion: [],
        saldoErp: 0, uuidXML: null, status: 'identificado', identificadoPor: [],
      } as any));

      component.confirmErp();

      const link = (bankServiceSpy.setErpIds.calls.mostRecent().args[1] as ErpLink[])[0] as any;
      expect(link.saldoPagado).toBeNull();
      expect(link.saldoPagadoTotal).toBeNull();
      expect(link.desglosePorFormaPago).toEqual([]);
    });
  });

  // Fix 3 (2026-09-25, pedido explícito del usuario): ver folios de un reporte Netpay
  // confirmado directamente desde este modal, sin depender de abrir el panel de Netpay ni de
  // exportar el Excel.
  describe('esErpIdNetpayReporte()', () => {
    it('es true para un erpLink con origen netpay-reporte', () => {
      component.movement = buildMovement({
        erpIds: ['NETPAYRPT-CLAVE-1'],
        erpLinks: [{ erpId: 'NETPAYRPT-CLAVE-1', saldoActual: 1000, total: 1000, folioFiscal: null, origen: 'netpay-reporte' } as ErpLink],
      });
      expect(component.esErpIdNetpayReporte('NETPAYRPT-CLAVE-1')).toBeTrue();
    });

    it('es false para una CxC normal', () => {
      component.movement = buildMovement({
        erpIds: ['cxc-1'],
        erpLinks: [{ erpId: 'cxc-1', saldoActual: 100, total: 100, folioFiscal: 'F-1' } as ErpLink],
      });
      expect(component.esErpIdNetpayReporte('cxc-1')).toBeFalse();
    });
  });

  describe('initModal() — folios de reporte Netpay confirmado (Fix 3)', () => {
    function erpLinkNetpayReporte(erpId = 'NETPAYRPT-CLAVE-1'): ErpLink {
      return { erpId, saldoActual: 1000, total: 1000, folioFiscal: null, origen: 'netpay-reporte' } as ErpLink;
    }

    it('trae el reporte por movementId cuando hay un erpLink de origen netpay-reporte', () => {
      const reporte = { _id: 'rep-1', folios: [] } as any;
      bankServiceSpy.obtenerNetpayReportePorMovimiento.and.returnValue(of({ reporte }));
      component.movement = buildMovement({
        erpIds: ['NETPAYRPT-CLAVE-1'],
        erpLinks: [erpLinkNetpayReporte()],
      });

      component.initModal();

      expect(bankServiceSpy.obtenerNetpayReportePorMovimiento).toHaveBeenCalledWith('mov-1');
      expect(component.netpayReporte).toEqual(reporte);
    });

    it('404 (sin reporte para este movimiento): queda en null en silencio, no rompe initModal()', () => {
      bankServiceSpy.obtenerNetpayReportePorMovimiento.and.returnValue(throwError(() => ({ error: { error: 'Reporte Netpay para este movimiento no encontrado' } })));
      component.movement = buildMovement({
        erpIds: ['NETPAYRPT-CLAVE-1'],
        erpLinks: [erpLinkNetpayReporte()],
      });

      component.initModal();

      expect(component.netpayReporte).toBeNull();
    });

    it('no consulta nada para un movimiento normal (sin erpLink de origen netpay-reporte)', () => {
      component.movement = buildMovement();
      component.initModal();
      expect(bankServiceSpy.obtenerNetpayReportePorMovimiento).not.toHaveBeenCalled();
      expect(component.netpayReporte).toBeNull();
    });
  });

  // Fix 2026-10-07 (pedido explícito del usuario): el chip de un erpId NETPAYRPT-<claveRastreo>
  // caía al '—' genérico (nunca tiene serie/folioExterno de Kore) — ahora muestra la clave de
  // rastreo en vez de dejarla solo visible al hacer hover sobre el chip.
  describe('erpLinkLabel() — erpId sintético de Netpay', () => {
    it('devuelve "Netpay <claveRastreo>" cuando el erpId es de origen netpay-reporte y hay netpayReporte cargado', () => {
      component.movement = buildMovement({
        erpIds: ['NETPAYRPT-ABC123'],
        erpLinks: [{ erpId: 'NETPAYRPT-ABC123', saldoActual: 1000, total: 1000, folioFiscal: null, origen: 'netpay-reporte' } as ErpLink],
      });
      component.netpayReporte = { _id: 'rep-1', claveRastreo: 'ABC123', folios: [] } as any;

      expect(component.erpLinkLabel('NETPAYRPT-ABC123')).toBe('Netpay ABC123');
    });

    it('cae al "—" si es de origen netpay-reporte pero netpayReporte todavía no cargó (ej. 404)', () => {
      component.movement = buildMovement({
        erpIds: ['NETPAYRPT-ABC123'],
        erpLinks: [{ erpId: 'NETPAYRPT-ABC123', saldoActual: 1000, total: 1000, folioFiscal: null, origen: 'netpay-reporte' } as ErpLink],
      });
      component.netpayReporte = null;

      expect(component.erpLinkLabel('NETPAYRPT-ABC123')).toBe('—');
    });
  });
});
