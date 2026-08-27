import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';

import { PolizaListComponent } from './poliza-list.component';
import { DateRangePickerComponent } from './date-range-picker.component';
import { PolizaTraspasosComponent } from './poliza-traspasos.component';
import { PolizaTablaComponent } from './poliza-tabla.component';
import { ConfirmModalComponent } from './confirm-modal.component';

@NgModule({
  declarations: [PolizaListComponent, DateRangePickerComponent, PolizaTraspasosComponent, PolizaTablaComponent, ConfirmModalComponent],
  imports: [
    CommonModule,
    ReactiveFormsModule,
    FormsModule,
    RouterModule.forChild([
      { path: '',             component: PolizaListComponent,     data: { vista: 'ingreso' } },
      { path: 'cobranza',     component: PolizaListComponent,     data: { vista: 'cobranza' } },
      { path: 'traspasos-cp', component: PolizaTraspasosComponent },
    ]),
  ],
})
export class PolizasModule {}
