import { TestBed } from '@angular/core/testing';
import { CommonModule } from '@angular/common';
import { of } from 'rxjs';

import { BankDashboardCarouselComponent } from './bank-dashboard-carousel.component';
import { BankIndicadoresPanelComponent } from '../indicadores-panel/bank-indicadores-panel.component';
import { BankService, BankIndicadoresIdentificacion } from '../../../../core/services/bank.service';

const INDICADORES_VACIO: BankIndicadoresIdentificacion = {
  promedioHoras: null,
  totalIdentificadosConDato: 0,
  backlog: {
    historico: { menos24h: 0, de1a3d: 0, de3a7d: 0, mas7d: 0 },
    nuevo:     { menos24h: 0, de1a3d: 0, de3a7d: 0, mas7d: 0 },
  },
  porUsuario: [],
};

const STORAGE_KEY = BankDashboardCarouselComponent.STORAGE_KEY;

describe('BankDashboardCarouselComponent — carousel de 2 slides (TestBed, Chrome real vía Karma)', () => {
  let bankServiceSpy: jasmine.SpyObj<BankService>;
  let component: BankDashboardCarouselComponent;
  let fixture: import('@angular/core/testing').ComponentFixture<BankDashboardCarouselComponent>;

  beforeEach(async () => {
    localStorage.removeItem(STORAGE_KEY);

    bankServiceSpy = jasmine.createSpyObj<BankService>('BankService', ['indicadores']);
    bankServiceSpy.indicadores.and.returnValue(of(INDICADORES_VACIO));

    await TestBed.configureTestingModule({
      imports: [CommonModule],
      declarations: [BankDashboardCarouselComponent, BankIndicadoresPanelComponent],
      providers: [
        { provide: BankService, useValue: bankServiceSpy },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(BankDashboardCarouselComponent);
    component = fixture.componentInstance;

    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  });

  afterEach(() => {
    localStorage.removeItem(STORAGE_KEY);
  });

  it("arranca en el slide 'kpi' por default (sin nada en localStorage)", () => {
    expect(component.activeSlide).toBe('kpi');
    expect(bankServiceSpy.indicadores).not.toHaveBeenCalled();
  });

  it("cambiar a 'indicadores' dispara bankService.indicadores() una sola vez (fetch perezoso)", () => {
    expect(bankServiceSpy.indicadores).not.toHaveBeenCalled();

    component.selectSlide('indicadores');
    fixture.detectChanges();

    expect(component.activeSlide).toBe('indicadores');
    expect(bankServiceSpy.indicadores).toHaveBeenCalledTimes(1);
  });

  it('cambiar de slide y volver NO vuelve a llamar al servicio si los filtros no cambiaron (cacheado)', () => {
    component.selectSlide('indicadores');
    fixture.detectChanges();
    expect(bankServiceSpy.indicadores).toHaveBeenCalledTimes(1);

    component.selectSlide('kpi');
    fixture.detectChanges();
    component.selectSlide('indicadores');
    fixture.detectChanges();

    expect(bankServiceSpy.indicadores).toHaveBeenCalledTimes(1);
  });

  it('cambiar un filtro mientras el slide 2 está activo SÍ dispara una nueva llamada', () => {
    component.selectSlide('indicadores');
    fixture.detectChanges();
    expect(bankServiceSpy.indicadores).toHaveBeenCalledTimes(1);

    fixture.componentRef.setInput('banco', 'BBVA');
    fixture.detectChanges();

    expect(bankServiceSpy.indicadores).toHaveBeenCalledTimes(2);
    expect(bankServiceSpy.indicadores.calls.mostRecent().args[0]).toBe('BBVA');
  });

  it('cambiar un filtro mientras el slide 2 está INACTIVO no recarga hasta reactivarlo (stale)', () => {
    component.selectSlide('indicadores');
    fixture.detectChanges();
    expect(bankServiceSpy.indicadores).toHaveBeenCalledTimes(1);

    component.selectSlide('kpi');
    fixture.detectChanges();

    fixture.componentRef.setInput('categoria', 'Transferencia');
    fixture.detectChanges();
    // Todavía en 'kpi': el cambio se marca "stale", no dispara un fetch inmediato.
    expect(bankServiceSpy.indicadores).toHaveBeenCalledTimes(1);

    component.selectSlide('indicadores');
    fixture.detectChanges();
    // Al reactivar el slide 2 con filtros obsoletos, se recarga.
    expect(bankServiceSpy.indicadores).toHaveBeenCalledTimes(2);
  });

  it('la preferencia de slide se persiste en localStorage y se respeta al recrear el componente', () => {
    component.selectSlide('indicadores');
    fixture.detectChanges();

    expect(localStorage.getItem(STORAGE_KEY)).toBe('indicadores');

    const fixture2 = TestBed.createComponent(BankDashboardCarouselComponent);
    fixture2.detectChanges();

    expect(fixture2.componentInstance.activeSlide).toBe('indicadores');
  });
});
