import { of, throwError, Subject } from 'rxjs';
import { MovimientoModalComponent } from './movimiento-modal.component';
import { LoyaltyService } from '../../../core/services/loyalty.service';
import { SocketService } from '../../../core/services/socket.service';
import { LoyaltyCard, LoyaltyMovimientoResult, LoyaltySucursal, LoyaltyAdjustmentReason } from '../../../core/models/loyalty.model';

/**
 * RED (PR6, task 6.8-6.9) — modo acumulacion/canje/ajuste, preview de puntos
 * en vivo a partir del % del nivel (D3/D5), ajuste exige reason+justificacion
 * (spec loyalty-points-ledger "AJUSTE Entry").
 */
const CARD: LoyaltyCard = { id: 5, telefono: '5512345678', nombre: 'Juan', nivel: 'Plata', saldoPuntos: 100, activa: true };
const SUCURSALES: LoyaltySucursal[] = [{ id: 1, clave: 'MTY', sucursal: 'Monterrey', participaLealtad: true, permiteCanjeLealtad: true, serieFacturacion: null }];
const REASONS: LoyaltyAdjustmentReason[] = [
  { id: 1, clave: 'bono', nombre: 'Bono', signoPermitido: 'POSITIVO', activo: true, porcentaje: null },
  { id: 2, clave: 'viejo', nombre: 'Motivo viejo', signoPermitido: 'AMBOS', activo: false, porcentaje: null },
];
// Motivo con % de cálculo automático (feature nueva) — en un array aparte para no
// alterar REASONS ni romper los tests existentes de activeReasons()/registrarAjuste manual.
const REASON_PCT: LoyaltyAdjustmentReason = { id: 3, clave: 'bono-pct', nombre: 'Bono %', signoPermitido: 'POSITIVO', activo: true, porcentaje: 10 };

function crearServicioSpy(): jasmine.SpyObj<LoyaltyService> {
  const svc = jasmine.createSpyObj<LoyaltyService>('LoyaltyService', [
    'listarSucursales', 'listarReasons', 'obtenerPorcentajes',
    'registrarAcumulacion', 'registrarCanje', 'registrarAjuste',
  ]);
  svc.listarSucursales.and.returnValue(of(SUCURSALES));
  svc.listarReasons.and.returnValue(of(REASONS));
  svc.obtenerPorcentajes.and.returnValue(of({ Bronce: 1, Plata: 5, Oro: 10 }));
  return svc;
}

function crearSocketStub(): any {
  return { configUpdated$: new Subject() };
}

