import { of } from 'rxjs';
import { CollectionRequestComponent, buildIdentificarPayload } from './collection-request.component';
import { CollectionRequestService, CollectionRequest } from '../../core/services/collection-request.service';
import { ToastService } from '../../core/services/toast.service';

// ── buildIdentificarPayload — función PURA, sin Angular/TestBed ────────────────────
// Prioridad explícita del diseño: el camino feliz de 1 solo movimiento debe seguir
// mandando el atajo escalar {bankMovementId}, byte-idéntico al de antes de este cambio.
describe('buildIdentificarPayload', () => {
  it('splitMode=false: manda el atajo escalar {bankMovementId} — camino feliz sin cambios', () => {
    expect(buildIdentificarPayload(false, 'mov1', new Map())).toEqual({ bankMovementId: 'mov1' });
  });

  it('splitMode=false sin movimiento seleccionado: null (nada que mandar)', () => {
    expect(buildIdentificarPayload(false, null, new Map())).toBeNull();
  });

  it('splitMode=true: arma {asignaciones} desde el Map, en su orden de inserción', () => {
    const asignaciones = new Map<string, string>([['fp1', 'movA'], ['fp2', 'movB']]);
    expect(buildIdentificarPayload(true, null, asignaciones)).toEqual({
      asignaciones: [
        { formaPagoDocId: 'fp1', bankMovementId: 'movA' },
        { formaPagoDocId: 'fp2', bankMovementId: 'movB' },
      ],
    });
  });

  it('splitMode=true sin ninguna asignación todavía: null', () => {
    expect(buildIdentificarPayload(true, null, new Map())).toBeNull();
  });

  it('splitMode=true ignora singleMovementId — no existe atajo escalar en modo reparto', () => {
    const asignaciones = new Map<string, string>([['fp1', 'movA']]);
    expect(buildIdentificarPayload(true, 'mov-ignorado', asignaciones)).toEqual({
      asignaciones: [{ formaPagoDocId: 'fp1', bankMovementId: 'movA' }],
    });
  });

  it('splitMode=true con un mismo movimiento en 2 formas de pago (depósito compartido): 2 entradas, sin dedupe', () => {
    const asignaciones = new Map<string, string>([['fp1', 'movA'], ['fp2', 'movA']]);
    expect(buildIdentificarPayload(true, null, asignaciones)).toEqual({
      asignaciones: [
        { formaPagoDocId: 'fp1', bankMovementId: 'movA' },
        { formaPagoDocId: 'fp2', bankMovementId: 'movA' },
      ],
    });
  });

  // 2026-08-27 — 1 sola forma de pago repartida entre 2 depósitos (caso real
  // confirmado contra Kore): las claves compuestas `fp1::0`/`fp1::1` (ver
  // splitSlots) se recortan al formaPagoDocId real — el resultado repite
  // formaPagoDocId a propósito, el backend ya lo soporta (resolverAsignaciones).
  it('splitMode=true con claves compuestas fp::N (1 forma de pago, 2 depósitos): recorta el sufijo, repite formaPagoDocId', () => {
    const asignaciones = new Map<string, string>([['fp1::0', 'movA'], ['fp1::1', 'movB']]);
    expect(buildIdentificarPayload(true, null, asignaciones)).toEqual({
      asignaciones: [
        { formaPagoDocId: 'fp1', bankMovementId: 'movA' },
        { formaPagoDocId: 'fp1', bankMovementId: 'movB' },
      ],
    });
  });
});

