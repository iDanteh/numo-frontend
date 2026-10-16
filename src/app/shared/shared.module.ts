import { NgModule }            from '@angular/core';
import { CommonModule }        from '@angular/common';
import { ModalComponent }      from './components/modal/modal.component';
import { HasRoleDirective }    from '../core/directives/has-role.directive';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { LucideDynamicIcon } from '@lucide/angular';
import { CerKeyUploadComponent } from './cer-key-upload/cer-key-upload.component';
import { SelectorPeriodoModalComponent } from './components/selector-periodo-modal/selector-periodo-modal.component';
import { ToastComponent } from './components/toast/toast.component';
import { ConfirmModalComponent } from './components/confirm-modal/confirm-modal.component';
import { DateRangePopoverComponent } from './components/date-range-popover/date-range-popover.component';
import { TransitionOverlayComponent } from './components/transition-overlay/transition-overlay.component';
import { SpaceSwitcherComponent } from './components/space-switcher/space-switcher.component';

@NgModule({
  declarations: [ModalComponent, HasRoleDirective, CerKeyUploadComponent, SelectorPeriodoModalComponent, ToastComponent, ConfirmModalComponent, DateRangePopoverComponent, TransitionOverlayComponent, SpaceSwitcherComponent],
  imports:      [CommonModule, FormsModule, RouterModule, LucideDynamicIcon],
  exports:      [ModalComponent, HasRoleDirective, CommonModule, FormsModule, RouterModule, CerKeyUploadComponent, SelectorPeriodoModalComponent, ToastComponent, ConfirmModalComponent, DateRangePopoverComponent, TransitionOverlayComponent, SpaceSwitcherComponent],
})
export class SharedModule {}
