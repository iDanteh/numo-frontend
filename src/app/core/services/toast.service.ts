import { Injectable } from '@angular/core';
import { Subject } from 'rxjs';

export type ToastType = 'success' | 'error' | 'warning' | 'info';

export interface Toast {
  message: string;
  type: ToastType;
  duration: number;
}

/**
 * Aviso fijo (2026-11-24): va en la misma pila que los toasts (no se enciman),
 * no se quita solo — solo con la ✕ o con `cerrarFijo`. `girando` = reloj de
 * arena girando mientras algo se está calculando.
 */
export interface AvisoFijo {
  accion: 'mostrar' | 'actualizar' | 'cerrar';
  clave: string;
  message?: string;
  girando?: boolean;
}

@Injectable({ providedIn: 'root' })
export class ToastService {
  private subject = new Subject<Toast>();
  readonly toast$ = this.subject.asObservable();
  private fijoSubject = new Subject<AvisoFijo>();
  readonly fijo$ = this.fijoSubject.asObservable();

  /** Muestra (o vuelve a mostrar, como el más nuevo) un aviso fijo. */
  mostrarFijo(clave: string, message: string, girando = false): void {
    this.fijoSubject.next({ accion: 'mostrar', clave, message, girando });
  }

  /** Cambia el reloj de arena de un aviso fijo si sigue en pantalla (si ya lo cerraron, nada). */
  girarFijo(clave: string, girando: boolean): void {
    this.fijoSubject.next({ accion: 'actualizar', clave, girando });
  }

  cerrarFijo(clave: string): void {
    this.fijoSubject.next({ accion: 'cerrar', clave });
  }

  success(message: string, duration = 3200): void {
    this.subject.next({ message, type: 'success', duration });
  }

  error(message: string, duration = 4500): void {
    this.subject.next({ message, type: 'error', duration });
  }

  warning(message: string, duration = 4000): void {
    this.subject.next({ message, type: 'warning', duration });
  }

  info(message: string, duration = 3000): void {
    this.subject.next({ message, type: 'info', duration });
  }
}
