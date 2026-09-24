import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { BaseChartDirective, provideCharts, withDefaultRegisterables } from 'ng2-charts';

import { SharedModule } from '../../shared/shared.module';
import { SystemMonitorComponent } from './system-monitor.component';

@NgModule({
  declarations: [SystemMonitorComponent],
  imports: [
    CommonModule,
    SharedModule, // <app-date-range-popover> (histórico persistente, mejora #3)
    BaseChartDirective,
    RouterModule.forChild([{ path: '', component: SystemMonitorComponent }]),
  ],
  providers: [provideCharts(withDefaultRegisterables())],
})
export class SystemMonitorModule {}
