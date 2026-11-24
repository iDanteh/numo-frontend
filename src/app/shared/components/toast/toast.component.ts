import { Component, OnDestroy, OnInit } from '@angular/core';
import { Subscription } from 'rxjs';
import { AvisoFijo, Toast, ToastService } from '../../../core/services/toast.service';

interface ToastItem {
  id: number;
  message: string;
  type: Toast['type'] | 'aviso';
  leaving: boolean;
  /** Aviso fijo (2026-11-24): no se quita solo ni al hacer clic, solo con la ✕. */
  clave?: string;
  girando?: boolean;
}

/**
 * Pila de avisos abajo a la derecha (2026-11-24): el más nuevo sale abajo y
 * empuja hacia arriba a los anteriores; al quitarse uno, los de arriba bajan
 * (se encoge antes de desaparecer, sin brincos). Los avisos fijos de las
 * pantallas (p. ej. "el reporte puede tardar") van en esta misma pila.
 */
@Component({
  standalone: false,
  selector: 'app-toast',
  templateUrl: './toast.component.html',
})
export class ToastComponent implements OnInit, OnDestroy {
  items: ToastItem[] = [];
  private subs: Subscription[] = [];
  private nextId = 0;

  constructor(private toastService: ToastService) {}

  ngOnInit(): void {
    this.subs.push(this.toastService.toast$.subscribe(t => this.add(t)));
    this.subs.push(this.toastService.fijo$.subscribe(f => this.fijo(f)));
  }

  ngOnDestroy(): void {
    this.subs.forEach(s => s.unsubscribe());
  }

  add(toast: Toast): void {
    const id = ++this.nextId;
    this.items.push({ id, message: toast.message, type: toast.type, leaving: false });
    setTimeout(() => this.dismiss(id), toast.duration);
  }

  private fijo(f: AvisoFijo): void {
    const actual = this.items.find(t => t.clave === f.clave && !t.leaving);
    if (f.accion === 'cerrar') { if (actual) this.dismiss(actual.id); return; }
    if (f.accion === 'actualizar') { if (actual) actual.girando = !!f.girando; return; }
    // mostrar: si ya está, se quita y sale de nuevo abajo como el más nuevo.
    if (actual) this.items = this.items.filter(t => t.id !== actual.id);
    this.items.push({ id: ++this.nextId, message: f.message ?? '', type: 'aviso', leaving: false, clave: f.clave, girando: !!f.girando });
  }

  /** Clic en el aviso: los normales se quitan; los fijos solo con la ✕. */
  clic(t: ToastItem): void {
    if (!t.clave) this.dismiss(t.id);
  }

  dismiss(id: number): void {
    const item = this.items.find(t => t.id === id);
    if (!item || item.leaving) return;
    item.leaving = true;
    setTimeout(() => { this.items = this.items.filter(t => t.id !== id); }, 320);
  }

  icon(type: ToastItem['type']): string {
    return { success: '✓', error: '✕', warning: '⚠', info: 'ℹ', aviso: '⏳' }[type];
  }

  trackId(_: number, t: ToastItem): number {
    return t.id;
  }
}
