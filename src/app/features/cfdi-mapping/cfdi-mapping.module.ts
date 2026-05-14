import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';

import { CfdiMappingComponent } from './cfdi-mapping.component';

@NgModule({
  declarations: [CfdiMappingComponent],
  imports: [
    CommonModule,
    ReactiveFormsModule,
    FormsModule,
    RouterModule.forChild([{ path: '', component: CfdiMappingComponent }]),
  ],
})
export class CfdiMappingModule {}
