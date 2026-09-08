import {
  Component, Input, Output, EventEmitter, ViewChild, ElementRef,
  HostListener, OnDestroy, AfterViewInit,
} from '@angular/core';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { DateRangePopoverCoordinatorService } from './date-range-popover-coordinator.service';

// date-range-popover.component.ts — calendario emergente de rango de fechas con
// botón trigger propio, arrastre y posicionamiento fixed. Extraído 2026-09-08 del
// calendario que vivía hardcodeado en banks.component (una única instancia
// compartida por "contexto") — ahora cada instancia gestiona su propio estado
// (mes/año, selección, drag), sin depender de un padre que le calcule la posición
// o reenvíe eventos de apertura (patrón que usaba report-panel vía `openCalendar`).
//
// API: [fechaInicio]/[fechaFin] (ISO yyyy-mm-dd, string vacío = sin filtro),
// (rangeChange) emite UNA sola vez `{fechaInicio, fechaFin}` tanto al completar una
// selección como al limpiar — nunca dos emits separados, para que un consumidor con
// un formulario reactivo pueda aplicar ambos valores en una sola actualización
// atómica (evita, por ejemplo, dos recargas separadas por un valueChanges que
// reaccione a cada campo por separado).
//
// CORRECCIÓN 2026-09-08 (bug real reportado por el usuario: el popup dejó de poder
// seleccionarse dentro de report-panel): `.report-sidebar` usa `transform:
// translateX(...)` para la animación de deslizamiento — un `transform` en cualquier
// ancestro crea un nuevo "containing block" para descendientes `position:fixed`, así
// que el popup (posicionado con coordenadas relativas al VIEWPORT vía
// getBoundingClientRect) terminaba renderizado relativo al sidebar transformado, en
// un lugar no visible/no clickeable. Fix: el popup se mueve a `document.body` en
// tiempo de ejecución (patrón "portal") — así queda inmune a cualquier ancestro con
// transform/overflow:hidden sin importar dónde se use el componente, en vez de
// depender de que el consumidor lo mantenga fuera de contenedores así.
@Component({
  standalone: false,
  selector: 'app-date-range-popover',
  templateUrl: './date-range-popover.component.html',
  styleUrls: ['./date-range-popover.component.css'],
})
export class DateRangePopoverComponent implements AfterViewInit, OnDestroy {
  @Input() fechaInicio = '';
  @Input() fechaFin    = '';
  @Input() placeholder = 'Rango de fechas';
  // 'compact' (default): botón de toolbar (filtro principal de Bancos, sync manual
  // de transferencias-caja). 'field': ancho completo, mismo look de campo de
  // formulario que usaba report-panel antes de migrar a este componente.
  @Input() variant: 'compact' | 'field' = 'compact';
  // 2026-09-08: agregado al migrar los usos de DateRangePickerComponent (flatpickr) —
  // los 4 consumidores originales (Traspasos/Compensaciones/CFDIs de Pólizas,
  // distribución de bank-indicadores-panel) lo usaban para deshabilitar el picker
  // mientras una operación está en curso (generando/exportando/descargando).
  @Input() disabled = false;

  @Output() rangeChange = new EventEmitter<{ fechaInicio: string; fechaFin: string }>();

  @ViewChild('triggerBtn') triggerBtnRef!: ElementRef<HTMLElement>;
  @ViewChild('popupEl') popupElRef!: ElementRef<HTMLElement>;

