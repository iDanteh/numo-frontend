import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';

/**
 * 'to-lealtad'  → CSS-only MaestroBetoGrande keyframes (Numo → Lealtad).
 * 'to-numo'     → hand-rolled inline SVG ledger/checkmark animation (Lealtad → Numo).
 * 'to-kiosco'   → logo del Kiosco de facturación con el mismo "pop" que Lealtad (Numo → Kiosco,
 *                 otra aplicación). Se queda puesto hasta que el navegador cambia de página
 *                 (`mantener`): el panel del kiosco abre con el mismo telón y no se ve un corte.
 * No new animation library (no @angular/animations, Lottie, GSAP, Rive — spec
 * "Transition Overlay Animations").
 */
export type TransitionVariant = 'to-lealtad' | 'to-numo' | 'to-kiosco';

@Injectable({ providedIn: 'root' })
export class TransitionOverlayService {
  private readonly _variant$ = new BehaviorSubject<TransitionVariant | null>(null);
  readonly variant$ = this._variant$.asObservable();

  private resolveFn: (() => void) | null = null;
  /** La animación terminó pero el telón se queda (ver play(…, { mantener })). */
  private mantener = false;

  /**
   * Arranca la animación y resuelve cuando TransitionOverlayComponent avisa
   * que terminó (ver complete()). Si el usuario pide prefers-reduced-motion,
   * resuelve de inmediato sin mostrar nada — nunca bloquea la navegación del
   * space-switcher por una animación que el usuario pidió explícitamente
   * no ver.
   */
  play(variant: TransitionVariant, opciones: { mantener?: boolean } = {}): Promise<void> {
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      return Promise.resolve();
    }
    this.mantener = !!opciones.mantener;
    return new Promise<void>(resolve => {
      this.resolveFn = resolve;
      this._variant$.next(variant);
    });
  }

  /**
   * Llamado por TransitionOverlayComponent cuando su animación termina. Con `mantener`
   * resuelve pero deja el telón: quien lo pidió se va a otra página o llama cerrar().
   */
  complete(): void {
    if (!this.mantener) this._variant$.next(null);
    const resolve = this.resolveFn;
    this.resolveFn = null;
    resolve?.();
  }

  /** Quita el telón que se dejó puesto con `mantener` (p. ej. si no se pudo salir de NUMO). */
  cerrar(): void {
    this.mantener = false;
    this._variant$.next(null);
  }
}
