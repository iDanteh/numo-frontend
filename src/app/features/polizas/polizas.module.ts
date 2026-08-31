import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { DateRangePickerModule } from '../../shared/components/date-range-picker/date-range-picker.module';

import { PolizaListComponent } from './poliza-list.component';
import { PolizaTraspasosComponent } from './poliza-traspasos.component';
import { PolizaCompensacionesInteresesComponent } from './poliza-compensaciones-intereses.component';
import { PolizaTablaComponent } from './poliza-tabla.component';
import { ConfirmModalComponent } from './confirm-modal.component';

@NgModule({
  declarations: [
    // 2026-08-28: DateRangePickerComponent se movió a su propio módulo chico
    // (shared/components/date-range-picker/date-range-picker.module.ts) — BanksModule
    // también lo necesita ahora, y NO puede pasar por SharedModule sin arrastrar
    // flatpickr al bundle inicial (SharedModule lo importa AppModule de forma eager).
    // Se recibe vía DateRangePickerModule de abajo, ya no se declara acá.
    PolizaListComponent, PolizaTraspasosComponent,
    PolizaCompensacionesInteresesComponent, PolizaTablaComponent, ConfirmModalComponent,
  ],
  imports: [
    CommonModule,
    ReactiveFormsModule,
    FormsModule,
    DateRangePickerModule,
    RouterModule.forChild([
      { path: '',                       component: PolizaListComponent,     data: { vista: 'ingreso' } },
      { path: 'cobranza',               component: PolizaListComponent,     data: { vista: 'cobranza' } },
      { path: 'traspasos-cp',           component: PolizaTraspasosComponent },
      { path: 'compensaciones-intereses', component: PolizaCompensacionesInteresesComponent },
    ]),
  ],
})
export class PolizasModule {}
