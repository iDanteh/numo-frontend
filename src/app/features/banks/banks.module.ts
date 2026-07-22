import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { DragDropModule } from '@angular/cdk/drag-drop';
import { SharedModule } from '../../shared/shared.module';

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
  ],
  imports: [
    CommonModule,
    ReactiveFormsModule,
    FormsModule,
    DragDropModule,
    SharedModule,
    RouterModule.forChild([{ path: '', component: BanksComponent }]),
  ],
})
export class BanksModule {}
