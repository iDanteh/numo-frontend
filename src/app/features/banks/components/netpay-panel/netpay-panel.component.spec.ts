import { TestBed } from '@angular/core/testing';
import { NO_ERRORS_SCHEMA } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { of, throwError } from 'rxjs';

import { NetpayPanelComponent } from './netpay-panel.component';
import { BankService } from '../../../../core/services/bank.service';
import { AuthService } from '../../../../core/services/auth.service';
import { NetpayConsultaResultado, NetpayBandejaResultado, NetpayMatch } from '../../../../core/models/netpay-transaccion.model';
import { DateRangePopoverComponent } from '../../../../shared/components/date-range-popover/date-range-popover.component';

const RESULTADO_VACIO: NetpayConsultaResultado = {
  transacciones: [],
  totales: { monto: 0, comision: 0, neto: 0 },
  porAlmacen: [],
};

const BANDEJA_VACIA: NetpayBandejaResultado = { buckets: [] };

function fakeBucket(overrides: Partial<NetpayMatch> = {}): NetpayMatch {
  return {
    _id: 'bucket-1',
    terminalID: 'T1',
    almacen: 'A0',
    dia: '2026-09-10T00:00:00.000Z',
    bucket: 'general',
    netoEsperado: 300,
    estatusMatch: 'discrepancia',
    motivoDiscrepancia: 'sin_candidato',
    snapshot: {
      terminalID: 'T1', dia: '2026-09-10T00:00:00.000Z', montoBruto: 320, comision: 20, netoEsperado: 300,
      folios: [], reporteIdOrigen: null, claveRastreoOrigen: null, montoDepositoReporte: null,
    },
    movementIdsConfirmados: [],
    confirmadoPor: null, confirmadoEn: null,
    resueltoManualPor: null, resueltoManualEn: null, justificacion: null,
    descartadoManualmentePor: null, descartadoManualmenteEn: null, rechazoMotivo: null,
    revertido: null, estatusLegacy: null,
    ...overrides,
  };
}

function fakeResultado(): NetpayConsultaResultado {
  return {
    transacciones: [{
      ID: 603, orderID: '260828163321-2841258490', transactionID: '7A5BA83F', cardTypeName: 'MASTERCARD',
      cardType: 'D', folio: 'F20260828-00004', bank: 'AZTECA', amount: 2495.44, responseCode: '00',
      message: 'Transacción exitosa', customerName: '', terminalID: '2841258490', ticketDate: 'AGO. 28, 26 16:22:25',
      transactionDate: '2026-08-28T22:33:14.862214Z', reprintCount: 0, status: 'completed', userID: 'u1',
      userName: 'HECTOR CORONA', almacen: 'A0', idDetalleOperacion: 'd1', reprintCancelCount: 0,
      formaPagoId: 'fp1', commission: 28.65763296,
    }],
    totales: { monto: 2495.44, comision: 28.65763296, neto: 2466.78236704 },
    porAlmacen: [{ almacen: 'A0', totalMonto: 2495.44, totalComision: 28.65763296, neto: 2466.78236704 }],
  };
}

