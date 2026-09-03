import { TestBed } from '@angular/core/testing';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { of, throwError } from 'rxjs';

import { TransferenciasCajaPanelComponent } from './transferencias-caja-panel.component';
import { BankService } from '../../../../core/services/bank.service';
import { AuthService } from '../../../../core/services/auth.service';
import { CajaTransferenciaBandeja } from '../../../../core/models/caja-transferencia.model';

const BANDEJA_VACIA: CajaTransferenciaBandeja = { pendientes: [] };

function fakePendiente(id: string) {
  return {
    transferencia: {
      _id: id, koreId: `kore-${id}`, monto: 1500, estatusKore: 'RECIBIDO',
      cajaOrigenId: null, nombreCajaOrigen: 'CAJA SILVA', almacenCajaOrigen: null,
      cajaDestinoId: null, nombreCajaDestino: 'CAJA - HECTOR', almacenCajaDestino: null,
      formaPago: null, nombreFormaPago: 'EFECTIVO', solicito: null, nombreSolicito: null,
      recibio: null, nombreRecibio: null, autorizo: null, nombreAutorizo: null,
      fechaSolicitud: null, fechaRecepcion: '2026-09-01T00:00:00Z', observacion: null,
      idTipoTransferencia: null, nombreTipoTransferencia: 'CIERRE DE CAJA',
      estatusMatch: 'pendiente' as const,
    },
    candidatos: [[{ _id: 'mov-1', banco: 'BBVA', fecha: '2026-09-01T00:00:00Z', concepto: null, deposito: 1500, categoria: 'Depósito en efectivo' }]],
  };
}