// ── Helpers de fixture ──────────────────────────────────────────────────────────────
function buildSolicitud(overrides: Partial<CollectionRequest> = {}): CollectionRequest {
  return {
    _id: 'cr1',
    solicitudIdErp: 'ERP-1',
    cxcs: [],
    formasPago: [
      { _id: 'fp1', formaPagoId: 'transferencia', formaPagoDescripcion: 'Transferencia', importe: 600, referencia: null, bancoKoreId: null, bancoDescripcion: null, bankMovementId: null },
      { _id: 'fp2', formaPagoId: 'cheque', formaPagoDescripcion: 'Cheque', importe: 400, referencia: null, bancoKoreId: null, bancoDescripcion: null, bankMovementId: null },
    ],
    monto: 1000,
    modo: 'single',
    descripcion: null,
    conceptoId: null,
    comprobante: { tieneComprobante: false, mimetype: null, originalName: null },
    comprobantes: [],
    solicitanteUserId: 'u1',
    solicitanteNombre: 'Cajero de prueba',
    bankMovementId: null,
    status: 'pendiente',
    motivoRechazo: null,
    resueltoPorUserId: null,
    resueltoPorNombre: null,
    resueltoAt: null,
    canceladoPorUserId: null,
    canceladoPorNombre: null,
    canceladoAt: null,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

// ── Componente instanciado DIRECTO (sin TestBed) ────────────────────────────────────
// Mismo criterio que las pruebas de unidades chicas del backend: los métodos bajo
// prueba aquí son lógica pura de estado (Map de asignaciones, guards, armado de
// payload) — no tocan el DOM ni el ciclo de vida de Angular, así que instanciar la
// clase a mano con dependencias espiadas alcanza y evita el costo de TestBed.
describe('CollectionRequestComponent — reparto entre varios depósitos (multi-bank-movement)', () => {
  let svc: jasmine.SpyObj<CollectionRequestService>;
  let toast: jasmine.SpyObj<ToastService>;
  let comp: CollectionRequestComponent;

  const paginacionVacia = { total: 0, page: 1, limit: 50, pages: 0 };
  const statsVacias = { counts: { pendiente: 0, identificada: 0, rechazada: 0, cancelada: 0 }, identificadasHoy: 0, rechazadasHoy: 0, montoPendienteTotal: 0 };

  beforeEach(() => {
    svc = jasmine.createSpyObj<CollectionRequestService>('CollectionRequestService', ['identificar', 'list', 'listMine', 'stats', 'statsMine']);
    svc.listMine.and.returnValue(of({ data: [], pagination: paginacionVacia }));
    svc.list.and.returnValue(of({ data: [], pagination: paginacionVacia }));
    svc.statsMine.and.returnValue(of(statsVacias));
    svc.stats.and.returnValue(of(statsVacias));
    toast = jasmine.createSpyObj<ToastService>('ToastService', ['success', 'error', 'warning', 'info']);
    // auth/sanitizer/socketSvc no participan en los métodos bajo prueba — mocks vacíos alcanzan.
    comp = new CollectionRequestComponent(svc, {} as any, toast, {} as any, {} as any);
  });

  it('canSplit: false con 1 sola forma de pago, true con 2+', () => {
    const unaSola = buildSolicitud();
    unaSola.formasPago = [unaSola.formasPago[0]];
    comp.authTarget = unaSola;
    expect(comp.canSplit).toBe(false);

    comp.authTarget = buildSolicitud();
    expect(comp.canSplit).toBe(true);
  });

  it('toggleSplitMode: prende authStage "split" y limpia cualquier asignación previa', () => {
    comp.authTarget = buildSolicitud();
    comp.asignaciones.set('fp1', 'movA');

    comp.toggleSplitMode();

    expect(comp.splitMode).toBe(true);
    expect(comp.authStage).toBe('split');
    expect(comp.asignaciones.size).toBe(0);
  });

  it('toggleSplitMode: al apagarlo, repone authStage "match" si ya había un matchedMovement', () => {
    comp.authTarget = buildSolicitud();
    comp.matchedMovement = { _id: 'movA' };
    comp.splitMode = true;
    comp.authStage = 'split';

    comp.toggleSplitMode();

    expect(comp.splitMode).toBe(false);
    expect(comp.authStage).toBe('match');
  });

  it('toggleSplitMode: al apagarlo sin matchedMovement pero con candidatos cargados, repone "ambiguous"', () => {
    comp.authTarget = buildSolicitud();
    comp.matchedMovement = null;
    comp.bankMovements = [{ _id: 'movA' }, { _id: 'movB' }];
    comp.splitMode = true;
    comp.authStage = 'split';

    comp.toggleSplitMode();

    expect(comp.authStage).toBe('ambiguous');
  });

  it('asignacionesCompletas()/formasPagoSinAsignar(): reflejan el guard todo-o-nada del backend', () => {
    comp.authTarget = buildSolicitud();
    expect(comp.asignacionesCompletas()).toBe(false);
    expect(comp.formasPagoSinAsignar()).toBe(2);

    comp.asignarFormaPago('fp1', 'movA');
    expect(comp.asignacionesCompletas()).toBe(false);
    expect(comp.formasPagoSinAsignar()).toBe(1);

    // Depósito compartido: el MISMO movimiento cubre las 2 formas de pago.
    comp.asignarFormaPago('fp2', 'movA');
    expect(comp.asignacionesCompletas()).toBe(true);
    expect(comp.formasPagoSinAsignar()).toBe(0);
  });

  it('asignarFormaPago con movId vacío quita la asignación existente', () => {
    comp.authTarget = buildSolicitud();
    comp.asignarFormaPago('fp1', 'movA');
    expect(comp.asignaciones.get('fp1')).toBe('movA');

    comp.asignarFormaPago('fp1', '');
    expect(comp.asignaciones.has('fp1')).toBe(false);
  });

  it('splitCoverageLabel(): cuenta un movimiento compartido UNA sola vez, nunca duplicado', () => {
    comp.authTarget = buildSolicitud(); // monto: 1000
    comp.bankMovements = [
      { _id: 'movA', deposito: 700 },
      { _id: 'movB', deposito: 300 },
    ];
    comp.asignarFormaPago('fp1', 'movA');
    comp.asignarFormaPago('fp2', 'movA'); // mismo movA para las 2 formas — no debe contar 700 dos veces

    const label = comp.splitCoverageLabel();
    expect(label).toContain('700');
    expect(label).not.toContain('1,400');
  });

  it('askAuthorizeSplit(): no hace nada (ni llama al backend) si falta alguna forma de pago sin asignar', () => {
    comp.authTarget = buildSolicitud();
    comp.splitMode = true;
    comp.asignarFormaPago('fp1', 'movA'); // fp2 queda sin asignar

    comp.askAuthorizeSplit();

    expect(svc.identificar).not.toHaveBeenCalled();
  });

  it('camino feliz (splitMode=false): askAuthorize() manda el atajo escalar {bankMovementId}, sin tocar asignaciones', () => {
    const s = buildSolicitud();
    comp.authTarget = s;
    comp.matchedMovement = { _id: 'movA', deposito: 1000 };
    svc.identificar.and.returnValue(of({
      ...s,
      reconciliacion: { montoSolicitado: 1000, montoDepositado: 1000, diferencia: 0, cubreParcial: false, mensaje: null },
    }));

    comp.askAuthorize();
    comp.confirmModalAccept();

    expect(svc.identificar).toHaveBeenCalledWith('cr1', { bankMovementId: 'movA' });
    expect(toast.warning).not.toHaveBeenCalled();
  });

  it('reparto (splitMode=true): askAuthorizeSplit() manda {asignaciones} y muestra el aviso de abono parcial cuando el backend lo regresa', () => {
    const s = buildSolicitud();
    comp.authTarget = s;
    comp.splitMode = true;
    comp.authStage = 'split';
    comp.bankMovements = [{ _id: 'movA', deposito: 600 }, { _id: 'movB', deposito: 300 }];
    comp.asignarFormaPago('fp1', 'movA');
    comp.asignarFormaPago('fp2', 'movB');
    const mensaje = 'cubre $900.00 de $1,000.00 — quedan $100.00 pendientes';
    svc.identificar.and.returnValue(of({
      ...s,
      reconciliacion: { montoSolicitado: 1000, montoDepositado: 900, diferencia: 100, cubreParcial: true, mensaje },
    }));

    comp.askAuthorizeSplit();
    comp.confirmModalAccept();

    expect(svc.identificar).toHaveBeenCalledWith('cr1', {
      asignaciones: [
        { formaPagoDocId: 'fp1', bankMovementId: 'movA' },
        { formaPagoDocId: 'fp2', bankMovementId: 'movB' },
      ],
    });
    expect(toast.warning).toHaveBeenCalledWith(mensaje);
  });
});
