import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';

import { CfdiListComponent } from './cfdi-list.component';

@NgModule({
  declarations: [CfdiListComponent],
  imports: [
    CommonModule,
    ReactiveFormsModule,
    FormsModule,
    RouterModule.forChild([{ path: '', component: CfdiListComponent }]),
  ],
})
export class CfdisModule {}
