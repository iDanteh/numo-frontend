import { TestBed } from '@angular/core/testing';
import { CommonModule } from '@angular/common';

import { DateRangePopoverComponent } from './date-range-popover.component';
import { DateRangePopoverCoordinatorService } from './date-range-popover-coordinator.service';

describe('DateRangePopoverComponent — calendario emergente reutilizable (TestBed, Chrome real vía Karma)', () => {
  let component: DateRangePopoverComponent;
  let fixture: import('@angular/core/testing').ComponentFixture<DateRangePopoverComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [CommonModule],
      declarations: [DateRangePopoverComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(DateRangePopoverComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('sin fechas: el botón muestra el placeholder', () => {
    expect(component.label).toBe('Rango de fechas');
  });

  it('variant por defecto es "compact"', () => {
    expect(component.variant).toBe('compact');
  });

  it('disabled: toggle() no abre el popup', () => {
    component.disabled = true;
    component.toggle(new MouseEvent('click'));
    expect(component.visible).toBe(false);
  });

  it('placeholder personalizado (ej. report-panel: "Cualquier fecha")', () => {
    component.placeholder = 'Cualquier fecha';
    expect(component.label).toBe('Cualquier fecha');
  });

  it('con fechaInicio y fechaFin: label formateado dd/mm/yyyy con guion', () => {
    component.fechaInicio = '2026-09-04';
    component.fechaFin    = '2026-09-08';
    expect(component.label).toBe('04/09/2026 – 08/09/2026');
  });

  it('toggle(): abre el popup, precarga pickerStart/pickerEnd desde los @Input actuales', () => {
    component.fechaInicio = '2026-09-04';
    component.fechaFin    = '2026-09-08';
    component.toggle(new MouseEvent('click'));

    expect(component.visible).toBe(true);
    expect(component.pickerStart).toBe('2026-09-04');
    expect(component.pickerEnd).toBe('2026-09-08');
    expect(component.calYear).toBe(2026);
    expect(component.calMonth).toBe(8); // septiembre = índice 8
  });

  it('toggle(): un segundo toggle sobre el mismo popup lo cierra', () => {
    component.toggle(new MouseEvent('click'));
    expect(component.visible).toBe(true);
    component.toggle(new MouseEvent('click'));
    expect(component.visible).toBe(false);
  });

  it('onCalClick(): completar un rango emite rangeChange UNA sola vez y cierra el popup', () => {
    const spy = spyOn(component.rangeChange, 'emit');
    component.toggle(new MouseEvent('click'));

    component.onCalClick('2026-09-04');
    expect(component.pickerStart).toBe('2026-09-04');
    expect(spy).not.toHaveBeenCalled(); // primer click: arranca el rango, todavía no emite

    component.onCalClick('2026-09-08');
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith({ fechaInicio: '2026-09-04', fechaFin: '2026-09-08' });
    expect(component.visible).toBe(false);
  });

  it('onCalClick(): fechas en orden invertido se normalizan (menor primero)', () => {
    const spy = spyOn(component.rangeChange, 'emit');
    component.toggle(new MouseEvent('click'));

    component.onCalClick('2026-09-08');
    component.onCalClick('2026-09-04');

    expect(spy).toHaveBeenCalledWith({ fechaInicio: '2026-09-04', fechaFin: '2026-09-08' });
  });

  it('clear(): emite rangeChange con ambos campos vacíos y cierra el popup', () => {
    const spy = spyOn(component.rangeChange, 'emit');
    component.fechaInicio = '2026-09-04';
    component.fechaFin    = '2026-09-08';
    component.toggle(new MouseEvent('click'));

    component.clear();

    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith({ fechaInicio: '', fechaFin: '' });
    expect(component.visible).toBe(false);
  });

  it('buildCalDays(): septiembre 2026 arranca en martes — 2 días de agosto de relleno inicial', () => {
    component.calYear  = 2026;
    component.calMonth = 8; // septiembre
    component.buildCalDays();

    expect(component.calDaysArr[0].inMonth).toBe(false);
    expect(component.calDaysArr.length).toBe(42);
    const primerDiaDelMes = component.calDaysArr.find(d => d.inMonth && d.day === 1);
    expect(primerDiaDelMes?.iso).toBe('2026-09-01');
  });

  it('calPrev()/calNext() navegan meses y envuelven el año correctamente', () => {
    component.calYear = 2026; component.calMonth = 0; // enero
    component.calPrev();
    expect(component.calYear).toBe(2025);
    expect(component.calMonth).toBe(11);

    component.calNext();
    expect(component.calYear).toBe(2026);
    expect(component.calMonth).toBe(0);
  });

  it('coordinador: abrir un segundo popover cierra el primero (solo uno abierto a la vez)', () => {
    const coordinator = TestBed.inject(DateRangePopoverCoordinatorService);
    const fixture2 = TestBed.createComponent(DateRangePopoverComponent);
    const component2 = fixture2.componentInstance;
    fixture2.detectChanges();

    component.toggle(new MouseEvent('click'));
    expect(component.visible).toBe(true);

    component2.toggle(new MouseEvent('click'));
    expect(component2.visible).toBe(true);
    expect(component.visible).toBe(false); // el primero se cerró solo

    void coordinator; // referenciado solo para que TestBed.inject no quede sin uso
  });

  it('onDocumentClick(): si se arrastró más de 4px, suprime el cierre y resetea el contador', () => {
    (component as any).calDragMovedPx = 10;
    component.visible = true;

    component.onDocumentClick();

    expect(component.visible).toBe(true);
    expect((component as any).calDragMovedPx).toBe(0);
  });

  it('onDocumentClick(): sin arrastre previo, cierra el popup', () => {
    component.visible = true;
    component.onDocumentClick();
    expect(component.visible).toBe(false);
  });
});
