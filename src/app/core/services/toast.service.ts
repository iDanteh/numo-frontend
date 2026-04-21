import { Injectable } from '@angular/core';
import { Subject } from 'rxjs';

export type ToastType = 'success' | 'error' | 'warning' | 'info';

export interface Toast {
  message: string;
  type: ToastType;
  duration: number;
}

@Injectable({ providedIn: 'root' })
export class ToastService {
  private subject = new Subject<Toast>();
  readonly toast$ = this.subject.asObservable();

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
