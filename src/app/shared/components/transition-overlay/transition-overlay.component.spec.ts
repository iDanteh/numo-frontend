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
  });

  it('renders the hand-rolled SVG ledger variant when the service plays "to-numo" (different code path than "to-lealtad")', () => {
    service.play('to-numo');
    fixture.detectChanges();

    const overlay = fixture.nativeElement.querySelector('.transition-overlay');
    expect(overlay).not.toBeNull();
    expect(overlay.querySelector('.transition-overlay__ledger-svg')).not.toBeNull();
    expect(overlay.querySelector('.transition-overlay__maestro')).toBeNull();
  });

  it('onAnimationEnd() calls back into the service to resolve the pending play() promise', async () => {
    const played = service.play('to-lealtad');
    fixture.detectChanges();

    component.onAnimationEnd();
    fixture.detectChanges();

    await played; // rejects the test (timeout) if complete() was never called
    expect(fixture.nativeElement.querySelector('.transition-overlay')).toBeNull();
  });
});
