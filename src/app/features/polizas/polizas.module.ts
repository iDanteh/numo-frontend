import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { SharedModule } from '../../shared/shared.module';

import { PolizaListComponent } from './poliza-list.component';
import { PolizaTraspasosComponent } from './poliza-traspasos.component';
import { PolizaCompensacionesInteresesComponent } from './poliza-compensaciones-intereses.component';
import { PolizaTablaComponent } from './poliza-tabla.component';

@NgModule({
  declarations: [
    // 2026-09-08: DateRangePickerComponent (flatpickr) se eliminó por completo —
    // migrado a DateRangePopoverComponent (shared/components/date-range-popover/,
    // vía SharedModule de abajo), que no depende de ninguna librería externa.
    // 2026-09-07: ConfirmModalComponent se promovió a shared/components (ahora lo
    // reusa también report-panel en features/banks) — ya no se declara acá, llega
    // vía SharedModule de abajo.
    PolizaListComponent, PolizaTraspasosComponent,
    PolizaCompensacionesInteresesComponent, PolizaTablaComponent,
  ],
  imports: [
    CommonModule,
    ReactiveFormsModule,
    FormsModule,
    SharedModule,
    RouterModule.forChild([
      { path: '',                       component: PolizaListComponent,     data: { vista: 'ingreso' } },
      { path: 'cobranza',               component: PolizaListComponent,     data: { vista: 'cobranza' } },
      { path: 'traspasos-cp',           component: PolizaTraspasosComponent },
      { path: 'compensaciones-intereses', component: PolizaCompensacionesInteresesComponent },
    ]),
  ],
})
export class PolizasModule {}
