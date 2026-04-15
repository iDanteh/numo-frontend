import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';

import { AccountPlanComponent } from './account-plan.component';

@NgModule({
  declarations: [AccountPlanComponent],
  imports: [
    CommonModule,
    ReactiveFormsModule,
    FormsModule,
    RouterModule.forChild([{ path: '', component: AccountPlanComponent }]),
  ],
})
export class AccountPlanModule {}