  visible = false;
  calPopupTop  = 0;
  calPopupLeft = 0;
  calYear  = new Date().getFullYear();
  calMonth = new Date().getMonth();
  calDaysArr: { iso: string; day: number; inMonth: boolean }[] = [];
  pickerStart: string | null = null;
  pickerEnd:   string | null = null;
  pickerHover: string | null = null;
  readonly CAL_MESES = ['Enero','Febrero','Marzo','Abril','Mayo','Junio',
                        'Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
  readonly CAL_DIAS  = ['Do','Lu','Ma','Mi','Ju','Vi','Sá'];

  // Drag del popup (arrastrar por el header)
  private calDragging    = false;
  private calDragMovedPx = 0; // píxeles movidos durante el drag actual
  private calDragOffX    = 0;
  private calDragOffY    = 0;

  private readonly _id = Symbol('date-range-popover');
  private readonly _destroy$ = new Subject<void>();

  constructor(private coordinator: DateRangePopoverCoordinatorService) {
    this.coordinator.opened$.pipe(takeUntil(this._destroy$)).subscribe((id) => {
      if (id !== this._id) this.visible = false;
    });
  }

  ngAfterViewInit(): void {
    // Portal: el nodo mantiene sus estilos scopeados de Angular (el atributo
    // _ngcontent-* viaja con el elemento), así que reubicarlo no rompe el CSS.
    document.body.appendChild(this.popupElRef.nativeElement);
  }

  ngOnDestroy(): void {
    this._destroy$.next();
    this._destroy$.complete();
    this.popupElRef?.nativeElement?.remove();
  }

  get calMonthLabel(): string {
    return `${this.CAL_MESES[this.calMonth]} ${this.calYear}`;
  }

  get label(): string {
    if (!this.fechaInicio && !this.fechaFin) return this.placeholder;
    const fmt = (s: string) => { const [y, m, d] = s.split('-'); return `${d}/${m}/${y}`; };
    if (this.fechaInicio && this.fechaFin) return `${fmt(this.fechaInicio)} – ${fmt(this.fechaFin)}`;
    return this.fechaInicio ? `Desde ${fmt(this.fechaInicio)}` : `Hasta ${fmt(this.fechaFin)}`;
  }

  toggle(event: Event): void {
    event.stopPropagation();
    if (this.disabled) return;
    if (this.visible) { this.visible = false; return; }

    this.coordinator.notifyOpened(this._id);

    const rect = this.triggerBtnRef.nativeElement.getBoundingClientRect();
    this.calPopupTop  = rect.bottom + 6;
    this.calPopupLeft = rect.left;

    if (this.fechaInicio) {
      const d = new Date(this.fechaInicio + 'T12:00:00');
      this.calYear  = d.getFullYear();
      this.calMonth = d.getMonth();
    } else {
      const now = new Date();
      this.calYear  = now.getFullYear();
      this.calMonth = now.getMonth();
    }
    this.pickerStart = this.fechaInicio || null;
    this.pickerEnd   = this.fechaFin    || null;
    this.pickerHover = null;
    this.buildCalDays();
    this.visible = true;
  }

  buildCalDays(): void {
    const arr: { iso: string; day: number; inMonth: boolean }[] = [];
    const firstDow = new Date(this.calYear, this.calMonth, 1).getDay();
    for (let i = firstDow - 1; i >= 0; i--) {
      const d = new Date(this.calYear, this.calMonth, -i);
      arr.push({ iso: this.isoDate(d), day: d.getDate(), inMonth: false });
    }
    const lastDay = new Date(this.calYear, this.calMonth + 1, 0).getDate();
    for (let d = 1; d <= lastDay; d++) {
      arr.push({ iso: this.isoDate(new Date(this.calYear, this.calMonth, d)), day: d, inMonth: true });
    }
    const trailing = 42 - arr.length;
    for (let d = 1; d <= trailing; d++) {
      arr.push({ iso: this.isoDate(new Date(this.calYear, this.calMonth + 1, d)), day: d, inMonth: false });
    }
    this.calDaysArr = arr;
  }

  private isoDate(d: Date): string {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  calPrev(): void {
    if (this.calMonth === 0) { this.calYear--; this.calMonth = 11; }
    else { this.calMonth--; }
    this.buildCalDays();
  }

  calNext(): void {
    if (this.calMonth === 11) { this.calYear++; this.calMonth = 0; }
    else { this.calMonth++; }
    this.buildCalDays();
  }

  onCalClick(iso: string): void {
    if (!this.pickerStart || this.pickerEnd) {
      this.pickerStart = iso;
      this.pickerEnd   = null;
      this.pickerHover = null;
    } else {
      const [s, e] = iso >= this.pickerStart
        ? [this.pickerStart, iso]
        : [iso, this.pickerStart];
      this.pickerStart = s;
      this.pickerEnd   = e;
      this.pickerHover = null;
      this.visible = false;
      this.rangeChange.emit({ fechaInicio: s, fechaFin: e });
    }
  }

  onCalHover(iso: string): void {
    if (this.pickerStart && !this.pickerEnd) this.pickerHover = iso;
  }

  private calRange(): [string | null, string | null] {
    if (this.pickerEnd) return [this.pickerStart, this.pickerEnd];
    if (this.pickerStart && this.pickerHover) {
      return this.pickerStart <= this.pickerHover
        ? [this.pickerStart, this.pickerHover]
        : [this.pickerHover, this.pickerStart];
    }
    return [this.pickerStart, null];
  }

  isDayStart(iso: string): boolean   { return iso === this.calRange()[0]; }
  isDayEnd(iso: string): boolean     { return iso === this.calRange()[1]; }
  isDayInRange(iso: string): boolean {
    const [s, e] = this.calRange();
    return !!(s && e && iso > s && iso < e);
  }
  isDayToday(iso: string): boolean {
    return iso === this.isoDate(new Date());
  }

  clear(event?: Event): void {
    event?.stopPropagation();
    this.pickerStart = null;
    this.pickerEnd   = null;
    this.visible     = false;
    this.rangeChange.emit({ fechaInicio: '', fechaFin: '' });
  }

  onCalDragStart(event: MouseEvent): void {
    if (event.button !== 0) return;
    this.calDragging    = true;
    this.calDragMovedPx = 0;
    this.calDragOffX    = event.clientX - this.calPopupLeft;
    this.calDragOffY    = event.clientY - this.calPopupTop;
    event.preventDefault();
    event.stopPropagation();
  }

  @HostListener('document:click')
  onDocumentClick(): void {
    if (this.calDragMovedPx > 4) { this.calDragMovedPx = 0; return; }
    this.visible = false;
  }

  @HostListener('document:mousemove', ['$event'])
  onDocumentMouseMove(event: MouseEvent): void {
    if (!this.calDragging) return;
    const newLeft = event.clientX - this.calDragOffX;
    const newTop  = event.clientY - this.calDragOffY;
    this.calPopupLeft = Math.max(0, Math.min(newLeft, window.innerWidth  - 260));
    this.calPopupTop  = Math.max(0, Math.min(newTop,  window.innerHeight - 100));
    this.calDragMovedPx += Math.abs(event.movementX) + Math.abs(event.movementY);
  }

  @HostListener('document:mouseup')
  onDocumentMouseUp(): void {
    this.calDragging = false;
  }
}
