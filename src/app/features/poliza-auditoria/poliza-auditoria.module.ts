import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { BaseChartDirective, provideCharts, withDefaultRegisterables } from 'ng2-charts';

import { SharedModule } from '../../shared/shared.module';
import { PolizaAuditoriaComponent } from './poliza-auditoria.component';

@NgModule({
  declarations: [PolizaAuditoriaComponent],
  imports: [
    CommonModule,
    SharedModule, // FormsModule
    BaseChartDirective,
    RouterModule.forChild([{ path: '', component: PolizaAuditoriaComponent }]),
  ],
  providers: [provideCharts(withDefaultRegisterables())],
})
export class PolizaAuditoriaModule {}
