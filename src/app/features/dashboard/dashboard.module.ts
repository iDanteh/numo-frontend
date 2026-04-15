import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { BaseChartDirective, provideCharts, withDefaultRegisterables } from 'ng2-charts';

import { DashboardComponent } from './dashboard.component';

@NgModule({
  declarations: [DashboardComponent],
  imports: [
    CommonModule,
    FormsModule,
    BaseChartDirective,
    RouterModule.forChild([{ path: '', component: DashboardComponent }]),
  ],
  providers: [provideCharts(withDefaultRegisterables())],
})
export class DashboardModule {}
