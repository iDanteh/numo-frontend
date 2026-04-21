import { Component, OnDestroy, OnInit } from '@angular/core';
import { Subscription } from 'rxjs';
import { Toast, ToastService } from '../../../core/services/toast.service';

interface ToastItem extends Toast {
  id: number;
  leaving: boolean;
}

@Component({
  standalone: false,
  selector: 'app-toast',
  templateUrl: './toast.component.html',
})
export class ToastComponent implements OnInit, OnDestroy {
  items: ToastItem[] = [];
  private sub?: Subscription;
  private nextId = 0;

  constructor(private toastService: ToastService) {}

  ngOnInit(): void {
    this.sub = this.toastService.toast$.subscribe(t => this.add(t));
  }

  ngOnDestroy(): void {
    this.sub?.unsubscribe();
  }

  add(toast: Toast): void {
    const id = ++this.nextId;
    const item: ToastItem = { ...toast, id, leaving: false };
    this.items.push(item);
    setTimeout(() => this.dismiss(id), toast.duration);
  }

  dismiss(id: number): void {
    const item = this.items.find(t => t.id === id);
    if (!item || item.leaving) return;
    item.leaving = true;
    setTimeout(() => { this.items = this.items.filter(t => t.id !== id); }, 320);
  }

  icon(type: Toast['type']): string {
    return { success: '✓', error: '✕', warning: '⚠', info: 'ℹ' }[type];
  }
}
