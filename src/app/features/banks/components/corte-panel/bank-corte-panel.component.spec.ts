import { TestBed } from '@angular/core/testing';
import { NO_ERRORS_SCHEMA } from '@angular/core';
import { CommonModule } from '@angular/common';
import { of, throwError } from 'rxjs';

import { BankCortePanelComponent } from './bank-corte-panel.component';
import { BankService } from '../../../../core/services/bank.service';
import { BankCorteConciliacion } from '../../../../core/models/bank.model';
import { AuthService } from '../../../../core/services/auth.service';

// bank-corte-panel.component.spec.ts — primer spec de este componente (2026-10-02).
// Cobertura: (1) periodo disponible/default por rol (cobranza→semanal, contabilidad→mensual,
// cualquier otro rol→ambos), (2) load()/cambiarPeriodo() piden al service con el periodo y
// banco correctos, (3) cambiarPeriodo() a un periodo no disponible para el rol es un no-op,
// (4) manejo de error.
const CORTE_FIXTURE: BankCorteConciliacion = {
  periodo: 'semanal',
  inicio:  '2026-10-05T06:00:00.000Z',
  rezagados: { no_identificado: 2, reclasificado: 1, total: 3 },
  nuevos:    { no_identificado: 5, reclasificado: 0, identificado: 10, otros: 0, pendientes: 5, total: 15 },
  identificadosEnPeriodo: { deRezagados: 1, deNuevos: 10, total: 11 },
};

describe('BankCortePanelComponent (TestBed, Chrome real vía Karma)', () => {
  let bankServiceSpy: jasmine.SpyObj<BankService>;
  let authSpy: { hasRole: jasmine.Spy };
  let component: BankCortePanelComponent;
  let fixture: import('@angular/core/testing').ComponentFixture<BankCortePanelComponent>;

  function configurar(rol: string | null): void {
    bankServiceSpy = jasmine.createSpyObj<BankService>('BankService', ['corteConciliacion']);
    bankServiceSpy.corteConciliacion.and.returnValue(of(CORTE_FIXTURE));
    authSpy = { hasRole: jasmine.createSpy('hasRole').and.callFake((r: string) => r === rol) };
  }

  async function crear(): Promise<void> {
    await TestBed.configureTestingModule({
      imports: [CommonModule],
      declarations: [BankCortePanelComponent],
      providers: [
        { provide: BankService, useValue: bankServiceSpy },
        { provide: AuthService, useValue: authSpy },
      ],
      schemas: [NO_ERRORS_SCHEMA],
    }).compileComponents();

    fixture = TestBed.createComponent(BankCortePanelComponent);
    component = fixture.componentInstance;
  }

  it('rol cobranza: solo periodo semanal disponible, sin alternar', async () => {
    configurar('cobranza');
    await crear();
    fixture.detectChanges();

    expect(component.periodosDisponibles).toEqual(['semanal']);
    expect(component.periodoActivo).toBe('semanal');
    expect(component.puedeAlternarPeriodo).toBe(false);
  });

  it('rol contabilidad: solo periodo mensual disponible, default mensual', async () => {
    configurar('contabilidad');
    await crear();
    fixture.detectChanges();

    expect(component.periodosDisponibles).toEqual(['mensual']);
    expect(component.periodoActivo).toBe('mensual');
    expect(component.puedeAlternarPeriodo).toBe(false);
  });

  it('otro rol (ej. admin): ambos periodos disponibles, puede alternar, default semanal', async () => {
    configurar('admin');
    await crear();
    fixture.detectChanges();

    expect(component.periodosDisponibles).toEqual(['semanal', 'mensual']);
    expect(component.periodoActivo).toBe('semanal');
    expect(component.puedeAlternarPeriodo).toBe(true);
  });

  it('load(): pide al service el periodo activo y el banco recibido', async () => {
    configurar('admin');
    await crear();
    fixture.detectChanges();

    component.load('BBVA');
    expect(bankServiceSpy.corteConciliacion).toHaveBeenCalledWith('semanal', 'BBVA');
    expect(component.data).toEqual(CORTE_FIXTURE);
  });

  it('cambiarPeriodo(): cambia el periodo activo y recarga', async () => {
    configurar('admin');
    await crear();
    fixture.detectChanges();
    component.load(null);
    bankServiceSpy.corteConciliacion.calls.reset();

    component.cambiarPeriodo('mensual');

    expect(component.periodoActivo).toBe('mensual');
    expect(bankServiceSpy.corteConciliacion).toHaveBeenCalledWith('mensual', null);
  });

  it('cambiarPeriodo() a un periodo no disponible para el rol: no-op', async () => {
    configurar('cobranza');
    await crear();
    fixture.detectChanges();
    bankServiceSpy.corteConciliacion.calls.reset();

    component.cambiarPeriodo('mensual');

    expect(component.periodoActivo).toBe('semanal');
    expect(bankServiceSpy.corteConciliacion).not.toHaveBeenCalled();
  });

  it('error del service: marca error=true, no rompe', async () => {
    configurar('admin');
    bankServiceSpy.corteConciliacion.and.returnValue(throwError(() => new Error('falló')));
    await crear();
    fixture.detectChanges();

    component.load(null);

    expect(component.error).toBe(true);
    expect(component.loading).toBe(false);
  });
});
