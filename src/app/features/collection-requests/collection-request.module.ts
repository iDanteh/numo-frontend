import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';

import { CollectionRequestComponent } from './collection-request.component';

@NgModule({
  declarations: [CollectionRequestComponent],
  imports: [
    CommonModule,
    FormsModule,
    RouterModule.forChild([{ path: '', component: CollectionRequestComponent }]),
  ],
})
export class CollectionRequestModule {}