describe('MovimientoModalComponent (lógica directa)', () => {
  let loyalty: jasmine.SpyObj<LoyaltyService>;
  let socket: any;

  beforeEach(() => {
    loyalty = crearServicioSpy();
    socket = crearSocketStub();
  });

  function crear(mode: 'acumulacion' | 'canje' | 'ajuste'): MovimientoModalComponent {
    const comp = new MovimientoModalComponent(loyalty, socket);
    comp.card = CARD;
    comp.mode = mode;
    comp.ngOnInit();
    return comp;
  }

  it('ngOnInit(acumulacion): loads porcentajes, not sucursales ni reasons (select de sucursal removido a favor de Serie-Folio)', () => {
    crear('acumulacion');
    expect(loyalty.obtenerPorcentajes).toHaveBeenCalled();
    expect(loyalty.listarSucursales).not.toHaveBeenCalled();
    expect(loyalty.listarReasons).not.toHaveBeenCalled();
  });

  it('ngOnInit(canje): loads sucursales, not porcentajes ni reasons', () => {
    crear('canje');
    expect(loyalty.listarSucursales).toHaveBeenCalled();
    expect(loyalty.obtenerPorcentajes).not.toHaveBeenCalled();
    expect(loyalty.listarReasons).not.toHaveBeenCalled();
  });

  it('sucursalesLoading (canje): true while listarSucursales() is in flight, false once it resolves (avoids the select looking broken with no indicator)', () => {
    const sucursales$ = new Subject<LoyaltySucursal[]>();
    loyalty.listarSucursales.and.returnValue(sucursales$.asObservable());
    const comp = crear('canje');

    expect(comp.sucursalesLoading).toBe(true);
    sucursales$.next(SUCURSALES);
    expect(comp.sucursalesLoading).toBe(false);
    expect(comp.sucursales).toEqual(SUCURSALES);
  });

  it('ngOnInit(ajuste): loads reasons, not sucursales/porcentajes', () => {
    crear('ajuste');
    expect(loyalty.listarReasons).toHaveBeenCalled();
    expect(loyalty.listarSucursales).not.toHaveBeenCalled();
    expect(loyalty.obtenerPorcentajes).not.toHaveBeenCalled();
  });

  it('puntosPreview(): computes montoVenta × porcentajeAplicado for the card tier (Plata = 5%)', () => {
    const comp = crear('acumulacion');
    comp.montoVenta = 1000;
    expect(comp.puntosPreview()).toBe(50);
  });

  it('puntosPreview(): null when the tier % is not configured yet (D11)', () => {
    loyalty.obtenerPorcentajes.and.returnValue(of({ Bronce: 1, Plata: null, Oro: 10 }));
    const comp = crear('acumulacion');
    comp.montoVenta = 1000;
    expect(comp.puntosPreview()).toBeNull();
  });

  it('guardar(acumulacion): rejects montoVenta <= 0 without calling the service', () => {
    const comp = crear('acumulacion');
    comp.montoVenta = 0;
    comp.centroCostoId = 1;
    comp.guardar();
    expect(loyalty.registrarAcumulacion).not.toHaveBeenCalled();
    expect(comp.error).toBeTruthy();
  });

  it('guardar(acumulacion): ya no exige sucursal (select removido a favor de Serie-Folio, pendiente de implementar)', () => {
    loyalty.registrarAcumulacion.and.returnValue(of({ movimiento: {} as any, saldoPuntos: 150 }));
    const comp = crear('acumulacion');
    comp.montoVenta = 1000;
    comp.centroCostoId = null;
    comp.serieFolio = 'A-10234';
    comp.guardar();
    expect(loyalty.registrarAcumulacion).toHaveBeenCalledWith(5, { montoVenta: 1000, centroCostoId: null });
  });

  it('guardar(acumulacion): on success, emits registered with the server result', () => {
    const fixture: LoyaltyMovimientoResult = {
      movimiento: {
        id: 1, cardId: 5, tipo: 'ACUMULACION', puntos: 50, saldoResultante: 150, montoVenta: 1000,
        porcentajeAplicado: 5, nivelAplicado: 'Plata', centroCostoId: 1, reasonId: null, justificacion: null,
        origen: 'manual', referenciaExterna: null, usuarioId: 'u1', usuarioNombre: 'Staff', createdAt: '2026-10-15T00:00:00Z',
      },
      saldoPuntos: 150,
    };
    loyalty.registrarAcumulacion.and.returnValue(of(fixture));
    const comp = crear('acumulacion');
    let emitted: LoyaltyMovimientoResult | undefined;
    comp.registered.subscribe(r => emitted = r);
    comp.montoVenta = 1000;
    comp.centroCostoId = 1;
    comp.guardar();
    expect(loyalty.registrarAcumulacion).toHaveBeenCalledWith(5, { montoVenta: 1000, centroCostoId: 1 });
    expect(emitted).toEqual(fixture);
  });

  it('guardar(canje): rejects puntos exceeding the current saldoPuntos (spec: "Redemption exceeding balance is rejected")', () => {
    const comp = crear('canje');
    comp.puntos = 150; // saldoPuntos is 100
    comp.centroCostoId = 1;
    comp.guardar();
    expect(loyalty.registrarCanje).not.toHaveBeenCalled();
    expect(comp.error).toContain('saldo');
  });

  it('guardar(canje): within balance calls the service', () => {
    loyalty.registrarCanje.and.returnValue(of({ movimiento: {} as any, saldoPuntos: 40 }));
    const comp = crear('canje');
    comp.puntos = 60;
    comp.centroCostoId = 1;
    comp.guardar();
    expect(loyalty.registrarCanje).toHaveBeenCalledWith(5, { puntos: 60, centroCostoId: 1 });
  });

  it('guardar(ajuste): rejects a missing justificacion (spec: "Missing justification is rejected")', () => {
    const comp = crear('ajuste');
    comp.puntos = 20;
    comp.reasonId = 1;
    comp.justificacion = '';
    comp.guardar();
    expect(loyalty.registrarAjuste).not.toHaveBeenCalled();
    expect(comp.error).toBeTruthy();
  });

  it('guardar(ajuste): rejects a missing reason', () => {
    const comp = crear('ajuste');
    comp.puntos = 20;
    comp.reasonId = null;
    comp.justificacion = 'Motivo suficientemente largo';
    comp.guardar();
    expect(loyalty.registrarAjuste).not.toHaveBeenCalled();
  });

  it('guardar(ajuste): valid payload calls the service (regresión: motivo SIN % sigue mandando puntos manual, igual que antes)', () => {
    loyalty.registrarAjuste.and.returnValue(of({ movimiento: {} as any, saldoPuntos: 120 }));
    const comp = crear('ajuste');
    comp.puntos = 20;
    comp.reasonId = 1;
    comp.justificacion = 'Bono por cumpleaños del cliente';
    comp.guardar();
    expect(loyalty.registrarAjuste).toHaveBeenCalledWith(5, { puntos: 20, reasonId: 1, justificacion: 'Bono por cumpleaños del cliente' });
  });

  describe('ajuste con motivo de % de cálculo automático (feature nueva)', () => {
    beforeEach(() => {
      loyalty.listarReasons.and.returnValue(of([...REASONS, REASON_PCT]));
    });

    it('selectedReason(): resuelve el motivo elegido a partir de reasonId', () => {
      const comp = crear('ajuste');
      comp.reasonId = 3;
      expect(comp.selectedReason()).toEqual(REASON_PCT);
    });

    it('selectedReason(): null cuando no hay motivo seleccionado o no matchea ninguno', () => {
      const comp = crear('ajuste');
      comp.reasonId = null;
      expect(comp.selectedReason()).toBeNull();
    });

    it('ajustePreview(): montoBase × porcentaje del motivo (Bono % = 10%)', () => {
      const comp = crear('ajuste');
      comp.reasonId = 3;
      comp.montoBase = 1000;
      expect(comp.ajustePreview()).toBe(100);
    });

    it('ajustePreview(): null si el motivo no tiene % (manual)', () => {
      const comp = crear('ajuste');
      comp.reasonId = 1;
      comp.montoBase = 1000;
      expect(comp.ajustePreview()).toBeNull();
    });

    it('ajustePreview(): null si montoBase no está capturado o es <= 0', () => {
      const comp = crear('ajuste');
      comp.reasonId = 3;
      comp.montoBase = 0;
      expect(comp.ajustePreview()).toBeNull();
    });

    it('onReasonChange(): al elegir un motivo con % limpia puntos (ya no aplica)', () => {
      const comp = crear('ajuste');
      comp.puntos = 20;
      comp.reasonId = 3;
      comp.onReasonChange();
      expect(comp.puntos).toBeNull();
    });

    it('onReasonChange(): al elegir un motivo sin % limpia montoBase (ya no aplica)', () => {
      const comp = crear('ajuste');
      comp.montoBase = 500;
      comp.reasonId = 1;
      comp.onReasonChange();
      expect(comp.montoBase).toBeNull();
    });

    it('guardar(ajuste): motivo con % rechaza montoBase <= 0 sin llamar al servicio', () => {
      const comp = crear('ajuste');
      comp.reasonId = 3;
      comp.montoBase = 0;
      comp.justificacion = 'Bono de promoción especial';
      comp.guardar();
      expect(loyalty.registrarAjuste).not.toHaveBeenCalled();
      expect(comp.error).toBe('Captura un monto base mayor a cero.');
    });

    it('guardar(ajuste): motivo con % arma el payload con montoBase, SIN mandar puntos', () => {
      loyalty.registrarAjuste.and.returnValue(of({ movimiento: {} as any, saldoPuntos: 200 }));
      const comp = crear('ajuste');
      comp.reasonId = 3;
      comp.montoBase = 1000;
      comp.puntos = 999; // valor viejo oculto que NO debe mandarse
      comp.justificacion = 'Bono de promoción especial';
      comp.guardar();
      expect(loyalty.registrarAjuste).toHaveBeenCalledWith(5, {
        montoBase: 1000, reasonId: 3, justificacion: 'Bono de promoción especial',
      });
      const payloadEnviado = loyalty.registrarAjuste.calls.mostRecent().args[1];
      expect(payloadEnviado.puntos).toBeUndefined();
    });

    it('guardar(ajuste): sigue exigiendo motivo y justificación con un motivo de %', () => {
      const comp = crear('ajuste');
      comp.reasonId = null;
      comp.montoBase = 1000;
      comp.justificacion = 'Bono de promoción especial';
      comp.guardar();
      expect(loyalty.registrarAjuste).not.toHaveBeenCalled();
      expect(comp.error).toBe('Selecciona un motivo.');
    });
  });

  it('guardar(): surfaces the backend error message on failure', () => {
    loyalty.registrarAcumulacion.and.returnValue(throwError(() => ({ error: { error: 'Configure el % del nivel Plata en Lealtad → Configuración' } })));
    const comp = crear('acumulacion');
    comp.montoVenta = 1000;
    comp.centroCostoId = 1;
    comp.guardar();
    expect(comp.error).toBe('Configure el % del nivel Plata en Lealtad → Configuración');
    expect(comp.saving).toBe(false);
  });

  it('live % refresh: reloads porcentajes when configUpdated$ fires for section "lealtad"', () => {
    const comp = crear('acumulacion');
    loyalty.obtenerPorcentajes.calls.reset();
    socket.configUpdated$.next({ sectionClave: 'lealtad', clave: 'PORCENTAJE_PLATA' });
    expect(loyalty.obtenerPorcentajes).toHaveBeenCalledTimes(1);
  });

  it('live % refresh: ignores configUpdated$ for other sections', () => {
    const comp = crear('acumulacion');
    loyalty.obtenerPorcentajes.calls.reset();
    socket.configUpdated$.next({ sectionClave: 'bancos', clave: 'CORTE_PERIODO_COBRANZA' });
    expect(loyalty.obtenerPorcentajes).not.toHaveBeenCalled();
  });

  it('activeReasons() (PR7): excludes deactivated reasons from the AJUSTE dropdown (spec loyalty-config "Deactivated reason is hidden from new adjustments")', () => {
    const comp = crear('ajuste');
    expect(comp.activeReasons()).toEqual([REASONS[0]]);
  });
});
