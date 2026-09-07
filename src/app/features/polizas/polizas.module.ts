import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { DateRangePickerModule } from '../../shared/components/date-range-picker/date-range-picker.module';
import { SharedModule } from '../../shared/shared.module';

import { PolizaListComponent } from './poliza-list.component';
import { PolizaTraspasosComponent } from './poliza-traspasos.component';
import { PolizaCompensacionesInteresesComponent } from './poliza-compensaciones-intereses.component';
import { PolizaTablaComponent } from './poliza-tabla.component';

@NgModule({
  declarations: [
    // 2026-08-28: DateRangePickerComponent se movió a su propio módulo chico
    // (shared/components/date-range-picker/date-range-picker.module.ts) — BanksModule
    // también lo necesita ahora, y NO puede pasar por SharedModule sin arrastrar
    // flatpickr al bundle inicial (SharedModule lo importa AppModule de forma eager).
    // Se recibe vía DateRangePickerModule de abajo, ya no se declara acá.
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
    DateRangePickerModule,
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
