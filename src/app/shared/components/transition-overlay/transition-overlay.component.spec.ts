import { ComponentFixture, TestBed } from '@angular/core/testing';
import { CommonModule } from '@angular/common';
import { TransitionOverlayComponent } from './transition-overlay.component';
import { TransitionOverlayService } from './transition-overlay.service';

describe('TransitionOverlayComponent', () => {
  let fixture: ComponentFixture<TransitionOverlayComponent>;
  let component: TransitionOverlayComponent;
  let service: TransitionOverlayService;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [CommonModule],
      declarations: [TransitionOverlayComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(TransitionOverlayComponent);
    component = fixture.componentInstance;
    service = TestBed.inject(TransitionOverlayService);
    fixture.detectChanges();
  });

  it('renders nothing when no transition is in progress', () => {
    expect(fixture.nativeElement.querySelector('.transition-overlay')).toBeNull();
  });

  it('renders the MaestroBetoGrande CSS variant when the service plays "to-lealtad"', () => {
    service.play('to-lealtad');
    fixture.detectChanges();

    const overlay = fixture.nativeElement.querySelector('.transition-overlay');
    expect(overlay).not.toBeNull();
    expect(overlay.querySelector('.transition-overlay__maestro')).not.toBeNull();
    expect(overlay.querySelector('.transition-overlay__ledger-svg')).toBeNull();

    // Halo radial pulsante (sistema-lealtad) — también presente en to-numo
    // (ver test de abajo), y SIN la clase transition-overlay__maestro (no
    // debe poder disparar el filtro de onAnimationEnd() como si fuera el
    // maestro).
    const halo = overlay.querySelector('.transition-overlay__halo');
    expect(halo).not.toBeNull();
    expect(halo.classList.contains('transition-overlay__maestro')).toBe(false);
    // to-lealtad usa el ámbar por default, nunca el modificador azul de to-numo.
    expect(halo.classList.contains('transition-overlay__halo--blue')).toBe(false);
  });

  it('shows the "Entrando a Lealtad..." caption for "to-lealtad"', () => {
    service.play('to-lealtad');
    fixture.detectChanges();

    const caption = fixture.nativeElement.querySelector('.transition-overlay__caption');
    expect(caption).not.toBeNull();
    expect(caption.textContent.trim()).toBe('Entrando a Lealtad...');
  });

  it('shows the "Volviendo a NUMO..." caption for "to-numo"', () => {
    service.play('to-numo');
    fixture.detectChanges();

    const caption = fixture.nativeElement.querySelector('.transition-overlay__caption');
    expect(caption).not.toBeNull();
    expect(caption.textContent.trim()).toBe('Volviendo a NUMO...');
  });

  it('renders the hand-rolled SVG ledger variant when the service plays "to-numo" (different code path than "to-lealtad")', () => {
    service.play('to-numo');
    fixture.detectChanges();

    const overlay = fixture.nativeElement.querySelector('.transition-overlay');
    expect(overlay).not.toBeNull();
    expect(overlay.querySelector('.transition-overlay__ledger-svg')).not.toBeNull();
    expect(overlay.querySelector('.transition-overlay__maestro')).toBeNull();

    // Halo radial pulsante — también presente en to-numo, detrás del ledger
    // SVG, y SIN ninguna de las dos clases que onAnimationEnd() usa como
    // filtro de "elemento final" (transition-overlay__maestro /
    // transition-overlay__ledger-check), para no poder disparar ese filtro.
    const halo = overlay.querySelector('.transition-overlay__halo');
    expect(halo).not.toBeNull();
    expect(halo.classList.contains('transition-overlay__maestro')).toBe(false);
    expect(halo.classList.contains('transition-overlay__ledger-check')).toBe(false);
    // to-numo pisa el color por default (ámbar) con el modificador azul.
    expect(halo.classList.contains('transition-overlay__halo--blue')).toBe(true);
  });

  function animationEndFrom(className: string): AnimationEvent {
    const target = document.createElement('div');
    target.className = className;
    return { target } as unknown as AnimationEvent;
  }

  it('onAnimationEnd() calls back into the service to resolve the pending play() promise ("to-lealtad")', async () => {
    const played = service.play('to-lealtad');
    fixture.detectChanges();

    component.onAnimationEnd(animationEndFrom('transition-overlay__maestro'));
    fixture.detectChanges();

    await played; // rejects the test (timeout) if complete() was never called
    expect(fixture.nativeElement.querySelector('.transition-overlay')).toBeNull();
  });

  it('onAnimationEnd() ignores a bubbled animationend from an earlier-finishing element in "to-numo" (regression: used to close the overlay before the checkmark finished drawing)', () => {
    service.play('to-numo');
    fixture.detectChanges();

    // Las .ledger-line terminan a los 0.65s, antes que .ledger-check (1.0s) —
    // su animationend burbujea hasta el contenedor y no debe cerrar el overlay.
    component.onAnimationEnd(animationEndFrom('transition-overlay__ledger-line'));
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.transition-overlay')).not.toBeNull();
  });

  it('onAnimationEnd() completes "to-numo" only when the ledger-check (last to finish) fires', async () => {
    const played = service.play('to-numo');
    fixture.detectChanges();

    component.onAnimationEnd(animationEndFrom('transition-overlay__ledger-check'));
    fixture.detectChanges();

    await played;
    expect(fixture.nativeElement.querySelector('.transition-overlay')).toBeNull();
  });
});
