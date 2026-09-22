import { TestBed } from '@angular/core/testing';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { of, throwError } from 'rxjs';

import { NetpayPanelComponent } from './netpay-panel.component';
import { BankService } from '../../../../core/services/bank.service';
import { AuthService } from '../../../../core/services/auth.service';
import { NetpayConsultaResultado, NetpayBandejaResultado, NetpayMatchPendiente } from '../../../../core/models/netpay-transaccion.model';
import { DateRangePopoverComponent } from '../../../../shared/components/date-range-popover/date-range-popover.component';

const RESULTADO_VACIO: NetpayConsultaResultado = {
  transacciones: [],
  totales: { monto: 0, comision: 0, neto: 0 },
  porAlmacen: [],
};

const BANDEJA_VACIA: NetpayBandejaResultado = { pendientes: [] };

function fakePendiente(terminalID: string, dia: string): NetpayMatchPendiente {
  return {
    grupo: { terminalID, almacen: 'A0', dia, montoBruto: 320, comision: 20, netoEsperado: 300, cantidadTransacciones: 3 },
    candidatos: [[{ _id: 'mov-1', banco: 'BBVA', fecha: dia, concepto: null, deposito: 300, numeroAutorizacion: null }]],
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
      'consultarNetpayTransacciones', 'obtenerNetpayBandeja', 'confirmarNetpayMatch', 'descartarNetpayMatch',
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

  it('buscar() con dateFrom/dateTo: completa a inicio/fin de día en ISO antes de llamar al service', () => {
    bankServiceSpy.consultarNetpayTransacciones.and.returnValue(of(RESULTADO_VACIO));

    component.dateFrom = '2026-09-04';
    component.dateTo   = '2026-09-04';
    component.buscar();

    expect(bankServiceSpy.consultarNetpayTransacciones).toHaveBeenCalledWith(
      undefined, undefined, '2026-09-04T00:00:00Z', '2026-09-04T23:59:59Z', undefined, undefined,
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

  // Pestaña "Matching" (bandeja Netpay↔BBVA) — mismo patrón de interacción que
  // transferencias-caja-panel, adaptado a que un grupo se identifica por terminalID+día
  // (clave()) en vez de un _id propio.
  describe('pestaña Matching', () => {
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

    it('clave(): identifica un grupo por terminalID+día', () => {
      const item = fakePendiente('2840403056', '2026-09-10T00:00:00.000Z');
      expect(component.clave(item)).toBe('2840403056|2026-09-10T00:00:00.000Z');
    });

    it('confirmar con éxito: quita ese grupo de pendientes, no toca los demás', () => {
      const item1 = fakePendiente('T1', '2026-09-10T00:00:00.000Z');
      const item2 = fakePendiente('T2', '2026-09-10T00:00:00.000Z');
      component.bandeja = { pendientes: [item1, item2] };
      bankServiceSpy.confirmarNetpayMatch.and.returnValue(of({ movimientos: [] }));

      component.confirmar(item1, item1.candidatos[0]);

      expect(bankServiceSpy.confirmarNetpayMatch).toHaveBeenCalledWith({
        terminalID: 'T1', almacen: 'A0', dia: '2026-09-10T00:00:00.000Z', movementIds: ['mov-1'],
      });
      expect(component.confirmandoClave).toBeNull();
      expect(component.bandeja!.pendientes).toEqual([item2]);
    });

    it('confirmar con error de negocio: muestra el mensaje y deja el item en la lista', () => {
      const item1 = fakePendiente('T1', '2026-09-10T00:00:00.000Z');
      component.bandeja = { pendientes: [item1] };
      bankServiceSpy.confirmarNetpayMatch.and.returnValue(
        throwError(() => ({ error: { error: 'El movimiento ya tiene un ID ERP vinculado' } })),
      );

      component.confirmar(item1, item1.candidatos[0]);

      expect(component.confirmError).toBe('El movimiento ya tiene un ID ERP vinculado');
      expect(component.bandeja!.pendientes).toEqual([item1]);
    });

    it('no permite confirmar 2 veces en simultáneo', () => {
      const item1 = fakePendiente('T1', '2026-09-10T00:00:00.000Z');
      component.confirmandoClave = component.clave(item1);
      bankServiceSpy.confirmarNetpayMatch.and.returnValue(of({ movimientos: [] }));

      component.confirmar(item1, item1.candidatos[0]);

      expect(bankServiceSpy.confirmarNetpayMatch).not.toHaveBeenCalled();
    });

    describe('descartarManual() — descarte manual de "Sin candidatos"', () => {
      it('con éxito: quita el grupo de pendientes y limpia el estado de confirmación', () => {
        const item1 = fakePendiente('T1', '2026-09-10T00:00:00.000Z');
        const item2 = fakePendiente('T2', '2026-09-10T00:00:00.000Z');
        component.bandeja = { pendientes: [item1, item2] };
        component.togglePedirConfirmacionDescarte(component.clave(item1));
        bankServiceSpy.descartarNetpayMatch.and.returnValue(of({ terminalID: 'T1', dia: '2026-09-10T00:00:00.000Z', estatusMatch: 'descartada-manual' }));

        component.descartarManual(item1);

        expect(bankServiceSpy.descartarNetpayMatch).toHaveBeenCalledWith({ terminalID: 'T1', almacen: 'A0', dia: '2026-09-10T00:00:00.000Z' });
        expect(component.descartandoClave).toBeNull();
        expect(component.bandeja!.pendientes).toEqual([item2]);
        expect(component.pideConfirmacionDescarte(component.clave(item1))).toBe(false);
      });

      it('con error de negocio: muestra el mensaje y deja el item en la lista', () => {
        const item1 = fakePendiente('T1', '2026-09-10T00:00:00.000Z');
        component.bandeja = { pendientes: [item1] };
        bankServiceSpy.descartarNetpayMatch.and.returnValue(
          throwError(() => ({ error: { error: 'Este grupo ya tiene candidato(s) para revisar' } })),
        );

        component.descartarManual(item1);

        expect(component.descartarError).toBe('Este grupo ya tiene candidato(s) para revisar');
        expect(component.bandeja!.pendientes).toEqual([item1]);
      });
    });

    describe('ambigüedad (2+ candidatos)', () => {
      it('confirmarSeleccionActiva(): sin selección, no hace nada', () => {
        const item = fakePendiente('T1', '2026-09-10T00:00:00.000Z');
        item.candidatos = [item.candidatos[0], item.candidatos[0]];

        component.confirmarSeleccionActiva(item);

        expect(bankServiceSpy.confirmarNetpayMatch).not.toHaveBeenCalled();
      });

      it('confirmarSeleccionActiva(): con selección, confirma el grupo elegido', () => {
        const grupoA = [{ _id: 'mov-a', banco: 'BBVA', fecha: '2026-09-10T00:00:00Z', concepto: null, deposito: 200, numeroAutorizacion: null }];
        const grupoB = [{ _id: 'mov-b', banco: 'BBVA', fecha: '2026-09-11T00:00:00Z', concepto: null, deposito: 200, numeroAutorizacion: '778899' }];
        const item = { ...fakePendiente('T1', '2026-09-10T00:00:00.000Z'), candidatos: [grupoA, grupoB] };
        bankServiceSpy.confirmarNetpayMatch.and.returnValue(of({ movimientos: [] }));

        component.seleccionar(component.clave(item), 1);
        component.confirmarSeleccionActiva(item);

        expect(bankServiceSpy.confirmarNetpayMatch).toHaveBeenCalledWith(jasmine.objectContaining({ movementIds: ['mov-b'] }));
      });
    });
  });
});
