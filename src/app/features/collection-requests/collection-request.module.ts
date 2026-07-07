import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { SharedModule } from '../../shared/shared.module';

import { CollectionRequestComponent } from './collection-request.component';

@NgModule({
  declarations: [CollectionRequestComponent],
  imports: [
    CommonModule,
    FormsModule,
    SharedModule, // <app-modal> — reemplaza los confirm() nativos
    RouterModule.forChild([{ path: '', component: CollectionRequestComponent }]),
  ],
})
export class CollectionRequestModule {}
