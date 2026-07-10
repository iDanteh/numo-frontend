import { Component, ElementRef, EventEmitter, Input, OnChanges, OnDestroy, Output, SimpleChanges, ViewChild } from '@angular/core';
import flatpickr from 'flatpickr';
import { Spanish } from 'flatpickr/dist/l10n/es.js';
import type { Instance as FlatpickrInstance } from 'flatpickr/dist/types/instance';

// Selector de rango de fechas en un solo calendario visual (flatpickr,
// mode: 'range') — reemplaza los dos <input type="date"> sueltos que se
// usaban antes para "Desde"/"Hasta". Expone fechaInicio/fechaFin como
// strings 'YYYY-MM-DD' con banana-in-a-box ([(fechaInicio)], [(fechaFin)])
// para no tener que tocar la lógica que ya consume esas dos propiedades.
@Component({
  standalone: false,
  selector: 'app-date-range-picker',
  template: `<input #input type="text" class="form-control form-control-sm date-range-picker-input" readonly
                     [disabled]="disabled" placeholder="Rango de fechas (vacío = mes completo)" style="width:230px;">`,
})
export class DateRangePickerComponent implements OnChanges, OnDestroy {
  @Input() fechaInicio = '';
  @Output() fechaInicioChange = new EventEmitter<string>();
  @Input() fechaFin = '';
  @Output() fechaFinChange = new EventEmitter<string>();
  @Input() disabled = false;

  @ViewChild('input', { static: true }) inputEl!: ElementRef<HTMLInputElement>;

  private fp?: FlatpickrInstance;
  // Evita el loop: mientras se está reflejando una selección que vino DEL
  // propio flatpickr hacia fechaInicio/fechaFin, no queremos que el
  // ngOnChanges disparado por ese mismo cambio le vuelva a hacer setDate()
  // al picker (eso reiniciaba la selección a medio hacer).
  private actualizandoDesdePicker = false;

  ngOnChanges(changes: SimpleChanges): void {
    if (!this.fp) {
      this.fp = flatpickr(this.inputEl.nativeElement, {
        mode: 'range',
        dateFormat: 'Y-m-d',
        altInput: true,
        altFormat: 'd M Y',
        locale: Spanish,
        onChange: (selectedDates) => this.onFlatpickrChange(selectedDates),
      }) as FlatpickrInstance;
    }

    if (changes['disabled']) {
      this.fp.set('clickOpens', !this.disabled);
    }

    if (this.actualizandoDesdePicker) return;

    // Reflejar cambios externos (ej. el padre limpia el rango tras generar)
    // sin disparar de vuelta onChange.
    if (changes['fechaInicio'] || changes['fechaFin']) {
      const actuales = this.fp.selectedDates.map(d => this.fmt(d)).join(',');
      const nuevas   = [this.fechaInicio, this.fechaFin].filter(Boolean).join(',');
      if (actuales !== nuevas) {
        this.fp.setDate([this.fechaInicio, this.fechaFin].filter(Boolean), false);
      }
    }
  }

  private onFlatpickrChange(selectedDates: Date[]): void {
    // En mode:'range', onChange dispara también tras el PRIMER clic (un solo
    // día seleccionado, rango a medio hacer) — hay que esperar a que el
    // usuario elija el segundo día (o el mismo día otra vez, para un rango de
    // 1 día) antes de emitir nada, si no se corta la selección a la mitad.
    if (selectedDates.length < 2) return;

    const inicio = this.fmt(selectedDates[0]);
    const fin    = this.fmt(selectedDates[1]);

    this.actualizandoDesdePicker = true;
    if (inicio !== this.fechaInicio) { this.fechaInicio = inicio; this.fechaInicioChange.emit(inicio); }
    if (fin    !== this.fechaFin)    { this.fechaFin    = fin;    this.fechaFinChange.emit(fin); }
    this.actualizandoDesdePicker = false;
  }

  private fmt(d: Date): string {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${dd}`;
  }

  ngOnDestroy(): void {
    this.fp?.destroy();
  }
}
