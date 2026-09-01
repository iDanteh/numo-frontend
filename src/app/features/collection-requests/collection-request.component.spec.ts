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
    svc = jasmine.createSpyObj<CollectionRequestService>('CollectionRequestService', ['identificar', 'list', 'listMine', 'stats', 'statsMine', 'analyzeComprobante']);
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

  // 2026-08-31 — bug real reportado con datos reales (solicitud erpId
  // 6a95cd3fdfc77cc5ff6ad724): con 1 sola forma de pago y 2 comprobantes, si un
  // comprobante matchea EXACTO y el otro no (aunque tenga su propio candidato
  // real, nivel "medio"), el código viejo mezclaba ambos en una lista plana y el
  // filtro global descartaba al segundo por completo — su depósito quedaba sin
  // identificar en silencio. Fix: precargar el reparto con el candidato propio de
  // CADA comprobante en vez de perder el que no sea el mejor global.
  it('analizarComprobante(): 2 comprobantes con candidatos propios distintos (uno exacto, otro no) — precarga el reparto, no descarta ninguno', () => {
    const s = buildSolicitud();
    s.formasPago   = [s.formasPago[0]];
    s.comprobantes = [{} as any, {} as any];
    comp.authTarget = s;

    svc.analyzeComprobante.and.returnValue(of([
      {
        comprobanteIndex: 0,
        extracted: { monto: 2037.83 } as any,
        candidates: [{ movement: { _id: 'movA', deposito: 2037.83 }, score: 63, porcentaje: 63, nivel: 'medio', reasons: ['Monto exacto'] }],
        totalCandidatos: 1,
      },
      {
        comprobanteIndex: 1,
        extracted: { monto: 728.12 } as any,
        candidates: [{ movement: { _id: 'movB', deposito: 727.05 }, score: 58, porcentaje: 58, nivel: 'medio', reasons: ['Monto ±0.5%'] }],
        totalCandidatos: 1,
      },
    ] as any));

    comp.analizarComprobante();

    expect(comp.authStage).toBe('split');
    expect(comp.splitMode).toBe(true);
    expect(comp.matchedMovement).toBeNull();
    expect(comp.asignaciones.get('fp1::0')).toBe('movA');
    expect(comp.asignaciones.get('fp1::1')).toBe('movB');
  });

  // 2026-08-31 (2do caso real, solicitud erpId 6a9098b58a18a3b75d73a3bf): un
  // comprobante con VARIOS candidatos (1 exacto entre ellos) y otro con CERO
  // candidatos — nunca debe llegar a 'match' (perdería que el 2do comprobante no
  // encontró nada); el slot resuelto se precarga, el slot sin nada queda vacío
  // para completar a mano (Asignar a… / búsqueda manual).
  it('analizarComprobante(): un comprobante con varios candidatos (uno exacto) y otro con CERO — precarga el que resuelve, deja vacío el que no', () => {
    const s = buildSolicitud();
    s.formasPago   = [s.formasPago[0]];
    s.comprobantes = [{} as any, {} as any];
    comp.authTarget = s;

    svc.analyzeComprobante.and.returnValue(of([
      {
        comprobanteIndex: 0,
        extracted: { monto: 23127.65 } as any,
        candidates: [
          { movement: { _id: 'movAlto', deposito: 23127.65 }, score: 85, porcentaje: 89, nivel: 'alto', reasons: ['Monto exacto'] },
          { movement: { _id: 'movMedio1', deposito: 23038.33 }, score: 54, porcentaje: 57, nivel: 'medio', reasons: ['Monto ±0.5%'] },
          { movement: { _id: 'movMedio2', deposito: 23130.4 }, score: 50, porcentaje: 53, nivel: 'medio', reasons: ['Monto ±0.5%'] },
          { movement: { _id: 'movMedio3', deposito: 23194.87 }, score: 48, porcentaje: 51, nivel: 'medio', reasons: ['Monto ±0.5%'] },
        ],
        totalCandidatos: 4,
      },
      {
        comprobanteIndex: 1,
        extracted: { monto: 227.86 } as any,
        candidates: [],
        totalCandidatos: 0,
      },
    ] as any));

    comp.analizarComprobante();

    expect(comp.authStage).toBe('split');
    expect(comp.splitMode).toBe(true);
    expect(comp.matchedMovement).toBeNull();
    expect(comp.asignaciones.get('fp1::0')).toBe('movAlto');
    expect(comp.asignaciones.has('fp1::1')).toBe(false);
  });

  // 2026-08-31 (3er caso real, mismo patrón que el 2do): comprobante 0 con 3
  // candidatos nivel "medio" (ninguno "alto"), pero UNO de ellos matchea EXACTO
  // en monto pese a ser "medio" (el nivel bajo lo arrastran otros factores —
  // fecha/concepto — no el monto) + comprobante 1 con CERO candidatos. El match
  // exacto debe ganar sobre los otros 2 "medio" no-exactos, y el comprobante sin
  // candidatos debe quedar vacío, nunca silenciado.
  it('analizarComprobante(): match exacto nivel "medio" entre varios + comprobante sin candidatos — mismo criterio, sin caso especial nuevo', () => {
    const s = buildSolicitud();
    s.formasPago   = [s.formasPago[0]];
    s.comprobantes = [{} as any, {} as any];
    comp.authTarget = s;

    svc.analyzeComprobante.and.returnValue(of([
      {
        comprobanteIndex: 0,
        extracted: { monto: 1092.46 } as any,
        candidates: [
          { movement: { _id: 'movCercano1', deposito: 1089.89 }, score: 54, porcentaje: 54, nivel: 'medio', reasons: ['Monto ±0.5%'] },
          { movement: { _id: 'movCercano2', deposito: 1091.34 }, score: 54, porcentaje: 54, nivel: 'medio', reasons: ['Monto ±0.5%'] },
          { movement: { _id: 'movExactoMedio', deposito: 1092.46 }, score: 53, porcentaje: 53, nivel: 'medio', reasons: ['Monto exacto'] },
        ],
        totalCandidatos: 3,
      },
      {
        comprobanteIndex: 1,
        extracted: { monto: 314.85 } as any,
        candidates: [],
        totalCandidatos: 0,
      },
    ] as any));

    comp.analizarComprobante();

    expect(comp.authStage).toBe('split');
    expect(comp.splitMode).toBe(true);
    expect(comp.matchedMovement).toBeNull();
    expect(comp.asignaciones.get('fp1::0')).toBe('movExactoMedio');
    expect(comp.asignaciones.has('fp1::1')).toBe(false);
  });

  // 2026-08-31 (4to caso real, erpId 6a9098b58a18a3b75d73a3bf): a diferencia de
  // los 3 anteriores, esta solicitud tiene 2 FORMAS DE PAGO (depósito en
  // efectivo + transferencia, 2 comprobantes para saldar 1 CxC) — el fix
  // anterior exigía 1 sola forma de pago para precargar, así que acá caía al
  // código viejo y reproducía el mismo bug (comprobante 1, con 0 candidatos,
  // se perdía en silencio). Fix generalizado: con 2+ comprobantes NUNCA se
  // llega a 'match', sin importar cuántas formasPago haya — pero con 2+
  // formasPago no hay forma segura de mapear comprobante→formaPago, así que
  // NO se precarga nada (adivinar sería peor que dejarlo vacío); igual entra a
  // 'split' con el panel de selects visible, y bankMovements ya trae los
  // candidatos de ambos comprobantes para elegir a mano.
  it('analizarComprobante(): 2 formasPago con 2 comprobantes — nunca "match", pero tampoco precarga (no hay mapeo seguro)', () => {
    const s = buildSolicitud(); // ya trae 2 formasPago (fp1/fp2) por default
    s.comprobantes = [{} as any, {} as any];
    comp.authTarget = s;

    svc.analyzeComprobante.and.returnValue(of([
      {
        comprobanteIndex: 0,
        extracted: { monto: 23127.65 } as any,
        candidates: [
          { movement: { _id: 'movAlto', deposito: 23127.65 }, score: 85, porcentaje: 89, nivel: 'alto', reasons: ['Monto exacto'] },
          { movement: { _id: 'movMedio1', deposito: 23038.33 }, score: 54, porcentaje: 57, nivel: 'medio', reasons: ['Monto ±0.5%'] },
        ],
        totalCandidatos: 2,
      },
      {
        comprobanteIndex: 1,
        extracted: { monto: 227.86 } as any,
        candidates: [],
        totalCandidatos: 0,
      },
    ] as any));

    comp.analizarComprobante();

    expect(comp.authStage).toBe('split');
    expect(comp.splitMode).toBe(true);
    expect(comp.matchedMovement).toBeNull();
    // Ningún slot se precarga con 2+ formasPago — el usuario elige a mano, pero
    // el panel (con ambos candidatos ya disponibles en bankMovements) SIEMPRE aparece.
    expect(comp.asignaciones.size).toBe(0);
    expect(comp.bankMovements.some((m: any) => m._id === 'movAlto')).toBe(true);
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

  // 2026-09-01 — bug real reportado por el usuario: una solicitud con cheque +
  // transferencia (2 formasPago) trajo los comprobantes en orden INVERTIDO al
  // de formasPago. El primer intento de este botón mapeaba por posición
  // (comprobantes[i] === formasPago[i]) — funcionaba por casualidad cuando el
  // orden coincidía y mentía cuando no, porque `comprobantes[]` no tiene ningún
  // campo que lo ligue a una formaPago (CollectionRequest.model.js). El fix usa
  // `_comprobanteIndex` — evidencia real que analizarComprobante() graba en
  // el movimiento que cada comprobante encontró por OCR — leído del movimiento
  // YA ASIGNADO al slot, nunca de la posición del slot.
  describe('comprobanteIndexParaSlot()', () => {
    it('1 sola forma de pago: usa el índice del slot directo, sin necesitar asignación', () => {
      const s = buildSolicitud({ formasPago: [buildSolicitud().formasPago[0]] });
      s.comprobantes = [{} as any, {} as any];
      comp.authTarget = s;

      expect(comp.comprobanteIndexParaSlot(s, 'fp1::0', 0)).toBe(0);
      expect(comp.comprobanteIndexParaSlot(s, 'fp1::1', 1)).toBe(1);
    });

    it('2+ formasPago, slot sin asignar todavía: null (no hay nada que mostrar)', () => {
      const s = buildSolicitud();
      s.comprobantes = [{} as any, {} as any];
      comp.authTarget = s;

      expect(comp.comprobanteIndexParaSlot(s, 'fp1', 0)).toBeNull();
    });

    it('2+ formasPago, orden de comprobantes INVERTIDO al de formasPago (caso real Kore): usa el índice real del movimiento asignado, no la posición del slot', () => {
      const s = buildSolicitud();
      s.comprobantes = [{} as any, {} as any]; // #0 = cheque (subido primero), #1 = transferencia
      comp.authTarget = s;
      comp.bankMovements = [
        { _id: 'movTransferencia', _comprobanteIndex: 1 },
        { _id: 'movCheque',        _comprobanteIndex: 0 },
      ];
      comp.asignarFormaPago('fp1', 'movTransferencia'); // fp1 = Transferencia → comprobante #1
      comp.asignarFormaPago('fp2', 'movCheque');         // fp2 = Cheque → comprobante #0

      expect(comp.comprobanteIndexParaSlot(s, 'fp1', 0)).toBe(1);
      expect(comp.comprobanteIndexParaSlot(s, 'fp2', 1)).toBe(0);
    });

    it('el comprobante #1 (índice 0) no se esconde por ser falsy', () => {
      const s = buildSolicitud();
      s.comprobantes = [{} as any, {} as any];
      comp.authTarget = s;
      comp.bankMovements = [{ _id: 'movA', _comprobanteIndex: 0 }];
      comp.asignarFormaPago('fp1', 'movA');

      expect(comp.comprobanteIndexParaSlot(s, 'fp1', 0)).toBe(0);
    });

    it('2+ formasPago, movimiento asignado por búsqueda manual (sin OCR, sin _comprobanteIndex): null, no adivina', () => {
      const s = buildSolicitud();
      s.comprobantes = [{} as any, {} as any];
      comp.authTarget = s;
      comp.bankMovements = [{ _id: 'movManual' }]; // sin _comprobanteIndex
      comp.asignarFormaPago('fp1', 'movManual');

      expect(comp.comprobanteIndexParaSlot(s, 'fp1', 0)).toBeNull();
    });

    it('movimiento deduplicado (mismo comprobante detectado para 2 formasPago): usa el primer índice de _comprobanteIndices', () => {
      const s = buildSolicitud();
      s.comprobantes = [{} as any];
      comp.authTarget = s;
      comp.bankMovements = [{ _id: 'movCompartido', _comprobanteIndices: [0] }];
      comp.asignarFormaPago('fp1', 'movCompartido');

      expect(comp.comprobanteIndexParaSlot(s, 'fp1', 0)).toBe(0);
    });

    // 2026-09-01 (pedido del usuario): además de la asignación confirmada, se
    // intenta relacionar por MONTO leído del OCR (importe de la formaPago vs
    // extracted.monto del comprobante) — funciona ANTES de asignar nada, apenas
    // corre analizarComprobante(). buildSolicitud(): fp1 Transferencia $600,
    // fp2 Cheque $400.
    it('por MONTO OCR, sin ninguna asignación todavía: relaciona cada comprobante con su formaPago aunque el orden de subida esté invertido', () => {
      const s = buildSolicitud();
      s.comprobantes = [{} as any, {} as any]; // #0 = cheque (subido primero), #1 = transferencia
      comp.authTarget = s;
      comp.ocrResultados = [
        { comprobanteIndex: 0, extracted: { monto: 400 } as any, candidates: [], totalCandidatos: 0 },
        { comprobanteIndex: 1, extracted: { monto: 600 } as any, candidates: [], totalCandidatos: 0 },
      ] as any;

      expect(comp.comprobanteIndexParaSlot(s, 'fp1', 0)).toBe(1); // Transferencia $600 → comprobante #1
      expect(comp.comprobanteIndexParaSlot(s, 'fp2', 1)).toBe(0); // Cheque $400 → comprobante #0
    });

    it('por MONTO OCR ambiguo (2 formasPago con el mismo importe): no adivina, null', () => {
      const s = buildSolicitud();
      s.formasPago[1].importe = 600; // ahora fp1 y fp2 comparten importe $600
      s.comprobantes = [{} as any];
      comp.authTarget = s;
      comp.ocrResultados = [
        { comprobanteIndex: 0, extracted: { monto: 600 } as any, candidates: [], totalCandidatos: 0 },
      ] as any;

      expect(comp.comprobanteIndexParaSlot(s, 'fp1', 0)).toBeNull();
      expect(comp.comprobanteIndexParaSlot(s, 'fp2', 1)).toBeNull();
    });

    it('por MONTO OCR ambiguo (2 comprobantes leen el mismo monto que 1 sola formaPago): no adivina, null', () => {
      const s = buildSolicitud();
      s.comprobantes = [{} as any, {} as any];
      comp.authTarget = s;
      comp.ocrResultados = [
        { comprobanteIndex: 0, extracted: { monto: 600 } as any, candidates: [], totalCandidatos: 0 },
        { comprobanteIndex: 1, extracted: { monto: 600 } as any, candidates: [], totalCandidatos: 0 },
      ] as any;

      expect(comp.comprobanteIndexParaSlot(s, 'fp1', 0)).toBeNull();
    });

    it('MONTO OCR no resuelve pero SÍ hay un movimiento ya asignado: cae al criterio de la asignación (fallback, no se rinde)', () => {
      const s = buildSolicitud();
      s.comprobantes = [{} as any, {} as any];
      comp.authTarget = s;
      comp.ocrResultados = []; // OCR no corrió / no ayuda
      comp.bankMovements = [{ _id: 'movCheque', _comprobanteIndex: 0 }];
      comp.asignarFormaPago('fp2', 'movCheque');

      expect(comp.comprobanteIndexParaSlot(s, 'fp2', 1)).toBe(0);
    });

    // 2026-09-01 — caso real reportado por el usuario: Cheque $728.12 matcheó
    // por monto contra el comprobante #0, pero Transferencia $55.00 no matchea
    // NINGÚN comprobante por monto (el comprobante #1 es de $14,070.47 — cubre
    // algo más grande, no esta forma de pago puntual). Como Cheque ya quedó
    // confirmado por evidencia real y solo sobra 1 forma de pago y 1
    // comprobante, ese último se deduce por ELIMINACIÓN — no es una posición
    // adivinada, es la única alternativa posible una vez descartadas las demás.
    it('por ELIMINACIÓN: si todas las demás formasPago ya resolvieron por monto y queda 1 sola forma de pago y 1 solo comprobante libres, los relaciona', () => {
      const s = buildSolicitud({
        formasPago: [
          { _id: 'fp1', formaPagoId: 'transferencia', formaPagoDescripcion: 'Transferencia', importe: 55,     referencia: null, bancoKoreId: null, bancoDescripcion: null, bankMovementId: null },
          { _id: 'fp2', formaPagoId: 'cheque',        formaPagoDescripcion: 'Cheque',        importe: 728.12, referencia: null, bancoKoreId: null, bancoDescripcion: null, bankMovementId: null },
        ],
      });
      s.comprobantes = [{} as any, {} as any];
      comp.authTarget = s;
      comp.ocrResultados = [
        { comprobanteIndex: 0, extracted: { monto: 728.12 }   as any, candidates: [], totalCandidatos: 0 },
        { comprobanteIndex: 1, extracted: { monto: 14070.47 } as any, candidates: [], totalCandidatos: 0 },
      ] as any;

      expect(comp.comprobanteIndexParaSlot(s, 'fp2', 1)).toBe(0); // Cheque — por monto
      expect(comp.comprobanteIndexParaSlot(s, 'fp1', 0)).toBe(1); // Transferencia — por eliminación
    });

    it('NO elimina si sobra más de 1 forma de pago sin resolver (no se puede saber el orden entre ellas)', () => {
      const s = buildSolicitud({
        formasPago: [
          { _id: 'fp1', formaPagoId: 'transferencia', formaPagoDescripcion: 'Transferencia', importe: 100, referencia: null, bancoKoreId: null, bancoDescripcion: null, bankMovementId: null },
          { _id: 'fp2', formaPagoId: 'cheque',        formaPagoDescripcion: 'Cheque',        importe: 200, referencia: null, bancoKoreId: null, bancoDescripcion: null, bankMovementId: null },
          { _id: 'fp3', formaPagoId: 'efectivo',      formaPagoDescripcion: 'Efectivo',      importe: 300, referencia: null, bancoKoreId: null, bancoDescripcion: null, bankMovementId: null },
        ],
      });
      s.comprobantes = [{} as any, {} as any, {} as any];
      comp.authTarget = s;
      comp.ocrResultados = [
        { comprobanteIndex: 0, extracted: { monto: 100 }   as any, candidates: [], totalCandidatos: 0 }, // matchea fp1
        { comprobanteIndex: 1, extracted: { monto: 9999 }  as any, candidates: [], totalCandidatos: 0 }, // no matchea nada
        { comprobanteIndex: 2, extracted: { monto: 8888 }  as any, candidates: [], totalCandidatos: 0 }, // no matchea nada
      ] as any;

      expect(comp.comprobanteIndexParaSlot(s, 'fp1', 0)).toBe(0); // resuelto por monto
      expect(comp.comprobanteIndexParaSlot(s, 'fp2', 1)).toBeNull(); // quedan 2 libres, ambiguo
      expect(comp.comprobanteIndexParaSlot(s, 'fp3', 2)).toBeNull();
    });

    it('NO elimina si la cantidad de comprobantes no coincide con la de formasPago', () => {
      const s = buildSolicitud();
      s.comprobantes = [{} as any, {} as any, {} as any]; // 3 comprobantes, 2 formasPago
      comp.authTarget = s;
      comp.ocrResultados = [
        { comprobanteIndex: 0, extracted: { monto: 600 } as any, candidates: [], totalCandidatos: 0 }, // matchea fp1 (Transferencia $600)
        { comprobanteIndex: 1, extracted: { monto: 9999 } as any, candidates: [], totalCandidatos: 0 },
        { comprobanteIndex: 2, extracted: { monto: 8888 } as any, candidates: [], totalCandidatos: 0 },
      ] as any;

      expect(comp.comprobanteIndexParaSlot(s, 'fp1', 0)).toBe(0); // resuelto por monto
      expect(comp.comprobanteIndexParaSlot(s, 'fp2', 1)).toBeNull(); // 2 comprobantes libres para 1 formaPago — ambiguo
    });
  });

  describe('bankMovementsParaSlot()', () => {
    // 2026-09-01 (pedido del usuario: "hacé algo similar en los select"): agrupa
    // el dropdown de candidatos poniendo primero los que vienen del comprobante
    // relacionado con esta forma de pago — sin ocultar el resto.
    it('agrupa los candidatos del comprobante relacionado primero, el resto después', () => {
      const s = buildSolicitud();
      s.comprobantes = [{} as any, {} as any];
      comp.authTarget = s;
      comp.ocrResultados = [
        { comprobanteIndex: 0, extracted: { monto: 400 } as any, candidates: [], totalCandidatos: 0 },
        { comprobanteIndex: 1, extracted: { monto: 600 } as any, candidates: [], totalCandidatos: 0 },
      ] as any;
      const movPropio = { _id: 'movA', _comprobanteIndex: 0 };
      const movOtro    = { _id: 'movB', _comprobanteIndex: 1 };
      comp.bankMovements = [movOtro, movPropio]; // orden original: el ajeno primero

      const grupos = comp.bankMovementsParaSlot('fp2'); // Cheque $400 → comprobante #0

      expect(grupos.propios).toEqual([movPropio]);
      expect(grupos.resto).toEqual([movOtro]);
    });

    it('sin relación posible: todo va a "resto", en el orden original, nada se pierde', () => {
      const s = buildSolicitud();
      s.comprobantes = [{} as any, {} as any];
      comp.authTarget = s;
      comp.ocrResultados = []; // no hay evidencia
      const movs = [{ _id: 'movA' }, { _id: 'movB' }];
      comp.bankMovements = movs;

      const grupos = comp.bankMovementsParaSlot('fp1');

      expect(grupos.propios).toEqual([]);
      expect(grupos.resto).toEqual(movs);
    });
  });
});
