import { Component, OnDestroy, OnInit } from '@angular/core';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { TransitionOverlayService, TransitionVariant } from './transition-overlay.service';

/**
 * Montado UNA sola vez en app.component.html (dentro de SharedModule) para
 * que sobreviva al swap de rutas entre el shell de Numo y el de Lealtad —
 * si viviera dentro de cada shell, se destruiría a mitad de la navegación
 * (spec "Transition Overlay Animations").
 */
@Component({
  standalone: false,
  selector: 'app-transition-overlay',
  templateUrl: './transition-overlay.component.html',
  styleUrls: ['./transition-overlay.component.css'],
})
export class TransitionOverlayComponent implements OnInit, OnDestroy {
  variant: TransitionVariant | null = null;

  private readonly destroy$ = new Subject<void>();

  constructor(private readonly overlay: TransitionOverlayService) {}

  ngOnInit(): void {
    this.overlay.variant$
      .pipe(takeUntil(this.destroy$))
      .subscribe(v => (this.variant = v));
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  /** Disparado por (animationend) / (transitionend) del template al terminar. */
  onAnimationEnd(): void {
    this.overlay.complete();
  }
}
