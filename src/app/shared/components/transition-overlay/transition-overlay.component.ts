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

  /**
   * Disparado por (animationend) del template al terminar. `animationend`
   * burbujea: en la variante `to-numo` hay 3 animaciones corriendo en
   * paralelo (las `.ledger-line`, el fade del `.ledger-svg` y el
   * `.ledger-check`) y cada una dispara su propio evento al terminar. Si no
   * filtráramos por el elemento real, el primero en terminar (las
   * `.ledger-line`, a los 0.65s) cerraría el overlay antes de que el
   * `.ledger-check` (el que termina último, a los 1.0s) hubiera dibujado la
   * palomita completa — la transición se vería cortada. Solo el animationend
   * del elemento que termina ÚLTIMO en cada variante debe completar.
   */
  onAnimationEnd(event: AnimationEvent): void {
    const target = event.target as HTMLElement | null;
    const finalElementClass =
      this.variant === 'to-numo'
        ? 'transition-overlay__ledger-check'
        : 'transition-overlay__maestro';

    if (!target || !target.classList.contains(finalElementClass)) {
      return;
    }

    this.overlay.complete();
  }
}
