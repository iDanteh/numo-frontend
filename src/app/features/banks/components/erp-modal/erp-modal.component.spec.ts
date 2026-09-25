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

    it('sí llama a listErpCuentas para un movimiento normal (sin regresión)', () => {
      component.movement = buildMovement();
      component.initModal();
      expect(bankServiceSpy.listErpCuentas).toHaveBeenCalled();
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

  // onFichaPaste (2026-09-14, bug real reportado por el usuario): arrastrar una imagen
  // desde WhatsApp Web/Desktop no funciona (el navegador no transfiere el archivo real de
  // una imagen ya renderizada en una página) — confirmado que el drag&drop SÍ funciona con
  // un archivo real (ej. desde el Explorador). Pegar (Ctrl+V) sí entrega el archivo real
  // sea cual sea el origen.
  describe('onFichaPaste()', () => {
    function fakeClipboardEvent(items: { type: string; file: File | null }[]): jasmine.SpyObj<ClipboardEvent> & { clipboardData: unknown } {
      const clipboardItems = items.map(i => ({ type: i.type, getAsFile: () => i.file }));
      return {
        clipboardData: { items: clipboardItems },
        preventDefault: jasmine.createSpy('preventDefault'),
      } as unknown as jasmine.SpyObj<ClipboardEvent> & { clipboardData: unknown };
    }

    function fakeImageFile(): File {
      return new File(['contenido'], 'comprobante.png', { type: 'image/png' });
    }

    it('portapapeles sin imagen (solo texto): no sube nada, no llama preventDefault (deja pasar el paste normal)', () => {
      component.movement = buildMovement();
      const event = fakeClipboardEvent([{ type: 'text/plain', file: null }]);

      component.onFichaPaste(event as unknown as ClipboardEvent);

      expect(bankServiceSpy.adjuntarImagenFicha).not.toHaveBeenCalled();
      expect(event.preventDefault).not.toHaveBeenCalled();
    });

    it('portapapeles con imagen, sin documento todavía, con permiso: sube el archivo (mismo camino que drag&drop/selector)', () => {
      component.movement = buildMovement({ fichaDriveWebViewLink: null });
      bankServiceSpy.adjuntarImagenFicha.and.returnValue(of({
        _id: 'mov-1', fichaDriveFileId: 'f-1', fichaDriveWebViewLink: 'https://drive/x', fichaDriveMimeType: 'image/png',
      }));
      const file  = fakeImageFile();
      const event = fakeClipboardEvent([{ type: 'image/png', file }]);

      component.onFichaPaste(event as unknown as ClipboardEvent);

      expect(event.preventDefault).toHaveBeenCalled();
      expect(bankServiceSpy.adjuntarImagenFicha).toHaveBeenCalledWith('mov-1', file);
    });

    it('ya hay un documento cargado: no hace nada (no hay dónde pegarlo)', () => {
      component.movement = buildMovement({ fichaDriveWebViewLink: 'https://drive/existente' });
      const event = fakeClipboardEvent([{ type: 'image/png', file: fakeImageFile() }]);

      component.onFichaPaste(event as unknown as ClipboardEvent);

      expect(bankServiceSpy.adjuntarImagenFicha).not.toHaveBeenCalled();
    });

    it('sin permiso banks:ficha: no hace nada', () => {
      authServiceSpy.hasPermission.and.returnValue(false);
      component.movement = buildMovement();
      const event = fakeClipboardEvent([{ type: 'image/png', file: fakeImageFile() }]);

      component.onFichaPaste(event as unknown as ClipboardEvent);

      expect(bankServiceSpy.adjuntarImagenFicha).not.toHaveBeenCalled();
    });

    it('sin movimiento (modal cerrado, ver comentario del @HostListener a nivel window): no hace nada', () => {
      component.movement = null;
      const event = fakeClipboardEvent([{ type: 'image/png', file: fakeImageFile() }]);

      component.onFichaPaste(event as unknown as ClipboardEvent);

      expect(bankServiceSpy.adjuntarImagenFicha).not.toHaveBeenCalled();
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
});
