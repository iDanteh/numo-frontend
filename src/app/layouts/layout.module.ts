import { NgModule }        from '@angular/core';
import { CommonModule }    from '@angular/common';
import { RouterModule }    from '@angular/router';
import {
  LucideDynamicIcon,
  provideLucideIcons,
  LucideLandmark,
  LucideCamera,
  LucideLayoutDashboard,
  LucideFiles,
  LucideDownload,
  LucideUpload,
  LucideListTree,
  LucideLayers,
  LucideFileInput,
  LucideHandCoins,
  LucideArrowLeftRight,
  LucidePercent,
  LucideCalendarRange,
  LucideReceiptText,
  LucideBarChart3,
  LucideLock,
  LucideUsers,
  LucideBuilding2,
  LucideSettings,
  LucideActivity,
  LucideFileSearch,
  LucideLogOut,
  LucideChevronDown,
  LucideChevronRight,
  LucidePanelLeft,
  LucidePanelLeftClose,
  LucideBell,
  LucideCreditCard,
} from '@lucide/angular';
import { SharedModule } from '../shared/shared.module';
import { SidebarComponent } from './sidebar/sidebar.component';
import { NotificationBellComponent } from './notification-bell/notification-bell.component';

@NgModule({
  declarations: [SidebarComponent, NotificationBellComponent],
  // SharedModule: trae SpaceSwitcherComponent (app-space-switcher), usado en
  // sidebar.component.html desde sistema-lealtad — mismo switcher que usa
  // LealtadShellComponent (que ya importa SharedModule por su cuenta).
  imports:      [CommonModule, RouterModule, LucideDynamicIcon, SharedModule],
  providers:    [provideLucideIcons(
    LucideLandmark,
    LucideCamera,
    LucideLayoutDashboard,
    LucideFiles,
    LucideDownload,
    LucideUpload,
    LucideListTree,
    LucideLayers,
    LucideFileInput,
    LucideHandCoins,
    LucideArrowLeftRight,
    LucidePercent,
    LucideCalendarRange,
    LucideReceiptText,
    LucideBarChart3,
    LucideLock,
    LucideUsers,
    LucideBuilding2,
    LucideSettings,
    LucideActivity,
    LucideFileSearch,
    LucideLogOut,
    LucideChevronDown,
    LucideChevronRight,
    LucidePanelLeft,
    LucidePanelLeftClose,
    LucideBell,
    // sistema-lealtad — SpaceSwitcherComponent (SharedModule) renderiza la
    // entrada "Lealtad" del dropdown en este shell; LayoutModule es eager y
    // se fusiona al injector raíz, así que necesita su propio ícono acá
    // (LealtadModule, lazy, ya trae LucideCreditCard en el suyo).
    LucideCreditCard,
  )],
  exports:      [SidebarComponent, NotificationBellComponent],
})
export class LayoutModule {}
