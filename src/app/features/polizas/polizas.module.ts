import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';

import { PolizaListComponent } from './poliza-list.component';
import { DateRangePickerComponent } from './date-range-picker.component';

@NgModule({
  declarations: [PolizaListComponent, DateRangePickerComponent],
  imports: [
    CommonModule,
    ReactiveFormsModule,
    FormsModule,
    RouterModule.forChild([{ path: '', component: PolizaListComponent }]),
  ],
})
export class PolizasModule {}
