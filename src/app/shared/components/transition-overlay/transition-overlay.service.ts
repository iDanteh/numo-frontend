import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';

/**
 * 'to-lealtad'  → CSS-only MaestroBetoGrande keyframes (Numo → Lealtad).
 * 'to-numo'     → hand-rolled inline SVG ledger/checkmark animation (Lealtad → Numo).
 * No new animation library (no @angular/animations, Lottie, GSAP, Rive — spec
 * "Transition Overlay Animations").
 */
export type TransitionVariant = 'to-lealtad' | 'to-numo';

@Injectable({ providedIn: 'root' })
export class TransitionOverlayService {
  private readonly _variant$ = new BehaviorSubject<TransitionVariant | null>(null);
  readonly variant$ = this._variant$.asObservable();

  private resolveFn: (() => void) | null = null;

  /**
   * Arranca la animación y resuelve cuando TransitionOverlayComponent avisa
   * que terminó (ver complete()). Si el usuario pide prefers-reduced-motion,
   * resuelve de inmediato sin mostrar nada — nunca bloquea la navegación del
   * space-switcher por una animación que el usuario pidió explícitamente
   * no ver.
   */
  play(variant: TransitionVariant): Promise<void> {
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      return Promise.resolve();
    }
    return new Promise<void>(resolve => {
      this.resolveFn = resolve;
      this._variant$.next(variant);
    });
  }

  /** Llamado por TransitionOverlayComponent cuando su animación termina. */
  complete(): void {
    this._variant$.next(null);
    const resolve = this.resolveFn;
    this.resolveFn = null;
    resolve?.();
  }
}
