import { NgModule }      from '@angular/core';
import { CommonModule }  from '@angular/common';
import { FormsModule }   from '@angular/forms';
import { RouterModule }  from '@angular/router';

import { UsersComponent } from './users.component';
import { PermisosChecklistComponent } from './components/permisos-checklist/permisos-checklist.component';

@NgModule({
  declarations: [UsersComponent, PermisosChecklistComponent],
  imports: [
    CommonModule,
    FormsModule,
    RouterModule.forChild([{ path: '', component: UsersComponent }]),
  ],
})
export class UsersModule {}
