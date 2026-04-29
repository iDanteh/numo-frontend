import { NgModule }     from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule }  from '@angular/forms';
import { RouterModule } from '@angular/router';

import { EntitiesComponent } from './entities.component';

@NgModule({
  declarations: [EntitiesComponent],
  imports: [
    CommonModule,
    FormsModule,
    RouterModule.forChild([{ path: '', component: EntitiesComponent }]),
  ],
})
export class EntitiesModule {}
