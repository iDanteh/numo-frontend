import { TestBed, ComponentFixture } from '@angular/core/testing';
import { NO_ERRORS_SCHEMA } from '@angular/core';
import { NipRevealModalComponent } from './nip-reveal-modal.component';

/**
 * RED (PR6, task 6.10-6.11) — "el NIP se muestra UNA vez, nunca más tras
 * cerrar" (spec loyalty-cards "Previous NIP is never exposed" + design.md
 * D6). No hay persistencia ni servicio: es presentacional puro, el padre es
 * quien ya tiene el {nombre, nip} de la respuesta de crear/cambiarNip.
 */
describe('NipRevealModalComponent — template real (TestBed)', () => {
  let fixture: ComponentFixture<NipRevealModalComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      declarations: [NipRevealModalComponent],
      schemas: [NO_ERRORS_SCHEMA],
    }).compileComponents();
    fixture = TestBed.createComponent(NipRevealModalComponent);
  });

  it('shows the plaintext NIP and the card holder name exactly once', () => {
    fixture.componentInstance.nombre = 'Juan Pérez';
    fixture.componentInstance.nip = '4821';
    fixture.detectChanges();
    const text = fixture.nativeElement.textContent as string;
    expect(text).toContain('4821');
    expect(text).toContain('Juan Pérez');
  });

  it('emits closed and never re-shows the NIP after the close button is clicked', () => {
    fixture.componentInstance.nombre = 'Juan Pérez';
    fixture.componentInstance.nip = '4821';
    fixture.detectChanges();
    let emitted = false;
    fixture.componentInstance.closed.subscribe(() => emitted = true);
    const btn: HTMLButtonElement = fixture.nativeElement.querySelector('[data-testid="nip-reveal-close"]');
    btn.click();
    expect(emitted).toBe(true);
  });
});
