import { NgModule }            from '@angular/core';
import { CommonModule }        from '@angular/common';
import { ModalComponent }      from './components/modal/modal.component';
import { HasRoleDirective }    from '../core/directives/has-role.directive';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { CerKeyUploadComponent } from './cer-key-upload/cer-key-upload.component';
import { SelectorPeriodoModalComponent } from './components/selector-periodo-modal/selector-periodo-modal.component';
import { ToastComponent } from './components/toast/toast.component';

@NgModule({
  declarations: [ModalComponent, HasRoleDirective, CerKeyUploadComponent, SelectorPeriodoModalComponent, ToastComponent],
  imports:      [CommonModule, FormsModule, RouterModule],
  exports:      [ModalComponent, HasRoleDirective, CommonModule, FormsModule, RouterModule, CerKeyUploadComponent, SelectorPeriodoModalComponent, ToastComponent],
})
export class SharedModule {}
