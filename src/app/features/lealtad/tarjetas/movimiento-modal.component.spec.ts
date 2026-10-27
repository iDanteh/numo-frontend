import { of, throwError } from 'rxjs';
import { MovimientoModalComponent } from './movimiento-modal.component';
import { LoyaltyService } from '../../../core/services/loyalty.service';
import { LoyaltyCard, LoyaltyMovimientoResult, LoyaltyAdjustmentReason } from '../../../core/models/loyalty.model';

/**
 * RED (PR6, task 6.8-6.9) — modo acumulacion/canje/ajuste, ajuste exige
 * reason+justificacion (spec loyalty-points-ledger "AJUSTE Entry").
 *
 * ACUMULACION/CANJE (2026-10-21, pedido explícito del usuario): el select de
 * sucursal se reemplaza por la serie de Kore (sola en CANJE, con folio en
 * ACUMULACION) — el backend resuelve sucursal y, en ACUMULACION, el monto de
 * venta (consulta la CxC real en Kore y calcula sobre su subtotal). Ya no hay
 * preview en vivo del lado del cliente ni catálogo de sucursales que cargar.
 */
const CARD: LoyaltyCard = { id: 5, telefono: '5512345678', nombre: 'Juan', nivel: 'Plata', saldoPuntos: 100, activa: true };
const REASONS: LoyaltyAdjustmentReason[] = [
  { id: 1, clave: 'bono', nombre: 'Bono', activo: true, puntosFijos: null },
  { id: 2, clave: 'viejo', nombre: 'Motivo viejo', activo: false, puntosFijos: null },
];
// Motivo con puntosFijos (rediseño 2026-10-23) — en un array aparte para no alterar REASONS ni
// romper los tests existentes de activeReasons()/registrarAjuste manual.
const REASON_FIJO: LoyaltyAdjustmentReason = { id: 3, clave: 'bono-fijo', nombre: 'Bono fijo', activo: true, puntosFijos: 100 };

function crearServicioSpy(): jasmine.SpyObj<LoyaltyService> {
  const svc = jasmine.createSpyObj<LoyaltyService>('LoyaltyService', [
    'listarReasons', 'registrarAcumulacion', 'registrarCanje', 'registrarAjuste',
  ]);
  svc.listarReasons.and.returnValue(of(REASONS));
  return svc;
}

