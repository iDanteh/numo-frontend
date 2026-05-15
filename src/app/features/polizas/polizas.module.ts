import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';

import { PolizaListComponent } from './poliza-list.component';

@NgModule({
  declarations: [PolizaListComponent],
  imports: [
    CommonModule,
    FormsModule,
    RouterModule.forChild([{ path: '', component: PolizaListComponent }]),
  ],
})
export class PolizasModule {}
