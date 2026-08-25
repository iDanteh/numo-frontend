import { NgModule }      from '@angular/core';
import { CommonModule }  from '@angular/common';
import { FormsModule }   from '@angular/forms';
import { RouterModule }  from '@angular/router';

import { ConfigAdminComponent } from './config-admin.component';

@NgModule({
  declarations: [ConfigAdminComponent],
  imports: [
    CommonModule,
    FormsModule,
    RouterModule.forChild([{ path: '', component: ConfigAdminComponent }]),
  ],
})
export class ConfigAdminModule {}