describe('MovimientoModalComponent (lógica directa)', () => {
  let loyalty: jasmine.SpyObj<LoyaltyService>;

  beforeEach(() => {
    loyalty = crearServicioSpy();
  });

  function crear(mode: 'acumulacion' | 'canje' | 'ajuste'): MovimientoModalComponent {
    const comp = new MovimientoModalComponent(loyalty);
    comp.card = CARD;
    comp.mode = mode;
    comp.ngOnInit();
    return comp;
  }

  it('ngOnInit(acumulacion): no carga ningún catálogo — el backend resuelve todo desde el Serie-Folio', () => {
    crear('acumulacion');
    expect(loyalty.listarReasons).not.toHaveBeenCalled();
  });

  it('ngOnInit(canje): no carga ningún catálogo — el backend resuelve la sucursal desde la serie', () => {
    crear('canje');
    expect(loyalty.listarReasons).not.toHaveBeenCalled();
  });

  it('ngOnInit(ajuste): loads reasons', () => {
    crear('ajuste');
    expect(loyalty.listarReasons).toHaveBeenCalled();
  });

  it('guardar(acumulacion): rejects a missing/malformed Serie-Folio without calling the service', () => {
    const comp = crear('acumulacion');
    comp.serieFolio = 'no es un folio válido';
    comp.guardar();
    expect(loyalty.registrarAcumulacion).not.toHaveBeenCalled();
    expect(comp.error).toContain('Serie-Folio');
  });

  it('guardar(acumulacion): Serie-Folio válido manda serieFolio (sin montoVenta, sin centroCostoId)', () => {
    loyalty.registrarAcumulacion.and.returnValue(of({ movimiento: {} as any, saldoPuntos: 150 }));
    const comp = crear('acumulacion');
    comp.serieFolio = 'A0-260605320';
    comp.guardar();
    expect(loyalty.registrarAcumulacion).toHaveBeenCalledWith(5, { serieFolio: 'A0-260605320' });
  });

  it('guardar(acumulacion): recorta espacios alrededor del Serie-Folio capturado', () => {
    loyalty.registrarAcumulacion.and.returnValue(of({ movimiento: {} as any, saldoPuntos: 150 }));
    const comp = crear('acumulacion');
    comp.serieFolio = '  A0-260605320  ';
    comp.guardar();
    expect(loyalty.registrarAcumulacion).toHaveBeenCalledWith(5, { serieFolio: 'A0-260605320' });
  });

  it('guardar(acumulacion): on success, emits registered with the server result', () => {
    const fixture: LoyaltyMovimientoResult = {
      movimiento: {
        id: 1, cardId: 5, tipo: 'ACUMULACION', puntos: 50, saldoResultante: 150, montoVenta: 1000,
        montoVentaTotal: 1160, porcentajeAplicado: 5, nivelAplicado: 'Plata', centroCostoId: 1, reasonId: null,
        justificacion: null, origen: 'manual', referenciaExterna: 'A0-260605320', usuarioId: 'u1',
        usuarioNombre: 'Staff', createdAt: '2026-10-15T00:00:00Z',
      },
      saldoPuntos: 150,
    };
    loyalty.registrarAcumulacion.and.returnValue(of(fixture));
    const comp = crear('acumulacion');
    let emitted: LoyaltyMovimientoResult | undefined;
    comp.registered.subscribe(r => emitted = r);
    comp.serieFolio = 'A0-260605320';
    comp.guardar();
    expect(emitted).toEqual(fixture);
  });

  it('guardar(canje): rejects puntos exceeding the current saldoPuntos (spec: "Redemption exceeding balance is rejected")', () => {
    const comp = crear('canje');
    comp.puntos = 150; // saldoPuntos is 100
    comp.serie = 'A0';
    comp.guardar();
    expect(loyalty.registrarCanje).not.toHaveBeenCalled();
    expect(comp.error).toContain('saldo');
  });

  it('guardar(canje): rejects a missing/malformed serie without calling the service', () => {
    const comp = crear('canje');
    comp.puntos = 60;
    comp.serie = '';
    comp.guardar();
    expect(loyalty.registrarCanje).not.toHaveBeenCalled();
    expect(comp.error).toContain('serie');
  });

  it('guardar(canje): within balance and a valid serie calls the service (sin centroCostoId)', () => {
    loyalty.registrarCanje.and.returnValue(of({ movimiento: {} as any, saldoPuntos: 40 }));
    const comp = crear('canje');
    comp.puntos = 60;
    comp.serie = 'A0';
    comp.guardar();
    expect(loyalty.registrarCanje).toHaveBeenCalledWith(5, { puntos: 60, serie: 'A0' });
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

  describe('ajuste con motivo de puntosFijos (rediseño 2026-10-23)', () => {
    beforeEach(() => {
      loyalty.listarReasons.and.returnValue(of([...REASONS, REASON_FIJO]));
    });

    it('selectedReason(): resuelve el motivo elegido a partir de reasonId', () => {
      const comp = crear('ajuste');
      comp.reasonId = 3;
      expect(comp.selectedReason()).toEqual(REASON_FIJO);
    });

    it('selectedReason(): null cuando no hay motivo seleccionado o no matchea ninguno', () => {
      const comp = crear('ajuste');
      comp.reasonId = null;
      expect(comp.selectedReason()).toBeNull();
    });

    it('ajustePreview(): devuelve el puntosFijos del motivo tal cual (100)', () => {
      const comp = crear('ajuste');
      comp.reasonId = 3;
      expect(comp.ajustePreview()).toBe(100);
    });

    it('ajustePreview(): null si el motivo es manual (sin puntosFijos)', () => {
      const comp = crear('ajuste');
      comp.reasonId = 1;
      expect(comp.ajustePreview()).toBeNull();
    });

    it('onReasonChange(): al elegir un motivo con puntosFijos limpia puntos manual (ya no aplica)', () => {
      const comp = crear('ajuste');
      comp.puntos = 20;
      comp.reasonId = 3;
      comp.onReasonChange();
      expect(comp.puntos).toBeNull();
    });

    it('onReasonChange(): al elegir un motivo manual no toca puntos', () => {
      const comp = crear('ajuste');
      comp.puntos = 20;
      comp.reasonId = 1;
      comp.onReasonChange();
      expect(comp.puntos).toBe(20);
    });

    it('guardar(ajuste): motivo con puntosFijos arma el payload SIN mandar puntos', () => {
      loyalty.registrarAjuste.and.returnValue(of({ movimiento: {} as any, saldoPuntos: 200 }));
      const comp = crear('ajuste');
      comp.reasonId = 3;
      comp.puntos = 999; // valor viejo oculto que NO debe mandarse
      comp.justificacion = 'Bono de bienvenida';
      comp.guardar();
      expect(loyalty.registrarAjuste).toHaveBeenCalledWith(5, {
        reasonId: 3, justificacion: 'Bono de bienvenida',
      });
      const payloadEnviado = loyalty.registrarAjuste.calls.mostRecent().args[1];
      expect(payloadEnviado.puntos).toBeUndefined();
    });

    it('guardar(ajuste): sigue exigiendo motivo y justificación con un motivo de puntosFijos', () => {
      const comp = crear('ajuste');
      comp.reasonId = null;
      comp.justificacion = 'Bono de bienvenida';
      comp.guardar();
      expect(loyalty.registrarAjuste).not.toHaveBeenCalled();
      expect(comp.error).toBe('Selecciona un motivo.');
    });
  });

  it('guardar(): surfaces the backend error message on failure', () => {
    loyalty.registrarAcumulacion.and.returnValue(throwError(() => ({ error: { error: 'No se encontró la venta con Serie-Folio "A0-260605320" en Kore.' } })));
    const comp = crear('acumulacion');
    comp.serieFolio = 'A0-260605320';
    comp.guardar();
    expect(comp.error).toBe('No se encontró la venta con Serie-Folio "A0-260605320" en Kore.');
    expect(comp.saving).toBe(false);
  });

  it('activeReasons() (PR7): excludes deactivated reasons from the AJUSTE dropdown (spec loyalty-config "Deactivated reason is hidden from new adjustments")', () => {
    const comp = crear('ajuste');
    expect(comp.activeReasons()).toEqual([REASONS[0]]);
  });
});