describe('TransferenciasCajaPanelComponent — bandeja Fase D (TestBed, Chrome real vía Karma)', () => {
  let bankServiceSpy: jasmine.SpyObj<BankService>;
  let authServiceSpy: jasmine.SpyObj<AuthService>;
  let component: TransferenciasCajaPanelComponent;
  let fixture: import('@angular/core/testing').ComponentFixture<TransferenciasCajaPanelComponent>;

  beforeEach(async () => {
    bankServiceSpy = jasmine.createSpyObj<BankService>('BankService', [
      'getTransferenciasCajaBandeja', 'confirmarTransferenciaCajaMatch', 'sincronizarTransferenciasCajaManual',
    ]);
    authServiceSpy = jasmine.createSpyObj<AuthService>('AuthService', ['hasPermission']);
    authServiceSpy.hasPermission.and.returnValue(true);

    await TestBed.configureTestingModule({
      imports: [CommonModule, FormsModule],
      declarations: [TransferenciasCajaPanelComponent],
      providers: [
        { provide: BankService, useValue: bankServiceSpy },
        { provide: AuthService, useValue: authServiceSpy },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(TransferenciasCajaPanelComponent);
    component = fixture.componentInstance;
  });

  it('no carga la bandeja hasta que visible pase a true', () => {
    fixture.detectChanges();
    expect(bankServiceSpy.getTransferenciasCajaBandeja).not.toHaveBeenCalled();
  });

  it('carga la bandeja cuando visible pasa a true', () => {
    bankServiceSpy.getTransferenciasCajaBandeja.and.returnValue(of(BANDEJA_VACIA));

    component.visible = true;
    component.ngOnChanges({ visible: { currentValue: true, previousValue: false, firstChange: true, isFirstChange: () => true } });

    expect(bankServiceSpy.getTransferenciasCajaBandeja).toHaveBeenCalled();
    expect(component.bandeja).toEqual(BANDEJA_VACIA);
    expect(component.loading).toBe(false);
  });

  it('reabrir el panel (visible false→true de nuevo) recarga la bandeja, no queda cacheada de la primera apertura', () => {
    bankServiceSpy.getTransferenciasCajaBandeja.and.returnValues(of(BANDEJA_VACIA), of({ pendientes: [fakePendiente('t-1')] }));

    component.visible = true;
    component.ngOnChanges({ visible: { currentValue: true, previousValue: false, firstChange: true, isFirstChange: () => true } });
    expect(component.bandeja).toEqual(BANDEJA_VACIA);

    // Se cierra y se vuelve a abrir en la MISMA sesión (sin recargar el navegador) — ej.
    // después de importar un movimiento nuevo que ahora sí debería aparecer como candidato.
    component.visible = false;
    component.ngOnChanges({ visible: { currentValue: false, previousValue: true, firstChange: false, isFirstChange: () => false } });
    component.visible = true;
    component.ngOnChanges({ visible: { currentValue: true, previousValue: false, firstChange: false, isFirstChange: () => false } });

    expect(bankServiceSpy.getTransferenciasCajaBandeja).toHaveBeenCalledTimes(2);
    expect(component.bandeja!.pendientes.length).toBe(1);
  });

  it('error al cargar: setea error y apaga loading', () => {
    bankServiceSpy.getTransferenciasCajaBandeja.and.returnValue(throwError(() => ({ error: { error: 'ERP no configurado' } })));

    component.visible = true;
    component.ngOnChanges({ visible: { currentValue: true, previousValue: false, firstChange: true, isFirstChange: () => true } });

    expect(component.error).toBe('ERP no configurado');
    expect(component.loading).toBe(false);
  });

  it('confirmar con éxito: quita esa transferencia de pendientes, no toca las demás', () => {
    const item1 = fakePendiente('t-1');
    const item2 = fakePendiente('t-2');
    component.bandeja = { pendientes: [item1, item2] };
    bankServiceSpy.confirmarTransferenciaCajaMatch.and.returnValue(of({ transferencia: {}, movimientos: [] }));

    component.confirmar(item1, item1.candidatos[0]);

    expect(bankServiceSpy.confirmarTransferenciaCajaMatch).toHaveBeenCalledWith('t-1', ['mov-1']);
    expect(component.confirmandoId).toBeNull();
    expect(component.bandeja!.pendientes).toEqual([item2]);
  });

  it('confirmar con error de negocio: muestra el mensaje y deja el item en la lista', () => {
    const item1 = fakePendiente('t-1');
    component.bandeja = { pendientes: [item1] };
    bankServiceSpy.confirmarTransferenciaCajaMatch.and.returnValue(
      throwError(() => ({ error: { error: 'El movimiento ya tiene un ID ERP vinculado' } })),
    );

    component.confirmar(item1, item1.candidatos[0]);

    expect(component.confirmError).toBe('El movimiento ya tiene un ID ERP vinculado');
    expect(component.bandeja!.pendientes).toEqual([item1]);
  });

  it('no permite confirmar 2 veces en simultáneo (ya hay una confirmación en curso)', () => {
    const item1 = fakePendiente('t-1');
    component.confirmandoId = 't-1';
    bankServiceSpy.confirmarTransferenciaCajaMatch.and.returnValue(of({ transferencia: {}, movimientos: [] }));

    component.confirmar(item1, item1.candidatos[0]);

    expect(bankServiceSpy.confirmarTransferenciaCajaMatch).not.toHaveBeenCalled();
  });

  it('sincronizarManual: no hace nada sin las 2 fechas', () => {
    component.syncFechaDesde = '2026-01-01';
    component.syncFechaHasta = '';

    component.sincronizarManual();

    expect(bankServiceSpy.sincronizarTransferenciasCajaManual).not.toHaveBeenCalled();
  });

  it('sincronizarManual: con éxito guarda el resultado y recarga la bandeja', () => {
    component.syncFechaDesde = '2026-01-01';
    component.syncFechaHasta = '2026-01-31';
    bankServiceSpy.sincronizarTransferenciasCajaManual.and.returnValue(of({ sincronizadas: 2, descartadas: 1 }));
    bankServiceSpy.getTransferenciasCajaBandeja.and.returnValue(of(BANDEJA_VACIA));

    component.sincronizarManual();

    expect(bankServiceSpy.sincronizarTransferenciasCajaManual).toHaveBeenCalledWith('2026-01-01', '2026-01-31');
    expect(component.syncResultado).toEqual({ sincronizadas: 2, descartadas: 1 });
    expect(component.syncing).toBe(false);
    expect(bankServiceSpy.getTransferenciasCajaBandeja).toHaveBeenCalled();
  });

  it('sincronizarManual: con error muestra el mensaje', () => {
    component.syncFechaDesde = '2026-01-01';
    component.syncFechaHasta = '2026-01-31';
    bankServiceSpy.sincronizarTransferenciasCajaManual.and.returnValue(
      throwError(() => ({ error: { error: 'Ya hay una sincronización manual de transferencias de caja en curso.' } })),
    );

    component.sincronizarManual();

    expect(component.syncError).toBe('Ya hay una sincronización manual de transferencias de caja en curso.');
    expect(component.syncing).toBe(false);
  });
});
