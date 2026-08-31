import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { DateRangePickerComponent } from './date-range-picker.component';

// Módulo chico y dedicado (NO parte de SharedModule) a propósito: SharedModule lo
// importa AppModule de forma EAGER (raíz) — declarar acá DateRangePickerComponent
// metería flatpickr en el bundle inicial para TODOS los usuarios, no solo quien entra
// a Bancos o Pólizas (los 2 módulos lazy que hoy lo usan). Cada módulo lazy que lo
// necesite importa ESTE módulo chico directamente, así flatpickr solo se descarga
// cuando de verdad hace falta.
@NgModule({
  declarations: [DateRangePickerComponent],
  imports:      [CommonModule],
  exports:      [DateRangePickerComponent],
})
export class DateRangePickerModule {}
