import { TestBed } from '@angular/core/testing';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { of, throwError } from 'rxjs';

import { NetpayPanelComponent } from './netpay-panel.component';
import { BankService } from '../../../../core/services/bank.service';
import { AuthService } from '../../../../core/services/auth.service';
import { NetpayConsultaResultado } from '../../../../core/models/netpay-transaccion.model';

const RESULTADO_VACIO: NetpayConsultaResultado = {
  transacciones: [],
  totales: { monto: 0, comision: 0, neto: 0 },
  porAlmacen: [],
};

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
    bankServiceSpy = jasmine.createSpyObj<BankService>('BankService', ['consultarNetpayTransacciones']);
    authServiceSpy = jasmine.createSpyObj<AuthService>('AuthService', ['hasPermission']);
    authServiceSpy.hasPermission.and.returnValue(true);

    await TestBed.configureTestingModule({
      imports: [CommonModule, FormsModule],
      declarations: [NetpayPanelComponent],
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
    component.buscar();

    expect(bankServiceSpy.consultarNetpayTransacciones).toHaveBeenCalledWith(undefined, undefined, undefined, undefined);
    expect(component.resultado).toEqual(RESULTADO_VACIO);
    expect(component.loading).toBe(false);
  });

  it('buscar() con filtros: pasa los valores (trimeados) tal cual al service', () => {
    bankServiceSpy.consultarNetpayTransacciones.and.returnValue(of(fakeResultado()));

    component.responseCode = ' 00 ';
    component.almacenes    = 'A0,N0';
    component.buscar();

    expect(bankServiceSpy.consultarNetpayTransacciones).toHaveBeenCalledWith('00', 'A0,N0', undefined, undefined);
    expect(component.resultado!.totales.monto).toBeCloseTo(2495.44);
    expect(component.resultado!.porAlmacen.length).toBe(1);
  });

  it('buscar() con dateFrom/dateTo: completa a inicio/fin de día en ISO antes de llamar al service', () => {
    bankServiceSpy.consultarNetpayTransacciones.and.returnValue(of(RESULTADO_VACIO));

    component.dateFrom = '2026-09-04';
    component.dateTo   = '2026-09-04';
    component.buscar();

    expect(bankServiceSpy.consultarNetpayTransacciones).toHaveBeenCalledWith(
      undefined, undefined, '2026-09-04T00:00:00Z', '2026-09-04T23:59:59Z',
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
});