describe('NetpayPanelComponent — consulta en vivo Fase 1 (TestBed, Chrome real vía Karma)', () => {
  let bankServiceSpy: jasmine.SpyObj<BankService>;
  let authServiceSpy: jasmine.SpyObj<AuthService>;
  let component: NetpayPanelComponent;
  let fixture: import('@angular/core/testing').ComponentFixture<NetpayPanelComponent>;

  beforeEach(async () => {
    bankServiceSpy = jasmine.createSpyObj<BankService>('BankService', [
      'consultarNetpayTransacciones', 'obtenerNetpayBandeja', 'evaluarNetpayBandeja',
      'resolverNetpayMatch', 'rechazarNetpayMatch', 'candidatosNetpayMatch',
    ]);
    authServiceSpy = jasmine.createSpyObj<AuthService>('AuthService', ['hasPermission']);
    authServiceSpy.hasPermission.and.returnValue(true);

    await TestBed.configureTestingModule({
      imports: [CommonModule, FormsModule],
      declarations: [NetpayPanelComponent, DateRangePopoverComponent],
      providers: [
        { provide: BankService, useValue: bankServiceSpy },
        { provide: AuthService, useValue: authServiceSpy },
      ],
      // netpay-matching-v2 (consolidación 2026-09-29): <app-netpay-reporte-panel> ahora se
      // monta anidado dentro de la pestaña "Reportes" — se stubea como elemento desconocido
      // (mismo patrón que banks.component.spec.ts) en vez de declarar el componente real
      // completo, para no tener que mockear toda la superficie de BankService que usa.
      schemas: [NO_ERRORS_SCHEMA],
    }).compileComponents();

    fixture = TestBed.createComponent(NetpayPanelComponent);
    component = fixture.componentInstance;
  });

  it('no consulta hasta que se llame buscar()', () => {
    fixture.detectChanges();
    expect(bankServiceSpy.consultarNetpayTransacciones).not.toHaveBeenCalled();
  });

  it('buscar() con filtros vacíos: pasa undefined (no strings vacíos) al service', () => {
    bankServiceSpy.consultarNetpayTransacciones.and.returnValue(of(RESULTADO_VACIO));

    component.responseCode = '';
    component.almacenes    = '';
    component.dateFrom     = '';
    component.dateTo       = '';
    component.terminalID   = '';
    component.status       = '';
    component.buscar();

    expect(bankServiceSpy.consultarNetpayTransacciones).toHaveBeenCalledWith(
      undefined, undefined, undefined, undefined, undefined, undefined,
    );
    expect(component.resultado).toEqual(RESULTADO_VACIO);
    expect(component.loading).toBe(false);
  });

  it('buscar() con filtros: pasa los valores (trimeados) tal cual al service', () => {
    bankServiceSpy.consultarNetpayTransacciones.and.returnValue(of(fakeResultado()));

    component.responseCode = ' 00 ';
    component.almacenes    = 'A0,N0';
    component.buscar();

    expect(bankServiceSpy.consultarNetpayTransacciones).toHaveBeenCalledWith(
      '00', 'A0,N0', undefined, undefined, undefined, undefined,
    );
    expect(component.resultado!.totales.monto).toBeCloseTo(2495.44);
    expect(component.resultado!.porAlmacen.length).toBe(1);
  });

  // 2026-09-15: terminalID agregado — primer paso hacia el matching contra
  // BankMovement, confirmado por el usuario contra Kore real vía Insomnia.
  it('buscar() con terminalID: lo pasa (trimeado) al service', () => {
    bankServiceSpy.consultarNetpayTransacciones.and.returnValue(of(fakeResultado()));

    component.terminalID = ' 2840403056 ';
    component.buscar();

    expect(bankServiceSpy.consultarNetpayTransacciones).toHaveBeenCalledWith(
      undefined, undefined, undefined, undefined, '2840403056', undefined,
    );
  });

  // 2026-09-21: status agregado como 6to filtro — mismo patrón que terminalID, ya
  // existía como columna de tabla (NetpayTransaccion.status) pero nunca como filtro.
  it('buscar() con status: lo pasa al service', () => {
    bankServiceSpy.consultarNetpayTransacciones.and.returnValue(of(fakeResultado()));

    component.status = 'completed';
    component.buscar();

    expect(bankServiceSpy.consultarNetpayTransacciones).toHaveBeenCalledWith(
      undefined, undefined, undefined, undefined, undefined, 'completed',
    );
  });

  // 2026-09-22: dateFrom/dateTo se mandan PELADOS (YYYY-MM-DD) al backend — es
  // netpay-transacciones.service.js quien arma el instante UTC real de inicio/fin de
  // día en hora MX (antes: este componente armaba T00:00:00Z/T23:59:59Z en UTC puro,
  // perdiendo movimientos de las 6pm+ hora MX; se movió al backend para que ningún otro
  // consumidor futuro de estos 2 endpoints pueda reincidir en el mismo bug).
  it('buscar() con dateFrom/dateTo: los manda pelados (YYYY-MM-DD) tal cual al service', () => {
    bankServiceSpy.consultarNetpayTransacciones.and.returnValue(of(RESULTADO_VACIO));

    component.dateFrom = '2026-09-04';
    component.dateTo   = '2026-09-04';
    component.buscar();

    expect(bankServiceSpy.consultarNetpayTransacciones).toHaveBeenCalledWith(
      undefined, undefined, '2026-09-04', '2026-09-04', undefined, undefined,
    );
  });

  it('error al consultar: setea error y apaga loading', () => {
    bankServiceSpy.consultarNetpayTransacciones.and.returnValue(
      throwError(() => ({ error: { error: 'Error al consultar transacciones Netpay (502)' } })),
    );

    component.buscar();

    expect(component.error).toBe('Error al consultar transacciones Netpay (502)');
    expect(component.loading).toBe(false);
  });

  it('ngOnChanges: visible pasa a true resetea resultado/error de una apertura anterior (no queda cacheado)', () => {
    component.resultado = fakeResultado();
    component.error     = 'algo';

    component.visible = true;
    component.ngOnChanges({ visible: { currentValue: true, previousValue: false, firstChange: true, isFirstChange: () => true } });

    expect(component.resultado).toBeNull();
    expect(component.error).toBeNull();
  });

  it('ngOnChanges: visible pasa a false NO dispara ningún reset/consulta', () => {
    component.resultado = fakeResultado();

    component.visible = false;
    component.ngOnChanges({ visible: { currentValue: false, previousValue: true, firstChange: false, isFirstChange: () => false } });

    expect(component.resultado).not.toBeNull();
    expect(bankServiceSpy.consultarNetpayTransacciones).not.toHaveBeenCalled();
  });

  // Pestaña "Matching" (bandeja Netpay↔BBVA, netpay-matching-v2) — ya NO recalcula en
  // vivo contra Kore: lista buckets NetpayMatch YA evaluados (GET /netpay/bandeja),
  // dispara la evaluación explícita (POST .../evaluar) y resuelve/rechaza por :id
  // (candidate picker manual eliminado — ver design.md "Frontend").
  describe('pestaña Matching (netpay-matching-v2)', () => {
    it('buscar() en la pestaña "consulta" (default) llama consultarNetpayTransacciones, no la bandeja', () => {
      bankServiceSpy.consultarNetpayTransacciones.and.returnValue(of(RESULTADO_VACIO));

      component.buscar();

      expect(bankServiceSpy.consultarNetpayTransacciones).toHaveBeenCalled();
      expect(bankServiceSpy.obtenerNetpayBandeja).not.toHaveBeenCalled();
    });

    it('cambiarTab("matching") + buscar() llama obtenerNetpayBandeja, no la consulta', () => {
      bankServiceSpy.obtenerNetpayBandeja.and.returnValue(of(BANDEJA_VACIA));

      component.cambiarTab('matching');
      component.buscar();

      expect(bankServiceSpy.obtenerNetpayBandeja).toHaveBeenCalled();
      expect(bankServiceSpy.consultarNetpayTransacciones).not.toHaveBeenCalled();
      expect(component.bandeja).toEqual(BANDEJA_VACIA);
      expect(component.bandejaLoading).toBe(false);
    });

    // 2026-09-22: la pestaña Matching comparte dateFrom/dateTo con Consulta — mismo
    // contrato, se mandan pelados (YYYY-MM-DD), el backend arma la ventana MX.
    it('cambiarTab("matching") + buscar() con dateFrom/dateTo: los manda pelados (YYYY-MM-DD) al service', () => {
      bankServiceSpy.obtenerNetpayBandeja.and.returnValue(of(BANDEJA_VACIA));

      component.dateFrom = '2026-09-04';
      component.dateTo   = '2026-09-04';
      component.cambiarTab('matching');
      component.buscar();

      expect(bankServiceSpy.obtenerNetpayBandeja).toHaveBeenCalledWith(
        '2026-09-04', '2026-09-04', undefined, undefined,
      );
    });

    it('error al cargar la bandeja: setea bandejaError y apaga bandejaLoading', () => {
      bankServiceSpy.obtenerNetpayBandeja.and.returnValue(throwError(() => ({ error: { error: 'ERP no configurado' } })));

      component.cambiarTab('matching');
      component.buscar();

      expect(component.bandejaError).toBe('ERP no configurado');
      expect(component.bandejaLoading).toBe(false);
    });

    it('ngOnChanges (reapertura del panel) también resetea bandeja/bandejaError', () => {
      component.bandeja = BANDEJA_VACIA;
      component.bandejaError = 'algo';

      component.visible = true;
      component.ngOnChanges({ visible: { currentValue: true, previousValue: false, firstChange: true, isFirstChange: () => true } });

      expect(component.bandeja).toBeNull();
      expect(component.bandejaError).toBeNull();
    });

    // 6 chips de estatus (+ "Todos") — filtran vía el mismo query param que el backend
    // ya soporta en GET /netpay/bandeja.
    describe('filtro por estatus (chips)', () => {
      it('cambiarFiltroEstatus(): pasa el estatus elegido y recarga la bandeja', () => {
        bankServiceSpy.obtenerNetpayBandeja.and.returnValue(of(BANDEJA_VACIA));
        component.cambiarTab('matching');

        component.cambiarFiltroEstatus('discrepancia');

        expect(bankServiceSpy.obtenerNetpayBandeja).toHaveBeenCalledWith(
          undefined, undefined, undefined, 'discrepancia',
        );
        expect(component.estatusFiltro).toBe('discrepancia');
      });

      it('cambiarFiltroEstatus(\'\') vuelve a "Todos" (sin filtro)', () => {
        bankServiceSpy.obtenerNetpayBandeja.and.returnValue(of(BANDEJA_VACIA));
        component.cambiarTab('matching');
        component.estatusFiltro = 'rechazado';

        component.cambiarFiltroEstatus('');

        expect(bankServiceSpy.obtenerNetpayBandeja).toHaveBeenCalledWith(
          undefined, undefined, undefined, undefined,
        );
      });
    });

    // Botón "Evaluar" — dispara POST /netpay/bandeja/evaluar (nunca side effects en el
    // GET) y recarga la bandeja con el resultado persistido.
    describe('evaluar()', () => {
      it('éxito: llama evaluarNetpayBandeja con dateFrom/dateTo/terminalID y recarga la bandeja', () => {
        bankServiceSpy.evaluarNetpayBandeja.and.returnValue(of({ evaluados: [fakeBucket()] }));
        bankServiceSpy.obtenerNetpayBandeja.and.returnValue(of({ buckets: [fakeBucket()] }));
        component.dateFrom = '2026-09-04';
        component.dateTo = '2026-09-05';
        component.terminalID = '2840403056';

        component.evaluar();

        expect(bankServiceSpy.evaluarNetpayBandeja).toHaveBeenCalledWith({
          dateFrom: '2026-09-04', dateTo: '2026-09-05', terminalID: '2840403056',
          responseCode: undefined, almacenes: undefined, status: undefined,
        });
        expect(bankServiceSpy.obtenerNetpayBandeja).toHaveBeenCalled();
        expect(component.evaluando).toBe(false);
        expect(component.bandeja!.buckets).toEqual([fakeBucket()]);
      });

      // Fix 2026-09-29 (pedido explícito del usuario): Matching ahora comparte
      // responseCode/almacenes/status con Consulta — evaluar() debe reenviarlos.
      it('el input de responseCode se muestra también en la pestaña Matching, no solo en Consulta', () => {
        component.cambiarTab('matching');
        fixture.detectChanges();
        expect(fixture.nativeElement.querySelector('[placeholder="responseCode (ej. 00)"]')).not.toBeNull();
      });

      it('con responseCode/almacenes/status seteados: los reenvía junto al resto', () => {
        bankServiceSpy.evaluarNetpayBandeja.and.returnValue(of({ evaluados: [] }));
        bankServiceSpy.obtenerNetpayBandeja.and.returnValue(of({ buckets: [] }));
        component.dateFrom = '2026-09-04';
        component.dateTo = '2026-09-05';
        component.terminalID = '2840403056';
        component.responseCode = '00';
        component.almacenes = 'A0,N0';
        component.status = 'completed';

        component.evaluar();

        expect(bankServiceSpy.evaluarNetpayBandeja).toHaveBeenCalledWith({
          dateFrom: '2026-09-04', dateTo: '2026-09-05', terminalID: '2840403056',
          responseCode: '00', almacenes: 'A0,N0', status: 'completed',
        });
      });

      it('error: muestra el mensaje y apaga evaluando', () => {
        bankServiceSpy.evaluarNetpayBandeja.and.returnValue(throwError(() => ({ error: { error: 'ERP no configurado' } })));

        component.evaluar();

        expect(component.evaluarError).toBe('ERP no configurado');
        expect(component.evaluando).toBe(false);
      });

      it('no permite evaluar 2 veces en simultáneo', () => {
        component.evaluando = true;
        component.evaluar();
        expect(bankServiceSpy.evaluarNetpayBandeja).not.toHaveBeenCalled();
      });
    });

    // Diálogo Resolver — reemplaza el candidate picker manual. Requiere justificación
    // (deshabilitado hasta que se llene), opcionalmente vincula 0-2 movimientos elegidos
    // desde /candidatos (nunca fuerza confirmado_automatico — spec.md).
    describe('Resolver (bucket en discrepancia)', () => {
      it('abrirResolver(): carga candidatos vía candidatosNetpayMatch(bucket._id)', () => {
        const bucket = fakeBucket();
        bankServiceSpy.candidatosNetpayMatch.and.returnValue(of({
          candidatos: [{ _id: 'mov-1', banco: 'BBVA', fecha: '2026-09-10', concepto: null, deposito: 300, numeroAutorizacion: null, diferencia: 0 }],
        }));

        component.abrirResolver(bucket);

        expect(bankServiceSpy.candidatosNetpayMatch).toHaveBeenCalledWith('bucket-1');
        expect(component.resolviendoId).toBe('bucket-1');
        expect(component.resolverCandidatos.length).toBe(1);
      });

      it('puedeResolver(): false sin justificación, true con justificación no vacía', () => {
        component.resolverJustificacion = '';
        expect(component.puedeResolver()).toBe(false);

        component.resolverJustificacion = '   ';
        expect(component.puedeResolver()).toBe(false);

        component.resolverJustificacion = 'Revisado a mano contra el estado de cuenta';
        expect(component.puedeResolver()).toBe(true);
      });

      it('toggleSeleccionCandidato(): selecciona hasta 2, un 3er intento no se agrega', () => {
        component.toggleSeleccionCandidato('mov-1');
        component.toggleSeleccionCandidato('mov-2');
        component.toggleSeleccionCandidato('mov-3');

        expect(component.resolverSeleccion.size).toBe(2);
        expect(component.resolverSeleccion.has('mov-3')).toBe(false);
      });

      it('toggleSeleccionCandidato(): puede deseleccionar uno ya elegido', () => {
        component.toggleSeleccionCandidato('mov-1');
        component.toggleSeleccionCandidato('mov-1');
        expect(component.resolverSeleccion.size).toBe(0);
      });

      it('confirmarResolver(): éxito — llama resolverNetpayMatch, reemplaza el bucket en la lista y cierra el diálogo', () => {
        const bucket = fakeBucket();
        component.bandeja = { buckets: [bucket] };
        component.resolviendoId = bucket._id;
        component.resolverJustificacion = 'Revisado a mano';
        component.toggleSeleccionCandidato('mov-9');
        const resuelto = fakeBucket({ estatusMatch: 'resuelto_manual', justificacion: 'Revisado a mano' });
        bankServiceSpy.resolverNetpayMatch.and.returnValue(of({ bucket: resuelto, movimientos: [] }));

        component.confirmarResolver(bucket);

        expect(bankServiceSpy.resolverNetpayMatch).toHaveBeenCalledWith('bucket-1', {
          justificacion: 'Revisado a mano', movementIds: ['mov-9'],
        });
        expect(component.bandeja!.buckets).toEqual([resuelto]);
        expect(component.resolviendoId).toBeNull();
        expect(component.resolverEnviando).toBe(false);
      });

      it('confirmarResolver(): sin justificación no llama al service', () => {
        const bucket = fakeBucket();
        component.resolviendoId = bucket._id;
        component.resolverJustificacion = '';

        component.confirmarResolver(bucket);

        expect(bankServiceSpy.resolverNetpayMatch).not.toHaveBeenCalled();
      });

      it('confirmarResolver(): error de negocio muestra el mensaje y no cierra el diálogo', () => {
        const bucket = fakeBucket();
        component.resolviendoId = bucket._id;
        component.resolverJustificacion = 'Revisado a mano';
        bankServiceSpy.resolverNetpayMatch.and.returnValue(
          throwError(() => ({ error: { error: 'Este bucket no está en discrepancia' } })),
        );

        component.confirmarResolver(bucket);

        expect(component.resolverError).toBe('Este bucket no está en discrepancia');
        expect(component.resolviendoId).toBe(bucket._id);
        expect(component.resolverEnviando).toBe(false);
      });
    });

    // Diálogo Rechazar — cualquier estado activo puede rechazarse (spec.md "any active
    // state -> rechazado"), nunca vincula nada contra BankMovement.
    describe('Rechazar', () => {
      it('confirmarRechazar(): éxito — llama rechazarNetpayMatch y reemplaza el bucket en la lista', () => {
        const bucket = fakeBucket();
        component.bandeja = { buckets: [bucket] };
        component.rechazandoId = bucket._id;
        component.rechazarMotivo = 'Ya identificado por otra vía';
        const rechazado = fakeBucket({ estatusMatch: 'rechazado', rechazoMotivo: 'Ya identificado por otra vía' });
        bankServiceSpy.rechazarNetpayMatch.and.returnValue(of({ bucket: rechazado }));

        component.confirmarRechazar(bucket);

        expect(bankServiceSpy.rechazarNetpayMatch).toHaveBeenCalledWith('bucket-1', { motivo: 'Ya identificado por otra vía' });
        expect(component.bandeja!.buckets).toEqual([rechazado]);
        expect(component.rechazandoId).toBeNull();
      });

      it('confirmarRechazar(): error de negocio muestra el mensaje y no cierra el diálogo', () => {
        const bucket = fakeBucket();
        component.rechazandoId = bucket._id;
        bankServiceSpy.rechazarNetpayMatch.and.returnValue(
          throwError(() => ({ error: { error: 'Este bucket ya está en un estado terminal' } })),
        );

        component.confirmarRechazar(bucket);

        expect(component.rechazarError).toBe('Este bucket ya está en un estado terminal');
        expect(component.rechazandoId).toBe(bucket._id);
      });
    });
  });

  // Consolidación 2026-09-29 (pedido explícito del usuario — "dejar todo en una sola
  // vista, para no cambiar de un lado a otros"): Reportes deja de ser un sidebar propio
  // en banks.component y pasa a ser una 3ra pestaña acá, anidando el componente existente
  // <app-netpay-reporte-panel> sin reescribir su lógica interna.
  describe('pestaña Reportes (netpay-matching-v2, consolidación de vista)', () => {
    it('cambiarTab("reportes") cambia el tab activo', () => {
      component.cambiarTab('reportes');
      expect(component.tab).toBe('reportes');
    });

    it('tab "reportes": oculta los filtros compartidos de Consulta/Matching y muestra <app-netpay-reporte-panel>', () => {
      component.cambiarTab('reportes');
      fixture.detectChanges();

      expect(fixture.nativeElement.querySelector('.np-filtros')).toBeNull();
      expect(fixture.nativeElement.querySelector('app-netpay-reporte-panel')).not.toBeNull();
    });

    it('tab "consulta"/"matching": NO muestra <app-netpay-reporte-panel> (sigue montado solo en su propia pestaña)', () => {
      fixture.detectChanges();
      expect(fixture.nativeElement.querySelector('app-netpay-reporte-panel')).toBeNull();

      component.cambiarTab('matching');
      fixture.detectChanges();
      expect(fixture.nativeElement.querySelector('app-netpay-reporte-panel')).toBeNull();
    });

    // Bug real a evitar: el sidebar completo NUNCA se saca del DOM al cerrarse (solo
    // alterna una clase CSS vía [class.np-sidebar-open], ver netpay-panel.component.html
    // línea 1) — si el hijo recibiera solo [visible]="tab === 'reportes'" (sin combinar
    // con el `visible` del panel padre), reabrir el panel con la pestaña Reportes YA
    // seleccionada de una apertura anterior no dispararía ningún cambio real de valor en
    // ese Input, y su ngOnChanges (que resetea/recarga la lista) nunca correría de nuevo.
    it('<app-netpay-reporte-panel> recibe [visible] = visible del panel padre Y tab==="reportes" combinados (para resetear al reabrir)', () => {
      component.visible = false;
      component.tab = 'reportes';
      fixture.detectChanges();

      const el = fixture.nativeElement.querySelector('app-netpay-reporte-panel');
      expect(el.visible).toBe(false);

      component.visible = true;
      fixture.detectChanges();
      expect(el.visible).toBe(true);
    });
  });
});
