import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { DragDropModule } from '@angular/cdk/drag-drop';
import { SharedModule } from '../../shared/shared.module';
import { DateRangePickerModule } from '../../shared/components/date-range-picker/date-range-picker.module';

import { BanksComponent }             from './banks.component';
import { ImportModalComponent }       from './components/import-modal/import-modal.component';
import { OcrModalComponent }          from './components/ocr-modal/ocr-modal.component';
import { MovementEditModalComponent } from './components/movement-edit-modal/movement-edit-modal.component';
import { ReportPanelComponent }       from './components/report-panel/report-panel.component';
import { RulesPanelComponent }        from './components/rules-panel/rules-panel.component';
import { DuplicatesModalComponent }   from './components/duplicates-modal/duplicates-modal.component';
import { SaldoInicialModalComponent } from './components/saldo-inicial-modal/saldo-inicial-modal.component';
import { BancoConfigModalComponent }  from './components/banco-config-modal/banco-config-modal.component';
import { AdminOpsPanelComponent }     from './components/admin-ops-panel/admin-ops-panel.component';
import { ErpModalComponent }          from './components/erp-modal/erp-modal.component';
import { CobroPanelComponent }        from './components/cobro-panel/cobro-panel.component';
import { BulkReclasifyModalComponent } from './components/bulk-reclasify-modal/bulk-reclasify-modal.component';
import { BankDashboardCarouselComponent } from './components/dashboard-carousel/bank-dashboard-carousel.component';
import { BankIndicadoresPanelComponent }  from './components/indicadores-panel/bank-indicadores-panel.component';
import { TransferenciasCajaPanelComponent } from './components/transferencias-caja-panel/transferencias-caja-panel.component';
import { FichaPendientePanelComponent }     from './components/ficha-pendiente-panel/ficha-pendiente-panel.component';

@NgModule({
  declarations: [
    BanksComponent,
    ImportModalComponent,
    OcrModalComponent,
    MovementEditModalComponent,
    ReportPanelComponent,
    RulesPanelComponent,
    DuplicatesModalComponent,
    SaldoInicialModalComponent,
    BancoConfigModalComponent,
    AdminOpsPanelComponent,
    ErpModalComponent,
    CobroPanelComponent,
    BulkReclasifyModalComponent,
    BankDashboardCarouselComponent,
    BankIndicadoresPanelComponent,
    TransferenciasCajaPanelComponent,
    FichaPendientePanelComponent,
  ],
  imports: [
    CommonModule,
    ReactiveFormsModule,
    FormsModule,
    DragDropModule,
    SharedModule,
    DateRangePickerModule,
    RouterModule.forChild([{ path: '', component: BanksComponent }]),
  ],
})
export class BanksModule {}
